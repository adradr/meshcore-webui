// Defense-in-depth sanitisation: filename segments may incorporate radio-
// supplied identifiers (pubkey prefixes, contact names). Browsers mostly
// scrub `a.download`, but strip path separators and control bytes ourselves
// and cap the length so we never hand a hostile string to the OS save dialog.
function sanitiseDownloadName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[/\\?%*:|"<>\x00-\x1f]/g, "_").slice(0, 200)
}

export function downloadBlob(
  content: string,
  filename: string,
  mime: string,
): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = sanitiseDownloadName(filename)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
