/**
 * Horizontal day boundary inside the chat scroller (e.g. "Today", "Yesterday").
 */
export function DateSeparator({ label }: { label: string }) {
  return (
    <div className="my-4 flex items-center gap-3">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-medium uppercase tracking-wider tabular-nums text-muted-foreground">
        {label}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}
