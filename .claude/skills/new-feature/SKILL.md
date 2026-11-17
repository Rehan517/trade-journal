---
name: new-feature
description: Build a feature end to end from a spec. Use when asked to implement a new feature.
argument-hint: '[feature-name]'
---

Build the feature $ARGUMENTS.

1. Read docs/spec/$ARGUMENTS.md. If it does not exist, stop and ask for it.
2. Create a branch named feat/$ARGUMENTS.
3. Use the backend-dev subagent to update packages/shared schemas and apps/api.
4. Use the frontend-dev subagent to build the UI against those schemas.
5. Use the test-engineer subagent to add tests from the spec.
6. Run pnpm lint, pnpm typecheck, pnpm test, pnpm build. Fix failures.
7. Use the code-reviewer subagent on the diff and fix what it finds.
8. Commit, push and open a pull request with gh pr create.
