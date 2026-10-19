export class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function readApiResponse<T>(response: Response): Promise<T> {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    // Gateways can return HTML or truncate a body. Preserve definitive HTTP denials;
    // a malformed success response leaves the write's outcome uncertain.
    throw new RequestError(
      response.ok ? 0 : response.status,
      response.ok
        ? 'The server response could not be confirmed. Retry the same request.'
        : `Request failed (${response.status}). Please try again.`,
    );
  }
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data ? data.error : undefined;
    throw new RequestError(
      response.status,
      typeof message === 'string' ? message : 'Request failed.',
    );
  }
  if (!data || typeof data !== 'object')
    throw new RequestError(
      0,
      'The server response could not be confirmed. Retry the same request.',
    );
  return data as T;
}
