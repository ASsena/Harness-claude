# Harness

Marketplace de plugins com os agentes e skills do meu pipeline de desenvolvimento.
O próprio repositório é o plugin `harness`, publicado no marketplace `assena`.

```
.claude-plugin/
  marketplace.json   ← catálogo (aponta para a raiz como plugin)
  plugin.json        ← manifesto do plugin "harness"
agents/              ← subagentes (harness:<nome>)
skills/<nome>/SKILL.md  ← skills (/harness:<nome>)
```

## Instalar

**Claude Code (CLI)**

```
/plugin marketplace add ASsena/Harness-claude
/plugin install harness@assena
```

Ou pelo shell: `claude plugin marketplace add ASsena/Harness-claude && claude plugin install harness@assena`.

**App Claude (claude.ai)**

Settings → Customize → Plugins → aba **Added** → **Add Marketplace** → adicionar a partir de repositório →
`https://github.com/ASsena/Harness-claude` → **Sync** → instalar `harness`.
Plugins ativados na conta claude.ai também chegam ao Claude Code quando você está logado com a mesma conta.

## Usar

Tudo fica com o prefixo do plugin:

| O quê | Como chamar |
| --- | --- |
| Pipeline completo de uma WI | `claude --agent harness:pipeline-agent` |
| Só planejar | `claude --agent harness:plan-task-agent` ou `/harness:plan-task <WI>` |
| Mockup de tela de uma WI | roda dentro do `/harness:plan-task`; avulso: `/harness:mockup-task <WI>` |
| Conferir a tela contra o mockup | roda na graduação quando o plano tem `visual_reference`; avulso: `/harness:verify-visual <plano>` |
| Skills avulsas | `/harness:spec-task`, `/harness:audit-task`, `/harness:revise`, `/harness:execute-implement`… |
| Subagentes | `harness:execute-task-agent`, `harness:graduation-agent`, `harness:code-reviewer-agent`, `harness:fix-task-agent`, `harness:visual-check-agent` |

## Navegador (Playwright MCP)

O plugin declara um servidor MCP do Playwright (`.mcp.json`, headless, perfil em memória) para a verificação visual. Só funciona no Claude Code (CLI/desktop), onde há Node; precisa de `npx` no PATH. Na primeira execução o Playwright pode pedir para baixar o Chromium (`npx playwright install chromium`).

## Atualizar

Edite aqui, faça push, e rode `/plugin marketplace update assena` no CLI (no app, **Sync**).
Sem `version` no `plugin.json`, cada commit novo vira a versão instalada.

## Validar

```
claude plugin validate .
```
