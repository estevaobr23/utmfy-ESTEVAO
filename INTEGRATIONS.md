# INTEGRAÇÕES

Documentação consultada em 2026-09-30: docs.cakto.com.br (via Cakto MCP) e developers.facebook.com.

## Cakto

### Webhook — `POST /api/webhooks/cakto?ws=<slug>`

1. Corpo lido **cru** (`request.text()`), limite 1 MB.
2. Assinatura: `X-Cakto-Signature: v1=<hex>` = HMAC-SHA256(secret, `"{X-Cakto-Timestamp}." + corpo cru`),
   comparação em tempo constante; aceita vários `CAKTO_WEBHOOK_SECRETS` (um por webhook) e header com várias versões.
3. Anti-replay: timestamp fora de ±5 min → 401. Sem headers, aceita o campo `secret` do corpo só com
   `CAKTO_ALLOW_BODY_SECRET=true` (a doc ainda aceita; recomenda o header).
4. Idempotência: `dedupe_key = sha256(corpo)` com `unique` → retentativas da Cakto viram `duplicate` (200).
5. `data` objeto (V1) **ou array** (V2: principal + bump + upsell na mesma entrega); `checkout_abandonment` é ignorado.
6. Cada pedido → `normalizeCaktoOrder` (dinheiro em number *e* string, `parent_order` "" → null, oferta pelo
   `offer.id` ou pelo link do checkout) → `ingestOrder` (mapeia oferta, máquina de estados, atribuição, fila CAPI).
7. Só banco, sem chamada externa — resposta rápida (limite da Cakto: 8 s). Payload guardado sem `secret` e com
   PII reduzida (e-mail/telefone só em hash; documento, endereço, QR Pix removidos).

Eventos tratados: `purchase_approved`, `pix_gerado`, `boleto_gerado`, `picpay_gerado`, `openfinance_nubank_gerado`,
`purchase_refused`, `refund`, `refund_requested`, `chargeback`, `subscription_renewed`, `subscription_renewal_refused`
(status do `data` tem prioridade; o nome do evento é fallback). Outros eventos com forma de pedido também passam.

### API — `src/lib/services/cakto-client.ts`

- OAuth2 `POST /public_api/token/` (form-urlencoded, `client_id`/`client_secret`); token (~10 h) reutilizado até
  60 s antes de expirar; nunca um token por chamada (limite: 20/min por IP).
- `GET /public_api/orders/?updatedAt__gte=...&updatedAt__lte=...&page=&limit=100` percorrendo `next`.
- 429 → respeita `Retry-After`; 5xx/rede → backoff exponencial (4 tentativas); 401 → renova token uma vez.
- **SINCRONIZAR CAKTO** (Integração Cakto) e cron `cakto-reconcile` (3 dias): pedidos ausentes, status divergentes,
  reembolsos e chargebacks não processados são corrigidos pela mesma máquina de estados e registrados em
  `reconciliation_changes` + `integration_logs` (`RECONCILIATION_FIXED`).
- Escopos necessários da chave: `read`, `orders`, `products`, `offers`.

## Meta Ads (READ-ONLY)

`src/lib/services/meta-client.ts` só expõe **GET** e a criação/leitura de relatório assíncrono de insights
(`POST /act_x/insights`, que não altera nada). Não existe código para editar campanhas, orçamentos, status ou criativos.

- Versão: `META_GRAPH_VERSION` (padrão **v26.0**, a mais recente em 2026-09-30; v24 é a mais antiga suportada).
- Token: `META_ACCESS_TOKEN` (System User com `ads_read`) ou OAuth (`/api/meta/oauth/start`, escopo `ads_read`,
  token longo guardado no **Vault**). `appsecret_proof` enviado quando `META_APP_SECRET` existe.
- Descoberta: `GET /me/adaccounts` → você marca quais contas **monitorar** e associa às ofertas.
- Catálogo: `GET /act_x/ads?fields=id,name,effective_status,adset{id,name},campaign{id,name}`.
- Insights: `level=ad`, `time_increment=1`, campos `impressions, reach, clicks, inline_link_clicks, outbound_clicks,
  spend, actions, action_values, account_currency...`; períodos > 7 dias usam **relatório assíncrono**
  (`report_run_id` → polling de `async_status`), em blocos de 31 dias. Upsert por `(conta, anúncio, dia)`.
- Estratégia: hoje + ontem + retroativo de `META_LOOKBACK_DAYS` (padrão 3) a cada execução — métricas revisadas
  pela Meta são corrigidas.
- Erros: 190 → `token_expired` (conexão marcada, sync interrompido); 10/200-299 → `no_permission` (por conta);
  4/17/32/613/80000-80014 → rate limit com backoff; logs `META_SYNC_FAILED {account_id, reason}`.
- Após cada sync, pedidos `ad_not_synced`/`ad_id_not_found` são reatribuídos.

## Conversions API (preparada, desligada)

- Ao virar `paid`, cada pixel ativo da oferta ganha um `conversion_dispatches` (`Purchase`,
  `event_id = cakto:{order_id}:Purchase`). Unique por (pedido, pixel, evento) → nunca duplica.
- `CAPI_ENABLED=true` + pixel com *server-side ON* + token (Vault ou `META_CAPI_TOKEN`) → `processDispatches` envia
  `POST /{pixel_id}/events`. Falha num pixel não reenvia os outros; **Reprocessar** reenfileira só aquele.
- Evento: `event_time` (≤ 7 dias), `action_source=website`, `event_source_url` + `client_user_agent` (da sessão do
  tracker — exigidos pela Meta para website), `em`/`ph` SHA-256 normalizados, `fbc`, `fbp`, `value`, `currency`.
  Sem user agent → `failed: missing_client_user_agent` (visível em Eventos).
