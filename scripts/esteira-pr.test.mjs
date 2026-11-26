// Testes do esteira-pr.mjs e do criar-pr.mjs:  node --test scripts/esteira-pr.test.mjs
// Um servidor HTTP local faz o papel do Azure DevOps (ADO_BASE_URL) e ADO_TOKEN pula o az:
// nada sai da máquina.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRemote } from './ado.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CTX = ['--org', 'org', '--projeto', 'proj', '--repo', 'repo'];
const SHA = 'abc1234567890';
let base, server, porta, rotas = [], pedidos = [];

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'esteira-teste-'));
  server = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      pedidos.push({ metodo: req.method, url: req.url, corpo, auth: req.headers.authorization });
      const r = rotas.find((x) => (x.metodo || 'GET') === req.method && new RegExp(x.re).test(req.url));
      if (!r) { res.writeHead(404); res.end(JSON.stringify({ message: `sem rota: ${req.method} ${req.url}` })); return; }
      const c = r.corpos[Math.min(r.n = (r.n ?? -1) + 1, r.corpos.length - 1)];
      if (typeof c === 'number') { res.writeHead(c); res.end(JSON.stringify({ message: `status ${c}` })); return; }
      res.writeHead(200, { 'Content-Type': typeof c === 'string' ? 'text/plain' : 'application/json' });
      res.end(typeof c === 'string' ? c : JSON.stringify(c));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  porta = server.address().port;
});
after(() => { server.close(); fs.rmSync(base, { recursive: true, force: true }); });

function rodar(script, args, rotasDoCaso) {
  rotas = rotasDoCaso; pedidos = [];
  const dir = fs.mkdtempSync(path.join(base, 'caso-'));
  return new Promise((ok) => {
    const p = spawn(process.execPath, [path.join(DIR, script), ...args, ...CTX], {
      cwd: dir, env: { ...process.env, ADO_BASE_URL: `http://127.0.0.1:${porta}`, ADO_TOKEN: 'tk' },
    });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => ok({ code, out, err, dir }));
  });
}
const esteira = (args, r) => rodar('esteira-pr.mjs', args, r);

const pr = (extra = {}) => ({
  pullRequestId: 7, title: 'WI 1: teste', status: 'active', mergeStatus: 'succeeded',
  sourceRefName: 'refs/heads/feature/wi-1-teste', targetRefName: 'refs/heads/master',
  lastMergeSourceCommit: { commitId: SHA }, lastMergeTargetCommit: { commitId: 'ttt888' }, lastMergeCommit: { commitId: 'mmm999' },
  repository: { project: { id: 'p-guid' } }, ...extra,
});
const evBuild = (status, buildId, extra = {}, cfg = {}) => ({
  status, configuration: { isEnabled: true, isBlocking: true, type: { displayName: 'Build' }, settings: { buildDefinitionId: 11, displayName: 'Gate de PR (build + Unit)' }, ...cfg },
  context: { buildId, ...extra },
});
const evRevisores = { status: 'queued', configuration: { isEnabled: true, isBlocking: true, type: { displayName: 'Minimum number of reviewers' }, settings: {} } };
const build = (id, status, result, sha = SHA) => ({ id, buildNumber: `2026.${id}`, status, result, definition: { id: 11, name: 'BrixBroker - PR Gate' }, triggerInfo: { 'pr.sourceSha': sha }, sourceVersion: 'mmm999', _links: { web: { href: `https://x/build/${id}` } } });
const basicas = (evals, extra = [], { threads = [] } = {}) => [
  { re: '/pullrequests/7\\?', corpos: [pr()] },
  { re: '/policy/evaluations', corpos: [{ value: evals }] },
  { re: '/pullRequests/7/iterations', corpos: [{ value: [{ id: 1 }, { id: 2 }] }] },
  { re: '/pullRequests/7/statuses', corpos: [{ value: [] }] },
  { re: '/pullRequests/7/threads', corpos: [{ value: threads }] },
  ...extra,
];

test('parseRemote reconhece os formatos do Azure DevOps', () => {
  assert.deepEqual(parseRemote('https://confitecDevOps@dev.azure.com/confitecDevOps/brixbroker/_git/brixbroker'), { org: 'confitecDevOps', projeto: 'brixbroker', repo: 'brixbroker' });
  assert.deepEqual(parseRemote('https://org.visualstudio.com/DefaultCollection/proj/_git/repo'), { org: 'org', projeto: 'proj', repo: 'repo' });
  assert.deepEqual(parseRemote('git@ssh.dev.azure.com:v3/org/proj/repo'), { org: 'org', projeto: 'proj', repo: 'repo' });
  assert.equal(parseRemote('https://github.com/o/r.git'), null);
});

