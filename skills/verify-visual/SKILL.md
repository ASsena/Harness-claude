---
name: verify-visual
description: Abre o app e o mockup aprovado no navegador (Playwright MCP, headless) e confere se a tela implementada está fiel às decisões visuais da WI — estrutura, componentes broker-*, valores de token/px, copy e estados —, produzindo achados com evidência no mesmo formato do /execute-review. Usada pelo visual-check-agent dentro da graduação quando o plano tem visual_reference; também roda avulsa com "/verify-visual" e o caminho do plano.
argument-hint: "caminho do plano .cursor/plans/*.plan.md (opcional: rodada)"
---

Automatiza a "verificação manual com o mockup aberto ao lado" que os planos de tela pediam (ex.: `wi_3227_sidebar_menu_conta-correcoes.plan.md`, item C8). Entra o plano; sai `visual-R<N>.md` com achados verificados no navegador.

**O que esta skill não faz:** não escreve nem corrige código (`CLAUDE.md` §2 — quem corrige é o `/execute-fix`), não roda testes nem o gate, não commita, não altera banco, seed ou realm para "forçar" um estado, não grava credencial em lugar nenhum.

---

## 1. Entradas

- **Plano** — o `visual_reference:` do frontmatter aponta o **artefato** do mockup (o único mockup; não há cópia no repo) e o `visual_local:` aponta o HTML da Decisão na pasta de trabalho local de onde ele foi publicado. Sem `visual_reference` e sem fatia de tela citando mockup: devolva "sem verificação visual" e pare. Plano antigo com `visual_reference` apontando para `_imports/claude-design/` no repo: use esse caminho como a pasta local.
- **Fontes das decisões**, nesta precedência: a §Especificação visual da spec (`backlog/tasks/<id>-<slug>.md`) → o `notes.md` do mockup → o HTML da Decisão. A spec é a fonte; o mockup é insumo (ADR-0011).
- **Pasta local do mockup** — `<pasta do mockup>` é a pasta `original/` que contém o HTML da Decisão, com os estados, `assets/` e `<Tela> - base.referencia.png` (o `notes.md` fica na pasta pai, localmente, ou ao lado da Decisão, quando baixado do artefato). Obtenha nesta ordem:
  1. o `visual_local` do plano, se existir nesta máquina;
  2. senão, baixe do artefato com a ferramenta `Artifact` (`action: "list"`, `scope: "files"` com a URL do `visual_reference` para ver os caminhos; depois `action: "read"` com `paths` e `out_dir` = `tmp/pipeline/wi-<id>/visual/mockup/`);
  3. sem pasta local e sem a ferramenta `Artifact`: veredicto "Escalado ao dev" — não reconstrua o mockup e não o compare de memória.
- **Pasta de trabalho** `tmp/pipeline/wi-<id>/` e a **rodada**, informados pelo orquestrador. Avulsa: crie a pasta e use rodada 1.
- **Rodada N > 1:** leia `visual-R<N-1>.md` e os `fix-R<N-1>-*.md` para o de-para (§7).
- **Rodada `M<n>-r<r>`** (conflito de merge resolvido em tela): confira só a região dos arquivos de conflito do `merge-M<n>.md`; saída `visual-M<n>-r<r>.md`, IDs `VM<n>.<r>-XX`.

---

## 2. Montar o checklist antes de abrir o navegador

Uma linha por coisa verificável:

| Fonte | Vira item |
|---|---|
| Cada decisão `D<n>` | posição, ordem, tamanho (px), token de cor (com o valor), tipografia, gap, copy exata, aria |
| Cada `data-componente` / `data-novo` do HTML da Decisão (liste com `node "${CLAUDE_PLUGIN_ROOT}/scripts/capturar-tela.mjs" pecas --arquivo "<Decisão>" --data-dir "${CLAUDE_PLUGIN_DATA}"` — **nunca** `Read` na captura; o hook bloqueia) | o bloco existe na tela, na mesma região, com o componente decidido |
| Cada estado do mockup | padrão, vazio, carregando, erro, validação (um arquivo `… - Decisão - <estado>.html` por estado) |
| Larguras | desktop (1440×900) e, se o mockup tiver, a estreita (390×844) |

