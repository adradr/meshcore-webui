import { z } from "zod"

export const AuthInfoSchema = z.object({
  required: z.boolean(),
  valid: z.boolean(),
  // Optional: backend exposes the configured public base URL so the SPA can
  // render shareable attachment links. May be `null` (unset) or absent on
  // older deployments.
  public_base_url: z.string().nullable().optional(),
})
export type AuthInfo = z.infer<typeof AuthInfoSchema>
