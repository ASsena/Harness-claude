---
name: plan-task
description: Lê um Work Item do Azure Boards pelo número (descrição, critérios de aceite, anexos, comentários e itens ligados), analisa o pedido contra a arquitetura vigente, resolve com o dev tudo que ficar abaixo de 95% de certeza e produz o plano do Cursor em `.cursor/plans/*.plan.md`, commitado na branch de trabalho. Use quando o dev pedir "/plan-task" seguido do número da WI.
metadata:
  argument-hint: "nº do Work Item do Azure Boards (ex.: 2538)"
  disable-model-invocation: true
---

Transforma um Work Item em **plano executável pelo Cursor**. Entra um número; sai um `.cursor/plans/wi_<id>_<slug>.plan.md` commitado, mais o `backlog/tasks/<id>-<slug>.md` quando ele ainda não existir.

**O que esta skill não faz:** não escreve código de produto (`CLAUDE.md` §2 — não há exceção para "só uma string" nem para "fix trivial"), não roda `/execute`, não fecha a WI no board. O ciclo completo é `/plan-task` → `/execute` (Cursor) → `/revise`.

---

## 1. Ler a WI inteira — descrição não é o pedido todo

Org `confitecDevOps`, projeto `brixbroker`.

**Caminho preferencial (MCP `azure-devops`):**

- `wit_work_item` com `action: "get"`, `id`, `project: "brixbroker"`, `expand: "All"` — traz campos **e** `relations` (anexos e links).
- `wit_work_item` com `action: "list_comments"`, `workItemId` — comentários.
- `wit_work_item_attachment` com `attachmentId`, `fileName` e, para binário, `savePath` — **só caminho relativo** (o servidor rejeita absoluto e `..`), resolvido a partir do cwd do servidor MCP. Sem `savePath`, texto volta como texto e imagem volta como recurso visualizável.

**Fallback verificado (MCP fora do ar — acontece):** `az` já está logado e não precisa da extensão `azure-devops` (ela **não** está instalada; `az boards` não funciona aqui). Use `az rest` com o resource do Azure DevOps:

```bash
az rest --resource 499b84ac-1321-427f-aa17-267ca6975798 --method get \
  --url 'https://dev.azure.com/confitecDevOps/brixbroker/_apis/wit/workitems/<ID>?$expand=all&api-version=7.1' \
  --output-file "<scratchpad>/wi<ID>.json"
```

**Use sempre `--output-file`.** Redirecionar o stdout do `az` (`> arquivo`) perde os acentos — o console sai em cp1252 e o `az` descarta os caracteres ("recém" vira "recm"). Comprovado nos dois modos. Comentários: mesmo comando com `/_apis/wit/workItems/<ID>/comments?api-version=7.1-preview.4`. Anexo: `--url '<url do relation>?fileName=<nome>' --output-file <destino>`.

Anexos baixados vão para o **scratchpad da sessão**, nunca para dentro do repo.

**O que ler, além da descrição:**

| Onde | Por que importa |
|---|---|
| `System.Description` | vem em **Markdown**, com entidades HTML (`&quot;`) — decodifique antes de citar |
| `Microsoft.VSTS.Common.AcceptanceCriteria` | quando preenchido, é o critério que o `/audit-task` vai cobrar |
| `System.BoardColumn` | o estado real; `System.State = "Active"` também vale para Ready-to-work |
| `relations` → `rel: "AttachedFile"` | anexo: GUID é o último segmento da `url`, nome em `attributes.name` |
| `relations` → `Hierarchy-Reverse` / `Related` | leia ao menos título e objetivo das WIs ligadas — é onde mora o escopo vizinho que o plano não deve invadir |
| `relations` → `ArtifactLink` (PR/Commit) | trabalho já feito nessa WI. Se houver, **pare e confirme com o dev** antes de planejar do zero |
| comentários | vêm em **HTML**; é comum a mudança de escopo mais recente estar ali, não na descrição |

**Anexo é insumo de primeira classe.** Print de tela, planilha, PDF de spec: abra e leia. Se um anexo for um formato que você não consegue ler (binário proprietário, por exemplo), diga qual é e peça o conteúdo ao dev — não planeje por cima do buraco.

---

## 2. Reconciliar com a fonte canônica no repo

Por [ADR-0039](../../../docs/adr/0039-team-scaling-task-spec-and-review-workflow.md) §1 a spec vive em dois lugares, e **o arquivo do repo é a fonte**; a WI é a projeção.

