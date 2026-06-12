import { useCallback, useEffect, useRef, useState } from "react"

export type WSStatus = "connecting" | "open" | "closing" | "closed"

export interface UseWebSocketOptions {
  url: string
  protocols?: string | string[]
  onMessage?: (raw: unknown) => void
  /** Send this on open if non-empty; can be used for auth. */
  initialMessage?: () => unknown | null
  /** Heartbeat interval (ms). Defaults to 25s. */
  pingIntervalMs?: number
  /** Max backoff ceiling (ms). Defaults to 30s. */
  maxBackoffMs?: number
  /** Disable auto-connect (defaults false). */
  autoConnect?: boolean
  /**
   * Called when the server closes with an auth-rejection code
   * (1008 policy violation, or 4400–4403). Reconnection stops —
   * retrying with the same bad token would just hammer the server.
   */
  onAuthFail?: () => void
}

interface UseWebSocketReturn {
  status: WSStatus
  lastMessage: unknown
  send: (msg: unknown) => void
  reconnect: () => void
  disconnect: () => void
}

/**
 * useWebSocket — reconnecting WebSocket with exponential backoff and ping/pong.
 *
 * Lifecycle:
 *   connecting -> open (ws.onopen)
 *               -> closing -> closed (ws.onclose) -> reconnect
 */
export function useWebSocket(opts: UseWebSocketOptions): UseWebSocketReturn {
  const {
    url,
    protocols,
    onMessage,
    initialMessage,
    pingIntervalMs = 25_000,
    maxBackoffMs = 30_000,
    autoConnect = true,
    onAuthFail,
  } = opts

  const [status, setStatus] = useState<WSStatus>("closed")
  const [lastMessage, setLastMessage] = useState<unknown>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const attemptRef = useRef(0)
  const stoppedRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onMessageRef = useRef(onMessage)
  const initialMessageRef = useRef(initialMessage)
  const onAuthFailRef = useRef(onAuthFail)
  // Latest `connect` — lets `scheduleReconnect` (declared first, mutually
  // recursive with `connect`) always invoke the current closure.
  const connectRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])
  useEffect(() => {
    initialMessageRef.current = initialMessage
  }, [initialMessage])
  useEffect(() => {
    onAuthFailRef.current = onAuthFail
  }, [onAuthFail])

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current)
      pingTimerRef.current = null
    }
  }, [])

  const scheduleReconnect = useCallback(() => {
    if (stoppedRef.current) return
    const attempt = attemptRef.current
    const base = Math.min(1000 * 2 ** attempt, maxBackoffMs)
    const jitter = Math.random() * 500
    const delay = base + jitter
    attemptRef.current = attempt + 1
    reconnectTimerRef.current = setTimeout(() => {
      connectRef.current?.()
    }, delay)
  }, [maxBackoffMs])

  // Detach handlers BEFORE closing so a superseded socket's onclose can't
  // schedule a duplicate reconnect (stale-url socket leak).
  const detachAndClose = useCallback((ws: WebSocket | null) => {
    if (!ws) return
    ws.onopen = null
    ws.onmessage = null
    ws.onerror = null
    ws.onclose = null
    if (ws.readyState <= 1) {
      try {
        ws.close()
      } catch {
        // ignore
      }
    }
  }, [])

  const connect = useCallback(() => {
    if (stoppedRef.current) return
    clearTimers()
    // Never allow two live sockets: supersede any existing one silently.
    detachAndClose(wsRef.current)
    wsRef.current = null
    setStatus("connecting")

    let ws: WebSocket
    try {
      ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url)
    } catch (err) {
      console.error("[ws] construct failed", err)
      scheduleReconnect()
      return
    }
    wsRef.current = ws

    ws.onopen = () => {
      attemptRef.current = 0
      setStatus("open")
      const init = initialMessageRef.current?.()
      if (init != null) {
        try {
          ws.send(typeof init === "string" ? init : JSON.stringify(init))
        } catch (err) {
          console.warn("[ws] initial send failed", err)
        }
      }
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "ping" }))
          } catch {
            // ignore
          }
        }
      }, pingIntervalMs)
    }

    ws.onmessage = (ev: MessageEvent) => {
      let parsed: unknown = ev.data
      try {
        parsed = JSON.parse(ev.data as string)
      } catch {
        // not JSON
      }
      setLastMessage(parsed)
      onMessageRef.current?.(parsed)
    }

    ws.onerror = (ev: Event) => {
      console.warn("[ws] error", ev)
    }

    ws.onclose = (ev: CloseEvent) => {
      // Ignore close events from sockets we've already superseded.
      if (wsRef.current !== ws) return
      setStatus("closed")
      clearTimers()
      const authRejected =
        ev.code === 1008 || (ev.code >= 4400 && ev.code <= 4403)
      if (authRejected) {
        // Server explicitly rejected our token — retrying with the same
        // credentials is pointless. Stop and surface to the caller.
        stoppedRef.current = true
        onAuthFailRef.current?.()
        return
      }
      if (!stoppedRef.current) scheduleReconnect()
    }
  }, [url, protocols, pingIntervalMs, clearTimers, scheduleReconnect, detachAndClose])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  const disconnect = useCallback(() => {
    stoppedRef.current = true
    clearTimers()
    // Detach handlers before closing so the async onclose doesn't fire a
    // second setStatus("closed") later; with handlers gone the synchronous
    // "closed" below is final and accurate from the consumer's view.
    detachAndClose(wsRef.current)
    wsRef.current = null
    setStatus("closed")
  }, [clearTimers, detachAndClose])

  const reconnect = useCallback(() => {
    stoppedRef.current = false
    attemptRef.current = 0
    connect() // connect() supersedes/closes any existing socket itself
  }, [connect])

  const send = useCallback((msg: unknown) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn("[ws] send while not open, dropped")
      return
    }
    try {
      ws.send(typeof msg === "string" ? msg : JSON.stringify(msg))
    } catch (err) {
      console.error("[ws] send failed", err)
    }
  }, [])

  useEffect(() => {
    stoppedRef.current = false
    if (autoConnect) connect()
    return () => {
      stoppedRef.current = true
      clearTimers()
      detachAndClose(wsRef.current)
      wsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  return { status, lastMessage, send, reconnect, disconnect }
}
