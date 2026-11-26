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
| **1. Preparar** uma WI (mockup, plano, pré-análise, ondas, portões) | `claude --agent harness:plan-task-agent "<WI>"` |
| **2. Executar** a WI preparada (numa sessão nova) | `claude --agent harness:pipeline-agent "executar wi-<id>"` |
| Fatia nova numa WI já executada | preparo: `claude --agent harness:plan-task-agent "adicionar fatia wi-<id>: <demanda>"` → execução: `claude --agent harness:pipeline-agent "executar wi-<id> adicional-<n>"` |
| A branch andou depois do preparo | `claude --agent harness:plan-task-agent "revalidar wi-<id>"` |
| Só o plano, sem o preparo completo | `/harness:plan-task <WI>` |
| Mockup de tela de uma WI (sai como artefato) | roda dentro do preparo, no subagente `mockup-agent`; avulso: `/harness:mockup-task <WI>` |
| Conferir a tela contra o mockup | roda na graduação quando o plano tem `visual_reference`; avulso: `/harness:verify-visual <plano>` |
| Apoio (carregadas pelas outras) | `harness:plan-for-cursor` (régua do plano), `harness:grilling` (perguntas uma por vez), `harness:domain-modeling` (vocabulário e ADR) |
| Skills avulsas | `/harness:spec-task`, `/harness:audit-task`, `/harness:revise`, `/harness:execute-implement`… |
| Subagentes | `harness:mockup-agent`, `harness:execute-task-agent`, `harness:graduation-agent`, `harness:code-reviewer-agent`, `harness:fix-task-agent`, `harness:visual-check-agent` |

## Preparo × execução

O ciclo de uma WI roda em **duas sessões**:

1. **Preparo** (`plan-task-agent`): master em dia, branch, mockup + portão, plano, pré-análise, grafo de ondas + portão do plano, commit do plano. Entrega em `tmp/pipeline/wi-<id>/`: `estado.md` (`pronto para execução`), `preflight.md`, `ondas.md`.
2. **Execução** (`pipeline-agent`): confere a entrega com `scripts/conferir-entrega.mjs` (estado, portões registrados, plano intacto, SHA-base coerente, `HEAD` igual ao do preparo), confere se a trava de `platform/**` está liberada, implementa por ondas e chama o `graduation-agent`, que leva a WI até um PR para a master com a esteira verde (seção **Graduação**). Não planeja, não faz mockup, não edita o plano — se achar 🔴/🟡 no plano, para e pede `revalidar wi-<id>` no preparo.

O preparo faz **dois commits**: insumos (spec criada ou alterada) e depois o plano. O SHA-base do manifesto é o `HEAD` entre os dois — o único commit entre ele e a execução é o do plano, só em `.cursor/plans/**`.

## Trava de `platform/**` — só o dev libera

O `.claude/settings.json` do repositório nega `Edit`/`Write`/`NotebookEdit` em `platform/**`. **Liberar e restaurar a trava é sempre manual, do dev.** Nenhum agente nem skill edita esse arquivo, roda `git update-index --skip-worktree` nele ou o restaura.

- Trava ativa = nada grava em `platform/**` por nenhum meio — `Write`/`Edit`, shell ou script.
- O preparo nunca grava em `platform/**` (o mockup é um artefato, não um import no repo), então não precisa da trava liberada. A execução confere antes da primeira onda e não começa com a trava ativa.
- A mudança do dev em `.claude/settings.json` não conta como árvore suja e nunca entra em stage: todo commit confere `git diff --cached --name-only` antes.
- No fim do preparo e da execução, o relatório diz se a trava ficou liberada, para o dev restaurar quando quiser. Ela não vai no push: antes de cada pedido de push o `graduation-agent` confere que `.claude/settings.json` não está em nenhum commit da branch, e o pedido diz como a trava está.

Cada sessão é um run próprio no cronômetro e nos tokens; a execução começa com contexto limpo, sem precisar de `/clear`.

## Graduação: PR e esteira

O `graduation-agent` **não roda o gate local** (`run-gate.ps1`): o gate é a esteira do PR, que roda tudo, sempre, sobre o merge com a master atual. O fluxo:

