// Entrega por WhatsApp: quando o produto "Entrega Directa por WhatsApp" é aprovado, devolve o que a ferramenta de recuperação
// (schema `recuperacao`, mesmo banco) precisa para agendar a mensagem: transação, pedido principal, e-mail, nome e telefone com DDI.
// Função pura; quem chama o banco é a rota. A lista do que foi comprado é montada no banco a partir de `utmfy.orders`.
import { normalizeHotmartPhone } from "./normalize";

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export type EntregaPedido = { transaction: string; parent: string | null; email: string | null; name: string | null; phone: string };

export function buildEntrega(body: unknown, produtoEntrega: string): EntregaPedido | null {
  const b = obj(body);
  if (b.event !== "PURCHASE_APPROVED") return null;
  const data = obj(b.data);
  if (str(obj(data.product).id) !== produtoEntrega) return null;
  const purchase = obj(data.purchase);
  const buyer = obj(data.buyer);
  const transaction = str(purchase.transaction);
  const phone = normalizeHotmartPhone(buyer.checkout_phone ?? buyer.phone, buyer.checkout_phone_code ?? buyer.phone_code);
  if (!transaction || !phone) return null;
  return {
    transaction,
    parent: str(obj(purchase.order_bump).parent_purchase_transaction),
    email: str(buyer.email)?.toLowerCase() ?? null,
    name: str(buyer.name),
    phone,
  };
}
