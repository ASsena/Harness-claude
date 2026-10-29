# Glossário canônico deste repo

Este repo **não usa um arquivo `CONTEXT.md` separado**. O papel que a skill genérica atribui ao `CONTEXT.md` é cumprido por **`CLAUDE.md` §5 ("Vocabulário canônico")** — já é o glossário ativo, referenciado por 35+ ADRs e mantido a cada sessão de refinamento.

Criar um `CONTEXT.md` novo duplicaria essa fonte, o que o próprio `CLAUDE.md` proíbe no seu princípio de abertura: "apontar para a fonte, nunca duplicá-la" (§0). **Não crie `CONTEXT.md` ou `CONTEXT-MAP.md` neste repo** — edite `CLAUDE.md` §5 diretamente.

## Formato de entrada (já em uso em §5)

```md
- **{Termo}** (`{NomeEmCódigo}`, ex-"{termo antigo}") — {definição em 1-2 frases, o que É, não o que faz}.
```

Variações observadas em §5, todas válidas:

- Termo aposentado, mantido só como nota histórica: `~~Grupo~~ — termo aposentado, ver **Equipe de vendas**.`
- Mapeamento PT (spec/UI) → EN (código/API) sempre entre parênteses: `**Vendedor** (\`Salesperson\`, ex-"responsável"/\`Owner\`) — dono da oportunidade.`
- Marcação de decisão fechada, quando o termo foi motivo de embate: `**Não reabrir sem ADR.**`

## Regras

- **Seja opinativo.** Quando várias palavras nomeiam o mesmo conceito, escolha a melhor e anote as outras como aposentadas ou "evitar" — nunca deixe sinônimos convivendo em spec nova.
- **Definições enxutas.** 1-2 frases. Defina o que o termo É, não o que ele faz.
- **Só termos específicos deste domínio.** Conceitos genéricos de programação (timeout, cache, DTO) não entram, mesmo que o projeto os use bastante. Pergunta de corte: "isso é conceito único deste domínio, ou de programação em geral?" — só o primeiro entra.
- **Agrupe por bloco temático.** §5 já agrupa por (Release/vocabulário geral, Papéis × unidades de venda, etc.) — mantenha esse agrupamento; não vire lista plana.
- **Ao resolver um termo em sessão, edite §5 na hora — não acumule.** Mesma disciplina do `CONTEXT.md` genérico: capture o termo no momento em que ele é fechado, não em lote no fim.

## Contextos múltiplos (`CONTEXT-MAP.md`) — quando (não) usar

O backend é um monólito modular (`Insurtech.<Modulo>.*`: Crm, Communications, Identity, Documents, ProductCatalog...), o que poderia sugerir um `CONTEXT-MAP.md` por módulo. **Ainda não se justifica**: o vocabulário-chave (Lead/Contact/Opportunity, papéis × unidades de venda, etc.) atravessa módulos e precisa de definição única e consistente — é exatamente o tipo de termo que um `CONTEXT-MAP.md` fragmentaria.

Só reconsidere um `CONTEXT-MAP.md` por módulo se, no futuro, um módulo desenvolver vocabulário genuinamente local que **conflite** com o uso em outro módulo (o sinal clássico de bounded context divergente). Até lá, um único glossário global em `CLAUDE.md` §5 é o padrão certo. Se isso mudar, é decisão de arquitetura — trate como ADR, não como ajuste silencioso da skill.
