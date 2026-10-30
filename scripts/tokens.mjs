#!/usr/bin/env node
// Medidor de tokens do pipeline.
//
//   node tokens.mjs hook                      (SubagentStop / SessionEnd — lê o JSON do hook no stdin)
//   node tokens.mjs resumo --workdir <pasta>  (totais do run por fase e por agente)
//
// Grava em ~/.claude/brixbroker/pipeline-tokens.csv (separador ;, UTF-8 com BOM):
//   run_id;wi;quando;fase;agente;agent_id;modelo;chamadas;input;cache_escrita;cache_leitura;output;contexto_total
// "contexto_total" = input + cache_escrita + cache_leitura: o que foi re-enviado ao modelo.
//
// Só registra quando há um run do pipeline ativo em <cwd>/tmp/pipeline/wi-*/.fases
// (o cronômetro do log-fase.ps1). Fora do pipeline, o hook não faz nada.
// Nunca bloqueia: qualquer erro sai com código 0 e sem saída.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CSV = path.join(os.homedir(), '.claude', 'brixbroker', 'pipeline-tokens.csv');
const HEADER = 'run_id;wi;quando;fase;agente;agent_id;modelo;chamadas;input;cache_escrita;cache_leitura;output;contexto_total';
const RECENT_MS = 6 * 60 * 60 * 1000; // run recém-encerrado ainda recebe o total da thread principal

const clean = (s) => String(s ?? '').replace(/;/g, ',').replace(/[\r\n]+/g, ' ').trim();

// Soma o uso de um transcript, uma vez por mensagem (a mesma mensagem aparece em várias linhas).
function sumTranscript(file) {
  const byModel = new Map();
  const seen = new Set();
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return byModel; }
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== 'assistant') continue;
    const m = o.message || {};
    const u = m.usage; if (!u) continue;
    const id = m.id || o.uuid;
    if (seen.has(id)) continue; seen.add(id);
    const k = m.model || '?';
    const acc = byModel.get(k) || { chamadas: 0, input: 0, cw: 0, cr: 0, output: 0 };
    acc.chamadas += 1;
    acc.input += u.input_tokens || 0;
    acc.cw += u.cache_creation_input_tokens || 0;
    acc.cr += u.cache_read_input_tokens || 0;
    acc.output += u.output_tokens || 0;
    byModel.set(k, acc);
  }
  return byModel;
}

// Run ativo: o _run-id mais recente em tmp/pipeline/wi-*/.fases; senão um _ultimo-run recente.
function findRun(cwd) {
  const base = path.join(cwd, 'tmp', 'pipeline');
  let best = null;
  let dirs = [];
  try { dirs = fs.readdirSync(base).filter((d) => d.startsWith('wi-')); } catch { return null; }
  for (const d of dirs) {
    const fases = path.join(base, d, '.fases');
    for (const [file, active] of [['_run-id', true], ['_ultimo-run', false]]) {
      const p = path.join(fases, file);
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (!active && Date.now() - st.mtimeMs > RECENT_MS) continue;
      const cand = { fases, active, mtime: st.mtimeMs, runId: fs.readFileSync(p, 'utf8').trim() };
      if (!best || (cand.active && !best.active) || (cand.active === best.active && cand.mtime > best.mtime)) best = cand;
    }
  }
  if (!best) return null;
  let wi = ''; try { wi = fs.readFileSync(path.join(best.fases, '_wi'), 'utf8').trim(); } catch { /* sem wi */ }
  // Fase aberta mais recente = onde o trabalho estava.
  let fase = '';
  try {
    const open = fs.readdirSync(best.fases).filter((f) => f.endsWith('.txt')).map((f) => {
      const [start, , name] = fs.readFileSync(path.join(best.fases, f), 'utf8').trim().split('|');
      return { start, name };
    }).filter((x) => x.name !== 'pipeline').sort((a, b) => (a.start < b.start ? 1 : -1));
    fase = open[0]?.name || '';
  } catch { /* sem fase */ }
  return { ...best, wi, fase };
}

function readCsvRows() {
  try {
    return fs.readFileSync(CSV, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(';'));
  } catch { return []; }
}

function append(rows) {
  fs.mkdirSync(path.dirname(CSV), { recursive: true });
  if (!fs.existsSync(CSV)) fs.writeFileSync(CSV, '﻿' + HEADER + '\r\n');
  fs.appendFileSync(CSV, rows.map((r) => r.map(clean).join(';')).join('\r\n') + '\r\n');
}

// O transcript do subagente ainda está sendo gravado quando o SubagentStop dispara.
// O hook devolve na hora e um processo destacado espera o arquivo estabilizar.
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function waitStable(file, maxMs = 90000) {
  const t0 = Date.now(); let last = -1; let stableSince = 0;
  while (Date.now() - t0 < maxMs) {
    let size = -1; try { size = fs.statSync(file).size; } catch { /* ainda não existe */ }
    if (size > 0 && size === last) { if (!stableSince) stableSince = Date.now(); if (Date.now() - stableSince >= 3000) return; }
    else stableSince = 0;
    last = size; sleep(500);
  }
}

