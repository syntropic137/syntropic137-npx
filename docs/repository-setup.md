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

- Create a **`npm-publish` environment** in this repo's GitHub settings:
  - **Deployment branch restriction**: only allow `main` — ensures publish always deploys reviewed code
  - **Wait timer** (e.g. 30 minutes): gives you time to notice and cancel a rogue publish run
  - **Required reviewers** (if you have multiple maintainers): adds an approval gate before publish

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

- The token **can** trigger any `workflow_dispatch` workflow (template sync *and* publish)
- The token **cannot** push to any branch — no `contents:write`
- The token **cannot** merge to `main` — requires code owner approval
- Even if publish is triggered, it deploys what's on `main` — code you already reviewed
- With a **deployment branch restriction** on `npm-publish`, publish is locked to `main`
- With a **wait timer**, you have time to cancel a rogue publish run

## Upstream dispatch (connecting the main repo)

When the main platform repo cuts a release, it notifies this repo to sync templates. This is a one-way notification — the main repo triggers a workflow that opens a PR here, but the dispatch token itself cannot push code, merge PRs, or publish to npm with new content.

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

- The dispatch token can trigger workflows but **cannot push code** — no `contents:write`
- Template sync opens a PR via the workflow's `GITHUB_TOKEN`, not the dispatch token
- CODEOWNERS + branch protection require human approval before merge
- Even if the dispatch token triggers `publish.yml`, it publishes what's on `main` — code you already reviewed and merged
- Templates are vendored at build time, never fetched at runtime — what ships in the package is exactly what was reviewed

> **Solo dev note:** GitHub doesn't allow you to approve your own PRs, so the
> `npm-publish` required reviewers gate doesn't work for single-maintainer repos.
> Use **deployment branch restrictions** (only `main`) and a **wait timer** instead.
> This ensures publish only deploys reviewed code and gives you time to cancel rogue runs.

See also: [UPSTREAM_DISPATCH.md](../.github/UPSTREAM_DISPATCH.md) for the raw workflow snippet.
