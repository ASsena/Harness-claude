#!/usr/bin/env node
// Confere a entrega do preparo (plan-task-agent) antes da execução (pipeline-agent).
//
//   node conferir-entrega.mjs --workdir tmp/pipeline/wi-<id> [--retomada]
//
// Lê o cabeçalho `chave: valor` do estado.md, o preflight.md e o plano, e confere
// com o git. Imprime uma linha por conferência (OK / FALHA / INFO) e sai com
// código 1 se alguma falhar. Rode na raiz do repositório.
//
// --retomada: execução já começou (estado "em execução" / "execução parada"):
// aceita esses estados e não exige árvore limpa nem HEAD igual ao do preparo —
// lista os arquivos alterados para o agente comparar com os impl-*.md.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i !== -1 ? argv[i + 1] : undefined; };
const workdir = opt('workdir');
const retomada = argv.includes('--retomada');
if (!workdir) { console.error('uso: conferir-entrega.mjs --workdir tmp/pipeline/wi-<id> [--retomada]'); process.exit(2); }

const PROTECTED = new Set(['master', 'main']);
const SETTINGS = '.claude/settings.json';
const results = [];
const ok = (nome, det) => results.push(['OK', nome, det]);
const falha = (nome, det) => results.push(['FALHA', nome, det]);
const info = (nome, det) => results.push(['INFO', nome, det]);

function git(args, { quiet = false } = {}) {
  try {
    return { code: 0, out: execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\s+$/, '') };
  } catch (e) {
    if (!quiet) return { code: e.status ?? 1, out: String(e.stdout || ''), err: String(e.stderr || '') };
    return { code: e.status ?? 1, out: '' };
  }
}

function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

// ---- estado.md: cabeçalho "chave: valor" (para na primeira linha que não casa, depois do bloco)
const estadoTxt = readText(path.join(workdir, 'estado.md'));
const estado = {};
if (estadoTxt === null) {
  falha('estado.md', `não existe em ${workdir} — a WI não foi preparada (plan-task-agent).`);
} else {
  for (const line of estadoTxt.split(/\r?\n/)) {
    const m = line.match(/^\s*([a-z_]+)\s*:\s*(.*?)\s*$/i);
    if (m && !(m[1].toLowerCase() in estado)) estado[m[1].toLowerCase()] = m[2].replace(/^`|`$/g, '');
  }
}

const need = ['estado', 'branch', 'plano', 'sha_base', 'sha_plano', 'portao_plano'];
const faltando = need.filter((k) => !estado[k]);
if (estadoTxt !== null && faltando.length) falha('cabeçalho do estado.md', `faltam as chaves: ${faltando.join(', ')}`);

// 1. Estado
if (estado.estado) {
  const e = estado.estado.toLowerCase();
  const aceitos = retomada ? ['pronto para execução', 'em execução', 'execução parada'] : ['pronto para execução'];
  if (aceitos.some((a) => e.startsWith(a))) ok('estado', estado.estado);
  else falha('estado', `"${estado.estado}" — esperado: ${aceitos.join(' | ')}`);
}

// 2. Portões
const plano = estado.plano;
const planoTxt = plano ? readText(plano) : null;
if (plano && planoTxt === null) falha('plano', `${plano} não existe na árvore.`);
const visualRef = planoTxt ? /^visual_reference\s*:/m.test(planoTxt.split(/^---\s*$/m)[1] || '') : false;
if (estado.portao_plano) {
  if (/^aprovado/i.test(estado.portao_plano)) ok('portão do plano', estado.portao_plano);
  else falha('portão do plano', `"${estado.portao_plano}" — sem aprovação registrada.`);
}
if (visualRef) {
  if (/^aprovado/i.test(estado.portao_mockup || '')) ok('portão do mockup', estado.portao_mockup);
  else falha('portão do mockup', 'o plano tem visual_reference, mas o estado.md não registra a aprovação do mockup.');
}

// 3. Branch
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out;
if (PROTECTED.has(branch)) falha('branch', `em checkout na ${branch} — a execução nunca roda na master.`);
else if (estado.branch && branch !== estado.branch) falha('branch', `atual "${branch}", registrada "${estado.branch}".`);
else if (estado.branch) ok('branch', branch);

