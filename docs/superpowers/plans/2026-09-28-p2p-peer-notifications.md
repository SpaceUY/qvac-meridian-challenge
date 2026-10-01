# P2P Peer Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show how many peers are available to delegate inference to (a badge in the engine panel, same style as "30 docs"), and notify the user via toast when the app connects to a peer, when it starts recovering from a dead peer, and how that recovery resolved.

**Architecture:** A `recovering` boolean is added to the backend's existing delegation observability (`ChatQVAC` → `AgentService.getStatus()`), riding the same `/api/chat/status` polling the frontend already does — no new endpoint. On the frontend, pure functions classify state transitions (`connected`/`recovering-started`/`reconnected`/`fell-back-to-local`) from two consecutive polls, a thin Sonner wrapper shows the toast, and a small hook wires the two together. The engine panel's peer count reads the same `delegation` data already being polled.

**Tech Stack:** TypeScript (backend: Express + LangChain `ChatQVAC`; frontend: React 19 + TanStack Query + Vitest), Sonner `2.0.8` for toasts (verified on npm — compatible with React 19 per its `peerDependencies`).

**Spec:** [docs/superpowers/specs/2026-09-28-p2p-peer-notifications-design.md](../specs/2026-09-28-p2p-peer-notifications-design.md)

## Global Constraints

- `@qvac/sdk` stays pinned to exactly `0.18.2` (root `CLAUDE.md`) — nothing in this plan touches that pin.
- Tasks 1-2 touch `qvacChatModel.ts`/`agentService.ts`, which the team's orchestrator owner maintains — coordinate before merging those two, per the spec's "Etapa 0" note.
- No automated test for a React hook or component in this plan: this repo has no existing test file for any hook or component (`ls apps/frontend/src/hooks`, `ls apps/frontend/src/components` — none end in `.test.tsx`/`.test.ts`), only for `lib/` pure functions (`citation-label.test.ts`, `chat-client.test.ts`, `voice-client.test.ts`). Tasks 4-6 follow that existing convention and say so explicitly instead of silently skipping.
- **Do not start `npm run dev:server` or `npm run dev:client` in this worktree without checking with the user first** — another Claude session is running these on `main` for its own testing, and starting a second instance risks a port conflict (both apps default to fixed ports). Every "verify it works" step in this plan uses `npm run build`/`npm run test`, never a dev server.

---

### Task 1: Backend — `recovering` flag on `ChatQVAC`

**Files:**
- Modify: `apps/backend/src/ai/orchestrator/qvacChatModel.ts:181-182` (new field), `:329-331` (new getter), `:362-371` (wrap existing body in try/finally)
- Test: `apps/backend/src/ai/orchestrator/qvacChatModel.test.ts` (two new `it`s in a new `describe` block)

**Interfaces:**
- Produces: `ChatQVAC.isRecovering(): boolean` — `true` for the duration of a delegation-recovery reload (from the moment `recoverFromDelegationFailure()` starts until it settles, success or failure), `false` otherwise.

- [ ] **Step 1: Write the failing tests**

Open `apps/backend/src/ai/orchestrator/qvacChatModel.test.ts`. Find this existing block (it ends right before `const JPEG_BYTES = new Uint8Array(...)`):

```ts
describe("ChatQVAC._streamResponseChunks delegation recovery", () => {
  it("recovers by reloading and retrying once when the provider dies before any token is streamed", async () => {
    ...
  });

  it("does not retry a genuine completion failure while streaming", async () => {
    ...
  });
});
```

Insert this new `describe` block right after it, still before `const JPEG_BYTES = ...`:

