---
name: mockup-task
description: Gera o mockup das mudanças visuais de um Work Item a partir da captura da tela real renderizada (Playwright), reaproveitando instâncias reais dos componentes broker-* e o tema Segurus, e entrega um único mockup como artefato do Claude (sem cópia no repo), travando até o dev aprovar. Chamada pelo /plan-task quando a WI mexe em tela; também roda avulsa com "/mockup-task" seguido do número da WI.
argument-hint: "nº do Work Item do Azure Boards (ex.: 2538)"
---

Transforma o pedido visual de uma WI em **mockup aprovado pelo dev**, montado com as peças que o app já tem. **Sai um único mockup: um artefato do Claude**, publicado direto da captura editada. Não existe segunda versão — nada vai para `platform/frontend/_imports/` nem para o Git.

Os arquivos de trabalho (capturas, fragmentos, comparações) ficam numa pasta local fora do versionamento, `tmp/mockup/wi-<id>-<slug>/<AAAA-MM-DD>/` — chamada de `<mockup>` daqui em diante. Ela é a fonte de onde o artefato é publicado e republicado; não é um segundo mockup. Antes de começar, confirme que está ignorada (`git check-ignore -q tmp/mockup/x`); se não estiver, pare e pergunte.

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

**Já existe mockup para esta WI?** Procure nesta ordem: o link do artefato na §Especificação visual da spec (`backlog/tasks/<id>-<slug>.md`), uma pasta `tmp/mockup/wi-<id>-*` local e, para WIs antigas, um import em `platform/frontend/_imports/claude-design/` (só leitura — histórico do formato antigo). Achou: leia o `notes.md` e os arquivos **Decisão** (os **Variantes** são histórico), confira se cobrem o pedido atual e só complemente o que faltar — republicando **o mesmo** artefato quando ele existir. Nunca grave em `_imports/`.

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
| Decisões de UX já tomadas | `docs/releases/<release>/ux/` (`design-decisions.md`, `screen-map.md`), a §Especificação visual das specs vizinhas e os `notes*.md` dos imports antigos |
| Rules de front-end | `036`, `042`, `070`/`080`/`090`, despachadas pela `005` — abra as da área |

---

## 3. Capturar a tela real — a base do mockup

**O mockup parte da tela renderizada, nunca do código-fonte.** Um `broker-*` só vira o que o dev vê depois que o Angular aplica o template, o SCSS encapsulado (`_ngcontent-…`), os internos do Material e o tema. Ler o `.html`/`.scss` do componente e redesenhar dá algo "no tema", mas não igual — foi a falha que motivou este passo.

**Subir o app:** mesmo procedimento do `/harness:verify-visual` §3 (reaproveitar o que estiver de pé; senão AppHost + `ng serve`, com log em arquivo, e registrar o que você subiu). Portas e comandos estão em `platform/frontend/README.md`.

**Capturar** com o script do plugin — ele salva DOM + todo o CSS aplicado + fontes/imagens num HTML que abre sozinho, igual ao app, e um PNG de referência da tela real:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/capturar-tela.mjs" capturar \
  --url <url da rota> --out "<mockup>/original" --nome "<Tela> - base" \
  --data-dir "${CLAUDE_PLUGIN_DATA}" --viewport 1440x900 \
  --sem-interativo [--esperar "<seletor que indica tela pronta>"] [--antes <passos.mjs>]
