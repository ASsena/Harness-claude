---
name: revise
description: Lê o relatório de execução mais recente (ou um indicado) gerado pelo /execute do Cursor, audita de verdade contra o código e os gates reais, aprova ou desenha um plano de correção para o Cursor rodar via /execute, e atualiza a documentação de governança quando aprovado. Use quando o usuário pedir "/revise" após um ciclo de /execute no Cursor.
argument-hint: "slug ou data do relatório a revisar (opcional — padrão: o mais recente)"
disable-model-invocation: true
---

Audita o resultado de um ciclo `/execute` do Cursor: implementação + TDD + gate + revisão em dois eixos, já commitado. Esta skill não confia no relatório por si só — ela verifica.

## 0. As duas obrigações mecânicas — invariantes, não passos

Estas duas não são etapas do roteiro: são **invariantes da execução**. Valem mesmo que a auditoria termine cedo, seja interrompida, não ache relatório, ou você conclua em três minutos que não há nada a auditar.

1. **Antes de abrir qualquer arquivo**, registre o timestamp de início (`Get-Date -Format s`).
2. **Antes de encerrar o turno, sempre**, grave a linha no `rodadas.csv` (mecânica no passo 6). Se a auditoria abortou, grave com o `veredicto` que couber (`abortado`, `sem-relatorio`) e o motivo em `observacao`. **Rodada não registrada é rodada que não aconteceu**, para efeito de medição.

**Por que isto está no topo e não só no fim, com data.** Em 2026-09-09 o `rodadas.csv` tinha **22 linhas, todas `fase=execute` e nenhuma `fase=revise`** — apesar de ~12 auditorias terem rodado no período (contadas pelos planos de correção que elas geraram). A obrigação existia, mas morava no **último passo de uma skill longa**, e último passo de skill longa é exatamente o que se perde quando o contexto aperta ou o turno alonga. O owner não tem outra fonte: a maior queixa dele sobre o ciclo é o custo desta skill, e sem a linha isso não é verificável nem refutável.

Não estime a duração no fim — leia os dois carimbos.

## 1. Localizar o relatório