```ts
describe("ChatQVAC.isRecovering", () => {
  it("is true only while the reload triggered by delegation recovery is still in flight", async () => {
    const runtime = new RecordingModelRuntime();
    runtime.chatCompleteOutcomes = ["provider-unreachable"];
    const service = new ModelManagementService(runtime, runtime);
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };

    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
      delegate,
    });
    runtime.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    await chatModel.getDelegationInfo();
    expect(chatModel.isRecovering()).toBe(false); // nothing in flight yet

    // Freezes the reload that recovery triggers, right as ensureModel()
    // calls load() again - lets the test observe the flag mid-recovery
    // without ever letting the retry settle.
    runtime.hangLoad = true;
    void chatModel._generate([new HumanMessage("hi")], CALL_OPTIONS);

    // Enough microtask ticks for: the rejected chatComplete to propagate,
    // the catch handler to call recoverFromDelegationFailure(), and that
    // function to run past its `this.recovering = true` line. It then
    // suspends forever on the hanging reload, so this isn't a timing
    // race - once true, it stays true for the rest of the test.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(chatModel.isRecovering()).toBe(true);
  });

  it("returns to false once recovery completes successfully", async () => {
    const runtime = new RecordingModelRuntime();
    runtime.chatCompleteOutcomes = ["provider-unreachable"];
    const service = new ModelManagementService(runtime, runtime);
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };

    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
      delegate,
    });
    runtime.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    await chatModel.getDelegationInfo();

    runtime.delegationInfoResult = { isDelegated: false };
    await chatModel._generate([new HumanMessage("hi")], CALL_OPTIONS);

    expect(chatModel.isRecovering()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=apps/backend -- --run qvacChatModel`
Expected: FAIL to even compile/run — `chatModel.isRecovering` doesn't exist yet (TypeScript error: `Property 'isRecovering' does not exist on type 'ChatQVAC'`).

- [ ] **Step 3: Implement the flag**

In `apps/backend/src/ai/orchestrator/qvacChatModel.ts`, find (line 181-182):

```ts
  /** Cache backing `getCachedDelegationInfo()`, kept fresh by `getDelegationInfo()` and by `recoverFromDelegationFailure()`. */
  private delegationInfo?: LoadedModelDelegationInfo;
```

Add a new field right after it:

```ts
  /** Cache backing `getCachedDelegationInfo()`, kept fresh by `getDelegationInfo()` and by `recoverFromDelegationFailure()`. */
  private delegationInfo?: LoadedModelDelegationInfo;
  /** `true` for the duration of a `recoverFromDelegationFailure()` call - lets `AgentService.getStatus()` report "reconnecting" instead of the frontend inferring it 60s late from a state change that already finished. */
  private recovering = false;
```

Find `getCachedDelegationInfo()` (line 329-331):

```ts
  getCachedDelegationInfo(): LoadedModelDelegationInfo | undefined {
    return this.delegationInfo;
  }
```

Add a new getter right after it:

```ts
  getCachedDelegationInfo(): LoadedModelDelegationInfo | undefined {
    return this.delegationInfo;
  }

  /** Synchronous snapshot of whether a delegation-recovery reload is currently in flight. See the `recovering` field's doc comment. */
  isRecovering(): boolean {
    return this.recovering;
  }
```

Find `recoverFromDelegationFailure()` (line 362-371):

```ts
  private async recoverFromDelegationFailure(): Promise<string> {
    const staleModelId = await this.modelIdPromise;
    this.modelIdPromise = undefined;
    if (staleModelId) {
      await this.service.unloadModel(staleModelId).catch(() => {});
    }
    const modelId = await this.ensureModel();
    await this.getDelegationInfo();
    return modelId;
  }
```

Replace it with:

```ts
  private async recoverFromDelegationFailure(): Promise<string> {
    this.recovering = true;
    try {
      const staleModelId = await this.modelIdPromise;
      this.modelIdPromise = undefined;
      if (staleModelId) {
        await this.service.unloadModel(staleModelId).catch(() => {});
      }
      const modelId = await this.ensureModel();
      await this.getDelegationInfo();
      return modelId;
    } finally {
      this.recovering = false;
    }
  }
```

`finally` (not just clearing the flag after `return`) is what guarantees the flag comes back down even if `ensureModel()` itself throws (fails to load locally too) — a plain `return` statement after a thrown error never executes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --workspace=apps/backend -- --run qvacChatModel`
Expected: PASS, including the two new tests.

- [ ] **Step 5: Run the full backend suite to check nothing else broke**

Run: `npm run test --workspace=apps/backend -- --run`
Expected: PASS (261 + 2 new = 263 passed, 2 skipped, matching the pre-existing 261/2 baseline plus these two).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/ai/orchestrator/qvacChatModel.ts apps/backend/src/ai/orchestrator/qvacChatModel.test.ts
git commit -m "feat(orchestrator): expose isRecovering() during delegation recovery"
```

---

### Task 2: Backend — expose `recovering` via `AgentService.getStatus()`

