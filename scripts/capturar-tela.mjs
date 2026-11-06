#!/usr/bin/env node
// Captura a tela RENDERIZADA do app (DOM + todo o CSS que o navegador aplicou,
// inclusive os estilos encapsulados do Angular e os internos do Material) num
// HTML que abre sozinho, igual ao app. É a base do mockup: edita-se a captura,
// não se redesenha a tela.
//
// Uso:
//   node capturar-tela.mjs capturar --url <url> --out <pasta> --nome <arquivo-sem-ext>
//        --data-dir <dir persistente> [--viewport 1440x900] [--esperar <seletor>]
//        [--antes <arquivo.js>] [--headed] [--sem-interativo]
//   node capturar-tela.mjs auth --url <url do app> --data-dir <dir>
//        [--realm-json <arquivo do realm> --usuario <username>]   (senha lida do realm, nunca impressa)
//        (ou credenciais em HARNESS_LOGIN_USER / HARNESS_LOGIN_PASSWORD)
//        [--checar]   (só diz se a sessão salva ainda vale; não loga)
//   node capturar-tela.mjs screenshot --arquivo <html> --out <png> [--viewport 1440x900] [--recorte x,y,w,h]
//   node capturar-tela.mjs comparar --a <png> --b <png> --out <diff.png> [--ignorar x,y,w,h;...]
//   node capturar-tela.mjs pecas      --arquivo <html>        (componentes da tela, com um seletor de cada)
//   node capturar-tela.mjs extrair    --arquivo <html> --seletor <css> [--indice N] [--max 20000]
//   node capturar-tela.mjs substituir --arquivo <html> --seletor <css> --com <fragmento.html>
//                                     [--modo trocar|antes|depois|dentro] [--indice N] [--saida <html>]
//   node capturar-tela.mjs css-de     --arquivo <doador.html> --para <html>   (anexa o CSS do doador)
//
// Os quatro últimos existem para NUNCA ler a captura inteira (ela traz todo o CSS do app):
// o agente vê e mexe só no trecho que a WI muda.
//
// Login (Keycloak): sessão salva em <data-dir>/auth/<host>.json (cookies + localStorage,
// formato storageState do Playwright) e <host>.session.json (sessionStorage — onde o
// cliente OIDC costuma guardar o token, e que o storageState NÃO cobre).
// Ordem ao capturar: 1) sessão salva; 2) login automático headless com o usuário de
// dev (mesmas fontes do comando auth); 3) navegador visível para o dev entrar (até
// 5 min) — desligado com --sem-interativo. Toda captura bem-sucedida renova a sessão.
// A senha nunca é impressa nem gravada pelo script; só o estado da sessão.
//
// Dependências (playwright-core, pngjs, pixelmatch) são instaladas uma vez em
// <data-dir>/deps. Navegador: Edge ou Chrome já instalados (sem download).

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PW_VERSION = '1.64.1';
const DEPS = { 'playwright-core': PW_VERSION, pngjs: '7.0.0', pixelmatch: '5.3.0' };

// ---------------------------------------------------------------- argumentos
const [cmd, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  opt[k] = v;
}
if (opt['data-dir']) opt['data-dir'] = path.resolve(String(opt['data-dir']));
const die = (m) => { console.error(`ERRO: ${m}`); process.exit(1); };
const viewport = (() => {
  const [w, h] = String(opt.viewport || '1440x900').split('x').map(Number);
  return { width: w || 1440, height: h || 900 };
})();

