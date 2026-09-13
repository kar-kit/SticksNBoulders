/** Monday, at midnight UTC, of the week containing the given date (defaults to now). */
export function startOfWeek(date: Date = new Date()): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d;
}

export function isSameWeek(a: Date, b: Date = new Date()): boolean {
  return startOfWeek(a).getTime() === startOfWeek(b).getTime();
}