**Files:**
- Modify: `apps/backend/src/ai/orchestrator/agentService.ts:27-33` (interface), `:129-136` (`getStatus()`)
- Test: `apps/backend/src/ai/orchestrator/agentService.delegate.test.ts` (one new `it`)

**Interfaces:**
- Consumes: `ChatQVAC.isRecovering()` (Task 1).
- Produces: `AgentStatusPayload.recovering: boolean` (always present, never optional) — flows through unchanged to `GET /api/chat/status`'s JSON body (`chat.router.ts` already does `res.json(agentService.getStatus())`, no router change needed).

- [ ] **Step 1: Write the failing test**

Open `apps/backend/src/ai/orchestrator/agentService.delegate.test.ts`. Add this `it` inside the existing `describe("AgentService delegate wiring", ...)` block, after the last one (`"refreshes status once the model recovers from a dead provider mid-session"`):

```ts
  it("reports recovering:false once the model has settled (not stuck mid-recovery)", async () => {
    const runtime = new RecordingModelRuntime();
    runtime.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    const agentService = await buildAgentService(runtime);
    await agentService.preload();

    expect(agentService.getStatus().recovering).toBe(false);

    runtime.chatCompleteOutcomes = ["provider-unreachable"];
    runtime.delegationInfoResult = { isDelegated: false };
    await agentService.invoke([{ role: "user", message: "hi" }]);

    expect(agentService.getStatus().recovering).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/backend -- --run agentService.delegate`
Expected: FAIL — `Property 'recovering' does not exist` (TypeScript) once `AgentStatusPayload` is checked, or `undefined` is not `false` if TS allows the read; either way the assertion fails today since nothing sets it.

- [ ] **Step 3: Implement**

In `apps/backend/src/ai/orchestrator/agentService.ts`, find (line 27-33):

```ts
export interface AgentStatusPayload {
  status: AgentStatus;
  error?: string;
  model: { name: string; quantization: string };
  /** Present once known (after a successful `preload()`) - whether the chat model is running on a remote provider or locally. Absent while idle/loading/error, or if delegation status couldn't be confirmed. */
  delegation?: LoadedModelDelegationInfo;
}
```

Replace it with:

```ts
export interface AgentStatusPayload {
  status: AgentStatus;
  error?: string;
  model: { name: string; quantization: string };
  /** Present once known (after a successful `preload()`) - whether the chat model is running on a remote provider or locally. Absent while idle/loading/error, or if delegation status couldn't be confirmed. */
  delegation?: LoadedModelDelegationInfo;
  /** Whether a delegation-recovery reload is in flight right now (see `ChatQVAC.isRecovering()`). Always present (never `undefined`) - simpler for the frontend to read than a third "unknown" state, and it's meaningfully `false` even when no delegate is configured at all. */
  recovering: boolean;
}
```

Find `getStatus()` (line 129-136):

```ts
  getStatus(): AgentStatusPayload {
    const delegation = this.chatModel.getCachedDelegationInfo();
    return {
      status: this.status,
      ...(this.statusError ? { error: this.statusError } : {}),
      model: this.modelInfo,
      ...(delegation ? { delegation } : {}),
    };
  }
```

Replace it with:

```ts
  getStatus(): AgentStatusPayload {
    const delegation = this.chatModel.getCachedDelegationInfo();
    return {
      status: this.status,
      ...(this.statusError ? { error: this.statusError } : {}),
      model: this.modelInfo,
      ...(delegation ? { delegation } : {}),
      recovering: this.chatModel.isRecovering(),
    };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/backend -- --run agentService.delegate`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite**

