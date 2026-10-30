#!/usr/bin/env node
// PreToolUse em Read: bloqueia a leitura inteira de capturas de tela do mockup.
// Uma captura carrega todo o CSS do app (centenas de KB) — lida inteira, custa
// dezenas de milhares de tokens e fica no contexto pelo resto da sessão.
// O caminho certo são os comandos pecas / extrair / substituir do capturar-tela.mjs.

import fs from 'node:fs';

let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
const file = input?.tool_input?.file_path;
if (!file || !/\.html?$/i.test(file)) process.exit(0);

let head = '';
try {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(600);
  const n = fs.readSync(fd, buf, 0, 600, 0);
  fs.closeSync(fd);
  head = buf.subarray(0, n).toString('utf8');
} catch { process.exit(0); }

if (!/<meta name="captura"/.test(head)) process.exit(0);

let kb = 0;
try { kb = Math.round(fs.statSync(file).size / 1024); } catch { /* tamanho desconhecido */ }
const s = '"${CLAUDE_PLUGIN_ROOT}/scripts/capturar-tela.mjs"';
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      `Este arquivo é uma captura de tela do mockup (${kb} KB, com todo o CSS do app). Não leia inteiro. Use:\n` +
      `- node ${s} pecas --arquivo "<html>"  → lista os componentes da tela e um seletor de cada\n` +
      `- node ${s} extrair --arquivo "<html>" --seletor "<css>"  → só o trecho que importa\n` +
      `- node ${s} substituir --arquivo "<html>" --seletor "<css>" --com <fragmento.html> [--modo trocar|antes|depois|dentro]`,
  },
}));
process.exit(0);
