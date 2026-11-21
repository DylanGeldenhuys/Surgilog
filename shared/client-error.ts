import { redactText } from './redact.ts';

export type ClientErrorReport = {
  reference: string;
  name?: string;
  message: string;
  stack?: string;
};

const FRAME = /^at (?:async )?([\w$.<>]+) \((https?:\/\/.+):(\d+):(\d+)\)$/;

export function safeErrorName(name: unknown) {
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(name) ? name : 'Error';
}

export async function messageFingerprint(message: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/** Keep same-origin `at fn (url:line:col)` frames. Drop message text and other origins. */
export function clientStackFrames(stack: string | undefined, origin: string | undefined) {
  if (!stack || !origin) return undefined;
  let allowed = '';
  try {
    allowed = new URL(origin).origin;
  } catch {
    return undefined;
  }
  const frames: string[] = [];
  for (const raw of stack.split('\n')) {
    const match = FRAME.exec(raw.trim());
    if (!match) continue;
    let url: URL;
    try {
      url = new URL(match[2]);
    } catch {
      continue;
    }
    if (url.origin !== allowed) continue;
    frames.push(`at ${match[1]} (${url.origin}${url.pathname}:${match[3]}:${match[4]})`);
    if (frames.length >= 10) break;
  }
  return frames.length ? frames.join('\n') : undefined;
}

/** Server stacks keep `at ...` lines only, with names, long numbers and codes removed. */
export function serverStackFrames(stack: string | undefined) {
  if (!stack) return undefined;
  const frames = stack
    .split('\n')
    .map((line) => redactText(line.trim()))
    .filter((line) => line.startsWith('at '))
    .slice(0, 10);
  return frames.length ? frames.join('\n') : undefined;
}

export async function clientErrorPayload(report: ClientErrorReport, origin?: string) {
  const stack = clientStackFrames(report.stack, origin);
  return {
    reference: report.reference,
    name: safeErrorName(report.name),
    fingerprint: await messageFingerprint(report.message),
    ...(stack ? { stack } : {}),
  };
}
