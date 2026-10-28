---
name: audit-task
description: Audita a implementação de um desenvolvedor do time contra a spec da task (colada pelo owner) e os gates reais — mesma disciplina do /revise, adaptada para PRs de terceiros. Nunca edita o código do desenvolvedor; produz veredicto e achados prontos para comentário de PR. Use quando o owner pedir "/audit-task" para revisar a entrega de um dev antes de aprovar o PR.
argument-hint: "branch ou nº do PR a auditar (a spec da task é colada pelo owner na conversa)"
disable-model-invocation: true
---

Audita a implementação de um desenvolvedor do time contra a spec da task, com o mesmo rigor que o `/revise` aplica ao Cursor — **verifica, não confia**. Diferença central: quem implementou foi um humano, não o Cursor, e o resultado desta skill nunca vira edição direta de código — sempre achados para o dev corrigir. Ver [ADR-0039](../../../docs/adr/0039-team-scaling-task-spec-and-review-workflow.md).

## 1. Reunir os dois insumos

- **A spec da task**: leia `backlog/tasks/<id>-<slug>.md` no repositório — é a referência canônica (ADR-0039 §1), não o Work Item. Se não souber o nome exato do arquivo, procure por ID do Work Item ou pelo nome da branch em `backlog/tasks/`. Só peça ao owner para colar o texto se o arquivo genuinamente não existir (spec pré-ADR-0039, ou exceção) — e se colar, sugira criar o arquivo retroativamente para a próxima auditoria não repetir a colagem.
- **O alvo**: branch ou PR indicado. Se for um número de PR, busque direto via MCP — `repo_pull_request` com `action: "get"`, `pullRequestId`, `repositoryId: "brixbroker"`, `project: "brixbroker"` e `includeChangedFiles: true` — para identificar a branch de origem e os arquivos tocados sem depender do owner para achar a branch manualmente; em seguida `git fetch` + `git diff <base>..<branch>` localmente para ver o diff completo de verdade — não leia só a descrição do PR nem confie só no resumo do MCP.

Se faltar um dos dois, pare e peça — não presuma critério de aceite a partir do nome da branch ou do título do PR.

## 2. Checar a área de impacto primeiro

Compare os arquivos tocados no diff contra a **área de impacto declarada** na spec (ADR-0039 §4). Divergência aqui é sinal de dois problemas distintos — trate cada um:

- **Escopo menor que o declarado**: pode ser normal (área era um teto, não uma exigência) — só confirme que os critérios de aceite foram cobertos apesar disso.
- **Escopo maior/fora do declarado**: é achado — mesmo padrão do "escopo extra não aprovado" que o `code-audit-mode.md` já cobre. Pode ser legítimo (dependência descoberta durante a implementação), mas precisa ser justificado, não silencioso — e é o tipo de coisa que pode ter colidido com a task de outro dev sem ninguém perceber.

## 3. Auditar contra a realidade, não contra a PR

Aplique a rubrica de `docs/contexts/code-audit-mode.md` — não recrie uma nova aqui. Nessa rubrica, onde ela diz "plano aprovado", leia "spec da task":

- A implementação cobre os critérios de aceite da spec?
- Há escopo extra não justificado?
- As ADRs vigentes da área foram respeitadas (modelo de domínio, fronteiras, stack)?
- As rules do Cursor relevantes à área foram seguidas? Abra `.cursor/rules/005-documentation-context-hierarchy.mdc` para saber quais — não chute de memória.
- Os testes são adequados ao escopo, e **a defesa dispara de verdade**? Mesmo critério do `/revise`: se a entrega adiciona guard/validação/limite/authz, provoque a condição e observe a consequência real — teste verde não é prova (`060` §"Desenho de teste — verde não é prova").
- Não há sincronização reversa spec ← código não aprovada (`CLAUDE.md` §2)?

**Rode os gates de verdade** pela superfície que o diff toca (não a bateria inteira por hábito) — mesma disciplina do `/revise`: build/unit/arch, e integração/HostSmoke só quando o diff encosta em banco/persistência/authz. Declare explicitamente o que não rodou e por quê (Docker indisponível, etc.) — silêncio não se distingue de esquecimento.

**Delegue a leitura, nunca o julgamento.** Quando o diff é grande ou toca muitos arquivos, despache o subagente `diff-evidence` (`Agent`, `subagent_type: "diff-evidence"`) com duas coisas: o **alvo** (caminho do diff salvo, ou `base..branch`) e a **pergunta** — a rule, a ADR ou o critério que você quer confrontar. Ele devolve `arquivo:linha` + trecho literal e **não emite veredicto** — o veredicto continua seu. Um despacho por pergunta: *"confira X contra a rule `060`"* rende evidência utilizável; *"revise este PR"* rende resumo, e resumo é exatamente o que esta skill não aceita. O que volta são citações para você conferir, não conclusões para repassar.

## 4. Veredicto

Mesmo vocabulário de sempre: **conforme** / **conforme com ressalvas** / **não conforme**.

## 5. Saída — pronta para comentário de PR

Diferente do `/revise` (que só atualiza documentação interna, já que o "implementador" era o Cursor sob supervisão direta do owner), aqui a saída precisa servir para o dev que não estava nesta conversa. Estruture os achados como comentários de PR prontos para colar no Azure DevOps: arquivo + linha (quando aplicável) + o que está errado + o que corrigir — no mesmo formato do `ReportFindings` (mais severo primeiro, achado concreto, sem embromação).

**Nunca edite o código do desenvolvedor**, mesmo para achados triviais ("só uma string", "fix óbvio") — mesma regra que já vale para o Cursor (`never-edit-product-code.md`), e aqui com razão adicional: é o código de outra pessoa, editar por baixo do PR dela quebra a prática de revisão em si.

## 6. Se aprovado

Só depois do owner confirmar o veredicto, atualize a documentação de governança no formato já em uso (mesmo passo do `/revise` item 5): build-log da release corrente, linha-ponteiro em `CLAUDE.md` §8 se fechar/avançar um ADR, `scope.md`/`release-map.md` se fechar item de escopo, `MEMORY.md`.

Se a auditoria revelar necessidade de ADR novo, não crie sozinho — aplique o critério de "quando oferecer ADR" da skill `domain-modeling` e proponha ao owner.
