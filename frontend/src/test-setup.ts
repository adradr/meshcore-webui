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
