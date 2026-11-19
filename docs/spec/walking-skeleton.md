# Spec: walking skeleton

Status: draft, awaiting review · Issue: #4 · Last updated: 2026-11-18

## Summary

The first slice through every layer, with no journal features. When it's
done, the CloudFront URL serves the web app, I sign in through Cognito's
hosted login, and the page shows my user ID as returned by an authenticated
API call.

The work ships as three PRs. Each one deploys through `Deploy dev` on merge
and is checked in a browser before the next one merges.

| PR  | Branch                          | Adds                                                     | Owners                               |
| --- | ------------------------------- | -------------------------------------------------------- | ------------------------------------ |
| 1   | `feat/walking-skeleton-hosting` | Private S3 + CloudFront serving `apps/web/dist`          | infra-dev, frontend-dev              |
| 2   | `feat/walking-skeleton-auth`    | Cognito user pool, hosted login, `/config.json`, sign-in | infra-dev, frontend-dev              |
| 3   | `feat/walking-skeleton-api`     | HTTP API, `GET /health`, `GET /me`, app calls `/me`      | infra-dev, backend-dev, frontend-dev |

## Changes from issue #4

This spec follows the brief given when it was requested. That brief differs
from the issue in these places. Update the issue to match before PR 1 merges.

| Issue #4                                                     | This spec                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Email sign-up and verification; sign-up in the web app       | Self sign-up disabled. One user (me), created once with an admin command. No sign-up UI.   |
| `GET /health` is behind the JWT authorizer                   | `GET /health` is public. A new `GET /me` is behind the authorizer and returns the user ID. |
| After sign-in the page shows the `GET /health` response      | After sign-in the page shows the `GET /me` response.                                       |
| `GET /health` without a valid token returns 401              | `GET /me` without a valid token returns 401.                                               |
| AC: "I can sign up with email, verify, sign in and sign out" | AC: "I can sign in with the account created for me, and sign out."                         |

The rest of the issue still applies: SPA fallback for deep links, `config.json`
next to the web build, web and API URLs in the stack outputs, CDK tests for
every new resource, and deploys only through CI.

## Architecture

```
Browser ──HTTPS──▶ CloudFront ──OAC──▶ S3 bucket (private)
   │                                   index.html, assets/*, config.json
   │
   ├──redirect──▶ Cognito managed login ──auth code (PKCE)──▶ back to the app
   │
   └──Authorization: Bearer <access token>──▶ API Gateway HTTP API
                                               GET /health  (public) ──▶ Lambda health.ts
                                               GET /me      (JWT)    ──▶ Lambda me.ts
```

Everything goes in the existing `TradeJournal-Dev` stack
(`infra/lib/infra-stack.ts`), with one construct per PR:

- `infra/lib/web-hosting.ts`: `WebHosting` (PR 1)
- `infra/lib/auth.ts`: `Auth` (PR 2)
- `infra/lib/api.ts`: `Api` (PR 3)

With one stack the constructs can reference each other directly, with no
cross-stack exports. `WebHosting` creates the bucket and distribution. The
stack creates the site's `BucketDeployment` last, so that it can include
values from `Auth` and `Api` in `config.json`. The `Trades` table is not
touched.

## Decisions

1. **One `BucketDeployment` for the bucket**, with two sources:
   `Source.asset(<apps/web/dist>, { exclude: ['config.json'] })` and
   `Source.jsonData('config.json', …)`. Two deployments to the same bucket
   would prune each other's files. The `exclude` keeps a local
   `public/config.json` out of the deployed build.
2. **Caching.** The deployment invalidates `/*` on the distribution and sets
   `Cache-Control: no-cache` on every object, so a deploy (including new
   config values) shows up on the next reload. Long-lived caching of hashed
   assets can come later.
3. **SPA fallback.** CloudFront error responses map both 403 and 404 to
   `/index.html` with status 200 and a TTL of 0. With OAC and no
   `s3:ListBucket`, a missing key comes back from S3 as 403, which is why 403
   is mapped too. A missing asset then also returns `index.html`. That's
   acceptable for now.
