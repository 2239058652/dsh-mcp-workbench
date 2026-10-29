Thanks for the PR! Please confirm the checklist before submitting.

## Checklist

- [ ] The full gate is green: `pnpm run typecheck && pnpm run typecheck:ci && pnpm test && pnpm run build && pnpm run verify:self-contained && pnpm run verify:artifacts`
- [ ] Tests were added or updated for the change
- [ ] `CHANGELOG.md` has an entry under `## [Unreleased]`
- [ ] `README.md` (the only README) is updated where the change touches docs
- [ ] A related issue is referenced (`Fixes #N`), or a short note explains why none applies
- [ ] No credentials, tokens, keys, or private paths are included in the diff

## Summary

<!-- What does this change do and why? Keep it short; the CHANGELOG entry carries the details. -->