- **Arquivo existe e bate com a WI:** siga.
- **Arquivo existe e diverge:** o arquivo vence — mas a divergência é **pergunta ao dev** (§4), não algo para resolver em silêncio. Divergência costuma significar que alguém editou a WI no board depois.
- **Arquivo não existe:** materialize `backlog/tasks/<id>-<slug>.md` a partir da WI, no formato do `/spec-task` §4 (Objetivo · Contexto · Escopo · Critérios de aceite · Área de impacto · Referências de arquitetura). Ele entra no mesmo commit do plano. Se a WI não tiver material para preencher **Critérios de aceite** ou **Área de impacto**, isso é lacuna — resolva com o dev antes de gravar, não invente para completar o formulário.

Se a WI estiver em coluna **depois** de Ready-to-work e atribuída a outra pessoa, avise o dev antes de planejar: pode haver outro dev no meio.

---

## 3. Ancorar na arquitetura vigente antes de planejar

Antes de desenhar qualquer fatia, percorra a hierarquia do `CLAUDE.md` §3 pelas áreas que a WI toca:

- **ADRs vigentes da área** (`docs/adr/`, resumo em `docs/governance/vocabulario-e-decisoes.md` §2) — inclusive as armadilhas com reincidência conhecida.
- **Rules do Cursor da área**, despachadas por `.cursor/rules/005-documentation-context-hierarchy.mdc`. Lembre da assimetria: o Cursor recebe metade delas por `globs`; **para você não chega nenhuma**. Rule não aberta é rule não checada.
- **Release corrente**: `docs/roadmap/release-map.md` e o `scope.md`. Se a WI pedir algo de release futura, isso é congelamento (`CLAUDE.md` §2, T93) — leve ao dev, não planeje por cima.
- **Vocabulário canônico** antes de nomear qualquer coisa (`CLAUDE.md` §5): Lead × Contact × Opportunity × Customer, papéis × unidades de venda, Ticket × Ação.

**Se o pedido conflitar com um ADR vigente**, pare e aplique a skill `domain-modeling` — o conflito vira emenda a ADR, ADR novo ou corte de escopo, e a escolha é do dev. Nunca vire ressalva dentro do plano.

---

## 3a. Mudança visual? — mockup antes das fatias

Se a WI mexe em tela (critérios no §1 da skill `mockup-task`), carregue a skill `mockup-task` com a tool Skill e execute-a nesta thread, reaproveitando a WI já lida. O mockup precisa estar **aprovado pelo dev** antes de você escrever as fatias: sem aprovação, o plano não é gravado. As decisões fechadas no mockup entram em "Decisões (não reabrir)".

---

## 4. A régua dos 95% — bloqueia e pergunta

Qualquer ponto em que a certeza fique abaixo de **95%** trava a gravação do plano. Disciplina da skill `grilling`, igual ao `/spec-task` §0:

- **Uma pergunta por vez.** Espere a resposta antes da próxima.
- **Sempre com recomendação.** Traga sua resposta sugerida e o porquê; o dev decide, mas não parte do zero.
- **Fato é seu trabalho, decisão é do dev.** "Esse campo já existe?", "esse guard já está implementado?", "essa rule proíbe isso?" — vá ao código, à rule, ao ADR e descubra. Só sobe ao dev o que é escolha genuína: trade-off, prioridade, corte de escopo, conflito com decisão anterior.
- **Percorra a árvore de dependências.** Não pule para uma decisão que depende de resposta ainda aberta.
- **Não grave o plano antes de fechar tudo.** Empurrar a dúvida para uma seção "perguntas em aberto" é o mesmo que mandar o Cursor improvisar.

Gatilhos típicos de "<95%" nesta casa — se algum aparecer, é pergunta, não suposição:

- critério de aceite que não é observável (não dá para escrever o teste que o prova);
- entidade, campo ou endpoint citado na WI que você **não achou** no código (pode ser a criar, pode ser outro nome — são planos diferentes);
- anexo de UI sem estado de erro, vazio ou carregando definido;
- escopo que atravessa fronteira de módulo ou muda contrato público;
- conflito entre descrição e comentários, ou entre WI e `backlog/tasks/`;
- teste cujo caminho fixture → linha de produção você não consegue traçar (`plan-for-cursor` §3 — aí a saída é **delegar o fixture**, dizendo a propriedade e o discriminante, não inventar valores).

---

## 5. Escrever o plano

**Antes de entregar, aplique a skill `plan-for-cursor` inteira** — os passes e a seção obrigatória de verificações. Ela é a régua de qualidade; não recrie nem resuma aqui.

