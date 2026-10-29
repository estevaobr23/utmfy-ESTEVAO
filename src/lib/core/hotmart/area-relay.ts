// Repasse da venda da Hotmart à função de acesso da área de membros (Supabase `lavadoras-webhook`).
// Há UM webhook só na Hotmart (o da UTMFY, todos os produtos); em vez de um segundo webhook, o receptor repassa
// a venda do 120 Fallas já traduzida para o formato que a função de acesso entende (o mesmo da Cakto).
// Função pura: monta o corpo; quem faz o POST é a rota.

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Eventos que mexem no acesso. APPROVED libera; REFUNDED e CHARGEBACK revogam. O resto não passa. */
const EVENTO_AREA: Record<string, "purchase_approved" | "refund" | "chargeback"> = {
  PURCHASE_APPROVED: "purchase_approved",
  PURCHASE_REFUNDED: "refund",
  PURCHASE_CHARGEBACK: "chargeback",
};

export type AreaRelay = { event: "purchase_approved" | "refund" | "chargeback"; data: Record<string, unknown> };

/**
 * Devolve o corpo (sem o `secret`) para a função da área, ou null se o evento não é de acesso, o produto não é o do 120 Fallas
 * ou faltam dados. `produtos` = ids numéricos da Hotmart que liberam a área (env AREA_HOTMART_PRODUCT_IDS; padrão 8814892).
 * Order bump não libera nada (a função da área só conhece o produto principal).
 */
export function buildAreaRelay(body: unknown, produtos: string[]): AreaRelay | null {
  const b = obj(body);
  const event = EVENTO_AREA[String(b.event ?? "")];
  if (!event) return null;
  const data = obj(b.data);
  const product = obj(data.product);
  const purchase = obj(data.purchase);
  const buyer = obj(data.buyer);
  const productId = str(product.id);
  if (!productId || !produtos.includes(productId)) return null;
  if (obj(purchase.order_bump).is_order_bump === true) return null;
  const transaction = str(purchase.transaction);
  if (!transaction) return null;
  const email = str(buyer.email)?.toLowerCase() ?? null;
  if (event === "purchase_approved" && !email) return null;
  const price = obj(purchase.price);
  return {
    event,
    data: {
      id: transaction,
      status: event === "purchase_approved" ? "paid" : event === "refund" ? "refunded" : "chargedback",
      amount: price.value ?? null,
      customer: { email, name: str(buyer.name), phone: str(buyer.checkout_phone) ?? str(buyer.phone) },
      product: { id: productId, name: str(product.name) },
      // `short_id` carrega o código da oferta da Hotmart; a função da área casa com offers.cakto_offer_id.
      offer: { id: null, short_id: str(obj(purchase.offer).code), name: null },
    },
  };
}
