import * as http from "node:http";
import * as net from "node:net";
import { URL } from "node:url";

// ---------------------------------------------------------------------------
// Port helpers
// ---------------------------------------------------------------------------

/** Find an available TCP port on localhost. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Could not bind to ephemeral port")));
      }
    });
    srv.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Callback server — receives GitHub redirect after app creation
// ---------------------------------------------------------------------------

interface CallbackState {
  code: string | null;
  error: string | null;
  expectedState: string;
}

interface CallbackServerHandle {
  /** Wait for the manifest creation code. */
  waitForCode(timeoutMs?: number): Promise<string>;
  /** Shut down the server. */
  shutdown(): void;
}

/**
 * Start a local HTTP server that handles:
 *   GET /callback?code=...&state=...   (manifest creation redirect)
 *
 * Installation IDs are not captured — the platform resolves them dynamically
 * per-repo since the app can be installed across multiple orgs.
 */
export function startCallbackServer(
  port: number,
  expectedState: string,
): CallbackServerHandle {
  const state: CallbackState = {
    code: null,
    error: null,
    expectedState,
  };

  let codeResolve: ((code: string) => void) | null = null;
  let codeReject: ((err: Error) => void) | null = null;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

    if (url.pathname === "/callback") {
      handleCallback(url, state, res);
      if (state.error && codeReject) {
        codeReject(new Error(`GitHub returned error: ${state.error}`));
        codeReject = null;
      } else if (state.code && codeResolve) {
        codeResolve(state.code);
        codeResolve = null;
      }
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  server.listen(port, "127.0.0.1");

  return {
    waitForCode(timeoutMs = 300_000) {
      if (state.code) return Promise.resolve(state.code);
      if (state.error) return Promise.reject(new Error(state.error));

      return new Promise<string>((resolve, reject) => {
        codeResolve = resolve;
        codeReject = reject;
        setTimeout(() => {
          if (codeResolve) {
            codeResolve = null;
            codeReject = null;
            reject(
              new Error(
                "Timed out waiting for GitHub redirect. " +
                  "Did you complete the app creation in your browser?",
              ),
            );
          }
        }, timeoutMs);
      });
    },

    shutdown() {
      server.close();
    },
  };
}

function handleCallback(url: URL, state: CallbackState, res: http.ServerResponse): void {
  const incomingState = url.searchParams.get("state");
  if (incomingState !== state.expectedState) {
    state.error = "state_mismatch";
    res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<html><body><h1>Error</h1><p>State mismatch (possible CSRF).</p></body></html>");
    return;
  }

  const code = url.searchParams.get("code");
  if (code) {
    state.code = code;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      '<html><body style="font-family:system-ui;max-width:600px;margin:40px auto;text-align:center">' +
        "<h1>GitHub App Created!</h1>" +
        "<p>Return to your terminal to continue setup.</p>" +
        "</body></html>",
    );
  } else {
    state.error = url.searchParams.get("error") || "unknown";
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<html><body><h1>Error</h1><p>GitHub returned: ${escapeHtml(state.error)}</p></body></html>`,
    );
  }
}

// ---------------------------------------------------------------------------
// Form server — serves an auto-submit page that POST the manifest to GitHub
// ---------------------------------------------------------------------------

/**
 * Build the HTML page that auto-submits the manifest to GitHub.
 */
export function buildAutoSubmitForm(
  actionUrl: string,
  manifestJson: string,
  csrfState: string,
): string {
  return `<!DOCTYPE html>
<html>
<head><title>Creating GitHub App...</title></head>
<body style="font-family:system-ui;max-width:600px;margin:80px auto;text-align:center">
  <h2>Redirecting to GitHub...</h2>
  <p>If you are not redirected automatically, click the button below.</p>
  <form id="manifest-form" method="post" action="${escapeHtml(actionUrl)}">
    <input type="hidden" name="manifest" value='${escapeHtml(manifestJson)}'>
    <input type="hidden" name="state" value="${escapeHtml(csrfState)}">
    <button type="submit" style="font-size:1.2em;padding:10px 24px;cursor:pointer">
      Create GitHub App
    </button>
  </form>
  <script>document.getElementById('manifest-form').submit();</script>
</body>
</html>`;
}

/**
 * Start a one-shot server that serves the auto-submit form page.
 */
export function startFormServer(port: number, html: string): http.Server {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  server.listen(port, "127.0.0.1");
  return server;
}

// ---------------------------------------------------------------------------
// HTML escape utility
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
