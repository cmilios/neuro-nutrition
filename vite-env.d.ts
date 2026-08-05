/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string
    readonly VITE_SUPABASE_ANON_KEY: string
    // Per-provider OAuth deployment flags: 'off' | 'verify' | 'on'.
    // Any missing, empty, or unrecognized value fails closed to 'off'.
    readonly VITE_OAUTH_GOOGLE_MODE?: string
    readonly VITE_OAUTH_APPLE_MODE?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
