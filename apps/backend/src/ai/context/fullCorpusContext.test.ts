import { describe, expect, it } from "vitest";
import { loadCorpusContext } from "./corpusContext.js";

describe("loadCorpusContext", () => {
  it("includes text file content labeled with its relative corpus path", async () => {
    const context = await loadCorpusContext();

    expect(context).toContain("policies/warranty-terms.md");
    expect(context).toContain("Standard warranty");
  });

  it("excludes binary image files", async () => {
    const context = await loadCorpusContext();

    expect(context).not.toContain("pic1.jpeg");
    expect(context).not.toContain("pic2.png");
  });
});
