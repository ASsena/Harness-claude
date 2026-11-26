#!/usr/bin/env node
// Lê o estado da esteira de um PR do Azure DevOps — SÓ LEITURA.
//
//   node esteira-pr.mjs pr     --branch <branch>
//   node esteira-pr.mjs status --pr <id> [--sha <sha>] [--aguardar <min>] [--intervalo <seg>] [--saida <arquivo.md>]
//
// Organização, projeto e repositório saem do `git remote get-url origin` (ou de --org/--projeto/--repo).
//
// Toda chamada é `az rest --method get` com o resource do Azure DevOps e --output-file (o stdout do az
// perde acentos no console do Windows). O script nunca escreve no remoto: push, criar PR, re-enfileirar
// build e comentar ficam fora dele, como comandos visíveis, para o hook trava-remoto ver e perguntar.
//
// `pr`: primeira linha `pr: <id>` ou `pr: nenhum` (PR ativo cuja fonte é a branch).
//
// `status`: resumo em Markdown (stdout e --saida). Os logs das etapas que falharam vão para
// <pasta da --saida>/esteira-logs/. Com --sha, só conta build/status do push com esse SHA.
// --aguardar <min>: consulta a cada --intervalo (padrão 60 s) enquanto houver pendência, até o prazo.
// Código de saída:
//   0 verde    — políticas de build e status do PR aprovadas ou não aplicáveis, para o SHA
//   1 falha    — alguma build/status falhou, ou o PR tem conflito com a master
//   2 pendente — ainda rodando quando o prazo acabou (ou o PR ainda não viu o push)
//   3 erro     — uso errado, az sem login/acesso, PR inexistente ou inativo
//
// Requer `az` logado (az login) com acesso ao Azure DevOps. Testes: node --test scripts/esteira-pr.test.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const ADO_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';
const V = 'api-version=7.1';
const VP = 'api-version=7.1-preview.1';

// Sinais de falha de infraestrutura (não de código) em mensagens de etapa e de log.
const INFRA = /lost communication|no agent (found|could be found)|agent .*(offline|went offline)|timed? ?out|has exceeded|cancel+ed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|\b50[234]\b|service unavailable|npm ERR! network|unable to load the service index|NU1301|docker daemon|no space left|disk space|out of memory|OutOfMemory/i;
// Linhas de log que costumam ser o erro de verdade.
const LINHA_ERRO = /##\[error\]|\berror\b|\bERROR\b|\bFAILED\b|\bFailed\b|✖|✗|\bFAIL\b|Exception:|Assert\./;

export class ErroAz extends Error {}

export function parseRemote(url) {
  const u = String(url || '').trim();
  let m = u.match(/^https?:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+?)(?:\.git)?\/?$/i);
  if (m) return { org: m[1], projeto: m[2], repo: m[3] };
  m = u.match(/^https?:\/\/(?:[^@/]+@)?([^./]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?#]+?)(?:\.git)?\/?$/i);
  if (m) return { org: m[1], projeto: m[2], repo: m[3] };
  m = u.match(/^(?:ssh:\/\/)?[^@\s]+@(?:ssh\.dev\.azure\.com|vs-ssh\.visualstudio\.com)[:/](?:\d+\/)?v3\/([^/]+)\/([^/]+)\/([^/]+?)\/?$/i);
  if (m) return { org: m[1], projeto: m[2], repo: m[3] };
  return null;
}

// Valor de query sem codificar '/' e ':' (refs e artifactIds ficam legíveis e sem '%', que o cmd.exe expande).
const qv = (v) => encodeURIComponent(String(v)).replace(/%2F/gi, '/').replace(/%3A/gi, ':');

export function criarGet({ az = process.env.ESTEIRA_AZ, tmp } = {}) {
  let n = 0;
  return function get(url, { texto = false } = {}) {
    const out = path.join(tmp, `r${++n}.${texto ? 'txt' : 'json'}`);
    const args = ['rest', '--method', 'get', '--resource', ADO_RESOURCE, '--url', url, '--output-file', out];
    const opts = { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000, windowsHide: true, encoding: 'utf8' };
    try {
      if (az) execFileSync(az, args, opts);
      // No Windows o az é um .cmd: precisa do shell. Aspas em cada argumento protegem & e ? da URL.
      else if (process.platform === 'win32') execSync(['az', ...args.map((a) => `"${a}"`)].join(' '), opts);
      else execFileSync('az', args, opts);
    } catch (e) {
      const msg = String(e.stderr || e.message || '').trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
      throw new ErroAz(`az rest GET falhou (${url.replace(/\?.*/, '')}): ${msg || 'sem mensagem'}. ` +
        'Confira `az login` e o acesso ao Azure DevOps.');
    }
    let corpo = '';
    try { corpo = fs.readFileSync(out, 'utf8').replace(/^﻿/, ''); } catch { /* resposta vazia */ }
    if (texto) {
      // O endpoint de log devolve texto, ou {count, value:[linhas]} quando negocia JSON.
      try { const j = JSON.parse(corpo); if (Array.isArray(j?.value)) return j.value.join('\n'); } catch { /* texto puro */ }
      return corpo;
    }
    return corpo ? JSON.parse(corpo) : null;
  };
}

const mesmoSha = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));
const curto = (s) => (s ? String(s).slice(0, 10) : '—');

