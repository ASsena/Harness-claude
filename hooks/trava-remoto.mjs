#!/usr/bin/env node
// Trava do harness (PreToolUse):
//   1. Nunca commitar na master nem dar push para a master  -> deny
//   2. Toda alteração no remoto (git push, Azure DevOps, GitHub) -> ask
//      O agente já explicou o motivo no texto antes da chamada; o diálogo de
//      permissão é a pergunta "pode ou não fazer?".
// Leituras (fetch, pull, get/list do Azure DevOps) passam sem perguntar.
// Sem dependências: só Node, que o plugin já exige para o Playwright MCP.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const PROTECTED = new Set(['master', 'main']);

function out(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // entrada ilegível: não decide, segue o fluxo normal de permissão
}

const tool = input.tool_name || '';
const ti = input.tool_input || {};
const cwd = input.cwd || process.cwd();

// ---------------------------------------------------------------------------
// Ferramentas MCP de repositório remoto (Azure DevOps, GitHub)
// ---------------------------------------------------------------------------
const READ_ACTION = /^(get|list|show|query|search|read|download|view)([_-].*)?$/i;
const READ_TOOL = /(^|_)(get|list|show|query|search|read|download|view)(_|$)/i;

if (tool.startsWith('mcp__')) {
  const [, server = '', name = ''] = tool.split('__');
  const isRemoteRepo = /azure|devops|ado|github/i.test(server);
  if (!isRemoteRepo) process.exit(0);

  const action = typeof ti.action === 'string' ? ti.action : '';
  const isRead = action ? READ_ACTION.test(action) : READ_TOOL.test(name);
  if (isRead) process.exit(0);

  // Alteração em PR ou ref apontando para a master: bloqueia de vez.
  const blob = JSON.stringify(ti);
  if (/(push|update_?ref|merge|complete)/i.test(`${name} ${action}`) &&
      /"(target|targetRefName|ref|refName|branch|base)"\s*:\s*"(refs\/heads\/)?(master|main)"/i.test(blob)) {
    out('deny', `Trava do harness: ${tool}${action ? ` (${action})` : ''} alteraria a master diretamente. Isso nunca é feito pelo agente; a master só muda por PR concluído pelo dev.`);
  }

  out('ask', `Alteração no repositório remoto: ${server} › ${name}${action ? ` (${action})` : ''}. ` +
    'O agente precisa ter explicado o motivo logo antes desta chamada. Permitir?');
}

// ---------------------------------------------------------------------------
// Shell (Bash ou PowerShell)
// ---------------------------------------------------------------------------
if (tool !== 'Bash' && tool !== 'PowerShell') process.exit(0);
const command = String(ti.command || '');
if (!command.trim()) process.exit(0);

// Divide em comandos simples (&&, ||, ;, |, quebra de linha) e tokeniza com aspas.
function splitCommands(cmd) {
  return cmd.split(/\s*(?:&&|\|\||;|\||\r?\n)\s*/).filter(Boolean);
}
function tokenize(s) {
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const t = []; let m;
  while ((m = re.exec(s))) t.push(m[1] ?? m[2] ?? m[3]);
  return t;
}

function currentBranch(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  } catch { return ''; }
}

