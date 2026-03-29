# Upstream Dispatch — Add to Main Repo

Add this step to the release workflow in `syntropic137/syntropic137` to notify
this CLI repo when a new platform release is tagged.

This only opens a PR in the CLI repo — it cannot merge or publish. See [SECURITY.md](../../SECURITY.md).

## Required Setup

1. Create a fine-grained PAT (or GitHub App token) with `contents:write` scope
   on `syntropic137/syntropic137-npx` only
2. Add it as a secret `NPX_DISPATCH_TOKEN` in the main repo

## Workflow Step

Add this to your release workflow (e.g. `.github/workflows/release.yml`):

```yaml
  - name: Notify CLI repo to sync templates
    uses: peter-evans/repository-dispatch@v3
    with:
      token: ${{ secrets.NPX_DISPATCH_TOKEN }}
      repository: syntropic137/syntropic137-npx
      event-type: template-sync
      client-payload: '{"ref": "${{ github.ref_name }}"}'
```

This sends the release tag as `ref` so the CLI repo pulls templates from the
exact tagged commit, not HEAD.