**Um arquivo por WI**, fatiado por dentro: `.cursor/plans/wi_<id>_<slug>.plan.md`. Só vire mais de um arquivo se a WI abrigar entregas genuinamente independentes — e nesse caso proponha o corte ao dev antes de gravar.

Frontmatter no formato que o Cursor lê (modelo real: `.cursor/plans/wi_2538_bot_whatsapp_3416ef5e.plan.md`):

```yaml
---
name: WI <id> <título curto>
overview: "<1-3 frases: o que a entrega faz, ponta a ponta>"
todos:
  - id: fatia-<slug>
    content: "Fatia 1: <o que entrega> + testes"
    status: pending
  - id: gate
    content: "Gate 110: <suítes que os gatilhos exigem>"
    status: pending
isProject: false
---
```

Corpo, na ordem:

1. **Fonte canônica** — link para `backlog/tasks/<id>-<slug>.md` e para os ADRs aplicáveis, dizendo **quem vence onde divergirem** (a spec vence o ADR quando o ADR ficou para trás; diga isso explicitamente, como no plano da 2538).
2. **Decisões (não reabrir)** — o que foi fechado com o dev no §4, uma linha cada, com o porquê. É o que impede o Cursor de "melhorar" a decisão.
3. **Arquitetura** — o desenho; diagrama quando o fluxo tiver mais de dois saltos.
3a. **Manifesto de execução** — obrigatório. O formato vem de `.cursor/commands/execute.md`, e as regras de preenchimento estão na seção "Manifesto de execução" da `plan-for-cursor`. O SHA-base é o `HEAD` na hora de commitar o plano.
4. **Fatias** — cada uma com arquivos e caminhos reais, portas que já existem (verificadas, passe 1 da `plan-for-cursor`) e as que o plano manda criar. Fatia que mexe em tela cita o mockup aprovado (`docs/mockups/wi-<id>-<slug>.html`) e lista os componentes a reaproveitar (com caminho e variação) e os novos — o Cursor não escolhe outros.
5. **Testes** — por teste: a linha de produção que a asserção observa, o caminho até ela, ou o fixture delegado com propriedade + discriminante.
6. **Gate por gatilho** — derivado de `.cursor/rules/110-cursor-workflow.mdc` §"Gate de pronto" e `060` §"Pronto ≠ `--filter`" (**abra os dois**), dizendo qual gatilho disparou e **qual não disparou, e por quê**.
7. **Verificações feitas antes de entregar este plano** — a tabela obrigatória da `plan-for-cursor`.

Duas fronteiras que o plano precisa dizer em voz alta, porque o Cursor erra nelas por padrão:

- **"Reportar" = `%TEMP%\claude-handoffs\Broker\execute-reports\`.** O Cursor **não** edita `docs/releases/**/build-log/**` — build-log é fechamento de governança, feito depois, pelo `/revise`.
- **Escopo é teto.** O que não está no plano não é para ser "aproveitado ao passar por perto".

---

## 6. Branch e commit — a saída da skill

O plano só existe de verdade depois de commitado: plano não commitado é sobrescrito pelo primeiro `git merge` e some sem aviso (`plan-for-cursor` §7).

1. **Confira a branch corrente.** `master` **não aceita push direto** (TF402455) e nem deve receber o plano: crie `feature/wi-<id>-<slug>` a partir dela — é o nome que habilita a rastreabilidade que o `/audit-task` usa depois. Se já estiver numa branch de trabalho, commite nela.
2. **Commite** o `.cursor/plans/*.plan.md`, quando materializado o `backlog/tasks/<id>-<slug>.md` e, quando houve mockup, o `docs/mockups/wi-<id>-<slug>.html` aprovado (e o `docs/mockups/_design-system.md`, se foi criado ou atualizado). Nada mais entra nesse commit: edição de harness, skill, hook ou doc de governança vai em **branch separada**, mesmo que feita nesta sessão.
3. **Não faça push nem abra PR por iniciativa própria** — pergunte. Se o dev pedir, confirme depois com `git log` local × `origin/<branch>` que o push realmente saiu.

---

## 7. Fechamento

Diga ao dev, em poucas linhas:

- caminho do plano e as fatias, na ordem;
- quando houve mockup, o caminho do HTML aprovado e quantos componentes foram reaproveitados × criados;
- as perguntas do §4 e o que foi decidido em cada uma;
- o que ficou **fora** do escopo de propósito;
- o gate que o plano exige e o que ele dispensa, com o motivo;
- próximo passo: `/execute` no Cursor, depois `/revise`.

Se durante a análise apareceu algo que não é desta WI (dívida vizinha, gap de outra spec), **não** enfie no plano: proponha WI nova via `/spec-task`.