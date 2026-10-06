import type { SessionCacheEntry } from "./types.js";

/** Lists every session KV cache that currently exists. Implemented over the filesystem today because `@qvac/sdk` has no list API. */
export interface SessionCacheInventoryPort {
  list(): Promise<SessionCacheEntry[]>;
}

/** Same shape as `AgentService.deleteSessionCache`, so the sweeper deletes through the exact path "New chat" uses. */
export interface SessionCacheRemover {
  deleteSessionCache(sessionId: string): Promise<void>;
}
