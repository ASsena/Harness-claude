---
name: mockup-task
description: Gera o mockup das mudanças visuais de um Work Item com os componentes broker-* que já existem e o tema Segurus do design-system, no formato de import da casa (platform/frontend/_imports/claude-design/), e trava até o dev aprovar. Chamada pelo /plan-task quando a WI mexe em tela; também roda avulsa com "/mockup-task" seguido do número da WI.
argument-hint: "nº do Work Item do Azure Boards (ex.: 2538)"
---

Transforma o pedido visual de uma WI em **mockup aprovado pelo dev**, montado com as peças que o app já tem. Sai um import datado em `platform/frontend/_imports/claude-design/wi-<id>-<slug>/<AAAA-MM-DD>/`, no mesmo formato dos imports existentes (modelo: `wi-3224-fluxos/2026-09-24/`).

**O mockup é insumo aprovado, não fonte da verdade** (ADR-0011, "O que não muda"). A seta continua `spec → código`: o que o mockup decide sobe para a spec (§6) e é a spec que o plano e o Cursor seguem.

**O que esta skill não faz:** não escreve código de produto (`CLAUDE.md` §2), não cria nem altera componente em `libs/`, não mexe no tema. Promover componente para `broker-*` é decisão à parte (`docs/architecture/design-system-evolution.md`, "Processo recomendado para novos componentes").

**Quando é chamada pelo `/plan-task`**, a WI já foi lida (§1 de lá): reaproveite, não busque de novo. Avulsa, leia a WI exatamente como o `/plan-task` §1 manda, incluindo anexos e comentários.

---

## 1. A WI exige mudança visual? — decida antes de desenhar

Sinais de que exige:

- descrição, critério de aceite ou comentário fala de tela, página, modal, botão, campo, coluna, filtro, card, mensagem exibida, layout ou responsividade;
- anexo é print, wireframe ou protótipo;
- a área de impacto (`backlog/tasks/<id>-<slug>.md`) inclui `libs/features/**`, `libs/layout/**`, `libs/design-system/**` ou `apps/*/src/**` de UI.

Sem nenhum sinal: devolva "sem mudança visual" ao chamador e pare. Sinal fraco ou indireto (ex.: "retornar o campo X na API" — vai aparecer em alguma tela?) é pergunta ao dev pela régua dos 95% do `/plan-task` §4.

**Já existe import para esta WI** em `_imports/claude-design/`? Então o mockup já foi feito: leia os `notes*.md` e os arquivos **Decisão** (os **Variantes** são histórico), confira se cobrem o pedido atual e só complemente o que faltar, num import novo datado. Não sobrescreva import antigo.

**Print anexado é referência, não gabarito.** Onde ele divergir do design system, o design system vence, e a divergência vai para o dev ver (§5).

---

## 2. Ler o design system na fonte — não copiar

Princípio do `CLAUDE.md`: apontar para a fonte, nunca duplicá-la. Não existe "mapa do design system" desta skill; leia direto, a cada rodada, só o que a tela precisa:

| O quê | Onde |
|---|---|
| Fronteira e regras (Material só por dentro dos `broker-*`, quando embrulhar, surfaces) | ADR-0011 (§Decisão 1–3) e ADR-0004 |
| Catálogo de componentes públicos (`broker-*`) e densidades | `platform/frontend/libs/design-system/README.md` + o código em `libs/design-system/src/lib/` para inputs/variações reais |
| Tokens (cor, tipografia, espaçamento, raio, elevação) e os dois surfaces | `libs/design-system/src/lib/theming/` (`_tokens.scss`, `segurus-erp-surface`, `segurus-marketing-surface`) |
| Surface da tela | ERP/gestão para `broker-web` e `admin-web`; marketing para `sales-site` |
| Componentes de feature e de layout | `libs/features/<feature>/src/lib/components/**`, `libs/layout/**` |
| Decisões de UX já tomadas | `docs/releases/<release>/ux/` (`design-decisions.md`, `screen-map.md`) e os `notes*.md` dos imports anteriores |
| Rules de front-end | `036`, `042`, `070`/`080`/`090`, despachadas pela `005` — abra as da área |

---

## 3. Escolher as peças — reaproveitar antes de inventar

Abra a tela atual que a WI altera (ou a mais parecida, se for nova) e liste o que ela já usa.

Para cada elemento do pedido, nesta ordem:

1. **`broker-*` ou componente da feature que serve como está** → usa.
2. **Serve com uma variação que ele já suporta** (input, `density`, modificador) → usa, dizendo qual.
3. **Quase serve, mas exigiria mudar o componente** → pergunta ao dev (estender × criar), com recomendação e a lista das telas que consomem o componente.
4. **Nada serve** → componente novo **dentro da feature** (processo do `design-system-evolution.md`), montado só com tokens, e marcado como novo.

