import {
  ErrorBodySchema,
  ListTradesResponseSchema,
  MeResponseSchema,
  TradeViewSchema,
  type CreateTradeRequestInput,
  type ErrorBody,
  type ListTradesResponse,
  type MeResponse,
  type TradeView,
  type UpdateTradeRequestInput,
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

/** Status 0 marks a successful response whose body didn't match the schema. */
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

async function readErrorBody(
  response: Response,
): Promise<ErrorBody | undefined> {
  if (response.status !== 400) return undefined;
  try {
    const parsed = ErrorBodySchema.safeParse(await response.json());
    if (parsed.success) return parsed.data;
  } catch {
    // Not JSON: the status alone is still reported.
  }
  return undefined;
}

/**
 * PATCH /trades/{id} with a merge patch. Resolves with the updated trade on a
 * 200 whose body parses as a `TradeView`. Any other status throws an
 * `ApiError` with that status (a 400 carries its parsed `ErrorBody`); a 200
 * with a bad body throws status 0.
 */
export async function updateTrade(
  apiUrl: string,
  accessToken: string,
  id: string,
  patch: UpdateTradeRequestInput,
  fetchFn: typeof fetch = (...args) => fetch(...args),
  signal?: AbortSignal,
): Promise<TradeView> {
  const response = await fetchFn(`${apiUrl}/trades/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
    signal,
  });
  if (response.status !== 200) {
    throw new ApiError(
      response.status,
      undefined,
      await readErrorBody(response),
    );
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

/**
 * DELETE /trades/{id}. Resolves on a 204, and on a 404 (the trade is gone
 * either way). Any other status throws an `ApiError` with that status.
 */
export async function deleteTrade(
  apiUrl: string,
  accessToken: string,
  id: string,
  fetchFn: typeof fetch = (...args) => fetch(...args),
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetchFn(`${apiUrl}/trades/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (response.status !== 204 && response.status !== 404) {
    throw new ApiError(response.status);
  }
}

const SIGNED_DECIMAL = /^-?\d+(\.\d+)?$/;

export interface ListTradesParams {
  /** Inclusive lower bound on `openedAt`, UTC ISO 8601. */
  from?: string;
  /** Exclusive upper bound on `openedAt`, UTC ISO 8601. */
  to?: string;
  limit?: number;
  cursor?: string;
}

/**
 * GET /trades with an optional `openedAt` range. Resolves with one page whose
 * body parses as a `ListTradesResponse`. Any status but 200 throws an
 * `ApiError` with that status; a 200 with a bad body throws status 0.
 */
export async function listTrades(
  apiUrl: string,
  accessToken: string,
  params: ListTradesParams = {},
  fetchFn: typeof fetch = (...args) => fetch(...args),
  signal?: AbortSignal,
): Promise<ListTradesResponse> {
  const query = new URLSearchParams();
  if (params.from !== undefined) query.set('from', params.from);
  if (params.to !== undefined) query.set('to', params.to);
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.cursor !== undefined) query.set('cursor', params.cursor);
  const qs = query.toString();
  const search = qs ? `?${qs}` : '';
  const response = await fetchFn(`${apiUrl}/trades${search}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (response.status !== 200) throw new ApiError(response.status);
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError(INVALID_RESPONSE_STATUS, 'Response is not valid JSON');
  }
  const parsed = ListTradesResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(
      INVALID_RESPONSE_STATUS,
      `Response is invalid: ${parsed.error.message}`,
    );
  }
  // The pages do exact maths and formatting on these, so a malformed one is a
  // bad response here, not a crash at render time.
  for (const trade of parsed.data.items) {
    for (const name of ['netPnl', 'rMultiple'] as const) {
      const value = trade.metrics[name];
      if (value !== undefined && !SIGNED_DECIMAL.test(value)) {
        throw new ApiError(
          INVALID_RESPONSE_STATUS,
          `Response is invalid: a trade has a malformed ${name}`,
        );
      }
    }
  }
  return parsed.data;
}