function tipoPolitica(ev) {
  const t = ev.configuration?.type?.displayName || '';
  const s = ev.configuration?.settings || {};
  if (/^build$/i.test(t) || s.buildDefinitionId || ev.context?.buildId) return 'build';
  if (/status/i.test(t) || s.statusName) return 'status';
  return 'dev';
}

function nomePolitica(ev) {
  const s = ev.configuration?.settings || {};
  return s.displayName || ev.context?.buildDefinitionName || (s.statusGenre && s.statusName ? `${s.statusGenre}/${s.statusName}` : s.statusName) ||
    ev.configuration?.type?.displayName || 'política';
}

// Uma consulta: estado do PR, das políticas e dos status. Não baixa logs.
export function consultar(get, ctx, { pr, sha }) {
  const base = `https://dev.azure.com/${ctx.org}/${ctx.projeto}`;
  const repoUrl = `${base}/_apis/git/repositories/${ctx.repo}`;
  const p = get(`${repoUrl}/pullrequests/${pr}?${V}`);
  if (!p || !p.pullRequestId) throw new ErroAz(`PR ${pr} não encontrado em ${ctx.org}/${ctx.projeto}/${ctx.repo}.`);
  const r = {
    pr: p.pullRequestId, titulo: p.title, status: p.status, mergeStatus: p.mergeStatus,
    alvo: (p.targetRefName || '').replace(/^refs\/heads\//, ''), fonte: (p.sourceRefName || '').replace(/^refs\/heads\//, ''),
    fonteSha: p.lastMergeSourceCommit?.commitId, mergeSha: p.lastMergeCommit?.commitId,
    url: `https://dev.azure.com/${ctx.org}/${ctx.projeto}/_git/${ctx.repo}/pullrequest/${p.pullRequestId}`,
    sha, itens: [], avisos: [],
  };
  if (p.status !== 'active') { r.resultado = 'erro'; r.avisos.push(`O PR está "${p.status}", não ativo.`); return r; }

  if (sha && !mesmoSha(r.fonteSha, sha)) {
    r.resultado = 'pendente';
    r.avisos.push(`O PR ainda está no commit ${curto(r.fonteSha)}; o push ${curto(sha)} ainda não chegou nele.`);
    return r;
  }

  if (r.mergeStatus === 'conflicts') r.itens.push({ nome: 'merge com a master', tipo: 'merge', obrigatoria: true, estado: 'falha', detalhe: 'o PR tem conflito com a master — integre a master na branch' });
  else if (['failure', 'rejectedByPolicy'].includes(r.mergeStatus)) r.itens.push({ nome: 'merge com a master', tipo: 'merge', obrigatoria: true, estado: 'falha', detalhe: `mergeStatus = ${r.mergeStatus}` });
  else if (r.mergeStatus !== 'succeeded') r.itens.push({ nome: 'merge com a master', tipo: 'merge', obrigatoria: true, estado: 'pendente', detalhe: `mergeStatus = ${r.mergeStatus || 'notSet'}` });

  const projId = p.repository?.project?.id;
  const evals = projId ? (get(`${base}/_apis/policy/evaluations?artifactId=vstfs:///CodeReview/CodeReviewId/${projId}/${pr}&${VP}`)?.value || []) : [];
  if (!projId) r.avisos.push('O PR não informou o id do projeto; políticas não consultadas.');

  for (const ev of evals) {
    if (ev.configuration?.isEnabled === false) continue;
    const tipo = tipoPolitica(ev);
    const item = { nome: nomePolitica(ev), tipo, obrigatoria: ev.configuration?.isBlocking !== false, bruto: ev.status, detalhe: '' };
    if (tipo === 'dev') {
      item.estado = ev.status === 'approved' || ev.status === 'notApplicable' ? 'ok' : 'do dev';
      item.detalhe = 'revisores, comentários ou vínculo de WI — não é gate da esteira';
      r.itens.push(item); continue;
    }
    if (ev.status === 'approved' || ev.status === 'notApplicable') item.estado = 'verde';
    else if (ev.status === 'rejected' || ev.status === 'broken') item.estado = 'falha';
    else item.estado = 'pendente';

    const buildId = ev.context?.buildId;
    if (tipo === 'build' && !buildId && item.estado === 'pendente' && ev.configuration?.settings?.manualQueueOnly) {
      item.estado = 'manual'; item.detalhe = 'build manual — o dev precisa enfileirar';
    }
    if (tipo === 'build' && ev.context?.isExpired && item.estado !== 'manual') {
      item.estado = 'pendente'; item.detalhe = 'resultado expirado — aguardando nova build';
    }
    if (tipo === 'build' && buildId) {
      const b = get(`${base}/_apis/build/builds/${buildId}?${V}`);
      item.build = { id: buildId, numero: b?.buildNumber, status: b?.status, resultado: b?.result, definicao: b?.definition?.id,
        nomeDefinicao: b?.definition?.name, link: b?._links?.web?.href, shaFonte: b?.triggerInfo?.['pr.sourceSha'], shaMerge: b?.sourceVersion };
      const doSha = item.build.shaFonte ? mesmoSha(item.build.shaFonte, sha || r.fonteSha)
        : (!item.build.shaMerge || !r.mergeSha || mesmoSha(item.build.shaMerge, r.mergeSha));
      if (sha && !doSha) { item.estado = 'pendente'; item.detalhe = `a build ${buildId} é de outro commit (${curto(item.build.shaFonte || item.build.shaMerge)})`; }
      else if (b?.status && b.status !== 'completed') { item.estado = 'pendente'; item.detalhe = `build ${b.status}`; }
      else if (b?.result === 'failed' || b?.result === 'canceled') item.estado = 'falha';
      else if (b?.result === 'succeeded' || b?.result === 'partiallySucceeded') {
        // A avaliação da política atualiza alguns segundos depois da build; a build concluída do SHA certo vale.
        if (item.estado === 'pendente' && !ev.context?.isExpired) item.estado = 'verde';
        if (b.result === 'partiallySucceeded') item.detalhe = 'build parcialmente bem-sucedida (avisos)';
      }
    }
    r.itens.push(item);
  }

  // Status postados no PR (ex.: análise estática). Ignora os de iterações antigas e fica com o último por contexto.
  const iters = get(`${repoUrl}/pullRequests/${pr}/iterations?${V}`)?.value || [];
  const ultimaIter = iters.reduce((m, i) => Math.max(m, i.id || 0), 0);
  const sts = get(`${repoUrl}/pullRequests/${pr}/statuses?${VP}`)?.value || [];
  const porCtx = new Map();
  for (const s of sts) {
    if (ultimaIter && s.iterationId && s.iterationId < ultimaIter) continue;
    const k = `${s.context?.genre || ''}/${s.context?.name || ''}`;
    const atual = porCtx.get(k);
    if (!atual || (s.id || 0) > (atual.id || 0)) porCtx.set(k, s);
  }
  const jaPorPolitica = new Set(r.itens.filter((i) => i.tipo === 'status').map((i) => i.nome));
  for (const [k, s] of porCtx) {
    const nome = k.replace(/^\//, '');
    if (jaPorPolitica.has(nome) || jaPorPolitica.has(s.context?.name)) continue;
    const estado = s.state === 'succeeded' || s.state === 'notApplicable' ? 'verde'
      : s.state === 'failed' || s.state === 'error' ? 'falha' : 'pendente';
    r.itens.push({ nome, tipo: 'status', obrigatoria: false, estado, detalhe: s.description || '', link: s.targetUrl });
  }

  const gate = r.itens.filter((i) => ['build', 'status', 'merge'].includes(i.tipo));
  r.resultado = gate.some((i) => i.estado === 'falha') ? 'falha' : gate.some((i) => i.estado === 'pendente') ? 'pendente' : 'verde';
  if (!gate.some((i) => i.tipo === 'build')) r.avisos.push('Nenhuma política de build no PR: não há esteira para acompanhar.');
  return r;
}

function trechoDoLog(txt) {
  const linhas = txt.split(/\r?\n/).map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, ''));
  const erros = [];
  linhas.forEach((l, i) => { if (LINHA_ERRO.test(l) && !/^\s*$/.test(l)) erros.push(i); });
  const escolhidas = new Set(erros.slice(-40));
  for (let i = Math.max(0, linhas.length - 25); i < linhas.length; i++) escolhidas.add(i);
  return [...escolhidas].sort((a, b) => a - b).map((i) => linhas[i]).join('\n').slice(-6000);
}

