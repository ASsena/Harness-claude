---
name: spec-task
description: Redige, em conversa com o owner, a especificação completa de uma task para um desenvolvedor humano implementar (não um plano prescritivo para o Cursor). Produz o texto pronto para colar na descrição do Work Item no Azure Boards, incluindo a área de impacto que habilita a checagem de conflito entre devs. Use quando o owner pedir "/spec-task" ou quiser criar/detalhar uma task para distribuir ao time.
argument-hint: "descrição breve da funcionalidade, ou nº/slug de uma ideia já iniciada (opcional)"
disable-model-invocation: true
---

Ajuda o owner a especificar uma task **para um desenvolvedor implementar por conta própria** — diferente de um `.cursor/plans/*.plan.md`, que é prescritivo passo-a-passo para o Cursor executar. Aqui a spec descreve **o quê** e **por quê**, com critério de aceite testável; o **como** fica com o dev. Ver [ADR-0039](../../../docs/adr/0039-team-scaling-task-spec-and-review-workflow.md).

## 0. Como conduzir a conversa (disciplina da skill `grilling`)

Levantar o conteúdo (passo 1) e resolver conflitos de arquitetura (passo 2) segue a mesma disciplina da skill `grilling`, aplicada ao design da task em vez de a um plano de código:

- **Uma pergunta por vez.** Nunca acumule várias perguntas num só turno — é confuso. Espere a resposta do owner antes de seguir para a próxima.
- **Sempre traga uma recomendação.** Para cada pergunta, já venha com sua resposta sugerida (e o porquê) — o owner decide, mas não parte do zero.
- **Fato é seu trabalho, decisão é do owner.** Se algo pode ser respondido explorando o código/docs (ex.: "esse guard já existe?", "esse campo já é real ou mock?"), vá lá e descubra — não pergunte. Só leve ao owner o que é genuinamente uma escolha (trade-off, prioridade, corte de escopo).
- **Percorra a árvore de dependências.** Resolva uma decisão por vez, na ordem em que uma depende da outra — não pule pra uma decisão que depende de uma resposta ainda em aberto.
- **Não finalize sem entendimento compartilhado.** Só execute o passo 4 (criar Work Item + gravar o arquivo) depois que as perguntas abertas dos passos 1-2 estiverem resolvidas e o owner tiver confirmado. Se um conflito de arquitetura aparecer no meio do caminho (passo 2), pare e resolva antes de continuar — não empurre a decisão pra dentro da spec como ressalva e siga em frente.

## 1. Levantar o conteúdo com o owner

Pergunte (ou extraia do argumento, se dado) o suficiente para preencher:

- **Objetivo** — o que a task entrega, em 1-2 frases.
- **Contexto/motivação** — por que agora, que problema resolve. Se vier de um item já registrado (varredura de fechamento, gap de acceptance-criteria, ADR pendente), cite a fonte.
- **Escopo** — o que está dentro e o que está explicitamente fora (evita que o dev "melhore" além do pedido).
- **Critério de aceite** — lista numerada, cada item testável (comportamento observável, não implementação).
- **Área de impacto esperada** — módulos/projetos/endpoints que a task deve tocar. **Não é opcional**: é a base da checagem de conflito entre devs (ADR-0039 §4).

## 2. Ancorar na arquitetura vigente

Antes de finalizar, confira contra a hierarquia de fontes (`CLAUDE.md` §3): ADRs relacionados ao domínio tocado, rules do Cursor relevantes à área (`.cursor/rules/005-documentation-context-hierarchy.mdc` despacha por área), e o `scope.md`/`acceptance-criteria.md` da release corrente. Cite os ADRs/rules aplicáveis na spec — o dev que só olha o Work Item precisa saber onde procurar as regras do jogo, já que ele não lê `.cursor/rules/*` com a curadoria automática que o Cursor recebe.

**Se a task pedida conflitar com uma decisão já fixada em ADR** (ex.: automação vedada por um ADR, mudança de stack implícita) **— pare e aplique a skill `domain-modeling`**: isso é uma decisão do owner (grilling, um item por vez — §0), não algo para contornar em silêncio ou anotar como ressalva na spec. O critério de "quando oferecer ADR" da `domain-modeling` (difícil de reverter + surpreendente sem contexto + resultado de trade-off real) decide se o conflito vira emenda a um ADR existente, ADR novo, ou redução de escopo da task — apresente as opções ao owner como a `domain-modeling` faria, não decida sozinho.