4. **Price class.** Keep the default (all edge locations). The cheaper price
   classes leave out Australia.
5. **Hosted login.** Use Cognito managed login
   (`ManagedLoginVersion.NEWER_MANAGED_LOGIN`) on the Essentials feature plan.
   Give the app client a style with Cognito's default look
   (`CfnManagedLoginBranding` with `useCognitoProvidedValues: true`), so the
   login page is styled from the first deploy. The domain is a Cognito prefix
   domain, `trade-journal-dev-<suffix>`. The suffix is 8 random lowercase hex
   characters, generated once and committed as a constant. Prefixes must be
   unique per region across all of AWS. A random suffix makes the prefix
   unique without putting the AWS account ID in the login URL.
6. **OIDC client in the web app.** Use `oidc-client-ts` with
   `react-oidc-context`, the authorization code flow with PKCE, and a public
   client (no secret). The authority is
   `https://cognito-idp.<region>.amazonaws.com/<userPoolId>`. These libraries
   are small, follow the standard and take their settings at runtime. Cognito's
   discovery document has no `end_session_endpoint`, so sign-out is done by
   hand. The app clears the local user, then redirects to
   `<authDomain>/logout?client_id=<id>&logout_uri=<origin>/`.
7. **Callback and sign-out URLs are the app root**, exactly
   `https://<distribution domain>/` and `http://localhost:5173/`. Cognito
   matches them exactly, including the trailing slash. The app builds both
   URIs as `window.location.origin + '/'`.
8. **The token sent to the API.** The app sends the access token as
   `Authorization: Bearer <token>`. The authorizer is `HttpUserPoolAuthorizer`
   with the app client as audience. Access tokens have no `aud` claim, so API
   Gateway checks their `client_id` claim against the audience instead. ID
   tokens also pass the authorizer (their `aud` is the client ID), so handlers
   also require `token_use` to be `access`.
9. **Creating the single user.** After PR 2 deploys, I run this once myself.
   An agent never runs it.

   ```sh
   aws cognito-idp admin-create-user --region ap-southeast-2 \
     --user-pool-id <UserPoolId output> \
     --username <my email> \
     --user-attributes Name=email,Value=<my email> Name=email_verified,Value=true
   ```

   Cognito emails a temporary password. The first sign-in asks for a new
   password. Creating the user outside CDK keeps my email out of the repo and
   the template. The Cognito console works too.

10. **Keep the user pool.** Leave CDK's default `RemovalPolicy.RETAIN` on the
    user pool. Trades will be keyed by the user's `sub`, and a replaced pool
    issues new `sub`s, which would orphan them. Avoid changes that replace the
    pool. Sign-in aliases, for example, can't be changed after creation.
11. **Lambda packaging.** Use `NodejsFunction` (esbuild) with entries in
    `apps/api/src/handlers/`, on arm64, Node.js 22.x (matching `.nvmrc`), with
    1-month log retention. Add `esbuild` as an infra devDependency so synth
    never falls back to Docker.
12. **Throttling.** Set `createDefaultStage: false` and add a `$default` stage
    with auto-deploy, a rate limit of 10 requests per second and a burst of 20.
    `/health` is public, so this caps what a scraper or a runaway client can
    cost.
13. **Authenticated by default.** The API's default authorizer is the Cognito
    authorizer, and `/health` opts out with `HttpNoneAuthorizer`. Routes added
    later need a token unless they say otherwise.

## Contracts

### `/config.json`

CDK writes this file at deploy time. The app fetches it before it renders
anything else. It holds no secrets: every value is a public identifier.

```jsonc
{
  "region": "ap-southeast-2",
  "userPoolId": "ap-southeast-2_AbCdEf123",
  "userPoolClientId": "1example23456789abcdefghij",
  "authDomain": "https://trade-journal-dev-123456789012.auth.ap-southeast-2.amazoncognito.com",
  "apiUrl": "https://abc123defg.execute-api.ap-southeast-2.amazonaws.com", // added in PR 3
}
```

- PR 2 writes the first four keys and PR 3 adds `apiUrl`. All keys are
  required in the PR that introduces them.
