import { createContext, useContext, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useWebSocket, type WSStatus } from "./useWebSocket"
import { parseWSMessage } from "./wsSchema"

interface Ctx {
  status: WSStatus
  send: (msg: { type: string; payload: unknown }) => void
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
  const { status, send } = useWebSocket({
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
          qc.setQueryData<unknown[]>(key, (old = []) => [...old, msg.payload])
          break
        }
        case "channel_message": {
          const key = [
            "messages",
            `chan:${msg.payload.channel_idx}`,
          ] as const
          qc.setQueryData<unknown[]>(key, (old = []) => [...old, msg.payload])
          break
        }
        case "ack": {
          qc.invalidateQueries({ queryKey: ["messages"] })
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

  const value = useMemo<Ctx>(() => ({ status, send }), [status, send])
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
