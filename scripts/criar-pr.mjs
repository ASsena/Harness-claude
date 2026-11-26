#!/usr/bin/env node
// Cria o PR da WI no Azure DevOps — ESCREVE NO REMOTO. Só roda com a permissão do dev
// (pedido remoto-P<n>.md); o hook trava-remoto pergunta antes de cada execução.
//
//   node criar-pr.mjs --corpo <pr-body.json> --descricao <pr-descricao.md> [--saida <pr-criado.json>]
//
// Segue o CLAUDE.md do repositório: uma única chamada `fetch` com o token de
// `az account get-access-token`, corpo JSON UTF-8 que já leva título, descrição completa e
// `workItemRefs`, e conferência lendo o PR de volta com o mesmo `fetch`. A descrição nasce
// completa porque o bot "Complemento IA" escreve nela logo depois da criação: editar depois mexe
// em texto alheio.
//
// --corpo: JSON com sourceRefName, targetRefName, title, workItemRefs e, opcional, isDraft.
//          Recusa qualquer outro campo (auto-complete, conclusão, revisores, status...).
// --descricao: Markdown da descrição (até 4000 caracteres — limite do Azure DevOps).
//
// Já existe PR ativo para a branch: não cria nada e informa o id.
// Saída: primeira linha `pr: <id>`. Código: 0 criado e conferido (ou já existia) · 1 criado, mas a
// conferência divergiu · 3 erro (corpo inválido, sem token/acesso, recusa do servidor).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { contexto, criarCliente, lerOpcoes, ErroAdo } from './ado.mjs';

const V = 'api-version=7.1';
const PERMITIDOS = new Set(['sourceRefName', 'targetRefName', 'title', 'workItemRefs', 'isDraft']);
const ALVOS = new Set(['refs/heads/master', 'refs/heads/main']);
const ler = (p) => fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
const norm = (s) => String(s || '').replace(/\r\n/g, '\n').trim();

export function montarCorpo(corpoTxt, descricaoTxt) {
  let c;
  try { c = JSON.parse(corpoTxt); } catch (e) { throw new ErroAdo(`--corpo não é JSON válido: ${e.message}`); }
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new ErroAdo('--corpo precisa ser um objeto JSON.');
  const extras = Object.keys(c).filter((k) => !PERMITIDOS.has(k));
  if (extras.length) throw new ErroAdo(`--corpo tem campos que este script não envia: ${extras.join(', ')}. ` +
    'Auto-complete, conclusão, revisores e status do PR são do dev.');
  if (!/^refs\/heads\/./.test(c.sourceRefName || '') || ALVOS.has(c.sourceRefName)) throw new ErroAdo('sourceRefName precisa ser refs/heads/<branch da WI> (nunca a master).');
  if (!ALVOS.has(c.targetRefName)) throw new ErroAdo('targetRefName precisa ser refs/heads/master (ou main).');
  if (!String(c.title || '').trim()) throw new ErroAdo('title vazio.');
  if (c.title.length > 400) throw new ErroAdo('title passa de 400 caracteres.');
  if (c.isDraft !== undefined && typeof c.isDraft !== 'boolean') throw new ErroAdo('isDraft precisa ser true ou false.');
  if (!Array.isArray(c.workItemRefs) || !c.workItemRefs.length || c.workItemRefs.some((w) => !/^\d+$/.test(String(w?.id ?? '')))) {
    throw new ErroAdo('workItemRefs precisa listar a WI: [{"id":"<número>"}].');
  }
  const descricao = norm(descricaoTxt);
  if (!descricao) throw new ErroAdo('--descricao vazia: o PR nasce com a descrição completa.');
  if (descricao.length > 4000) throw new ErroAdo(`--descricao tem ${descricao.length} caracteres; o limite do Azure DevOps é 4000.`);
  return { ...c, workItemRefs: c.workItemRefs.map((w) => ({ id: String(w.id) })), description: descricao };
}

export async function criar(api, ctx, corpo) {
  const repo = `/_apis/git/repositories/${ctx.repo}`;
  const ativos = (await api.get(`${repo}/pullrequests?searchCriteria.sourceRefName=${corpo.sourceRefName}&searchCriteria.status=active&${V}`))?.value || [];
  if (ativos.length) return { existente: true, id: ativos[0].pullRequestId, url: api.webPr(ativos[0].pullRequestId), alvo: ativos[0].targetRefName, conferencias: [] };

  const novo = await api.post(`${repo}/pullrequests?${V}`, corpo);
  const id = novo?.pullRequestId;
  if (!id) throw new ErroAdo('O Azure DevOps não devolveu o id do PR criado.');

  // Conferência com o mesmo fetch: o que ficou gravado é o que foi pedido.
  const lido = await api.get(`${repo}/pullrequests/${id}?${V}`);
  const wis = (await api.get(`${repo}/pullRequests/${id}/workitems?${V}`))?.value || [];
  const ids = new Set(wis.map((w) => String(w.id)));
  const conferencias = [
    ['alvo', lido?.targetRefName === corpo.targetRefName, lido?.targetRefName],
    ['fonte', lido?.sourceRefName === corpo.sourceRefName, lido?.sourceRefName],
    ['título', norm(lido?.title) === norm(corpo.title), lido?.title],
    // O bot "Complemento IA" pode já ter acrescentado a seção dele: o texto do autor vem primeiro.
    ['descrição', norm(lido?.description).startsWith(norm(corpo.description).slice(0, 3900)), `${norm(lido?.description).length} caracteres`],
    ['WI vinculada', corpo.workItemRefs.every((w) => ids.has(w.id)), [...ids].join(', ') || 'nenhuma'],
    ['auto-complete desligado', !lido?.autoCompleteSetBy, lido?.autoCompleteSetBy ? 'LIGADO' : 'desligado'],
  ];
  return { existente: false, id, url: api.webPr(id), alvo: lido?.targetRefName, conferencias };
}

export async function main(argv) {
  const o = lerOpcoes(argv);
  try {
    if (!o.corpo || o.corpo === true || !o.descricao || o.descricao === true) {
      console.error('uso: criar-pr.mjs --corpo <pr-body.json> --descricao <pr-descricao.md> [--saida <pr-criado.json>]');
      return 3;
    }
    const corpo = montarCorpo(ler(o.corpo), ler(o.descricao));
    const ctx = contexto(o);
    const api = criarCliente(ctx);
    const r = await criar(api, ctx, corpo);
    console.log(`pr: ${r.id}`);
    console.log(r.existente ? `- já existia PR ativo para ${corpo.sourceRefName} → ${r.alvo}; nada foi criado` : `- criado: ${r.url}`);
    for (const [nome, ok, valor] of r.conferencias) console.log(`${ok ? 'OK   ' : 'FALHA'} ${nome}: ${valor}`);
    if (o.saida && o.saida !== true) {
      fs.mkdirSync(path.dirname(path.resolve(o.saida)), { recursive: true });
      fs.writeFileSync(o.saida, JSON.stringify({ pullRequestId: r.id, url: r.url, existente: r.existente,
        conferencias: r.conferencias.map(([nome, ok, valor]) => ({ nome, ok, valor })) }, null, 2) + '\n');
    }
    return r.conferencias.every(([, ok]) => ok) ? 0 : 1;
  } catch (e) {
    console.error(e instanceof ErroAdo ? e.message : (e.stack || String(e)));
    return 3;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
