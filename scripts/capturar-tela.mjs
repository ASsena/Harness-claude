#!/usr/bin/env node
// Captura a tela RENDERIZADA do app (DOM + todo o CSS que o navegador aplicou,
// inclusive os estilos encapsulados do Angular e os internos do Material) num
// HTML que abre sozinho, igual ao app. É a base do mockup: edita-se a captura,
// não se redesenha a tela.
//
// Uso:
//   node capturar-tela.mjs capturar --url <url> --out <pasta> --nome <arquivo-sem-ext>
//        --data-dir <dir persistente> [--viewport 1440x900] [--esperar <seletor>]
//        [--antes <arquivo.js>] [--headed]
//   node capturar-tela.mjs screenshot --arquivo <html> --out <png> [--viewport 1440x900]
//   node capturar-tela.mjs comparar --a <png> --b <png> --out <diff.png> [--ignorar x,y,w,h;...]
//
// Login (Keycloak): reaproveita a sessão salva em <data-dir>/auth/<host>.json.
// Sem sessão válida, abre o navegador VISÍVEL e espera o dev entrar (até 5 min);
// a sessão fica salva para as próximas capturas. O script nunca recebe senha.
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
  const host = new URL(url).host.replace(/[^\w.-]/g, '_');
  const authFile = dataDir ? path.join(dataDir, 'auth', `${host}.json`) : null;
  const hasAuth = authFile && fs.existsSync(authFile);
  const appOrigin = new URL(url).origin;
  const isLoginPage = (u) => /\/realms\/|\/protocol\/openid-connect\/|login-actions/.test(u);

  let browser = await launch(chromium, !!opt.headed);
  let context = await browser.newContext({ viewport, ...(hasAuth ? { storageState: authFile } : {}) });
  let page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  if (isLoginPage(page.url())) {
    if (!opt.headed) {
      // Sem sessão: reabre visível para o dev entrar.
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
    if (authFile) { fs.mkdirSync(path.dirname(authFile), { recursive: true }); await context.storageState({ path: authFile }); }
    if (page.url() !== url) await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  }

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
  await page.screenshot({ path: String(out), fullPage: false, animations: 'disabled' });
  await browser.close();
  console.log(JSON.stringify({ png: out }));
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

const run = { capturar, screenshot, comparar }[cmd];
if (!run) die('comando: capturar | screenshot | comparar');
run().catch((e) => die(e.stack || String(e)));