test('esteira só faz GET, com o token no cabeçalho', async () => {
  const r = await esteira(['status', '--pr', '7', '--sha', SHA], basicas([evBuild('approved', 101)], [
    { re: '/build/builds/101\\?', corpos: [build(101, 'completed', 'succeeded')] },
  ]));
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(pedidos.length > 0);
  assert.ok(pedidos.every((p) => p.metodo === 'GET'), 'nenhuma escrita');
  assert.ok(pedidos.every((p) => p.auth === 'Bearer tk'));
});

test('pr: acha o PR ativo da branch', async () => {
  const r = await esteira(['pr', '--branch', 'feature/wi-1-teste'], [{ re: 'searchCriteria.sourceRefName=refs/heads/feature/wi-1-teste&', corpos: [{ value: [pr()] }] }]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^pr: 7$/m);
});

test('pr: nenhum PR ativo', async () => {
  const r = await esteira(['pr', '--branch', 'feature/x'], [{ re: 'pullrequests\\?', corpos: [{ value: [] }] }]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^pr: nenhum$/m);
});

test('status verde: mostra os três SHAs; revisores ficam com o dev e não seguram o resultado', async () => {
  const r = await esteira(['status', '--pr', '7', '--sha', SHA], basicas([evBuild('approved', 101), evRevisores], [
    { re: '/build/builds/101\\?', corpos: [build(101, 'completed', 'succeeded')] },
  ]));
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /RESULTADO: verde/);
  assert.match(r.out, /do dev/);
  assert.match(r.out, /lastMergeSourceCommit\) abc1234567 · master \(lastMergeTargetCommit\) ttt888 · merge \(lastMergeCommit\) mmm999/);
});

test('status pendente: o PR ainda não recebeu o push', async () => {
  const r = await esteira(['status', '--pr', '7', '--sha', 'fff000'], basicas([evBuild('approved', 101)]));
  assert.equal(r.code, 2);
  assert.match(r.out, /ainda não chegou/);
});

test('status pendente: a build aprovada é de outro commit', async () => {
  const r = await esteira(['status', '--pr', '7', '--sha', SHA], basicas([evBuild('approved', 100)], [
    { re: '/build/builds/100\\?', corpos: [build(100, 'completed', 'succeeded', 'velho111')] },
  ]));
  assert.equal(r.code, 2);
  assert.match(r.out, /outro commit/);
});

test('status com --aguardar: rodando e depois verde, mesmo com a avaliação da política atrasada', async () => {
  const r = await esteira(['status', '--pr', '7', '--sha', SHA, '--aguardar', '1', '--intervalo', '0'], basicas([evBuild('running', 101)], [
    { re: '/build/builds/101\\?', corpos: [build(101, 'inProgress', null), build(101, 'completed', 'succeeded')] },
  ]));
  assert.equal(r.code, 0, r.out + r.err);
});

test('status falha: etapa folha, trecho do log, trava estática, testes vermelhos e master também vermelha', async () => {
  const log = ['2026-11-26T10:00:00.0000000Z Building...', 'Resumo: novas=7 CRESCEU S3776', '##[error]Process completed with exit code 1.'].join('\n');
  const r = await esteira(['status', '--pr', '7', '--sha', SHA, '--saida', 'saida/esteira-C1.md'], basicas([evBuild('rejected', 101)], [
    { re: '/build/builds/101\\?', corpos: [build(101, 'completed', 'failed')] },
    { re: '/build/builds/101/timeline', corpos: [{ records: [
      { id: 's1', type: 'Stage', name: 'Gate de PR', result: 'failed' },
      { id: 'j1', parentId: 's1', type: 'Job', name: 'Build da solution e Unit.Tests', result: 'failed' },
      { id: 't1', parentId: 'j1', type: 'Task', name: 'Gate da trava de análise estática Backend', result: 'failed', log: { id: 23 }, issues: [{ type: 'error', message: 'Bash exited with code 1.' }] },
      { id: 't2', parentId: 'j1', type: 'Task', name: 'checkout', result: 'succeeded' },
    ] }] },
    { re: '/build/builds/101/logs/23', corpos: [log] },
    { re: '/test/runs\\?buildUri', corpos: [{ value: [{ id: 5, totalTests: 10, passedTests: 9 }] }] },
    { re: '/test/Runs/5/results', corpos: [{ value: [{ automatedTestName: 'Insurtech.Unit.Tests.FooTests.Bar', automatedTestStorage: 'Insurtech.Unit.Tests.dll', errorMessage: 'Expected 1 but was 2' }] }] },
    { re: 'branchName=refs/heads/master', corpos: [{ value: [{ id: 90, buildNumber: '2026.90', result: 'failed' }] }] },
  ]));
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /Etapa: Build da solution e Unit.Tests › Gate da trava de análise estática Backend/);
  assert.doesNotMatch(r.out, /Etapa: Gate de PR/, 'stage e job não se repetem quando a tarefa filha explica a falha');
  assert.match(r.out, /Resumo: novas=7 CRESCEU/);
  assert.match(r.out, /FooTests\.Bar/);
  assert.match(r.out, /também vermelha na master/);
  assert.match(r.out, /Suspeita de infraestrutura: não/);
  assert.ok(fs.existsSync(path.join(r.dir, 'saida', 'esteira-C1.md')));
  assert.ok(fs.existsSync(path.join(r.dir, 'saida', 'esteira-logs', 'build-101-log-23.txt')));
});

