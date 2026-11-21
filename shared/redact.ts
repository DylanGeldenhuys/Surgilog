const SECRET_KEYS = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'body',
  'password',
  'passwd',
  'token',
  'idtoken',
  'accesstoken',
  'refreshtoken',
  'secret',
  'patient',
  'patientname',
  'phone',
  'dob',
  'diagnosis',
  'notes',
  'email',
  'bearer',
]);

const BEARER = /Bearer\s+\S+/gi;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+\d{1,3}(?:[\s().-]*\d){7,14}|\b0\d{2}[\s.-]\d{3}[\s.-]\d{4}\b/g;
const QUERY = /\?[^\s'"<>]*/g;
const DIGITS = /\d{5,}/g;
const NAME_PAIR = /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g;
const ICD10 = /\b[A-Z]\d{2}(?:\.\d{1,2})?\b/g;

export function redactText(value: string) {
  return value
    .replace(BEARER, 'Bearer [redacted]')
    .replace(JWT, '[redacted]')
    .replace(EMAIL, '[redacted]')
    .replace(PHONE, '[redacted]')
    .replace(QUERY, '')
    .replace(DIGITS, '[redacted]')
    .replace(ICD10, '[redacted]')
    .replace(NAME_PAIR, '[redacted]');
}

function isSecretKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
  return (
    SECRET_KEYS.has(normalized) ||
    normalized.includes('token') ||
    normalized.includes('password') ||
    normalized.includes('authorization') ||
    normalized.includes('cookie') ||
    normalized.includes('secret') ||
    normalized === 'body' ||
    normalized.endsWith('body')
  );
}

/** Walk a log payload and strip auth material, bodies, and patient fields. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[redacted]';
  if (typeof value === 'string') return redactText(value).slice(0, 4000);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactValue(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = isSecretKey(key) ? '[redacted]' : redactValue(item, depth + 1);
    }
    return out;
  }
  return '[redacted]';
}
