---
name: "execute-review"
description: "Revisa código implementado pelo /execute-implement ou corrigido pelo /execute-fix: code review em dois eixos (Standards + Spec), relatório de achados estruturado, controle de iterações (máx 3). Sem gate — gate fica no subagente orquestrador."
---

# /execute-review — Revisa a implementação em dois eixos

Revisa o diff produzido pelo `/execute-implement` (rodada 1) ou pelo `/execute-fix` (rodadas seguintes). Produz um relatório estruturado de achados. **Não** faz gate, commit nem relatório final — isso fica no subagente orquestrador que roda depois.

## Entradas

- **Rodada 1:** recebe o código do `/execute-implement` e o caminho do plano.
- **Rodadas 2+:** recebe o código corrigido pelo `/execute-fix` e o relatório da rodada anterior.

## 0. Controle de iteração

Cada invocação é uma **rodada**. Numere-as sequencialmente (rodada 1, 2, 3…). Dentro do pipeline, quem numera é o `harness:graduation-agent`: use o número e o tipo de revisão que ele informar.

**Limite: 3 rodadas.** Se na rodada 3 ainda restarem achados não resolvidos, **não** peça mais um fix. Em vez disso:

- Liste os achados persistentes.
- Explique por que não convergiram em 3 tentativas.
- Escale ao dev com recomendação: o que fazer com cada achado (corrigir manualmente, aceitar como dívida técnica, cortar escopo).

## 1. Preparar a baseline

Identifique o ponto fixo para o diff:

- **Rodada 1:** o SHA-base. É o mesmo no manifesto do plano e no `preflight.md` do pipeline (o `HEAD` logo antes do commit do plano); se o orquestrador informar a baseline, use a dele.
- **Rodadas 2+:** o mesmo ponto fixo da rodada 1 — o diff sempre é contra a baseline original, não contra o fix anterior. Isso evita que achados "sumam" porque o diff encolheu.
- **Revisões depois do merge da master** (resolução de conflito, correção do gate, escalação): a baseline é a que o orquestrador informar (o commit da implementação, ou o `HEAD` que o gate viu), recortada aos arquivos indicados. **Nunca** o SHA-base: depois do merge, esse diff traz todo o código que veio da master.

## 2. Revisão em dois eixos

### Postura: o diff é a fonte de verdade

Você revisa o **código**, não a narrativa de quem implementou. O plano e os relatórios de implementação (`impl-*.md`, `fix-*.md`) dizem o que *deveria* ter acontecido e onde olhar — são ponto de partida, nunca prova. Leia o **diff real** contra a baseline (`git diff <baseline>..HEAD`) e o código dos arquivos centrais; nunca revise pela lista de arquivos nem pelo resumo do relatório. Diff grande: use `Grep` para achar os pontos quentes e `Read` com offset/limit nos trechos que importam — não pule arquivo por ser "só UI".

**Estar conforme ao plano não basta.** Se o plano errou, o código que o segue fielmente continua errado. Seu trabalho é dizer se o código está **certo**, não só se está **conforme**.

Rode `.cursor/commands/execute-code-review.md` sobre o diff contra a baseline e, além dele, aplique a rubrica de `docs/contexts/code-audit-mode.md` (cobre o previsto? escopo extra? ADRs respeitados? rules da área seguidas? testes adequados? sincronização reversa spec ← código?). Não recrie outra rubrica: abra o arquivo a cada revisão.

### Classificação estrutural (antes dos dois eixos)

**Classifique a mudança pelo que o diff faz, não pelo rótulo do plano ou da fatia.** Pergunte sempre: *este diff muda protocolo, fronteira de módulo, modelo de domínio, superfície de autenticação/autorização, contrato de API ou configuração de segurança?*

- Se sim e o plano/ADR **não** registra essa decisão explicitamente → 🔴 Bloqueante [Spec]: mudança estrutural sem decisão registrada (regra de ADR do `CLAUDE.md` §2). Isso vale mesmo que a mudança esteja dentro de uma fatia do plano chamada "refatoração", "ajuste" ou "UI".
- Olhe com atenção os arquivos que passam despercebidos num diff de UI: realms/config de identidade, `deploy/**`, `infra/**`, interceptors, guards, migrations, `appsettings*`, políticas de CORS/headers.

Registre o resultado no relatório (§5, "Classificação estrutural"), mesmo quando a resposta for "não".

### Eixo Standards

Abra as rules relevantes despachadas pelo mapa da `005-documentation-context-hierarchy.mdc` a partir das áreas que o diff toca. **Rule não aberta é rule não checada** — quem implementou recebe parte delas pelos `globs`; para você não chega nenhuma, e responder de memória produz achado plausível e errado. **Registre quais rules abriu** — essa lista é insumo do `/revise` depois.

Verifique:
- Convenções de código, estilo, naming.
- Padrões de arquitetura respeitados.
- Imports, DI, registrations corretos.
- Sem código morto, sem TODO sem WI.

**Antes de chamar algo de violação de convenção, conte os irmãos.** Nome, sufixo ou padrão só é desvio se os pares **não** fizerem igual — abra os pares e meça. O inverso também vale: se os irmãos têm guard, validação ou registration e o código novo não tem, o default é espelhar.

### Eixo Spec

Compare o que foi implementado contra:
- O plano (`.cursor/plans/*.plan.md`).
- A spec (`backlog/tasks/*.md`), se existir.
- Os critérios de aceite da WI.
- Os ADRs: **liste `docs/adr/` e abra os que as áreas tocadas envolvem** — não confie na linha-resumo do `CLAUDE.md` nem no que o plano citou. Registre quais abriu.