// Detalha as builds que falharam: etapas, issues, trecho do log, testes, e a última build da master.
export function detalharFalhas(get, ctx, r, pastaLogs) {
  const base = `https://dev.azure.com/${ctx.org}/${ctx.projeto}`;
  for (const item of r.itens) {
    if (item.estado !== 'falha' || !item.build) continue;
    const b = item.build;
    b.etapas = []; b.testes = []; b.infra = false;
    const tl = get(`${base}/_apis/build/builds/${b.id}/timeline?${V}`)?.records || [];
    const filhosFalhos = new Set(tl.filter((x) => x.result === 'failed' && x.type === 'Task').map((x) => x.parentId));
    for (const rec of tl) {
      const falhou = rec.result === 'failed' || rec.result === 'canceled';
      if (!falhou || (rec.type !== 'Task' && filhosFalhos.has(rec.id))) continue;
      if (rec.type !== 'Task' && tl.some((x) => x.parentId === rec.id && (x.result === 'failed' || x.result === 'canceled'))) continue;
      const pai = tl.find((x) => x.id === rec.parentId);
      const etapa = { nome: pai ? `${pai.name} › ${rec.name}` : rec.name, resultado: rec.result,
        issues: (rec.issues || []).filter((i) => i.type === 'error').map((i) => i.message).slice(0, 10) };
      if (rec.log?.id) {
        try {
          const txt = get(`${base}/_apis/build/builds/${b.id}/logs/${rec.log.id}?${V}`, { texto: true });
          fs.mkdirSync(pastaLogs, { recursive: true });
          const arq = path.join(pastaLogs, `build-${b.id}-log-${rec.log.id}.txt`);
          fs.writeFileSync(arq, txt);
          etapa.log = arq; etapa.trecho = trechoDoLog(txt);
        } catch (e) { etapa.trecho = `(log indisponível: ${e.message})`; }
      }
      if (INFRA.test([...etapa.issues, rec.result === 'canceled' ? 'canceled' : ''].join('\n'))) b.infra = true;
      b.etapas.push(etapa);
    }
    if (b.resultado === 'canceled') b.infra = true;

    const runs = get(`${base}/_apis/test/runs?buildUri=vstfs:///Build/Build/${b.id}&${V}`)?.value || [];
    for (const run of runs) {
      if ((run.totalTests ?? 0) > 0 && (run.passedTests ?? 0) + (run.notApplicableTests ?? 0) >= run.totalTests) continue;
      const res = get(`${base}/_apis/test/Runs/${run.id}/results?outcomes=Failed&$top=200&${V}`)?.value || [];
      for (const t of res.slice(0, 30)) {
        b.testes.push({ nome: t.automatedTestName || t.testCaseTitle, projeto: t.automatedTestStorage,
          erro: String(t.errorMessage || '').split(/\r?\n/).slice(0, 4).join(' ').slice(0, 400),
          pilha: String(t.stackTrace || '').split(/\r?\n/).slice(0, 3).join('\n') });
      }
    }

    if (b.definicao) {
      const m = get(`${base}/_apis/build/builds?definitions=${b.definicao}&branchName=refs/heads/master&statusFilter=completed&queryOrder=finishTimeDescending&$top=1&${V}`)?.value?.[0];
      if (m) b.master = { id: m.id, numero: m.buildNumber, resultado: m.result, fim: m.finishTime, link: m._links?.web?.href };
    }
  }
}

