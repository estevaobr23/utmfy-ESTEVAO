# UTMFY — guia para qualquer chat (onde está, como usar, como configurar uma oferta)

Este é o mapa único da ferramenta de rastreio. Vale para chats de **Cakto, área de membros,
páginas de venda, criativos e tráfego**. Se algo aqui divergir da realidade, corrija este arquivo
no mesmo commit da mudança.

## 1. O que é

O UTMFY mostra, por **oferta**: faturamento, gasto da Meta, lucro, ROAS, CPA, funil
(cliques → visitas → ICs → vendas) e **qual campanha/conjunto/anúncio gerou cada venda**.
Receita vem da Cakto (webhook); gasto, cliques e eventos do pixel vêm da Meta; a atribuição liga
os dois pelas UTMs que o anúncio coloca no link.

## 2. Onde cada peça está

| Peça | Onde |
|---|---|
| Código (este computador) | `C:\Users\Usuário\Desktop\PROJETOS\utmfy` |
| GitHub | `https://github.com/estevaobr23/utmfy-ESTEVAO` (branch `main`; push = deploy automático) |
| Produção | `https://utmfy-tracker.vercel.app` (Vercel, projeto `utmfy-tracker`, funções em `gru1`) |
| Banco | Supabase ref `kjstjqxebejeihlzaiky` (sa-east-1), **schema `utmfy`**. O projeto é compartilhado com outro app: **só mexa no schema `utmfy`** |
| Workspace | slug `principal` |
| Webhook da Cakto | `https://utmfy-tracker.vercel.app/api/webhooks/cakto?o=<token-da-oferta>` |
| Script da página | `https://utmfy-tracker.vercel.app/t.js` |
| Helper de linha de comando | `node ~/.utmfy/utmfy.mjs ajuda` (fonte: `scripts/utmfy-cli.mjs`) |
| Skill | `utmfy-tracker` |

Credenciais: banco em `<repo>/.env.local`, Cakto em `~/.cakto/credentials.env`. Nunca copie chave
para código, commit ou mensagem.

## 2.1 Regra de operação — pixel e webhook SÓ por prompt (vale desde 13/10/2026)

**Ninguém cria pixel nem webhook à mão** (Gerenciador de Eventos da Meta, painel da Cakto,
formulários). O usuário pede em linguagem natural — *"monta a oferta X com o produto Y"*, *"cria o
pixel da oferta Z"*, *"cria o webhook de rastreio da oferta W"* — e **o chat executa** com os helpers
abaixo. As telas do painel (Pixels, Webhooks Cakto) servem para **olhar e diagnosticar**.

**Comando-mestre** (uma oferta nova, do zero, em um passo):

```bash
U="node ~/.utmfy/utmfy.mjs"
$U oferta-nova --nome "Nome da oferta" --produto <ID_PRODUTO_CAKTO>            # simulação: pré-checagem + plano
$U oferta-nova --nome "Nome da oferta" --produto <ID_PRODUTO_CAKTO> --confirmar # executa
```

O que ele faz, nesta ordem (para no primeiro erro; nada é apagado):

| # | Passo | Onde grava |
|---|---|---|
| 0 | Pré-checagem (só leitura): slug livre, produto existe na Cakto e **não pertence a outra oferta**, pixel não duplicado na Meta | — |
| 1 | Cria a **oferta** (gera o token da URL) | UTMFY |
| 2 | Cria o **webhook de rastreio** `?o=<token>` com **só** os produtos dela e os 7 eventos; relê e confere | Cakto (produção) |
| 3 | **Cria o pixel na Meta** (ou reaproveita com `--reusar <id>`), compartilha com as outras contas de anúncio, cadastra no UTMFY e **liga à oferta** | Meta (produção) + UTMFY |
| 4 | Imprime o **`<script t.js data-offer data-pixel>`** da página | — |
| 5 | Roda o **`verificar`** (checklist ✓/✗) | — |

Opções: `--conta act_N` (padrão **CONTA 1 ADS EUA** `act_2094401681297034`), `--reusar <pixelId>`
(aproveita pixel que já existe na Meta — **obrigatório** se o nome já existe, nunca duplique),
`--pixelnome "X"`, `--slug x`. Cada passo também roda sozinho para retomar de onde parou:
`oferta-criar`, `webhook-criar`, `pixel-criar --oferta <slug>`, `snippet`, `verificar`.

**Como o chat deve agir quando o usuário pedir oferta/pixel/webhook:**

1. Reúna o mínimo: nome da oferta e o **produto da Cakto** (se o usuário só disser o nome, procure o
   ID com o helper da Cakto — `GET products/`). Conta de anúncio e pixel novo/reaproveitado têm padrão.
2. Rode **sem `--confirmar`** e **mostre a pré-checagem e o plano**. A Cakto e a Meta são **produção,
   sem sandbox**: só rode com `--confirmar` depois do ok do usuário.
3. Rode com `--confirmar`, depois `verificar`, e **relate o resultado como ele é** (✓ e ✗). Não diga
   "tudo certo" com ✗ pendente.