Run: `npm run test --workspace=apps/backend -- --run`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/ai/orchestrator/agentService.ts apps/backend/src/ai/orchestrator/agentService.delegate.test.ts
git commit -m "feat(orchestrator): surface recovering in GET /api/chat/status"
```

---

### Task 3: Frontend — `lib/peers.ts` (pure peer-state logic)

**Files:**
- Create: `apps/frontend/src/lib/peers.ts`
- Test: `apps/frontend/src/lib/peers.test.ts`

**Interfaces:**
- Consumes: `DelegationInfo` (already exists, `apps/frontend/src/lib/model-status-client.ts`: `{ isDelegated: boolean; providerPublicKey?: string }`).
- Produces:
  - `type DelegationSnapshot = { isDelegated: boolean; recovering: boolean }`
  - `type DelegationEvent = 'connected' | 'recovering-started' | 'reconnected' | 'fell-back-to-local'`
  - `countAvailablePeers(delegation: DelegationInfo | undefined): number`
  - `classifyDelegationTransition(previous: DelegationSnapshot | undefined, current: DelegationSnapshot): DelegationEvent | null`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/lib/peers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { countAvailablePeers, classifyDelegationTransition } from '@/lib/peers'

describe('countAvailablePeers', () => {
  it('is 1 when delegated', () => {
    expect(countAvailablePeers({ isDelegated: true, providerPublicKey: 'pk-abc' })).toBe(1)
  })

  it('is 0 when not delegated or unknown', () => {
    expect(countAvailablePeers({ isDelegated: false })).toBe(0)
    expect(countAvailablePeers(undefined)).toBe(0)
  })
})

describe('classifyDelegationTransition', () => {
  it('is null when there is no previous snapshot to compare against', () => {
    expect(classifyDelegationTransition(undefined, { isDelegated: true, recovering: false })).toBeNull()
  })

  it('is null when nothing changed', () => {
    const snapshot = { isDelegated: true, recovering: false }
    expect(classifyDelegationTransition(snapshot, snapshot)).toBeNull()
  })

  it('reports "connected" when delegation turns on', () => {
    const previous = { isDelegated: false, recovering: false }
    const current = { isDelegated: true, recovering: false }
    expect(classifyDelegationTransition(previous, current)).toBe('connected')
  })

  it('reports "recovering-started" when recovery kicks in', () => {
    const previous = { isDelegated: true, recovering: false }
    const current = { isDelegated: true, recovering: true }
    expect(classifyDelegationTransition(previous, current)).toBe('recovering-started')
  })

  it('reports "reconnected" when recovery ends back on the peer', () => {
    const previous = { isDelegated: true, recovering: true }
    const current = { isDelegated: true, recovering: false }
    expect(classifyDelegationTransition(previous, current)).toBe('reconnected')
  })

  it('reports "fell-back-to-local" when recovery ends running locally', () => {
    const previous = { isDelegated: true, recovering: true }
    const current = { isDelegated: false, recovering: false }
    expect(classifyDelegationTransition(previous, current)).toBe('fell-back-to-local')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/frontend -- --run peers`
Expected: FAIL — `Cannot find module '@/lib/peers'`.

- [ ] **Step 3: Implement**

Create `apps/frontend/src/lib/peers.ts`:

```ts
import type { DelegationInfo } from '@/lib/model-status-client'

/** A comparable snapshot of delegation state at one point in time - what `classifyDelegationTransition` diffs against the previous one. */
export type DelegationSnapshot = { isDelegated: boolean; recovering: boolean }

/** The one thing that changed between two consecutive `DelegationSnapshot`s, or `null` if nothing did. */
export type DelegationEvent = 'connected' | 'recovering-started' | 'reconnected' | 'fell-back-to-local'

/** How many peers are available to delegate inference to right now. Today the backend only supports one configured peer, so this is always 0 or 1 - kept as a count (not a boolean) so the badge doesn't need to change the day the backend supports more than one. */
export function countAvailablePeers(delegation: DelegationInfo | undefined): number {
  return delegation?.isDelegated ? 1 : 0
}

/**
 * Compares two `DelegationSnapshot`s and says which single transition (if
 * any) just happened. `previous` is `undefined` on the very first snapshot
 * (nothing to compare against yet) - this deliberately reports `null`
 * rather than `'connected'` in that case, so reloading the page while
 * already delegated doesn't fire a false "just connected" notification.
 */
export function classifyDelegationTransition(
  previous: DelegationSnapshot | undefined,
  current: DelegationSnapshot,
): DelegationEvent | null {
  if (!previous) return null
  if (!previous.isDelegated && current.isDelegated && !current.recovering) return 'connected'
  if (!previous.recovering && current.recovering) return 'recovering-started'
  if (previous.recovering && !current.recovering) {
    return current.isDelegated ? 'reconnected' : 'fell-back-to-local'
  }
  return null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/frontend -- --run peers`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/peers.ts apps/frontend/src/lib/peers.test.ts
