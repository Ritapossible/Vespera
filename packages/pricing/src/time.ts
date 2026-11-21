/** New York wall-clock time -> unix seconds, DST-aware, without dependencies. */
export function nyToUnix(y: number, m: number, d: number, hh: number, mm = 0): number {
  // Start from the UTC guess, then correct by the NY offset at that instant (twice for DST edges).
  let t = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const off = nyOffsetMinutes(t);
    t = Date.UTC(y, m - 1, d, hh, mm) - off * 60_000;
  }
  return Math.floor(t / 1000);
}

function nyOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
  return Math.round((asUtc - utcMs) / 60_000); // e.g. -300 for EST
}

/** Feed week boundaries observed on-chain: the 24/5 session ends Friday 20:00 ET and
 *  resumes Sunday 20:00 ET. Returns [close, reopen] for the weekend after `friday`. */
export function weekendBounds(friday: Date): [number, number] {
  const y = friday.getUTCFullYear(), m = friday.getUTCMonth() + 1, d = friday.getUTCDate();
  const close = nyToUnix(y, m, d, 20);
  const sun = new Date(Date.UTC(y, m - 1, d + 2));
  const reopen = nyToUnix(sun.getUTCFullYear(), sun.getUTCMonth() + 1, sun.getUTCDate(), 20);
  return [close, reopen];
}

export const iso = (t: number) => new Date(t * 1000).toISOString().replace(".000Z", "Z");