4. Entregue ao usuário: o script da página e os parâmetros de URL dos anúncios (seções 6 e 7).
5. Lembre o que a automação **não** faz (abaixo).

**O que a automação NÃO faz (avise sempre):**

- Produto nos webhooks de **acesso** (área de membros) e de **recuperação** — skill `criar-produto-cakto`
  / `area-de-membros`. O de recuperação (id 71145) substitui a lista: mande a união.
- Colocar o `<script>` na página e subir os anúncios com os parâmetros de URL.
- **Token da API de Conversões (CAPI) do pixel**: ainda é manual. O envio server-side está desligado
  (`CAPI_ENABLED=false`), então isso não bloqueia o rastreio pelo navegador.
- A **1ª venda real**: é a prova final do webhook.

**Regras que não mudam:** nunca imprima token; nunca apague webhook de outro papel sem ordem do
usuário; **antes de criar pixel, o helper já confere a Meta** (não crie à mão por fora dele); um pixel
**nunca** serve a duas ofertas.

**Estado da validação (atualize aqui quando mudar):**

| Peça | Estado |
|---|---|
| `webhook-criar`, `pixel-add`, `pixel-vincular`, `snippet`, `verificar` | em uso e validados |
| `pixel-criar` / `oferta-nova`: pré-checagem e simulação | validados (13/10/2026, só leitura) |
| `pixel-criar`: **criação real** do pixel na Meta (`POST act_N/adspixels`) | **ainda não executada em produção**; na 1ª vez, rode, confira o pixel na Meta e atualize esta linha |
| Compartilhar pixel novo com as outras 2 contas (`shared_accounts`) | melhor esforço: se a Meta recusar, o helper avisa e o compartilhamento é manual |
| Token CAPI automático (atribuir o usuário `gerenciador-api` ao pixel) | **não implementado**; a Meta só gera o token por Gerenciador de Eventos ou Business Extension |

## 3. Modelo mental (3 regras que nunca mudam)

1. **1 oferta = 1 produto Cakto.** A escada (VIP / básico / downsell) são *ofertas da Cakto* do
   mesmo produto; no UTMFY é **uma** oferta. O mesmo produto em duas ofertas do UTMFY não separa
   as vendas.
2. **1 oferta = 1 pixel exclusivo.** É assim que o gasto vai para a oferta certa, sozinho: conjunto
   de anúncios que otimiza para o pixel da oferta pertence a ela, inclusive campanhas novas. Pixel
   repetido entre ofertas é recusado.
3. **1 oferta = 1 webhook de rastreio na Cakto**, com a URL `?o=<token>` e **só** os produtos dela.
   A URL antiga `?ws=principal` é legado (não use).

## 4. Os três webhooks da Cakto (papéis diferentes, todos obrigatórios)

| Papel | Para quê | Destino | Produtos | Quantos |
|---|---|---|---|---|
| **Acesso** | libera o produto na área de membros | Edge Function do projeto da área | os da área | 1 por área |
| **Recuperação WhatsApp** (id 71145) | recupera pix/carrinho | `cakto-recovery` | **todos** os ativos (o PUT substitui a lista: mande a união) | 1 global |
| **Rastreio UTMFY** | vendas, reembolsos e funil no painel | `utmfy-tracker.vercel.app/api/webhooks/cakto?o=<token>` | só os da oferta | 1 por oferta |

🚨 **Produto fora da lista de um webhook vende e nunca dispara evento** (já custou R$ 1.431 em
acessos não entregues). Produto novo = entrar nos três **no mesmo passo da criação**. Nunca apague
webhook de outro papel sem ordem do usuário.

Eventos do rastreio: `pix_gerado`, `boleto_gerado`, `purchase_approved`, `purchase_refused`,
`refund`, `chargeback`, `refund_requested`.

## 5. Oferta nova — passo a passo (padrão)

O caminho normal é o **`oferta-nova`** da seção 2.1 (faz os passos 1 a 3 abaixo de uma vez). Os
comandos separados existem para retomar um passo que falhou ou para casos pontuais.

```bash
U="node ~/.utmfy/utmfy.mjs"
$U ofertas                                                     # o que já existe
# 1) produto na Cakto (skill criar-produto-cakto) → anote o ID do produto
$U oferta-criar --nome "Nome da oferta" --confirmar            # cria a oferta e gera o token
$U webhook-criar --oferta <slug> --produto <ID_PRODUTO> --confirmar   # Cakto (PRODUÇÃO): cria, relê e confere
$U pixel-criar --oferta <slug> --confirmar                     # cria (ou --reusar <id>) o pixel NA META, cadastra e liga
# (pixel-add + pixel-vincular continuam valendo para ligar um pixel que já existe e já tem ID)
$U snippet --oferta <slug>                                     # script da página + parâmetros dos anúncios
# 2) colocar o <script t.js> no <head> de TODAS as páginas do funil (skills de página de vendas)
# 3) anúncios: colar os parâmetros de URL no nível do anúncio
$U verificar --oferta <slug>                                   # checklist ✓/✗ — precisa fechar sem ✗
```