- `authDomain` and `apiUrl` have no trailing slash.
- The app validates the file with a zod schema in `apps/web/src/config.ts`.
  The file is a contract between infra and web, not part of the API, so the
  schema stays in `apps/web` rather than `packages/shared`.
- If the file is missing, unreachable or invalid, the app shows "Couldn't load
  app configuration" and does not start sign-in. The SPA fallback serves
  `index.html` for a missing `config.json`, so this check is what catches it.
- Local dev: copy the deployed file to `apps/web/public/config.json`, which is
  gitignored. Hosted login and the API both accept `http://localhost:5173`.

### API

The base URL is `apiUrl`. All bodies are JSON.

| Route         | Auth                       | 200 body                                                               | Errors                                                                      |
| ------------- | -------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /health` | None                       | `{ "status": "ok", "path": "/health", "timestamp": "<UTC ISO 8601>" }` | None                                                                        |
| `GET /me`     | Cognito JWT (access token) | `{ "userId": "<sub claim>" }`                                          | 401 `{ "message": "Unauthorized" }` for a missing, invalid or expired token |

- `/health` is the existing handler in `apps/api/src/handlers/health.ts`,
  unchanged.
- `MeResponseSchema` (`z.object({ userId: z.string().min(1) })`) and the
  `MeResponse` type live in `packages/shared`. The handler types its body with
  `MeResponse` (a type-only import). The web app parses the response with
  `MeResponseSchema`.
- The handler reads `sub` from `event.requestContext.authorizer.jwt.claims`.
  If it's missing or empty, which shouldn't happen behind the authorizer, the
  handler returns 401 `{ "message": "Unauthorized" }` rather than a 500.
- CORS:
  - Origins: exactly `https://<distribution domain>` and
    `http://localhost:5173`, with no trailing slash and no wildcard.
  - Methods: `GET` and `OPTIONS`. Headers: `authorization` and `content-type`.
  - Max age: 1 day. No credentials, because the token goes in a header, not a
    cookie.
  - API Gateway answers preflight requests itself, so there are no `OPTIONS`
    routes.

## Build and test rules (all PRs)

- **`apps/web/dist` must exist at synth time.** CI and `Deploy dev` run
  `pnpm build` before `cdk synth` and `cdk deploy`. However, `pnpm test`, which
  runs the infra Jest tests, comes before `pnpm build`. So the web-dist path is
  a stack prop, and tests pass a fixture directory
  (`infra/test/fixtures/web-dist/index.html`). If the real path is missing,
  synth fails with a message saying to run `pnpm build` first.
- **Skip Lambda bundling in infra tests** by setting
  `aws:cdk:bundling-stacks: []` in the test `App`'s context. The assertions
  don't need real bundles, and the tests stay fast.
- **First use of `packages/shared` (PR 3).** The package's `exports` point at
  `dist/`, but CI runs typecheck and test before build. Change the root
  `typecheck` and `test` scripts to build shared first, for example
  `pnpm --filter @trade-journal/shared build && pnpm -r typecheck`.
  `apps/api` and `apps/web` add `"@trade-journal/shared": "workspace:*"`.
  `pnpm -r build` already runs in dependency order.
- Every new or changed resource gets an `aws-cdk-lib/assertions` test.
- Every PR must pass `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
  and `pnpm --filter infra exec cdk synth`.
- Nobody runs `cdk deploy` locally. Each PR is checked in the browser after
  `Deploy dev` finishes on `main`. The stack outputs are printed at the end of
  the workflow's deploy step and are also in the CloudFormation console.

---

## PR 1: Hosting

Branch: `feat/walking-skeleton-hosting`.

### Infra (`WebHosting`)

- S3 bucket:
  - Block all public access. No static website hosting.
  - S3-managed encryption, SSL enforced.
  - `RemovalPolicy.DESTROY` with `autoDeleteObjects` (dev only, like the
    `Trades` table).
- CloudFront distribution:
  - Origin: `S3BucketOrigin.withOriginAccessControl(bucket)`, read access
    only.
  - `defaultRootObject: 'index.html'`, with HTTP redirected to HTTPS.
  - The managed `CachingOptimized` cache policy and the managed
    `SECURITY_HEADERS` response headers policy.
  - The SPA fallback from decision 3.
- A `BucketDeployment` of `apps/web/dist`, with the invalidation and
  `Cache-Control` from decision 2.
- Outputs: `WebUrl` (`https://<distribution domain>`) and `WebBucketName`.

