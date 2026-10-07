"use client";
import { useMemo, useState } from "react";
import { CodeBlock } from "@/components/client";
import { buildMetaUrlParameters, lintTemplate } from "@/lib/core/utm-template";

export function TemplateTool() {
  const [source, setSource] = useState("FB");
  const [custom, setCustom] = useState("");
  const template = useMemo(() => buildMetaUrlParameters({ source }), [source]);
  const lint = useMemo(() => lintTemplate(custom || template), [custom, template]);
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium">utm_source</span>
        <input value={source} onChange={(e) => setSource(e.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 30))} className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <span className="text-xs text-slate-500">(mantenha igual em todos os anúncios; ex.: FB)</span>
      </label>
      <div>
        <div className="mb-1 text-sm font-medium">Versão pronta para colar em “Parâmetros de URL” do anúncio</div>
        <CodeBlock code={template} />
      </div>
      <div>
        <div className="mb-1 text-sm font-medium">Verificar um template que você já usa</div>
        <textarea value={custom} onChange={(e) => setCustom(e.target.value)} rows={3} placeholder="cole aqui o que está no seu anúncio hoje" className="w-full rounded-md border border-slate-300 p-2 font-mono text-xs" />
        <ul className="mt-2 space-y-1 text-sm">
          {lint.map((l, i) => (
            <li key={i} className={l.level === "error" ? "text-rose-700" : l.level === "warn" ? "text-amber-700" : "text-emerald-700"}>
              {l.level === "error" ? "ERRO" : l.level === "warn" ? "ATENÇÃO" : "OK"} — {l.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
