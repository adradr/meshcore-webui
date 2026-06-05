import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"

import { BottomNav } from "../bottom-nav"

describe("BottomNav safe-area", () => {
  it("uses the compact (capped) bottom safe-area, not the full inset, so the home-indicator band doesn't leave a huge empty strip below the icons", () => {
    const { container } = render(<BottomNav />)
    const nav = container.querySelector('[data-slot="bottom-nav"]')!
    const classes = nav.className.split(/\s+/)
    // Capped utility present (a few px above the home indicator)...
    expect(classes).toContain("safe-bottom-compact")
    // ...and the bare full-inset utility (~34px dead band) absent.
    expect(classes).not.toContain("safe-bottom")
  })
})
