/**
 * Structured renderers for the Telemetry dialog and the Permissions (ACL)
 * card on the contact detail page. LPP parsing lives in `./lpp.ts`.
 */
import { formatLppValue, lppEntries } from "./lpp"

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-right text-sm font-medium tabular-nums">{value}</span>
    </div>
  )
}

function RawJson({ data }: { data: unknown }) {
  return (
    <details className="group">
      <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
        Raw response
      </summary>
      <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  )
}

/** Telemetry dialog body: typed rows for known LPP fields, raw JSON behind a toggle. */
export function TelemetryView({ data }: { data: unknown }) {
  const entries = lppEntries(data)
  if (!entries) {
    return (
      <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
        {JSON.stringify(data, null, 2)}
      </pre>
    )
  }
  return (
    <div className="space-y-3">
      <div className="divide-y divide-border/60">
        {entries.map((e, i) => (
          <ResultRow
            key={`${e.channel}-${i}`}
            label={`${e.type} · ch ${e.channel}`}
            value={formatLppValue(e.type, e.value)}
          />
        ))}
      </div>
      <RawJson data={data} />
    </div>
  )
}

/** ACL result: flat key/value rows when possible, raw JSON behind a toggle. */
export function AclView({ data }: { data: unknown }) {
  const isFlatObject =
    typeof data === "object" && data !== null && !Array.isArray(data)
  if (!isFlatObject) {
    return (
      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
        {JSON.stringify(data, null, 2)}
      </pre>
    )
  }
  const entries = Object.entries(data as Record<string, unknown>)
  return (
    <div className="space-y-3">
      <div className="divide-y divide-border/60">
        {entries.map(([k, v]) => (
          <ResultRow
            key={k}
            label={k.replaceAll("_", " ")}
            value={
              typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)
            }
          />
        ))}
      </div>
      <RawJson data={data} />
    </div>
  )
}