Em `%TEMP%\claude-handoffs\Broker\execute-reports\`: se o usuário passou argumento, procure por slug/data correspondente; senão pegue o arquivo mais recente. Se houver mais de um candidato plausível e nada resolver a ambiguidade, liste-os e pergunte qual revisar. Se não houver nenhum, avise o usuário — não invente um relatório.

Leia o documento inteiro.

## 2. Auditar contra a realidade, não contra o relatório

Prática já estabelecida neste projeto (quase toda entrada de `MEMORY.md` registra "gates re-rodados por Claude", "código real" auditado) — o relatório é o ponto de partida, não a fonte de verdade.

- Cruze "Arquivos alterados" e o commit citado contra `git status`, `git diff` e `git log` reais.
- Leia os arquivos de código realmente alterados nos trechos relevantes — não confie só no resumo "O que foi implementado" do relatório.
- **Rerodar o gate é exceção, não rotina.** O ADR-0037 §4 é explícito: a auditoria **não repete a suíte do Cursor**. Ela audita por leitura do diff + prova com controle discriminante. Você só re-executa a suíte em **três gatilhos, e só neles**:
  1. o relatório **contradiz o diff** (contagem, projetos, ou alegação incompatível com o código lido);
  2. o diff cria **risco comportamental** numa das classes listadas em `.cursor/rules/110-cursor-workflow.mdc` §"Gate de entrega" (o bullet "A auditoria não repete o gate") — **abra a rule a cada `/revise`**, a lista mora lá e não é copiada aqui. A classe tem de ser demonstrada pela leitura do diff: migration, `DbContext`, transação ou `*Endpoints*.cs` **não** disparam só por localização ou sufixo. Na dúvida não resolvida, classifique como gatilho e registre o motivo;
  3. o **owner pede**.

  > Corrigido em 2026-10-03: este item listava "persistência, RLS, authz ou composição de host", o gatilho antigo que a `110` restringiu em 2026-09-14 (ADR-0037; disparava em ~75% dos diffs). A cópia ficou quase três semanas desatualizada, e é por isso que agora o item aponta para a rule em vez de repeti-la.

  Fora deles, você confere o relatório contra o código e **não** paga a suíte de novo. Rodar build/teste continua permitido (é verificação, não código de produto) — o que muda é que rodar por hábito é custo, não rigor. Medido em 2026-09-02: `Broker.HostSmoke` sozinho custa 100–245s conforme o ambiente.

  **Quando você rerodar por gatilho, diga qual dos três disparou.** Silêncio aqui vira rotina de novo.

  ⚠️ **Refatoração de infraestrutura de teste cai no gatilho 2** (é uma das classes da `110`). Mudança de fixture, isolamento de banco, coleção ou paralelismo é exatamente onde vermelho se esconde — não use a economia acima para deixar de rodar justamente essa classe de diff.

**Delegue a leitura, nunca o julgamento.** Quando o diff é grande ou toca muitos arquivos, despache o subagente `diff-evidence` (`Agent`, `subagent_type: "diff-evidence"`) com duas coisas: o **alvo** (caminho do diff salvo, ou `base..branch`) e a **pergunta** — a rule, a ADR ou o critério que você quer confrontar. Ele devolve `arquivo:linha` + trecho literal e **não emite veredicto** — o veredicto continua seu. Um despacho por pergunta: *"confira X contra a rule `060`"* rende evidência utilizável; *"revise este PR"* rende resumo, e resumo é exatamente o que esta skill não aceita. O que volta são citações para você conferir, não conclusões para repassar.

### O gate é o das rules — leia-as, não confie na memória

A definição de pronto **não é replicada aqui**, porque cópia envelhece: os HostSmoke ficaram fora do gate destes comandos por uma entrega inteira depois de as rules já os exigirem. A fonte é `.cursor/rules/110-cursor-workflow.mdc` §"Gate de pronto" (lista numerada 1–6) e `.cursor/rules/060-dotnet-code-style-tests.mdc` §"Pronto ≠ `--filter`".

**Abra os dois arquivos a cada `/revise` e aplique o que estiver lá.** Não são o seu briefing de comportamento (`CLAUDE.md` §7) — são o **fato** sobre o que este repositório considera pronto, e nesse papel são canônicos, inclusive para você. Você não as carrega automaticamente como o Cursor; se não abrir, não sabe.

Duas coisas que só o `/revise` faz com esse gate:

- **Escolher os projetos pela superfície que o diff realmente toca** — os gatilhos condicionais estão nas rules; obedeça-os em vez de rodar tudo por hábito. Bateria inteira em toda rodada não é rigor: é 15 minutos de Integration num diff de três arquivos que não encosta em banco, e o custo reaparece a cada iteração. O rigor está em acertar a superfície.
- **Declarar explicitamente o que não rodou e por quê** — inclusive Docker indisponível (mesmo padrão do fechamento do SH-2). Silêncio não se distingue de esquecimento.

### Rubrica

Aplique a rubrica já existente em `docs/contexts/code-audit-mode.md` — não recrie uma nova aqui. Mas ela se divide em **dois níveis**, e confundir os dois é o que faz esta skill demorar mais que o `/execute` que ela audita.

#### Nível 1 — o Cursor já passou aqui: audite a afirmação, não refaça a passada

O `/execute-code-review` que roda dentro do `/execute` **já** percorreu dois eixos: **Standards** (abriu o mapa da `005`, abriu as rules da área, conferiu o diff contra elas, mais o baseline de smells) e **Spec** (requisito do plano/ADR/scope ausente ou parcial, scope creep, requisito implementado errado). Medido em 2026-09-03: **quatro dos sete itens da rubrica antiga eram essa mesma passada de novo**, e reabrir `005` + `110` + `060` + as rules de área custa ~60 KB de leitura por rodada.

Então, para estes quatro:

- A implementação cobre o que o plano aprovado previa?
- Há escopo extra não aprovado (features, módulos, dependências)?
- As ADRs vigentes da área foram respeitadas?
- As rules da área foram seguidas?

**o insumo é o relatório, não a releitura.** O relatório do `/execute` traz a lista das rules que o eixo Standards abriu. Sua obrigação é **conferir essa lista contra o mapa da `005`** — que rules a área do diff exige — e abrir **somente as que faltarem**. Rule que o Cursor abriu e declarou conforme vira **amostragem**: uma ou duas sondas dirigidas no diff, no mesmo espírito do controle discriminante do ADR-0037 §4. "Standards: nenhum" é afirmação a checar, não seção a regenerar.

Três casos em que o nível 1 volta a ser passada completa, e só eles: o relatório **não lista** as rules abertas; a lista **tem buraco** em relação ao mapa da `005`; ou uma sonda **desmente** a declaração de conformidade. Nos três, diga qual disparou.

⚠️ A economia é de **releitura**, não de julgamento. Você continua respondendo pelas quatro perguntas — só não paga duas vezes pela mesma leitura.

#### Nível 2 — ninguém fez ainda: aqui você não corta nada

Nenhum destes está no `/execute-code-review`, e são eles que historicamente acharam bug — papel de coordenador virando exclusivo, `SetTenantOverride` sem `SetTenant`, serviço sem chamador. **Nenhum sairia de suíte verde nem de releitura de rule.**

- O relatório bate com a realidade? (`git status`, `git diff`, `git log`, e os arquivos de código realmente alterados.)
- Os testes são adequados ao escopo?
- **Antes de chamar algo de violação de convenção, conte os irmãos.** Nome, sufixo, assinatura ou padrão só é desvio se os pares **não** fizerem igual — e isso se mede abrindo os pares, não inferindo de um caso. Em 2026-08-14 acusei `GetSalesTeamRoundRobinStateForUpdateAsync` de prometer um lock inexistente; havia **11** `*ForUpdateAsync` no mesmo contrato, nenhum com lock, porque o sufixo ali significa leitura **rastreada**. O achado virou correção, a correção entrou no código e teve de ser desfeita.
- Não há sincronização reversa spec ← código não aprovada (`CLAUDE.md` §2)?

Mais três perguntas — nenhuma respondida por suíte verde, e por isso ninguém as faz sem ser mandado:

- **A defesa dispara?** e **algum teste novo é vácuo?** Os dois critérios estão em `060` §"Desenho de teste — verde não é prova" (com o precedente do SH-13). Aplique-os **ao código entregue**, não à sua leitura dele: se a entrega adiciona guard/fail-fast/limite/rate limit/header/authz, provoque a condição e observe a consequência real (exit code, 413, 429, 403, log) — as três descobertas mais caras do ADR-0016 passaram ilesas por revisão de código e por teste verde.
  - **Onde gastar o tempo: nos `[raciocinado]`.** O campo "Por que não são vácuos" do relatório vem rotulado por teste (`.cursor/commands/execute.md` §Ciclo TDD). Um `[visto]` traz o mutante aplicado e a falha lida — confira a afirmação e siga; sonde só se o mutante nomeado não puder produzir aquele vermelho. Um `[raciocinado]` é afirmação de quem escreveu o teste, com o mesmo ponto cego dele: é ali que o achado mora, e é ali que você abre o fixture e pergunta se a asserção **pode** falhar.
  - **Discriminante da fatia sem `[visto]` é achado, sem investigação.** O plano elege um (passe 4(e) do `plan-for-cursor`); o relatório deve trazê-lo observado. Rótulo ausente na seção inteira, ou um `[visto]` cuja "prova" é a suíte verde, contam igual.
- **O que o Cursor chamou de "opcional" é mesmo opcional?** Leia a seção "Desvios do plano" do relatório com desconfiança específica: **algo que ele precisou fazer para o próprio fix funcionar não é opcional**, e se o mesmo padrão existe em arquivos ou hosts irmãos, o default é espelhar — o ônus é dele para argumentar por que os irmãos são seguros. Foi exatamente aí que o SH-13 ficou num rodapé por duas horas, com três hosts saindo em exit code 0.

### Resíduo decidido não é achado

Antes de reportar qualquer achado, faça diff contra o **registro canônico de resíduos**: a tabela "Resíduos e decisões" do build-log do passo e a seção de status/histórico da ADR do lote. Um resíduo que está lá **com decisão do owner** (adiado, aceito, encaminhado para outro item) **não volta ao relatório como achado** — renumerá-lo a cada passada é o que transforma auditoria em órbita. Ele só reabre com **evidência nova, citada explicitamente** (novo dado empírico, mudança de custo, dependência que apareceu). Sem evidência nova, a menção certa é uma linha de confirmação: "resíduo X segue como decidido".

O espelho disso na saída: **achado novo que o owner decidir adiar entra na tabela de resíduos ao fechar a rodada** (passo 5) — é isso que faz a próxima auditoria começar do saldo, não do zero.

## 3. Veredicto

Use o vocabulário já definido em `code-audit-mode.md`: **conforme** / **conforme com ressalvas** / **não conforme**. Liste desvios do plano, violações de rule/ADR, e ações corretivas sugeridas, exatamente nos moldes dos entregáveis já esperados por aquele modo.

## 4. Se correção for necessária

Desenhe um plano novo — artefato, nunca código — e salve em `.cursor/plans/<slug>-correcoes.plan.md` (mesma convenção de nome já usada no repo, ex. `adr-0016_sh2_pool_reset_startup_guard.plan.md`), para o Cursor rodar via `/execute` de novo.

**Antes de entregar o plano, aplique a skill `plan-for-cursor`** — os passes e a seção obrigatória de verificações. Ela existe porque planos meus já saíram com passo impossível de executar (porta inexistente), teste rotulado com o que não prova, e gate somado por precaução.

**Nunca edite o código diretamente**, nem para achados pequenos ("só uma mensagem de erro", "só uma string", "fix trivial") — regra do owner de 2026-07-09, sem exceção mesmo em pós-auditoria (`never-edit-product-code.md`). Todo achado vira item da lista do plano de correção para o Cursor executar.

## 5. Se aprovado

Só depois que você (owner) confirmar o veredicto (conforme, ou conforme-com-ressalvas aceito), atualize a documentação de governança no formato já em uso — não invente formato novo:

- Build-log da release corrente: `docs/releases/<release>/build-log/step-<slug>.md`, no formato já estabelecido (cabeçalho Status/ADR/Plano + bloco `## Validação`).

  **De onde vem a evidência do `## Validação`:** enquanto você rerodava tudo, era a sua saída. Agora que a repetição é exceção (passo 2), a fonte padrão é **a saída literal do gate do Cursor**, citada com a **árvore que ela cobre** — o `HEAD` e o estado da working tree no momento do gate, não só o SHA do commit final. Se o relatório não permite amarrar gate e árvore, isso é achado: peça o dado ou registre no build-log que a cobertura não é demonstrável. Quando você **tiver** rerodado por gatilho, use a sua saída e diga qual gatilho disparou. O que não é aceitável é build-log com número de gate sem dono identificável.
