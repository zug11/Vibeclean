/// <reference types="vite/client" />

// Autocomplete + typing for the VITE_* vars this app reads. Optional because
// they may be unset (the client falls back to placeholders in that case).
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
