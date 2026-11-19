import { z } from 'zod';

// These values are placed straight into URLs, so check their exact shapes.
export const ConfigSchema = z
  .object({
    region: z
      .string()
      .regex(/^[a-z]{2}(-[a-z]+)+-\d+$/, 'must be an AWS region'),
    userPoolId: z
      .string()
      .regex(/^[a-z0-9-]+_[A-Za-z0-9]+$/, 'must be a user pool ID'),
    userPoolClientId: z
      .string()
      .regex(/^[a-z0-9]+$/, 'must be an app client ID'),
    authDomain: z
      .string()
      .regex(
        /^https:\/\/[a-z0-9-]+\.auth\.[a-z0-9-]+\.amazoncognito\.com$/,
        'must be a Cognito domain URL with no trailing slash',
      ),
  })
  .refine((c) => c.userPoolId.startsWith(`${c.region}_`), {
    message: 'userPoolId must be in the configured region',
    path: ['userPoolId'],
  });

export type AppConfig = z.infer<typeof ConfigSchema>;

export const CONFIG_ERROR_MESSAGE = "Couldn't load app configuration";

export async function loadConfig(
  fetchFn: typeof fetch = (...args) => fetch(...args),
): Promise<AppConfig> {
  const response = await fetchFn('/config.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(
      `config.json request failed with status ${response.status}`,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('config.json is not valid JSON');
  }
  const parsed = ConfigSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`config.json is invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}
