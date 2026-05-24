/**
 * CSV export helpers for the trace monitor.
 *
 * Why client-side: the data is already shaped by the existing
 * ``/api/trace/monitor/{session}/samples`` endpoint and the panel has the
 * sessions list in hand. Generating CSV in the browser avoids growing the
 * backend's API surface (and the surrounding test matrix) for what is
 * fundamentally a presentation concern.
 */
import type { TraceSample } from "./api"

/**
 * Quote a field per RFC 4180: wrap in double quotes if it contains a comma,
 * quote, or newline; escape inner double quotes by doubling them. ``null``
 * / ``undefined`` render as the empty cell (no "null" literal).
 */
function csvField(v: unknown): string {
  if (v == null) return ""
  const s = String(v)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

const HEADER = [
  "finished_at",
  "started_at",
  "status",
  "snr_there",
  "snr_back",
  "path_len",
  "hops_count",
  "hops_json",
  "error",
] as const

/**
 * Build a CSV body for a list of trace samples. The order is the input
 * order (the API returns samples sorted by ``finished_at`` ASC, so this is
 * chronological). Each row mirrors a single trace tick — failed samples
 * still emit a row with their status / error so the time series is gap-free.
 */
export function samplesToCsv(samples: TraceSample[]): string {
  const rows: string[] = [HEADER.join(",")]
  for (const s of samples) {
    rows.push(
      [
        s.finished_at,
        s.started_at,
        s.status,
        s.snr_there ?? "",
        s.snr_back ?? "",
        s.path_len ?? "",
        s.hops.length,
        JSON.stringify(s.hops),
        s.error ?? "",
      ]
        .map(csvField)
        .join(","),
    )
  }
  // Trailing newline so the file opens cleanly in Excel / awk / split etc.
  return rows.join("\n") + "\n"
}

/**
 * Build a filesystem-friendly name. Uses the session's first-sample
 * timestamp so multiple recordings from the same contact don't collide.
 *
 *   trace-eccafe7d-20260524-1556.csv
 */
export function csvFilenameFor(
  targetPubkey: string,
  firstSampleAt: string,
): string {
  const pubPrefix = targetPubkey.slice(0, 8).toLowerCase()
  const d = new Date(firstSampleAt)
  if (Number.isNaN(d.getTime())) {
    // Fallback so a malformed timestamp doesn't end up as "trace-…-NaNNaN.csv".
    return `trace-${pubPrefix}-unknown.csv`
  }
  const pad = (n: number) => String(n).padStart(2, "0")
  const stamp =
    `${d.getUTCFullYear()}` +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "-" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes())
  return `trace-${pubPrefix}-${stamp}.csv`
}

/**
 * Trigger a CSV download in the browser. Test-only override allowed via the
 * second argument so vitest can assert what was downloaded without touching
 * the DOM. The default uses an object URL + anchor click, which is the
 * standard cross-browser pattern.
 */
export interface CsvDownloader {
  download(filename: string, content: string): void
}

export const defaultCsvDownloader: CsvDownloader = {
  download(filename, content) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Defer revoke so Safari has time to start the download. The 0-delay
    // setTimeout pattern is the documented workaround for this class of bug.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  },
}
