import { describe, expect, it } from "vitest";
import { ACCOUNT_TONES, accountToneClass, accountToneMap, filterByAccount, resolveAccount } from "@/lib/core/meta-account-filter";

const C1 = "2094401681297034";
const C2 = "955176270216988";
const C3 = "1512820173079575";
const known = [C1, C2, C3];

describe("filtro por conta de anúncios (Meta Ads)", () => {
  it("URL vence o cookie; 'all' = Todas mesmo com conta lembrada", () => {
    expect(resolveAccount({ account: C2 }, C1, known)).toBe(C2);
    expect(resolveAccount({ account: "all" }, C1, known)).toBeNull();
    expect(resolveAccount({}, C1, known)).toBe(C1);
    expect(resolveAccount({}, undefined, known)).toBeNull();
  });

  it("ignora conta que não é desta tela (outra oferta) e lixo", () => {
    expect(resolveAccount({}, "999", known)).toBeNull();
    expect(resolveAccount({ account: "999" }, C1, known)).toBeNull();
    expect(resolveAccount({ account: "<script>" }, C1, known)).toBeNull();
    expect(resolveAccount({}, "act_1", known)).toBeNull();
  });

  it("filtra as linhas e, com elas, os totais", () => {
    const rows = [
      { id: "a", accountId: C1, spend: 10 },
      { id: "b", accountId: C2, spend: 5 },
      { id: "c", accountId: C1, spend: 2 },
      { id: "d", accountId: null, spend: 1 },
    ];
    expect(filterByAccount(rows, C1).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterByAccount(rows, C1).reduce((s, r) => s + r.spend, 0)).toBe(12);
    expect(filterByAccount(rows, C2).map((r) => r.id)).toEqual(["b"]);
    expect(filterByAccount(rows, null)).toHaveLength(4);
  });

  it("cor fixa por conta pela ordem do nome: as 3 contas têm cores diferentes", () => {
    const tones = accountToneMap([
      { account_id: C3, account_name: "CONTA 03 DOLAR" },
      { account_id: C1, account_name: "CONTA 1 ADS EUA" },
      { account_id: C2, account_name: "CONTA 2 EUA" },
    ]);
    expect(tones).toEqual({ [C1]: 0, [C2]: 1, [C3]: 2 });
    const classes = known.map((id) => accountToneClass(id, tones));
    expect(new Set(classes).size).toBe(3);
    expect(accountToneClass(C1, tones)).toBe(ACCOUNT_TONES[0]);
    expect(ACCOUNT_TONES).toContain(accountToneClass("123", {}));
  });
});
