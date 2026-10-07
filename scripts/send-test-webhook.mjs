// Envia um webhook Cakto ASSINADO (HMAC igual ao da Cakto) para testar o fluxo.
// Uso:
//   npm run webhook:test -- --event pix_gerado --order XYZ --product <ID_PRODUTO_CAKTO> --ad <AD_ID>
//   npm run webhook:test -- --event purchase_approved --order XYZ --product <ID> --ad <AD_ID> --amount 32.90
//   npm run webhook:test -- --event refund --order XYZ --product <ID>
// Opções: --url (padrão APP_URL/api/webhooks/cakto?ws=principal) --ws principal --no-utm --callback <sessão>
import { createHmac, randomUUID } from "node:crypto";
import { arg, loadEnv } from "./_env.mjs";

const env = loadEnv();
const secret = (env.CAKTO_WEBHOOK_SECRETS ?? "").split(",")[0]?.trim();
if (!secret) {
  console.error("CAKTO_WEBHOOK_SECRETS ausente no .env.local");
  process.exit(1);
}
const event = arg("event", "purchase_approved");
const orderId = arg("order", randomUUID());
const product = arg("product", "produto-teste");
const ad = arg("ad", "120200000000000123");
const adset = arg("adset", "120200000000000002");
const campaign = arg("campaign", "120200000000000001");
const amount = Number(arg("amount", "32.90"));
const ws = arg("ws", "principal");
const url = arg("url", `${(env.APP_URL ?? "http://localhost:3200").replace(/\/$/, "")}/api/webhooks/cakto?ws=${ws}`);
const noUtm = process.argv.includes("--no-utm");
const now = new Date();

const status = { purchase_approved: "paid", pix_gerado: "waiting_payment", refund: "refunded", chargeback: "chargedback", purchase_refused: "refused", refund_requested: "refund_requested" }[event] ?? "paid";
const data = {
  id: orderId, refId: orderId.slice(0, 7).toUpperCase(), status, offer_type: "main", checkoutUrl: `https://pay.cakto.com.br/${arg("offer", "TESTE")}`,
  checkout: 1, parent_order: "", affiliate: "", baseAmount: amount, amount, fees: Math.round(amount * 8) / 100, discount: "0.00",
  charged_fees: "0.00", interest: "0.00", additionalInstallmentInterest: "0.00", installments: 1, couponCode: null, reason: null, refund_reason: null,
  paymentMethod: arg("payment", "pix"), paymentMethodName: "Pix",
  customer: { id: 1, name: "Teste", email: "teste@example.com", phone: "34999999999", birthDate: null, docType: "cpf", docNumber: "00000000000" },
  address: null, shipping: null,
  product: { id: product, short_id: "tst", name: "Produto Teste", type: "unique", supportEmail: "", invoiceDescription: "" },
  offer: { id: arg("offer", "TESTE"), image: null, name: "Oferta Teste", price: amount, currency: "BRL" },
  commissions: [], subscription: null, subscription_period: null,
  utm_source: noUtm ? null : "FB",
  utm_campaign: noUtm ? null : `Campanha Teste|${campaign}`,
  utm_medium: noUtm ? null : `Conjunto Teste|${adset}`,
  utm_content: noUtm ? null : `Anuncio Teste|${ad}`,
  utm_term: noUtm ? null : "Instagram_Reels",
  sck: null, callback: arg("callback", null), fbc: null, fbp: null,
  createdAt: new Date(now.getTime() - 120000).toISOString(),
  due_date: null,
  paidAt: status === "paid" || status === "refunded" || status === "chargedback" ? now.toISOString() : null,
  refundedAt: status === "refunded" ? now.toISOString() : null,
  chargedbackAt: status === "chargedback" ? now.toISOString() : null,
  canceledAt: null,
};
const raw = JSON.stringify({ secret, event, data });
const ts = Math.floor(Date.now() / 1000);
const sig = `v1=${createHmac("sha256", secret).update(`${ts}.`).update(raw).digest("hex")}`;
const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "CaktoBot/1.0 (teste)", "X-Cakto-Timestamp": String(ts), "X-Cakto-Signature": sig }, body: raw });
console.log(`${event} ${orderId} → HTTP ${res.status}`, await res.text());
