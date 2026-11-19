import { z } from 'zod';

/** Response body of `GET /me`: the signed-in user's Cognito `sub`. */
export const MeResponseSchema = z.object({
  userId: z.string().min(1),
});

export type MeResponse = z.infer<typeof MeResponseSchema>;