Depois de vincular o pixel, clique **Atualizar** no painel: as campanhas que usam o pixel entram
sozinhas. A **primeira venda real** é a prova final do webhook (assinatura própria da Cakto): confira
com `verificar` e o painel.

`$U simular --confirmar` roda uma venda de teste ponta a ponta (cria oferta `SIMULAÇÃO – APAGAR`,
envia webhooks assinados, confere pedido, atribuição e relatório, **apaga tudo**). Use depois de
mudar o motor, não a cada oferta.

Comandos que gravam só valem com `--confirmar`; sem a flag é simulação. A Cakto é conta de
**produção, sem sandbox**: mostre o que vai fazer antes de confirmar.

## 6. Parâmetros de URL dos anúncios (Meta, nível do anúncio)

```
utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}
```

O **ID** depois do `|` é o que liga a venda ao anúncio. Sem UTM, a venda vira "não rastreada".
Detalhes e diagnóstico em `TRACKING.md`.

## 7. Como a página de venda se liga

- **O pixel é o da nossa plataforma** (a UTMify não é mais usada). Uma linha no `<head>` de cada
  página do funil — o helper gera pronta, com os dois IDs (`snippet --oferta <slug>`):

  ```html
  <script src="https://utmfy-tracker.vercel.app/t.js" data-offer="<ID_DA_OFERTA>" data-pixel="<ID_DO_PIXEL_META>" async></script>
  ```
- O que o `t.js` faz: (1) `data-pixel` → carrega o pixel da Meta, dispara `PageView` e
  `InitiateCheckout` no clique do checkout (link para `pay.cakto.com.br` ou com `data-checkout`);
  é daí que vêm "Vis. página" e "ICs" do funil; (2) guarda sessão e first/last touch, repassa as UTMs
  e põe `callback` nos links do checkout (acrescenta só o que falta; nunca sobrescreve).
- **Não instale outro código do pixel da Meta nem o da UTMify** na página: dobra os eventos. Se a
  página já tiver `fbq` próprio (ex.: SaaS com Meta Pixel no layout), use o `t.js` **sem**
  `data-pixel` — ele não mexe em pixel alheio.
- Cada página/domínio do funil leva o mesmo `data-offer`/`data-pixel` da oferta. Convive com o
  repasse manual de UTM das skills de página.

## 8. Painel — o que cada número usa

| Número | Fonte |
|---|---|
| Faturamento / reembolso / taxas / vendas | Cakto (webhook; "Atualizar" também reconcilia os últimos 3 dias) |
| Gasto, cliques no link, impressões | Meta Insights (convertido para R$ pela PTAX do dia) |
| Vis. página, ICs, CPV, CPI | eventos do pixel na Meta (`landing_page_view`, `initiate_checkout`); sem dado → N/D |
| Orçamento / bid cap | Meta, exibidos em R$ (lápis edita o orçamento diário na Meta) |
| Atribuição | UTM do pedido → `EXACT_ID` / `UTM_PARSED` / `UNTRACKED`… |

## 9. Limites e cuidados conhecidos

- **Meta em nível "development"**: cota pequena. O "Atualizar" roda em segundo plano, não repete
  chamadas à toa e, se a Meta limitar, mantém os últimos dados e avisa. Não clique em série.
- **Aba aberta durante deploy** dá "This page couldn't load": recarregue (Ctrl+F5).
- **Migrations no banco de produção** exigem aprovação explícita do usuário.
- Pedidos com `source = test` não entram em nenhuma métrica.
- O cron diário (09:00 UTC) reconcilia Meta e Cakto; o tempo real vem do webhook.

## 10. Quando precisar mexer no código da ferramenta

1. Leia `AGENTS.md`: o Next.js é uma versão nova (guia em `node_modules/next/dist/docs/`).
2. `npm run typecheck && npm run lint && npm test` antes de commitar.
3. Commit + push em `main` → Vercel faz o deploy. Confirme que ficou **Ready**.
4. Mudou o motor de vendas/atribuição? Rode `node ~/.utmfy/utmfy.mjs simular --confirmar`.
5. Atualize este guia e o `README.md` se a mudança altera o passo a passo.

## 11. Diagnóstico rápido

| Sintoma | Causa mais provável | Ação |
|---|---|---|
| Painel mostra R$ 0,00 de venda | webhook da oferta não existe / produto fora da lista | `verificar --oferta <slug>` |
| Venda "não rastreada" | anúncio sem parâmetros de UTM, ou link do checkout sem repasse | conferir UTM no pedido da Cakto; `t.js` na página |
| Gasto de outra oferta aparece | pixel compartilhado entre ofertas | um pixel por oferta (`ofertas` mostra) |
| Gastos "—" / "Qualidade de dados pendente" | sincronização da Meta com erro | Atualizar; ver `/meta` e logs |
| Vis. página / IC em N/D | pixel da Meta ausente na página ou período sem sync | pixel na página; Atualizar |
| Cliente pagou e não recebeu acesso | produto fora do webhook de **acesso** | skill `area-de-membros` (auditoria) |
