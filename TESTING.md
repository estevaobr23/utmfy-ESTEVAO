# TESTES

```bash
npm test                       # tudo (integração é pulada se o Supabase local não estiver no ar)
npx vitest run tests/db.test.ts
node scripts/e2e-smoke.mjs     # com o app rodando em :3200 (npm run build && npm start)
```

| Arquivo | Cobre |
| - | - |
| `tests/utm.test.ts` | parser: NOME\|ID, ID\|NOME, só ID, só nome, `\|` no nome, sufixo, %7C, `+`, encoding duplo, macros `{{}}`/`{}`/%7B%7B, vazio |
| `tests/attribution.test.ts` | EXACT_ID, conflito de IDs, ad não sincronizado, só adset, sem UTM, macro, NAME_MATCH exato/único, ambíguo, sem fuzzy, orgânico, oferta não mapeada, fallback para a sessão do tracker, DIRECT |
| `tests/cakto.test.ts` | assinatura válida/inválida, corpo adulterado, replay (timestamp), múltiplos secrets, body secret; `data` objeto/array (bump/upsell), abandono, approved, Pix, refund, refund_requested, chargeback, formato da API, dinheiro misto, redação de PII |
| `tests/metrics.test.ts` | ROAS, CPA, líquido, lucro, Pix, CTR/CPC; árvore (Campanha A ROAS 2,13 / B 0,70); não rastreadas fora da árvore |
| `tests/tracker.test.ts` | executa o `public/t.js` real: decoração, não sobrescrever/duplicar, persistência entre páginas, first/last touch, `_fbc`, domínios, paridade com o espelho TS; diagnóstico |
| `tests/meta-capi.test.ts` | insights, erros da Graph, blocos de datas, template/lint de UTMs, evento CAPI |
| `tests/db.test.ts` (PGlite) | máquina de estados e eventos **fora de ordem**, duplicado, regressões bloqueadas, constraint de duplicidade, **RLS** e isolamento de workspace/oferta, upsert de insights, `campaign_filter`, câmbio, dispatch por pixel, sessão do tracker |
| `tests/integration.test.ts` (Supabase local) | webhook assinado ponta a ponta: Pix → aprovado sem duplicar, replay, assinatura/timestamp inválidos, dashboard do **Ad 123 (gasto 10, 1 venda, 32,90, CPA 10, ROAS 3,29)**, array bump, reembolso + paid atrasado, chargeback, sem UTM, não mapeado, callback do tracker, isolamento entre ofertas, **RLS real** com usuário autenticado |
| `scripts/e2e-smoke.mjs` | navegador: login, 2 ofertas pela UI, produtos, conta, pixels, tracker numa landing simulada + beacon, webhooks HTTP, 15 telas sem erro de console, diagnóstico, DEMO |

## Como testar uma venda (local)

1. `supabase start` · `npm run build && npm start` · faça login.
2. Crie a oferta e associe um **ID de produto** qualquer (ex.: `produto-teste`) em Ofertas → Configurar.
3. Tenha um anúncio no catálogo: sincronize a Meta real **ou** use o ID que quiser (sem catálogo a venda fica
   `UTM_PARSED / anúncio ainda não sincronizado` — também é um teste válido).
4. Pix gerado:
   `npm run webhook:test -- --event pix_gerado --order XYZ --product produto-teste --ad <AD_ID>`
   → Pedidos: XYZ **Aguardando**; Dashboard: Pix gerados 1, vendas 0.
5. Aprovação:
   `npm run webhook:test -- --event purchase_approved --order XYZ --product produto-teste --ad <AD_ID> --amount 32.90`
   → mesmo pedido **Pago**; Campanhas mostra a venda no anúncio.
6. Reembolso: `--event refund --order XYZ` · Chargeback: `--event chargeback --order XYZ`.
7. Sem UTM: `--no-utm` → aparece em **Não rastreadas** com “Nenhuma UTM recebida”.
8. Produção: use **Testar Webhook** da Cakto (`POST /public_api/webhook/event_test/{id}/?event=purchase_approved`)
   e depois uma compra real de valor baixo com a URL de anúncio contendo as UTMs.
