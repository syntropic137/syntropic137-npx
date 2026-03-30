# Repository Setup

This repo is the supply chain entry point for every `npx @syntropic137/setup` user. The configuration below ensures that no code reaches npm without human review and approval, even if the main platform repo is compromised.

## Secrets

Only one GitHub Actions secret is required. npm publishing uses Trusted Publishing (OIDC) — no npm token is stored anywhere.

| Secret | Repo | Purpose |
|--------|------|---------|
| `NPX_DISPATCH_TOKEN` | **main repo** (`syntropic137/syntropic137`) | Fine-grained PAT scoped to `syntropic137/syntropic137-npx` only, with `Actions: Read and write`. Used to trigger `workflow_dispatch` events via `gh workflow run` that start template sync PRs. |

> **Why `Actions: Read and write`?** The dispatch uses `gh workflow run` (workflow_dispatch),
> not `repository_dispatch`. This only requires `Actions` permission — no `contents:write`
> needed. The token can trigger workflow runs but cannot push code, merge PRs, or modify
> releases.

### npm Trusted Publishing

Instead of storing an npm token, the publish workflow authenticates via OIDC. The npm registry verifies the request came from this specific repo, workflow, and environment. Configure on npmjs.com under `@syntropic137/setup` → Settings → Publishing access → Trusted Publisher.

### Additional hardening

- Create a **`npm-publish` environment** in this repo's GitHub settings with required reviewers — this adds an approval gate before the publish workflow can run

## Branch protection and code owners

A `CODEOWNERS` file at `.github/CODEOWNERS` automatically requests review from designated maintainers on every PR. To make this enforceable:

1. Go to **Settings → Branches → Branch protection rules**
2. Add a rule for `main`
3. Enable:
   - **Require a pull request before merging**
   - **Require approvals** (at least 1)
   - **Require review from Code Owners** — this is the critical setting. It means template sync PRs and workflow changes cannot be merged without an explicit approval from a code owner.
   - **Require status checks to pass before merging** — select the CI workflow
   - **Do not allow bypassing the above settings** — prevents admins from force-merging without review

This ensures that even automated PRs (like template sync) require a human code owner to approve before merge. The publish workflow is a separate manual step on top of this.

### Why this matters for the dispatch token

The `NPX_DISPATCH_TOKEN` only has `Actions: Read and write` — it can trigger workflow
runs but cannot push code or open PRs directly. With branch protection configured:

- The token **can** trigger workflow runs (template sync)
- The token **cannot** push to any branch — no `contents:write`
- The token **cannot** merge to `main` — requires code owner approval
- The token **cannot** trigger npm publish — that requires a separate `workflow_dispatch`

## Upstream dispatch (connecting the main repo)

When the main platform repo cuts a release, it notifies this repo to sync templates. This is a one-way notification — the main repo can open a PR here, but cannot merge it or publish to npm.

### Setup in the main repo

1. Create a fine-grained PAT scoped to `syntropic137/syntropic137-npx` only with `Actions: Read and write` permission
2. Add it as a secret `NPX_DISPATCH_TOKEN` in the main repo (`syntropic137/syntropic137`)
3. The release workflow (`release-containers.yaml`) already includes a step that runs `gh workflow run template-sync.yml` — see [UPSTREAM_DISPATCH.md](../.github/UPSTREAM_DISPATCH.md) for the snippet

This sends the release tag as `ref` so the CLI repo pulls templates from the exact tagged commit, not HEAD.

### What happens next (in this repo)

1. The `template-sync.yml` workflow fires and opens a PR with updated templates
2. A code owner reviews the diff against the release notes
3. The code owner merges the PR
4. A human manually triggers the `publish.yml` workflow to publish to npm

### Why this is safe even if the main repo is compromised

- The dispatch token can only open PRs — it cannot merge them or trigger npm publish
- CODEOWNERS + branch protection require human approval before merge
- npm publish is a separate `workflow_dispatch` that requires manual trigger
- Templates are vendored at build time, never fetched at runtime — what ships in the package is exactly what was reviewed

See also: [UPSTREAM_DISPATCH.md](../.github/UPSTREAM_DISPATCH.md) for the raw workflow snippet.
