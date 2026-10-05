/// <reference types="vite/client" />

// Declares which VITE_ vars exist - without this, a typo'd name still compiles but silently returns undefined (no autocomplete/warning).
interface ImportMetaEnv {
  readonly VITE_ENDPOINT_COMPLETIONS?: string
  readonly VITE_MODEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