Para cada item, diga **como** verificar: estilo computado, presença no DOM, texto, ou comparação visual. Item que nenhuma fonte define com valor não é verificável — registre como tal, não invente o gabarito. **"Colisões aceitas" do `notes.md` não são achados.**

---

## 3. Ambiente — reaproveitar antes de subir

Portas, proxies e comandos estão em `platform/frontend/README.md` e `platform/backend/README.md` — leia de lá, não desta skill.

1. **O app já responde?** Requisite a URL local da app (ex.: `broker-web` em `http://localhost:4201/`). Respondendo, use o que está de pé.
2. **Não responde:** suba em background, cada um com log em `tmp/pipeline/wi-<id>/visual/logs/`:
   - backend pelo AppHost (`dotnet run --project src\Apps\Insurtech.AppHost`, em `platform/backend`);
   - a app com `npx ng serve <app>` (em `platform/frontend`).
   Espere a porta responder e o build do Angular terminar sem erro.
3. **Mockup:** o Playwright MCP bloqueia `file://`, e o artefato hospedado exige login no claude.ai, que o navegador isolado não tem. Sirva a `<pasta do mockup>` localmente: `npx -y http-server "<pasta do mockup>" -p 4499 -a 127.0.0.1 -c-1`.
4. **Registre em `visual-servidores.md`** só o que **você** subiu (comando, PID, porta, log). O orquestrador derruba no fim da graduação. **Nunca derrube servidor que você não subiu.**

O ambiente não sobe (Docker parado, porta ocupada por outra coisa, build quebrado)? Isso **não é achado de código**: veredicto "Escalado ao dev" com o trecho do log que mostra o motivo.

---

## 4. Login

`broker-web` e `admin-web` usam Keycloak com Authorization Code + PKCE: a tela de usuário e senha é a do Keycloak, alcançada pelo proxy `/auth` do `ng serve`.

- Use um **usuário de desenvolvimento** definido nos JSON de realm do AppHost (`platform/backend/src/Apps/Insurtech.AppHost/keycloak/realms/`), do realm e do perfil que enxergam a tela.
- **De onde vem a senha:** primeiro das variáveis `HARNESS_LOGIN_USER`/`HARNESS_LOGIN_PASSWORD`, se o dev as exportou; senão, do JSON do realm, lendo **só** o usuário escolhido. Ao contrário do `capturar-tela.mjs auth` (que loga sem mostrar a senha), aqui o login é pelo Playwright MCP e a senha passa pela ferramenta de digitação do navegador — é o único lugar onde ela pode aparecer.
- O navegador do MCP roda em perfil isolado (`--isolated`): a sessão salva pelo `capturar-tela.mjs` não é reaproveitada, e cada rodada faz login de novo.
- Nunca use credencial real, nunca crie usuário, nunca escreva a senha em relatório, log, arquivo ou prompt de outro agente.
- Não há usuário de dev com senha para esse perfil? Escale ao dev; não contorne.

---

## 5. Capturar — mockup e app no mesmo enquadramento

Ferramentas do Playwright MCP do plugin (`mcp__plugin_harness_playwright__*`; se estiverem adiadas, carregue com ToolSearch): `browser_resize`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_take_screenshot`, `browser_evaluate`, `browser_wait_for`, `browser_network_requests`.

Para cada largura × estado:

1. **Mockup:** abra o HTML do estado (`http://127.0.0.1:4499/<Tela> - Decisão[ - <estado>].html`; imports antigos podem ter abas no topo em vez de um arquivo por estado), capture `mock-<estado>-<largura>.png`.
2. **App:** navegue até a rota da tela, chegue ao estado, capture `app-<estado>-<largura>.png`.

Chegar aos estados:

- **padrão:** dados do seed local;
- **vazio:** um filtro sem resultado ou um contexto sem dados, se a tela permitir;
- **carregando / erro:** intercepte a resposta **dentro do navegador** — `browser_run_code_unsafe` com `page.route(...)` atrasando a chamada ou devolvendo 500 para a rota da API daquela tela. Use só para isso, só contra o app local. Se não der, o item fica **não verificado** — nunca altere código, banco ou API para provocar o estado.