// ---------------------------------------------------------------- dependências
function loadDeps(dataDir) {
  const tryFrom = [process.cwd(), dataDir ? path.join(dataDir, 'deps') : null].filter(Boolean);
  const load = (name) => {
    for (const base of tryFrom) {
      try { return createRequire(path.join(base, 'noop.js'))(name); } catch { /* tenta o próximo */ }
    }
    return null;
  };
  let pw = load('playwright-core') || load('playwright');
  let PNG = load('pngjs')?.PNG;
  let pixelmatch = load('pixelmatch');
  if ((!pw || !PNG || !pixelmatch) && dataDir) {
    const depsDir = path.join(dataDir, 'deps');
    fs.mkdirSync(depsDir, { recursive: true });
    if (!fs.existsSync(path.join(depsDir, 'package.json'))) {
      fs.writeFileSync(path.join(depsDir, 'package.json'), '{"name":"harness-capture-deps","private":true}');
    }
    console.error(`Instalando dependências da captura em ${depsDir} (uma vez só)…`);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    execFileSync(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error',
      ...Object.entries(DEPS).map(([n, v]) => `${n}@${v}`)],
      { cwd: depsDir, stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32' });
    pw = load('playwright-core'); PNG = load('pngjs')?.PNG; pixelmatch = load('pixelmatch');
  }
  if (!pw) die('playwright-core indisponível (passe --data-dir para instalar).');
  return { chromium: pw.chromium, PNG, pixelmatch };
}

async function launch(chromium, headed) {
  const errors = [];
  for (const channel of ['msedge', 'chrome', undefined]) {
    try {
      return await chromium.launch({ headless: !headed, ...(channel ? { channel } : {}) });
    } catch (e) { errors.push(`${channel || 'chromium'}: ${String(e.message).split('\n')[0]}`); }
  }
  die(`nenhum navegador abriu.\n  ${errors.join('\n  ')}\nInstale o Edge/Chrome ou rode: npx playwright install chromium`);
}

// ---------------------------------------------------------------- sessão (login)
const isLoginPage = (u) => /\/realms\/|\/protocol\/openid-connect\/|login-actions/.test(u);

function authPaths(url, dataDir) {
  if (!dataDir) return null;
  const host = new URL(url).host.replace(/[^\w.-]/g, '_');
  const dir = path.join(dataDir, 'auth');
  return { dir, state: path.join(dir, `${host}.json`), session: path.join(dir, `${host}.session.json`) };
}

// Contexto já com a sessão salva: storageState + sessionStorage reinjetado antes do app subir.
async function contextoComSessao(browser, url, ap) {
  const hasState = ap && fs.existsSync(ap.state);
  const context = await browser.newContext({ viewport, ...(hasState ? { storageState: ap.state } : {}) });
  if (ap && fs.existsSync(ap.session)) {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(ap.session, 'utf8')); } catch { /* arquivo corrompido: ignora */ }
    await context.addInitScript(([origin, data]) => {
      if (location.origin !== origin) return;
      for (const [k, v] of Object.entries(data)) { try { if (sessionStorage.getItem(k) === null) sessionStorage.setItem(k, v); } catch {} }
    }, [new URL(url).origin, saved]);
  }
  return context;
}

async function salvarSessao(context, page, url, ap) {
  if (!ap) return;
  fs.mkdirSync(ap.dir, { recursive: true });
  await context.storageState({ path: ap.state });
  let ss = {};
  if (new URL(page.url()).origin === new URL(url).origin) {
    ss = await page.evaluate(() => Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)]))).catch(() => ({}));
  }
  fs.writeFileSync(ap.session, JSON.stringify(ss));
  try { fs.chmodSync(ap.state, 0o600); fs.chmodSync(ap.session, 0o600); } catch { /* Windows */ }
}

// Credenciais do usuário de dev: env HARNESS_LOGIN_USER/PASSWORD, ou o JSON do realm
// do AppHost (--realm-json + --usuario). Nunca loga, imprime nem devolve a senha.
function credenciaisDev() {
  const envUser = process.env.HARNESS_LOGIN_USER; const envPass = process.env.HARNESS_LOGIN_PASSWORD;
  if (envUser && envPass) return { usuario: envUser, senha: envPass, fonte: 'env' };
  if (!opt['realm-json'] || !opt.usuario) return null;
  let realm;
  try { realm = JSON.parse(fs.readFileSync(String(opt['realm-json']), 'utf8')); }
  catch (e) { die(`não consegui ler o realm (${String(e.message).split('\n')[0]}).`); }
  const nome = String(opt.usuario).toLowerCase();
  const u = (realm.users || []).find((x) => String(x.username).toLowerCase() === nome || String(x.email || '').toLowerCase() === nome);
  if (!u) die(`usuário "${opt.usuario}" não existe em ${opt['realm-json']}. Usuários: ${(realm.users || []).map((x) => x.username).join(', ') || '(nenhum)'}`);
  const cred = (u.credentials || []).find((c) => c.type === 'password' && typeof c.value === 'string');
  if (!cred) die(`"${u.username}" não tem senha em texto no realm (só hash ou nenhuma). Use HARNESS_LOGIN_USER/HARNESS_LOGIN_PASSWORD ou escale ao dev.`);
  return { usuario: u.username, senha: cred.value, fonte: 'realm' };
}