1. **Checagem de compilação** — build + lint/verificações estáticas, **sem testes**, com os comandos tirados do YAML da esteira (mesma configuração). Roda antes da 1ª rodada de review, depois do merge da master e antes de todo push. Não é gate: só evita gastar uma volta da esteira com erro que um build acha em minutos.
2. **Review rodada 1 em duas lentes paralelas** — A (conformidade: Standards + Spec + estrutural) e B (correção: bugs, caminhos de erro, bordas, autorização, testes como prova) — mais a verificação visual. Rodadas 2–3 verificam os fixes.
3. **Merge da master** na branch da WI (como antes).
4. **Revisão final às cegas** — um revisor novo, que lê só o diff do PR (`master...HEAD`), a spec e as decisões do dev, sem pré-análise, relatórios ou rodadas anteriores. É o `/review-pr` em sessão separada, antes de o código sair da máquina; se o repositório tiver o `/review-pr`, a rubrica dele entra como lente.
5. **Pedido de permissão** — o agente grava `remoto-P<n>.md` (o quê, por quê, efeito, como desfazer, commits, trava, título e descrição do PR, comandos exatos) e para. O `pipeline-agent` pergunta ao dev (**Autorizar** · **Ajustar o PR** · **Não fazer agora**). Depois do "Autorizar", o hook ainda abre o diálogo em cada comando.
6. **Push + PR para a master** — só os comandos autorizados: `git push -u origin <branch>` (nunca `--force`) e a criação do PR (vinculado à WI, sem auto-complete, sem revisores). O PR fica aberto: concluir é do dev.
7. **Esteira** — `scripts/esteira-pr.mjs status` acompanha as políticas de build e status do PR para o SHA empurrado. Falhou: triagem (código da WI · conflito com a master · vermelho também na master · infraestrutura), correção com reprodução local, revisão da correção, checagem de compilação, novo pedido de permissão, push. Máx 2 correções; depois, escalação.

### `scripts/esteira-pr.mjs` — leitura da esteira

Só leitura (`az rest --method get` com `--output-file`); o que escreve no remoto fica fora dele, como comando visível para o hook.

```
node scripts/esteira-pr.mjs pr     --branch feature/wi-<id>-<slug>
node scripts/esteira-pr.mjs status --pr <id> --sha <sha> --aguardar 9 --saida tmp/pipeline/wi-<id>/esteira-C1.md
```

`status` devolve `0` verde · `1` falha · `2` pendente · `3` erro, e grava um resumo com as políticas, as etapas que falharam, o trecho do log com o erro, os testes vermelhos e a última build da master da mesma pipeline (para separar "a WI quebrou" de "a master já estava vermelha"). Logs completos em `esteira-logs/`. Organização, projeto e repositório saem do `git remote get-url origin`. Requer `az login` com acesso ao Azure DevOps.

Testes: `node --test scripts/esteira-pr.test.mjs` (usa um `az` falso; nada sai da máquina).

## Trava: master e repositório remoto

O plugin traz um hook (`hooks/trava-remoto.mjs`, roda antes de cada comando de shell e de cada ferramenta MCP do Azure DevOps/GitHub):

| Situação | O que acontece |
| --- | --- |
| `git commit`/`merge`/`cherry-pick`/`revert`/`rebase`/`pull` com a `master` (ou `main`) em checkout | **bloqueado** |
| `git push` que atinge a `master` (`HEAD:master`, `--all`, push sem refspec estando na master…), ou ferramenta MCP de push/merge/complete cujo input aponta a `master` como alvo | **bloqueado** |
| `git push` de outra branch, `az repos/boards/pipelines … create/update/delete…`, `az rest` não-GET, `gh pr create/merge/comment…`, `gh api` não-GET, HTTP não-GET para `dev.azure.com`, ferramenta MCP do Azure DevOps/GitHub que não seja get/list | **pede confirmação** — o agente explica o motivo antes, e o diálogo de permissão é a pergunta. O diálogo diz em voz alta quando o comando **força** o push, **conclui** o PR ou **liga o auto-complete** (lê o corpo do `az rest`, inclusive `--body @arquivo`) |
| `git fetch`, `pull --ff-only` na master, `az … list/show`, `az rest` GET, MCP get/list | passa |

A confirmação aparece mesmo com o comando liberado em `allowedTools`. Em sessão sem ninguém para responder (`claude -p`), a alteração é negada.
Concluir um PR pelo MCP normalmente só leva o id do PR, sem o branch alvo no input: nesse caso o hook **pede confirmação** (não bloqueia) — leia o alvo do PR no diálogo antes de aceitar.

Testes do hook: `node --test hooks/trava-remoto.test.mjs` (cria repositórios git temporários; não toca no seu).
`scripts/esteira-pr.mjs` não passa pelo hook porque só faz GET — por construção, não por opção.
Requer `node` no PATH (o mesmo do Playwright MCP).

## Tempo de cada fase

Toda sessão de preparo (`plan-task-agent`) e de execução (`pipeline-agent`) grava a duração de cada fase em
`%USERPROFILE%\.claude\brixbroker\pipeline-tempos.csv` (separador `;`, abre no Excel):
`run_id;wi;fase;tipo;inicio;fim;duracao_seg;duracao;status;nota`.
O tempo é carimbado por `scripts/log-fase.ps1` (relógio do sistema, não do modelo).
`tipo = espera` marca o tempo esperando o dev: portões, escalações, pedidos de permissão (`permissao-remoto`) e qualquer outra pergunta (`pergunta`). `tipo = esteira` marca o tempo esperando a esteira do PR (`esteira-C<n>`). O resumo separa os dois do tempo trabalhando. O preparo e a execução são runs separados (`nota` = `preparo` / `execução` na fase `pipeline`).
Resumo de um run: `powershell -File scripts/log-fase.ps1 -Acao resumo -WorkDir tmp/pipeline/wi-<id>`.

