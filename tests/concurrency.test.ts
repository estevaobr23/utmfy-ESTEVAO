import { describe, expect, it } from "vitest";
import { mapPool } from "@/lib/core/concurrency";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapPool", () => {
  it("mantém a ordem dos resultados", async () => {
    const out = await mapPool([30, 5, 15], 3, async (ms, i) => { await sleep(ms); return i; });
    expect(out).toEqual([0, 1, 2]);
  });
  it("nunca passa do limite de paralelismo", async () => {
    let running = 0, peak = 0;
    await mapPool(Array.from({ length: 12 }, (_, i) => i), 4, async () => { running++; peak = Math.max(peak, running); await sleep(5); running--; });
    expect(peak).toBe(4);
  });
  it("lista vazia não trava", async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
  });
});