Registre no relatório o caminho de cada captura que a ferramenta devolver.

---

## 6. Comparar — estrutura e valores, com a imagem como apoio

Dados fictícios do mockup nunca batem com os do app: **diferença de dado não é achado.** O que se compara:

- **Estrutura:** cada `data-componente` tem o componente correspondente na região certa da tela (ex.: `browser_evaluate` com `querySelector('broker-select')` dentro do contêiner da barra de filtros), na ordem decidida.
- **Valores:** `getComputedStyle` do elemento — largura, altura, `font-size`, `font-weight`, `color`, `gap`, `padding`. Token: resolva com `getComputedStyle(document.documentElement).getPropertyValue('--md-…')` e compare o valor final. Tolerância de 1px; cor normalizada em `rgb()`.
- **Copy:** rótulos, títulos, mensagens de vazio e erro — texto exato da spec.
- **Fora da região que a WI muda**, a tela tem de seguir igual: compare a captura do app com o `"<Tela> - base.referencia.png"` da `<pasta do mockup>` usando `node "${CLAUDE_PLUGIN_ROOT}/scripts/capturar-tela.mjs" comparar --a … --b … --ignorar "<região alterada>" --data-dir "${CLAUDE_PLUGIN_DATA}"`. Diferença ali (que não seja dado) é regressão: achado 🟡, ou 🔴 se quebrou layout.
- **Imagem:** olhe as duas capturas lado a lado para alinhamento, sobreposição, truncamento e quebra de linha que as medições não pegam.

Rotule cada item como **`[visto]`** (observado no navegador, com evidência) ou **`[raciocinado]`**. **Achado só nasce de `[visto]`.**

---

## 7. Classificar

Mesmo esquema do `/execute-review` §3, para o `/execute-fix` consumir sem adaptação:

- **ID:** `V<rodada>-<nn>` (ex.: `V1-01`). **Eixo:** `Visual`.
- 🔴 **Bloqueante** — elemento ou estado ausente, componente diferente do decidido, copy errada, layout quebrado (sobreposição, overflow não aceito nas colisões).
- 🟡 **Importante** — elemento certo com valor fora: px, token, gap, ordem, tipografia.
- 🔵 **Sugestão** — diferença perceptível que nenhuma decisão cobre. **Não vai para o fix**; fica para o dev decidir.

Cada achado traz: tela/rota, largura, estado, seletor, **esperado × observado**, as capturas como evidência, o **arquivo provável** a corrigir (pela fatia do plano) e a **correção esperada**, concreta.

**Rodada N > 1:** comece pela tabela de de-para dos `V<N-1>-*` (✅ resolvido · ⚠️ parcial · ❌ não resolvido · 🔄 regressão), como no `/execute-review` §4. Parcial, não resolvido e regressão ganham ID novo.

---

## 8. Relatório — `tmp/pipeline/wi-<id>/visual-R<N>.md`

```markdown
# Verificação visual — Rodada <N>

- **Plano:** <caminho> · **visual_reference:** <caminho>
- **HEAD:** <sha> · **App:** <app> em <url> · **Larguras:** <lista>
- **Servidores:** reaproveitados | subidos por mim (ver visual-servidores.md)

## Status dos achados anteriores
<tabela — omitir na rodada 1>

## Achados desta rodada
### 🔴 Bloqueantes
- **V<N>-01** [Visual] `<arquivo provável>` — <rota · largura · estado> <descrição>. Esperado: <x>. Observado: <y> [visto]. Evidência: <capturas>. Correção esperada: <o que fazer>.
### 🟡 Importantes
### 🔵 Sugestões (não vão para fix)

## Não verificado
| Item | Motivo |

## Checklist
<N itens · N ok [visto] · N com achado · N não verificados>

## Veredicto
- [ ] ✅ **Aprovado** — nenhum 🔴 ou 🟡.
- [ ] 🔧 **Fix necessário** — <N> achado(s) 🔴/🟡.
- [ ] 🚨 **Escalado ao dev** — <ambiente, credencial ou decisão ambígua>.
```

"Não verificado" não reprova a rodada, mas tem de chegar ao dev no relatório final da graduação — nunca some.
