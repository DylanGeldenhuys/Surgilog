export function httpsOrigin(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} is required.`);
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]'
  )
    throw new Error(`${name} must be a public HTTPS origin.`);
  return url.origin;
}
