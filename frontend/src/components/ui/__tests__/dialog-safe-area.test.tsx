import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { Dialog, DialogContent } from "../dialog"

describe("DialogContent safe-area", () => {
  it("applies safe-area-inset-top padding so iPhone PWA Dynamic Island doesn't cover the close button", () => {
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent data-testid="content">body</DialogContent>
      </Dialog>,
    )
    const content = screen.getByTestId("content")
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
      <Dialog open onOpenChange={() => {}}>
        <DialogContent>body</DialogContent>
      </Dialog>,
    )
    const close = screen.getByRole("button", { name: /close/i })
    const style = close.getAttribute("style") ?? ""
    const cls = close.className ?? ""
    expect(
      style.includes("safe-area-inset-top") || cls.includes("safe-area-inset-top"),
    ).toBe(true)
  })
})
