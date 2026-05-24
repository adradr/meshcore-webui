import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { Sheet, SheetContent } from "../sheet"

describe("SheetContent safe-area", () => {
  it("applies safe-area-inset-top padding so iPhone PWA Dynamic Island doesn't cover the close button", () => {
    render(
      <Sheet open onOpenChange={() => {}}>
        <SheetContent data-testid="content">body</SheetContent>
      </Sheet>,
    )
    const content = screen.getByTestId("content")
    // Inline style or class containing safe-area-inset-top.
    const hasInlineSafeArea = (content.getAttribute("style") ?? "").includes(
      "safe-area-inset-top",
    )
    const hasClassSafeArea = (content.className ?? "").includes(
      "safe-area-inset-top",
    )
    expect(hasInlineSafeArea || hasClassSafeArea).toBe(true)
  })

  it("the close button is positioned BELOW the safe-area inset", () => {
    render(
      <Sheet open onOpenChange={() => {}}>
        <SheetContent>body</SheetContent>
      </Sheet>,
    )
    const close = screen.getByRole("button", { name: /close/i })
    // Close button should NOT be at a bare `top-3`; the y-offset must
    // include `env(safe-area-inset-top, …)` so it clears the island.
    const style = close.getAttribute("style") ?? ""
    const cls = close.className ?? ""
    expect(
      style.includes("safe-area-inset-top") || cls.includes("safe-area-inset-top"),
    ).toBe(true)
  })
})
