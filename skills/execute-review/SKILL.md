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

Rode `.cursor/commands/execute-code-review.md` sobre o diff contra a baseline.

### Eixo Standards

Abra as rules relevantes despachadas pelo mapa da `005-documentation-context-hierarchy.mdc` a partir das áreas que o diff toca. **Registre quais rules abriu** — essa lista é insumo do `/revise` depois.

Verifique:
- Convenções de código, estilo, naming.
- Padrões de arquitetura respeitados.
- Imports, DI, registrations corretos.
- Sem código morto, sem TODO sem WI.

### Eixo Spec

Compare o que foi implementado contra:
- O plano (`.cursor/plans/*.plan.md`).
- A spec (`backlog/tasks/*.md`), se existir.
- Os critérios de aceite da WI.
- Os ADRs aplicáveis.

Verifique:
- Todas as fatias do plano foram implementadas.
- Nenhum comportamento foi adicionado fora do escopo.
- Decisões fechadas no plano foram respeitadas.
- Contratos (API, frontend) estão conforme.

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

## Rules abertas
<lista completa de rules que o eixo Standards abriu, ex.: 110, 060, 030, 040, 100>

## Veredicto
- [ ] ✅ **Aprovado** — nenhum 🔴 ou 🟡. Pronto para gate.
- [ ] 🔧 **Fix necessário** — <N> achado(s) 🔴/🟡 para o `/execute-fix`.
- [ ] 🚨 **Escalado ao dev** — rodada 3 sem convergência.
```

## 6. Saída

- **Se aprovado:** declare pronto para o próximo passo (gate, no subagente orquestrador). Entregue a lista de rules abertas para o `/revise` usar depois.
- **Se fix necessário:** passe o relatório para o `/execute-fix` com os achados 🔴/🟡 (não os 🔵).
- **Se escalado:** apresente ao dev os achados persistentes com recomendação para cada um.