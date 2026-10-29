# ADR Format

ADRs vivem em `docs/adr/` e usam numeração sequencial: `0001-slug.md`, `0002-slug.md` etc. Este repo já tem 35+ ADRs — **não reinicie a numeração**, escaneie `docs/adr/` pelo número mais alto e incremente.

## Template (padrão da casa, em uso desde o ADR-0001)

```md
# ADR-{NNNN} — {Título curto da decisão}

| Campo | Valor |
|-------|--------|
| **Status** | {Proposto \| Aceito \| Superado por ADR-NNNN} ({data; nota de ratificação do owner, se houver}) |
| **Data** | {AAAA-MM-DD} |
| **Release** | {release/fatia de release a que se aplica, ou "Decisão de plataforma"} |
| **Decisores** | Produto / Arquitetura (owner) |

## Contexto

{O que motivou a decisão: estado atual, tensão ou lacuna, cenário trazido pelo owner. 1 parágrafo curto costuma bastar.}

## Decisão

{A decisão em si. Se for composta, use subseções numeradas (### 1. ..., ### 2. ...) como no ADR-0033.}

## Alternativas consideradas

{Opcional — só quando as alternativas rejeitadas valem a pena registrar (evita que alguém as reproponha sem contexto).}

## Consequências

{Opcional — só quando efeitos não óbvios precisam ser explicitados.}
```

Diferente do template minimalista genérico ("1-3 frases e pronto"), aqui o `## Contexto` e o `## Decisão` são **sempre** esperados — são o que permite a um leitor futuro entender o trade-off sem arqueologia de código. `Alternativas consideradas` e `Consequências` continuam opcionais.

## Depois de aceito

1. Adicione **uma linha-ponteiro** em `CLAUDE.md` §8 ("ADRs vigentes"), no formato `**{NNNN}** — {resumo de uma linha}.` — é o índice que o Claude Code lê a cada sessão; o ADR completo nunca é duplicado lá.
2. Se a decisão introduzir, renomear ou aposentar termos do domínio, atualize `CLAUDE.md` §5 ("Vocabulário canônico") na mesma sessão — ver [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).
3. Se a decisão for estrutural o suficiente para mudar o escopo de uma release, verifique se `docs/roadmap/release-map.md` ou o `scope.md` da release corrente também precisam de atualização (fora do escopo desta skill — é trabalho de governança, não de modelagem de domínio).

## Numeração

Escaneie `docs/adr/` pelo número mais alto existente e incremente em um.

## Quando oferecer um ADR

As três condições abaixo precisam ser verdadeiras:

1. **Difícil de reverter** — o custo de mudar de ideia depois é relevante.
2. **Surpreendente sem contexto** — um leitor futuro vai olhar o código e se perguntar "por que fizeram assim?".
3. **Resultado de um trade-off real** — havia alternativas genuínas e uma foi escolhida por razões específicas.

Se a decisão é fácil de reverter, pule — você vai simplesmente revertê-la. Se não é surpreendente, ninguém vai se perguntar por quê. Se não havia alternativa real, não há nada a registrar além de "fizemos o óbvio".

### O que qualifica

- **Forma arquitetural.** "Usamos monólito modular." "O modelo de escrita é otimista com token `xmin`."
- **Padrões de integração entre módulos/contextos.** "Crm e Communications se comunicam via projeção assíncrona, não chamada síncrona."
- **Escolhas de tecnologia com lock-in.** Banco, fila, provedor de auth, alvo de deploy — não toda biblioteca, só as que levariam um trimestre para trocar.
- **Decisões de fronteira e escopo.** "Dados de Contact são donos do módulo Crm; outros módulos referenciam por ID." Os "não" explícitos valem tanto quanto os "sim".
- **Desvios deliberados do caminho óbvio.** "Usamos CQRS manual sem MediatR porque X." Qualquer coisa em que um leitor razoável assumiria o oposto.
- **Restrições não visíveis no código.** "Não podemos usar X por exigência de compliance." "Tempo de resposta precisa ficar abaixo de 200ms por contrato com parceiro."
- **Alternativas rejeitadas quando a rejeição não é óbvia.** Se GraphQL foi considerado e REST venceu por razões sutis, registre — senão alguém vai sugerir GraphQL de novo em seis meses.

### O que este repo trata como fora do escopo de ADR

- Renomeações puramente de vocabulário sem mudança de forma (isso é `CLAUDE.md` §5, não ADR — a menos que a renomeação em si seja a decisão estrutural, como no ADR-0033).
- Mudanças de escopo de release (isso é `docs/roadmap/release-map.md` + `scope.md`, não ADR).
