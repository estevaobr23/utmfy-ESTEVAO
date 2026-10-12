# TRACKING

## 1. Parâmetros de URL da Meta

Cole no nível do **anúncio**, campo **Parâmetros de URL** (tela *Configuração de UTMs* gera e valida):

```
utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}
```

| Parâmetro | Valor | Uso |
| - | - | - |
| utm_source | `FB` | plataforma (fixo) |
| utm_campaign | `{{campaign.name}}\|{{campaign.id}}` | campanha; o **ID** cruza com o gasto |
| utm_medium | `{{adset.name}}\|{{adset.id}}` | conjunto |
| utm_content | `{{ad.name}}\|{{ad.id}}` | anúncio — **chave principal** |
| utm_term | `{{placement}}` | posicionamento |

Macros oficiais: `{{campaign.id}} {{campaign.name}} {{adset.id}} {{adset.name}} {{ad.id}} {{ad.name}} {{placement}} {{site_source_name}}`.
Não coloque `fbclid` (a Meta adiciona). O parser também aceita só nome, só ID, `ID|NOME`, `Nome - 1234567890123` e
`utm_id` como ID de campanha.

## 2. Script do tracker

Em **todas** as páginas do funil (vendas, obrigado, upsell hospedado por você):

```html
<script src="https://SEU_APP/t.js" data-offer="<ID_DA_OFERTA>" async></script>
```

(Ofertas → Configurar → Passo 7 gera o snippet pronto.) O script (~4 KB, sem dependências, `async`):

- lê `utm_*`, `utm_id`, `sck`, `fbclid` da URL; guarda **first-touch** e **last-touch** (30 dias, localStorage + cookie `_utmfy_sid`);
- cria `_fbc` a partir do `fbclid` se o Pixel ainda não criou; lê `_fbp`;
- nos links para `pay.cakto.com.br` **acrescenta só o que falta** (nunca sobrescreve, nunca duplica) e adiciona
  `callback=<id da sessão>`; links criados depois são decorados no clique;
- envia um beacon mínimo para `/api/track` (sessão, UTMs, página sem query, host de referência, UA).

Opções: `data-checkout-domains="pay.cakto.com.br,checkout.meusite.com"`, `data-callback="false"`, `data-beacon="false"`.

**Pixel da Meta (o pixel da nossa plataforma):** `data-pixel="<ID_DO_PIXEL>"` carrega o pixel, dispara
`PageView` e `InitiateCheckout` (clique em link para o checkout ou com `data-checkout`). Use **só** em
páginas sem outro pixel da Meta; se a página já tem `fbq`, o `t.js` não mexe no pixel.
`node ~/.utmfy/utmfy.mjs snippet --oferta <slug>` gera a linha completa.
Botões por JS: `location.href = UtmfyTracker.decorate(url)`.

### Por que `callback`?

A Cakto grava `?callback=` no pedido e devolve no webhook (documentado em *Redirect pós-pagamento*; a doc diz que
o webhook continua trazendo o `callback` mesmo sem o recurso de redirect ativo — **confirme numa venda de teste**:
Pedidos → atribuição com `+tracker_session`, ou o campo `session_id` preenchido). Com isso, se as UTMs se perderem entre a página e o checkout,
a atribuição usa as UTMs da sessão do tracker (`attribution_method = ...+tracker_session`).

### O que a Cakto já faz

O checkout Cakto grava no pedido os `utm_*`/`sck` presentes na URL do checkout e captura `fbc`/`fbp` (Pixel dela).
Por isso o tracker **não** tenta enviar dados para a Cakto por outro meio: só garante que os parâmetros cheguem
na URL do checkout.

## 3. Motor de atribuição

Ordem: parâmetros do pedido (Cakto) → se vazios, sessão do tracker via `callback`.

| Status | Quando |
| - | - |
| `EXACT_ID` | `ad_id` encontrado no catálogo sincronizado (ou conjunto/campanha por ID, com razão `missing_ad_id`) |
| `UTM_PARSED` | IDs extraídos da UTM mas ainda não no catálogo (`ad_id_not_found` / `ad_not_synced`) — reatribuído após o próximo sync |
| `NAME_MATCH` | sem IDs; nome **exato e único** nas contas da oferta |
| `ORGANIC` | source orgânica (bio, whatsapp, email...) |
| `DIRECT` | sessão do tracker sem UTMs e sem referrer |
| `UNTRACKED` | nenhuma UTM (`no_utm`) ou perdida (`params_lost`) |
| `UNKNOWN` | macro não resolvida, nome ambíguo/inexistente, source desconhecida |

`ad_id` vence conflitos (issue `ID_CONFLICT`). Razões possíveis aparecem em **Não rastreadas**:
nenhuma UTM · campaign_id ausente · ad_id ausente · ad_id não encontrado · anúncio ainda não sincronizado ·
macro não resolvida · oferta não mapeada · source desconhecida · parâmetros perdidos · nome ambíguo.

## 4. Diagnóstico

*Diagnóstico de tracking*: cole a URL que chegou na página. Mostra UTMs, IDs, placement, fbclid, parâmetros
duplicados, encoding duplo (`%257C`), valores > 255 caracteres (limite da Cakto), macros literais
(“utm_campaign chegou como {{campaign.name}}”), a URL final do checkout e o que seria enviado — com OK / ATENÇÃO / ERRO.
Abaixo, as últimas sessões recebidas pelo tracker.
