// Payloads no formato REAL do webhook Cakto (forma de pedido, 44 campos + bloco
// do meio de pagamento). Usados nos testes e no modo DEMO. Nenhum dado real.

export type CaktoOrderFixture = Record<string, unknown>;

export function caktoOrder(over: Partial<Record<string, unknown>> = {}): CaktoOrderFixture {
  const id = (over.id as string) ?? "b3df956e-1998-4322-b091-ac0c54f7b4ba";
  return {
    id,
    refId: "4852F91",
    status: "paid",
    offer_type: "main",
    checkoutUrl: "https://pay.cakto.com.br/a8BcHrY",
    checkout: 52,
    parent_order: "",
    affiliate: "",
    baseAmount: 32.9,
    amount: 32.9,
    fees: 2.62,
    discount: "0.00",
    charged_fees: "0.00",
    interest: "0.00",
    additionalInstallmentInterest: "0.00",
    installments: 1,
    couponCode: null,
    reason: null,
    refund_reason: null,
    paymentMethod: "pix",
    paymentMethodName: "Pix",
    customer: {
      id: 481920,
      name: "Cliente Teste",
      email: "cliente.teste@example.com",
      phone: "34999999999",
      birthDate: null,
      docType: "cpf",
      docNumber: "12345678909",
    },
    address: null,
    shipping: null,
    product: { id: "cd287b31-d4b7-4e94-858a-96e05ce2f4a2", short_id: "42bruPi", name: "Produto Teste", type: "unique", supportEmail: "suporte@example.com", invoiceDescription: "" },
    offer: { id: "a8BcHrY", image: null, name: "Oferta Principal", price: 32.9, currency: "BRL" },
    commissions: [{ user: "producer@example.com", type: "producer", percentage: 100, totalAmount: 30.28 }],
    subscription: null,
    subscription_period: null,
    utm_source: "FB",
    utm_medium: "Adset A|120200000000000002",
    utm_campaign: "Campanha A|120200000000000001",
    utm_term: "Instagram_Reels",
    utm_content: "Ad 123|120200000000000123",
    sck: null,
    callback: null,
    fbc: "fb.1.1727700000000.IwAR0abc",
    fbp: "fb.1.1727700000000.123456789",
    createdAt: "2026-09-30T10:00:00.000000-03:00",
    due_date: null,
    paidAt: "2026-09-30T10:02:00.000000-03:00",
    refundedAt: null,
    chargedbackAt: null,
    canceledAt: null,
    pix: { qrCode: "000201...", expirationDate: "2026-09-30T11:00:00-03:00" },
    ...over,
  };
}

export function caktoWebhook(event: string, data: CaktoOrderFixture | CaktoOrderFixture[], secret = "test-secret") {
  return { secret, event, data };
}
