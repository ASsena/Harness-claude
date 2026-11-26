// Testes do esteira-pr.mjs:  node --test scripts/esteira-pr.test.mjs
// Um `az` falso responde às URLs com fixtures (ESTEIRA_AZ aponta para ele); nada sai da máquina.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRemote } from './esteira-pr.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'esteira-pr.mjs');
const CTX = ['--org', 'org', '--projeto', 'proj', '--repo', 'repo'];
const SHA = 'abc1234567890';
let base, fakeAz;

before(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'esteira-teste-'));
  fakeAz = path.join(base, 'fake-az.mjs');
  // Cada rota tem uma lista de corpos; cada chamada consome o próximo (o último se repete).
  fs.writeFileSync(fakeAz, `#!/usr/bin/env node
import fs from 'node:fs';
const a = process.argv.slice(2);
const url = a[a.indexOf('--url') + 1], out = a[a.indexOf('--output-file') + 1];
if (a[a.indexOf('--method') + 1] !== 'get') { console.error('só GET'); process.exit(9); }
const rotas = JSON.parse(fs.readFileSync(process.env.FAKE_ROTAS, 'utf8'));
const cont = fs.existsSync(process.env.FAKE_ROTAS + '.n') ? JSON.parse(fs.readFileSync(process.env.FAKE_ROTAS + '.n', 'utf8')) : {};
const i = rotas.findIndex((r) => new RegExp(r.re).test(url));
if (i === -1) { console.error('sem rota: ' + url); process.exit(1); }
const n = cont[i] || 0; cont[i] = n + 1;
fs.writeFileSync(process.env.FAKE_ROTAS + '.n', JSON.stringify(cont));
const c = rotas[i].corpos[Math.min(n, rotas[i].corpos.length - 1)];
if (c === '__ERRO__') { console.error('ERROR: Please run az login'); process.exit(1); }
fs.writeFileSync(out, typeof c === 'string' ? c : JSON.stringify(c));
`);
  fs.chmodSync(fakeAz, 0o755);
});
after(() => fs.rmSync(base, { recursive: true, force: true }));

function rodar(args, rotas) {
  const dir = fs.mkdtempSync(path.join(base, 'caso-'));
  const arq = path.join(dir, 'rotas.json');
  fs.writeFileSync(arq, JSON.stringify(rotas));
  const r = spawnSync(process.execPath, [SCRIPT, ...args, ...CTX], {
    encoding: 'utf8', cwd: dir, env: { ...process.env, ESTEIRA_AZ: fakeAz, FAKE_ROTAS: arq },
  });
  return { code: r.status, out: r.stdout, err: r.stderr, dir };
}

const pr = (extra = {}) => ({
  pullRequestId: 7, title: 'WI 1: teste', status: 'active', mergeStatus: 'succeeded',
  sourceRefName: 'refs/heads/feature/wi-1-teste', targetRefName: 'refs/heads/master',
  lastMergeSourceCommit: { commitId: SHA }, lastMergeCommit: { commitId: 'mmm999' },
  repository: { project: { id: 'p-guid' } }, ...extra,
});
const evBuild = (status, buildId, extra = {}) => ({
  status, configuration: { isEnabled: true, isBlocking: true, type: { displayName: 'Build' }, settings: { buildDefinitionId: 11, displayName: 'CI backend' } },
  context: { buildId, ...extra },
});
const evRevisores = { status: 'queued', configuration: { isEnabled: true, isBlocking: true, type: { displayName: 'Minimum number of reviewers' }, settings: {} } };
const build = (id, status, result, sha = SHA) => ({ id, buildNumber: `2026.${id}`, status, result, definition: { id: 11, name: 'CI backend' }, triggerInfo: { 'pr.sourceSha': sha }, sourceVersion: 'mmm999', _links: { web: { href: `https://x/build/${id}` } } });
const base_ = (evals, extra = []) => [
  { re: '/pullrequests/7\\?', corpos: [pr()] },
  { re: '/policy/evaluations', corpos: [{ value: evals }] },
  { re: '/pullRequests/7/iterations', corpos: [{ value: [{ id: 1 }, { id: 2 }] }] },
  { re: '/pullRequests/7/statuses', corpos: [{ value: [] }] },
  ...extra,
];

