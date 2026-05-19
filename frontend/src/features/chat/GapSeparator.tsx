/**
 * Small pill that marks a long quiet stretch between two message groups
 * inside the same day (e.g. "4 hours later").
 */
export function GapSeparator({ label }: { label: string }) {
  return (
    <div className="my-2 flex justify-center">
      <span className="rounded-full bg-muted/60 px-3 py-0.5 text-[10px] text-muted-foreground">
        {label}
      </span>
    </div>
  )
}
