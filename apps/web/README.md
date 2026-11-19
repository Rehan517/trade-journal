# Trade Journal web app

React + Vite single-page app for the trade journal. Sign-in uses Cognito
hosted login (OIDC, authorization code with PKCE).

## Local development

```sh
pnpm --filter web dev
```

The app fetches `/config.json` at startup. Locally, copy the deployed file
from `<WebUrl>/config.json` to `apps/web/public/config.json`. It is
gitignored and holds no secrets, only public identifiers. It now includes
`apiUrl` (the API base URL, with no trailing slash), so re-copy it after the
API is deployed. Sign-in and API calls work at `http://localhost:5173`.

## Checks

```sh
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web build
```
