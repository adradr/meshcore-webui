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

  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])
  useEffect(() => {
    initialMessageRef.current = initialMessage
  }, [initialMessage])

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
      connect()
    }, delay)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxBackoffMs])

  const connect = useCallback(() => {
    if (stoppedRef.current) return
    clearTimers()
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

    ws.onclose = () => {
      setStatus("closed")
      clearTimers()
      if (!stoppedRef.current) scheduleReconnect()
    }
  }, [url, protocols, pingIntervalMs, clearTimers, scheduleReconnect])

  const disconnect = useCallback(() => {
    stoppedRef.current = true
    clearTimers()
    const ws = wsRef.current
    if (ws && ws.readyState <= 1) {
      setStatus("closing")
      try {
        ws.close()
      } catch {
        // ignore
      }
    }
    setStatus("closed")
  }, [clearTimers])

  const reconnect = useCallback(() => {
    stoppedRef.current = false
    attemptRef.current = 0
    const ws = wsRef.current
    if (ws && ws.readyState <= 1) {
      try {
        ws.close()
      } catch {
        // ignore
      }
    }
    connect()
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
      const ws = wsRef.current
      if (ws && ws.readyState <= 1) {
        try {
          ws.close()
        } catch {
          // ignore
        }
      }
      wsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  return { status, lastMessage, send, reconnect, disconnect }
}
