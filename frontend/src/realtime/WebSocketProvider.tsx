import { createContext, useCallback, useContext, useMemo, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { InfiniteData } from "@tanstack/react-query"
import { useWebSocket, type WSStatus } from "./useWebSocket"
import { parseWireEvent, parseWSMessage } from "./wsSchema"

export type TopicHandler = (payload: unknown) => void

export interface WebSocketContextValue {
  status: WSStatus
  send: (msg: { type: string; payload: unknown }) => void
  lastMessage: unknown
  /**
   * Subscribe to wire events on a given topic. Returns an unsubscribe fn.
   * Prefer the {@link useWsTopic} hook for component-level subscriptions.
   */
  subscribe: (topic: string, handler: TopicHandler) => () => void
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

export const WebSocketContext = createContext<WebSocketContextValue | null>(
  null,
)

export function WebSocketProvider({
  url,
  children,
}: {
  url: string
  children: React.ReactNode
}) {
  const qc = useQueryClient()
  const subscribers = useRef(new Map<string, Set<TopicHandler>>())

  const subscribe = useCallback(
    (topic: string, handler: TopicHandler) => {
      let set = subscribers.current.get(topic)
      if (!set) {
        set = new Set()
        subscribers.current.set(topic, set)
      }
      set.add(handler)
      return () => {
        const current = subscribers.current.get(topic)
        if (!current) return
        current.delete(handler)
        if (current.size === 0) subscribers.current.delete(topic)
      }
    },
    [],
  )

  const { status, send, lastMessage } = useWebSocket({
    url,
    onMessage: (raw) => {
      // 1) Topic-based fan-out for new subscribers (Task 0.4).
      // Run first and isolated so a bad subscriber cannot break the
      // strict-typed dispatch below.
      try {
        const wire = parseWireEvent(raw)
        const handlers = subscribers.current.get(wire.topic)
        if (handlers && handlers.size > 0) {
          for (const h of handlers) {
            try {
              h(wire.payload)
            } catch (err) {
              console.error("[ws] subscriber threw", err)
            }
          }
        }
      } catch (err) {
        // Envelope didn't even parse — fall through to strict dispatch which
        // will warn via parseWSMessage.
        console.warn("[ws] wire envelope parse failed", err)
      }

      // 2) Strict typed dispatch for the legacy/typed message contract.
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
        case "acknowledgement": {
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

  const value = useMemo<WebSocketContextValue>(
    () => ({ status, send, lastMessage, subscribe }),
    [status, send, lastMessage, subscribe],
  )
  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  )
}

export function useRealtime() {
  const ctx = useContext(WebSocketContext)
  if (!ctx) throw new Error("useRealtime requires WebSocketProvider")
  return ctx
}

export function resolveWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${window.location.host}/ws`
}
