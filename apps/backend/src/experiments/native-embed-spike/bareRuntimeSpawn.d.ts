/**
 * `bare-runtime` ships no type declarations. This repo already depends on it
 * transitively through `@qvac/sdk` (which uses the same `bare-runtime/spawn`
 * export to launch its own worker - see `node-rpc-client.js`); this shim
 * only types the handful of fields this spike's `nativeEmbedClient.ts`
 * actually passes/reads.
 */
declare module "bare-runtime/spawn" {
  import type { ChildProcess, StdioOptions } from "node:child_process";

  export interface BareSpawnOptions {
    args?: string[];
    platform?: string;
    arch?: string;
    stdio?: StdioOptions;
    suppressSignals?: boolean;
    forwardExitCode?: boolean;
  }

  export default function spawn(opts?: BareSpawnOptions): ChildProcess;
}
