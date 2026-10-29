---
name: plan-for-cursor
description: Checklist de qualidade para escrever um `.cursor/plans/*.plan.md` que o Cursor vai executar. Use ao produzir qualquer plano — inclusive os planos de correção do `/revise` e do `/review-pr`.
---

Um plano é executado por outro agente, sem a conversa que o originou. Ele acerta o que está escrito e improvisa o que está subentendido — e improviso em plano é onde nascem os defeitos caros.

Este arquivo **não** repete as rules nem a definição de pronto: elas são a fonte, e cópia envelhece (`CLAUDE.md` §7). O que ele faz é obrigar a **verificar** e a **registrar o que foi verificado**.

## Os dez passes, antes de entregar o plano

### 1. O encanamento — abra o arquivo, não presuma

Para **todo** passo que diga "acrescente", "chame", "reuse" ou "injete": abra o arquivo e confirme que aquilo é possível.

- A porta existe? (o método está na interface, não só na implementação)
- A assinatura aceita o que mandei passar? (nulo permitido? o tipo bate?)
- Se não existe, **o plano precisa mandar criá-la** — em passo próprio, com o caminho.

Sintoma de que este passe foi pulado: o plano descreve o *design* com precisão e o *como fazer* em verbos genéricos.

> Caso que originou o passe (2026-08-14): mandei "acrescentar a entidade na mesma unidade de trabalho" sem notar que `ICrmDbContext` não expunha `Add` para ela, e que o upsert existente exigia `Guid` não-nulo. Não havia caminho — e o atalho óbvio (`Guid.Empty`) cairia num ramo silenciosamente errado.

### 2. Afirmação de ambiente exige comando — ou rótulo de não verificada

O passe 1 cobre **seams de código**: o método existe, a assinatura aceita. Ele não cobre a classe de afirmação que mais me derrubou — a que fala do **mundo fora do arquivo**.

Três famílias, todas com o mesmo remédio:

| Família | Exemplos reais que errei |
|---|---|
| **Sintaxe de sistema externo** | Path filter do Azure DevOps escrito como `!/*.md` e depois `!*;/caminho` — exclusão sem include casa com **zero** arquivos. Duas vezes. Nome de pipeline com `/`, que o Azure recusa. |
| **Semântica de runtime** | "o controle positivo não pode retornar 5xx" — um 500 do handler **prova** que a authz admitiu. "404 significa rota inexistente" — também vem do handler, depois da authz. |
| **Fato de ambiente** | "`Architecture.Tests` depende do Postgres da máquina" (não depende: 114/114 com banco inalcançável, mesma duração). "o agente Linux tem `pwsh`" (nunca verificado). |

**A regra:** toda frase do plano que afirme algo sobre ambiente, sintaxe externa ou comportamento em runtime vem **com o comando que a produziu**, ou vem **marcada como não verificada**.