### Web

- Replace the Vite starter page with a minimal page: a "Trade Journal"
  heading and the line "Walking skeleton". Set the document `<title>` to
  "Trade Journal".
- Delete the starter assets and CSS that are no longer used.

### Automated tests

Infra (Jest):

- The bucket has all four public access blocks on and no
  `WebsiteConfiguration`.
- The bucket policy grants `s3:GetObject` only to `cloudfront.amazonaws.com`,
  on the condition that the source is this distribution's ARN.
- The distribution has an origin access control, `DefaultRootObject:
index.html`, `ViewerProtocolPolicy: redirect-to-https`, and custom error
  responses for 403 and 404 that serve `/index.html` with status 200.
- There is exactly one `Custom::CDKBucketDeployment`. It targets the bucket
  and invalidates the distribution.
- The `WebUrl` and `WebBucketName` outputs exist.

### Browser acceptance criteria

Check these after `Deploy dev` finishes:

- [ ] `WebUrl` shows the "Trade Journal" page, and the tab title is "Trade
      Journal".
- [ ] `http://<distribution domain>` redirects to `https://`.
- [ ] A deep path such as `WebUrl/trades/2026/11/abc` shows the same page,
      not an XML error.
- [ ] `https://<WebBucketName>.s3.ap-southeast-2.amazonaws.com/index.html`
      returns `AccessDenied`.
- [ ] In DevTools → Network, the page response has a
      `strict-transport-security` header and
      `x-content-type-options: nosniff`.

---

## PR 2: Auth

Branch: `feat/walking-skeleton-auth`. Builds on PR 1: the callback URLs use
the distribution domain.

### Infra (`Auth`)

- User pool:
  - `selfSignUpEnabled: false`. Sign-in with email
    (`signInAliases: { email: true }`), `autoVerify: { email: true }`.
  - Account recovery by email only. Default password policy. MFA off for
    now; it can be turned on later without replacing the pool.
  - `featurePlan: FeaturePlan.ESSENTIALS`, `RemovalPolicy.RETAIN`.
  - `signInCaseSensitive: false`. This can't be changed without replacing
    the pool (decision 10), so it's set from the start.
- Domain: the prefix domain from decision 5, using managed login.
- App client:
  - No secret. OAuth authorization code grant only, no implicit grant.
  - Auth flows exactly SRP and refresh (`authFlows: { userSrp: true }`).
    Managed login uses the client's enabled flows, so SRP stays; setting the
    list explicitly keeps Cognito's default `ALLOW_CUSTOM_AUTH` off.
  - Scopes `openid` and `email`. Cognito is the only identity provider.
  - Callback URLs and logout URLs are exactly `https://<distribution domain>/`
    and `http://localhost:5173/`.
  - `preventUserExistenceErrors: true`. Default token lifetimes: 1 hour for
    the access and ID tokens, 30 days for the refresh token.
- A managed login branding style for the app client, using Cognito-provided
  values.
- The site `BucketDeployment` adds
  `Source.jsonData('config.json', { region, userPoolId, userPoolClientId, authDomain })`.
- Outputs: `UserPoolId`, `UserPoolClientId` and `AuthDomain`.

### Web

- Startup: fetch `/config.json` with `cache: 'no-store'` and validate it.
- Then mount `AuthProvider` from `react-oidc-context` with:
  - the authority and `client_id` from the config
  - `redirect_uri` and `post_logout_redirect_uri` set to
    `window.location.origin + '/'`
  - `response_type: 'code'` and `scope: 'openid email'`
  - an `onSigninCallback` that removes `code` and `state` from the URL
