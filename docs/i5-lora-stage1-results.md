# I.5 LoRA — Stage 1 compatibility spike: results

**Date:** 2026-09-28
**Branch:** `feat/i5-lora-spike`
**Script:** `apps/backend/src/experiments/lora-spike/spike.ts` (throwaway, see its README)
**Verdict: LoRA fine-tuning is currently blocked for the production Qwen3-VL-2B model with the required QVAC SDK stack.**

Production RAG/API was not touched — this was entirely an isolated spike (provision/load/train/verify
scripts only, no changes to `config/models.config.ts`, `ai/orchestrator/`, or `chat.router.ts`).

## Summary

Four full attempts were run. Every one failed, for three distinct, independently-diagnosed reasons —
two clean SDK-level rejections specific to our production model, and one native crash on QVAC's own
documented control model:

| # | Model | Quantization | Result |
|---|---|---|---|
| 1 | Qwen3-VL-2B (production) | Q4_K_M (catalog default) | `finetune()` rejects the quantization outright |
| 2 | Qwen3-VL-2B (production) | Q8_0 (same HF repo, finetune-supported quant) | `finetune()` rejects the **architecture** outright |
| 3 | Qwen3-0.6B (control) | Q4_0 (QVAC's own documented example) | Training starts and runs correctly, then the native worker **crashes** at step 44/1920 |
| 4 | Qwen3-0.6B (control), repeat | Q4_0 | **Identical crash, identical step, identical loss curve** — fully reproducible |

No LoRA adapter file was produced in any run, so step 4 of the original plan (verify `modelConfig.lora`
loading + text/vision inference) could not be exercised — there was nothing to load.

## Finding 1 — Sandboxed subprocess spawning blocks the QVAC worker (environmental, not QVAC's issue)

First attempt failed immediately with:
```
RPC_INIT_TIMEOUT: RPC initialization timed out after 30000ms — the worker process may have failed to start
```
This happened before any model-specific code ran — the underlying Bare worker process never started.
Resolved by running with sandbox subprocess restrictions disabled; the worker started and produced
normal `[sdk:client]`/`[sdk:server]` logs on the next attempt. **Not a LoRA or QVAC compatibility
issue** — purely an artifact of running inside a sandboxed shell that restricts child-process spawning.
Noted here only so it isn't mistaken for a QVAC bug if this spike is re-run elsewhere.

## Finding 2 — `finetune()` rejects our production quantization (Q4_K_M)

`LLM_MODELS_BY_TIER.low` (`apps/backend/src/config/models.config.ts:135-146`) loads
`Qwen3VL-2B-Instruct-Q4_K_M.gguf`. Calling `finetune()` against a model loaded from that exact
catalog entry fails in <1 second with:

```
RPCError: Finetuning is not supported for this quantization type (file_type=15).
Supported: F32, F16, Q4_0, Q8_0, TQ1_0, TQ2_0
```

Q4_K_M ("K-quant", file_type=15) is simply not on the supported list. This directly confirms a risk
flagged in the earlier I.5 technical assessment (§12.2, "GGUF quantization + training interaction
unconfirmed") — it is real, and it is confirmed on the exact model our product serves.

**This alone would not be fatal** — the same HuggingFace repo (`Qwen/Qwen3-VL-2B-Instruct-GGUF`)
also publishes a Q8_0 build of the identical base model, which is on the supported list. The plan
was: train against Q8_0, then load the resulting adapter against the real production Q4_K_M model at
serve time (LoRA adapters are architecture/shape-bound, not precision-bound, so this should work in
principle). That plan hit Finding 3 before it could be tested.

## Finding 3 — `finetune()` rejects the `qwen3vl` architecture entirely (the real blocker)

Loading the Q8_0 build of Qwen3-VL-2B (same repo, finetune-supported quantization) and calling
`finetune()` fails again, in ~1ms — instant enough that this is clearly an early architecture
allowlist check, not a training failure:

```
RPCError: Finetuning is not supported for architecture: qwen3vl
```

This is decisive: **there is no quantization workaround.** `@qvac/llm-llamacpp@0.45.0`'s finetune
path does not support the Qwen3-VL architecture family at all, regardless of precision. This directly
answers the open question from the earlier I.5 assessment (§4/§12.1): whether `finetune()` had been
validated against a VLM checkpoint. It has not — it is explicitly blocked. This is consistent with
every finetuning example and showcase documented in `@qvac/llm-llamacpp`'s own README being built
around plain-text models (Qwen3-0.6B), never a vision-language variant.

**Practical conclusion: our actual production low-tier model (Qwen3-VL-2B, in any quantization) cannot
be LoRA-finetuned with the current `@qvac/sdk@0.18.2` / `@qvac/llm-llamacpp@0.45.0` stack, full stop.**

## Finding 4 — the control model trains correctly, then the native worker crashes (reproducibly)

Since production's architecture is blocked outright, the control run (Qwen3-0.6B Q4_0 — supported on
both quantization and architecture, exactly QVAC's own documented example) became the only way to
verify the rest of the pipeline (my dataset schema, hyperparameters, and script) was even correct.

It was. Real training started and ran cleanly for 44 steps with a normal, monotonically-decreasing
SFT loss curve (excerpt):

```
step=12  loss=0.6691
step=20  loss=0.6686
step=30  loss=0.4457
step=40  loss=0.3343
step=44  loss=0.3039
```

Then, both times, at the exact same step:

```
[sdk:client] 🪦 Bare worker exited post-handshake (code=3221226505, signal=null)
```

`3221226505` = `0xC0000409` = Windows `STATUS_STACK_BUFFER_OVERRUN` — a native crash (stack-cookie
violation), not a clean error. The crash was run twice from a cold state (fresh process each time) and
produced **byte-identical loss values at every step and failed at the identical step (44/1920)** —
this is a deterministic bug triggered by something specific in the training path (likely a particular
token window from the SFT dataset's chunking, given `total_batches=1920` for a 15-example dataset
implies the SFT builder splits the tokenized JSONL into many more windows than raw examples — see
"Dataset format" below), not a flaky hardware/memory fluke. No crash dump or additional diagnostic was
recoverable from outside the native binary.

Since the process crashes before `finetune()`'s promise ever resolves, no adapter file is written —
`outputParametersDir` and `checkpointSaveDir` are both empty after every run.

**This means even a fully-supported model+quantization combination is not currently stable on this
exact platform** (Windows x64, CPU device, 8-core, 32GB RAM, AMD GPU present but not used — see
Hardware below). Whether this is Windows-specific, CPU-device-specific, or a universal bug in this
SDK version is **not established** by this spike — only tested on one platform/device combination.

## Recorded diagnostics

**Hardware:** Windows 10, Intel i7-9700K, 8 cores, 32GB RAM, AMD Radeon RX 6600 (no NVIDIA GPU — no
CUDA path available; training was forced to `device: 'cpu'` throughout to isolate the LoRA
compatibility question from GPU-backend variability, so **GPU training was never exercised**).

**Hyperparameters used (Stage 1 spike, quality irrelevant by design):** `loraRank=8`, `loraAlpha=16`,
`numberOfEpochs=3`, `learningRate=1e-4`, `contextLength=1024`, `batchSize=8`, `microBatchSize=8`,
`assistantLossOnly=true`, `loraModules='attn_q,attn_k,attn_v,attn_o,ffn_gate,ffn_up,ffn_down'`
(text-decoder only — no vision-module target exists in `FinetuneOptions`, so the vision projector was
never touched by any of these runs, satisfying the "do not fine-tune the vision projector" constraint
by construction).

**Dataset format (confirmed empirically, was previously only inferred from headers):** JSONL, one
chat conversation per line: `{"messages":[{"role":"system"|"user"|"assistant","content":"..."}]}`.
This is confirmed correct — training actually ran and loss actually decreased against it. 15 synthetic
examples (fictional "Solstice Robotics" domain — see `dataset.jsonl` in the spike directory), none
touching real Meridian data.

**Timings (successful steps only):**

| Step | Time |
|---|---|
| Provision Qwen3-VL-2B Q4_K_M (~1.1GB) | 180s |
| Provision Qwen3-VL-2B mmproj (~445MB) | 65s |
| Provision Qwen3-VL-2B Q8_0 (~1.75GB) | 190s |
| Provision Qwen3-0.6B Q4_0 (~382MB, first run) | 53s |
| Load any of the above into memory (CPU) | 1.3–9.2s |
| Control training, 44 steps before crash | ~55s wall clock (not a full-run measurement — crashed early) |

Adapter size, full training time, and RAM/VRAM delta for a *completed* run could not be recorded —
no run ever completed.

**Errors/warnings, verbatim, for traceability:**
- `RPC_INIT_TIMEOUT: RPC initialization timed out after 30000ms` (Finding 1, environmental)
- `Finetuning is not supported for this quantization type (file_type=15). Supported: F32, F16, Q4_0, Q8_0, TQ1_0, TQ2_0` (Finding 2)
- `Finetuning is not supported for architecture: qwen3vl` (Finding 3)
- `Bare worker exited post-handshake (code=3221226505, signal=null)`, reproduced twice (Finding 4)

## What this means for I.5

**Current evidence is not strong enough to claim Challenge Improvement I.5**, and per your explicit
Stage 2 gate ("only if Stage 1 passes"), Stage 2 (benchmark baseline, training-set design, before/after
report) was **not started**. Claiming I.5 today would require either fabricating results or applying
LoRA to a model other than the one actually in production — both excluded by your instructions.

The production-model blocker is confirmed at the current QVAC SDK/llama.cpp integration layer. The
separate control-model crash remains platform/runtime-specific until reproduced elsewhere. Neither is
this repo's architecture: the `engineConfig.lora` plumbing this repo already has (confirmed in the
earlier technical assessment) was never even reached — every failure happened inside `finetune()`
itself, before there was any adapter to load.

## Recommended next steps (menu, not a decision)

1. **Ask the QVAC team directly** (this was already flagged as an open question in the earlier
   assessment, now sharpened by real evidence):
   - Is Qwen3-VL (or VLM architectures generally) on any roadmap for `finetune()` support?
   - Is the Windows/CPU `STATUS_STACK_BUFFER_OVERRUN` crash on Qwen3-0.6B a known issue? Is there a
     patched `@qvac/llm-llamacpp` version, or is CPU-device training simply not production-ready on
     Windows yet?
   - Is there a recommended platform/device (Linux/macOS, or GPU-backed training) for `finetune()`
     today?
2. **Re-run this exact spike on a different platform/device** if one becomes available (Linux or
   macOS, and/or an NVIDIA GPU with CUDA) to determine whether Finding 4's crash is Windows/CPU-specific
   or universal to this SDK version. The script (`spike.ts`) and dataset are fully reusable as-is —
   this is a same-day re-check, not new work, if a different machine is available.
3. **Watch for an `@qvac/sdk` version bump.** If a future release adds `qwen3vl` to the finetune
   architecture allowlist and/or fixes the native crash, re-running this spike is the fast way to
   re-validate before resuming Stage 2.
4. **Do not silently swap the production model** to unblock this (explicitly excluded by your
   instructions) — if a text-only sibling architecture were ever considered for the low tier, that is
   a product decision to make deliberately, not a side effect of a LoRA experiment, and it would still
   need Finding 4's crash resolved independently since that hit the *architecture-supported* control
   model too.

## Files added by this spike (all on `feat/i5-lora-spike`, not merged/touching production)

- `apps/backend/src/experiments/lora-spike/README.md` — spike scope/instructions
- `apps/backend/src/experiments/lora-spike/dataset.jsonl` — 15 synthetic training examples
- `apps/backend/src/experiments/lora-spike/spike.ts` — the spike script itself (reusable for re-checks)
- `docs/i5-lora-stage1-results.md` — this file
- `docs/meridian-benchmark-215-en.md` — English-normalized 215-question benchmark (Stage 2 held-out
  set, prepared ahead of time; not used for anything yet since Stage 2 did not start)
