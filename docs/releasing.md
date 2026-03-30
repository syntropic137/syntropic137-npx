# Releasing

This is the workflow for publishing a new version of the CLI to npm.

## When a new platform version is released

1. A release on [syntropic137/syntropic137](https://github.com/syntropic137/syntropic137) triggers a `workflow_dispatch` to this repo
2. The **template-sync** workflow runs automatically and opens a PR with updated templates (compose file, entrypoint, env template, init SQL)
3. Review the PR — check the diff against the release notes to make sure the template changes are expected
4. Merge the PR

## Publishing to npm

Publishing is always manual. It never happens automatically, even after a template sync merge.

1. Bump the version in `package.json` (patch for template-only updates, minor for CLI features)
2. Go to **Actions → Publish to npm → Run workflow**
3. Optionally run with "Dry run" checked first to verify the package contents
4. Run again with dry run unchecked to publish

The publish workflow runs type checking (`tsc --noEmit --strict`), tests, and builds before publishing. If any step fails, nothing is published.

## When to release

| Change | Version bump | Example |
|--------|-------------|---------|
| Templates updated from upstream | Patch (`0.18.0` → `0.18.1`) | New service added to compose file |
| CLI bug fix | Patch | Fix port detection on Linux |
| New CLI feature | Minor (`0.18.x` → `0.19.0`) | Add `syntropic137 tunnel` command |
| Breaking change | Major | Change default install directory |

The CLI version does not need to match the platform version. They have independent release cycles.

## First-time setup

Publishing uses [npm Trusted Publishing](https://docs.npmjs.com/generating-provenance-statements) (OIDC) — no npm token is stored in GitHub secrets.

1. On npmjs.com, go to `@syntropic137/setup` → Settings → Publishing access
2. Add a Trusted Publisher: repo `syntropic137/syntropic137-npx`, workflow `publish.yml`, environment `npm-publish`
3. Optionally create a `npm-publish` environment in GitHub with required reviewers for an extra approval gate

Every published version includes a provenance attestation linking it to the exact commit and workflow run. Users can verify with `npm audit signatures`.

See [repository-setup.md](./repository-setup.md) for the full branch protection and upstream dispatch configuration.
