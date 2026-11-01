import { describe, expect, it } from "vitest";
import { clientNetFrom, preferIpv6, publicIpv6 } from "@/lib/services/tracking";

const headers = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

describe("IP e localização do beacon (cabeçalhos da Vercel)", () => {
  it("usa o primeiro IP da lista e decodifica a cidade", () => {
    const n = clientNetFrom(headers({ "x-forwarded-for": "179.1.2.3, 10.0.0.1", "x-vercel-ip-country": "BR", "x-vercel-ip-country-region": "SP", "x-vercel-ip-city": "S%C3%A3o%20Paulo" }));
    expect(n).toEqual({ ip: "179.1.2.3", country: "BR", region: "SP", city: "São Paulo" });
  });
  it("prefere x-vercel-forwarded-for e aceita IPv6", () => {
    expect(clientNetFrom(headers({ "x-vercel-forwarded-for": "2804:14d:1::1", "x-forwarded-for": "1.1.1.1" })).ip).toBe("2804:14d:1::1");
  });
  it("IPv6 informado pelo navegador vence o IPv4 do servidor; lixo e IPs locais são ignorados", () => {
    const net = { ip: "179.1.2.3", country: "MX", region: null, city: null };
    expect(preferIpv6(net, "2806:104e:1b:2c3::9f").ip).toBe("2806:104e:1b:2c3::9f");
    expect(preferIpv6(net, "2806:104E::1").ip).toBe("2806:104e::1");
    for (const bad of ["1.2.3.4", "::1", "fe80::1", "fd00::1", "::ffff:1.2.3.4", "lixo", "", undefined]) expect(preferIpv6(net, bad).ip).toBe("179.1.2.3");
    expect(publicIpv6("2001:db8::1")).toBe("2001:db8::1");
  });
  it("lixo no cabeçalho vira null, não vai para o banco", () => {
    expect(clientNetFrom(headers({ "x-forwarded-for": "não-é-ip" })).ip).toBeNull();
    expect(clientNetFrom(headers({})).ip).toBeNull();
  });
});
