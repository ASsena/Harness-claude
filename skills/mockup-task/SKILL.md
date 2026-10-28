---
name: mockup-task
description: Gera o mockup das mudanças visuais de um Work Item reaproveitando os componentes que já existem no app e seguindo o design system do repo, e trava até o dev aprovar. Sai um HTML versionado em docs/mockups/ (fonte) e, quando a sessão oferece, um artefato Claude Design para revisão. Chamada pelo /plan-task quando a WI mexe em tela; também roda avulsa com "/mockup-task" seguido do número da WI.
argument-hint: "nº do Work Item do Azure Boards (ex.: 2538)"
---

Transforma o pedido visual de uma WI em **mockup aprovado pelo dev**, montado com as peças que o app já tem. Entra um número de WI (ou a WI já lida pelo `/plan-task`); sai `docs/mockups/wi-<id>-<slug>.html` aprovado e, quando possível, um artefato Claude Design espelhando esse HTML.

**O que esta skill não faz:** não escreve código de produto (`CLAUDE.md` §2), não cria componente novo no app, não altera o design system. Mockup é especificação — quem implementa é o `/execute`.

**Quando é chamada pelo `/plan-task`**, a WI já foi lida (§1 de lá): reaproveite o que foi lido, não busque de novo. Avulsa, leia a WI exatamente como o `/plan-task` §1 manda (MCP `azure-devops`, fallback `az rest --output-file`), incluindo anexos e comentários.

---

## 1. A WI exige mudança visual? — decida antes de desenhar

Sinais de que exige:

- descrição, critério de aceite ou comentário fala de tela, página, modal, botão, campo, coluna, filtro, card, mensagem exibida, layout ou responsividade;
- anexo é print, wireframe ou protótipo;
- a área de impacto (`backlog/tasks/<id>-<slug>.md`) inclui views, componentes ou estilos.

Sem nenhum sinal: devolva "sem mudança visual" ao chamador e pare. Sinal fraco ou só indireto (ex.: "retornar o campo X na API" — vai aparecer em alguma tela?) é pergunta ao dev pela régua dos 95% do `/plan-task` §4, não suposição.

**Print anexado é referência, não gabarito.** Ele mostra a intenção; o mockup traduz essa intenção para os componentes e tokens do app. Onde o print divergir do design system, o design system vence — e a divergência vai para o dev ver (§5).

---

## 2. Mapear o design system — uma vez, depois só conferir

O mapa vive em `docs/mockups/_design-system.md`. Ele é o atalho das próximas rodadas.

**Se o arquivo já existe:** confira que os caminhos citados nele ainda existem e rode `git log --since=<data do mapa> -- <caminhos>`. Mudou algo? Atualize só a parte afetada. Nada mudou? Siga para o §3.

**Se não existe:** descubra no repo. Fato é seu trabalho — vá ao código antes de perguntar.

| Procure | Onde costuma estar |
|---|---|
| Tokens (cores, tipografia, espaçamento, raio, sombra, breakpoints) | variáveis CSS em `:root`, `_variables.scss`/`tokens.*`, `tailwind.config.*`, tema da biblioteca de UI |
| Folha de estilo compilada que o app serve | `wwwroot/`, `public/`, `dist/`, saída do build referenciada no layout principal |
| Biblioteca de componentes de terceiros | `package.json`, `.csproj` (ex.: Bootstrap, MudBlazor, Radzen, Material) |
| Componentes próprios do app | pastas `components/`, `Shared/`, `ui/`, partials e view components reutilizados por mais de uma tela |
| Layout base (shell, menu, cabeçalho, grid de página) | layout principal (`_Layout`, `MainLayout`, `App`, `layout.*`) |
| Decisões e regras de front-end | `docs/adr/` (busque por UI, front, layout, design), rules do Cursor da área via `.cursor/rules/005-documentation-context-hierarchy.mdc` |

Grave o mapa com: data, stack de front-end, onde estão os tokens (com os valores principais), qual folha de estilo o mockup deve carregar e por qual caminho relativo, e o **catálogo de componentes** — para cada um: nome, caminho, para que serve, variações/props que importam. **Mostre o mapa ao dev e peça confirmação** antes de usá-lo pela primeira vez: um mapa errado contamina todo mockup seguinte.

