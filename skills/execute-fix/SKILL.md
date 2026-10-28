---
name: "execute-fix"
description: "Corrige achados reportados pelo /execute-review: aplica fixes cirúrgicos nos 🔴/🟡, sem expandir escopo. Referencia cada achado pelo ID. Devolve ao /execute-review para revalidação."
---

# /execute-fix — Corrige achados do review

Recebe o relatório do `/execute-review` e corrige **somente** os achados 🔴 (bloqueantes) e 🟡 (importantes). É cirúrgico: não expande escopo, não melhora o que não foi reportado, não refatora "já que está aqui".

## Entrada

- Relatório do `/execute-review` com achados classificados e numerados.
- O plano original (para não desviar do escopo).

## 1. Regras de ouro

### Só o que o review pediu

O fix endereça **exclusivamente** os achados 🔴 e 🟡 do relatório. Para cada linha de código que você tocar, deve existir um ID de achado (`R<N>-XX`) que justifica a mudança.

Proibido:
- Corrigir algo que você "notou ao passar por perto".
- Refatorar código adjacente.
- Adicionar testes além dos que o review pediu.
- Melhorar naming de coisas que o review não citou.
- Endereçar achados 🔵 (sugestões) — eles não vieram para o fix.

Se durante o fix você encontrar um problema real que o review não pegou, **não corrija**: registre-o na saída como "achado novo descoberto durante fix" para o review seguinte avaliar.

### Não introduza regressões

Antes de considerar um achado corrigido:
- Releia o código ao redor da mudança.
- Verifique se a correção não quebra algo que estava funcionando.
- Se o achado pedia mudança em vários arquivos, faça todos — fix parcial é pior que não fazer.

### Respeite as decisões fechadas

O plano tem uma seção "Decisões (não reabrir)". Se um achado do review conflitar com uma decisão fechada, **não resolva sozinho**: registre o conflito na saída para o dev decidir. O review pode estar certo e a decisão precisar mudar, mas essa mudança não é sua.

## 2. Executar os fixes

Para cada achado 🔴/🟡, na ordem do relatório:

1. **Leia o achado** — entenda o que está errado e o que a "correção esperada" pede.
2. **Leia o arquivo** — não corrija de memória. Leia o estado atual do arquivo.
3. **Aplique a correção** — usando Edit para mudanças pontuais, Write só se precisar criar arquivo novo.
4. **Verifique** — releia o trecho corrigido e confirme que faz sentido no contexto.

## 3. Testes impactados

Se o fix alterou comportamento (não apenas naming/estilo):
- Rode os testes que cobrem o trecho alterado.
- Se um teste quebrou por causa do fix, corrija o teste **se e somente se** o fix está correto e o teste refletia o comportamento errado.
- Se o teste quebrou e o fix parece errado, reverta o fix e registre como "não consegui corrigir sem quebrar teste existente".

## 4. Produzir o relatório do fix

```markdown
# Fix — Rodada <N>

- **Review respondido:** Rodada <N-1>
- **Achados endereçados:** <quantidade> de <total 🔴/🟡>

## Correções aplicadas

| ID do achado | Status | O que foi feito |
|---|---|---|
| R<N-1>-01 | ✅ Corrigido | <descrição curta da correção> |
| R<N-1>-02 | ✅ Corrigido | <descrição curta da correção> |
| R<N-1>-03 | ⚠️ Parcial | <o que foi feito e o que faltou, com motivo> |
| R<N-1>-04 | ❌ Não corrigido | <por que não foi possível — conflito com decisão, dependência externa, etc.> |

## Arquivos alterados
<lista de arquivos tocados pelo fix, com o ID do achado que motivou cada um>

## Testes
- Testes rodados: <lista ou "nenhum — fix foi apenas de estilo/naming">
- Resultados: <passou/falhou>

## Achados novos descobertos durante fix
<achados que você encontrou mas NÃO corrigiu — ficam para o review seguinte avaliar>
- <descrição> em `<arquivo>:<linha>` — descoberto ao corrigir R<N-1>-XX.

## Conflitos com decisões fechadas
<achados cujo fix conflitaria com decisão do plano — escalar ao dev>
- R<N-1>-XX conflita com decisão "<qual>" — <explicação>.
```

## 5. Saída

Entregue o relatório do fix ao `/execute-review` para a rodada seguinte. O review vai verificar se:
- Os achados foram realmente corrigidos.
- Não houve regressões.
- Achados novos (se houver) precisam de tratamento.

**Não commite.** O commit só acontece quando o review aprovar.