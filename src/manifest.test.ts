import { describe, it, expect } from "vitest";
import { buildManifest } from "./manifest.js";

describe("buildManifest", () => {
  const baseOpts = {
    appName: "test-app",
    redirectUrl: "http://127.0.0.1:12345/callback",
  };

  it("includes app name and redirect_url", () => {
    const manifest = buildManifest(baseOpts);
    expect(manifest.name).toBe("test-app");
    expect(manifest.redirect_url).toBe("http://127.0.0.1:12345/callback");
  });

  it("sets public to false", () => {
    const manifest = buildManifest(baseOpts);
    expect(manifest.public).toBe(false);
  });

  it("includes all default_permissions", () => {
    const manifest = buildManifest(baseOpts);
    const perms = manifest.default_permissions as Record<string, string>;

    expect(perms.contents).toBe("write");
    expect(perms.pull_requests).toBe("write");
    expect(perms.actions).toBe("read");
    expect(perms.checks).toBe("write");
    expect(perms.statuses).toBe("write");
    expect(perms.issues).toBe("write");
    expect(perms.metadata).toBe("read");
  });

  it("includes events and hook_attributes when webhookUrl is set", () => {
    const manifest = buildManifest({
      ...baseOpts,
      webhookUrl: "https://example.com/webhook",
    });

    expect(manifest.default_events).toBeInstanceOf(Array);
    const events = manifest.default_events as string[];
    expect(events).toContain("pull_request");
    expect(events).toContain("push");
    expect(events).toContain("issues");

    const hook = manifest.hook_attributes as Record<string, unknown>;
    expect(hook.url).toBe("https://example.com/webhook");
    expect(hook.active).toBe(true);
  });

  it("omits events and hook_attributes when no webhookUrl", () => {
    const manifest = buildManifest(baseOpts);
    expect(manifest.default_events).toBeUndefined();
    expect(manifest.hook_attributes).toBeUndefined();
  });

  it("sets the project URL", () => {
    const manifest = buildManifest(baseOpts);
    expect(manifest.url).toBe("https://github.com/syntropic137/syntropic137");
  });
});