test('status falha de infraestrutura: agente perdido', async () => {
  const r = await esteira(['status', '--pr', '7', '--sha', SHA], basicas([evBuild('rejected', 101)], [
    { re: '/build/builds/101\\?', corpos: [build(101, 'completed', 'failed')] },
    { re: '/build/builds/101/timeline', corpos: [{ records: [
      { id: 'j1', type: 'Job', name: 'Backend', result: 'failed', issues: [{ type: 'error', message: 'We stopped hearing from agent linux-02. Lost communication with the server.' }] },
    ] }] },
    { re: '/test/runs\\?buildUri', corpos: [{ value: [] }] },
    { re: 'branchName=refs/heads/master', corpos: [{ value: [{ id: 90, result: 'succeeded' }] }] },
  ]));
  assert.equal(r.code, 1);
  assert.match(r.out, /Suspeita de infraestrutura: \*\*sim\*\*/);
});

test('status falha: conflito com a master', async () => {
  const rs = basicas([evBuild('approved', 101)], [{ re: '/build/builds/101\\?', corpos: [build(101, 'completed', 'succeeded')] }]);
  rs[0].corpos = [pr({ mergeStatus: 'conflicts' })];
  const r = await esteira(['status', '--pr', '7', '--sha', SHA], rs);
  assert.equal(r.code, 1);
  assert.match(r.out, /conflito com a master/);
});

test('status ignora status de iteração antiga e usa o último por contexto', async () => {
  const rs = basicas([evBuild('approved', 101)], [{ re: '/build/builds/101\\?', corpos: [build(101, 'completed', 'succeeded')] }]);
  rs[3].corpos = [{ value: [
    { id: 1, iterationId: 1, state: 'failed', context: { genre: 'sonar', name: 'quality-gate' } },
    { id: 2, iterationId: 2, state: 'pending', context: { genre: 'sonar', name: 'quality-gate' } },
    { id: 3, iterationId: 2, state: 'succeeded', context: { genre: 'sonar', name: 'quality-gate' } },
  ] }];
  const r = await esteira(['status', '--pr', '7', '--sha', SHA], rs);
  assert.equal(r.code, 0, r.out);
});

test('status lista as discussões ativas do Code Review IA, sem contar no resultado', async () => {
  const achado = (id, status, respostas = []) => ({
    id: 40, status, threadContext: { filePath: '/platform/backend/src/Foo.cs', rightFileStart: { line: 12 } },
    comments: [{ content: `<!-- pr-code-review-chatgpt:finding:${id} -->\n## ${id} — Exceção engolida\n\n- **Severidade:** alta\n- **Categoria:** bug` }, ...respostas],
  });
  const r = await esteira(['status', '--pr', '7', '--sha', SHA], basicas([evBuild('approved', 101)], [
    { re: '/build/builds/101\\?', corpos: [build(101, 'completed', 'succeeded')] },
  ], { threads: [
    achado('IA-aaa111', 'active'),
    achado('IA-bbb222', 'active', [{ content: 'Falso positivo: o guard está no handler pai', commentType: 'text' }]),
    achado('IA-ccc333', 'fixed'),
    { id: 41, status: 'active', comments: [{ content: 'comentário humano comum' }] },
  ] }));
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /Code Review IA — discussões ativas \(2\)/);
  assert.match(r.out, /IA-aaa111\*\* \[alta\] `\/platform\/backend\/src\/Foo.cs:12` — Exceção engolida · sem resposta/);
  assert.match(r.out, /IA-bbb222.*Falso positivo/);
  assert.doesNotMatch(r.out, /IA-ccc333/);
});

test('erro: token sem acesso', async () => {
  const r = await esteira(['status', '--pr', '7'], [{ re: '.', corpos: [401] }]);
  assert.equal(r.code, 3);
  assert.match(r.err, /az login/);
});

test('erro: PR inativo', async () => {
  const r = await esteira(['status', '--pr', '7'], [{ re: '/pullrequests/7\\?', corpos: [pr({ status: 'completed' })] }]);
  assert.equal(r.code, 3);
});

