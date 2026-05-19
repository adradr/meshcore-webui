import { useContext, useEffect } from "react"
import { WebSocketContext } from "./WebSocketProvider"

/**
 * Subscribe to wire events on a specific topic.
 *
 * The handler is invoked whenever a parsed `WireEvent` arriving on the
 * underlying WebSocket carries the matching `topic`. Other topics are
 * silently ignored. Subscription is automatically released on unmount or
 * when the topic / handler identity changes.
 *
 * Must be used inside a {@link WebSocketProvider}.
 */
export function useWsTopic<T = unknown>(
  topic: string,
  handler: (payload: T) => void,
): void {
  const ctx = useContext(WebSocketContext)
  useEffect(() => {
    if (!ctx) return
    const unsub = ctx.subscribe(topic, (p) => handler(p as T))
    return unsub
  }, [ctx, topic, handler])
}
