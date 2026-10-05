/** `bare-runtime` ships no type declarations; this repo already depends on it transitively via `@qvac/sdk` (same `bare-runtime/spawn` export). Types only the fields `nativeEmbedClient.ts` actually uses. */
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
