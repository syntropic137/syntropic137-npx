# syntropic137-npx

This is a **helper package** for the [syntropic137/syntropic137](https://github.com/syntropic137/syntropic137) platform. Its sole purpose is to make deploying, starting, and managing the Syntropic137 self-hosted stack frictionless for users. Instead of cloning the main repo, installing Python, uv, and just, users run one command:

```
npx syntropic137 init
```

This repo publishes the `syntropic137` npm package. It lives in a separate repository (`syntropic137/syntropic137-npx`) from the main platform for supply chain security reasons — see [SECURITY.md](./SECURITY.md).

Tracks: syntropic137/syntropic137#387

## Relationship to the main repo

- **This repo does NOT contain the platform.** It only contains the CLI that sets up and manages the platform.
- **Templates come from the main repo.** The `templates/` directory contains files vendored from `syntropic137/syntropic137`'s `docker/` directory (compose file, entrypoint, env template, init SQL). These are the files that define the actual stack.
- **Template sync is automated but publishing is manual.** When the main repo cuts a release, a `repository_dispatch` triggers a PR here with updated templates. A human reviews, merges, and then manually triggers the npm publish workflow. The main repo cannot merge or publish — see SECURITY.md.
- **The GitHub App Manifest flow was ported from `infra/scripts/github_manifest.py`** in the main repo. If permissions or events change upstream, this file (`src/manifest.ts`) needs to be updated to match.
- **Installation IDs are not stored.** The platform resolves them dynamically per-repo at runtime since the GitHub App can be installed across multiple orgs.

## Security

**Read [SECURITY.md](./SECURITY.md) before making changes to CI, publishing, or template sync.**

Key invariants — do not violate these:

- **Zero runtime dependencies** — stdlib only, never add `dependencies` to package.json
- **No auto-publish** — npm publish always requires manual human approval
- **Templates are vendored** — embedded in the package, never fetched at runtime
- **No shared credentials** — this repo has no access to the main repo's secrets, and vice versa
- **`execFileSync` only** — never use `exec` with string interpolation for subprocess calls

## Build

```sh
npm install     # dev deps only (typescript, vitest, @types/node)
npm run build   # tsc → dist/
npm test        # vitest
```

## TypeScript

Strict mode is required. No `any` types. See tsconfig.json.
