/**
 * Wire a service worker so `skipWaiting()` fires only on an explicit
 * `{ type: "SKIP_WAITING" }` message from the page.
 *
 * Why: calling `self.skipWaiting()` at install time silently swaps the
 * SW under every open tab. That turns a supply-chain SW compromise into
 * an instant takeover. Gating it behind a user-confirmation message
 * keeps the user in control of when a new SW takes over.
 *
 * The corresponding page-side post comes from workbox-window's
 * `messageSkipWaiting()` (used by `vite-plugin-pwa`'s `useRegisterSW`
 * when the user clicks the reload prompt). Its payload is exactly
 * `{ type: "SKIP_WAITING" }`.
 */
export function installSkipWaitingGate(sw: ServiceWorkerGlobalScope): void {
  sw.addEventListener("message", (event: ExtendableMessageEvent) => {
    const data = event.data as { type?: string } | null | undefined
    if (data && data.type === "SKIP_WAITING") {
      sw.skipWaiting()
    }
  })
}
