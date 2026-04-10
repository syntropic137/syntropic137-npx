# syntropic137

Zero-dependency self-host setup CLI for [Syntropic137](https://github.com/syntropic137/syntropic137). One command to go from nothing to a fully running stack.

```
npx @syntropic137/setup init
```

**Prerequisites:** Node 18+ and Docker (with Compose v2.20+). That's it.

## What it does

The `init` command walks you through a 12-step interactive setup:

1. **Check Docker:** verifies Docker and Compose v2.20+ are installed and running
2. **Create directory:** sets up `~/.syntropic137/` with the required structure
3. **Copy templates:** writes the Docker Compose file, entrypoint script, env template, and database init SQL
4. **Generate secrets:** creates cryptographically random passwords for Postgres, Redis, and MinIO (chmod 600)
5. **Configure LLM provider:** prompts for your Anthropic API key (or picks up `ANTHROPIC_API_KEY` from your environment)
6. **GitHub App setup:** runs the [GitHub App Manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest) to create a GitHub App with the right permissions in one click (optional, skippable)
7. **Claude Code plugin:** installs the Syntropic137 plugin for Claude Code (optional, skippable)
8. **Syntropic137 CLI:** installs the `syn` CLI for managing workflows and executions (optional, skippable)
9. **Write .env:** renders the final configuration from your answers
10. **Pull images:** `docker compose pull` from GHCR
11. **Start services:** `docker compose up -d`
12. **Health check:** polls `http://localhost:8137/health` until the stack is ready

When it's done, you have a running Syntropic137 instance at `http://localhost:8137`.

## Options

```
npx @syntropic137/setup init [options]

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
npx @syntropic137/setup status    # Container health (docker compose ps)
npx @syntropic137/setup stop      # Stop the stack
npx @syntropic137/setup start     # Start the stack
npx @syntropic137/setup logs      # Tail container logs
npx @syntropic137/setup update    # Pull latest images and restart
```

All commands accept `--dir <path>` if your install directory isn't the default.

## How the GitHub App Manifest flow works

When you don't pass `--skip-github`, the CLI creates a GitHub App automatically. Make sure you are logged in to GitHub before the browser opens.

1. A local HTTP server starts on a random port (bound to `127.0.0.1` only)
2. Your browser opens to a local page that auto-submits a form to GitHub with the app manifest (permissions, events, callback URL)
3. GitHub shows you a "Create App" confirmation page, then you click Create
4. GitHub redirects back to the local server with a temporary code
5. The CLI exchanges that code for the app's credentials (private key, webhook secret, client secret) via the GitHub API
6. Credentials are saved to `~/.syntropic137/secrets/` with chmod 600
7. Your browser opens the app's installation page so you can choose which repos to grant access

The private key (PEM) is mounted into containers as a Docker secret (tmpfs-backed, never written to the container filesystem). Installation IDs are resolved dynamically at runtime, so the app can be installed across multiple orgs and repos. Repositories granted to the installation are discovered automatically at startup and refreshed every hour without requiring a webhook URL.

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

This repo is the supply chain entry point for every `npx @syntropic137/setup` user. It is deliberately isolated from the main platform repo. See [SECURITY.md](./SECURITY.md) for the full threat model.

- **Zero runtime dependencies:** Node 18+ stdlib only. Nothing to hijack in the dependency tree.
- **Separate repo from the platform:** compromising the main Syntropic137 repo does not grant npm publish access. The cross-repo dispatch token can trigger workflow runs here but cannot push code, merge PRs, or alter what gets published.
- **Publish only deploys reviewed code:** npm publish deploys whatever is on `main`. Since the dispatch token has no write access to repository contents, it cannot inject malicious code into the publish pipeline. The only path to `main` is through a human-reviewed PR.
- **Trusted Publishing (OIDC):** no npm token is stored anywhere. Every published version includes a signed [provenance attestation](https://docs.npmjs.com/generating-provenance-statements) linking it to the exact commit and workflow run. Verify with `npm audit signatures`.
- **Secrets never in .env:** passwords and keys are stored as separate files (chmod 600) and mounted as Docker secrets (tmpfs-backed, never on the container filesystem).
- **No auto-publish:** npm releases require a manual `workflow_dispatch` trigger. Template syncs from upstream open a PR but never auto-merge or auto-publish.

## Contributing

See [docs/development.md](./docs/development.md) for build instructions, source structure, and architecture.

## License

MIT