const ICONE = { verde: '✅ verde', ok: '✅ ok', falha: '❌ falhou', pendente: '⏳ rodando', manual: '✋ manual', 'do dev': '👤 do dev' };

export function formatar(r) {
  const L = [];
  L.push(`# Esteira do PR #${r.pr} — ${r.titulo || ''}`);
  L.push('');
  L.push(`- PR: ${r.url} · ${r.fonte} → ${r.alvo} · fonte em ${curto(r.fonteSha)} · merge: ${r.mergeStatus || '—'}`);
  if (r.sha) L.push(`- SHA esperado: ${curto(r.sha)}`);
  L.push(`- Consulta: ${new Date().toISOString()}`);
  const n = (e) => r.itens.filter((i) => ['build', 'status', 'merge'].includes(i.tipo) && i.estado === e).length;
  L.push(`- **Resultado: ${String(r.resultado).toUpperCase()}** (${n('falha')} falha, ${n('pendente')} pendente, ${n('verde')} verde)`);
  for (const a of r.avisos) L.push(`- ⚠️ ${a}`);
  if (r.itens.length) {
    L.push('', '## Políticas e status', '', '| Item | Tipo | Obrigatória | Estado | Build | Detalhe |', '|---|---|---|---|---|---|');
    for (const i of r.itens) {
      const b = i.build ? `${i.build.id}${i.build.numero ? ` (${i.build.numero})` : ''}` : '—';
      L.push(`| ${i.nome} | ${i.tipo} | ${i.obrigatoria ? 'sim' : 'não'} | ${ICONE[i.estado] || i.estado} | ${b} | ${(i.detalhe || '').replace(/\|/g, '/')} |`);
    }
  }
  const falhas = r.itens.filter((i) => i.estado === 'falha');
  if (falhas.length) {
    L.push('', '## Falhas');
    for (const i of falhas) {
      L.push('', `### ${i.nome}${i.build ? ` — build ${i.build.id} (${i.build.resultado || i.build.status})` : ''}`);
      if (i.build?.link || i.link) L.push(`- Link: ${i.build?.link || i.link}`);
      if (i.detalhe) L.push(`- ${i.detalhe}`);
      if (!i.build) continue;
      const m = i.build.master;
      if (m) L.push(`- Master (última build concluída da mesma pipeline): ${m.resultado} · ${m.numero || m.id} · ${m.fim || ''}${m.resultado === 'failed' ? ' → **também vermelha na master**' : ''}`);
      L.push(`- Suspeita de infraestrutura: ${i.build.infra ? '**sim**' : 'não'}`);
      for (const e of i.build.etapas || []) {
        L.push('', `#### Etapa: ${e.nome} (${e.resultado})`);
        for (const msg of e.issues) L.push(`- erro: ${msg}`);
        if (e.log) L.push(`- log completo: ${e.log}`);
        if (e.trecho) L.push('```', e.trecho, '```');
      }
      if (i.build.testes?.length) {
        L.push('', `#### Testes que falharam (${i.build.testes.length})`);
        for (const t of i.build.testes) L.push(`- \`${t.nome}\`${t.projeto ? ` (${t.projeto})` : ''} — ${t.erro}`);
      }
    }
  }
  L.push('', `RESULTADO: ${r.resultado}`);
  return L.join('\n');
}

