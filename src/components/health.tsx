import type { SupabaseClient } from "@supabase/supabase-js";
import { timeAgo } from "@/lib/core/dates";
import { envStatus } from "@/lib/env";
import { LevelBadge } from "./ui";

type Level = "ok" | "warn" | "error";
type Item = { name: string; level: Level; detail: string };

type Health = {
  cakto: { status: string; last_webhook_at: string | null; last_api_ok_at: string | null; last_sync_at: string | null; last_error: string | null } | null;
  last_webhook: { received_at: string; status: string; event: string } | null;
  webhook_failures_24h: number;
  meta_connection: { status: string; last_sync_at: string | null; last_error: string | null; token_hint: string | null } | null;
  meta_accounts: { account_id: string; name: string | null; last_sync_at: string | null; last_error: string | null; active: boolean }[];
  last_insight_import: string | null;
  tracker: { sessions_24h: number; last_seen_at: string | null; with_utm_24h: number } | null;
  tracker_ever: number;
  pixels: { total: number; active: number; server: number };
  orders_7d: { paid: number; without_ad_id: number; untracked: number; macro_unresolved: number; unmapped_offer: number; last_order_at: string | null };
  dispatch_failures: number;
};

const minutes = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 60000 : Infinity);

export async function loadHealth(sb: SupabaseClient, wsId: string, offerId?: string): Promise<{ items: Item[]; raw: Health | null }> {
  const { data } = await sb.rpc("integration_health", { p_workspace: wsId, p_offer: offerId ?? null });
  const h = data as Health | null;
  const env = envStatus();
  const items: Item[] = [];
  if (!h) return { items: [{ name: "Banco", level: "error", detail: "Não foi possível ler o estado" }], raw: null };

  items.push(
    env.CAKTO_CLIENT_ID && env.CAKTO_CLIENT_SECRET
      ? { name: "Cakto API", level: h.cakto?.last_error ? "warn" : "ok", detail: h.cakto?.last_api_ok_at ? `conectada · última leitura ${timeAgo(h.cakto.last_api_ok_at)}` : h.cakto?.last_error ?? "credenciais presentes, ainda não testada (rode Sincronizar Cakto)" }
      : { name: "Cakto API", level: "error", detail: "CAKTO_CLIENT_ID/CAKTO_CLIENT_SECRET ausentes" },
  );
  if (!env.CAKTO_WEBHOOK_SECRETS) items.push({ name: "Webhook Cakto", level: "error", detail: "CAKTO_WEBHOOK_SECRETS ausente — webhooks serão recusados" });
  else if (!h.last_webhook) items.push({ name: "Webhook Cakto", level: "warn", detail: "nenhuma entrega recebida ainda" });
  else items.push({ name: "Webhook Cakto", level: h.webhook_failures_24h ? "warn" : "ok", detail: `última entrega ${timeAgo(h.last_webhook.received_at)} (${h.last_webhook.event ?? "?"}, ${h.last_webhook.status})${h.webhook_failures_24h ? ` · ${h.webhook_failures_24h} falha(s)/recusa(s) em 24h` : ""}` });

  const m = h.meta_connection;
  if (!m) items.push({ name: "Meta Ads", level: "error", detail: "nenhuma conexão (META_ACCESS_TOKEN ou OAuth)" });
  else if (m.status === "token_expired") items.push({ name: "Meta Ads", level: "error", detail: "token expirado — gere um novo" });
  else if (m.status === "no_permission") items.push({ name: "Meta Ads", level: "error", detail: `sem permissão: ${m.last_error ?? ""}` });
  else if (!h.meta_accounts.length) items.push({ name: "Meta Ads", level: "warn", detail: "nenhuma conta de anúncio associada/monitorada" });
  else {
    const failing = h.meta_accounts.filter((a) => a.last_error);
    const oldest = Math.max(...h.meta_accounts.map((a) => minutes(a.last_sync_at)));
    items.push({
      name: "Meta Ads",
      level: failing.length ? "error" : oldest > 180 ? "warn" : "ok",
      detail: failing.length ? `${failing.length} conta(s) com erro: ${failing[0].last_error}` : `sincronizado ${timeAgo(h.meta_accounts.map((a) => a.last_sync_at).sort().at(-1) ?? null)}`,
    });
  }

  const t = h.tracker;
  if (!h.tracker_ever) items.push({ name: "Tracker", level: "warn", detail: "nenhuma sessão recebida (instale o script)" });
  else items.push({ name: "Tracker", level: t && t.sessions_24h ? (t.with_utm_24h ? "ok" : "warn") : "warn", detail: t && t.sessions_24h ? `${t.sessions_24h} sessões em 24h, ${t.with_utm_24h} com UTM` : `sem sessões nas últimas 24h (última ${timeAgo(t?.last_seen_at ?? null)})` });

  items.push(h.pixels.active ? { name: "Pixel", level: "ok", detail: `${h.pixels.active} ativo(s)${h.pixels.server ? `, ${h.pixels.server} com envio server-side` : ""}` } : { name: "Pixel", level: "warn", detail: "nenhum pixel ativo associado" });

  const o = h.orders_7d;
  const issues = [
    o.without_ad_id ? `${o.without_ad_id} venda(s) sem ad_id` : null,
    o.macro_unresolved ? `${o.macro_unresolved} com macro não resolvida` : null,
    o.unmapped_offer ? `${o.unmapped_offer} pedido(s) de produto não mapeado` : null,
  ].filter(Boolean);
  items.push({ name: "UTMs (7 dias)", level: o.macro_unresolved || o.unmapped_offer ? "error" : issues.length ? "warn" : o.paid ? "ok" : "warn", detail: issues.length ? issues.join(" · ") : o.paid ? `${o.paid} vendas, todas com ad_id` : "sem vendas no período" });

  const { data: ws } = await sb.from("workspaces").select("currency").eq("id", wsId).single();
  let fxq = sb.from("meta_ad_accounts").select("id, account_id, currency, fx_rate").eq("workspace_id", wsId);
  if (offerId) {
    const { data: links } = await sb.from("offer_ad_accounts").select("ad_account_id").eq("offer_id", offerId);
    fxq = fxq.in("id", (links ?? []).map((l) => l.ad_account_id));
  } else fxq = fxq.eq("active", true);
  const { data: fx } = await fxq;
  const noFx = (fx ?? []).filter((a) => a.currency && ws && a.currency !== ws.currency && !a.fx_rate);
  if (noFx.length) items.push({ name: "Moeda", level: "error", detail: `${noFx.length} conta(s) em ${noFx[0].currency} sem câmbio configurado: gasto NÃO entra no ROAS (Contas Meta → câmbio)` });

  if (h.dispatch_failures) items.push({ name: "Eventos CAPI", level: "warn", detail: `${h.dispatch_failures} dispatch(es) com falha` });
  return { items, raw: h };
}

export function HealthList({ items }: { items: Item[] }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {items.map((i) => (
        <li key={i.name} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <div>
            <div className="font-medium text-slate-800">{i.level === "ok" ? "✓" : i.level === "warn" ? "⚠" : "✕"} {i.name}</div>
            <div className="text-slate-500">{i.detail}</div>
          </div>
          <LevelBadge level={i.level} />
        </li>
      ))}
    </ul>
  );
}