- Signed out: a "Trade Journal" heading and a "Sign in" button that calls
  `signinRedirect()`. The app does not redirect to the login page by itself.
- Signed in: `Signed in as <email>` and a "Sign out" button.
- Sign out: call `removeUser()`, then redirect to the Cognito logout URL from
  decision 6.
- Errors:
  - A config failure shows the message from the config contract.
  - A sign-in failure (an `error` returned by Cognito, or a failed code
    exchange) shows `Sign-in failed: <message>` and a "Try again" button.
- Tokens stay in the library's default store, `sessionStorage`. They survive
  a reload but not a new tab.
- Add `apps/web/public/config.json` to `.gitignore`. Replace the Vite template
  README in `apps/web/README.md` with the local dev setup.
- Add `@testing-library/react` and `jsdom` for component tests.

### Automated tests

Infra (Jest):

- The user pool has `AdminCreateUserConfig.AllowAdminCreateUserOnly: true`,
  `UsernameAttributes: ["email"]` and `DeletionPolicy: Retain`.
- The app client:
  - has no secret
  - has `AllowedOAuthFlows: ["code"]` and
    `AllowedOAuthFlowsUserPoolClient: true`
  - has exactly the scopes `openid` and `email`
  - has exactly the two callback URLs and the two logout URLs above
- The domain has `ManagedLoginVersion: 2`, and a
  `AWS::Cognito::ManagedLoginBranding` exists for the client.
- There is still exactly one `Custom::CDKBucketDeployment`, and its sources
  reference the user pool, the client and the domain.
- The `UserPoolId`, `UserPoolClientId` and `AuthDomain` outputs exist.

Web (Vitest):

- The config loader accepts a valid config. It rejects:
  - a body that isn't JSON (the SPA-fallback case)
  - a config with a missing key
  - an `authDomain` that isn't `https`
- The OIDC settings built from a config and an origin have:
  - the expected authority and client ID
  - a redirect URI with the trailing slash
  - `response_type: 'code'`
- The logout URL has the `client_id` and an encoded `logout_uri`.
- With a mocked auth context:
  - the signed-out view shows "Sign in"
  - the signed-in view shows the email and "Sign out"
- A config failure shows the error message.

### Manual step after deploy

Create my user with the command in decision 9.

### Browser acceptance criteria

- [ ] `WebUrl/config.json` shows the four keys with real values, and they
      match the stack outputs.
- [ ] `WebUrl` shows "Trade Journal" and a "Sign in" button. The PR 1 page is
      gone without a manual invalidation.
- [ ] "Sign in" opens a styled Cognito login page on `AuthDomain`, not an
      error page. It has no "Sign up" link.
- [ ] I sign in with the emailed temporary password and am asked for a new
      password. I then land back on `WebUrl`, which shows "Signed in as"
      with my email. The address bar has no `?code=` left in it.
- [ ] Reloading the page keeps me signed in.
- [ ] "Sign out" returns me to the signed-out page. Clicking "Sign in" again
      asks for my password, which shows the Cognito session was cleared too.
- [ ] A wrong password shows Cognito's error on the login page and doesn't
      sign me in.
- [ ] Locally, sign-in and sign-out work at `http://localhost:5173`. To run
      locally: copy `WebUrl/config.json` to `apps/web/public/config.json`,
      then run `pnpm --filter web dev`.

---

## PR 3: API

Branch: `feat/walking-skeleton-api`.

### Shared

- Add `packages/shared/src/me.ts` with `MeResponseSchema` and `MeResponse`,
  and export both from the index.
- Change the root `typecheck` and `test` scripts to build shared first (see
  Build and test rules).

### API

- Add `apps/api/src/handlers/me.ts`. Its event type is
  `APIGatewayProxyEventV2WithJWTAuthorizer`.
  - It returns 200 `{ "userId": <sub> }` with
    `content-type: application/json`.
  - If `sub` is missing or empty, it returns 401
    `{ "message": "Unauthorized" }`.
- `health.ts` is unchanged.

### Infra (`Api`)

- An HTTP API with the CORS settings from the API contract, plus the stage and
  throttling from decision 12.
