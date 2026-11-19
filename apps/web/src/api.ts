import {
  ErrorBodySchema,
  MeResponseSchema,
  TradeViewSchema,
  type CreateTradeRequestInput,
  type ErrorBody,
  type MeResponse,
  type TradeView,
} from '@trade-journal/shared';

export class ApiError extends Error {
  readonly status: number;
  /** The parsed error body, when the API sent one we recognise (a 400). */
  readonly body?: ErrorBody;

  constructor(
    status: number,
    message = `API request failed with ${status}`,
    body?: ErrorBody,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (body) this.body = body;
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

/**
 * POST /trades. Resolves with the saved trade on a 201 whose body parses as a
 * `TradeView`. Any other status throws an `ApiError` with that status, and a
 * 400 carries its parsed `ErrorBody`. A 201 with a bad body throws status 0.
 */
export async function createTrade(
  apiUrl: string,
  accessToken: string,
  body: CreateTradeRequestInput,
  fetchFn: typeof fetch = (...args) => fetch(...args),
  signal?: AbortSignal,
): Promise<TradeView> {
  const response = await fetchFn(`${apiUrl}/trades`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (response.status !== 201) {
    let errorBody: ErrorBody | undefined;
    if (response.status === 400) {
      try {
        const parsed = ErrorBodySchema.safeParse(await response.json());
        if (parsed.success) errorBody = parsed.data;
      } catch {
        // Not JSON: the status alone is still reported.
      }
    }
    throw new ApiError(response.status, undefined, errorBody);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError(INVALID_RESPONSE_STATUS, 'Response is not valid JSON');
  }
  const parsed = TradeViewSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(
      INVALID_RESPONSE_STATUS,
      `Response is invalid: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
