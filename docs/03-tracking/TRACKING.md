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

Opções: `data-checkout-domains="pay.cakto.com.br,checkout.meusite.com"`, `data-callback="false"`, `data-beacon="false"`, `data-ipv6="false"` (não descobrir o IPv6 do visitante; ver seção 5.1).

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

## 5. Qualidade dos eventos na Meta (EMQ, IPv6, deduplicação) — 01/11/2026

Respostas às recomendações do Gerenciador de Eventos, vistas no pixel da oferta em espanhol (lavadoras, `120-fallas-de-lavadoras`, pixel `868055749387060`). Vale para todas as ofertas.

> **HIPÓTESE ≠ VALIDADO.** O IPv6 foi corrigido e testado em código; o efeito na Meta (recado sumir, nota subir) **ainda não foi medido** — conferir em 3 a 5 dias (a Meta recalcula com o volume recente).

### 5.1 "Atualize os eventos de InitiateCheckout para IPv6" — CORRIGIDO (commit `b77b956`)
- **Causa:** o host do tracker (`utmfy-tracker.vercel.app`) não tem registro AAAA, então o beacon chega sempre por IPv4. A CAPI mandava IPv4 e o pixel do navegador mandava IPv6.
- **Correção:** o `t.js` descobre o IPv6 do visitante (quando existe) chamando `https://api6.ipify.org` (serviço só-IPv6; sem IPv6 a chamada falha em silêncio), guarda em `sessionStorage` (`_utmfy_ip6`) e manda `ip6` no beacon. No servidor, `preferIpv6` (`src/lib/services/tracking.ts`) usa esse IPv6 no lugar do IPv4, **só** se for IPv6 público (descarta loopback, link-local, ULA, multicast e IPv4 mapeado). O IP fica guardado na sessão, então o **Purchase** também sai com IPv6.
- **Opt-out:** `data-ipv6="false"` no `<script>`. Quem não tem IPv6 continua com o IPv4.
- **Privacidade:** o navegador do visitante faz uma requisição a um terceiro (`api6.ipify.org`) para descobrir o próprio IPv6.

### 5.2 "Envie E-mail / Telefone no InitiateCheckout" — NÃO DÁ (e está certo assim)
O InitiateCheckout dispara no clique do botão da página de vendas, **antes** de a pessoa digitar qualquer dado; o formulário está no checkout da plataforma (Hotmart/Cakto). Não há e-mail nem telefone nesse momento. O Purchase já leva ambos (hash SHA-256). Na Meta: clicar em **Pular**.

### 5.3 "Envie Estado, País, Cidade, Sobrenome, Nome, Gênero, Nascimento, CEP" no Purchase (nota 9.2/10)
Purchase da oferta em espanhol: **9.2/10**; a Meta estima ganho de "até 6%". Estado real:
- **Já enviamos:** e-mail, telefone, nome, sobrenome, IP, `fbc`, `fbp`, `external_id`, e cidade/estado/país **da geolocalização do IP do clique** (não do endereço do comprador).
- **Gênero e nascimento:** impossível — a Hotmart/Cakto não mandam esses campos no webhook.
- **CEP, cidade, estado reais:** só se o webhook trouxer `buyer.address` preenchido (produto digital costuma trazer só o país). **Não confirmado.**
- **Sonda (commit `9dfee8f`):** `redactHotmartPayload` agora guarda em `webhook_events.payload.data.buyer` os **nomes** (sem valores) dos campos preenchidos: `fields_present` e `address_fields_present`. Depois da próxima venda aprovada da Hotmart, ler esses campos. Se vier cidade/estado/CEP: enviar `ct/st/zp` reais e o país do comprador no Purchase (exige migration em produção para guardar os hashes no pedido — só com aprovação do usuário).
- **Decisão (usuário, 01/11/2026):** "está perfeito assim" — não fazer nada além da sonda por ora.

### 5.4 PageView: "Corrija problemas com a chave de desduplicação" (cobertura 46,5%)
- **Leitura:** 647 PageViews do navegador × 814 do servidor, ambos com `event_id`, mas só 46,5% casam (`external_id` casa 0,27%, `fbp` 0%).
- **A UTMFY não envia PageView pelo servidor** (só Purchase e InitiateCheckout) — então os 814 vêm de **outro remetente**, com `event_id`/`external_id` próprios. O pixel da Hotmart está vazio por regra, e a API de estatísticas da Meta devolveu vazio, então **a origem ainda não foi identificada**.
- **Como descobrir:** Gerenciador de Eventos → pixel → PageView → aba **Origem do evento**.
- **Não mexer por ora:** os anúncios otimizam para Purchase (sem duplicidade). O efeito é só na contagem de visualizações de página e em públicos baseados nela. Se a origem for outro remetente, a correção é desligar o PageView de servidor lá — **não** adicionar um terceiro envio pela UTMFY.

### 5.5 Regras para quem for mexer nisso
- Um remetente só por evento; não teste enviando evento falso ao pixel de produção.
- `t.js` é público e roda nas páginas de anúncio: toda mudança nele precisa de teste (`tests/tracker.test.ts`) e deve falhar em silêncio.