```

- **Login — resolva antes de capturar, nunca na tela de login.** Não navegue nem preencha a tela do Keycloak você mesmo; o script cuida disso:
  1. **Cheque a sessão salva:**
     `node "${CLAUDE_PLUGIN_ROOT}/scripts/capturar-tela.mjs" auth --url <url do app> --data-dir "${CLAUDE_PLUGIN_DATA}" --checar` → `"valida": true` (exit 0): vá direto para a captura.
  2. **Inválida (exit 2): logue com o usuário de dev do realm**, sem ver a senha — o script lê do JSON do realm e não a imprime:
     `node "${CLAUDE_PLUGIN_ROOT}/scripts/capturar-tela.mjs" auth --url <url do app> --data-dir "${CLAUDE_PLUGIN_DATA}" --realm-json <platform/backend/src/Apps/Insurtech.AppHost/keycloak/realms/<realm>.json> --usuario <username>`
     Escolha o realm e o usuário cujo perfil enxerga a tela (mesma regra do `/harness:verify-visual` §4). Se o dev já exportou `HARNESS_LOGIN_USER`/`HARNESS_LOGIN_PASSWORD`, basta `--url` e `--data-dir`.
  3. **Capture com `--sem-interativo`** (comando abaixo): se a sessão cair no meio, o script tenta o login automático de novo; se não der, falha com motivo em vez de travar esperando alguém.
  4. **Falhou** (senha recusada, usuário sem senha em texto no realm, Keycloak pediu troca de senha/OTP): pare e escale ao dev com a mensagem do script. Só sem `--sem-interativo` o script abre uma janela visível para o dev logar à mão (até 5 min) — **avise o dev antes**.
  - A sessão (cookies, `localStorage` e `sessionStorage`, onde fica o token OIDC) fica em `${CLAUDE_PLUGIN_DATA}/auth/`, fora do repo, e é renovada a cada captura. Nunca escreva a senha em arquivo, relatório, log ou prompt; nunca crie usuário.
- **`--antes`**: arquivo `export default async (page) => { … }` com os passos para chegar ao estado (abrir aba, aplicar filtro, abrir modal). Grave-o em `tmp/mockup/passos/`, fora de `<mockup>` (não é publicado).
- **Largura estreita**: se a tela é responsiva, capture de novo com `--viewport 390x844` e `--nome "<Tela> - base - estreita"`.
- **Doadores**: componente que a WI precisa e que existe em **outra** tela (ex.: um `broker-select` `compact`) → capture essa tela também (`--nome "doador - <componente>"`). É de lá que sai a marcação real.
- **Estados reais**: sempre que o app conseguir chegar ao estado (vazio por filtro sem resultado, modal de erro de validação), **capture-o** em vez de desenhá-lo.
- **Tela nova**: capture a tela mais parecida (mesmo shell, mesmo layout de página) como base.
- O script devolve `faltando` (recursos que não baixou) e o tamanho dos recursos. Recurso faltando → diga ao dev; não ignore.

**O app não sobe ou a tela não é alcançável?** Pare e escale ao dev. Só monte o mockup sem captura se o dev aceitar — e então marque no `notes.md` e no cabeçalho do HTML: **"sem captura — fidelidade ao app não garantida"**.

---

## 4. Escolher as peças e editar a captura

**Nunca abra uma captura com `Read`** — ela traz todo o CSS do app (centenas de KB), e o que você lê fica no contexto pelo resto da sessão. O hook do plugin bloqueia. Trabalhe só com o trecho que a WI muda:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/capturar-tela.mjs" pecas      --arquivo "<html>" --data-dir "${CLAUDE_PLUGIN_DATA}"                       # componentes da tela + um seletor de cada
node "${CLAUDE_PLUGIN_ROOT}/scripts/capturar-tela.mjs" extrair    --arquivo "<html>" --seletor "<css>" [--indice N] --data-dir "${CLAUDE_PLUGIN_DATA}"
node "${CLAUDE_PLUGIN_ROOT}/scripts/capturar-tela.mjs" substituir --arquivo "<html>" --seletor "<css>" --com <fragmento.html> [--modo trocar|antes|depois|dentro] --data-dir "${CLAUDE_PLUGIN_DATA}"
node "${CLAUDE_PLUGIN_ROOT}/scripts/capturar-tela.mjs" css-de     --arquivo "<doador.html>" --para "<html>" --data-dir "${CLAUDE_PLUGIN_DATA}"   # CSS de uma tela doadora
```

Fragmentos que você escreve vão para `tmp/mockup/fragmentos/`, fora de `<mockup>` (não são publicados).

Liste o que a tela capturada já usa (pelos seletores `broker-*` e componentes de feature no DOM). Para cada elemento do pedido, nesta ordem:

1. **`broker-*` ou componente da feature que serve como está** → `extrair` **uma instância real** (desta captura ou de um doador), com os atributos `_ngcontent-*`/`_nghost-*` intactos, troque só texto e estado no fragmento e aplique com `substituir`.
2. **Serve com uma variação que ele já suporta** (`density`, modificador) → só se houver instância real com essa variação capturada; senão capture uma tela que a tenha.
3. **Quase serve, mas exigiria mudar o componente** → pergunta ao dev (estender × criar), com recomendação e a lista das telas que consomem o componente.
4. **Nada serve** → componente novo **dentro da feature** (processo do `design-system-evolution.md`), montado só com as variáveis `--md-*` que já estão no `:root` da captura, e marcado como novo.

Nunca invente cor, fonte, espaçamento ou raio fora dos tokens. Valor que o tema não tem é pergunta ao dev, não hex solto.

**Editar:**