function hook() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { return; }
  hookFrom(raw);
}

function hookFrom(raw) {
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  if (process.env.HARNESS_TOKENS_DEBUG) { try { fs.appendFileSync(process.env.HARNESS_TOKENS_DEBUG, raw + '\n'); } catch { /* debug opcional */ } }
  const run = findRun(input.cwd || process.cwd());
  if (!run) return;

  const ev = input.hook_event_name;
  if (ev === 'SubagentStop' && process.argv[3] !== '--adiado') {
    const tmp = path.join(os.tmpdir(), `harness-tokens-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(input));
    spawn(process.execPath, [process.argv[1], 'adiado', tmp], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return;
  }
  if (ev === 'SubagentStop') waitStable(input.agent_transcript_path);
  let file, agente, agentId, fase = run.fase;
  if (ev === 'SubagentStop') {
    file = input.agent_transcript_path;
    agente = input.agent_type || 'subagente';
    agentId = input.agent_id || '';
  } else if (ev === 'SessionEnd') {
    file = input.transcript_path;
    agente = 'thread-principal';
    agentId = `${input.session_id || ''}`;
    fase = `sessão (${input.reason || 'fim'})`;
  } else return;
  if (!file) return;

  const totals = sumTranscript(file);
  // Sessão retomada (--continue) re-soma o transcript inteiro: registra só o que ainda não entrou.
  const prev = new Map();
  for (const r of readCsvRows()) {
    if (r[5] === agentId && r[4] === agente) {
      const p = prev.get(r[6]) || [0, 0, 0, 0, 0];
      [7, 8, 9, 10, 11].forEach((c, i) => { p[i] += Number(r[c]) || 0; });
      prev.set(r[6], p);
    }
  }
  const quando = new Date().toISOString();
  const rows = [];
  for (const [model, a] of totals) {
    const p = prev.get(model) || [0, 0, 0, 0, 0];
    const d = [a.chamadas - p[0], a.input - p[1], a.cw - p[2], a.cr - p[3], a.output - p[4]];
    if (d.every((x) => x <= 0)) continue;
    rows.push([run.runId, run.wi, quando, fase, agente, agentId, model, ...d, d[1] + d[2] + d[3]]);
  }
  if (rows.length) append(rows);
}

function adiado() {
  const tmp = process.argv[3];
  let raw; try { raw = fs.readFileSync(tmp, 'utf8'); fs.unlinkSync(tmp); } catch { return; }
  process.argv[3] = '--adiado';
  hookFrom(raw);
}

function resumo() {
  const i = process.argv.indexOf('--workdir');
  const wd = i !== -1 ? process.argv[i + 1] : null;
  if (!wd) { console.error('uso: resumo --workdir tmp/pipeline/wi-<id>'); process.exit(1); }
  const fases = path.join(wd, '.fases');
  let runId = '';
  for (const f of ['_run-id', '_ultimo-run']) { try { runId = fs.readFileSync(path.join(fases, f), 'utf8').trim(); break; } catch { /* tenta o próximo */ } }
  if (!runId) { console.log('Sem run registrado nesta pasta.'); return; }
  const rows = readCsvRows().filter((r) => r[0] === runId);
  if (!rows.length) { console.log(`Run ${runId}: nenhum token registrado ainda.`); return; }
  const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  const group = (keyFn) => {
    const m = new Map();
    for (const r of rows) {
      const key = keyFn(r);
      const a = m.get(key) || { ctx: 0, out: 0, n: 0 };
      a.ctx += Number(r[12]) || 0; a.out += Number(r[11]) || 0; a.n += Number(r[7]) || 0;
      m.set(key, a);
    }
    return [...m].sort((x, y) => y[1].ctx - x[1].ctx);
  };
  const total = rows.reduce((s, r) => s + (Number(r[12]) || 0), 0);
  console.log(`Tokens do run ${runId} (contexto enviado / saída / chamadas):`);
  console.log('\nPor agente e modelo:');
  for (const [key, a] of group((r) => `${r[4]} [${r[6]}]`)) console.log(`  ${key.padEnd(52)} ${k(a.ctx).padStart(7)} / ${k(a.out).padStart(6)} / ${a.n} (${((a.ctx / total) * 100).toFixed(0)}%)`);
  console.log('\nPor fase:');
  for (const [key, a] of group((r) => r[3] || '(sem fase)')) console.log(`  ${key.padEnd(52)} ${k(a.ctx).padStart(7)} / ${k(a.out).padStart(6)} / ${a.n}`);
  console.log(`\nTotal de contexto enviado: ${k(total)}. CSV: ${CSV}`);
}

try {
  if (process.argv[2] === 'hook') hook();
  else if (process.argv[2] === 'adiado') adiado();
  else if (process.argv[2] === 'resumo') resumo();
  else console.error('uso: tokens.mjs hook | resumo --workdir <pasta>');
} catch { /* nunca bloqueia */ }
process.exit(0);