// Preenche o formulário padrão do Keycloak e espera voltar ao app. Devolve null ou o motivo da falha.
async function loginKeycloak(page, url, cred) {
  const appOrigin = new URL(url).origin;
  if (!isLoginPage(page.url())) return null;
  const user = page.locator('#username, input[name="username"]').first();
  try { await user.waitFor({ timeout: 20000 }); } catch { return 'formulário de login do Keycloak não apareceu (#username).'; }
  await user.fill(cred.usuario);
  await page.locator('#password, input[name="password"]').first().fill(cred.senha);
  await Promise.all([
    page.waitForURL((u) => u.origin === appOrigin && !isLoginPage(u.href), { timeout: 45000 }).catch(() => {}),
    page.locator('#kc-login, input[type="submit"], button[type="submit"]').first().click(),
  ]);
  if (isLoginPage(page.url())) {
    const msg = await page.locator('#input-error, .kc-feedback-text, .alert-error, [class*="error"]').first().innerText({ timeout: 2000 }).catch(() => '');
    if (/update.?password|atualizar|required.?action|otp|totp/i.test(page.url() + ' ' + msg)) {
      return 'o Keycloak pediu ação extra (trocar senha, OTP…) para esse usuário. Ajuste o usuário no realm ou escale ao dev.';
    }
    return `login recusado pelo Keycloak${msg ? `: ${msg.trim().slice(0, 160)}` : ''}.`;
  }
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  return null;
}

