import { describe, expect, it } from "vitest"
import {
  COMPANION,
  REPEATER,
  ROOM,
  SENSOR,
  isMessageableContact,
} from "../types"

describe("isMessageableContact", () => {
  it.each<[number | null | undefined, boolean]>([
    [COMPANION, true],
    [REPEATER, false],
    [ROOM, false],
    [SENSOR, false],
    [null, true],
    [undefined, true],
  ])("type %s -> %s", (input, expected) => {
    expect(isMessageableContact(input)).toBe(expected)
  })

  it("treats unknown numeric types as not-messageable (only COMPANION/null pass)", () => {
    expect(isMessageableContact(99)).toBe(false)
  })
})