test('parseRemote reconhece os formatos do Azure DevOps', () => {
  assert.deepEqual(parseRemote('https://confitecDevOps@dev.azure.com/confitecDevOps/brixbroker/_git/brixbroker'), { org: 'confitecDevOps', projeto: 'brixbroker', repo: 'brixbroker' });
  assert.deepEqual(parseRemote('https://org.visualstudio.com/DefaultCollection/proj/_git/repo'), { org: 'org', projeto: 'proj', repo: 'repo' });
  assert.deepEqual(parseRemote('git@ssh.dev.azure.com:v3/org/proj/repo'), { org: 'org', projeto: 'proj', repo: 'repo' });
  assert.equal(parseRemote('https://github.com/o/r.git'), null);
});

test('pr: acha o PR ativo da branch', () => {
  const r = rodar(['pr', '--branch', 'feature/wi-1-teste'], [{ re: 'searchCriteria.sourceRefName=refs/heads/feature/wi-1-teste&', corpos: [{ value: [pr()] }] }]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^pr: 7$/m);
});

test('pr: nenhum PR ativo', () => {
  const r = rodar(['pr', '--branch', 'feature/x'], [{ re: 'pullrequests\\?', corpos: [{ value: [] }] }]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^pr: nenhum$/m);
});

test('status verde: build aprovada do SHA; revisores ficam com o dev e não seguram o resultado', () => {
  const r = rodar(['status', '--pr', '7', '--sha', SHA], base_([evBuild('approved', 101), evRevisores], [
    { re: '/build/builds/101\\?', corpos: [build(101, 'completed', 'succeeded')] },
  ]));
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /RESULTADO: verde/);
  assert.match(r.out, /do dev/);
});

test('status pendente: o PR ainda não recebeu o push', () => {
  const r = rodar(['status', '--pr', '7', '--sha', 'fff000'], base_([evBuild('approved', 101)]));
  assert.equal(r.code, 2);
  assert.match(r.out, /ainda não chegou/);
});

test('status pendente: a build aprovada é de outro commit', () => {
  const r = rodar(['status', '--pr', '7', '--sha', SHA], base_([evBuild('approved', 100)], [
    { re: '/build/builds/100\\?', corpos: [build(100, 'completed', 'succeeded', 'velho111')] },
  ]));
  assert.equal(r.code, 2);
  assert.match(r.out, /outro commit/);
});

test('status com --aguardar: rodando e depois verde', () => {
  const r = rodar(['status', '--pr', '7', '--sha', SHA, '--aguardar', '1', '--intervalo', '0'], base_([evBuild('running', 101)], [
    { re: '/build/builds/101\\?', corpos: [build(101, 'inProgress', null), build(101, 'completed', 'succeeded')] },
  ]));
  assert.equal(r.code, 0, r.out + r.err);
});

