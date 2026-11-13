/**
 * The PORT environment variable as a number, or null when it is not only
 * decimal digits or is out of range.
 */
export function parsePort(text: string): number | null {
  const port = Number(text);
  if (!/^\d+$/.test(text) || port < 1 || port > 65535) return null;
  return port;
}
