import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // `[overflow-wrap:anywhere]` forces long unbreakable strings (URLs,
        // base64, meshcore:// URIs) to wrap at character boundaries instead
        // of growing the textarea horizontally past its parent. Without it,
        // `field-sizing: content` auto-grows the box to fit a single long
        // line, breaking layout in narrow dialogs and on mobile.
        "flex field-sizing-content min-h-16 w-full [overflow-wrap:anywhere] rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
