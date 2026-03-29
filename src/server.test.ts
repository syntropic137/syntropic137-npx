import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
import {
  findFreePort,
  startCallbackServer,
  buildAutoSubmitForm,
  startFormServer,
} from "./server.js";

// Helper to make HTTP GET requests in tests
function httpGet(port: number, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}

// Track servers for cleanup
const servers: Array<{ shutdown?: () => void; close?: () => void }> = [];
afterEach(() => {
  for (const s of servers) {
    if (s.shutdown) s.shutdown();
    if (s.close) s.close();
  }
  servers.length = 0;
});

describe("findFreePort", () => {
  it("returns a port > 0", async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
  });

  it("returns different ports on successive calls", async () => {
    const [a, b] = await Promise.all([findFreePort(), findFreePort()]);
    expect(a).not.toBe(b);
  });
});

describe("startCallbackServer", () => {
  it("extracts code on valid state", async () => {
    const port = await findFreePort();
    const state = "test-state-123";
    const handle = startCallbackServer(port, state);
    servers.push(handle);

    const codePromise = handle.waitForCode(5000);
    await httpGet(port, `/callback?code=abc123&state=${state}`);
    const code = await codePromise;

    expect(code).toBe("abc123");
  });

  it("rejects on state mismatch", async () => {
    const port = await findFreePort();
    const handle = startCallbackServer(port, "correct-state");
    servers.push(handle);

    // Start waiting before the request so the rejection handler is attached
    const codePromise = handle.waitForCode(5000).catch((err: Error) => err);
    const response = await httpGet(port, "/callback?code=abc&state=wrong-state");

    expect(response.status).toBe(403);
    const err = await codePromise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("state_mismatch");
  });

  it("rejects on error param", async () => {
    const port = await findFreePort();
    const state = "ok-state";
    const handle = startCallbackServer(port, state);
    servers.push(handle);

    // Attach rejection handler before triggering the request
    const codePromise = handle.waitForCode(5000).catch((err: Error) => err);
    await httpGet(port, `/callback?state=${state}&error=access_denied`);

    const err = await codePromise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("access_denied");
  });

  it("returns 404 for unknown paths", async () => {
    const port = await findFreePort();
    const handle = startCallbackServer(port, "state");
    servers.push(handle);

    const response = await httpGet(port, "/unknown");
    expect(response.status).toBe(404);
  });

  it("times out when no request arrives", async () => {
    const port = await findFreePort();
    const handle = startCallbackServer(port, "state");
    servers.push(handle);

    await expect(handle.waitForCode(100)).rejects.toThrow("Timed out");
  });

  it("shutdown closes the server", async () => {
    const port = await findFreePort();
    const handle = startCallbackServer(port, "state");

    handle.shutdown();

    // Should fail to connect after shutdown
    await expect(httpGet(port, "/callback")).rejects.toThrow();
  });
});

describe("buildAutoSubmitForm", () => {
  it("returns HTML with manifest, action URL, and state", () => {
    const html = buildAutoSubmitForm(
      "https://github.com/settings/apps/new",
      '{"name":"test"}',
      "csrf-token",
    );

    expect(html).toContain("https://github.com/settings/apps/new");
    expect(html).toContain("csrf-token");
    expect(html).toContain("manifest");
    expect(html).toContain("manifest-form");
    expect(html).toContain("submit()");
  });

  it("escapes HTML special characters", () => {
    const html = buildAutoSubmitForm(
      'https://example.com/test?a=1&b=2"',
      '{"key":"<script>alert(1)</script>"}',
      "state&<>",
    );

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("startFormServer", () => {
  it("serves the given HTML on any path", async () => {
    const port = await findFreePort();
    const expectedHtml = "<html><body>Test Form</body></html>";
    const server = startFormServer(port, expectedHtml);
    servers.push(server);

    const response = await httpGet(port, "/anything");
    expect(response.status).toBe(200);
    expect(response.body).toBe(expectedHtml);
  });
});
