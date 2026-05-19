import { createContext, useContext, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { InfiniteData } from "@tanstack/react-query"
import { useWebSocket, type WSStatus } from "./useWebSocket"
import { parseWSMessage } from "./wsSchema"

interface Ctx {
  status: WSStatus
  send: (msg: { type: string; payload: unknown }) => void
  lastMessage: unknown
}

interface MessagesPage {
  items: unknown[]
  next_cursor: string | null
}
type MessagesData = InfiniteData<MessagesPage>

// Prepend a new arrival to the first page (backend returns DESC by timestamp).
function prependToMessages(
  data: MessagesData | undefined,
  msg: unknown,
): MessagesData {
  if (!data || !data.pages || data.pages.length === 0) {
    return {
      pages: [{ items: [msg], next_cursor: null }],
      pageParams: [undefined],
    }
  }
  const [first, ...rest] = data.pages
  return {
    pages: [{ ...first, items: [msg, ...first.items] }, ...rest],
    pageParams: data.pageParams,
  }
}

const WSContext = createContext<Ctx | null>(null)

export function WebSocketProvider({
  url,
  children,
}: {
  url: string
  children: React.ReactNode
}) {
  const qc = useQueryClient()
  const { status, send, lastMessage } = useWebSocket({
    url,
    onMessage: (raw) => {
      const msg = parseWSMessage(raw)
      if (!msg) return
      switch (msg.type) {
        case "contact_message": {
          const key = [
            "messages",
            msg.payload.pubkey_prefix ?? "unknown",
          ] as const
          qc.setQueryData<MessagesData>(key, (old) =>
            prependToMessages(old, msg.payload),
          )
          qc.invalidateQueries({ queryKey: ["threads"] })
          break
        }
        case "channel_message": {
          const key = [
            "messages",
            `chan:${msg.payload.channel_idx}`,
          ] as const
          qc.setQueryData<MessagesData>(key, (old) =>
            prependToMessages(old, msg.payload),
          )
          qc.invalidateQueries({ queryKey: ["threads"] })
          break
        }
        case "ack": {
          qc.invalidateQueries({ queryKey: ["messages"] })
          qc.invalidateQueries({ queryKey: ["threads"] })
          break
        }
        case "connected":
        case "disconnected":
          qc.setQueryData(["device", "status"], {
            connected: msg.type === "connected",
          })
          break
        case "advertisement":
          qc.invalidateQueries({ queryKey: ["contacts"] })
          break
        case "pong":
          // heartbeat, no-op
          break
      }
    },
  })

  const value = useMemo<Ctx>(
    () => ({ status, send, lastMessage }),
    [status, send, lastMessage],
  )
  return <WSContext.Provider value={value}>{children}</WSContext.Provider>
}

export function useRealtime() {
  const ctx = useContext(WSContext)
  if (!ctx) throw new Error("useRealtime requires WebSocketProvider")
  return ctx
}

export function resolveWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${window.location.host}/ws`
}
