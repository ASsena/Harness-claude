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

## Trava: master e repositório remoto

O plugin traz um hook (`hooks/trava-remoto.mjs`, roda antes de cada comando de shell e de cada ferramenta MCP do Azure DevOps/GitHub):

| Situação | O que acontece |
| --- | --- |
| `git commit`/`merge`/`cherry-pick`/`revert`/`rebase`/`pull` com a `master` (ou `main`) em checkout | **bloqueado** |
| `git push` que atinge a `master` (`HEAD:master`, `--all`, push sem refspec estando na master…) ou concluir PR na master via MCP | **bloqueado** |
| `git push` de outra branch, `az repos/boards/pipelines … create/update/delete…`, `az rest` não-GET, `gh pr create/merge/comment…`, `gh api` não-GET, HTTP não-GET para `dev.azure.com`, ferramenta MCP do Azure DevOps/GitHub que não seja get/list | **pede confirmação** — o agente explica o motivo antes, e o diálogo de permissão é a pergunta |
| `git fetch`, `pull --ff-only` na master, `az … list/show`, `az rest` GET, MCP get/list | passa |

A confirmação aparece mesmo com o comando liberado em `allowedTools`. Em sessão sem ninguém para responder (`claude -p`), a alteração é negada.
Requer `node` no PATH (o mesmo do Playwright MCP).

## Tempo de cada fase

Toda execução do `pipeline-agent` grava a duração de cada fase em
`%USERPROFILE%\.claude\brixbroker\pipeline-tempos.csv` (separador `;`, abre no Excel):
`run_id;wi;fase;tipo;inicio;fim;duracao_seg;duracao;status;nota`.
O tempo é carimbado por `scripts/log-fase.ps1` (relógio do sistema, não do modelo).
`tipo = espera` marca o tempo esperando o dev nos portões e conflitos.
Resumo de um run: `powershell -File scripts/log-fase.ps1 -Acao resumo -WorkDir tmp/pipeline/wi-<id>`.

## Navegador (Playwright MCP)

O plugin declara um servidor MCP do Playwright (`.mcp.json`, headless, perfil em memória) para a verificação visual. Só funciona no Claude Code (CLI/desktop), onde há Node; precisa de `npx` no PATH. Na primeira execução o Playwright pode pedir para baixar o Chromium (`npx playwright install chromium`).

## Atualizar

Edite aqui, faça push, e rode `/plugin marketplace update assena` no CLI (no app, **Sync**).
Sem `version` no `plugin.json`, cada commit novo vira a versão instalada.

## Validar

```
claude plugin validate .
```