---

## 3. Escolher as peças — reaproveitar antes de inventar

Antes de desenhar, abra a tela atual que a WI altera (ou a tela mais parecida, se for nova) e liste o que ela já usa.

Para cada elemento que o pedido exige, nesta ordem:

1. **Componente do catálogo que serve como está** → usa.
2. **Serve com uma variação que ele já suporta** (prop, modificador, slot) → usa, dizendo qual variação.
3. **Quase serve, mas precisaria mudar o componente** → isso é pergunta ao dev (estender o existente × criar novo), com recomendação. Mudar componente compartilhado afeta outras telas: levante quais.
4. **Nada serve** → componente novo, **montado só com tokens do design system** e marcado como novo.

Nunca invente cor, fonte, espaçamento ou raio fora dos tokens. Se o pedido precisar de um valor que o design system não tem, é pergunta ao dev, não um hex solto.

---

## 4. Montar o mockup

**Fonte:** `docs/mockups/wi-<id>-<slug>.html`, um arquivo só.

- Carregue a folha de estilo real do app pelo caminho relativo do mapa. Se ela só existe depois do build, copie para um `<style>` os tokens e as classes que o mockup usa, com comentário apontando o arquivo de origem.
- Reproduza a **marcação e as classes reais** dos componentes reaproveitados, para o mockup ficar idêntico ao que o app renderiza.
- Marque cada bloco: `data-componente="<caminho do componente>"` quando reaproveitado, `data-novo="<nome proposto>"` quando novo, `data-variacao="..."` quando usar variação. É isso que o plano e o review leem depois.
- Inclua os **estados**: padrão, vazio, carregando e erro (e os de validação, se houver formulário), alternáveis por abas no topo. Estado que a WI não definiu é pergunta ao dev, não invenção.
- Se o design system tem breakpoints, mostre desktop e mobile.
- Dados fictícios, mas plausíveis e com o **vocabulário canônico** (`CLAUDE.md` §5: Lead × Contact × Opportunity × Customer…). Nada de dado real de cliente.
- Cabeçalho em comentário HTML: WI, data, status (`rascunho` ou `aprovado em <data>`), fontes usadas.
- Um botão "mostrar anotações" que destaca cada bloco com o rótulo *reaproveitado: X* ou *novo: Y*.

**Artefato para revisão:** se a sessão oferecer o tipo **Design** no Artifact (app Claude), crie um a partir dele com o mesmo conteúdo e passe o link ao dev. Se houver um Design System publicado como artefato e marcado como padrão, use-o. No CLI ou sem o tipo Design, siga só com o HTML e diga isso ao dev. **O HTML do repo é a fonte:** ajuste pedido no canvas volta para o HTML antes da aprovação.

---

## 5. Aprovação — trava o plano

Apresente ao dev, curto:

- o link do artefato (quando houver) e o caminho do HTML;
- tabela das peças: elemento → componente reaproveitado / variação / novo;
- divergências entre o print anexado e o design system, e qual lado o mockup seguiu;
- o que você decidiu sozinho por ser fato do repo, e o que ainda é pergunta.

Perguntas pendentes seguem a régua dos 95%: **uma por vez, sempre com recomendação**. Itere até o dev aprovar. Com a aprovação, mude o status do cabeçalho para `aprovado em <data>`.

**Sem aprovação, o `/plan-task` não grava o plano.** Mockup em rascunho não entra em commit.

---

## 6. Devolver ao chamador

Ao `/plan-task` (ou ao dev, quando avulsa), devolva:

- caminho do HTML aprovado e de `docs/mockups/_design-system.md` se ele foi criado ou atualizado;
- a lista de componentes reaproveitados (com caminho), variações usadas e componentes novos;
- as decisões tomadas com o dev, uma linha cada — viram "Decisões (não reabrir)" no plano.

Avulsa, não commite sozinha: pergunte se vai para a branch da WI (`feature/wi-<id>-<slug>`). Dentro do `/plan-task`, o commit é o dele (§6 de lá).
