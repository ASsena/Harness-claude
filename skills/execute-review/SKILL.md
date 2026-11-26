---
name: "execute-review"
description: "Revisa código implementado pelo /execute-implement ou corrigido pelo /execute-fix: code review em três eixos (Standards, Spec, Correção), em lentes paralelas ou num revisor só, e revisão final às cegas do diff do PR; relatório de achados estruturado, controle de iterações (máx 3). Sem gate — o gate é a esteira do PR."
---

# /execute-review — Revisa a implementação em três eixos

Revisa o diff produzido pelo `/execute-implement` (rodada 1) ou pelo `/execute-fix` (rodadas seguintes), e o diff inteiro do PR antes do push (revisão final). Produz um relatório estruturado de achados. **Não** faz gate, commit nem relatório final — isso fica no subagente orquestrador.

## Entradas

- **Rodada 1:** recebe o código do `/execute-implement` e o caminho do plano.
- **Rodadas 2+:** recebe o código corrigido pelo `/execute-fix` e o relatório da rodada anterior.
- **Revisão final:** recebe só o diff do PR, o plano (critérios e decisões) e as decisões do dev.

## 0. Modo e controle de iteração

Dentro do pipeline, quem escolhe o modo e numera é o `harness:graduation-agent`: use o modo, a rodada (ou passagem) e a baseline que ele informar. Avulsa, você é um revisor só: modo **completo**, rodada 1, os três eixos.

| Modo | Eixos | O que você lê além do diff | Para quê |
|---|---|---|---|
| **completo** (avulso) | Standards + Spec + Correção | plano, spec, relatórios de implementação | revisão única |
| **lente A — conformidade** | Standards + Spec + classificação estrutural | plano, spec, `preflight.md`, `impl-*.md` | rodada 1, em paralelo com a lente B |
| **lente B — correção** | Correção (§2.4) + "verde não é prova" (§2.5) | spec (critérios), "Decisões" do plano, desvios e ciclo TDD dos `impl-*.md` | rodada 1, em paralelo com a lente A |
| **verificação** | os três, nos trechos que os fixes tocaram | relatórios da rodada anterior e os `fix-*.md` | rodadas 2–3 e passagem 2 da revisão final |
| **final às cegas** | os três + rubrica do `/review-pr` (§2.6) | **só** spec, critérios e "Decisões" do plano, decisões do dev nas escalações | passagem 1 da revisão final, antes do push |
| **recorte** (M, C, E) | os três, no recorte informado | os arquivos que o orquestrador indicar | resolução de conflito, correção da esteira, escalação |

Numa lente, fique na sua lente: o que é da outra você não procura (se tropeçar num problema óbvio fora dela, registre como 🔵 com a nota "fora da lente"). A lente estreita é o que dá profundidade — um revisor com todas as rubricas no mesmo contexto lê cada uma pela metade.

**Limite: 3 rodadas.** Se na rodada 3 (ou na passagem 2 da revisão final) ainda restarem achados não resolvidos, **não** peça mais um fix. Em vez disso:

- Liste os achados persistentes.
- Explique por que não convergiram.
- Escale ao dev com recomendação: o que fazer com cada achado (corrigir manualmente, aceitar como dívida técnica, cortar escopo).

## 1. Preparar a baseline

Identifique o ponto fixo para o diff:

- **Rodada 1:** o SHA-base. É o mesmo no manifesto do plano e no `preflight.md` do pipeline (o `HEAD` logo antes do commit do plano); se o orquestrador informar a baseline, use a dele.
- **Rodadas 2+:** o mesmo ponto fixo da rodada 1 — o diff sempre é contra a baseline original, não contra o fix anterior. Isso evita que achados "sumam" porque o diff encolheu.
- **Revisão final:** a master integrada, com três pontos (`git diff <sha_master>...HEAD`) — é exatamente o diff que o PR vai mostrar.
- **Revisões de recorte** (resolução de conflito, correção da esteira, escalação): a baseline é a que o orquestrador informar (o commit da implementação, ou o SHA do último push), recortada aos arquivos indicados. **Nunca** o SHA-base: depois do merge, esse diff traz todo o código que veio da master.

