import { describe, expect, it } from "vitest";
import { spendStatus, type SpendStatusInput } from "@/lib/core/spend-status";

const base: SpendStatusInput = {
  accounts: [{ account_id: "1", last_error: null }],
  syncedWindows: [{ since: "2026-10-01", until: "2026-10-11" }],
  excluded: [],
  from: "2026-10-05",
  to: "2026-10-11",
  today: "2026-10-11",
};

describe("confiabilidade do gasto", () => {
  it("período coberto e sem pendências → confiável", () => {
    expect(spendStatus(base)).toMatchObject({ state: "ok", reliable: true });
  });
  it("sem contas → não confiável (gasto desconhecido, não R$ 0)", () => {
    expect(spendStatus({ ...base, accounts: [] })).toMatchObject({ state: "no_accounts", reliable: false });
  });
  it("conta com erro de sincronização", () => {
    expect(spendStatus({ ...base, accounts: [{ account_id: "1", last_error: "token_expired: x" }] }).state).toBe("error");
  });
  it("dias do período sem sincronização", () => {
    const s = spendStatus({ ...base, syncedWindows: [{ since: "2026-10-08", until: "2026-10-11" }] });
    expect(s.state).toBe("not_synced");
    expect(s.message).toContain("3 dia(s)");
  });
  it("nunca sincronizado", () => {
    expect(spendStatus({ ...base, syncedWindows: [] }).state).toBe("not_synced");
  });
  it("dias futuros do período não contam como pendentes", () => {
    expect(spendStatus({ ...base, to: "2026-10-31" }).state).toBe("ok");
  });
  it("gasto excluído por falta de câmbio", () => {
    const s = spendStatus({ ...base, excluded: [{ account_id: "1", currency: "USD", spend: 51.92 }] });
    expect(s.state).toBe("fx_missing");
    expect(s.message).toContain("USD 51.92");
  });
});
