import { z } from "zod"

export const StepStatus = z.enum([
  "not_attempted",
  "no_response",
  "responded",
  "skipped",
])
export type StepStatusValue = z.infer<typeof StepStatus>

export const StepResultSchema = z.object({
  step: z.string(),
  status: StepStatus,
  started_at: z.string(), // ISO datetime
  finished_at: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
  error: z.string().nullable().optional(),
  skip_reason: z.string().nullable().optional(),
  attempts: z.number().int().nonnegative().default(0),
  successes: z.number().int().nonnegative().default(0),
})
export type StepResult = z.infer<typeof StepResultSchema>

export const DiagnosticReportSchema = z.object({
  target_pubkey: z.string(),
  target_name: z.string().nullable().optional(),
  contact_type: z.number().int().nullable().optional(),
  started_at: z.string(),
  finished_at: z.string(),
  steps: z.array(StepResultSchema),
  verdict: z.string(),
  verdict_detail: z.string(),
})
export type DiagnosticReport = z.infer<typeof DiagnosticReportSchema>

export interface DiagnosticRunRequest {
  include_remote?: boolean
}
