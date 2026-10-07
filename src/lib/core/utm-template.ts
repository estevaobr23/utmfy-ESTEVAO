// Template de "Parâmetros de URL" para anúncios da Meta.
// Macros dinâmicas suportadas pela Meta (Central de Ajuda: "Parâmetros de URL
// dinâmicos"): {{campaign.id}}, {{campaign.name}}, {{adset.id}}, {{adset.name}},
// {{ad.id}}, {{ad.name}}, {{placement}}, {{site_source_name}}.
// fbclid é acrescentado automaticamente pela Meta — não colocar no template.

export type TemplateOptions = { source: string; includeSiteSource?: boolean };

export const META_MACROS = [
  { macro: "{{campaign.id}}", desc: "ID numérico da campanha (estável mesmo se renomear)" },
  { macro: "{{campaign.name}}", desc: "Nome da campanha no momento do clique" },
  { macro: "{{adset.id}}", desc: "ID do conjunto de anúncios" },
  { macro: "{{adset.name}}", desc: "Nome do conjunto" },
  { macro: "{{ad.id}}", desc: "ID do anúncio — a chave principal da atribuição" },
  { macro: "{{ad.name}}", desc: "Nome do anúncio" },
  { macro: "{{placement}}", desc: "Posicionamento (ex.: Facebook_Mobile_Feed, Instagram_Stories)" },
  { macro: "{{site_source_name}}", desc: "Origem: fb, ig, msg ou an" },
] as const;

export function buildMetaUrlParameters(opts: TemplateOptions): string {
  const source = opts.source.trim() || "FB";
  const parts = [
    `utm_source=${encodeURIComponent(source)}`,
    "utm_campaign={{campaign.name}}|{{campaign.id}}",
    "utm_medium={{adset.name}}|{{adset.id}}",
    "utm_content={{ad.name}}|{{ad.id}}",
    "utm_term={{placement}}",
  ];
  if (opts.includeSiteSource) parts.push("utm_id={{campaign.id}}");
  return parts.join("&");
}

export const TEMPLATE_EXPLANATION = [
  { param: "utm_source", value: "FB", why: "Identifica a plataforma. Mantenha fixo e igual em todos os anúncios da Meta." },
  { param: "utm_campaign", value: "{{campaign.name}}|{{campaign.id}}", why: "Nome + ID da campanha. O ID (depois do |) é o que usamos para cruzar com o gasto." },
  { param: "utm_medium", value: "{{adset.name}}|{{adset.id}}", why: "Nome + ID do conjunto de anúncios." },
  { param: "utm_content", value: "{{ad.name}}|{{ad.id}}", why: "Nome + ID do anúncio. O ad_id é a chave principal da atribuição." },
  { param: "utm_term", value: "{{placement}}", why: "Posicionamento em que o anúncio foi exibido." },
];

/** Avisos sobre um template digitado/colado pelo usuário. */
export function lintTemplate(template: string): { level: "ok" | "warn" | "error"; message: string }[] {
  const out: { level: "ok" | "warn" | "error"; message: string }[] = [];
  const t = template.trim();
  if (!t) return [{ level: "error", message: "Template vazio." }];
  if (t.startsWith("?")) out.push({ level: "warn", message: "Remova o '?' inicial: no campo 'Parâmetros de URL' da Meta ele não é necessário." });
  if (/fbclid/i.test(t)) out.push({ level: "warn", message: "Não coloque fbclid no template: a Meta adiciona sozinha." });
  const required: [string, string][] = [
    ["{{ad.id}}", "Falta {{ad.id}} — sem ele não há atribuição por anúncio."],
    ["{{adset.id}}", "Falta {{adset.id}}."],
    ["{{campaign.id}}", "Falta {{campaign.id}}."],
    ["utm_source=", "Falta utm_source."],
  ];
  for (const [needle, msg] of required) if (!t.includes(needle)) out.push({ level: needle === "{{ad.id}}" ? "error" : "warn", message: msg });
  const macros = t.match(/\{\{[^}]*\}\}/g) ?? [];
  const known = new Set<string>(META_MACROS.map((m) => m.macro));
  for (const m of macros) if (!known.has(m)) out.push({ level: "error", message: `Macro desconhecida: ${m}. A Meta vai enviá-la literalmente.` });
  if (/\{[a-z_.]+\}(?!\})/i.test(t.replace(/\{\{[^}]*\}\}/g, ""))) out.push({ level: "error", message: "Macro com chave simples ({campaign.id}); a Meta exige chaves duplas {{...}}." });
  if (/%7B/i.test(t)) out.push({ level: "error", message: "Macros codificadas (%7B%7B...). Cole o template sem codificar." });
  if (!out.length) out.push({ level: "ok", message: "Template completo." });
  return out;
}