## 2. Revisão

### 2.1 Postura: o diff é a fonte de verdade

Você revisa o **código**, não a narrativa de quem implementou. O plano e os relatórios de implementação (`impl-*.md`, `fix-*.md`) dizem o que *deveria* ter acontecido e onde olhar — são ponto de partida, nunca prova. Leia o **diff real** contra a baseline e o código dos arquivos centrais; nunca revise pela lista de arquivos nem pelo resumo do relatório. Diff grande: use `Grep` para achar os pontos quentes e `Read` com offset/limit nos trechos que importam — não pule arquivo por ser "só UI".

**Estar conforme ao plano não basta.** Se o plano errou, o código que o segue fielmente continua errado. Seu trabalho é dizer se o código está **certo**, não só se está **conforme**.

**Leia cada arquivo alterado, não só o hunk.** O defeito mais comum que escapa é a linha nova que conversa errado com a linha velha ao lado (o `if` novo que o `return` antigo nunca deixa executar, o campo novo que o mapeamento existente não copia).

Rode `.cursor/commands/execute-code-review.md` sobre o diff contra a baseline e, além dele, aplique a rubrica de `docs/contexts/code-audit-mode.md` (cobre o previsto? escopo extra? ADRs respeitados? rules da área seguidas? testes adequados? sincronização reversa spec ← código?). Não recrie outra rubrica: abra o arquivo a cada revisão. (Lente B: só a parte de testes adequados.)

### 2.2 Classificação estrutural (antes dos eixos; lente A, final e completo)

**Classifique a mudança pelo que o diff faz, não pelo rótulo do plano ou da fatia.** Pergunte sempre: *este diff muda protocolo, fronteira de módulo, modelo de domínio, superfície de autenticação/autorização, contrato de API ou configuração de segurança?*

- Se sim e o plano/ADR **não** registra essa decisão explicitamente → 🔴 Bloqueante [Spec]: mudança estrutural sem decisão registrada (regra de ADR do `CLAUDE.md` §2). Isso vale mesmo que a mudança esteja dentro de uma fatia do plano chamada "refatoração", "ajuste" ou "UI".
- Olhe com atenção os arquivos que passam despercebidos num diff de UI: realms/config de identidade, `deploy/**`, `infra/**`, interceptors, guards, migrations, `appsettings*`, políticas de CORS/headers.

Registre o resultado no relatório (§5, "Classificação estrutural"), mesmo quando a resposta for "não".

### 2.3 Eixos Standards e Spec (lente A, final e completo)

#### Standards

Abra as rules relevantes despachadas pelo mapa da `005-documentation-context-hierarchy.mdc` a partir das áreas que o diff toca. **Rule não aberta é rule não checada** — quem implementou recebe parte delas pelos `globs`; para você não chega nenhuma, e responder de memória produz achado plausível e errado. **Registre quais rules abriu** — essa lista é insumo do `/revise` depois. Na verificação, abra só as rules das áreas que os fixes tocaram.

Verifique:
- Convenções de código, estilo, naming.
- Padrões de arquitetura respeitados.
- Imports, DI, registrations corretos.
- Sem código morto, sem TODO sem WI.

**Antes de chamar algo de violação de convenção, conte os irmãos.** Nome, sufixo ou padrão só é desvio se os pares **não** fizerem igual — abra os pares e meça. O inverso também vale: se os irmãos têm guard, validação ou registration e o código novo não tem, o default é espelhar.

#### Spec

