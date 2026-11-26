// Acesso REST ao Azure DevOps para os scripts do harness (esteira-pr.mjs, criar-pr.mjs).
//
// Segue o padrão do CLAUDE.md do repositório: `fetch` em Node com o token de
// `az account get-access-token` — nunca texto passado ao `az` (no PowerShell 5.1 o az trunca
// argumento de várias linhas, corrompe caracteres fora do ASCII e imprime em cp1252).
//
// Variáveis só para os testes: ADO_BASE_URL (servidor falso) e ADO_TOKEN (pula o az).

import { execFileSync, execSync } from 'node:child_process';

export const ADO_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';

export class ErroAdo extends Error {}

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

// Organização, projeto e repositório: das opções ou do `git remote get-url origin`.
export function contexto(o = {}) {
  if (o.org && o.projeto && o.repo) return { org: o.org, projeto: o.projeto, repo: o.repo };
  let url = '';
  try { url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* sem remote */ }
  const c = parseRemote(url);
  if (!c) throw new ErroAdo(`Não reconheci o remote "${url}" como Azure DevOps; passe --org, --projeto e --repo.`);
  return { org: o.org || c.org, projeto: o.projeto || c.projeto, repo: o.repo || c.repo };
}

export function obterToken() {
  if (process.env.ADO_TOKEN) return process.env.ADO_TOKEN;
  const args = ['account', 'get-access-token', '--resource', ADO_RESOURCE, '--query', 'accessToken', '-o', 'tsv'];
  const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, windowsHide: true };
  try {
    // No Windows o az é um .cmd e precisa do shell; os argumentos são ASCII simples.
    const out = process.platform === 'win32' ? execSync(['az', ...args].join(' '), opts) : execFileSync('az', args, opts);
    const token = String(out).trim();
    if (!token) throw new Error('token vazio');
    return token;
  } catch (e) {
    const msg = String(e.stderr || e.message || '').trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' | ');
    throw new ErroAdo(`Não consegui o token do Azure DevOps (az account get-access-token): ${msg}. Rode \`az login\`.`);
  }
}

// Cliente do projeto: caminhos relativos a https://dev.azure.com/<org>/<projeto>.
export function criarCliente(ctx, { token = obterToken(), base = process.env.ADO_BASE_URL || 'https://dev.azure.com', fetchImpl = fetch } = {}) {
  const raiz = `${base.replace(/\/$/, '')}/${ctx.org}/${ctx.projeto}`;
  async function pedir(metodo, caminho, { corpo, texto = false } = {}) {
    const url = `${raiz}${caminho}`;
    let r;
    try {
      r = await fetchImpl(url, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: texto ? 'text/plain' : 'application/json',
          ...(corpo !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
        },
        ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
        signal: AbortSignal.timeout(60000),
      });
    } catch (e) {
      throw new ErroAdo(`Azure DevOps inalcançável (${metodo} ${caminho.replace(/\?.*/, '')}): ${e.cause?.code || e.message}`);
    }
    const txt = await r.text();
    if (!r.ok) {
      const dica = r.status === 401 || r.status === 403 ? ' — token sem acesso: rode `az login`' : '';
      let msg = txt.slice(0, 300);
      try { msg = JSON.parse(txt).message || msg; } catch { /* corpo não é JSON */ }
      throw new ErroAdo(`Azure DevOps: HTTP ${r.status} em ${metodo} ${caminho.replace(/\?.*/, '')}${dica}: ${msg}`);
    }
    if (texto) {
      try { const j = JSON.parse(txt); if (Array.isArray(j?.value)) return j.value.join('\n'); } catch { /* texto puro */ }
      return txt;
    }
    return txt ? JSON.parse(txt) : null;
  }
  return {
    get: (caminho, opts) => pedir('GET', caminho, opts),
    post: (caminho, corpo) => pedir('POST', caminho, { corpo }),
    webPr: (id) => `https://dev.azure.com/${ctx.org}/${ctx.projeto}/_git/${ctx.repo}/pullrequest/${id}`,
  };
}

export function lerOpcoes(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    o[k] = argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[++i];
  }
  return o;
}
