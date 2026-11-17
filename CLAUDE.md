# Trade Journal

Personal trading journal. React + Vite frontend, Lambda API, DynamoDB, AWS CDK.

## Commands (run from repo root)

- pnpm lint | pnpm typecheck | pnpm test | pnpm build
- pnpm --filter infra exec cdk synth

## Layout and ownership

- apps/web: React UI (frontend-dev)
- apps/api: Lambda handlers (backend-dev)
- packages/shared: zod schemas and types used by web and api (backend-dev)
- infra: CDK stacks (infra-dev)
- docs/spec: one spec per feature, written before code

## Rules

- Work on a branch, never on main. Open a pull request for every change.
- All four check commands must pass before a task is done.
- Money and prices are integer minor units or decimal strings, never floats.
- Timestamps are stored in UTC, ISO 8601.
- Never run cdk deploy or cdk destroy. Deploys happen in CI.
- Never read or write .env files.