Compare o que foi implementado contra:
- O plano (`.cursor/plans/*.plan.md`) — na revisão final, só critérios e "Decisões".
- A spec (`backlog/tasks/*.md`), se existir.
- Os critérios de aceite da WI.
- Os ADRs: **liste `docs/adr/` e abra os que as áreas tocadas envolvem** — não confie na linha-resumo do `CLAUDE.md` nem no que o plano citou. Registre quais abriu.

Verifique:
- Todas as fatias do plano foram implementadas; **cada critério de aceite tem código e teste que o provam** — critério sem prova é achado.
- Nenhum comportamento foi adicionado fora do escopo.
- Decisões fechadas no plano foram respeitadas.
- Contratos (API, frontend) estão conforme.
- O plano não contradiz nenhum ADR vigente. Se contradiz, o achado é do plano, não do código: 🔴 [Spec] com correção esperada "escalar ao dev" — o `/execute-fix` não resolve isso.

### 2.4 Eixo Correção (lente B, final e completo)

Os outros eixos perguntam se o código segue as regras e o plano. Este pergunta **se ele funciona** — e é onde moram os buracos que uma revisão do PR em sessão separada acha. Para **cada ramo novo ou alterado**, responda com o código aberto:

- **Que entrada leva a cada lado do ramo, e o que acontece no lado de erro?** Exceção engolida, `catch` vazio, `catch` que loga e segue, retorno padrão silencioso (`null`, lista vazia, `0`) onde o chamador esperava erro, `Result` de falha que ninguém lê.
- **Bordas:** nulo, vazio, coleção vazia, um elemento, limite (0, 1, máx, máx+1), duplicados, ordenação, paginação na última página, datas e fuso, cultura (vírgula decimal), texto com acento ou muito longo.
- **Assíncrono:** `await` faltando, `.Result`/`.Wait()`, `async void`, `CancellationToken` não propagado, tarefa disparada e esquecida, ordem de efeitos que muda com a concorrência.
- **Persistência:** unidade de trabalho/transação (salva parcial se o segundo passo falhar?), `SaveChanges` faltando ou duplicado, N+1, tracking, migration que perde dado, **filtro de tenant, carteira, visibilidade ou RLS em toda consulta nova**.
- **Autorização:** toda rota/handler novo tem a policy dos irmãos; o id que vem na rota ou no corpo pertence ao usuário/tenant (IDOR); o frontend esconder o botão não é autorização.
- **Contrato ponta a ponta:** DTO ↔ frontend (nome, nulabilidade, enum, formato de data), código e mensagem de erro que o frontend trata, campo novo que o mapeamento existente não copia.
- **Frontend:** subscription sem `takeUntilDestroyed`/unsubscribe, estados vazio/carregando/erro da spec, submit duplo, formulário que valida no cliente e não no servidor, `OnPush` sem gatilho de detecção, rota/guard, acessibilidade que a spec pede.
- **Idempotência e reentrância:** clique duplo, retry de mensagem/fila, reprocessamento.
- **Segurança:** injeção (SQL, HTML), dado sensível em log ou resposta, segredo em config versionada.

**Todo achado de Correção traz o cenário de falha:** a entrada ou o estado concretos → o resultado errado observável. Sem cenário concreto, não é 🔴/🟡 — no máximo 🔵, com a dúvida dita. Quando o cenário for barato de provar, prove (teste dirigido, §2.5).

### 2.5 Verde não é prova (critérios da `060` §"Desenho de teste"; lente B, final e completo)

Abra a `060-dotnet-code-style-tests.mdc` quando o diff tocar testes ou backend e responda, para a entrega:

- **A defesa dispara?** Se a entrega adiciona guard, fail-fast, limite, authz, validação ou header, provoque a condição e observe a consequência real. Teste que só passa pelo caminho feliz não prova a defesa.
- **Algum teste novo é vácuo?** Assert que não falharia se o código fosse removido, mock que devolve o próprio valor esperado, teste que só verifica que "não lançou".
- **O discriminante da fatia** (o teste que o plano elegeu) veio `[visto]` no relatório de implementação? Sem isso, o item não fecha.
- **O que foi chamado de "opcional", "fora de escopo" ou "resíduo" é mesmo isso?** O que o próprio fix precisou para funcionar não é opcional; se o padrão existe nos irmãos, o ônus é de quem implementou mostrar por que não se aplica.

