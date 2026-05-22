// MeshCore contact type integers (per docs/external/meshcore/qr_codes.md
// and the upstream CLI source). Type 1 is the only kind that accepts
// plain DMs; 2/3/4 are admin-command targets via a different protocol
// path that this WebUI doesn't yet implement.
export const COMPANION = 1
export const REPEATER = 2
export const ROOM = 3
export const SENSOR = 4

/**
 * True when this contact accepts a plain user-typed message (a DM).
 * False for repeaters, rooms, and sensors — those receive admin commands.
 * Returns true when the type is unknown (`null`/`undefined`) so contacts
 * with missing metadata don't get hidden by accident.
 */
export function isMessageableContact(type: number | null | undefined): boolean {
  return type === COMPANION || type == null
}