// ---------------------------------------------------------------------------- criar-pr.mjs

function arquivos(corpo, descricao = 'WI 1 — teste\n\n- entrega a fatia A\n- critério 1 → FooTests.Bar') {
  const d = fs.mkdtempSync(path.join(base, 'pr-'));
  fs.writeFileSync(path.join(d, 'pr-body.json'), typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
  fs.writeFileSync(path.join(d, 'pr-descricao.md'), descricao);
  return ['--corpo', path.join(d, 'pr-body.json'), '--descricao', path.join(d, 'pr-descricao.md'), '--saida', path.join(d, 'pr-criado.json')];
}
const corpoOk = { sourceRefName: 'refs/heads/feature/wi-1-teste', targetRefName: 'refs/heads/master', title: 'WI 1: teste', workItemRefs: [{ id: '1' }], isDraft: false };

test('criar-pr: cria com título, descrição completa e WI num POST só, e confere lendo de volta', async () => {
  const desc = 'WI 1 — teste ção\n\n- entrega a fatia A';
  const args = arquivos(corpoOk, desc);
  const r = await rodar('criar-pr.mjs', args, [
    { re: 'pullrequests\\?searchCriteria', corpos: [{ value: [] }] },
    { metodo: 'POST', re: '/pullrequests\\?api-version', corpos: [{ pullRequestId: 55 }] },
    { re: '/pullrequests/55\\?', corpos: [{ pullRequestId: 55, ...corpoOk, description: `${desc}\n\n## Complemento IA\n...` }] },
    { re: '/pullRequests/55/workitems', corpos: [{ value: [{ id: '1' }] }] },
  ]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^pr: 55$/m);
  const posts = pedidos.filter((p) => p.metodo === 'POST');
  assert.equal(posts.length, 1);
  const enviado = JSON.parse(posts[0].corpo);
  assert.equal(enviado.description, desc, 'descrição completa, UTF-8, na criação');
  assert.deepEqual(enviado.workItemRefs, [{ id: '1' }]);
  assert.equal(enviado.autoCompleteSetBy, undefined);
  assert.equal(JSON.parse(fs.readFileSync(args[5], 'utf8')).pullRequestId, 55);
});

test('criar-pr: PR ativo já existe → não cria nada', async () => {
  const r = await rodar('criar-pr.mjs', arquivos(corpoOk), [
    { re: 'pullrequests\\?searchCriteria', corpos: [{ value: [{ pullRequestId: 9, targetRefName: 'refs/heads/master' }] }] },
  ]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^pr: 9$/m);
  assert.ok(pedidos.every((p) => p.metodo === 'GET'));
});

test('criar-pr: conferência divergente (WI não vinculada) sai com 1', async () => {
  const r = await rodar('criar-pr.mjs', arquivos(corpoOk), [
    { re: 'pullrequests\\?searchCriteria', corpos: [{ value: [] }] },
    { metodo: 'POST', re: '/pullrequests\\?api-version', corpos: [{ pullRequestId: 56 }] },
    { re: '/pullrequests/56\\?', corpos: [{ pullRequestId: 56, ...corpoOk, description: 'WI 1 — teste\n\n- entrega a fatia A\n- critério 1 → FooTests.Bar' }] },
    { re: '/pullRequests/56/workitems', corpos: [{ value: [] }] },
  ]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FALHA WI vinculada/);
});

for (const [desc, corpo, msg] of [
  ['auto-complete no corpo', { ...corpoOk, autoCompleteSetBy: { id: 'x' } }, /campos que este script não envia: autoCompleteSetBy/],
  ['revisores no corpo', { ...corpoOk, reviewers: [{ id: 'x' }] }, /reviewers/],
  ['alvo que não é a master', { ...corpoOk, targetRefName: 'refs/heads/release' }, /targetRefName/],
  ['fonte na master', { ...corpoOk, sourceRefName: 'refs/heads/master' }, /sourceRefName/],
  ['sem WI', { ...corpoOk, workItemRefs: [] }, /workItemRefs/],
  ['JSON inválido', '{"title":', /não é JSON válido/],
]) {
  test(`criar-pr recusa: ${desc}`, async () => {
    const r = await rodar('criar-pr.mjs', arquivos(corpo), []);
    assert.equal(r.code, 3, r.out);
    assert.match(r.err, msg);
    assert.equal(pedidos.length, 0, 'nada sai antes de validar');
  });
}

test('criar-pr recusa descrição acima de 4000 caracteres', async () => {
  const r = await rodar('criar-pr.mjs', arquivos(corpoOk, 'x'.repeat(4001)), []);
  assert.equal(r.code, 3);
  assert.match(r.err, /4000/);
});