Você **pode e deve** rodar teste dirigido (projeto único, `--filter`) quando houver dúvida real e for barato — isso é verificação, não gate. O gate é a esteira do PR. Declare no relatório o que rodou e o que deixou de rodar e por quê; silêncio não se distingue de esquecimento.

### 2.6 Revisão final às cegas

É a revisão que o dev faria com o `/review-pr` numa sessão separada, feita antes de o código sair da máquina. O valor dela é **não herdar o roteiro**: você não lê pré-análise, relatórios de implementação, reviews nem fixes anteriores — se ler, revisa pelo caminho que os outros já percorreram e vê o que eles viram.

- O diff é `git diff <sha_master>...HEAD`: o PR inteiro, depois de todos os fixes e do merge da master.
- Os três eixos, inteiros. Comece pelo eixo Correção nos arquivos de maior risco (persistência, authz, endpoints, estado de tela).
- **Se o repositório tiver o `/review-pr`** (`.claude/skills/review-pr/SKILL.md` ou `.claude/commands/review-pr.md`), abra e aplique a rubrica dele **como lente adicional** — só os critérios de revisão: os achados saem no formato deste relatório, sem plano de correção, comentário em PR ou edição de arquivo. Registre no relatório que aplicou (ou que não existe).
- Do que o dev decidiu (escalações, "Decisões (não reabrir)" do plano) você sabe — resíduo decidido não é achado (§2.7). Do resto, nada.

### 2.7 Resíduo decidido não é achado

Antes de reportar, confira o que o dev já decidiu (plano, escalações anteriores desta WI, tabela de resíduos). Resíduo com decisão do dev **não volta como achado** — só reabre com evidência nova, citada.

## 3. Classificar achados

Cada achado recebe:

- **ID:** `R<rodada>-<número sequencial>` (ex.: `R1-01`, `R2-01`). Na rodada 1 com lentes, a letra da lente entra no número: `R1-A01`, `R1-B01`. Na revisão final, `RF<passagem>-XX`. Nas revisões de conflito, de correção da esteira e de escalação, o prefixo é o que o orquestrador informar (`RM<n>.<r>`, `RC<n>.<r>`, `RE<n>`) — nunca `M<n>`, `C<n>`, `B<n>` ou `E<n>`, que já são os IDs dos conflitos, das falhas da esteira, dos erros de compilação e das perguntas.
- **Eixo:** `Standards`, `Spec` ou `Correção`.
- **Severidade:**
  - 🔴 **Bloqueante** — quebra funcionalidade, viola ADR/rule, ou diverge da spec. Tem que corrigir.
  - 🟡 **Importante** — não quebra mas é problema real (naming errado, padrão não seguido, teste incompleto, borda sem tratamento com cenário concreto). Deve corrigir.
  - 🔵 **Sugestão** — melhoria que não é obrigatória neste ciclo. **Não vai para o `/execute-fix`** — fica registrada para o dev decidir depois.
- **Arquivo e linha(s).**
- **Descrição:** o que está errado e por quê.
- **Cenário de falha** (obrigatório no eixo Correção): entrada/estado → resultado errado.
- **Correção esperada:** o que o fix deve fazer (concreto, não vago).

**A severidade é do defeito, não da rodada.** O mesmo problema recebe a mesma severidade na rodada 1 e na 3. Rebaixar para 🔵 para fechar o ciclo é proibido: se não convergiu, é escalação — o dev prefere uma pergunta a um buraco no PR.

## 4. Rastreabilidade entre rodadas

**Verificação (rodadas 2+ e passagem 2 da final):** antes de listar novos achados, faça o de-para dos achados da rodada anterior (de todas as lentes):

