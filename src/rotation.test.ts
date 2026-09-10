import { describe, it, expect } from "vitest";
import {
  rotateOne,
  rotateAll,
  CREDENTIALS,
  generateSecret,
  assertRotatable,
  type RotationDeps,
  type RotationConfig,
  type CredentialSpec,
} from "./rotation.js";

const CFG: RotationConfig = { postgresUser: "syn", postgresDb: "syn", minioUser: "minioadmin" };
const OLD = "a".repeat(64);

/**
 * Records the ORDER of every outside effect, because ordering is the safety
 * property under test: a server that has not adopted a credential must never
 * be left with a secret file claiming it has.
 */
function harness(opts: {
  /** Services whose adopt command refuses, leaving the server on its old value. */
  refuseAdopt?: string[];
  /** Services that reject every credential, including the one they hold. */
  brokenAuth?: string[];
  secrets?: Record<string, string>;
} = {}) {
  const calls: string[] = [];
  const users: string[] = [];
  const secrets: Record<string, string> = opts.secrets ?? {};
  for (const c of CREDENTIALS) secrets[c.file] ??= OLD;

  // What each SERVER actually holds. Verification succeeds only against this,
  // never against what was written to a file - which is the entire point. A
  // fake that accepts any value could not detect the defect being fixed.
  const held: Record<string, string> = {
    timescaledb: OLD,
    redis: OLD,
    minio: OLD,
  };

  const valueOf = (argv: string[], flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const deps: RotationDeps = {
    exec(service, argv, env) {
      const joined = argv.join(" ");

      if (/ALTER ROLE|CONFIG SET/.test(joined)) {
        calls.push(`adopt:${service}`);
        if (opts.refuseAdopt?.includes(service)) {
          throw new Error(`adopt refused by ${service}`);
        }
        const m = joined.match(/PASSWORD '([0-9a-f]{64})'/);
        held[service] = m ? m[1]! : (argv[argv.length - 1] ?? "");
        return "";
      }

      // Authentication attempts. Each presents a value; the server accepts it
      // only if it is the value the server holds.
      if (joined.includes("select 1")) {
        calls.push(`verify:${service}`);
        const presented = env?.["PGPASSWORD"] ?? "";
        if (opts.brokenAuth?.includes(service)) throw new Error(`${service} unreachable`);
        return presented === held[service] ? "1\n" : "";
      }
      if (joined.includes("PING")) {
        calls.push(`verify:${service}`);
        const presented = valueOf(argv, "-a") ?? "";
        if (opts.brokenAuth?.includes(service)) throw new Error(`${service} unreachable`);
        return presented === held[service] ? "PONG\n" : "NOAUTH\n";
      }
      if (joined.includes("alias set")) {
        calls.push(`verify:${service}`);
        // The user is the second-to-last argv entry; record it so a hardcoded
        // name cannot pass. MinIO rejects an unknown user with the SAME error
        // it gives a wrong password, so getting this wrong fails every value
        // and looks like an unrecoverable rotation.
        users.push(argv[argv.length - 2] ?? "");
        const presented = argv[argv.length - 1] ?? "";
        if (opts.brokenAuth?.includes(service)) throw new Error(`${service} unreachable`);
        return presented === held[service]
          ? "Added `rotcheck` successfully.\n"
          : "mc: <ERROR> signature does not match\n";
      }

      calls.push(`exec:${service}`);
      return "";
    },
    recreate(services) {
      calls.push(`recreate:${services.join("+")}`);
      // A restart-adoption server reads its credential from the file on start.
      for (const s of services) {
        const spec = CREDENTIALS.find((c) => c.server === s && c.adoption === "restart");
        if (spec) held[s] = secrets[spec.file] ?? "";
      }
    },
    readSecret(file) {
      return secrets[file] ?? "";
    },
    writeSecret(file, value) {
      secrets[file] = value;
      calls.push(`write:${file}`);
    },
    log() {},
  };

  return { deps, calls, secrets, held, users };
}

const byFile = (f: string): CredentialSpec =>
  CREDENTIALS.find((c) => c.file === f)!;

describe("secret shape", () => {
  it("generates 64 hex characters", () => {
    expect(generateSecret()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a value that is not a 64-char hex secret", () => {
    // These reach a SQL statement and an argv, so the guard is not cosmetic.
    expect(() => assertRotatable("'; DROP TABLE x; --", "test")).toThrow(/64-character hex/);
    expect(() => assertRotatable("a".repeat(63), "test")).toThrow();
  });
});

describe("rotateOne, happy path", () => {
  it("rotates PostgreSQL and reports success", () => {
    const { deps, calls, secrets } = harness();
    const out = rotateOne(deps, CFG, byFile("db-password.secret"));

    expect(out.status).toBe("rotated");
    expect(secrets["db-password.secret"]).not.toBe(OLD);
    expect(secrets["db-password.secret"]).toMatch(/^[0-9a-f]{64}$/);
    expect(calls).toContain("verify:timescaledb");
  });

  it("verifies every credential against its own service", () => {
    const { deps, calls } = harness();
    rotateAll(deps, CFG);
    expect(calls).toContain("verify:timescaledb");
    expect(calls).toContain("verify:redis");
    expect(calls).toContain("verify:minio");
  });
});

describe("ordering is the safety property", () => {
  it("command adoption asks the SERVER before writing the file", () => {
    // If the file were written first and adoption then failed, the stack would
    // restart into a password the server never took. That is exactly #56.
    const { deps, calls } = harness();
    rotateOne(deps, CFG, byFile("db-password.secret"));

    const adopt = calls.indexOf("adopt:timescaledb");
    const write = calls.indexOf("write:db-password.secret");
    expect(adopt).toBeGreaterThanOrEqual(0);
    expect(write).toBeGreaterThan(adopt);
  });

  it("restart adoption writes the file BEFORE recreating the server", () => {
    // MinIO reads its root credential from the environment at start, so the
    // file has to be in place first or the server adopts nothing.
    const { deps, calls } = harness();
    rotateOne(deps, CFG, byFile("minio-password.secret"));

    const write = calls.indexOf("write:minio-password.secret");
    const recreate = calls.findIndex((c) => c.startsWith("recreate:") && c.includes("minio"));
    expect(write).toBeGreaterThanOrEqual(0);
    expect(recreate).toBeGreaterThan(write);
  });

  it("verifies only after the clients have been recreated", () => {
    const { deps, calls } = harness();
    rotateOne(deps, CFG, byFile("db-password.secret"));

    const recreate = calls.findIndex((c) => c.startsWith("recreate:"));
    const verify = calls.indexOf("verify:timescaledb");
    expect(verify).toBeGreaterThan(recreate);
  });
});

describe("a server that never adopted the credential", () => {
  it("is caught, and the file is not left holding a value the server rejects", () => {
    // This is #56 exactly: the file says one thing, the server holds another.
    // The old code wrote the file, restarted, and reported success.
    const { deps, secrets, held } = harness({ refuseAdopt: ["timescaledb"] });
    const out = rotateOne(deps, CFG, byFile("db-password.secret"));

    expect(out.status).toBe("rolled-back");
    expect(secrets["db-password.secret"]).toBe(OLD);
    expect(held["timescaledb"]).toBe(OLD);
  });

  it("does not re-issue the adopt command when nothing was adopted", () => {
    // Reversing a step that never ran fails a second time and buries the real
    // error under a compound one.
    const { deps, calls } = harness({ refuseAdopt: ["timescaledb"] });
    rotateOne(deps, CFG, byFile("db-password.secret"));
    expect(calls.filter((c) => c === "adopt:timescaledb")).toHaveLength(1);
  });

  it("never reports success when the service did not accept the value", () => {
    const { deps } = harness({ refuseAdopt: ["redis"] });
    const out = rotateOne(deps, CFG, byFile("redis-password.secret"));
    expect(out.status).not.toBe("rotated");
  });
});

describe("rollback", () => {
  it("leaves file and server agreeing after a failed rotation", () => {
    const { deps, secrets, held } = harness({ refuseAdopt: ["timescaledb"] });
    rotateOne(deps, CFG, byFile("db-password.secret"));
    expect(secrets["db-password.secret"]).toBe(held["timescaledb"]);
  });

  it("surfaces a compound failure rather than a reassuring summary", () => {
    // Server took the new value, then became unreachable. Rollback cannot
    // verify, and the operator must be told rather than shown a tidy line.
    const { deps } = harness({ brokenAuth: ["timescaledb"] });
    expect(() => rotateOne(deps, CFG, byFile("db-password.secret"))).toThrow(
      /rotation failed AND rollback failed/,
    );
  });
});

describe("credentials come from configuration, not from assumptions", () => {
  it("authenticates to MinIO as the CONFIGURED root user", () => {
    // rotation.ts hardcoded "synadmin" while the compose file defaults
    // MINIO_ROOT_USER to "minioadmin". `mc` answers an unknown user with
    // "The Access Key Id you provided does not exist in our records" - the same
    // shape as a bad password - so verification failed for the new value AND
    // the old one, and the tool reported the rotation as unrecoverable while
    // the server was untouched and healthy. Caught only by running it against
    // a real stack; nothing here pinned the name.
    const { deps, users } = harness();
    rotateOne(deps, { ...CFG, minioUser: "someone-else" }, byFile("minio-password.secret"));

    expect(users).toContain("someone-else");
    expect(users).not.toContain("synadmin");
  });
});
