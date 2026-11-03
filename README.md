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
| Fatia nova numa WI já executada | `claude --agent harness:pipeline-agent "adicionar fatia wi-<id>: <demanda>"` |
| Só planejar | `claude --agent harness:plan-task-agent` ou `/harness:plan-task <WI>` |
| Mockup de tela de uma WI | roda dentro do `/harness:plan-task`; avulso: `/harness:mockup-task <WI>` |
| Conferir a tela contra o mockup | roda na graduação quando o plano tem `visual_reference`; avulso: `/harness:verify-visual <plano>` |
| Apoio (carregadas pelas outras) | `harness:plan-for-cursor` (régua do plano), `harness:grilling` (perguntas uma por vez), `harness:domain-modeling` (vocabulário e ADR) |
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

## Tokens

Durante um run do pipeline, hooks somam os tokens de cada subagente (`SubagentStop`) e da thread principal (`SessionEnd`, inclusive no `/clear`) em
`%USERPROFILE%\.claude\brixbroker\pipeline-tokens.csv`:
`run_id;wi;quando;fase;agente;agent_id;modelo;chamadas;input;cache_escrita;cache_leitura;output;contexto_total`.
Resumo: `node scripts/tokens.mjs resumo --workdir tmp/pipeline/wi-<id>`. Fora do pipeline, os hooks não registram nada.

Economia embutida:
- **Pausa planejada:** depois do plano aprovado, o pipeline pede `/clear` + `continuar wi-<id>`; a execução começa só com o plano, sem o contexto do planejamento.
- **Captura nunca lida inteira:** o hook `guarda-leitura` bloqueia `Read` em capturas de tela; o agente usa `pecas` / `extrair` / `substituir` / `css-de` do `capturar-tela.mjs`.

## Captura da tela real (mockups)

O `mockup-task` parte da tela **renderizada** do app, não do código: `scripts/capturar-tela.mjs` salva DOM + todo o CSS aplicado (inclusive o encapsulado do Angular e o do Material) + fontes num HTML que abre sozinho, idêntico ao app, e o mockup é a captura editada só na região da WI. `comparar` mede quanto o resto da tela mudou (alvo: ≤ 0,5%).

- Usa o Edge ou o Chrome instalados; dependências (`playwright-core`, `pngjs`, `pixelmatch`) vão para o diretório de dados do plugin na primeira execução.
- Login: automático com o usuário de dev do realm (`capturar-tela.mjs auth --realm-json ... --usuario ...`); a sessão (inclusive `sessionStorage`) fica salva fora do repo e é renovada a cada captura. Janela para login manual só como último recurso.
- No app Claude, o mesmo arquivo é publicado como artefato para revisão — sem redesenho.

## Navegador (Playwright MCP)

O plugin declara um servidor MCP do Playwright (`.mcp.json`, headless, perfil em memória) para a verificação visual. Só funciona no Claude Code (CLI/desktop), onde há Node; precisa de `npx` no PATH. Na primeira execução o Playwright pode pedir para baixar o Chromium (`npx playwright install chromium`).

## Atualizar

Edite aqui, faça push, e rode `/plugin marketplace update assena` no CLI (no app, **Sync**).
Sem `version` no `plugin.json`, cada commit novo vira a versão instalada.

## Validar

```
claude plugin validate .
```
