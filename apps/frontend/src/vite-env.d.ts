/// <reference types="vite/client" />

// We declare to TypeScript which VITE_ variables exist. Without this,
// import.meta.env.VITE_MODEL still compiles, but with no autocomplete and no
// warning if you typo the name: it would silently return undefined.
interface ImportMetaEnv {
  readonly VITE_ENDPOINT_COMPLETIONS?: string
  readonly VITE_MODEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
