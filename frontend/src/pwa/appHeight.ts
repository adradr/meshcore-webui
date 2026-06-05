/**
 * Pin a CSS custom property `--app-h` to the *real* visible viewport height.
 *
 * iOS standalone PWAs mis-resolve every CSS viewport unit this app has tried:
 *   - `100vh`     overshoots (renders against the large viewport)
 *   - `100dvh`    has a cold-start band (resolves to the small viewport)
 *   - `height:100%` undershoots (the html box comes up short of the screen),
 *                 which floats the bottom nav up and leaves a body-coloured
 *                 band beneath it.
 *
 * `window.innerHeight` reports the true visible height reliably across iOS
 * versions, so we measure it in JS and expose it as `--app-h`. The shell
 * height chain (`html, body, #root { height: var(--app-h, 100%) }`) consumes
 * it; the `100%` fallback keeps SSR / first-paint correct until this runs.
 *
 * Returns a disposer that detaches the listeners (used by tests; the app
 * installs it for the page lifetime and never disposes).
 */
export function installAppHeight(win: Window = window): () => void {
  const root = win.document.documentElement
  const apply = () => {
    root.style.setProperty("--app-h", `${win.innerHeight}px`)
  }

  apply()
  win.addEventListener("resize", apply)
  win.addEventListener("orientationchange", apply)
  win.visualViewport?.addEventListener("resize", apply)

  return () => {
    win.removeEventListener("resize", apply)
    win.removeEventListener("orientationchange", apply)
    win.visualViewport?.removeEventListener("resize", apply)
  }
}