- Two `NodejsFunction`s, `HealthFunction` and `MeFunction`, built as in
  decision 11. Their roles only get basic execution permissions (logs).
- Routes:
  - The API's default authorizer is the `HttpUserPoolAuthorizer` for the PR 2
    user pool and app client.
  - `GET /health` uses `HttpNoneAuthorizer`.
  - `GET /me` uses the default authorizer.
- The site `BucketDeployment` adds `apiUrl` (`httpApi.apiEndpoint`, which has
  no trailing slash) to `config.json`.
- Output: `ApiUrl`.

### Web

- `apiUrl` becomes a required key in the config schema.
- After sign-in:
  - Call `GET <apiUrl>/me` with `Authorization: Bearer <access token>`.
  - Parse the response with `MeResponseSchema` and show
    `API user ID: <userId>`.
  - Also show the ID token's `sub` as `Token user ID: <sub>`, so the two can
    be compared.
- While the call is in flight, show "Calling API…".
- If the call fails (non-200, network error, or a body that fails the
  schema), show `API call failed: <status or reason>` and a "Retry" button.
- AWS doesn't document whether authorizer 401s carry CORS headers. In the
  browser, a rejected token may therefore look like a network error rather
  than a 401. The app shows both the same way.

### Automated tests

API (Vitest):

- `/me` with a `sub` claim returns 200 and `{ userId }` equal to the claim,
  and the body passes `MeResponseSchema`.
- `/me` returns 401 when the claims or `sub` are missing, or `sub` is empty.

Infra (Jest):

- The `AWS::ApiGatewayV2::Api` CORS `AllowOrigins` is exactly the
  distribution URL and `http://localhost:5173`, and `AllowCredentials` is not
  true.
- The `GET /me` route has `AuthorizationType: JWT`. Its authorizer's issuer is
  the user pool and its audience is the app client.
- The `GET /health` route has `AuthorizationType: NONE`.
- The `$default` stage has auto-deploy and the throttling limits.
- Both functions are arm64 and Node.js 22.x. Their roles have no policies
  beyond basic execution.
- The `BucketDeployment` sources reference the API, and the `ApiUrl` output
  exists.

Web (Vitest):

- The `/me` client:
  - sends the bearer token
  - returns the parsed body on 200
  - throws on a non-200 response, a network error, or a body that fails the
    schema
- The signed-in view shows the loading state, then the user ID from `/me`. On
  a failure it shows the error state and "Retry".

### Browser acceptance criteria

- [ ] Opening `<ApiUrl>/health` in the address bar, without signing in,
      returns 200 with `"status":"ok"`.
- [ ] Opening `<ApiUrl>/me` in the address bar returns 401
      `{"message":"Unauthorized"}`.
- [ ] After sign-in, `WebUrl` shows "API user ID: …". It equals "Token user
      ID" and the user's `sub` in the Cognito console.
- [ ] In DevTools → Network, the `/me` request carries
      `Authorization: Bearer …`. Its preflight response has
      `access-control-allow-origin: https://<distribution domain>`.
- [ ] In the DevTools console on `WebUrl`,
      `fetch('<ApiUrl>/me', { headers: { Authorization: 'Bearer nope' } })`
      returns no user ID. It's expected to give 401. If the browser reports a
      CORS error instead, note it in the PR.
- [ ] In the DevTools console on `https://example.com`,
      `fetch('<ApiUrl>/health')` fails with a CORS error.
- [ ] Locally, with `apiUrl` added to `apps/web/public/config.json`, signing
      in at `http://localhost:5173` also shows the API user ID.
- [ ] After sign-out, the page shows the signed-out view and makes no `/me`
      call.
- [ ] The stack outputs include `WebUrl` and `ApiUrl`.

---

## Out of scope

- Journal features and any DynamoDB access. The `Trades` table is untouched.
- Self sign-up, sign-up UI, social login and custom domains.
- MFA. It will be added later in its own PR.
- WAF, API access logs and alarms.
- Long-lived caching for hashed assets.
- An e2e test runner. The browser checks above are manual for now.
- Any environment other than dev.
