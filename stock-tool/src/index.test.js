import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import data from "./inventory.data.js";
import { DATA_AS_OF, INVENTORY, listSkus, lookupStock } from "./index.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const json = JSON.parse(readFileSync(path.join(root, "..", "data", "inventory.json"), "utf8"));

describe("INVENTORY", () => {
  it("mirrors data/inventory.json exactly", () => {
    expect(data).toEqual(json);
    expect(INVENTORY).toEqual(json);
  });

  it("is deep-frozen so a caller cannot mutate the shared dataset", () => {
    expect(Object.isFrozen(INVENTORY)).toBe(true);
    expect(Object.isFrozen(INVENTORY[0])).toBe(true);
    expect(() => INVENTORY.push({})).toThrow();
    expect(() => {
      INVENTORY[0].onHand = -1;
    }).toThrow();
  });

  it("keeps available consistent with onHand - allocated for every row", () => {
    for (const row of json) {
      expect(row.available).toBe(row.onHand - row.allocated);
    }
  });

  it("does not leak the 15 August ship-hold note from an earlier draft of the dataset", () => {
    expect(json.some((row) => /15 August|15 Aug/i.test(row.notes ?? ""))).toBe(false);
  });
});

describe("listSkus", () => {
  it("includes both in-stock and discontinued SKUs, sorted by sku", () => {
    const skus = listSkus();
    expect(skus.some((s) => s.sku === "SD-X4-001")).toBe(true);
    expect(skus.some((s) => s.sku === "CL-GW-REV-C")).toBe(true);
    expect(skus.map((s) => s.sku)).toEqual([...skus.map((s) => s.sku)].sort((a, b) => a.localeCompare(b)));
  });
});

describe("lookupStock", () => {
  it("returns the single regional row for an exact sku + region match", () => {
    const result = lookupStock({ sku: "SD-X4-001", region: "Americas" });
    expect(result.asOf).toBe(DATA_AS_OF);
    expect(result.matchCount).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.suggestions).toEqual([]);
    expect(result.matches[0]).toMatchObject({ available: 22, unitListPrice: 48500 });
  });

  it("is case-insensitive on both sku and region", () => {
    expect(lookupStock({ sku: "sd-x4-001", region: "americas" }).matchCount).toBe(1);
  });

  it("does not let a caller mutate INVENTORY through a returned match", () => {
    const before = INVENTORY.find((r) => r.sku === "SD-X4-001" && r.region === "Americas").onHand;
    const result = lookupStock({ sku: "SD-X4-001", region: "Americas" });
    result.matches[0].onHand = 0;
    expect(INVENTORY.find((r) => r.sku === "SD-X4-001" && r.region === "Americas").onHand).toBe(before);
  });

  it("is deterministic across repeated calls", () => {
    const query = { sku: "SD-X4-001", region: "Americas" };
    expect(lookupStock(query)).toEqual(lookupStock(query));
  });

  it("matches a sku across every region when region is omitted", () => {
    const result = lookupStock({ sku: "CL-GW-REV-C" });
    expect(result.matchCount).toBe(3);
    expect(result.matches.every((m) => m.status === "quarantine" && m.leadTimeDays === 46)).toBe(true);
  });

  it("matches a free-text query against name/productLine, combined with a region filter", () => {
    const result = lookupStock({ query: "ServoDrive", region: "Americas" });
    expect(result.matchCount).toBeGreaterThan(0);
    expect(result.matches.every((m) => m.region === "Americas" && /servodrive/i.test(m.name + m.productLine))).toBe(
      true,
    );
  });

  it("hides discontinued rows by default and includes them with includeDiscontinued", () => {
    const hidden = lookupStock({ sku: "CL-GW-REV-A" });
    expect(hidden.matchCount).toBe(0);
    expect(hidden.suggestions).toContainEqual(expect.objectContaining({ sku: "CL-GW-REV-A", replacedBy: "CL-GW-REV-B" }));

    const shown = lookupStock({ sku: "CL-GW-REV-A", includeDiscontinued: true });
    expect(shown.matchCount).toBe(1);
    expect(shown.matches[0].replacedBy).toBe("CL-GW-REV-B");
  });

  it("suggests the exact sku when only its casing differs from the catalogue entry", () => {
    const result = lookupStock({ sku: "cl-gw-rev-a" });
    expect(result.matchCount).toBe(0);
    expect(result.suggestions[0]).toMatchObject({ sku: "CL-GW-REV-A", replacedBy: "CL-GW-REV-B" });
  });

  it("truncates an unfiltered lookup to 25 rows while still reporting the full matchCount", () => {
    const result = lookupStock({});
    expect(result.truncated).toBe(true);
    expect(result.matches).toHaveLength(25);
    expect(result.matchCount).toBeGreaterThan(25);
    expect(result.matches.every((m) => m.status !== "discontinued")).toBe(true);
  });

  it("returns empty matches plus suggestions for an unknown sku, without throwing", () => {
    expect(() => lookupStock({ sku: "ZX-NO-SUCH-SKU" })).not.toThrow();
    const result = lookupStock({ sku: "ZX-NO-SUCH-SKU" });
    expect(result).toMatchObject({ asOf: DATA_AS_OF, matchCount: 0, matches: [] });
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("returns an empty result (not an error) for a region outside Americas/EMEA/APAC", () => {
    const result = lookupStock({ sku: "SD-X4-001", region: "Mars" });
    expect(result.matchCount).toBe(0);
    expect(result.matches).toEqual([]);
  });

  it("tolerates non-object args", () => {
    expect(lookupStock(null).matchCount).toBeGreaterThan(0);
    expect(lookupStock(undefined).matchCount).toBeGreaterThan(0);
  });
});
