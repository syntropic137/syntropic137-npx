import { describe, it, expect } from "vitest";
import { routeAnthropicCredential } from "./cli.js";
import { ENV_KEYS } from "./constants.js";

describe("routeAnthropicCredential — npx#60", () => {
  it("routes an OAuth token (sk-ant-oat01-…) to CLAUDE_CODE_OAUTH_TOKEN", () => {
    const routed = routeAnthropicCredential("sk-ant-oat01-EXAMPLE-payload-here");
    expect(routed).not.toBeNull();
    expect(routed?.envKey).toBe(ENV_KEYS.CLAUDE_CODE_OAUTH_TOKEN);
    expect(routed?.value).toBe("sk-ant-oat01-EXAMPLE-payload-here");
  });

  it("routes an API key (sk-ant-… without oat01) to ANTHROPIC_API_KEY", () => {
    const routed = routeAnthropicCredential("sk-ant-api03-EXAMPLE-payload");
    expect(routed).not.toBeNull();
    expect(routed?.envKey).toBe(ENV_KEYS.ANTHROPIC_API_KEY);
    expect(routed?.value).toBe("sk-ant-api03-EXAMPLE-payload");
  });

  it("trims surrounding whitespace before classifying", () => {
    const routed = routeAnthropicCredential("   sk-ant-oat01-padded-with-spaces   ");
    expect(routed?.envKey).toBe(ENV_KEYS.CLAUDE_CODE_OAUTH_TOKEN);
    expect(routed?.value).toBe("sk-ant-oat01-padded-with-spaces");
  });

  it("rejects empty input", () => {
    expect(routeAnthropicCredential("")).toBeNull();
    expect(routeAnthropicCredential("   ")).toBeNull();
  });

  it("rejects values that do not start with sk-ant-", () => {
    expect(routeAnthropicCredential("sk-OPENAI-anything")).toBeNull();
    expect(routeAnthropicCredential("ghp_github_token")).toBeNull();
    expect(routeAnthropicCredential("random-junk")).toBeNull();
  });

  it("does not split sk-ant-oat01- on substring match elsewhere in the string", () => {
    // A pathological API key that happens to contain 'oat01' mid-string
    // should still be classified as an API key, not an OAuth token.
    const routed = routeAnthropicCredential("sk-ant-api-contains-oat01-mid");
    expect(routed?.envKey).toBe(ENV_KEYS.ANTHROPIC_API_KEY);
  });
});
