import { describe, expect, it } from "vitest";
import { clientNetFrom } from "@/lib/services/tracking";

const headers = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

describe("IP e localização do beacon (cabeçalhos da Vercel)", () => {
  it("usa o primeiro IP da lista e decodifica a cidade", () => {
    const n = clientNetFrom(headers({ "x-forwarded-for": "179.1.2.3, 10.0.0.1", "x-vercel-ip-country": "BR", "x-vercel-ip-country-region": "SP", "x-vercel-ip-city": "S%C3%A3o%20Paulo" }));
    expect(n).toEqual({ ip: "179.1.2.3", country: "BR", region: "SP", city: "São Paulo" });
  });
  it("prefere x-vercel-forwarded-for e aceita IPv6", () => {
    expect(clientNetFrom(headers({ "x-vercel-forwarded-for": "2804:14d:1::1", "x-forwarded-for": "1.1.1.1" })).ip).toBe("2804:14d:1::1");
  });
  it("lixo no cabeçalho vira null, não vai para o banco", () => {
    expect(clientNetFrom(headers({ "x-forwarded-for": "não-é-ip" })).ip).toBeNull();
    expect(clientNetFrom(headers({})).ip).toBeNull();
  });
});