const isProtectedRef = (ref) => {
  const r = ref.replace(/^\+/, '').replace(/^refs\/heads\//, '');
  return PROTECTED.has(r);
};

let dir = cwd;
const asks = [];
// Branch que um checkout/switch anterior NO MESMO comando deixará ativa
// (o hook roda antes de qualquer parte do comando executar).
const pendingBranch = new Map();

for (const raw of splitCommands(command)) {
  const t = tokenize(raw);
  if (!t.length) continue;

  // Acompanha "cd <pasta>" / "Set-Location <pasta>" para saber em que repo o git roda.
  if (/^(cd|Set-Location|sl|pushd)$/i.test(t[0]) && t[1]) {
    dir = path.resolve(dir, t[1].replace(/^~(?=$|[\\/])/, process.env.HOME || process.env.USERPROFILE || '~'));
    continue;
  }

  // ----- git -----
  const gi = t.findIndex((x) => /^git(\.exe)?$/i.test(x));
  if (gi !== -1) {
    let i = gi + 1; let gitDir = dir;
    while (i < t.length && t[i].startsWith('-')) {
      if (t[i] === '-C' && t[i + 1]) { gitDir = path.resolve(dir, t[i + 1]); i += 2; continue; }
      if (t[i] === '-c' && t[i + 1]) { i += 2; continue; }
      i += 1;
    }
    const sub = (t[i] || '').toLowerCase();
    const args = t.slice(i + 1);
    const branch = pendingBranch.get(gitDir) ?? currentBranch(gitDir);

    if (sub === 'checkout' || sub === 'switch') {
      const flagNew = args.findIndex((a) => /^-(b|B|c|C)$/.test(a) || a === '--create' || a === '--force-create');
      const target = flagNew !== -1 ? args[flagNew + 1] : args.find((a) => !a.startsWith('-') && a !== '--');
      if (target && !args.includes('--')) pendingBranch.set(gitDir, target.replace(/^origin\//, ''));
      continue;
    }
    const onProtected = PROTECTED.has(branch);

    // Commit (e o que gera commit) na master
    const commitLike = ['commit', 'merge', 'cherry-pick', 'revert', 'am', 'rebase', 'pull'];
    if (onProtected && commitLike.includes(sub)) {
      const ffOnlyPull = sub === 'pull' && args.includes('--ff-only');
      const abort = args.some((a) => /^--(abort|quit)$/.test(a));
      if (!ffOnlyPull && !abort) {
        out('deny', `Trava do harness: "git ${sub}" com a branch atual "${branch}". Nunca se commita na master. ` +
          'Crie ou troque para a branch da WI (feature/wi-<id>-<slug>) e faça lá.');
      }
    }

    if (sub === 'push') {
      const positional = args.filter((a) => !a.startsWith('-'));
      const refspecs = positional.slice(1); // [remote, ...refspecs]
      const all = args.some((a) => a === '--all' || a === '--mirror');
      const targets = refspecs.map((r) => (r.includes(':') ? r.split(':').pop() : r));
      const deleting = args.includes('--delete') || args.includes('-d') || refspecs.some((r) => r.startsWith(':'));
      const pushesProtected =
        all ||
        targets.some(isProtectedRef) ||
        refspecs.some((r) => /^HEAD$/i.test(r) && onProtected) ||
        (refspecs.length === 0 && onProtected);
      if (pushesProtected) {
        out('deny', `Trava do harness: este push atingiria a master ("${raw.trim()}"). Push para a master nunca é feito pelo agente; ` +
          'a master só muda por PR concluído pelo dev.');
      }
      asks.push(`git push${deleting ? ' (APAGA branch remota)' : ''}: ${raw.trim()}`);
    }
    continue;
  }

  // ----- Azure CLI -----
  if (/^az(\.cmd)?$/i.test(t[0])) {
    const low = t.map((x) => x.toLowerCase());
    if (low[1] === 'rest') {
      const mi = low.findIndex((x) => x === '--method' || x === '-m');
      const method = mi !== -1 ? (low[mi + 1] || 'get') : 'get';
      if (method !== 'get' && method !== 'head') asks.push(`Azure DevOps REST ${method.toUpperCase()}: ${raw.trim()}`);
      continue;
    }
    const verb = low.slice(1).find((x) => !x.startsWith('-') &&
      /^(create|update|delete|remove|add|set|set-vote|complete|abandon|reactivate|run|queue|import|link|unlink|policy|lock|unlock)$/.test(x));
    if (verb && /^(repos|boards|pipelines|devops|artifacts)$/.test(low[1] || '')) {
      asks.push(`Azure CLI (${low[1]} … ${verb}): ${raw.trim()}`);
    }
    continue;
  }

  // ----- GitHub CLI -----
  if (/^gh(\.exe)?$/i.test(t[0])) {
    const low = t.map((x) => x.toLowerCase());
    if (low[1] === 'api') {
      const mi = low.findIndex((x) => x === '-x' || x === '--method');
      const method = mi !== -1 ? low[mi + 1] : (low.some((x) => /^(-f|-F|--field|--raw-field|--input)$/.test(x)) ? 'post' : 'get');
      if (method && method !== 'get') asks.push(`GitHub API ${method.toUpperCase()}: ${raw.trim()}`);
    } else if (/^(create|edit|merge|close|reopen|comment|review|delete|ready|lock|unlock|transfer|archive|sync|upload)$/.test(low[2] || '')) {
      asks.push(`GitHub CLI (${low[1]} ${low[2]}): ${raw.trim()}`);
    }
    continue;
  }

  // ----- HTTP direto para o Azure DevOps / GitHub -----
  if (/(dev\.azure\.com|visualstudio\.com|api\.github\.com)/i.test(raw)) {
    const m = raw.match(/(?:-X|--request|-Method)\s+['"]?(\w+)/i);
    const method = (m ? m[1] : (/\s(-d|--data\S*|-Body)\s/i.test(raw) ? 'POST' : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') asks.push(`HTTP ${method} no remoto: ${raw.trim()}`);
  }
}

if (asks.length) {
  out('ask', `Alteração no repositório remoto:\n- ${asks.join('\n- ')}\n` +
    'O agente precisa ter explicado o motivo logo antes desta chamada. Permitir?');
}
process.exit(0);
