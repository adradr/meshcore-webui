import { useContext, useEffect } from "react"
import type { ZodType } from "zod"
import { WebSocketContext } from "./WebSocketProvider"
import {
  TOPIC_PAYLOAD_SCHEMAS,
  type PayloadFor,
  type ValidatedTopic,
} from "./wsSchema"

/**
 * Subscribe to wire events on a specific topic.
 *
 * The handler is invoked whenever a parsed `WireEvent` arriving on the
 * underlying WebSocket carries the matching `topic`. Other topics are
 * silently ignored. Subscription is automatically released on unmount or
 * when the topic / handler identity changes.
 *
 * Per-topic validation:
 *   For every topic listed in `TOPIC_PAYLOAD_SCHEMAS`, the payload is
 *   parsed against the matching Zod schema BEFORE the handler runs.
 *   Failures are dropped with a `console.warn` so a malformed packet
 *   re-broadcast from a hostile mesh peer can never break a subscriber's
 *   destructure. Topics not listed in the map pass through unvalidated
 *   (a loose escape hatch for low-volume / system topics — `messages`,
 *   `system`, `trace`, `diagnostic`, etc.).
 *
 * Must be used inside a {@link WebSocketProvider}.
 */
export function useWsTopic<K extends ValidatedTopic>(
  topic: K,
  handler: (payload: PayloadFor<K>) => void,
): void
export function useWsTopic<T = unknown>(
  topic: string,
  handler: (payload: T) => void,
): void
export function useWsTopic(
  topic: string,
  handler: (payload: never) => void,
): void {
  const ctx = useContext(WebSocketContext)
  useEffect(() => {
    if (!ctx) return
    const schema = (TOPIC_PAYLOAD_SCHEMAS as Record<string, ZodType>)[topic]
    const cb = (raw: unknown) => {
      if (schema) {
        const parsed = schema.safeParse(raw)
        if (!parsed.success) {
          // Defensive log only — never throw upward. Subscribers stay
          // ignorant of malformed traffic; nothing else cascades.
          console.warn(
            "[ws] topic %s payload dropped: %s",
            topic,
            parsed.error.message,
          )
          return
        }
        ;(handler as (p: unknown) => void)(parsed.data)
        return
      }
      ;(handler as (p: unknown) => void)(raw)
    }
    const unsub = ctx.subscribe(topic, cb)
    return unsub
  }, [ctx, topic, handler])
}
