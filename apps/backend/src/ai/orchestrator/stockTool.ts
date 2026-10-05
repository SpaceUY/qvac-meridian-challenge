import * as z from "zod";
import { tool } from "@langchain/core/tools";
import { DATA_AS_OF, lookupStock } from "meridian-stock-tool";

export const lookupStockTool = tool(
  // The first argument is the function implementation.
  // It takes an empty object argument because of the Zod schema definition.
  (args) => lookupStock(args),
  {
    name: "lookup_stock",
    description:
      `Meridian inventory as of ${DATA_AS_OF}. Returns structured stock records only. ` +
      "An unknown SKU returns no matches plus suggestions — do not invent stock or prices.",
    schema: z.object({
      sku: z.string().optional().describe("Exact SKU, e.g. SD-X4-001"),
      query: z
        .string()
        .optional()
        .describe("Free-text search against name or product line"),
      region: z.enum(["Americas", "EMEA", "APAC"]).optional(),
      includeDiscontinued: z.boolean().optional(),
    }),
  },
);
