---
name: "execute-implement"
description: "Implementa um plano .cursor/plans/*.plan.md via TDD: identifica o plano, roda pré-análise obrigatória, implementa fatia por fatia. Use após /plan-task, antes de /execute-review."
---

# /execute-implement — Implementa o plano via TDD

Primeira metade do ciclo de execução. Recebe um plano e entrega código implementado, pronto para revisão pelo `/execute-review`. **Não** faz code review, gate, relatório nem commit — isso é responsabilidade do `/execute-review`.

## 0. Cápsula de execução

Para plano não trivial, prefira uma conversa nova com apenas o caminho do plano. Antes de agir, derive e use só esta cápsula: `plano + SHA-base + paths/superfícies + invariantes/seletores novos + iteração/gate`. Não releia inventários ou logs antigos; eles só voltam se o delta desde o SHA-base os contradisser.

## 1. Identificar o plano

**Uso avulso — primeira ação: marque o timestamp de início** (`Get-Date -Format s`). Ele vai para o cabeçalho do relatório (que o `/execute-review` gera) e para o `rodadas.csv`. Não estime a duração no fim — leia os dois carimbos. **Dentro do pipeline** (`execute-task-agent` com `preflight.md` no prompt) não marque nada: o tempo é do cronômetro do pipeline (`log-fase.ps1`).

Nesta ordem:

1. Um plano já no contexto da conversa.
2. Um caminho passado explicitamente pelo usuário.
3. O arquivo mais recente em `.cursor/plans/*.plan.md`.

Se mais de um candidato for plausível e nada resolver a ambiguidade, liste-os e pergunte qual executar. Não presuma.

**Antes de implementar, execute a pré-análise obrigatória.** Isto não é uma chamada aninhada automática: abra e siga integralmente `.cursor/commands/analise.md` com `modo=preflight-execute`. Não basta escrever que "rodou `/analise`", nem conferir algumas premissas de código.

1. Resolva o plano pela ordem acima. Se ele só seria escolhido pelo arquivo mais recente e a working tree estiver suja, pare e peça o caminho explícito; não audite contra uma baseline ambígua.
2. Antes de qualquer edição, registre `HEAD`, `git status --porcelain`, caminho do plano e a matriz completa da pré-análise: **Código, Spec e Execução**. Em cada eixo sem achado, liste as fontes conferidas. Registre literalmente: `Oportunidades: não avaliadas no preflight do /execute`.
3. Leia o **Manifesto de execução**. Se faltar, é 🟡: acrescente-o no plano e reexecute a pré-análise. Com ele, confira somente o delta desde o SHA-base e paths/invariantes declarados; não refaça inventário fechado. Todo glob, regex, wildcard, enumeração de paths, export, DI, rota ou migration novo exige prova curta de alcance.
4. Todo 🔴 ou 🟡 é **obrigatório**: corrija-o no `.plan.md` antes de editar código, registre a resolução e rode de novo a pré-análise. Não implemente "em volta" de um achado, não o rebaixe para 🔵 e não comece o plano enquanto restar um deles.
5. A autorização do `/execute-implement` cobre essas correções estritamente necessárias do plano (premissa, arquivo-alvo, ordem, teste, gate ou contrato). Se um 🔴/🟡 exigir decisão de produto/ADR, aumento de release ou outra autoridade do dev, pare, exponha a decisão e não implemente nada.
6. 🔵 não entra neste fluxo. Oportunidades só são analisadas e tratadas quando o usuário chama `/analise` diretamente.

Só uma matriz reexecutada sem 🔴/🟡 libera a implementação. O custo é uma passada de leitura; o custo de não fazer é uma fatia refeita. Precedente: o plano do SH-3/SH-4 foi escrito contra o texto da ADR e precisou de três rodadas de remendo contra o código real (CS de cache que já existia, `RejectionStatusCode` já configurado em dois hosts) — tudo achável numa passada só.

## 2. Implementar seguindo `/execute-tdd`

Abra e aplique `.cursor/commands/execute-tdd.md` durante toda a implementação — seams acordados antes de testar, red antes de green, uma fatia por vez, mock só em fronteira de sistema, nenhum teste vácuo.

`110-cursor-workflow.mdc` já cobre o que explicar antes de criar código (o quê, por que pertence à release atual, quais arquivos, o que não será criado ainda, como evita retrabalho) — siga aquela regra, não repita aqui.

### Desvio do plano é achado, não rodapé

Se, para fazer o plano funcionar, você precisou de algo que o plano não previa, **isso é informação de primeira classe**: reporte como desvio, com o motivo, e diga o que ele implica. Duas regras que decorrem disso:

- **Necessário para funcionar ⇒ não é opcional.** Se sem aquilo o seu próprio fix não opera, aquilo é parte do fix.
- **Se o mesmo padrão existe nos arquivos irmãos, espelhar é o default, não uma escolha do dev.** Para *não* espelhar, apresente o argumento de por que os irmãos são seguros — não deixe a pergunta em aberto.

Precedente que motivou a regra (SH-4 → SH-13): o `throw;` após `Log.Fatal` foi adicionado a **um** host porque sem ele o fail-fast recém-escrito não chegava a lugar nenhum; espelhar nos outros três foi classificado como *"opcional, dev decide"*. Não era opcional — os outros três hosts saíam com **exit code 0** ao detectar configuração insegura, neutralizando em silêncio o guard de maior severidade do lote. A informação estava na mão de quem implementou **duas horas antes** de virar item 🔴.

## 3. Saída — o que entregar ao `/execute-review`

Ao terminar a implementação, registre e repasse:

- **Timestamp de início** (do passo 1 — só no uso avulso).
- **Resultado da pré-análise** (matriz, resolução de achados).
- **O que foi implementado** (bullets).
- **Arquivos alterados** (`git diff --stat`).
- **Desvios do plano** e suas implicações.
- **Ciclo TDD**: seams, testes adicionados/alterados, e para cada teste o rótulo `[visto]` ou `[raciocinado]`:
  - **`[visto]`** — você aplicou o mutante (removeu o fix, quebrou a asserção, tirou do fixture o dado que sustenta a propriedade), **rodou** e leu o vermelho. Diga o mutante e a falha observada.
  - **`[raciocinado]`** — você afirma o que faria o teste falhar, sem ter rodado. É admitido, e é o rótulo honesto para a maioria.
  - **`[visto]` é obrigatório no teste que o plano elege como discriminante da fatia.** Sem ele o item não fecha.
  - Não rotule a seção inteira de uma vez: o rótulo é por teste, porque o erro é por teste.

Esse material é insumo direto do relatório que o `/execute-review` vai montar. Não commite — no pipeline, o commit é do `harness:graduation-agent` (depois do review aprovado); avulsa, depois do gate verde.