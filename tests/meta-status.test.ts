import { describe, expect, it } from "vitest";
import { childStatusChange, isRemovedStatus, MAX_BULK, parseBulkIds, removedLabel, statusAfter } from "@/lib/core/meta-status";

describe("meta-status", () => {
  it("arquivado e excluído contam como removidos; o resto não", () => {
    expect(isRemovedStatus("ARCHIVED")).toBe(true);
    expect(isRemovedStatus("DELETED")).toBe(true);
    for (const s of ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "IN_PROCESS", null, undefined]) expect(isRemovedStatus(s)).toBe(false);
    expect(removedLabel("DELETED")).toBe("Excluída");
    expect(removedLabel("ARCHIVED")).toBe("Arquivada");
    expect(removedLabel("ACTIVE")).toBeNull();
  });

  it("lê a lista de IDs: só números da Meta, sem repetir, até o limite", () => {
    expect(parseBulkIds("1, 2,2,3")).toEqual(["1", "2", "3"]);
    expect(parseBulkIds("")).toBeNull();
    expect(parseBulkIds("12,abc")).toBeNull();
    expect(parseBulkIds("1;drop table")).toBeNull();
    expect(parseBulkIds(Array.from({ length: MAX_BULK }, (_, i) => i + 1).join(","))).toHaveLength(MAX_BULK);
    expect(parseBulkIds(Array.from({ length: MAX_BULK + 1 }, (_, i) => i + 1).join(","))).toBeNull();
  });

  it("status local depois de cada operação e dos filhos", () => {
    expect(statusAfter("activate")).toBe("ACTIVE");
    expect(statusAfter("pause")).toBe("PAUSED");
    expect(statusAfter("delete")).toBe("DELETED");
    expect(childStatusChange("delete", "campaign")).toEqual({ to: "DELETED", only: null });
    expect(childStatusChange("pause", "campaign")).toEqual({ to: "CAMPAIGN_PAUSED", only: "ACTIVE" });
    expect(childStatusChange("activate", "adset")).toEqual({ to: "ACTIVE", only: "ADSET_PAUSED" });
  });
});