- Linha-ponteiro em `CLAUDE.md` §8 se a mudança fechar ou avançar uma ADR.
- `docs/roadmap/release-map.md` / `scope.md` da release corrente se fechar um item de escopo.
- `MEMORY.md` (memória de sessão), como já é feito em todo fechamento de frente.

### Fato em documento de governança precisa de procedência

**Código tem portão; prosa não tem nenhum.** Todo erro seu em código é barrado antes de `master` — o plano manda parar, o executor para, o `/revise` reverifica, o gate roda. Um **fato falso escrito num ADR ou build-log passa direto**, e fica.

Isto não é hipótese. Em 2026-09-02/03 duas afirmações minhas erradas entraram em `master`:

- *"`Architecture.Tests` bloqueia a Fase 4"* — inferido de leitura de código, nunca medido. Refutado depois em uma execução de dois minutos: 114/114 com o banco inalcançável, mesma duração. **E o dano não foi zero:** eu usei a minha própria afirmação falsa como restrição ao planejar a fatia seguinte, que tirou `Architecture` do escopo por causa dela.
- *"o `Gate de PR (build + Unit)` dispara em qualquer PR"* — ele tem Path filter, que **eu mesmo especificara no dia anterior**. Só caiu porque o owner olhou uma tela de Checks e perguntou.