Verifique:
- Todas as fatias do plano foram implementadas.
- Nenhum comportamento foi adicionado fora do escopo.
- Decisões fechadas no plano foram respeitadas.
- Contratos (API, frontend) estão conforme.
- O plano não contradiz nenhum ADR vigente. Se contradiz, o achado é do plano, não do código: 🔴 [Spec] com correção esperada "escalar ao dev" — o `/execute-fix` não resolve isso.

### Verde não é prova (critérios da `060` §"Desenho de teste")

Abra a `060-dotnet-code-style-tests.mdc` quando o diff tocar testes ou backend e responda, para a entrega:

- **A defesa dispara?** Se a entrega adiciona guard, fail-fast, limite, authz, validação ou header, provoque a condição e observe a consequência real. Teste que só passa pelo caminho feliz não prova a defesa.
- **Algum teste novo é vácuo?** Assert que não falharia se o código fosse removido, mock que devolve o próprio valor esperado, teste que só verifica que "não lançou".
- **O que foi chamado de "opcional", "fora de escopo" ou "resíduo" é mesmo isso?** O que o próprio fix precisou para funcionar não é opcional; se o padrão existe nos irmãos, o ônus é de quem implementou mostrar por que não se aplica.

Você **pode e deve** rodar teste dirigido (projeto único, `--filter`) quando houver dúvida real e for barato — isso é verificação, não gate. O gate completo (`run-gate.ps1`) continua sendo do orquestrador. Declare no relatório o que rodou e o que deixou de rodar e por quê; silêncio não se distingue de esquecimento.

### Resíduo decidido não é achado

Antes de reportar, confira o que o dev já decidiu (plano, escalações anteriores desta WI, tabela de resíduos). Resíduo com decisão do dev **não volta como achado** — só reabre com evidência nova, citada.

## 3. Classificar achados

Cada achado recebe:

- **ID:** `R<rodada>-<número sequencial>` (ex.: `R1-01`, `R1-02`, `R2-01`). Nas revisões de conflito, de correção do gate e de escalação, o prefixo é o que o orquestrador informar (`RM<n>.<r>`, `RG<n>.<r>`, `RE<n>`) — nunca `M<n>`, `G<n>` ou `E<n>`, que já são os IDs dos conflitos, dos testes vermelhos e das perguntas.
- **Eixo:** `Standards` ou `Spec`.
- **Severidade:**
  - 🔴 **Bloqueante** — quebra funcionalidade, viola ADR/rule, ou diverge da spec. Tem que corrigir.
  - 🟡 **Importante** — não quebra mas é problema real (naming errado, padrão não seguido, teste incompleto). Deve corrigir.
  - 🔵 **Sugestão** — melhoria que não é obrigatória neste ciclo. **Não vai para o `/execute-fix`** — fica registrada para o dev decidir depois.
- **Arquivo e linha(s).**
- **Descrição:** o que está errado e por quê.
- **Correção esperada:** o que o fix deve fazer (concreto, não vago).

## 4. Rastreabilidade entre rodadas

**Rodadas 2+:** antes de listar novos achados, faça o de-para dos achados da rodada anterior:

```markdown
### Status dos achados anteriores
| ID anterior | Status | Nota |
|---|---|---|
| R1-01 | ✅ Resolvido | fix correto |
| R1-02 | ⚠️ Parcialmente resolvido | corrigiu o naming mas faltou o registration |
| R1-03 | ❌ Não resolvido | fix não endereçou este achado |
| R1-04 | 🔄 Regressão | o fix quebrou algo que estava funcionando |
```

Achados parcialmente resolvidos ou não resolvidos ganham novo ID na rodada corrente (ex.: `R1-02` parcial vira `R2-01` com a parte restante). Regressões também ganham ID novo.

## 5. Produzir o relatório da rodada

```markdown
# Review — Rodada <N>

- **Plano:** <caminho do plano>
- **Baseline (SHA):** <sha do ponto fixo>
- **Rodada:** <N> de 3

## Status dos achados anteriores
<tabela do §4 — omitir na rodada 1>

## Achados desta rodada

### 🔴 Bloqueantes
- **R<N>-01** [Standards|Spec] `<arquivo>:<linha>` — <descrição>. Correção esperada: <o que fazer>.

### 🟡 Importantes
- **R<N>-02** [Standards|Spec] `<arquivo>:<linha>` — <descrição>. Correção esperada: <o que fazer>.

### 🔵 Sugestões (não vão para fix)
- **R<N>-03** [Standards|Spec] `<arquivo>:<linha>` — <descrição>.

## Classificação estrutural
<o diff muda protocolo, fronteira de módulo, modelo de domínio, authn/authz, contrato de API ou config de segurança? sim/não; se sim, onde e se há decisão registrada>

## Rules abertas
<lista completa de rules que o eixo Standards abriu, ex.: 110, 060, 030, 040, 100>

## ADRs abertos
<lista dos ADRs abertos no eixo Spec>

## Verificações executadas
<testes dirigidos que rodou e resultado; o que não rodou e por quê>

## Veredicto
- [ ] ✅ **Aprovado** — nenhum 🔴 ou 🟡. Pronto para gate.
- [ ] 🔧 **Fix necessário** — <N> achado(s) 🔴/🟡 para o `/execute-fix`.
- [ ] 🚨 **Escalado ao dev** — rodada 3 sem convergência.
```

## 6. Saída

- **Se aprovado:** declare pronto para o próximo passo (gate, no subagente orquestrador). Entregue a lista de rules abertas para o `/revise` usar depois.
- **Se fix necessário:** passe o relatório para o `/execute-fix` com os achados 🔴/🟡 (não os 🔵).
- **Se escalado:** apresente ao dev os achados persistentes com recomendação para cada um.