test('status falha: etapa, trecho do log, testes vermelhos e master também vermelha', () => {
  const log = ['2026-11-26T10:00:00.0000000Z Building...', 'src/Foo.cs(12,5): error CS0103: The name x does not exist', '##[error]Process completed with exit code 1.'].join('\n');
  const r = rodar(['status', '--pr', '7', '--sha', SHA, '--saida', 'saida/esteira-C1.md'], base_([evBuild('rejected', 101)], [
    { re: '/build/builds/101\\?', corpos: [build(101, 'completed', 'failed')] },
    { re: '/build/builds/101/timeline', corpos: [{ records: [
      { id: 'j1', type: 'Job', name: 'Backend', result: 'failed' },
      { id: 't1', parentId: 'j1', type: 'Task', name: 'dotnet build', result: 'failed', log: { id: 23 }, issues: [{ type: 'error', message: 'error CS0103: The name x does not exist' }] },
      { id: 't2', parentId: 'j1', type: 'Task', name: 'checkout', result: 'succeeded' },
    ] }] },
    { re: '/build/builds/101/logs/23', corpos: [log] },
    { re: '/test/runs\\?buildUri', corpos: [{ value: [{ id: 5, totalTests: 10, passedTests: 9 }] }] },
    { re: '/test/Runs/5/results', corpos: [{ value: [{ automatedTestName: 'Insurtech.Unit.Tests.FooTests.Bar', automatedTestStorage: 'Insurtech.Unit.Tests.dll', errorMessage: 'Expected 1 but was 2' }] }] },
    { re: 'branchName=refs/heads/master', corpos: [{ value: [{ id: 90, buildNumber: '2026.90', result: 'failed' }] }] },
  ]));
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /Etapa: Backend › dotnet build/);
  assert.doesNotMatch(r.out, /Etapa: Backend \(/, 'o job não se repete quando a tarefa filha já explica a falha');
  assert.match(r.out, /error CS0103/);
  assert.match(r.out, /FooTests\.Bar/);
  assert.match(r.out, /também vermelha na master/);
  assert.match(r.out, /Suspeita de infraestrutura: não/);
  assert.ok(fs.existsSync(path.join(r.dir, 'saida', 'esteira-C1.md')));
  assert.ok(fs.existsSync(path.join(r.dir, 'saida', 'esteira-logs', 'build-101-log-23.txt')));
});

test('status falha de infraestrutura: agente perdido', () => {
  const r = rodar(['status', '--pr', '7', '--sha', SHA], base_([evBuild('rejected', 101)], [
    { re: '/build/builds/101\\?', corpos: [build(101, 'completed', 'failed')] },
    { re: '/build/builds/101/timeline', corpos: [{ records: [
      { id: 'j1', type: 'Job', name: 'Backend', result: 'failed', issues: [{ type: 'error', message: 'We stopped hearing from agent Hosted Agent. Lost communication with the server.' }] },
    ] }] },
    { re: '/test/runs\\?buildUri', corpos: [{ value: [] }] },
    { re: 'branchName=refs/heads/master', corpos: [{ value: [{ id: 90, result: 'succeeded' }] }] },
  ]));
  assert.equal(r.code, 1);
  assert.match(r.out, /Suspeita de infraestrutura: \*\*sim\*\*/);
});

test('status falha: conflito com a master', () => {
  const rotas = base_([evBuild('approved', 101)], [{ re: '/build/builds/101\\?', corpos: [build(101, 'completed', 'succeeded')] }]);
  rotas[0].corpos = [pr({ mergeStatus: 'conflicts' })];
  const r = rodar(['status', '--pr', '7', '--sha', SHA], rotas);
  assert.equal(r.code, 1);
  assert.match(r.out, /conflito com a master/);
});

test('status ignora status de iteração antiga e usa o último por contexto', () => {
  const rotas = base_([evBuild('approved', 101)], [{ re: '/build/builds/101\\?', corpos: [build(101, 'completed', 'succeeded')] }]);
  rotas[3].corpos = [{ value: [
    { id: 1, iterationId: 1, state: 'failed', context: { genre: 'sonar', name: 'quality-gate' } },
    { id: 2, iterationId: 2, state: 'pending', context: { genre: 'sonar', name: 'quality-gate' } },
    { id: 3, iterationId: 2, state: 'succeeded', context: { genre: 'sonar', name: 'quality-gate' } },
  ] }];
  const r = rodar(['status', '--pr', '7', '--sha', SHA], rotas);
  assert.equal(r.code, 0, r.out);
});

test('erro: az sem login', () => {
  const r = rodar(['status', '--pr', '7'], [{ re: '.', corpos: ['__ERRO__'] }]);
  assert.equal(r.code, 3);
  assert.match(r.err, /az login/);
});

test('erro: PR inativo', () => {
  const r = rodar(['status', '--pr', '7'], [{ re: '/pullrequests/7\\?', corpos: [pr({ status: 'completed' })] }]);
  assert.equal(r.code, 3);
});
