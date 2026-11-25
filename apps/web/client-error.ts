import { apiOrigin } from './config.ts';
import { clientErrorPayload, type ClientErrorReport } from '../../shared/client-error.ts';

export async function postClientError(
  report: ClientErrorReport,
  options?: { origin?: string; fetchImpl?: typeof fetch; token?: string; frameOrigin?: string },
) {
  const payload = await clientErrorPayload(report, options?.frameOrigin);
  const fetchImpl = options?.fetchImpl ?? fetch;
  const origin = options?.origin ?? apiOrigin;
  try {
    const response = await fetchImpl(`${origin}/api/client-errors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const headerId = response.headers.get('x-request-id') ?? undefined;
    if (!response.ok) return headerId;
    const data = (await response.json().catch(() => null)) as { requestId?: unknown } | null;
    return typeof data?.requestId === 'string' ? data.requestId : headerId;
  } catch {
    return undefined;
  }
}
