import { createContext, useCallback, useContext, useMemo, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { InfiniteData } from "@tanstack/react-query"
import { useWebSocket, type WSStatus } from "./useWebSocket"
import { parseWireEvent, parseWSMessage } from "./wsSchema"
import { useHaptic } from "@/haptics/HapticProvider"

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

interface WsContactMessagePayload {
  text: string
  pubkey_prefix?: string
  txt_type?: number
  sender_timestamp?: number
}
interface WsChannelMessagePayload {
  text: string
  channel_idx: number
  sender_timestamp?: number
}

/**
 * Convert a WS-arrived payload into the canonical `Message` shape that
 * REST-fetched pages use, so the cached `items[]` stays homogeneous.
 *
 * The WS schema (see wsSchema.ts) omits `id`, `timestamp`, `ack_state`,
 * `direction`, etc. If we prepend raw WS payloads, downstream code that
 * reads `m.timestamp` (e.g. `new Date(m.timestamp).toISOString()` in
 * `MessageList.buildTimeline`) gets `undefined` → Invalid Date → RangeError.
 *
 * `sender_timestamp` arrives as Unix seconds. Convert to ms then ISO string.
 * If absent (some firmwares don't include it on broadcast frames), fall back
 * to wall-clock "now" — better than a crash, and the canonical REST refetch
 * (triggered by the threads `invalidateQueries`) will replace this synthetic
 * row shortly after.
 *
 * Synthetic `id` is negative so it can never collide with backend auto-ids.
 */
export function normalizeWsMessage(
  payload: WsContactMessagePayload | WsChannelMessagePayload,
  kind: "dm" | "chan",
): Record<string, unknown> {
  const tsMs =
    typeof payload.sender_timestamp === "number"
      ? payload.sender_timestamp * 1000
      : Date.now()
  const ts = new Date(tsMs)
  const timestamp = Number.isNaN(ts.getTime())
    ? new Date().toISOString()
    : ts.toISOString()

  const base = {
    id: -Date.now() - Math.floor(Math.random() * 1000),
    msg_type: kind,
    direction: "in" as const,
    text: payload.text,
    timestamp,
    ack_state: "pending",
    expected_ack_hex: null,
    ack_received_at: null,
  }

  if (kind === "chan") {
    const p = payload as WsChannelMessagePayload
    return { ...base, contact_pub_key: null, channel_idx: p.channel_idx, pubkey_prefix: null }
  }
  const p = payload as WsContactMessagePayload
  return {
    ...base,
    contact_pub_key: null, // not always known on the wire
    channel_idx: null,
    pubkey_prefix: p.pubkey_prefix ?? null,
  }
}

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
  const haptic = useHaptic()
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
            prependToMessages(old, normalizeWsMessage(msg.payload, "dm")),
          )
          qc.invalidateQueries({ queryKey: ["threads"] })
          // Refresh canonical entries (REST has the real `id`, `timestamp`,
          // `ack_state` and stable `pubkey_prefix`) so the optimistic row gets
          // replaced rather than living forever as a synthetic.
          qc.invalidateQueries({ queryKey: key })
          // Foreground nudge — only when the tab is actually visible, so a
          // backgrounded PWA doesn't double-buzz alongside the OS push
          // notification.
          if (
            typeof document !== "undefined" &&
            document.visibilityState === "visible"
          ) {
            haptic.nudge()
          }
          break
        }
        case "channel_message": {
          const key = [
            "messages",
            `chan:${msg.payload.channel_idx}`,
          ] as const
          qc.setQueryData<MessagesData>(key, (old) =>
            prependToMessages(old, normalizeWsMessage(msg.payload, "chan")),
          )
          qc.invalidateQueries({ queryKey: ["threads"] })
          qc.invalidateQueries({ queryKey: key })
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
  // Browsers can't set headers on `new WebSocket(...)`; pass via ?token=.
  let token: string | null = null
  try {
    token =
      typeof localStorage !== "undefined" ? localStorage.getItem("apiKey") : null
  } catch {
    token = null
  }
  const qs = token ? `?token=${encodeURIComponent(token)}` : ""
  return `${proto}//${window.location.host}/ws${qs}`
}
