# Security Model

This repository exists as a **separate repo** from the main Syntropic137 platform
(`syntropic137/syntropic137`) specifically for supply chain security. This document
captures the threat model and design decisions so they aren't lost across conversations.

## Why a Separate Repository

The `syntropic137` npm package is a privileged artifact — users run it with `npx`,
which means arbitrary code execution on their machine. A compromised npm publish is
a supply chain attack on every user.

Keeping the CLI in its own repo provides:

| Isolation | Benefit |
|-----------|---------|
| **Separate npm credentials** | Compromising the main repo's CI does not grant npm publish access |
| **Minimal attack surface** | ~800 LOC, stdlib-only, easy to audit per-release |
| **Independent CI/CD** | No shared secrets, tokens, or service accounts with the main repo |
| **Small dependency tree** | Zero runtime dependencies — nothing to typosquat or hijack |

## Template Sync: Pull, Not Push

The CLI embeds template files (`docker-compose.syntropic137.yaml`, `selfhost-entrypoint.sh`,
`selfhost.env.example`, `init-db/*.sql`) that originate in the main repo.

### How templates are updated

1. The main repo triggers a `workflow_dispatch` via `gh workflow run` on release (notification only)
2. A workflow **in this repo** pulls the latest templates from the main repo's tagged release
3. It opens a **pull request** — a human must review and merge
4. npm publish is a **separate manual step** (requires `workflow_dispatch` approval)

### What this prevents

- **Main repo compromise ≠ npm compromise** — the dispatch can trigger a PR, but
  cannot merge it or publish to npm. There are no shared credentials.
- **No auto-publish** — even if a malicious PR is opened via dispatch, it requires
  human review before merge, and a separate human approval before npm publish.
- **No runtime fetching** — the CLI never downloads templates at runtime. What ships
  in the npm package is what users get. The package is a static, auditable snapshot.

## npm Publish Security

- Publishing requires **manual `workflow_dispatch`** trigger with approval
- The publish workflow runs `tsc --noEmit` (strict mode) and tests before publishing
- **Trusted Publishing (OIDC)** — no npm token stored in GitHub secrets. The npm
  registry verifies the publish request came from this specific repo, workflow, and
  environment via GitHub's OIDC identity provider. There is no long-lived credential
  to steal or rotate.
- **Provenance attestation** — every published version includes a signed provenance
  statement linking the package back to the exact commit and workflow run that built
  it. Users can verify this with `npm audit signatures`.

## Code Security

- **Zero runtime dependencies** — Node 18+ stdlib only (`node:http`, `node:https`,
  `node:crypto`, `node:fs`, `node:child_process`, `node:readline`)
- **TypeScript strict mode** — `"strict": true` in tsconfig, no `any` types
- **Secret files are chmod 600** — generated secrets and PEM files are owner-read-only
- **CSRF protection** — the GitHub App Manifest flow uses a random state parameter
  validated on callback
- **No shell injection** — Docker commands use `execFileSync` (not `exec` with string
  interpolation), preventing argument injection

## Threat Model Summary

| Threat | Mitigation |
|--------|------------|
| Main repo CI compromise | No npm credentials in main repo; dispatch opens PR only |
| This repo CI compromise | npm publish requires manual approval, not auto-triggered |
| npm credential theft | No stored credentials — Trusted Publishing uses ephemeral OIDC tokens |
| Dependency hijack | Zero runtime dependencies |
| Template tampering via PR | Human review required on all PRs |
| Malicious template injection | Templates are vendored snapshots, not fetched at runtime |
| Secret leakage in .env | Secret files chmod 600; .env excluded from git via .gitignore |
| CLI argument injection | `execFileSync` used for all subprocess calls |