- Copie `"<Tela> - base.html"` para `"<Tela> - Decisão.html"` pelo shell (`cp`/`Copy-Item`) e **mexa só na região que a WI muda**, com `extrair` → editar o fragmento → `substituir`. O resto da página fica como capturado.
- Peça vinda de doador: `extrair` a instância no arquivo do doador e rode `css-de --arquivo <doador> --para <Decisão>` uma vez (regras duplicadas não fazem mal; regras faltando quebram o visual).
- Marque cada bloco com atributos, sem mudar layout: `data-componente="<seletor broker-* ou caminho>"`, `data-variacao="..."`, `data-novo="<nome proposto>"`. É o que o plano e o `/verify-visual` leem.
- Anotações: com `substituir --seletor "body > script:last-of-type" --modo antes`, acrescente um botão fixo "mostrar anotações" (`position: fixed`, escondido por padrão no layout) que contorna cada bloco com *reaproveitado: X* ou *novo: Y*. Nada além disso é injetado.
- **Estados**: um arquivo por estado — `"<Tela> - Decisão.html"` (padrão), `"<Tela> - Decisão - vazio.html"`, `"… - carregando.html"`, `"… - erro.html"`, e os de validação. Capturado de verdade quando possível (§3); editado a partir da Decisão quando não. Estado que a WI não definiu é pergunta ao dev.
- Dados: troque os dados reais do seed por fictícios plausíveis — região por região, com `extrair`/`substituir`, nunca lendo o arquivo inteiro — com o **vocabulário canônico** (`CLAUDE.md` §5). Nada de dado real de cliente no artefato: ele é uma página hospedada, a um compartilhamento de qualquer pessoa.
- Cabeçalho em comentário HTML: WI, data, status (`rascunho` / `aprovado em <data>`), URL e data da captura.

**Conferir a fidelidade antes de mostrar** — a parte que a WI não muda tem de ficar idêntica à tela real:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/capturar-tela.mjs" screenshot --arquivo "<mockup>/original/<Tela> - Decisão.html" --out tmp/mockup/conferencia/decisao.png --viewport 1440x900 --data-dir "${CLAUDE_PLUGIN_DATA}"
node "${CLAUDE_PLUGIN_ROOT}/scripts/capturar-tela.mjs" comparar --a "<mockup>/original/<Tela> - base.referencia.png" --b tmp/mockup/conferencia/decisao.png --ignorar "<x,y,w,h da região alterada>[;…]" --out tmp/mockup/conferencia/diff.png --data-dir "${CLAUDE_PLUGIN_DATA}"
```

`percentual` acima de **0,5%** fora da região ignorada = você alterou algo que a WI não pede (ou um recurso faltou). Abra o `diff.png`, corrija e confira de novo. Não apresente ao dev antes de passar.

**Olhe pouco e recortado.** Cada imagem lida com `Read` fica no contexto até o fim da sessão. O `percentual` é o critério; para ver a região que a WI mudou, gere um recorte (`screenshot … --recorte x,y,w,h`) em vez de abrir a tela inteira, e não releia a mesma imagem.

### Pasta do mockup (`<mockup>`) — é o que o artefato publica

```
tmp/mockup/wi-<id>-<slug>/<AAAA-MM-DD>/
  notes.md
  original/
    <Tela> - base.html                 ← captura da tela atual, intocada
    <Tela> - base.referencia.png       ← print da tela real
    <Tela> - Decisão.html              ← solução final, estado padrão
    <Tela> - Decisão - <estado>.html   ← um por estado
    doador - <componente>.html         ← só se usou doador
    assets/                            ← fontes e imagens que a captura baixou
