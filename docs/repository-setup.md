# Repository Setup

This repo is the supply chain entry point for every `npx @syntropic137/setup` user. The configuration below ensures that no code reaches npm without human review and approval, even if the main platform repo is compromised.

## Secrets

Only one GitHub Actions secret is required. npm publishing uses Trusted Publishing (OIDC) — no npm token is stored anywhere.

| Secret | Repo | Purpose |
|--------|------|---------|
| `NPX_DISPATCH_TOKEN` | **main repo** (`syntropic137/syntropic137`) | Fine-grained PAT (or GitHub App token) with `contents:write` on `syntropic137/syntropic137-npx` only. Used to send `repository_dispatch` events that trigger template sync PRs. |

> **Why does the dispatch token need `contents:write`?** The GitHub `repository_dispatch`
> API requires write access to the target repo's contents. This scope is broader than
> ideal — it technically allows pushing to unprotected branches. GitHub does not offer
> a narrower scope for dispatch-only access. **Branch protection on `main` is the actual
> guardrail** — see below.

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

The `NPX_DISPATCH_TOKEN` has `contents:write` which could push to branches. With branch protection configured:

- The token **can** push to feature branches and open PRs
- The token **cannot** merge to `main` — requires code owner approval
- The token **cannot** bypass branch protection — even admin bypass is disabled
- The token **cannot** trigger npm publish — that requires a separate `workflow_dispatch`

## Upstream dispatch (connecting the main repo)

When the main platform repo cuts a release, it notifies this repo to sync templates. This is a one-way notification — the main repo can open a PR here, but cannot merge it or publish to npm.

### Setup in the main repo

1. Create the `NPX_DISPATCH_TOKEN` fine-grained PAT with `contents:write` scoped to `syntropic137/syntropic137-npx` only
2. Add it as a secret in the main repo (`syntropic137/syntropic137`)
3. Add this step to the release workflow (e.g. `.github/workflows/release.yml`):

```yaml
- name: Notify CLI repo to sync templates
  uses: peter-evans/repository-dispatch@v3
  with:
    token: ${{ secrets.NPX_DISPATCH_TOKEN }}
    repository: syntropic137/syntropic137-npx
    event-type: template-sync
    client-payload: '{"ref": "${{ github.ref_name }}"}'
```

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