```
✅  Docker no agente: confirmado (`docker version` no passo de diagnóstico, build 7099)
✅  Path filter include-only: `/platform/backend/*` — forma confirmada na Learn
⚠️  pwsh no agente Linux: NÃO VERIFICADO — por isso o executor fica fora do CI nesta fatia
```

**Por que o rótulo basta e a certeza não é exigida:** o custo de eu estar errado sem rótulo é um ciclo inteiro de `/execute` + `/revise`. Com rótulo, o executor confere em trinta segundos e reporta. **A meta não é acertar sempre — é não fazer o executor pagar pela minha inferência.**

> Casos (2026-09-02/03): errei a sintaxe do Path filter **duas vezes**, e nas duas o executor corrigiu citando a documentação. Afirmei em ADR **e** build-log que `Architecture.Tests` bloqueava a Fase 4, a partir de leitura de código — refutado em uma execução de dois minutos que eu podia ter feito antes de escrever. Justifiquei o local do `run-gate.ps1` com "a Fase 4 reusa o script", premissa que nunca verifiquei e que acabou falsa na prática.
>
> **O padrão:** meu índice de erro no que **executei** foi próximo de zero; no que **inferi**, alto. O comando que faltava custava menos que o parágrafo que escrevi no lugar dele.

### 3. Plano de merge — simule, não estime

Vale sempre que o plano envolve `git merge` — lista de arquivos `changed in both`, contagem de membros/chamadores novos, previsão de conflito. É o mesmo princípio do passe 1 (não presuma, verifique), aplicado a listas exaustivas em vez de a um arquivo só.

- **Lista de arquivos em conflito:** `git merge-tree $(git merge-base HEAD origin/master) HEAD origin/master` — a lista **real**, computada. Nunca substituir por `git diff --name-only` + comparação manual contra uma lista que você mesmo compilou (de memória, de outro build-log, etc.) — é estimativa, não simulação, e listas compiladas à mão perdem item.
- **Quando o conjunto de conflitos importa para o plano**, um merge de teste descartável: `git merge --no-commit --no-ff origin/master` numa branch de raspa, inspecionar os marcadores reais, `git merge --abort`. É verificação — mesma categoria de rodar teste/build — não é escrever código de produto.
- **Contagem de "quantos X" ou "quem chama Y":** grep pelo **substantivo do domínio** (`LossReason`, `OpportunityOperationService`) na superfície inteira. Nunca por um padrão sintático que presume a forma do que procura (`Task<...>Async` exclui `void`; um chamador que só usa um segundo método do mesmo serviço escapa de um grep focado no primeiro).

> Caso (2026-08-15/16): dois planos de merge seguidos (`2531`, `2543`) tiveram a lista de arquivos ou a contagem de membros corrigida pelo `/analise` do Cursor antes de rodar. Na 2543, a lista de `changed in both` veio de diff + comparação manual e perdeu um arquivo (`opportunity-detail.page.html`) e não previu um conflito real (`CreateOpportunityCommandHandlerTests.cs`) — o Cursor achou os dois rodando `git merge-tree`. A contagem de métodos novos em `ICrmDbContext.cs` saiu "dois" com um grep por `Task<...>Async`; eram quatro, porque um deles retornava `void`. Retroativamente, o mesmo padrão explica o achado bloqueante da 2531 (`PostponeContactPointCommand` fora da lista de chamadores — a busca não foi exaustiva pelo tipo injetado).

### 4. Testes — trace o caminho, não descreva a intenção

**Este é o passe que mais falha. Já errei aqui três vezes, sempre na mesma direção: o rótulo do teste promete mais do que o desenho entrega.** Escrever *"falha se X faltar"* não bastou — porque respondi essa pergunta pela **intenção** do teste, não pelo código.

Para **cada** teste que o plano pede, faça as três coisas, nesta ordem:

**(a) Nomeie a linha de produção que a asserção observa.** Qual linha, do código que esta fatia muda, quebra o teste se estiver errada? Se a resposta for uma linha que **não** está sendo alterada, a asserção está mirando no lugar errado — provavelmente num efeito vizinho que já tem cobertura.

> Caso: para provar o upsert em lote, escrevi "as duas oportunidades ficam com vendedores diferentes". Isso é garantido pelo cursor **em memória**, que já tinha teste unitário. A asserção que mirava o upsert — o valor **persistido** — faltava.

**(b) Trace o caminho do fixture até essa linha.** Valor do fixture → predicado → ramo tomado → próxima chamada → … → a linha. Escreva os saltos. Se não conseguir escrever, **não verificou**.

> Caso: mandei montar o fixture com `productId: null`. O resolvedor é product-first: sem produto ele filtra por ramo; a equipe seedada só tinha produto; nenhum match; a resolução devolvia `null` e **o método sob prova nunca era chamado**. Três saltos que eu não dei.

**(c) Se não traçou, não invente valores — delegue.** Diga a **propriedade** a provar e o **discriminante** (o que tem de falhar sem o conserto), e mande o executor desenhar o fixture e **reportar se o caminho não alcançar a linha nomeada em (a)**. É honesto: quem está com o código aberto acerta o fixture melhor do que eu de memória. Especificar valores concretos sem ter traçado o caminho é a forma mais confiável de produzir um teste que passa provando outra coisa.

**(d) Asserção negativa: provoque antes de escrever.** Toda asserção da forma *"não deve retornar X"*, *"não pode ser Y"*, *"deve ser menor que Z"* passa em **tudo que não é X** — inclusive em estados que não provam nada. Antes de exigir uma dessas no plano, **rode a condição e veja o que de fato sai**.

O comando é barato e existe sempre: um `--filter` no teste vizinho, um `curl` no host de teste, uma variável de ambiente apontando para o vazio. Se não rodar, **escreva no plano o que você espera que saia e marque como não verificado** — o passe 2 vale aqui inteiro.

> Casos (2026-09-02), os dois mais caros que já produzi, um ciclo `/execute` + `/revise` cada:
>
> 1. Exigi `status < 500` no controle positivo de authz. Errado: um 500 do handler **prova** que a policy admitiu a requisição. O critério transformou um smoke de autorização em teste ponta-a-ponta, exigindo banco, tenant e seed para 17 rotas — **19 vermelhos**.
> 2. Corrigi para `NotBe(404)`, mirando o buraco real (rota inexistente devolve 404 antes da authz). Também errado: 404 **também** vem do handler, por entidade inexistente. Dois 404 que o HTTP não distingue.
>
> Nos dois eu estava tentando espremer uma propriedade **estática** — "a rota existe" — numa asserção de **status de resposta**. Ela não cabe ali; cabe num Fact que lê a tabela de rotas, e a forma para isso **já existia em quatro arquivos do repositório**. Trinta segundos provocando a condição teriam mostrado que 500 e 404 chegam do handler, e os dois ciclos não teriam acontecido.

**(e) Eleja o discriminante da fatia — nomeadamente.** Entre os testes que o plano pede, diga **qual** é aquele cujo vermelho prova a fatia, e escreva no plano: *"discriminante da fatia: `<teste>` — o `/execute` tem de reportá-lo como `[visto]`"*. O contrato do relatório (`.cursor/commands/execute.md` §Ciclo TDD) exige que esse teste venha com o mutante **aplicado e rodado**, não com afirmação de que falharia. Se você não conseguir eleger um — porque a fatia é só cobertura, sem propriedade nova —, escreva isso, e nenhum `[visto]` fica devido.

> Por que o plano tem de eleger, e não o executor: quem escolhe o próprio discriminante escolhe o que já sabe que passa. Medido em 2026-09-09 sobre 46 relatórios de `/execute`: teste não-discriminante é a classe dominante de rodada de correção, e ela sobrevive a este passe inteiro quando o campo do relatório aceita raciocínio.

Confira também que **o harness deixa a condição acontecer** — um teste pode ser impossível por construção do fixture.

> Caso: rotulei de "prova do backfill" um teste que o fixture de template torna inalcançável, porque as migrations rodam antes de qualquer dado de teste existir.

Critérios de teste tautológico/vácuo e "defesa se prova disparando": `.cursor/rules/060-dotnet-code-style-tests.mdc`, §"Desenho de teste — verde não é prova". **Abra a rule**, não cite de memória.

### 5. Gate por gatilho, escrito

Derive o gate dos gatilhos em `.cursor/rules/110-cursor-workflow.mdc` §"Gate de pronto" e `060` §"Pronto ≠ `--filter`" — **abra os dois**. No plano, diga qual gatilho disparou e **qual não disparou, e por quê**.

Somar suítes "por precaução" não é rigor; o ADR-0037 chama isso de custo que reaparece a cada iteração.

> Caso: pus `Broker.HostSmoke` numa fatia que não tocava `Program.cs` nem `*Endpoints*.cs`.

### 6. As rules da área, despachadas pela `005`

Abra `.cursor/rules/005-documentation-context-hierarchy.mdc`, deixe o mapa despachar pelas áreas que a mudança toca, e **abra as rules indicadas**. Nomeie no plano quais foram consultadas.

Lembre da assimetria: o Cursor recebe metade das rules automaticamente pelos `globs`; **para mim não chega nenhuma**. Rule não aberta é rule não checada.

> Caso: a `010` proíbe acessar `DbContext` direto na Application. O Cursor citou; eu nunca a tinha aberto.

### 7. Leia o plano procurando só contradição

Uma passada final olhando **apenas** para afirmações que brigam entre si. Plano longo contradiz a si mesmo com facilidade, e o executor obedece à frase errada.

> Caso: escrevi na visão geral que a fatia **não** serializa e, no passo, mandei o comentário dizer que "a serialização é tratada no todo seguinte".

### 8. Guarda e sentinela — enumere quem referencia, provoque o nome exato

**As duas lacunas da F5 da WI #3150 (2026-09-03) foram deste passe, e nenhuma era erro do Cursor: os dois buracos estavam no plano que eu entreguei.** Custaram uma rodada inteira de correção. São dois vazamentos distintos, com a mesma raiz — a guarda foi desenhada pelo caso que eu tinha em mente, não pelo conjunto real.

**(a) Guarda de exclusão: enumere TODOS os referenciadores, e diga quem sustenta cada um.** Antes de escrever "impedir excluir X quando estiver em uso", liste **todas** as tabelas, entidades e projeções que apontam para X — por grep do nome de X, não pelas que o domínio "deveria" ter. Para cada uma, responda: **o banco impede (FK), ou a guarda da aplicação é a única defesa?** Um referenciador fora da lista não dá erro: ele fica **órfão em silêncio**.

> Caso (F5): o plano guardava exclusão contra `Opportunity`, `Lead` e `ContactPoint`. `SalesTeamInsuranceType` também aponta para `InsuranceType` e **não tem FK** — nenhum `HasOne` no `CrmDbContext`. Excluir um tipo associado a uma equipe passava, a referência virava GUID solto, e o `insuranceTypeName()` do frontend exibia o GUID cru para sempre, sem caminho de recuperação pela UI. Um grep pelo nome da entidade teria listado o quarto referenciador.

**(b) Sentinela: provoque com o artefato exato que a ADR nomeia como rejeitado.** Quando o plano manda criar sentinela contra um padrão, ele tem de mandar **escrever o padrão proibido, ver a sentinela falhar, e reverter** — usando **o nome literal que a ADR rejeitou**, não um parecido. O modo de falha não é a sentinela não existir: é o **matcher** dela ser mais estreito que o padrão, e ninguém testar o matcher.

> Caso (F5): a sentinela contra snapshot de nome checava substring literal e **não pegava `InsuranceTypeNameSnapshot`** — exatamente o identificador que a tabela de alternativas da ADR-0044 documenta como rejeitado. Verde decorativo: a sentinela existia, passava, e não guardava nada. O conserto foi um regex (`@"\bInsuranceTypeName\w*\s*\{"`), mas o que faltava no plano era a **ordem de provocação com o nome da ADR**.

Isto é o passe 4 aplicado a mecanismos de defesa, e vale mesmo quando o gate inteiro está verde — ver `060` §"Desenho de teste — verde não é prova".

### 9. Commite antes de entregar

Plano não commitado é sobrescrito pelo primeiro `git merge` e some sem aviso. Commite o `.md` **antes** de o Cursor rodar, na branch onde ele vai trabalhar.

> Caso: as correções que escrevi num plano se perderam no merge; o Cursor as executou porque leu antes, mas o arquivo em disco voltou a ser a versão errada.

### 10. A cápsula se basta — caminho inteiro, e nenhum ponteiro que cresça

O plano é o prefixo que o agente **re-paga em cada chamada de ferramenta da sessão**. Medido em 2026-09-17 numa sessão de `/execute` de 35 minutos: **200 chamadas de ferramenta**, ~42k de prefixo cada, contra um briefing fixo de ~40k. Cada quilobyte no plano é multiplicado por duas centenas. Duas consequências, ambas obrigatórias:

**(a) Caminho completo a partir da raiz do repo — nunca abreviado, nunca com reticências.** Escreva `platform/frontend/libs/layout/src/lib/models/app-shell.models.ts`, não `libs/layout/.../app-shell.models.ts`. Um caminho que o agente precisa *procurar* vira grep, vira turno, vira mais uma releitura do prefixo inteiro. Reticências dentro de um caminho são defeito, não abreviação.

**(b) Nenhum ponteiro para documento maior que o próprio plano.** Não escreva `parent_plan:`, "ver o plano principal", "detalhe no épico". O ponteiro é um convite a abrir, e o que se abre entra no prefixo de todas as chamadas seguintes.

> Caso que originou o passe (2026-09-17): dividi a WI #3389 em dez sub-planos de 1,2–3,7 KB e pendurei em cada um `parent_plan:` apontando para o plano pai de **45 KB** — um arquivo doze vezes maior que o maior sub-plano, e maior que as sete rules `alwaysApply` somadas. Construí a cápsula enxuta e colei nela o link para exatamente o que ela existia para substituir. Medição: `docs/governance/orcamento-de-contexto-agentes.md`.

Se o sub-plano precisa de um fato do documento pai, **copie o fato**, não o ponteiro. Um plano que depende de outro para ser executável não é uma cápsula.

## Seção obrigatória antes das fatias: Manifesto de execução

Todo plano tem um bloco `## Manifesto de execução` **antes da primeira fatia**, depois de fonte canônica, decisões e arquitetura (mesma posição que o `/plan-task` usa). O contrato é do executor: `.cursor/commands/execute.md` §pré-análise, item 3. Plano sem manifesto é 🟡 automático: o executor escreve o próprio e roda a pré-análise de novo. **O formato mora lá** (`execute.md`, linha `**Manifesto de execução:**` do modelo de relatório). Abra o arquivo e siga-o; não copie o formato para cá.

O que só quem escreve o plano sabe, e por isso não pode ficar para o executor:

- **SHA-base:** o `HEAD` da branch onde o plano vai rodar, conferido com `git rev-parse HEAD` **imediatamente antes de commitar o plano**. Não use o SHA de quando a análise começou. O commit do plano fica por cima dele, e isso é inevitável: o plano não pode citar o hash do commit que o contém. Escreva no manifesto, literalmente, que o único commit entre o SHA-base e o `HEAD` da execução é o do plano, só em `.cursor/plans/**`. O `execute.md` (item 3 da pré-análise) trata esse commit como esperado, não como drift.

  > Caso (2026-10-02, WI 3648): nas duas rodadas o executor marcou o SHA-base como desatualizado e o trocou pelo `HEAD` com o plano. A frase "o commit deste plano entra por cima dele" estava no manifesto e não bastou, porque o contrato do executor não dizia nada sobre isso.
- **Invariantes:** o que **não pode** mudar (arquivos intocáveis, decisões técnicas, "sem push", "não editar build-log"). Invariante escrita pelo executor é palpite dele sobre a sua intenção.
- **Seletores/contratos novos:** os nomes que o diff vai criar (rota, método de porta, código de erro, campo de DTO), para a pré-análise conferir só o delta.
- Paths/superfícies e iteração/gate: derivados das fatias e do passe 5.

> Caso que originou a seção (2026-09-25): os planos da WI 3551 e o plano de correção dela saíram sem manifesto. O Kilo e o Codex reclamaram, um em cada rodada, e cada um escreveu o seu. O owner já tinha visto essa reclamação várias vezes. A causa era esta skill: ela nunca tinha mencionado o manifesto, então ele só entrava nos planos quando eu lembrava.

## Seção obrigatória no plano

Todo plano fecha com esta seção — é o que torna a disciplina **auditável pelo owner** em vez de privada:

```markdown
# Verificações feitas antes de entregar este plano

| Passe | O que verifiquei | Onde |
|---|---|---|
| **Manifesto** | **bloco antes das fatias, no formato de `execute.md`; SHA-base = `git rev-parse HEAD` na hora do commit do plano** | **SHA citado** |
| Encanamento | `AddX` existe na interface; aceita nulo | `ICrmDbContext.cs:442` |
| **Ambiente** | **toda afirmação de ambiente/sintaxe externa/runtime com o comando que a produziu, ou marcada `⚠️ NÃO VERIFICADA`** | **saída citada, ou o rótulo** |
| Merge (se aplicável) | `git merge-tree` rodado para a lista de `changed in both`; contagem de membros/chamadores por substantivo de domínio, não por padrão sintático | saída do `merge-tree` |
| Testes | para cada teste: linha de produção alvo nomeada · caminho fixture→linha traçado (ou fixture delegado) · harness alcança a condição · **asserção negativa provocada antes de escrita, ou rotulada** | linha citada |
| Gate | gatilho N disparou; gatilho M não, porque … | `110` §Gate |
| Rules | abertas: `010`, `030`, `040` | mapa da `005` |
| **Guarda/sentinela** (se aplicável) | **referenciadores enumerados por grep do nome da entidade, com FK × guarda-de-aplicação para cada um · sentinela mandada provocar com o identificador literal que a ADR rejeitou** | **grep citado · nome da ADR** |
| **Cápsula** | **todo caminho completo a partir da raiz (nenhuma reticência) · nenhum ponteiro para documento maior que este plano** | **conferido** |
| Contradição | passada final feita | — |
```

Se algum passe não foi feito, **diga qual e por quê** em vez de omitir. Silêncio não se distingue de esquecimento.

## O que este arquivo não cobre

Formato de ADR (`domain-modeling`), veredito de auditoria (`revise`, `review-pr`), e a decisão de **se** deve haver plano — que é do owner.