## Tokens

Durante um run do pipeline, hooks somam os tokens de cada subagente (`SubagentStop`) e da thread principal (`SessionEnd`, inclusive no `/clear`) em
`%USERPROFILE%\.claude\brixbroker\pipeline-tokens.csv`:
`run_id;wi;quando;fase;agente;agent_id;modelo;chamadas;input;cache_escrita;cache_leitura;output;contexto_total`.
Resumo: `node scripts/tokens.mjs resumo --workdir tmp/pipeline/wi-<id>`. Fora do pipeline, os hooks não registram nada.

Economia embutida:
- **Sessões separadas:** a execução roda numa sessão nova e lê só `estado.md`, `preflight.md`, `ondas.md` e o plano — nada do contexto do planejamento.
- **Mockup fora da thread principal:** capturas, PNGs e a montagem do mockup rodam no `mockup-agent` (Sonnet). O `plan-task-agent` (Opus) lê só o `tmp/pipeline/wi-<id>/mockup.md` e conduz o portão. Medido antes desta mudança, na WI 3778: o mockup respondia pela maior parte das chamadas da thread principal (63 leituras de arquivos do mockup e 58 chamadas ao `capturar-tela.mjs`).
- **Thread principal enxuta:** `plan-task-agent` e `pipeline-agent` têm uma seção "Contexto da thread principal": trabalho mecânico vai para subagente, saída grande vai para arquivo e se lê a fatia, e os portões gravam `estado.md` para permitir `/clear` + `continuar wi-<id>`.
- **Imagem recortada:** `capturar-tela.mjs screenshot --recorte x,y,w,h` salva só a região que a WI mudou, para conferir sem abrir a tela inteira.
- **Captura nunca lida inteira:** o hook `guarda-leitura` bloqueia `Read` em capturas de tela; o agente usa `pecas` / `extrair` / `substituir` / `css-de` do `capturar-tela.mjs`.

### Teto de contexto (configuração da máquina, não do plugin)

O custo de uma sessão é `chamadas × contexto acumulado`. Sem teto, a janela de 1M deixa a thread principal crescer até centenas de milhares de tokens sem compactar: nas sessões medidas antes desta mudança, o contexto mediano ficou entre 280k e 365k, e três quartos das chamadas passaram de 200k, a faixa de preço mais cara. No `~/.claude/settings.json`:

```json
"env": {
  "CLAUDE_CODE_DISABLE_1M_CONTEXT": "1",
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "200000"
}
```

Sem a segunda chave, o Claude Code avisa que o limite não é imposto e a sessão pode passar dele.

## Captura da tela real (mockups)

O `mockup-task` parte da tela **renderizada** do app, não do código: `scripts/capturar-tela.mjs` salva DOM + todo o CSS aplicado (inclusive o encapsulado do Angular e o do Material) + fontes num HTML que abre sozinho, idêntico ao app, e o mockup é a captura editada só na região da WI. `comparar` mede quanto o resto da tela mudou (alvo: ≤ 0,5%).

- Usa o Edge ou o Chrome instalados; dependências (`playwright-core`, `pngjs`, `pixelmatch`) vão para o diretório de dados do plugin na primeira execução.
- Login: automático com o usuário de dev do realm (`capturar-tela.mjs auth --realm-json ... --usuario ...`); a sessão (inclusive `sessionStorage`) fica salva fora do repo e é renovada a cada captura. Janela para login manual só como último recurso.
- **Um mockup só: o artefato.** A captura editada é montada em `tmp/mockup/wi-<id>-<slug>/<data>/` (fora do Git) e publicada direto como artefato do Claude — sem redesenho e sem cópia em `platform/frontend/_imports/`. Ajustes republicam o mesmo artefato. O plano aponta o artefato em `visual_reference` e a pasta local em `visual_local`; a spec carrega todos os valores verificáveis.
- Publicar exige a ferramenta de artefato (app Claude ou desktop). Sem ela, o agente pergunta se você revisa o arquivo local e publica depois.

## Navegador (Playwright MCP)

O plugin declara um servidor MCP do Playwright (`.mcp.json`, headless, perfil em memória) para a verificação visual. Só funciona no Claude Code (CLI/desktop), onde há Node; precisa de `npx` no PATH. Na primeira execução o Playwright pode pedir para baixar o Chromium (`npx playwright install chromium`).

## Atualizar

Edite aqui, faça push, e rode `/plugin marketplace update assena` no CLI (no app, **Sync**).
Sem `version` no `plugin.json`, cada commit novo vira a versão instalada.

## Validar

```
claude plugin validate .
```
