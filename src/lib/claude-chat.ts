// Botão "Pedir ao Claude": link que abre o Claude Code no VS Code deste computador, na conversa do projeto, com a
// mensagem já escrita (o usuário só lê e dá Enter). Fonte: https://code.claude.com/docs/en/vs-code
// (seção "Launch a VS Code tab from other tools"): vscode://anthropic.claude-code/open?prompt=<texto>&session=<id>
//  - `prompt` vem pré-preenchido e NÃO é enviado sozinho;
//  - `session` retoma a conversa; se ela não existir mais, abre uma conversa nova com o mesmo prompt
//    (o contexto do projeto vem do CLAUDE.md, da skill utmfy-tracker e do INTEGRACAO-CHATS.md, então funciona igual).
// Nunca coloque segredo na mensagem (token de webhook, token Meta, chaves): só nomes, slugs e IDs públicos.

/** Conversa do projeto. Se abrir um chat novo como "principal", troque aqui (ou defina NEXT_PUBLIC_CLAUDE_SESSION_ID). */
export const CLAUDE_SESSION_ID = process.env.NEXT_PUBLIC_CLAUDE_SESSION_ID || "a2addc9a-7baa-490e-93c0-7282af7fbe37";

const REGRA =
  "Siga a regra do projeto (INTEGRACAO-CHATS.md, seção 2.1): use os helpers, rode primeiro a simulação, me mostre o plano e só grave depois do meu ok.";

export function claudeChatUrl(prompt: string, session: string = CLAUDE_SESSION_ID) {
  const q = new URLSearchParams();
  if (session) q.set("session", session);
  q.set("prompt", prompt);
  // URLSearchParams codifica espaço como "+", mas o handler espera %20.
  return `vscode://anthropic.claude-code/open?${q.toString().replace(/\+/g, "%20")}`;
}

type Offer = { id: string; name: string; slug?: string };
const ofertaTxt = (o: Offer) => `oferta "${o.name}" (${o.slug ? `slug ${o.slug}, ` : ""}id ${o.id})`;

export const ask = {
  /** Oferta nova do zero: oferta + webhook de rastreio + pixel + script. Os [PREENCHER] são editados na caixa antes do Enter. */
  novaOferta: () =>
    `[UTMFY] Quero criar uma oferta nova completa (oferta no UTMFY + webhook de rastreio na Cakto + pixel na Meta + script da página).\n` +
    `Nome da oferta: [PREENCHER]\nProduto da Cakto (nome ou ID): [PREENCHER]\nPixel: [criar um novo | reaproveitar o ID ...]\n${REGRA}`,

  /** Webhook de rastreio de uma oferta (criar, corrigir ou revisar conforme o estado). */
  webhook: (o: Offer, estado: "sem_webhook" | "sem_produtos" | "ok" = "ok") =>
    `[UTMFY · Webhooks Cakto] ${ofertaTxt(o)}.\n` +
    (estado === "sem_webhook"
      ? "Ela ainda NÃO tem webhook de rastreio na Cakto. Crie com o helper (webhook-criar), conferindo produto, URL e os 7 eventos.\n"
      : estado === "sem_produtos"
        ? "O webhook dela existe mas está SEM produtos. Descubra o produto certo na Cakto e corrija o webhook.\n"
        : "Quero revisar o webhook de rastreio dela (verificar) e corrigir o que estiver fora do padrão.\n") +
    REGRA,

  /** Pixel de uma oferta: criar/reaproveitar na Meta, cadastrar e ligar. */
  pixelOferta: (o: Offer, temPixel: boolean) =>
    `[UTMFY · Pixels] ${ofertaTxt(o)}.\n` +
    (temPixel
      ? "Ela já tem pixel ligado. Revise (verificar): se está exclusivo, disparando na página e com campanhas.\n"
      : "Ela ainda NÃO tem pixel ligado. Crie um pixel novo na Meta (ou reaproveite um que já exista, conferindo duplicado), cadastre no UTMFY, ligue à oferta e me dê o script da página (pixel-criar).\n") +
    REGRA,

  /** Pixel solto (cadastrado, sem oferta). */
  pixelSolto: (nome: string, externalId: string) =>
    `[UTMFY · Pixels] O pixel "${nome}" (${externalId}) está cadastrado mas NÃO ligado a nenhuma oferta. ` +
    `Descubra a que oferta ele pertence (ou se deve ser apagado) e ligue com o helper, respeitando 1 oferta = 1 pixel.\n${REGRA}`,

  /** Pixel novo sem oferta definida. */
  pixelNovo: () =>
    `[UTMFY · Pixels] Quero um pixel novo por prompt.\nOferta: [PREENCHER]\nPixel: [criar um novo | reaproveitar o ID ...]\n` +
    `Crie/reaproveite na Meta, cadastre no UTMFY, ligue à oferta e me dê o script da página.\n${REGRA}`,

  /** Qualquer problema mostrado em uma tela. */
  problema: (tela: string, titulo: string, detalhe: string, o?: Offer) =>
    `[UTMFY · ${tela}] Apareceu este problema${o ? ` na ${ofertaTxt(o)}` : ""}:\n"${titulo}: ${detalhe}"\n` +
    `Diagnostique (verificar / status), me explique a causa e corrija o que for configuração (webhook, pixel, vínculo, token). ` +
    `Se a correção exigir algo fora do alcance dos helpers, me diga o passo exato.\n${REGRA}`,

  /** Conversa livre, sempre disponível. */
  livre: (tela: string, o?: Offer) =>
    `[UTMFY · ${tela}]${o ? ` ${ofertaTxt(o)}.` : ""} Preciso de ajuda com: [DESCREVER]\n${REGRA}`,
};
