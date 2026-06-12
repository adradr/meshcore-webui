import { describe, it, expect } from "vitest"
import { gapLabel } from "../gapLabel"

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe("gapLabel", () => {
  it("renders minute gaps under 2 hours", () => {
    expect(gapLabel(5 * MIN)).toBe("5 minutes later")
    expect(gapLabel(90 * MIN)).toBe("90 minutes later")
  })

  it("renders hour gaps (regression: was '0 hours later' for any >=2h gap)", () => {
    expect(gapLabel(2 * HOUR)).toBe("2 hours later")
    expect(gapLabel(3 * HOUR)).toBe("3 hours later")
    expect(gapLabel(23 * HOUR)).toBe("23 hours later")
  })

  it("renders day gaps", () => {
    expect(gapLabel(DAY)).toBe("1 day later")
    expect(gapLabel(3 * DAY)).toBe("3 days later")
    expect(gapLabel(3 * DAY + 5 * HOUR)).toBe("3 days later")
  })
})