```markdown
### Status dos achados anteriores
| ID anterior | Status | Nota |
|---|---|---|
| R1-A01 | ✅ Resolvido | fix correto |
| R1-B02 | ⚠️ Parcialmente resolvido | tratou o nulo mas não a lista vazia |
| R1-A03 | ❌ Não resolvido | fix não endereçou este achado |
| R1-B04 | 🔄 Regressão | o fix quebrou algo que estava funcionando |
```

Achados parcialmente resolvidos ou não resolvidos ganham novo ID na rodada corrente (ex.: `R1-B02` parcial vira `R2-01` com a parte restante). Regressões também ganham ID novo.

**Achados novos do fix:** todo item de "Achados novos descobertos durante fix" dos `fix-*.md` entra no relatório — vira achado desta rodada (ID novo) ou é descartado com o motivo. Nenhum morre no arquivo do fix.

**Leia por inteiro os arquivos que os fixes tocaram** (não só o hunk do fix): regressão mora ao lado da correção.

## 5. Produzir o relatório

```markdown
# Review — <Rodada N | Rodada 1, lente A | Rodada 1, lente B | Final, passagem K | recorte>

- **Plano:** <caminho do plano>
- **Baseline (SHA):** <sha do ponto fixo>
- **Modo:** <completo | lente A | lente B | verificação | final às cegas | recorte>
- **Rodada:** <N> de 3  (ou passagem <K> de 2)

## Status dos achados anteriores
<tabela do §4 — omitir na rodada 1 e na final às cegas>

## Achados novos dos fixes avaliados
<cada item de "achados novos" dos fix-*.md: virou <ID> | descartado porque … — omitir quando não houver>

## Achados desta rodada

### 🔴 Bloqueantes
- **<ID>** [Standards|Spec|Correção] `<arquivo>:<linha>` — <descrição>. Cenário: <entrada/estado → resultado errado>. Correção esperada: <o que fazer>.

### 🟡 Importantes
- **<ID>** [Standards|Spec|Correção] `<arquivo>:<linha>` — <descrição>. Cenário: <…>. Correção esperada: <o que fazer>.

### 🔵 Sugestões (não vão para fix)
- **<ID>** [Standards|Spec|Correção] `<arquivo>:<linha>` — <descrição>.

## Critérios de aceite × prova
<lente A, final e completo: cada critério → o código e o teste que o provam, ou "sem prova" (é achado)>

## Classificação estrutural
<o diff muda protocolo, fronteira de módulo, modelo de domínio, authn/authz, contrato de API ou config de segurança? sim/não; se sim, onde e se há decisão registrada>

## Rules abertas
<lista completa de rules que o eixo Standards abriu, ex.: 110, 060, 030, 040, 100>

## ADRs abertos
<lista dos ADRs abertos no eixo Spec>

## Rubrica do /review-pr
<final às cegas: aplicada (caminho) | não existe no repositório>

## Verificações executadas
<testes dirigidos que rodou e resultado; o que não rodou e por quê>

## Veredicto
- [ ] ✅ **Aprovado** — nenhum 🔴 ou 🟡. Pronto para o próximo passo.
- [ ] 🔧 **Fix necessário** — <N> achado(s) 🔴/🟡 para o `/execute-fix`.
- [ ] 🚨 **Escalado ao dev** — rodada 3 (ou passagem 2 da final) sem convergência.
```

Seções que não se aplicam ao modo (ex.: rules na lente B): escreva "não se aplica a este modo", não omita.

## 6. Saída

- **Se aprovado:** declare pronto para o próximo passo (no pipeline, quem decide qual é o orquestrador). Entregue a lista de rules abertas para o `/revise` usar depois.
- **Se fix necessário:** passe o relatório para o `/execute-fix` com os achados 🔴/🟡 (não os 🔵).
- **Se escalado:** apresente ao dev os achados persistentes com recomendação para cada um.
