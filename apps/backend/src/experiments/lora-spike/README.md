# I.5 LoRA spike — Stage 1 (compatibility only)

**Temporary code. Not part of the product.** This directory exists to answer one question before
any real investment: does the full LoRA lifecycle (`@qvac/sdk`'s `finetune()` → adapter file →
`modelConfig.lora`) actually work against our real production low-tier model, Qwen3-VL-2B, on our
pinned `@qvac/sdk@0.18.2` stack?

Quality of the trained adapter is irrelevant here — the dataset is ~15 synthetic, fictional
examples (a made-up "Solstice Robotics" domain) purely to exercise the training path. Do not use
this dataset or its outputs for anything beyond this compatibility check. See
`docs/i5-lora-stage1-results.md` (repo root) for the recorded outcome once this has been run.

Does **not** touch production config (`apps/backend/src/config/models.config.ts`,
`ai/orchestrator/`, `chat.router.ts`) — this only proves the mechanism works, in isolation, the
same way `models/demo.ts` and `ai/multimodalDemo.ts` prove other pieces of the stack end-to-end
without going through the server.

## What this script does

1. Provisions Qwen3-VL-2B Q4_K (+ its mmproj vision projector) — the exact catalog entries
   `config/models.config.ts`'s `low` tier already uses.
2. Loads the base model (text-only, no projector attached for training).
3. Calls `@qvac/sdk`'s `finetune()` with a tiny synthetic SFT dataset, LoRA targeting only the
   text decoder's attention/FFN modules (there is no vision-module target in `FinetuneOptions` —
   the vision projector physically cannot be touched by this call).
4. Saves the adapter, unloads, reloads the model with `modelConfig.lora` pointed at it.
5. Runs a plain text completion (adapter, no projector) to confirm normal inference still works.
6. Reloads again with **both** `lora` and `projectionModelSrc` set, and asks about a real image
   from `corpus/pictures/` to confirm vision inference still works with the adapter loaded.

## Running it

Must run from `apps/backend` (same constraint as every other script here — `qvac.config.mjs`
resolves relative to cwd):

```bash
cd apps/backend
npx tsx src/experiments/lora-spike/spike.ts
```

Only one QVAC-backed process at a time, same constraint as `dev:server`/`serve`/other demos.