function dormir(ms) { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function contexto(o) {
  if (o.org && o.projeto && o.repo) return { org: o.org, projeto: o.projeto, repo: o.repo };
  let url = '';
  try { url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* sem remote */ }
  const c = parseRemote(url);
  if (!c) throw new ErroAz(`Não reconheci o remote "${url}" como Azure DevOps; passe --org, --projeto e --repo.`);
  return { org: o.org || c.org, projeto: o.projeto || c.projeto, repo: o.repo || c.repo };
}

export function main(argv) {
  const [cmd, ...resto] = argv;
  const o = {};
  for (let i = 0; i < resto.length; i++) if (resto[i].startsWith('--')) o[resto[i].slice(2)] = resto[i + 1]?.startsWith('--') ? true : resto[++i];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'esteira-'));
  try {
    const ctx = contexto(o);
    const get = criarGet({ tmp });
    if (cmd === 'pr') {
      if (!o.branch) { console.error('uso: esteira-pr.mjs pr --branch <branch>'); return 3; }
      const ref = `refs/heads/${String(o.branch).replace(/^refs\/heads\//, '')}`;
      const lista = get(`https://dev.azure.com/${ctx.org}/${ctx.projeto}/_apis/git/repositories/${ctx.repo}/pullrequests?searchCriteria.sourceRefName=${qv(ref)}&searchCriteria.status=active&${V}`)?.value || [];
      if (!lista.length) { console.log('pr: nenhum'); return 0; }
      for (const [k, p] of lista.entries()) {
        if (k === 0) console.log(`pr: ${p.pullRequestId}`);
        console.log(`- #${p.pullRequestId} → ${(p.targetRefName || '').replace(/^refs\/heads\//, '')} — ${p.title} — https://dev.azure.com/${ctx.org}/${ctx.projeto}/_git/${ctx.repo}/pullrequest/${p.pullRequestId}`);
      }
      return 0;
    }
    if (cmd === 'status') {
      if (!o.pr) { console.error('uso: esteira-pr.mjs status --pr <id> [--sha <sha>] [--aguardar <min>] [--intervalo <seg>] [--saida <arquivo.md>]'); return 3; }
      const prazo = Date.now() + Number(o.aguardar || 0) * 60000;
      const intervalo = Number(o.intervalo ?? 60) * 1000;
      let r;
      for (;;) {
        r = consultar(get, ctx, { pr: o.pr, sha: o.sha });
        if (r.resultado !== 'pendente' || Date.now() + intervalo > prazo) break;
        dormir(intervalo);
      }
      const pastaLogs = path.join(o.saida ? path.dirname(path.resolve(o.saida)) : process.cwd(), 'esteira-logs');
      if (r.resultado === 'falha') detalharFalhas(get, ctx, r, pastaLogs);
      const md = formatar(r);
      if (o.saida) { fs.mkdirSync(path.dirname(path.resolve(o.saida)), { recursive: true }); fs.writeFileSync(o.saida, md + '\n'); }
      console.log(md);
      return { verde: 0, falha: 1, pendente: 2 }[r.resultado] ?? 3;
    }
    console.error('uso: esteira-pr.mjs pr --branch <branch> | status --pr <id> [--sha <sha>] [--aguardar <min>] [--saida <arquivo.md>]');
    return 3;
  } catch (e) {
    console.error(e instanceof ErroAz ? e.message : (e.stack || String(e)));
    return 3;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
