import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { renderMentions } from "@/features/chat/renderMentions"
import type { MentionContact } from "@/features/chat/MentionInput"

const contacts: MentionContact[] = [
  { adv_name: "Alice", public_key: "aaaaaaaaaaaaaaaaaaaa" },
  { adv_name: "Bob", public_key: "bbbbbbbbbbbbbbbbbbbb" },
  { adv_name: "Alex 📢", public_key: "cccccccccccccccccccc" },
  { adv_name: "HA3TL WIO L1 🚶", public_key: "dddddddddddddddddddd" },
]

function rtl(nodes: React.ReactNode[]) {
  return render(<MemoryRouter>{nodes}</MemoryRouter>)
}

describe("renderMentions", () => {
  it("returns plain text as a single string node", () => {
    const nodes = renderMentions("hello world", contacts)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toBe("hello world")
  })

  it("renders only a URL anchor for URL-only text", () => {
    const nodes = renderMentions("https://example.com", contacts)
    const { container } = rtl(nodes)
    const anchors = container.querySelectorAll("a[href='https://example.com']")
    expect(anchors).toHaveLength(1)
    expect(anchors[0].getAttribute("target")).toBe("_blank")
  })

  it("auto-link uses noopener noreferrer", () => {
    const nodes = renderMentions("see https://example.com", contacts)
    const { container } = rtl(nodes)
    const a = container.querySelector("a[href='https://example.com']")!
    expect(a).toBeTruthy()
    expect(a.getAttribute("rel")).toBe("noopener noreferrer")
    expect(a.getAttribute("target")).toBe("_blank")
  })

  it("renders a mention link for known contact", () => {
    const nodes = renderMentions("@Alice hi", contacts)
    const { container } = rtl(nodes)
    const link = container.querySelector("a[href='/chat/aaaaaaaaaaaaaaaaaaaa']")
    expect(link).not.toBeNull()
    expect(link!.textContent).toBe("@Alice")
  })

  it("renders a mention + URL + plain text together", () => {
    const nodes = renderMentions("hey @Alice see https://example.com", contacts)
    const { container } = rtl(nodes)
    expect(container.querySelector("a[href='/chat/aaaaaaaaaaaaaaaaaaaa']")).not.toBeNull()
    expect(container.querySelector("a[href='https://example.com']")).not.toBeNull()
    expect(container.textContent).toContain("hey ")
    expect(container.textContent).toContain(" see ")
  })

  it("wraps a long hex sequence in <code>", () => {
    const nodes = renderMentions("pubkey deadbeefcafe1234", contacts)
    const { container } = rtl(nodes)
    const code = container.querySelector("code")
    expect(code).not.toBeNull()
    expect(code!.textContent).toBe("deadbeefcafe1234")
  })

  it("does not double-link a URL that contains hex", () => {
    const nodes = renderMentions("https://x.io/abc/deadbeef1234", contacts)
    const { container } = rtl(nodes)
    expect(container.querySelectorAll("a")).toHaveLength(1)
    expect(container.querySelectorAll("code")).toHaveLength(0)
  })

  it("does not URL-link inside a mention", () => {
    const nodes = renderMentions("@Alice", contacts)
    const { container } = rtl(nodes)
    expect(container.querySelectorAll("code")).toHaveLength(0)
    const links = container.querySelectorAll("a")
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute("href")).toBe("/chat/aaaaaaaaaaaaaaaaaaaa")
  })

  it("resolves MeshCore bracketed @[Name] mention", () => {
    const nodes = renderMentions("hi @[Alice] !", contacts)
    const { container } = rtl(nodes)
    const link = container.querySelector("a[href='/chat/aaaaaaaaaaaaaaaaaaaa']")
    expect(link).not.toBeNull()
    expect(link!.textContent).toBe("@Alice")
    expect(container.textContent).toBe("hi @Alice !")
  })

  it("resolves bracketed mention with spaces + emoji", () => {
    const nodes = renderMentions("ping @[HA3TL WIO L1 🚶] now", contacts)
    const { container } = rtl(nodes)
    const link = container.querySelector("a[href='/chat/dddddddddddddddddddd']")
    expect(link).not.toBeNull()
    expect(link!.textContent).toBe("@HA3TL WIO L1 🚶")
  })

  it("resolves bracketed mention with trailing emoji", () => {
    const nodes = renderMentions("yo @[Alex 📢]", contacts)
    const { container } = rtl(nodes)
    const link = container.querySelector("a[href='/chat/cccccccccccccccccccc']")
    expect(link).not.toBeNull()
  })

  it("renders unknown bracketed mention as plain text", () => {
    const nodes = renderMentions("hey @[no such name] there", contacts)
    const { container } = rtl(nodes)
    expect(container.querySelectorAll("a")).toHaveLength(0)
    expect(container.textContent).toBe("hey @[no such name] there")
  })

  it("handles mixed bracketed + bare mentions", () => {
    const nodes = renderMentions("hi @[Alice] and @Bob", contacts)
    const { container } = rtl(nodes)
    expect(container.querySelector("a[href='/chat/aaaaaaaaaaaaaaaaaaaa']")).not.toBeNull()
    expect(container.querySelector("a[href='/chat/bbbbbbbbbbbbbbbbbbbb']")).not.toBeNull()
  })
})
