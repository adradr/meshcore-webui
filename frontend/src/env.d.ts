/// <reference types="vite/client" />

declare module "@fontsource-variable/*"

interface ImportMetaEnv {
  readonly VITE_VAPID_PUBLIC_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