// Garante a página autenticada em `url`. Devolve { browser, context, page, via }.
async function abrirAutenticado(chromium, url, ap, { headed = false, interativo = true } = {}) {
  const appOrigin = new URL(url).origin;
  let browser = await launch(chromium, headed);
  let context = await contextoComSessao(browser, url, ap);
  let page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  if (!isLoginPage(page.url())) return { browser, context, page, via: 'sessao-salva' };

  const cred = credenciaisDev();
  if (cred) {
    // Contexto limpo: sessão velha pode atrapalhar o fluxo do Keycloak.
    await context.close();
    context = await browser.newContext({ viewport });
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    const falha = await loginKeycloak(page, url, cred);
    if (!falha) {
      await salvarSessao(context, page, url, ap);
      if (page.url() !== url) await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
      return { browser, context, page, via: `login-automatico (${cred.fonte})` };
    }
    console.error(`Login automático falhou: ${falha}`);
  }

  if (!interativo) {
    await browser.close();
    die('sem sessão válida e sem login automático. Rode o comando auth (com --realm-json/--usuario ou HARNESS_LOGIN_USER/PASSWORD) ou escale ao dev.');
  }
  if (!headed) {
    await browser.close();
    console.error('Sem sessão válida. Abrindo o navegador para você entrar com o usuário de desenvolvimento (até 5 min)…');
    browser = await launch(chromium, true);
    context = await browser.newContext({ viewport });
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await page.waitForURL((u) => u.origin === appOrigin && !isLoginPage(u.href), { timeout: 300000 })
    .catch(() => die('o login não foi concluído em 5 minutos.'));
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await salvarSessao(context, page, url, ap);
  if (page.url() !== url) await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  return { browser, context, page, via: 'login-manual' };
}

// ---------------------------------------------------------------- serialização (roda na página)
// Devolve o HTML autossuficiente e a lista de URLs de recursos (fontes, imagens) a embutir.
function serializePage() {
  const abs = (u, base) => { try { return new URL(u, base).href; } catch { return u; } };
  const urls = new Set();
  const rewriteUrls = (css, base) => css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => {
    if (/^(data:|#)/.test(u)) return m;
    const a = abs(u, base); urls.add(a); return `url("${a}")`;
  });

  // 1) Todo o CSS aplicado, na ordem do documento (inclui <style> do Angular e adoptedStyleSheets).
  const chunks = [];
  const sheets = [...document.styleSheets, ...(document.adoptedStyleSheets || [])];
  for (const sh of sheets) {
    const base = sh.href || document.baseURI;
    try {
      const media = sh.media && sh.media.mediaText && sh.media.mediaText !== 'all' ? sh.media.mediaText : '';
      const css = [...sh.cssRules].map((r) => r.cssText).join('\n');
      chunks.push(media ? `@media ${media} {\n${css}\n}` : css);
      chunks[chunks.length - 1] = rewriteUrls(chunks[chunks.length - 1], base);
    } catch { chunks.push(`/* folha não lida (CORS): ${sh.href} */`); }
  }

  // 2) Clone do DOM com o estado atual dos controles.
  const live = document.documentElement;
  const clone = live.cloneNode(true);
  const liveAll = live.querySelectorAll('*');
  const cloneAll = clone.querySelectorAll('*');
  liveAll.forEach((el, i) => {
    const c = cloneAll[i];
    if (!c) return;
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked'); }
      else c.setAttribute('value', el.value);
    } else if (el instanceof HTMLTextAreaElement) { c.textContent = el.value; }
    else if (el instanceof HTMLSelectElement) {
      [...c.options].forEach((o, j) => { if (el.options[j]?.selected) o.setAttribute('selected', ''); else o.removeAttribute('selected'); });
    } else if (el instanceof HTMLCanvasElement) {
      try { const img = document.createElement('img'); img.src = el.toDataURL(); img.width = el.width; img.height = el.height;
        img.style.cssText = el.style.cssText; [...el.attributes].forEach((a) => { if (!['width','height'].includes(a.name)) img.setAttribute(a.name, a.value); });
        c.replaceWith(img); } catch { /* canvas contaminado: fica vazio */ }
    }
    if (el.scrollTop || el.scrollLeft) c.setAttribute('data-captura-scroll', `${el.scrollLeft},${el.scrollTop}`);
    for (const attr of ['src', 'srcset', 'poster']) {
      const v = c.getAttribute && c.getAttribute(attr);
      if (v && attr !== 'srcset' && !/^data:/.test(v)) { const a = abs(v, document.baseURI); urls.add(a); c.setAttribute(attr, a); }
    }
    const st = c.getAttribute && c.getAttribute('style');
    if (st && st.includes('url(')) c.setAttribute('style', rewriteUrls(st, document.baseURI));
  });

  // 3) Remove o que é comportamento ou carregamento: o mockup é estático.
  clone.querySelectorAll('script, noscript, link[rel="stylesheet"], link[rel="preload"], link[rel="modulepreload"], link[rel="prefetch"], base, style').forEach((n) => n.remove());
  clone.querySelectorAll('[srcset]').forEach((n) => n.removeAttribute('srcset'));

  const head = clone.querySelector('head');
  const style = document.createElement('style');
  style.setAttribute('data-captura', 'css-do-app');
  style.textContent = chunks.join('\n');
  head.appendChild(style);
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'captura');
  meta.setAttribute('content', `${location.href} | ${new Date().toISOString()} | ${innerWidth}x${innerHeight}`);
  head.prepend(meta);
  if (!head.querySelector('meta[charset]')) { const m = document.createElement('meta'); m.setAttribute('charset', 'utf-8'); head.prepend(m); }

  // Restaura rolagens internas ao abrir o arquivo.
  const restore = document.createElement('script');
  restore.textContent = "document.querySelectorAll('[data-captura-scroll]').forEach(e=>{const[x,y]=e.dataset.capturaScroll.split(',');e.scrollLeft=+x;e.scrollTop=+y;});";
  clone.querySelector('body').appendChild(restore);

  return { html: '<!doctype html>\n' + clone.outerHTML, urls: [...urls] };
}

