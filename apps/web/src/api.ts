import { MeResponseSchema, type MeResponse } from '@trade-journal/shared';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message = `API request failed with ${status}`) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Status 0 marks a 200 response whose body didn't match the schema. */
export const INVALID_RESPONSE_STATUS = 0;

export async function fetchMe(
  apiUrl: string,
  accessToken: string,
  fetchFn: typeof fetch = (...args) => fetch(...args),
  signal?: AbortSignal,
): Promise<MeResponse> {
  const response = await fetchFn(`${apiUrl}/me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (response.status !== 200) throw new ApiError(response.status);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(INVALID_RESPONSE_STATUS, 'Response is not valid JSON');
  }
  const parsed = MeResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      INVALID_RESPONSE_STATUS,
      `Response is invalid: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
