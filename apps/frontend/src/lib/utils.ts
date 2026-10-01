export { cn } from "cn"

/** Narrows an unknown JSON value to a plain object - the first check of every response parser. */
export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null
}
