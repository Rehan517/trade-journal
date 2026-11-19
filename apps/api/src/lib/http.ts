import type { ErrorBody } from '@trade-journal/shared';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';

// Per-user data: never let a browser or proxy cache it.
const headers = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

export const json = (
  statusCode: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers,
  body: JSON.stringify(body),
});

const error = (statusCode: number, body: ErrorBody) => json(statusCode, body);

export const unauthorized = () => error(401, { message: 'Unauthorized' });
export const notFound = () => error(404, { message: 'Trade not found' });
export const internalError = () => error(500, { message: 'Internal error' });
export const badRequest = (message: string) => error(400, { message });

/** A 400 for one field, in the same shape as `validationError`. */
export const fieldError = (message: string, field: string, detail: string) =>
  error(400, { message, fieldErrors: { [field]: [detail] }, formErrors: [] });

export const validationError = (message: string, err: z.ZodError) => {
  const { fieldErrors, formErrors } = z.flattenError(err);
  return error(400, { message, fieldErrors, formErrors });
};
