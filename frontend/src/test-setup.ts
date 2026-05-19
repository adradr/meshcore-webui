import "@testing-library/jest-dom"

// JSDOM does not implement ResizeObserver; Recharts/ChartContainer needs it.
if (typeof globalThis.ResizeObserver === "undefined") {
  class MockResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver
}

// JSDOM lacks Element.scrollIntoView; Radix Select calls it when opening.
if (
  typeof Element !== "undefined" &&
  !(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
) {
  ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
    function scrollIntoView(): void {}
}

// JSDOM lacks hasPointerCapture/releasePointerCapture; Radix Select uses them.
if (
  typeof Element !== "undefined" &&
  !(Element.prototype as unknown as { hasPointerCapture?: unknown })
    .hasPointerCapture
) {
  ;(Element.prototype as unknown as {
    hasPointerCapture: () => boolean
  }).hasPointerCapture = function hasPointerCapture(): boolean {
    return false
  }
  ;(Element.prototype as unknown as {
    releasePointerCapture: () => void
  }).releasePointerCapture = function releasePointerCapture(): void {}
  ;(Element.prototype as unknown as {
    setPointerCapture: () => void
  }).setPointerCapture = function setPointerCapture(): void {}
}