## 3. Checar conflito com o que já está em andamento

Consulte o Azure Boards diretamente via MCP — `wit_query` com `action: "wiql"` e a query no parâmetro `wiql` — para saber quais tasks estão em andamento agora; não dependa da memória do owner.

**O estado real está em `[System.BoardColumn]`, não em `[System.State]`.** Neste board, `Requirement` fica com `System.State = "Active"` em **qualquer** coluna a partir de Ready-to-work; filtrar por `State` devolve tasks que ninguém pegou e faz tratar como intocável uma spec que ainda é editável. Peça a coluna e julgue por ela:

```sql
SELECT [System.Id], [System.Title], [System.BoardColumn], [System.AssignedTo]
FROM WorkItems
WHERE [System.TeamProject] = @project AND [System.State] = 'Active'
```

Só as colunas **depois** de Ready-to-work contam como "alguém já está mexendo" — até Ready-to-work a spec ainda é editável sem comunicar o dev. Se o MCP estiver indisponível na sessão, aí sim pergunte ao owner. Para cada task retornada, confira a área de impacto declarada dela (leia o `backlog/tasks/<id>-*.md` correspondente) contra a área da task nova; se houver branch ativa identificável, reforce comparando `git diff master..<branch> --stat`. Sobreposição não é proibitiva — pode virar dependência explícita (predecessor/blocked by no Azure Boards) em vez de bloqueio.

## 4. Produzir a spec — arquivo no repo é a fonte, Work Item é a projeção

Por decisão do [ADR-0039](../../../docs/adr/0039-team-scaling-task-spec-and-review-workflow.md) §1, a spec vive em **dois lugares com o mesmo conteúdo**, mas um é a fonte:

1. **Crie o Work Item via MCP** — `wit_work_item_write` com `action: "create"`, `project`, `workItemType` (conforme o board) e `fields` (lista de `{name, value}`, ex.: `System.Title`, `System.Description` com `format: "Markdown"`) — com o título e o conteúdo da spec na descrição — isso dá o ID definitivo usado no nome do arquivo. Se o MCP estiver indisponível na sessão, avise o owner para criar manualmente e informar o ID antes de gravar o arquivo.
2. **Grave o arquivo em `backlog/tasks/<id-do-work-item>-<slug>.md`** (crie a pasta se não existir) usando o ID retornado — esta é a referência canônica; é contra ela que o `/audit-task` audita quando os dois divergirem.
3. Se editar a spec depois de criada, atualize o Work Item também — `wit_work_item_write` com `action: "update"`, `id` e `updates` (lista de `{op, path, value}`, ex.: `path: "/fields/System.Description"`) — para manter os dois em sincronia — o arquivo do repo continua sendo a fonte em caso de divergência.

Formato (idêntico nos dois lugares):

```md
# {ID do Work Item, se já existir} — {título curto}

## Objetivo
{1-2 frases}

## Contexto
{motivação, fonte se houver}

## Escopo
**Dentro:** {...}
**Fora:** {...}

## Critérios de aceite
1. {testável}
2. {testável}
...

## Área de impacto esperada
{módulos/projetos/endpoints}

## Referências de arquitetura
{ADRs e rules aplicáveis, com link relativo}
```

Não inclua passos de implementação, escolha de algoritmo ou nomes de classes/métodos a criar — isso é decisão do dev. Se o owner insistir em detalhar "como", pergunte se não é o caso de ele mesmo pegar a task no modo "terceiro dev" (spec vira plano do Cursor, fluxo `/execute`+`/revise` de sempre).

## 5. Lembrete final

Diga ao owner:

- Nomeie a branch referenciando o ID do Work Item (ex. `feature/wi-1234-slug-curto`) — é o que habilita rastreabilidade e a checagem de conflito por diff mais adiante, no `/audit-task`.
- Se editar a spec depois (no Work Item ou no arquivo), atualize os dois — o arquivo do repo é o que conta em caso de divergência, mas deixar o Work Item desatualizado confunde quem só olha o board.