// ---------------------------------------------------------------- comandos
async function capturar() {
  const { url, out, nome = 'captura', 'data-dir': dataDir } = opt;
  if (!url || !out) die('capturar exige --url e --out.');
  const { chromium } = loadDeps(dataDir);
  const ap = authPaths(url, dataDir);
  const { browser, context, page, via } = await abrirAutenticado(chromium, url, ap,
    { headed: !!opt.headed, interativo: !opt['sem-interativo'] });
  console.error(`Sessão: ${via}`);

  if (opt.esperar) await page.waitForSelector(String(opt.esperar), { timeout: 30000 });
  if (opt.antes) {
    // Passos para chegar ao estado desejado (abrir aba, aplicar filtro…): export default async (page) => {}
    const mod = await import(new URL(`file://${path.resolve(String(opt.antes))}`).href);
    await (mod.default || mod)(page);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(500); // animações de entrada do Material

  fs.mkdirSync(out, { recursive: true });
  const pngPath = path.join(out, `${nome}.referencia.png`);
  await page.screenshot({ path: pngPath, fullPage: false, animations: 'disabled' });

  const { html, urls } = await page.evaluate(serializePage);

  // Recursos (fontes, imagens) vão para <out>/assets e o HTML aponta para eles.
  const assetsDir = path.join(out, 'assets');
  let out_html = html; let bytes = 0; const faltando = [];
  for (const u of urls) {
    try {
      const res = await context.request.get(u, { timeout: 30000 });
      if (!res.ok()) { faltando.push(`${res.status()} ${u}`); continue; }
      const body = await res.body();
      const ext = (path.extname(new URL(u).pathname) || '').slice(0, 8);
      const name = `${Buffer.from(u).toString('base64url').slice(-40)}${ext}`;
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(path.join(assetsDir, name), body);
      bytes += body.length;
      out_html = out_html.split(u).join(`assets/${name}`);
    } catch (e) { faltando.push(`${String(e.message).split('\n')[0]} ${u}`); }
  }
  const htmlPath = path.join(out, `${nome}.html`);
  fs.writeFileSync(htmlPath, out_html);
  await salvarSessao(context, page, url, ap).catch(() => {}); // renova a sessão para a próxima
  await browser.close();

  console.log(JSON.stringify({
    html: htmlPath, referencia: pngPath, viewport: `${viewport.width}x${viewport.height}`,
    recursos: urls.length - faltando.length, recursosKB: Math.round(bytes / 1024),
    htmlKB: Math.round(Buffer.byteLength(out_html) / 1024), faltando,
  }, null, 2));
}

async function screenshot() {
  const { arquivo, out, 'data-dir': dataDir } = opt;
  if (!arquivo || !out) die('screenshot exige --arquivo e --out.');
  const { chromium } = loadDeps(dataDir);
  const browser = await launch(chromium, false);
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto(new URL(`file://${path.resolve(String(arquivo))}`).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  // --recorte x,y,w,h: salva só a região que a WI mudou — é o que se olha com Read,
  // em vez da tela inteira (uma imagem cheia por conferência pesa no contexto).
  let clip;
  if (opt.recorte) {
    const [x, y, width, height] = String(opt.recorte).split(',').map(Number);
    if ([x, y, width, height].some((n) => !Number.isFinite(n)) || width <= 0 || height <= 0) {
      die('--recorte espera x,y,w,h (números, w e h > 0).');
    }
    clip = { x, y, width, height };
  }
  await page.screenshot({ path: String(out), fullPage: false, animations: 'disabled', ...(clip ? { clip } : {}) });
  await browser.close();
  console.log(JSON.stringify({ png: out, ...(clip ? { recorte: clip } : {}) }));
}

async function comparar() {
  const { a, b, out, 'data-dir': dataDir } = opt;
  if (!a || !b) die('comparar exige --a e --b.');
  const { PNG, pixelmatch } = loadDeps(dataDir);
  if (!PNG || !pixelmatch) die('pngjs/pixelmatch indisponíveis (passe --data-dir).');
  const A = PNG.sync.read(fs.readFileSync(String(a)));
  const B = PNG.sync.read(fs.readFileSync(String(b)));
  if (A.width !== B.width || A.height !== B.height) die(`tamanhos diferentes: ${A.width}x${A.height} × ${B.width}x${B.height}`);
  // Regiões ignoradas (a área que a WI muda de propósito): "x,y,w,h;x,y,w,h"
  const regs = String(opt.ignorar || '').split(';').filter(Boolean).map((r) => r.split(',').map(Number));
  const mask = (img) => { for (const [x, y, w, h] of regs) for (let yy = y; yy < Math.min(y + h, img.height); yy++) for (let xx = x; xx < Math.min(x + w, img.width); xx++) { const i = (yy * img.width + xx) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 0; img.data[i + 3] = 255; } };
  mask(A); mask(B);
  const D = new PNG({ width: A.width, height: A.height });
  const diff = pixelmatch(A.data, B.data, D.data, A.width, A.height, { threshold: 0.1 });
  if (out) fs.writeFileSync(String(out), PNG.sync.write(D));
  const total = A.width * A.height - regs.reduce((s, [, , w, h]) => s + w * h, 0);
  const pct = total > 0 ? (diff / total) * 100 : 0;
  console.log(JSON.stringify({ pixelsDiferentes: diff, percentual: Number(pct.toFixed(3)), diff: out || null }));
}

// ---------------------------------------------------------------- edição sem ler o arquivo inteiro
// Abre a captura com JavaScript desligado (nada roda), mexe no DOM e grava de volta.
async function openStatic(arquivo) {
  const { chromium } = loadDeps(opt['data-dir']);
  const browser = await launch(chromium, false);
  const context = await browser.newContext({ javaScriptEnabled: false, viewport });
  const page = await context.newPage();
  await page.goto(new URL(`file://${path.resolve(String(arquivo))}`).href, { waitUntil: 'domcontentloaded' });
  return { browser, page };
}
const serializeDoc = () => '<!doctype html>\n' + document.documentElement.outerHTML;

async function pecas() {
  if (!opt.arquivo) die('pecas exige --arquivo.');
  const { browser, page } = await openStatic(opt.arquivo);
  const res = await page.evaluate(() => {
    const sel = (el) => {
      const parts = [];
      for (let e = el; e && e.nodeType === 1 && e !== document.body; e = e.parentElement) {
        if (e.id && /^[A-Za-z][\w-]*$/.test(e.id)) { parts.unshift(`#${e.id}`); break; }
        const tag = e.tagName.toLowerCase();
        const sib = [...(e.parentElement?.children || [])].filter((x) => x.tagName === e.tagName);
        parts.unshift(sib.length > 1 ? `${tag}:nth-of-type(${sib.indexOf(e) + 1})` : tag);
      }
      return parts.join(' > ');
    };
    const m = new Map();
    for (const el of document.body.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase();
      const marked = el.getAttribute('data-componente') || el.getAttribute('data-novo');
      if (!tag.includes('-') && !marked) continue;
      const key = marked ? `${tag} [${el.hasAttribute('data-novo') ? 'novo' : 'marcado'}: ${marked}]` : tag;
      const a = m.get(key) || { quantidade: 0, primeiro: sel(el), texto: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60) };
      a.quantidade += 1; m.set(key, a);
    }
    return [...m].map(([componente, a]) => ({ componente, ...a }));
  });
  await browser.close();
  console.log(JSON.stringify(res, null, 1));
}

async function extrair() {
  if (!opt.arquivo || !opt.seletor) die('extrair exige --arquivo e --seletor.');
  const { browser, page } = await openStatic(opt.arquivo);
  const idx = Number(opt.indice || 0);
  const out = await page.evaluate(([s, i]) => {
    const all = document.querySelectorAll(s);
    return { total: all.length, html: all[i] ? all[i].outerHTML : null };
  }, [String(opt.seletor), idx]);
  await browser.close();
  if (!out.html) die(`seletor não encontrou nada (total ${out.total}).`);
  const max = Number(opt.max || 20000);
  const cut = out.html.length > max;
  console.log(`<!-- ${out.total} ocorrência(s); mostrando a ${idx}${cut ? `; cortado em ${max} de ${out.html.length} caracteres — use um seletor mais específico` : ''} -->`);
  console.log(cut ? out.html.slice(0, max) : out.html);
}

async function substituir() {
  if (!opt.arquivo || !opt.seletor || !opt.com) die('substituir exige --arquivo, --seletor e --com.');
  const frag = fs.readFileSync(String(opt.com), 'utf8');
  const modo = String(opt.modo || 'trocar');
  const { browser, page } = await openStatic(opt.arquivo);
  const r = await page.evaluate(([s, i, f, mo]) => {
    const all = document.querySelectorAll(s);
    const el = all[i];
    if (!el) return { ok: false, total: all.length };
    const pos = { trocar: null, antes: 'beforebegin', depois: 'afterend', dentro: null }[mo];
    if (mo === 'trocar') el.outerHTML = f;
    else if (mo === 'dentro') el.innerHTML = f;
    else el.insertAdjacentHTML(pos, f);
    return { ok: true, total: all.length };
  }, [String(opt.seletor), Number(opt.indice || 0), frag, modo]);
  if (!r.ok) { await browser.close(); die(`seletor não encontrou nada (total ${r.total}).`); }
  const html = await page.evaluate(serializeDoc);
  await browser.close();
  const destino = String(opt.saida || opt.arquivo);
  fs.writeFileSync(destino, html);
  console.log(JSON.stringify({ arquivo: destino, modo, ocorrencias: r.total, kb: Math.round(Buffer.byteLength(html) / 1024) }));
}

async function cssDe() {
  if (!opt.arquivo || !opt.para) die('css-de exige --arquivo (doador) e --para.');
  const doador = fs.readFileSync(String(opt.arquivo), 'utf8');
  const m = doador.match(/<style data-captura="css-do-app">([\s\S]*?)<\/style>/);
  if (!m) die('o doador não tem <style data-captura>.');
  let alvo = fs.readFileSync(String(opt.para), 'utf8');
  const tag = `<style data-captura="doador:${path.basename(String(opt.arquivo))}">`;
  if (alvo.includes(tag)) { console.log(JSON.stringify({ jaAnexado: true })); return; }
  alvo = alvo.replace('</head>', `${tag}${m[1]}</style></head>`);
  fs.writeFileSync(String(opt.para), alvo);
  console.log(JSON.stringify({ para: opt.para, cssKB: Math.round(m[1].length / 1024) }));
}

async function auth() {
  const { url, 'data-dir': dataDir } = opt;
  if (!url || !dataDir) die('auth exige --url e --data-dir.');
  const ap = authPaths(url, dataDir);
  const { chromium } = loadDeps(dataDir);
  if (opt.checar) {
    const browser = await launch(chromium, false);
    const context = await contextoComSessao(browser, url, ap);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    const valida = !isLoginPage(page.url());
    await browser.close();
    console.log(JSON.stringify({ valida, arquivo: ap.state }));
    process.exit(valida ? 0 : 2);
  }
  if (!credenciaisDev()) die('auth precisa de --realm-json + --usuario, ou HARNESS_LOGIN_USER/HARNESS_LOGIN_PASSWORD.');
  // Força login novo: apaga a sessão anterior.
  for (const f of [ap.state, ap.session]) { try { fs.unlinkSync(f); } catch {} }
  const { browser, page, via } = await abrirAutenticado(chromium, url, ap, { interativo: false });
  const final = page.url();
  await browser.close();
  console.log(JSON.stringify({ ok: true, via, url: final, arquivo: ap.state }, null, 2));
}

const run = { auth, capturar, screenshot, comparar, pecas, extrair, substituir, 'css-de': cssDe }[cmd];
if (!run) die('comando: auth | capturar | screenshot | comparar | pecas | extrair | substituir | css-de');
run().catch((e) => die(e.stack || String(e)));
