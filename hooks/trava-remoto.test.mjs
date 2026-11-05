// Testes do hook trava-remoto.mjs:  node --test hooks/trava-remoto.test.mjs
// Cria dois repositórios git temporários (um na master, outro numa branch de WI)
// e alimenta o hook com o mesmo JSON que o Claude Code manda no PreToolUse.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'trava-remoto.mjs');
let base, naMaster, naWi;

function repo(dir, branch) {
  fs.mkdirSync(dir, { recursive: true });
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  g('init', '-q', '-b', 'master');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  if (branch !== 'master') g('checkout', '-q', '-b', branch);
}

before(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'trava-'));
  naMaster = path.join(base, 'na-master');
  naWi = path.join(base, 'na-wi');
  repo(naMaster, 'master');
  repo(naWi, 'feature/wi-1-teste');
});
after(() => fs.rmSync(base, { recursive: true, force: true }));

// Devolve 'deny', 'ask' ou 'passa'.
function decide(tool_name, tool_input, cwd = naWi) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  if (!r.stdout.trim()) return 'passa';
  return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
}
const sh = (command, cwd) => decide('Bash', { command }, cwd);

const casos = [
  // [descrição, comando, cwd, esperado]
  ['commit na master', 'git commit -m x', 'master', 'deny'],
  ['commit na branch da WI', 'git commit -m x', 'wi', 'passa'],
  ['merge na master', 'git merge feature/wi-1-teste', 'master', 'deny'],
  ['merge --abort na master', 'git merge --abort', 'master', 'passa'],
  ['pull --ff-only na master', 'git pull --ff-only origin master', 'master', 'passa'],
  ['pull sem --ff-only na master', 'git pull origin master', 'master', 'deny'],
  ['rebase na master', 'git rebase feature/wi-1-teste', 'master', 'deny'],
  ['cherry-pick na master', 'git cherry-pick abc123', 'master', 'deny'],
  ['fetch master:master fora da master', 'git fetch origin master:master', 'wi', 'passa'],
  ['merge da master na branch da WI', 'git merge --no-ff master -m "Merge master"', 'wi', 'passa'],
  ['checkout master e merge no mesmo comando', 'git checkout master && git merge feature/wi-1-teste', 'wi', 'deny'],
  ['switch -c para outra branch e commit', 'git switch -c feature/wi-2 && git commit -m x', 'master', 'passa'],
  ['push da branch da WI', 'git push origin feature/wi-1-teste', 'wi', 'ask'],
  ['push -u HEAD na branch da WI', 'git push -u origin HEAD', 'wi', 'ask'],
  ['push HEAD:master', 'git push origin HEAD:master', 'wi', 'deny'],
  ['push refs/heads/master', 'git push origin feature/wi-1-teste:refs/heads/master', 'wi', 'deny'],
  ['push forçado para a master', 'git push origin +HEAD:master', 'wi', 'deny'],
  ['push --all', 'git push --all origin', 'wi', 'deny'],
  ['push sem refspec na master', 'git push', 'master', 'deny'],
  ['push HEAD estando na master', 'git push origin HEAD', 'master', 'deny'],
  ['apagar branch remota', 'git push origin :feature/wi-1-teste', 'wi', 'ask'],
  ['git status', 'git status --porcelain', 'master', 'passa'],
  ['az repos pr create', 'az repos pr create --title x', 'wi', 'ask'],
  ['az repos pr list', 'az repos pr list', 'wi', 'passa'],
  ['az boards work-item update', 'az boards work-item update --id 1 --state Done', 'wi', 'ask'],
  ['az rest GET', 'az rest --method get --url https://dev.azure.com/o/p/_apis/wit/workitems/1', 'wi', 'passa'],
  ['az rest PATCH', 'az rest --method patch --url https://dev.azure.com/o/p/_apis/wit/workitems/1', 'wi', 'ask'],
  ['gh pr create', 'gh pr create --title x --body y', 'wi', 'ask'],
  ['gh pr view', 'gh pr view 1', 'wi', 'passa'],
  ['gh api GET', 'gh api repos/o/r/pulls', 'wi', 'passa'],
  ['gh api POST com -f', 'gh api repos/o/r/issues -f title=x', 'wi', 'ask'],
  ['gh api -X DELETE', 'gh api -X DELETE repos/o/r/git/refs/heads/x', 'wi', 'ask'],
  ['curl POST no Azure DevOps', 'curl -X POST https://dev.azure.com/o/p/_apis/x', 'wi', 'ask'],
  ['curl GET no Azure DevOps', 'curl https://dev.azure.com/o/p/_apis/x', 'wi', 'passa'],
  ['PowerShell Invoke-RestMethod POST', 'Invoke-RestMethod -Method POST -Uri https://dev.azure.com/o/p/_apis/x', 'wi', 'ask'],
];

for (const [desc, cmd, onde, esperado] of casos) {
  test(`shell: ${desc}`, () => {
    assert.equal(sh(cmd, onde === 'master' ? naMaster : naWi), esperado, cmd);
  });
}

test('shell: git -C aponta para repo na master a partir de outra pasta', () => {
  assert.equal(sh(`git -C "${naMaster}" commit -m x`, naWi), 'deny');
});
test('shell: cd para repo na master e commit', () => {
  assert.equal(sh(`cd "${naMaster}" && git commit -m x`, naWi), 'deny');
});
test('shell: ferramenta PowerShell segue as mesmas regras', () => {
  assert.equal(decide('PowerShell', { command: 'git commit -m x' }, naMaster), 'deny');
});

const mcp = [
  ['Azure DevOps get', 'mcp__azure-devops__wit_work_item', { action: 'get', id: 1 }, 'passa'],
  ['Azure DevOps list_comments', 'mcp__azure-devops__wit_work_item', { action: 'list_comments', workItemId: 1 }, 'passa'],
  ['Azure DevOps update', 'mcp__azure-devops__wit_work_item', { action: 'update', id: 1 }, 'ask'],
  ['Azure DevOps tool de leitura sem action', 'mcp__azure-devops__repo_list_pull_requests_by_repo', { repositoryId: 'r' }, 'passa'],
  ['Azure DevOps criar PR', 'mcp__azure-devops__repo_create_pull_request', { sourceRefName: 'refs/heads/feature/x', targetRefName: 'refs/heads/master' }, 'ask'],
  ['Azure DevOps update_ref na master', 'mcp__azure-devops__repo_update_ref', { refName: 'refs/heads/master' }, 'deny'],
  ['Azure DevOps completar PR com alvo master no input', 'mcp__azure-devops__repo_update_pull_request', { action: 'complete', targetRefName: 'refs/heads/master' }, 'deny'],
  ['GitHub merge sem alvo no input', 'mcp__github__merge_pull_request', { pullNumber: 1 }, 'ask'],
  ['GitHub get_file_contents', 'mcp__github__get_file_contents', { path: 'x' }, 'passa'],
  ['MCP que não é de repositório', 'mcp__plugin_harness_playwright__browser_click', { ref: 'x' }, 'passa'],
];
for (const [desc, tool, input, esperado] of mcp) {
  test(`mcp: ${desc}`, () => assert.equal(decide(tool, input), esperado));
}

test('outras ferramentas passam', () => {
  assert.equal(decide('Read', { file_path: 'x' }), 'passa');
  assert.equal(decide('Write', { file_path: '.claude/settings.json', content: '{}' }), 'passa');
});