git commit -m "feat(frontend): add pure peer-count and delegation-transition logic"
```

---

### Task 4: Frontend — Sonner + notification copy + notifier

**Files:**
- Modify: `apps/frontend/package.json` (add `sonner` dependency)
- Create: `apps/frontend/src/lib/peer-notification-copy.ts`
- Create: `apps/frontend/src/lib/notifier.ts`

**Interfaces:**
- Consumes: `DelegationEvent` (Task 3).
- Produces:
  - `type NotificationSeverity = 'success' | 'warning' | 'error'`
  - `messageFor(event: DelegationEvent): { severity: NotificationSeverity; message: string }`
  - `notifySuccess(message: string): void`, `notifyWarning(message: string): void`, `notifyError(message: string): void`

**No automated test in this task** — `messageFor` is a static, type-exhaustive `switch` with no branch that can silently go wrong (TypeScript itself refuses to compile a non-exhaustive switch over a string-literal union), and `notifier.ts` is a one-line-per-function wrapper over an external library, the same kind of thin glue `model-status-client.ts`'s fetch wrappers already ship without a test file. Verified instead by the type-check in Step 4.

- [ ] **Step 1: Install Sonner**

Run: `npm install sonner@2.0.8 --workspace=apps/frontend`

This adds `"sonner": "2.0.8"` under `dependencies` in `apps/frontend/package.json` (version verified directly on npm — compatible with React 19 per its own `peerDependencies`, not guessed).

- [ ] **Step 2: Create the copy module**

Create `apps/frontend/src/lib/peer-notification-copy.ts`:

```ts
import type { DelegationEvent } from '@/lib/peers'

/** Which Sonner toast variant a notification should use. */
export type NotificationSeverity = 'success' | 'warning' | 'error'

/** Translates a delegation-state transition into the toast text and severity to show for it. Knows nothing about Sonner or React - just a lookup table. */
export function messageFor(event: DelegationEvent): { severity: NotificationSeverity; message: string } {
  switch (event) {
    case 'connected':
      return { severity: 'success', message: 'Connected to a peer — inference running remotely' }
    case 'recovering-started':
      return { severity: 'warning', message: 'Peer down — trying to reconnect…' }
    case 'reconnected':
      return { severity: 'success', message: 'Reconnected to peer' }
    case 'fell-back-to-local':
      return { severity: 'error', message: "Couldn't reconnect — now running locally" }
  }
}
```

- [ ] **Step 3: Create the notifier**

Create `apps/frontend/src/lib/notifier.ts`:

```ts
import { toast } from 'sonner'

/** Thin wrapper over Sonner - the only file that imports it. Knows nothing about peers or delegation; just shows a toast of the given severity. */
export function notifySuccess(message: string): void {
  toast.success(message)
}

export function notifyWarning(message: string): void {
  toast.warning(message)
}

export function notifyError(message: string): void {
  toast.error(message)
}
```

- [ ] **Step 4: Type-check to verify both files compile and the switch is exhaustive**

Run: `npm run build --workspace=apps/frontend`
Expected: builds cleanly. If a case were missing from `messageFor`'s `switch`, this step fails with "Function lacks ending return statement" — that's the safety net replacing a dedicated test here.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/package.json package-lock.json apps/frontend/src/lib/peer-notification-copy.ts apps/frontend/src/lib/notifier.ts
git commit -m "feat(frontend): add Sonner, peer notification copy and notifier wrapper"
```

(`package-lock.json` lives at the repo root in this npm-workspaces monorepo, not inside `apps/frontend/` — confirmed by `ls` in this worktree before writing this task.)

---

### Task 5: Frontend — `hooks/use-delegation-notifications.ts`

**Files:**
- Create: `apps/frontend/src/hooks/use-delegation-notifications.ts`

**Interfaces:**
- Consumes: `DelegationSnapshot`, `classifyDelegationTransition` (Task 3); `NotificationSeverity`, `messageFor` (Task 4); `notifySuccess`, `notifyWarning`, `notifyError` (Task 4).
- Produces: `useDelegationNotifications(snapshot: DelegationSnapshot): void` — call once per app instance with the latest polled snapshot; it tracks the previous snapshot internally and fires the right toast on a transition.

**No automated test in this task** — this repo has no test file for any hook (see Global Constraints), and the hook has no logic of its own beyond wiring already-tested pure functions (Task 3) to already-verified notifier calls (Task 4) through a `useRef`/`useEffect`. Verified instead by the type-check in Step 2 and the end-to-end check in Task 6.

- [ ] **Step 1: Implement**

Create `apps/frontend/src/hooks/use-delegation-notifications.ts`:

