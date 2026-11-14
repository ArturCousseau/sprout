/**
 * The PORT environment variable as a number from 0 to 65535, or null when it
 * is not only decimal digits or is out of range. 0 lets the system pick a
 * free port. Only digits pass, so the number is never negative.
 */
export function parsePort(text: string): number | null {
  const port = Number(text);
  if (!/^\d+$/.test(text) || port > 65535) return null;
  return port;
}
