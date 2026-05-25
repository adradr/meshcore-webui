import { beforeEach, describe, expect, it, vi } from "vitest"
import { downloadBlob } from "@/lib/download"

describe("downloadBlob", () => {
  let anchor: HTMLAnchorElement
  let originalCreateElement: typeof document.createElement

  beforeEach(() => {
    anchor = document.createElement("a")
    originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation(
      ((tag: string) => {
        if (tag === "a") return anchor
        return originalCreateElement(tag)
      }) as typeof document.createElement,
    )
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    vi.spyOn(anchor, "click").mockImplementation(() => {})
  })

  it("strips path separators and replaces them with underscores", () => {
    downloadBlob("x", "../../etc/passwd.csv", "text/csv")
    expect(anchor.download).toBe(".._.._etc_passwd.csv")
    expect(anchor.download).not.toContain("/")
    expect(anchor.download).not.toContain("\\")
  })

  it("strips backslash path separators", () => {
    downloadBlob("x", "..\\..\\windows\\system32.csv", "text/csv")
    expect(anchor.download).not.toContain("\\")
    expect(anchor.download).not.toContain("/")
  })

  it("caps filename length", () => {
    downloadBlob("x", "x".repeat(500) + ".csv", "text/csv")
    expect(anchor.download.length).toBeLessThanOrEqual(200)
  })

  it("leaves clean filenames untouched", () => {
    downloadBlob("x", "trace-ff00aa-2026.csv", "text/csv")
    expect(anchor.download).toBe("trace-ff00aa-2026.csv")
  })

  it("replaces NUL and control characters with underscores", () => {
    downloadBlob("x", "a\x00b\x01c.csv", "text/csv")
    expect(anchor.download).toBe("a_b_c.csv")
  })
})
