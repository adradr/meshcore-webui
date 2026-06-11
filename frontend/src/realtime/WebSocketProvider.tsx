import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { InfiniteData } from "@tanstack/react-query"
import { useWebSocket, type WSStatus } from "./useWebSocket"
import { parseWireEvent, parseWSMessage } from "./wsSchema"
import { useHaptic } from "@/haptics/HapticProvider"
import { API_KEY_CHANGE_EVENT } from "@/lib/api"

export type TopicHandler = (payload: unknown) => void

export interface WebSocketContextValue {
  status: WSStatus
  send: (msg: { type: string; payload: unknown }) => void
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
  pubkey?: string
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
// eslint-disable-next-line react-refresh/only-export-components
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
    // The backend enriches the wire payload with the resolved full
    // 64-hex pubkey when its contact cache knows it; older frames only
    // carry the short prefix.
    contact_pub_key: p.pubkey?.toLowerCase() ?? null,
    channel_idx: null,
    pubkey_prefix: p.pubkey_prefix ?? null,
  }
}

/**
 * Cache key for a DM conversation as arrived on the WS: the enriched full
 * pubkey when present (matches what the bridge persists + what the chat
 * route param carries), falling back to the legacy short prefix.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function dmConversationKey(payload: WsContactMessagePayload): string {
  return (payload.pubkey ?? payload.pubkey_prefix ?? "unknown").toLowerCase()
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

/**
 * Patch every cached message whose `expected_ack_hex` equals `code` to the
 * given ack state. Returns whether any cached thread held a match (callers
 * fall back to an invalidate when it didn't). A "failed" transition never
 * downgrades an already-acked row — a late RF ACK wins.
 */
function applyAckStateByCode(
  qc: ReturnType<typeof useQueryClient>,
  code: string,
  next: "acked" | "failed",
): boolean {
  let matched = false
  for (const [key, data] of qc.getQueriesData<MessagesData>({
    queryKey: ["messages"],
  })) {
    if (!data?.pages) continue
    const hasMatch = data.pages.some((p) =>
      p.items.some(
        (it) =>
          (it as { expected_ack_hex?: string | null })?.expected_ack_hex ===
          code,
      ),
    )
    if (!hasMatch) continue
    matched = true
    qc.setQueryData<MessagesData>(key, (old) => {
      if (!old) return old
      return {
        pages: old.pages.map((p) => ({
          ...p,
          items: p.items.map((it) => {
            const m = it as Record<string, unknown>
            if (m?.expected_ack_hex !== code) return it
            if (next === "failed" && m.ack_state === "acked") return it
            return next === "acked"
              ? {
                  ...m,
                  ack_state: "acked",
                  ack_received_at: new Date().toISOString(),
                }
              : { ...m, ack_state: "failed" }
          }),
        })),
        pageParams: old.pageParams,
      }
    })
  }
  return matched
}

// eslint-disable-next-line react-refresh/only-export-components
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

  // The `url` prop is computed once at app boot (resolveWsUrl()), so it
  // captures whatever token was in localStorage then. After a key rotation
  // (Settings → Save, or LoginPage submit) the underlying token changes
  // but the prop doesn't — without intervention the WS keeps reconnecting
  // with the OLD token forever. Listen for the `apikeychange` event
  // dispatched by `setApiKey()` and recompute the URL so the underlying
  // `useWebSocket([url])` effect tears down the stale socket and opens a
  // fresh one with the new token.
  const [liveUrl, setLiveUrl] = useState(url)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLiveUrl(url)
  }, [url])
  useEffect(() => {
    if (typeof window === "undefined") return
    const onRotate = () => setLiveUrl(resolveWsUrl())
    window.addEventListener(API_KEY_CHANGE_EVENT, onRotate)
    return () => window.removeEventListener(API_KEY_CHANGE_EVENT, onRotate)
  }, [])

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

  const { status, send } = useWebSocket({
    url: liveUrl,
    onAuthFail: () => {
      // Server rejected the token (close 1008). Reconnecting is pointless;
      // the next successful login rotates the key, which fires
      // `apikeychange` → new liveUrl → fresh socket.
      console.warn("[ws] auth rejected by server — realtime paused until re-login")
    },
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
          const key = ["messages", dmConversationKey(msg.payload)] as const
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
          // Resolve the ack in place: the payload `code` is the
          // expected_ack_hex of exactly one outgoing message. A blanket
          // ["messages"] invalidation refetches every mounted infinite
          // thread (all pages) per ack — a refetch storm on a busy mesh.
          if (!applyAckStateByCode(qc, msg.payload.code, "acked")) {
            // Cache doesn't hold the message (yet) — fall back, but only
            // refetch threads currently on screen.
            qc.invalidateQueries({
              queryKey: ["messages"],
              refetchType: "active",
            })
          }
          qc.invalidateQueries({ queryKey: ["threads"] })
          break
        }
        case "ack_failed": {
          // Backend ack-timeout sweep: flip the matching outgoing DM to
          // "failed" in place. Unmatched (thread not cached) → refetch the
          // active threads so the next render shows the failed state.
          const code = msg.payload.code
          if (!code || !applyAckStateByCode(qc, code, "failed")) {
            qc.invalidateQueries({
              queryKey: ["messages"],
              refetchType: "active",
            })
          }
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

  // Missed-event recovery: the backend has no WS replay — anything emitted
  // while we were disconnected (phone lock, network blip, radio reboot) is
  // gone from the wire but persisted in SQLite. On every reconnect (not the
  // first open) refetch the event-driven caches so the gap is filled from
  // REST.
  const wasDisconnectedRef = useRef(false)
  const everOpenRef = useRef(false)
  useEffect(() => {
    if (status === "open") {
      if (wasDisconnectedRef.current) {
        for (const key of [
          ["messages"],
          ["threads"],
          ["contacts"],
          ["rx-log"],
          ["device", "status"],
        ]) {
          qc.invalidateQueries({ queryKey: key })
        }
      }
      wasDisconnectedRef.current = false
      everOpenRef.current = true
    } else if (status === "closed" && everOpenRef.current) {
      // Only count drops AFTER the first successful open — the hook's
      // initial state is "closed", and flagging that would double-fetch
      // everything right at boot.
      wasDisconnectedRef.current = true
    }
  }, [status, qc])

  // NOTE: deliberately does NOT include the raw last message — exposing it
  // here would re-render every useRealtime consumer on every WS frame.
  // Event consumers subscribe via useWsTopic instead.
  const value = useMemo<WebSocketContextValue>(
    () => ({ status, send, subscribe }),
    [status, send, subscribe],
  )
  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRealtime() {
  const ctx = useContext(WebSocketContext)
  if (!ctx) throw new Error("useRealtime requires WebSocketProvider")
  return ctx
}

// eslint-disable-next-line react-refresh/only-export-components
export function resolveWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  // Browsers can't set headers on `new WebSocket(...)`; pass via ?token=.
  let token: string | null
  try {
    token =
      typeof localStorage !== "undefined" ? localStorage.getItem("apiKey") : null
  } catch {
    token = null
  }
  const qs = token ? `?token=${encodeURIComponent(token)}` : ""
  return `${proto}//${window.location.host}/ws${qs}`
}