```

**Nada desta skill grava em `platform/**`** — nem `Write`/`Edit`, nem shell, nem o `--out` do script. O mockup vive em `<mockup>` e no artefato; por isso a trava de `platform/**` não entra no fluxo do mockup.

**O `notes.md`**, no formato dos imports antigos (publicado junto no artefato):

```markdown
# WI <id> — <título curto>

Data: <AAAA-MM-DD>
Componente(s): `<caminho>` …
Captura: <url> em <data>, <viewport> (base intocada em `original/<Tela> - base.html`)

## Decisões
- **D1 — <elemento> → <opção escolhida>**
  - posição, tamanho em px, token de cor (com o valor), tipografia, gap;
  - estados (vazio, sem dado, erro) e copy exata;
  - acessibilidade (aria, foco, tooltip).
  Motivo: <uma linha>.

## Colisões aceitas
- <o que pode truncar/quebrar e foi aceito>

## Peças
| Elemento | Reaproveitado (instância de onde veio) | Variação | Novo |

## Arquivos em original/
- `<Tela> - Decisão.html`: solução final; estados em `<Tela> - Decisão - <estado>.html`.
- Fidelidade fora da região alterada: <percentual do comparar>.
```

Cada decisão com **valor verificável** (px, token, copy, ordem). É isso que o `/verify-visual` confere na tela implementada; decisão vaga não é verificável.

### Publicar para revisão

O artefato **é** o mockup. Publique-o com a ferramenta `Artifact`, direto de `<mockup>`:

- **Página:** `file_path` = `<mockup>/original/<Tela> - Decisão.html`; título `WI <id> — <Tela> (mockup)`.
- **`files`** (caminhos publicados relativos à página, ou seja, à pasta `original/`): os outros estados (`<Tela> - Decisão - <estado>.html`), `assets/…`, `<Tela> - base.referencia.png` e `notes.md` (origem: `<mockup>/notes.md`). Assim o artefato carrega tudo o que a verificação visual precisa, mesmo noutra máquina.
- **Não redesenhe nada:** o artefato é a captura editada — sem trocar fonte, cor, espaçamento, sem tema escuro, sem tokens de tema do artefato, sem "melhorar". A fidelidade ao app vence qualquer convenção de página de artefato; se a ferramenta exigir, acrescente só um `<title>`.
- **Grave a URL** devolvida em `<mockup>/artefato.txt` e no cabeçalho do `notes.md`.
- **Ajuste pedido pelo dev:** edite os arquivos em `<mockup>` e republique **o mesmo** artefato (passando a URL) — nunca um artefato novo, nunca uma segunda versão em outro lugar.
- **Sem a ferramenta `Artifact`** na sessão (ex.: Claude Code CLI sem a conta do app): não invente outro formato. Diga ao dev que o mockup é publicado como artefato e precisa de uma sessão com essa ferramenta (app Claude ou desktop), e pergunte: **Revisar o arquivo local e publicar depois** (o `visual_reference` fica vazio até a publicação; o caminho local vai em `visual_local`) · **Parar**.

---

## 5. Aprovação — trava o plano

Apresente ao dev, curto:

- o link do artefato — é ele que o dev revisa (os estados estão dentro dele);
- o percentual de fidelidade do `comparar` fora da região alterada;
- a tabela de peças;
- divergências entre o print anexado e o design system, e qual lado o mockup seguiu;
- o que foi decidido por ser fato do repo, e o que ainda é pergunta.

Perguntas pendentes seguem a régua dos 95%: **uma por vez, sempre com recomendação**. Itere até o dev aprovar. Dentro do `plan-task-agent`, quem roda esta skill é o `harness:mockup-agent`: ele não apresenta nada nem pergunta — grava o material e as pendências em `tmp/pipeline/wi-<id>/mockup.md`, e a aprovação é o portão 3.1 do `plan-task-agent`.

**Sem aprovação, o `/plan-task` não grava o plano.** Mockup em rascunho não entra em commit.

---

## 6. Levar a decisão para a spec

A spec (`backlog/tasks/<id>-<slug>.md`) é a fonte; o artefato é insumo. Depois da aprovação:

- Se o repo tiver a skill `spec-frontend`, use-a para gravar a **§Especificação visual** a partir do `notes.md` e dos arquivos Decisão (foi o caminho da 3224).
- Senão, escreva você a §Especificação visual na spec: valores, estados e copy de cada `D<n>`, e a linha "Origem: mockup aprovado em <data> — <URL do artefato>".

**A spec carrega todos os valores verificáveis.** O artefato não fica no Git, então nada que o plano ou a verificação visual precisem cobrar pode existir só nele: cada `D<n>` vai para a spec com px, token, copy e estados. Spec que dependia de mockup fora do versionamento já bloqueou merge (3224, commit `a6effda0`) — com o valor escrito na spec, o link é só referência visual.

---

## 7. Devolver ao chamador

Ao `/plan-task` (ou ao dev, quando avulsa; dentro do `plan-task-agent`, pelo `mockup.md` do `mockup-agent`):

- a URL do artefato — vira o `visual_reference:` do plano — e o caminho local do HTML da Decisão em `<mockup>` — vira o `visual_local:`;
- componentes reaproveitados (com caminho), variações e componentes novos;
- decisões fechadas com o dev, uma linha cada — viram "Decisões (não reabrir)" no plano.

O mockup não tem commit. A spec alterada no §6 tem: dentro do `/plan-task`, ela entra no commit de insumos (§6 de lá), mesmo quando o arquivo já existia; avulsa, não commite sozinha — pergunte se vai para a branch da WI (`feature/wi-<id>-<slug>`).

**Servidores** que você subiu para capturar: dentro do `plan-task-agent`, registre-os em `tmp/pipeline/wi-<id>/servidores-preparo.md` (ele derruba no fim do preparo); avulsa, derrube-os ao terminar.
