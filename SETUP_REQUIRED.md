# SETUP_REQUIRED — o que depende de você

Tudo que está aqui precisa de credencial, decisão ou acesso seu. Fora desta lista, o sistema já está construído
e testado localmente.

## Supabase (produção)

- [ ] Liberar espaço para um projeto novo: a org já tem 2 projetos free ativos (`cestavitrine`, `gatos-membros`).
      Opções: pausar um, fazer upgrade, ou usar outra organização. **Não pausei nada** por ser produção sua.
- [ ] Criar o projeto (sugestão: `utmfy-tracker`, região `sa-east-1`) e rodar `supabase link --project-ref <ref>` + `supabase db push`
- [ ] Authentication → desativar **Allow new users to sign up**
- [ ] Database → Extensions → habilitar `pg_cron` e `pg_net` (agendamento a cada 15 min)
- [ ] Copiar `NEXT_PUBLIC_SUPABASE_URL`, chave publishable/anon e `SUPABASE_SERVICE_ROLE_KEY` para a Vercel

## Deploy (Vercel)

- [ ] Importar o projeto na Vercel (time `estevaobr23's projects` já está conectado)
- [ ] Definir as variáveis de `.env.example` (Production). `APP_URL` = URL pública
- [ ] Gerar `CRON_SECRET` (`openssl rand -hex 24`) e colocar na Vercel **e** no Vault (`supabase/sql/pg_cron_schedule.sql`)
- [ ] Rodar `supabase/sql/pg_cron_schedule.sql` (trocando `APP_URL`)
- [ ] `npm run admin:create -- --email micaelestevao735@gmail.com` apontando para o Supabase de produção

## Cakto

- [ ] Painel → Integrações → Cakto API → **Criar chave** com escopos `read`, `orders`, `products`, `offers`
      → `CAKTO_CLIENT_ID` e `CAKTO_CLIENT_SECRET` (o `client_secret` só aparece na criação)
      *(o Cakto MCP desta máquina tem credencial própria; ela não foi copiada para o app)*
- [ ] Painel → Webhooks → criar webhook com URL `https://APP_URL/api/webhooks/cakto?ws=principal`, produtos das
      suas ofertas e eventos `purchase_approved, pix_gerado, purchase_refused, refund, refund_requested, chargeback, boleto_gerado`
- [ ] Copiar o **secret** de cada webhook para `CAKTO_WEBHOOK_SECRETS` (separados por vírgula)
- [ ] (Opcional) depois de validar que chega `X-Cakto-Signature`, definir `CAKTO_ALLOW_BODY_SECRET=false`
- [ ] Enviar **Testar Webhook** na Cakto e conferir em Integração Cakto → Últimos webhooks
- [ ] Clicar **SINCRONIZAR CAKTO** para trazer o histórico recente

## Meta

- [ ] Recomendado: criar um **System User** no Business Manager com permissão **somente `ads_read`** nas contas
      e gerar token → `META_ACCESS_TOKEN`.
      *(Para testar localmente usei o `FB_ACCESS_TOKEN` de `CLAUDE+GERENCIADOR/.env`, copiado para `.env.local`
      sem exibir o valor. Ele é válido, mas tem também `ads_management` e outras permissões — o app só faz leitura,
      mas o ideal é um token com privilégio mínimo.)*
- [ ] (Opcional, alternativa ao token fixo) criar Meta App → `META_APP_ID`, `META_APP_SECRET`, redirect
      `https://APP_URL/api/meta/oauth/callback` → botão “Conectar com Facebook”
- [ ] Contas Meta → **Descobrir contas** → marcar **Monitorar** nas contas usadas
      (encontradas: CONTA 1 ADS EUA, CONTA 2 EUA, CONTA 03 DOLAR)
- [ ] **Decidir o câmbio**: as 3 contas são em **USD** e as vendas em **BRL**. Defina em Contas Meta o câmbio manual
      (ex.: `5.60`, já com IOF se quiser). Sem isso o gasto não entra no ROAS (proposital: nada de conversão automática)
- [ ] Associar cada conta à(s) oferta(s) em Ofertas → Configurar (use o filtro de nome de campanha se uma conta
      serve várias ofertas)

## Anúncios e páginas

- [ ] Colar os **Parâmetros de URL** (tela Configuração de UTMs) em todos os anúncios ativos
- [ ] Instalar o script do tracker (Ofertas → Configurar → Passo 7) em todas as páginas do funil
- [ ] Garantir que os botões de compra apontam para `pay.cakto.com.br/...` (ou configurar `data-checkout-domains`)
- [ ] Fazer um clique real num anúncio e colar a URL em **Diagnóstico de tracking**
- [ ] Fazer uma compra de teste e confirmar em Pedidos que chegou `EXACT_ID` (e se o `callback` volta no webhook)

## Pixels / CAPI (fase posterior)

- [ ] Cadastrar os pixels em Pixels e associar às ofertas
- [ ] Quando a atribuição estiver validada: gerar token da Conversions API por pixel (Events Manager), salvar
      (vai para o Vault), ligar *server-side* no pixel e definir `CAPI_ENABLED=true`. Testar primeiro com `test_event_code`.
- [ ] Revisar a base legal/consentimento para envio de e-mail/telefone hasheados à Meta

## Limpeza local

- [ ] Guardar a senha de `admin-credentials.local.txt` num gerenciador e apagar o arquivo
- [ ] O workspace local `principal` tem dados de teste do E2E (ofertas `CestaVitrine`/`Projetos de Sofas` com sufixo)
      — `supabase db reset` limpa tudo
