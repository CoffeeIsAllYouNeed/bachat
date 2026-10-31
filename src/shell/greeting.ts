/** "Good morning / afternoon / evening, <first name>" — null when there is no name. */
export function greeting(name: string, now = new Date()): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0];
  if (!first) return null;
  const h = now.getHours();
  const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return `Good ${part}, ${first}`;
}
