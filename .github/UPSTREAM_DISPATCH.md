# Upstream Dispatch — Add to Main Repo

Add this step to the release workflow in `syntropic137/syntropic137` to notify
this CLI repo when a new platform release is tagged.

This only triggers a workflow run in the CLI repo — it cannot merge or publish.
The token only needs `actions:write` (not `contents:write`), so a leaked token
can trigger runs but cannot push code or modify releases. See [SECURITY.md](../../SECURITY.md).

## Required Setup

1. Create a fine-grained PAT scoped to `syntropic137/syntropic137-npx` only
2. Grant **`Actions: Read and write`** permission
3. Add it as a secret `NPX_DISPATCH_TOKEN` in the main repo

## Workflow Step

Add this to your release workflow (e.g. `.github/workflows/release-containers.yaml`):

```yaml
  - name: Notify syntropic137-npx to sync templates
    env:
      GH_TOKEN: ${{ secrets.NPX_DISPATCH_TOKEN }}
    run: |
      gh workflow run template-sync.yml \
        --repo syntropic137/syntropic137-npx \
        --field ref="${{ steps.version.outputs.version }}"
```

This sends the release tag as `ref` so the CLI repo pulls templates from the
exact tagged commit, not HEAD.