```ts
import { useEffect, useRef } from 'react'
import { classifyDelegationTransition, type DelegationSnapshot } from '@/lib/peers'
import { messageFor, type NotificationSeverity } from '@/lib/peer-notification-copy'
import { notifySuccess, notifyWarning, notifyError } from '@/lib/notifier'

const SEVERITY_NOTIFIERS: Record<NotificationSeverity, (message: string) => void> = {
  success: notifySuccess,
  warning: notifyWarning,
  error: notifyError,
}

/** Watches the polled delegation snapshot and fires the matching toast whenever it transitions (connect, recovery starting, recovery resolving) - never on every poll, only on an actual change. Call once, at the top of the app, with the latest snapshot from `useModelStatus()`. */
export function useDelegationNotifications(snapshot: DelegationSnapshot): void {
  const previousRef = useRef<DelegationSnapshot | undefined>(undefined)

  useEffect(() => {
    const event = classifyDelegationTransition(previousRef.current, snapshot)
    if (event) {
      const { severity, message } = messageFor(event)
      SEVERITY_NOTIFIERS[severity](message)
    }
    previousRef.current = snapshot
  }, [snapshot.isDelegated, snapshot.recovering])
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build --workspace=apps/frontend`
Expected: builds cleanly.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/hooks/use-delegation-notifications.ts
git commit -m "feat(frontend): add useDelegationNotifications hook"
```

---

### Task 6: Frontend — wire `recovering` + the peers badge through the app

**Files:**
- Modify: `apps/frontend/src/lib/model-status-client.ts` (full current content shown below)
- Modify: `apps/frontend/src/hooks/use-model-status.ts` (full current content shown below)
- Modify: `apps/frontend/src/components/engine-panel.tsx` (full current content shown below)
- Modify: `apps/frontend/src/App.tsx` (full current content shown below)

**Interfaces:**
- Consumes: `AgentStatusPayload.recovering` from `GET /api/chat/status` (Task 2); `countAvailablePeers` (Task 3); `useDelegationNotifications` (Task 5).
- Produces: nothing further downstream — this is the integration point.

**No automated test in this task** — same reasoning as Tasks 4-5 (no component/hook tests in this repo). Verified by the type-check in Step 5. A manual browser check is valuable here but **must not start a dev server without first checking with the user** (Global Constraints) — offer it as a follow-up once this task is committed, don't do it as part of the task.

- [ ] **Step 1: Add `recovering` to the status response type**

In `apps/frontend/src/lib/model-status-client.ts`, find:

```ts
export type ModelStatusResponse = { status: ModelStatus; error?: string; model: ModelInfo; delegation?: DelegationInfo }
```

Replace it with:

```ts
export type ModelStatusResponse = {
  status: ModelStatus
  error?: string
  model: ModelInfo
  delegation?: DelegationInfo
  recovering: boolean
}
```

- [ ] **Step 2: Return `recovering` from `useModelStatus`**

In `apps/frontend/src/hooks/use-model-status.ts`, find the return type declaration:

```ts
export function useModelStatus(): {
  status: ModelStatus
  error?: string
  model?: ModelInfo
  delegation?: DelegationInfo
  /** True once the user has cancelled a load and hasn't asked to retry yet - lets the UI say "cancelled" instead of "starting". */
  cancelled: boolean
  cancelLoad: () => void
  retryLoad: () => void
} {
```

Replace it with:

```ts
export function useModelStatus(): {
  status: ModelStatus
  error?: string
  model?: ModelInfo
  delegation?: DelegationInfo
  /** Whether a delegation-recovery reload is in flight right now (see `AgentStatusPayload.recovering` on the backend). `false` until the first poll resolves. */
  recovering: boolean
  /** True once the user has cancelled a load and hasn't asked to retry yet - lets the UI say "cancelled" instead of "starting". */
  cancelled: boolean
  cancelLoad: () => void
  retryLoad: () => void
} {
```

Then find the two `return` statements later in the same function:

```ts
  if (query.isError) {
    return {
      status: 'error',
      error: 'could not reach the server',
      cancelled,
      cancelLoad: () => cancelLoadMutation.mutate(),
      retryLoad,
    }
  }

  return {
    status: query.data?.status ?? 'idle',
    error: query.data?.error,
    model: query.data?.model,
    delegation: query.data?.delegation,
    cancelled,
    cancelLoad: () => cancelLoadMutation.mutate(),
    retryLoad,
  }
```

Replace both with:

```ts
  if (query.isError) {
    return {
      status: 'error',
      error: 'could not reach the server',
      recovering: false,
      cancelled,
      cancelLoad: () => cancelLoadMutation.mutate(),
      retryLoad,
    }
  }

  return {
    status: query.data?.status ?? 'idle',
    error: query.data?.error,
    model: query.data?.model,
    delegation: query.data?.delegation,
    recovering: query.data?.recovering ?? false,
    cancelled,
    cancelLoad: () => cancelLoadMutation.mutate(),
    retryLoad,
  }
```

- [ ] **Step 3: Add the peers badge to `EnginePanel`**

In `apps/frontend/src/components/engine-panel.tsx`, add the import (alongside the existing ones):

```tsx
import { Badge } from '@/components/ui/badge'
import { countAvailablePeers } from '@/lib/peers'
```

Find:

```tsx
        </div>
        <p className="mt-1 text-muted-foreground">{subtitle}</p>
      </Section>

      <Separator />
      <Section title="Chat model">
```

Replace it with:

```tsx
        </div>
        <p className="mt-1 text-muted-foreground">{subtitle}</p>
      </Section>

      <Section title="Peers">
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-muted-foreground">Peers available</span>
          <Badge variant="secondary">{countAvailablePeers(delegation)}</Badge>
        </div>
      </Section>

      <Separator />
      <Section title="Chat model">
```

This uses the same `Badge` component and `variant="secondary"` that `corpus-dialog.tsx` already uses for "30 docs" — same visual language, no new styling.

- [ ] **Step 4: Mount the toaster and the notification hook in `App.tsx`**

Replace the full contents of `apps/frontend/src/App.tsx` with:

```tsx
import { Toaster } from 'sonner'
import { AppShell } from '@/components/app-shell'
import { ChatPanel } from '@/components/chat-panel'
import { CorpusDialog } from '@/components/corpus-dialog'
import { EnginePanel } from '@/components/engine-panel'
import { NewChatButton } from '@/components/new-chat-button'
import { Separator } from '@/components/ui/separator'
import { useModelStatus } from '@/hooks/use-model-status'
import { useDelegationNotifications } from '@/hooks/use-delegation-notifications'

export default function App() {
  const modelStatus = useModelStatus()
  useDelegationNotifications({
    isDelegated: modelStatus.delegation?.isDelegated ?? false,
    recovering: modelStatus.recovering,
  })
  return (
    <>
      <Toaster position="top-center" richColors />
      <AppShell
        leftSidebar={
          <div className="flex flex-col gap-3">
            <NewChatButton />
            <CorpusDialog />
            <Separator />
            <EnginePanel
              model={modelStatus.model}
              modelStatus={modelStatus.status}
              statusError={modelStatus.error}
              delegation={modelStatus.delegation}
              cancelled={modelStatus.cancelled}
              onCancelLoad={modelStatus.cancelLoad}
              onRetryLoad={modelStatus.retryLoad}
            />
          </div>
        }
      >
        <ChatPanel modelStatus={modelStatus.status} modelCancelled={modelStatus.cancelled} />
      </AppShell>
    </>
  )
}
```

`richColors` on `<Toaster />` is what makes `toast.success`/`.warning`/`.error` render in green/amber/red instead of Sonner's neutral default — needed for the color distinction the spec asks for between the three notification kinds.

- [ ] **Step 5: Type-check and run the full frontend suite**

Run: `npm run build --workspace=apps/frontend && npm run test --workspace=apps/frontend -- --run`
Expected: build succeeds, all tests pass (9 pre-existing + 8 from Task 3 = 17).

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/lib/model-status-client.ts apps/frontend/src/hooks/use-model-status.ts apps/frontend/src/components/engine-panel.tsx apps/frontend/src/App.tsx
git commit -m "feat(frontend): show peers available and wire delegation toasts into the app"
```

---

## After Task 6

All six tasks are committed on `feat/p2p-peer-notifications`. Before opening a PR:
- Confirm with the user whether it's safe to start `npm run dev:client`/`dev:server` in this worktree yet (Global Constraints) for a manual pass through the four cases in the spec's "Flujo de datos, de punta a punta" section.
- Flag Task 1-2's diff to the orchestrator owner before merging, per the spec's "Etapa 0" note.