**O modelo de dano:** fato falso em ADR não falha alto. Ele estreita ou alarga escopo futuro em silêncio, porque a ADR é nível 6 na hierarquia do `CLAUDE.md` — o próximo agente lê como verdade e não reverifica.

**A regra, e ela vale só para uma classe de frase.** Decisão e justificativa não precisam de nada — são julgamento. **Afirmação factual sobre o sistema** ("a suíte custa N", "a classe X depende de Y", "o filtro é Z", "o agente tem W") vem com **como foi estabelecida**:

```
✅  medido 2026-09-03: 428/428 em 56s, máquina ociosa
✅  verificado por mim: PostgresTemplateFixture.cs:128 usa Pooling=false
⚠️  inferido de leitura, NÃO medido — reverificar antes de usar como restrição
```

Você já faz isso de forma intermitente; os build-logs desta frente estão cheios de "verificado por mim" e "medido em". **Os dois erros aconteceram exatamente nas frases onde você não marcou.** Marcar é o hábito que falta virar regra, não trabalho novo.

Duas distinções que evitam burocracia inútil:

- **Build-log é registro histórico.** As afirmações dele são datadas por natureza e **não se atualizam** quando a realidade muda — o que importa é não estarem erradas no momento em que foram escritas. Procedência resolve.
- **ADR e rule são documentos vivos**, lidos como verdade corrente. Ali a procedência não basta: se a afirmação factual não puder ser reverificada por um comando, **prefira não escrevê-la** — aponte para o build-log que a mediu, com a data.

