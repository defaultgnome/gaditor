/** Auto-labels for spawned streams: A, B, … Z, AA, AB, … (§2.2, §3.2). */
export function streamLabel(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

export function makeLabeller(start = 0) {
  let i = start
  return () => streamLabel(i++)
}
