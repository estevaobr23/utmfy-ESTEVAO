"use client";
import { useMemo, useState } from "react";
import { CopyButton } from "@/components/client";
import { diagnoseUrl } from "@/lib/core/diagnostic";

const LABEL = { ok: "OK", warn: "ATENÇÃO", error: "ERRO" } as const;
const TONE = { ok: "bg-emerald-50 text-emerald-800 ring-emerald-200", warn: "bg-amber-50 text-amber-900 ring-amber-200", error: "bg-rose-50 text-rose-800 ring-rose-200" } as const;

const EXAMPLE =
  "https://minhapagina.com/?utm_source=FB&utm_campaign=Campanha%20A%7C120200000000000001&utm_medium=Adset%20A%7C120200000000000002&utm_content=Ad%20123%7C120200000000000123&utm_term=Instagram_Reels&fbclid=IwAR0abc";

export function DiagnosticTool({ offers }: { offers: { id: string; name: string; checkout_url: string | null }[] }) {
  const [url, setUrl] = useState("");
  const [checkout, setCheckout] = useState(offers.find((o) => o.checkout_url)?.checkout_url ?? "https://pay.cakto.com.br/SEU_CODIGO");
  const r = useMemo(() => (url.trim() ? diagnoseUrl(url, { checkoutUrl: checkout || null }) : null), [url, checkout]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[1fr_320px]">
        <label className="text-sm">
          <span className="font-medium">URL que chegou na página (copie da barra do navegador após clicar no anúncio)</span>
          <textarea value={url} onChange={(e) => setUrl(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-300 p-2 font-mono text-xs" placeholder="https://..." />
          <button type="button" onClick={() => setUrl(EXAMPLE)} className="text-xs text-sky-700 underline">usar exemplo</button>
        </label>
        <label className="text-sm">
          <span className="font-medium">Link de checkout</span>
          <select onChange={(e) => setCheckout(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-xs" defaultValue="">
            <option value="">escolher de uma oferta…</option>
            {offers.filter((o) => o.checkout_url).map((o) => <option key={o.id} value={o.checkout_url!}>{o.name}</option>)}
          </select>
          <input value={checkout} onChange={(e) => setCheckout(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs" />
        </label>
      </div>

      {r && (
        <>
          <div className={`rounded-md px-3 py-2 text-sm font-semibold ring-1 ${TONE[r.overall]}`}>Resultado geral: {LABEL[r.overall]}</div>
          <ul className="space-y-1">
            {r.checks.map((c, i) => (
              <li key={i} className={`flex items-start gap-2 rounded px-2 py-1 text-sm ring-1 ${TONE[c.level]}`}>
                <span className="w-16 shrink-0 text-xs font-bold">{LABEL[c.level]}</span>
                <span>{c.message}</span>
              </li>
            ))}
          </ul>
          {r.parsed && (
            <div className="grid gap-3 md:grid-cols-2">
              <table className="w-full text-sm">
                <tbody>
                  {[
                    ["Source", r.parsed.source],
                    ["Campanha", `${r.parsed.campaign.name ?? "—"} · id ${r.parsed.campaign.id ?? "—"}`],
                    ["Conjunto", `${r.parsed.adset.name ?? "—"} · id ${r.parsed.adset.id ?? "—"}`],
                    ["Anúncio", `${r.parsed.ad.name ?? "—"} · id ${r.parsed.ad.id ?? "—"}`],
                    ["Placement", r.parsed.placement],
                    ["fbclid", r.fbclid ? `${r.fbclid.slice(0, 24)}…` : null],
                  ].map(([k, v]) => (
                    <tr key={k} className="border-b border-slate-100"><td className="py-1 pr-3 font-medium">{k}</td><td className="py-1 font-mono text-xs">{v ?? <span className="text-rose-600">ausente</span>}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="text-sm">
                <div className="font-medium">Parâmetros que seriam enviados ao checkout</div>
                <ul className="font-mono text-xs">
                  {Object.entries(r.sentParams).map(([k, v]) => <li key={k}>{k} = {v}</li>)}
                  {r.checkout?.added.includes("callback") && <li>callback = &lt;id da sessão do tracker&gt;</li>}
                </ul>
                {r.checkout && (
                  <div className="mt-2">
                    <div className="font-medium">URL de checkout final</div>
                    <div className="break-all rounded bg-slate-100 p-2 font-mono text-[11px]">{r.checkout.url}</div>
                    <CopyButton text={r.checkout.url} />
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