// 4. Plano intacto desde o commit do plano
if (plano && estado.sha_plano) {
  const r = git(['diff', '--quiet', estado.sha_plano, 'HEAD', '--', plano], { quiet: true });
  const dirty = git(['status', '--porcelain', '--', plano]).out;
  if (r.code === 0 && !dirty) ok('plano intacto', `igual ao commit ${estado.sha_plano.slice(0, 10)}`);
  else falha('plano intacto', `o plano mudou depois do commit ${estado.sha_plano.slice(0, 10)} — rode o preparo em modo revalidar.`);
}

// 5. SHA-base coerente: estado.md = preflight.md = manifesto do plano
if (estado.sha_base) {
  const pre = readText(path.join(workdir, 'preflight.md'));
  const preSha = pre && (pre.match(/SHA-base[^0-9a-f]*([0-9a-f]{7,40})/i) || [])[1];
  const prefix = (a, b) => a && b && (a.startsWith(b) || b.startsWith(a));
  if (!pre) falha('preflight.md', 'não existe.');
  else if (!prefix(preSha, estado.sha_base)) falha('SHA-base', `estado.md ${estado.sha_base.slice(0, 10)} × preflight.md ${preSha ? preSha.slice(0, 10) : '(ausente)'}.`);
  else if (planoTxt && !planoTxt.includes(estado.sha_base.slice(0, 7))) falha('SHA-base', `o manifesto do plano não cita ${estado.sha_base.slice(0, 10)}.`);
  else ok('SHA-base', `${estado.sha_base.slice(0, 10)} (estado, preflight e manifesto)`);
  if (estado.sha_plano) {
    const between = git(['diff', '--name-only', estado.sha_base, estado.sha_plano]).out.split('\n').filter(Boolean);
    const fora = between.filter((f) => !f.startsWith('.cursor/plans/'));
    if (fora.length) falha('commit do plano', `entre o SHA-base e o commit do plano há arquivos fora de .cursor/plans/: ${fora.join(', ')}`);
  }
}

// 6. HEAD e árvore
const head = git(['rev-parse', 'HEAD']).out;
const porcelain = git(['status', '--porcelain']).out.split('\n').filter(Boolean)
  .filter((l) => l.slice(3).replace(/^"|"$/g, '') !== SETTINGS);
if (!retomada) {
  if (estado.sha_plano && !head.startsWith(estado.sha_plano) && !estado.sha_plano.startsWith(head)) {
    falha('HEAD', `atual ${head.slice(0, 10)}, preparo terminou em ${estado.sha_plano.slice(0, 10)} — a branch andou: revalidar ou executar assim mesmo é decisão do dev.`);
  } else if (estado.sha_plano) ok('HEAD', head.slice(0, 10));
  if (porcelain.length) falha('árvore', `mudanças locais (fora ${SETTINGS}): ${porcelain.map((l) => l.trim()).join('; ')}`);
  else ok('árvore', `limpa (fora ${SETTINGS})`);
} else {
  info('HEAD', `${head.slice(0, 10)}${estado.sha_plano && !head.startsWith(estado.sha_plano) ? ` (preparo terminou em ${estado.sha_plano.slice(0, 10)})` : ''}`);
  info('alterados', porcelain.length ? porcelain.map((l) => l.trim()).join('; ') : 'nenhum');
}

// 7. Trava de platform/** — só informa; quem libera e restaura é o dev
let trava = 'desconhecida';
try {
  const deny = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))?.permissions?.deny || [];
  trava = ['Edit(platform/**)', 'Write(platform/**)'].every((r) => deny.includes(r)) ? 'ativa' : 'liberada';
} catch { /* sem settings ou JSON inválido */ }
info('trava platform/**', trava);
if (trava !== 'desconhecida') {
  const staged = git(['diff', '--cached', '--name-only']).out.split('\n');
  if (staged.includes(SETTINGS)) falha('stage', `${SETTINGS} está em stage — tire do stage (git restore --staged ${SETTINGS}).`);
}

for (const [s, n, d] of results) console.log(`${s.padEnd(5)} ${n}: ${d}`);
const falhou = results.some(([s]) => s === 'FALHA');
console.log(falhou ? '\nResultado: FALHA' : '\nResultado: OK');
process.exit(falhou ? 1 : 0);
