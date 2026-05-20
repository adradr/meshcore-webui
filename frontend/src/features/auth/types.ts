import { z } from "zod"

export const AuthInfoSchema = z.object({
  required: z.boolean(),
  valid: z.boolean(),
})
export type AuthInfo = z.infer<typeof AuthInfoSchema>