⚠️ **Nenhuma sentinela pega isto.** As duas afirmações erradas acima não são mecanizáveis: uma é comportamental (só se checa rodando), a outra é config que vive fora do repositório. Este é o único controle desta skill que depende inteiramente de disciplina — e por isso está escrito, em vez de suposto.

Se a auditoria revelar que a mudança merece uma ADR e ainda não tem uma, não crie sozinho — aplique o critério de "quando oferecer ADR" da skill `domain-modeling` (difícil de reverter + surpreendente sem contexto + resultado de trade-off real) e proponha ao owner.

## 6. Fechar o relógio e descartar o relatório

**Grave a linha antes de encerrar — é a invariante 2 do passo 0, não uma etapa opcional deste passo.** Append em `%USERPROFILE%\.claude\brixbroker\rodadas.csv` (crie com cabeçalho se não existir), uma linha por execução. **Não é `%TEMP%`:** em 2026-09-09 a limpeza do TEMP apagou as 22 linhas acumuladas até ali — o `execute-reports\` é descartável por contrato e pode ficar no TEMP, este arquivo não. Formato:

```
data_hora_inicio;fase;slug;minutos;veredicto;gate_reexecutado;gatilho;nivel1_completo;observacao
```

- `fase` — `revise` (o `/execute` grava `execute` no mesmo arquivo).
- `gate_reexecutado` — `sim`/`nao`; `gatilho` — qual dos três do passo 2 disparou, ou `-`.
- `nivel1_completo` — `sim` quando você teve de refazer a passada de Standards/Spec por inteiro, com o motivo em `observacao` (relatório sem lista de rules, buraco na lista, ou sonda desmentida). É esse campo que mostra se a economia do nível 1 está acontecendo de verdade ou se virou letra morta.

Sem `Import-Csv`/`Export-Csv` — é append de uma linha de texto, e `Export-Csv` reescreve o arquivo inteiro com aspas em tudo.

Depois de lido e processado com sucesso (aprovado, ou plano de correção já desenhado), o relatório em `execute-reports\` é descartável — mesma postura do `/takeover` com o handoff, sem arquivamento formal.
