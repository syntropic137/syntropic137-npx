# syntropic137

Zero-prereq self-host setup CLI for [Syntropic137](https://github.com/syntropic137/syntropic137). One command to go from nothing to a fully running stack.

```
npx syntropic137 init
```

**Prerequisites:** Node 18+ and Docker (with Compose v2.20+). That's it.

## What it does

The `init` command walks you through a 10-step interactive setup:

1. **Check Docker** — verifies Docker and Compose v2.20+ are installed and running
2. **Create directory** — sets up `~/.syntropic137/` with the required structure
3. **Copy templates** — writes the Docker Compose file, entrypoint script, env template, and database init SQL
4. **Generate secrets** — creates cryptographically random passwords for Postgres, Redis, and MinIO (chmod 600)
5. **Configure LLM provider** — prompts for your Anthropic API key (or picks up `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` from your environment)
6. **GitHub App setup** — runs the [GitHub App Manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest) to create a GitHub App with the right permissions in one click (optional, skippable)
7. **Write .env** — renders the final configuration from your answers
8. **Pull images** — `docker compose pull` from GHCR
9. **Start services** — `docker compose up -d`
10. **Health check** — polls `http://localhost:8137/health` until the stack is ready

When it's done, you have a running Syntropic137 instance at `http://localhost:8137`.

## Options

```
npx syntropic137 init [options]

--org <name>          Create the GitHub App under an org (default: personal account)
--name <app-name>     GitHub App name (default: syntropic137)
--dir <path>          Install directory (default: ~/.syntropic137)
--skip-github         Skip GitHub App creation
--skip-docker         Skip image pull and container startup (templates only)
--webhook-url <url>   Set a webhook URL for the GitHub App
```

## Lifecycle commands

After initial setup, manage your stack with:

```sh
syntropic137 status    # Container health (docker compose ps)
syntropic137 stop      # Stop the stack
syntropic137 start     # Start the stack
syntropic137 logs      # Tail container logs
syntropic137 update    # Pull latest images and restart
```

All commands accept `--dir <path>` if your install directory isn't the default.

## How the GitHub App Manifest flow works

When you don't pass `--skip-github`, the CLI creates a GitHub App automatically:

1. A local HTTP server starts on a random port (bound to `127.0.0.1` only)
2. Your browser opens to a local page that auto-submits a form to GitHub with the app manifest (permissions, events, callback URL)
3. GitHub shows you a "Create App" confirmation page — you click Create
4. GitHub redirects back to the local server with a temporary code
5. The CLI exchanges that code for the app's credentials (private key, webhook secret, client secret) via the GitHub API
6. Credentials are saved to `~/.syntropic137/secrets/` with chmod 600
7. Your browser opens the app's installation page so you can choose which repos to grant access

The private key (PEM) is mounted into containers as a Docker secret (tmpfs-backed, never written to the container filesystem). Installation IDs are resolved dynamically at runtime — the app can be installed across multiple orgs and repos.

## What gets installed

Everything lives in `~/.syntropic137/`:

```
~/.syntropic137/
├── docker-compose.syntropic137.yaml   # Full stack definition
├── selfhost-entrypoint.sh             # Secret injection at container startup
├── selfhost.env.example               # Reference template
├── .env                               # Your configuration (chmod 600)
├── init-db/
│   └── 01-create-databases.sql        # Database schema
├── secrets/
│   ├── db-password.secret             # Postgres password (chmod 600)
│   ├── redis-password.secret          # Redis password (chmod 600)
│   ├── minio-password.secret          # MinIO password (chmod 600)
│   └── github-app-private-key.pem     # GitHub App private key (chmod 600)
└── workspaces/                        # Agent workspace mount
```

To uninstall: `docker compose -f ~/.syntropic137/docker-compose.syntropic137.yaml down -v && rm -rf ~/.syntropic137`

## The stack

The Docker Compose file runs these services:

| Service | Image | Purpose |
|---------|-------|---------|
| TimescaleDB | `timescale/timescaledb` | Unified Postgres database (event store + observability) |
| Event Store | `ghcr.io/syntropic137/event-store` | gRPC event sourcing server |
| Collector | `ghcr.io/syntropic137/syn-collector` | Agent event ingestion |
| API | `ghcr.io/syntropic137/syn-api` | Query and control service |
| Gateway | `ghcr.io/syntropic137/syn-gateway` | nginx reverse proxy + dashboard UI |
| MinIO | `minio/minio` | S3-compatible artifact storage |
| Redis | `redis:7-alpine` | Caching and pub/sub |
| Envoy Proxy | `ghcr.io/syntropic137/sidecar-proxy` | Shared credential injection proxy |
| Token Injector | `ghcr.io/syntropic137/token-injector` | ext_authz service for agent credentials |
| Docker Socket Proxy | `tecnativa/docker-socket-proxy` | Restricted Docker API access for the API service |

Optional: Cloudflare Tunnel (set `COMPOSE_PROFILES=tunnel` in `.env` for remote access).

## Security

See [SECURITY.md](./SECURITY.md) for the full threat model.

Key points:

- **Zero runtime dependencies** — Node 18+ stdlib only. Nothing to hijack in the dependency tree.
- **Separate repo from the platform** — npm publish credentials are isolated. Compromising the main Syntropic137 repo does not grant npm access.
- **Secrets never in .env** — passwords and keys are stored as separate files (chmod 600) and mounted as Docker secrets (tmpfs). The API key is the one exception (passed as env var to match the current service design).
- **No auto-publish** — npm releases require manual approval via `workflow_dispatch`.
- **CSRF protection** — the manifest flow validates a random state parameter on the OAuth callback.
- **No shell injection** — all subprocess calls use `execFileSync` with argument arrays, not string interpolation.

## Template sync

The `templates/` directory contains files vendored from the main [syntropic137/syntropic137](https://github.com/syntropic137/syntropic137) repo. When a new platform version is released:

1. The main repo sends a `repository_dispatch` to this repo (notification only)
2. The `template-sync.yml` workflow opens a PR with the updated templates
3. A human reviews and merges the PR
4. A human triggers the `publish.yml` workflow to publish to npm

The main repo cannot merge PRs or publish to npm. See [SECURITY.md](./SECURITY.md) for why this matters.

## Releasing a new version

This is the workflow for publishing a new version of the CLI to npm.

### When a new platform version is released

1. A release on [syntropic137/syntropic137](https://github.com/syntropic137/syntropic137) fires a `repository_dispatch` to this repo
2. The **template-sync** workflow runs automatically and opens a PR with updated templates (compose file, entrypoint, env template, init SQL)
3. Review the PR — check the diff against the release notes to make sure the template changes are expected
4. Merge the PR

### Publishing to npm

Publishing is always manual. It never happens automatically, even after a template sync merge.

1. Bump the version in `package.json` (patch for template-only updates, minor for CLI features)
2. Go to **Actions → Publish to npm → Run workflow**
3. Optionally run with "Dry run" checked first to verify the package contents
4. Run again with dry run unchecked to publish

The publish workflow runs type checking (`tsc --noEmit --strict`), tests, and builds before publishing. If any step fails, nothing is published.

### When to release

| Change | Version bump | Example |
|--------|-------------|---------|
| Templates updated from upstream | Patch (`0.18.0` → `0.18.1`) | New service added to compose file |
| CLI bug fix | Patch | Fix port detection on Linux |
| New CLI feature | Minor (`0.18.x` → `0.19.0`) | Add `syntropic137 tunnel` command |
| Breaking change | Major | Change default install directory |

The CLI version does not need to match the platform version. They have independent release cycles.

### Setting up npm publishing for the first time

1. Create an npm access token with publish permissions for the `syntropic137` package
2. Add it as `NPM_TOKEN` in this repo's GitHub Actions secrets
3. Optionally create a `npm-publish` environment in GitHub with required reviewers for an extra approval gate
4. Enable 2FA on the npm package for defense in depth

## Development

```sh
git clone https://github.com/syntropic137/syntropic137-npx.git
cd syntropic137-npx
npm install        # Dev deps only: typescript, vitest, @types/node
npm run build      # tsc → dist/
npm test           # vitest
node dist/cli.js --help
```

TypeScript strict mode is required. No `any` types.

### Source structure

```
src/
├── cli.ts          Entry point, arg parsing, 10-step init, subcommands
├── manifest.ts     GitHub App Manifest flow (ported from Python)
├── server.ts       Local HTTP servers for OAuth callback + form submit
├── docker.ts       Docker Compose lifecycle (check, pull, up, health)
├── secrets.ts      Cryptographic secret generation
├── config.ts       .env template rendering
├── ui.ts           ANSI colors, spinner, prompts (stdlib only)
└── types.ts        Shared TypeScript types
```

## License

MIT
