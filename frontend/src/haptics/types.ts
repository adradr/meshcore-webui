// frontend/src/haptics/types.ts

/**
 * Semantic haptic vocabulary. Call sites speak intent — the provider maps
 * to web-haptics presets. Adding a new preset (or swapping libraries)
 * means editing one file (HapticProvider.tsx), not 50 call sites.
 */
export interface HapticHandle {
  /** Subtle confirmation a tap was received. Buttons, toggles, copy actions. */
  tap: () => void
  /** Selection change — picker item, swipe-to-reply threshold cross, mention pick. */
  select: () => void
  /** A meaningful action completed. Send-ack, ping success, save settings. */
  success: () => void
  /** Destructive confirm or risky action. Wipe, reset, take-over. */
  warn: () => void
  /** A meaningful action FAILED. Toast errors, ping timeout, upload reject. */
  error: () => void
  /** Attention nudge — incoming DM, push notification received in foreground. */
  nudge: () => void
  /** Whether haptics are currently enabled by user preference. */
  enabled: boolean
  /** Toggle the user preference; persists to localStorage. */
  setEnabled: (v: boolean) => void
}