Nunca invente cor, fonte, espaçamento ou raio fora dos tokens. Valor que o tema não tem é pergunta ao dev, não hex solto.

---

## 4. Montar o import

Estrutura (igual à dos imports existentes):

```
platform/frontend/_imports/claude-design/wi-<id>-<slug>/<AAAA-MM-DD>/
  notes.md
  original/
    <Tela> - Decisão.html        ← solução final, com todos os estados
    <Tela> - Variantes.html      ← só se houve rodadas de alternativas
```

**Escrita em `platform/**` está travada** por `.claude/settings.json`. O dev libera a trava quando chama um agente que usa esta skill. Se o `Write` for negado, **pare e peça ao dev para liberar** — nunca contorne por shell (`CLAUDE.md` §2).

**O HTML da Decisão:**

- Carregue os tokens do tema Segurus: copie para um `<style>` as variáveis de `theming/` que a tela usa, com comentário apontando o arquivo de origem.
- Reproduza a **marcação e as classes reais** dos componentes reaproveitados, para ficar idêntico ao que o app renderiza.
- Marque cada bloco: `data-componente="<seletor broker-* ou caminho do componente>"`, `data-variacao="..."` quando houver, `data-novo="<nome proposto>"` quando novo. É o que o plano e a verificação visual (`/verify-visual`) leem.
- **Estados** alternáveis por abas no topo: padrão, vazio, carregando, erro, e os de validação se houver formulário. Estado que a WI não definiu é pergunta ao dev.
- Desktop e, quando a tela for responsiva, a largura estreita.
- Dados fictícios plausíveis, com o **vocabulário canônico** (`CLAUDE.md` §5). Nada de dado real.
- Botão "mostrar anotações" que destaca cada bloco com *reaproveitado: X* ou *novo: Y*.

**O `notes.md`**, no formato dos imports existentes:

```markdown
# WI <id> — <título curto>

Data: <AAAA-MM-DD>
Componente(s): `<caminho>` …

## Decisões
- **D1 — <elemento> → <opção escolhida>**
  - posição, tamanho em px, token de cor (com o valor), tipografia, gap;
  - estados (vazio, sem dado, erro) e copy exata;
  - acessibilidade (aria, foco, tooltip).
  Motivo: <uma linha>.

## Colisões aceitas
- <o que pode truncar/quebrar e foi aceito>

## Peças
| Elemento | Reaproveitado | Variação | Novo |

## Arquivos em original/
- `<Tela> - Decisão.html`: solução final, <N> estados.
```

Cada decisão com **valor verificável** (px, token, copy, ordem). É isso que o `/verify-visual` confere na tela implementada; decisão vaga não é verificável.

**Artefato Claude Design para revisão:** se a sessão oferecer o tipo **Design** no Artifact (app Claude), crie um a partir dele com o mesmo conteúdo e passe o link ao dev; havendo Design System publicado como artefato e marcado como padrão, use-o. Ajuste pedido no canvas volta para o HTML do import antes da aprovação. No CLI, siga só com o HTML (o dev abre no navegador).

---

## 5. Aprovação — trava o plano

Apresente ao dev, curto:

- o link do artefato (quando houver) e o caminho do HTML da Decisão;
- a tabela de peças;
- divergências entre o print anexado e o design system, e qual lado o mockup seguiu;
- o que foi decidido por ser fato do repo, e o que ainda é pergunta.

Perguntas pendentes seguem a régua dos 95%: **uma por vez, sempre com recomendação**. Itere até o dev aprovar.

**Sem aprovação, o `/plan-task` não grava o plano.** Mockup em rascunho não entra em commit.

---

## 6. Levar a decisão para a spec

A spec (`backlog/tasks/<id>-<slug>.md`) é a fonte; o import é insumo. Depois da aprovação:

- Se o repo tiver a skill `spec-frontend`, use-a para gravar a **§Especificação visual** a partir do import (foi o caminho da 3224).
- Senão, escreva você a §Especificação visual na spec: valores, estados e copy de cada `D<n>`, e a linha "Origem: `_imports/claude-design/wi-<id>-<slug>/<data>/` — valem o `notes.md` e o arquivo Decisão".

**O import precisa estar no Git.** Spec que cita pasta de mockup fora do versionamento já bloqueou merge (3224, commit `a6effda0`).

---

## 7. Devolver ao chamador

Ao `/plan-task` (ou ao dev, quando avulsa):

- caminho do import e do HTML da Decisão — vira o `visual_reference:` do plano;
- componentes reaproveitados (com caminho), variações e componentes novos;
- decisões fechadas com o dev, uma linha cada — viram "Decisões (não reabrir)" no plano.

Avulsa, não commite sozinha: pergunte se vai para a branch da WI (`feature/wi-<id>-<slug>`). Dentro do `/plan-task`, o commit é o dele (§6 de lá).
