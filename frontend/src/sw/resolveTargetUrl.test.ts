import { describe, it, expect } from "vitest"
import { resolveTargetUrl } from "./resolveTargetUrl"

describe("resolveTargetUrl", () => {
  const swOrigin = "https://mesh.example.com"

  it("accepts same-origin absolute URLs", () => {
    expect(resolveTargetUrl("https://mesh.example.com/chat/abc", swOrigin)).toBe(
      "https://mesh.example.com/chat/abc",
    )
  })

  it("accepts root-relative paths", () => {
    expect(resolveTargetUrl("/chat/abc", swOrigin)).toBe(
      "https://mesh.example.com/chat/abc",
    )
  })

  it("falls back to root for cross-origin URLs", () => {
    expect(resolveTargetUrl("https://evil.example/login", swOrigin)).toBe(
      "https://mesh.example.com/",
    )
  })

  it("rejects javascript: and data: schemes", () => {
    expect(resolveTargetUrl("javascript:alert(1)", swOrigin)).toBe(
      "https://mesh.example.com/",
    )
    expect(resolveTargetUrl("data:text/html,<script>", swOrigin)).toBe(
      "https://mesh.example.com/",
    )
  })

  it("rejects protocol-relative URLs", () => {
    expect(resolveTargetUrl("//evil.example/login", swOrigin)).toBe(
      "https://mesh.example.com/",
    )
  })

  it("falls back when input is undefined / non-string / empty", () => {
    expect(resolveTargetUrl(undefined, swOrigin)).toBe("https://mesh.example.com/")
    expect(resolveTargetUrl("", swOrigin)).toBe("https://mesh.example.com/")
    expect(resolveTargetUrl(123 as unknown as string, swOrigin)).toBe(
      "https://mesh.example.com/",
    )
  })
})
