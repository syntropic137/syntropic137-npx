# Repository Setup

This repo is the supply chain entry point for every `npx @syntropic137/setup` user. The configuration below ensures that no code reaches npm without human review and approval, even if the main platform repo is compromised.

## Secrets

Only one GitHub Actions secret is required. npm publishing uses Trusted Publishing (OIDC) — no npm token is stored anywhere.

| Secret | Repo | Purpose |
|--------|------|---------|
| `NPX_DISPATCH_TOKEN` | **main repo** (`syntropic137/syntropic137`) | Fine-grained PAT scoped to `syntropic137/syntropic137-npx` only. Used to trigger `workflow_dispatch` events via `gh workflow run` that start template sync PRs. |

### PAT permissions (fine-grained)

| Permission | Access | Why |
|------------|--------|-----|
| **Actions** | Read and write | Trigger `workflow_dispatch` via `gh workflow run` |
| **Contents** | Read-only | `gh workflow run` calls `repository.defaultBranchRef` via GraphQL to resolve the default branch — **fails without this** even though no file content is read |
| **Metadata** | Read-only | Auto-granted, required for API access |

> **Do NOT grant Contents: Write** — read-only is sufficient. The token can trigger workflow
> runs but cannot push code, merge PRs, or modify releases.
>
> **Gotcha:** Without `Contents: Read`, `gh workflow run` fails with
> `Resource not accessible by personal access token (repository.defaultBranchRef)`.
> This is not documented in GitHub's docs — the GraphQL call happens internally.

### npm Trusted Publishing

Instead of storing an npm token, the publish workflow authenticates via OIDC. The npm registry verifies the request came from this specific repo, workflow, and environment.

**Both of the following are required** for the publish workflow to work:

1. **Create an `npm-publish` environment** in GitHub: Settings → Environments → New environment → `npm-publish`. The publish workflow references this environment — it will fail without it. See [releasing.md](./releasing.md#1-create-the-npm-publish-github-environment) for recommended protections.
2. **Configure Trusted Publisher** on npmjs.com: `@syntropic137/setup` → Settings → Publishing access → add repo `syntropic137/syntropic137-npx`, workflow `publish.yml`, environment `npm-publish`.

### Additional hardening (on the `npm-publish` environment)

- **Deployment branch restriction**: only allow `main` — ensures publish always deploys reviewed code
- **Wait timer** (e.g. 30 minutes): gives you time to notice and cancel a rogue publish run
  - **Required reviewers** (if you have multiple maintainers): adds an approval gate before publish

## Allow GitHub Actions to create pull requests

Template sync opens PRs via `GITHUB_TOKEN`. This requires enabling the setting at **two levels** — the repo setting is grayed out if the org doesn't allow it.

### 1. Organization level (`syntropic137` org)

Settings -> Actions -> General -> Workflow permissions -> **"Allow GitHub Actions to create and approve pull requests"** -> enable

This must be enabled first — it gates the repo-level setting.

### 2. Repository level (`syntropic137-npx`)

Settings -> Actions -> General -> Workflow permissions -> **"Allow GitHub Actions to create and approve pull requests"** -> enable

> **Gotcha:** If the repo checkbox is grayed out and unclickable, the org-level setting is
> disabled. Enable the org setting first, then the repo checkbox becomes available.

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

1. Create a fine-grained PAT scoped to `syntropic137/syntropic137-npx` only with `Actions: Read and write` + `Contents: Read-only` (see [PAT permissions](#pat-permissions-fine-grained) above)
2. Add it as a secret `NPX_DISPATCH_TOKEN` in the main repo (`syntropic137/syntropic137`)
3. The release workflow (`release-containers.yaml`) already includes a step that runs `gh workflow run template-sync.yml` — see [UPSTREAM_DISPATCH.md](../.github/UPSTREAM_DISPATCH.md) for the snippet

This sends the release tag as `ref` so the CLI repo pulls templates from the exact tagged commit, not HEAD.

### What happens next (in this repo)

1. The `template-sync.yml` workflow fires and opens a PR with updated templates
2. A code owner reviews the diff against the release notes
3. The code owner merges the PR
4. A human manually triggers the `publish.yml` workflow to publish to npm

### Why this is safe even if the main repo is compromised

- The dispatch token has `Contents: Read-only` — it **cannot push code**, only read (needed for `gh workflow run` GraphQL internals)
- Template sync opens a PR via the workflow's `GITHUB_TOKEN`, not the dispatch token
- CODEOWNERS + branch protection require human approval before merge
- Even if the dispatch token triggers `publish.yml`, it publishes what's on `main` — code you already reviewed and merged
- Templates are vendored at build time, never fetched at runtime — what ships in the package is exactly what was reviewed

> **Solo dev note:** GitHub doesn't allow you to approve your own PRs, so the
> `npm-publish` required reviewers gate doesn't work for single-maintainer repos.
> Use **deployment branch restrictions** (only `main`) and a **wait timer** instead.
> This ensures publish only deploys reviewed code and gives you time to cancel rogue runs.

See also: [UPSTREAM_DISPATCH.md](../.github/UPSTREAM_DISPATCH.md) for the raw workflow snippet.
