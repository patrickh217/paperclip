import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock logger to prevent test output noise
vi.mock("../middleware/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Dynamically import so we can control env before module resolution
async function importProvision() {
  return import("../local-trusted-provision.js");
}

describe("ensureLocalTrustedJwtSecret", () => {
  const secretEnv = "PAPERCLIP_AGENT_JWT_SECRET";
  const betterAuthSecretEnv = "BETTER_AUTH_SECRET";

  let tmpDir: string;
  let tmpEnvPath: string;
  let savedSecret: string | undefined;
  let savedBetterAuthSecret: string | undefined;
  let savedPaperclipConfig: string | undefined;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `paperclip-provision-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    tmpEnvPath = path.join(tmpDir, ".env");

    savedSecret = process.env[secretEnv];
    savedBetterAuthSecret = process.env[betterAuthSecretEnv];
    savedPaperclipConfig = process.env.PAPERCLIP_CONFIG;

    // Point config path at the tmp dir so resolvePaperclipEnvPath() resolves there
    process.env.PAPERCLIP_CONFIG = path.join(tmpDir, "config.json");

    delete process.env[secretEnv];
    delete process.env[betterAuthSecretEnv];

    vi.resetModules();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });

    if (savedSecret === undefined) delete process.env[secretEnv];
    else process.env[secretEnv] = savedSecret;

    if (savedBetterAuthSecret === undefined) delete process.env[betterAuthSecretEnv];
    else process.env[betterAuthSecretEnv] = savedBetterAuthSecret;

    if (savedPaperclipConfig === undefined) delete process.env.PAPERCLIP_CONFIG;
    else process.env.PAPERCLIP_CONFIG = savedPaperclipConfig;

    vi.resetModules();
  });

  it("mints a secret, writes it to .env at mode 0600, and sets process.env when neither env var is present", async () => {
    const { ensureLocalTrustedJwtSecret } = await importProvision();

    const result = ensureLocalTrustedJwtSecret();

    expect(result).toBe(true);
    expect(process.env[secretEnv]).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(tmpEnvPath)).toBe(true);

    const content = readFileSync(tmpEnvPath, "utf-8");
    expect(content).toContain(`PAPERCLIP_AGENT_JWT_SECRET=${process.env[secretEnv]}`);

    // Mode 0600 — only on POSIX
    if (process.platform !== "win32") {
      const { statSync } = await import("node:fs");
      const mode = statSync(tmpEnvPath).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("returns false and leaves env unchanged when PAPERCLIP_AGENT_JWT_SECRET is already set", async () => {
    process.env[secretEnv] = "existing-secret";
    const { ensureLocalTrustedJwtSecret } = await importProvision();

    const result = ensureLocalTrustedJwtSecret();

    expect(result).toBe(false);
    expect(process.env[secretEnv]).toBe("existing-secret");
    expect(existsSync(tmpEnvPath)).toBe(false);
  });

  it("returns false and leaves env unchanged when BETTER_AUTH_SECRET is set", async () => {
    process.env[betterAuthSecretEnv] = "better-auth-secret";
    const { ensureLocalTrustedJwtSecret } = await importProvision();

    const result = ensureLocalTrustedJwtSecret();

    expect(result).toBe(false);
    expect(existsSync(tmpEnvPath)).toBe(false);
  });

  it("merges with existing .env entries without overwriting them", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(tmpEnvPath, "EXISTING_KEY=existing_value\n", { mode: 0o600 });

    const { ensureLocalTrustedJwtSecret } = await importProvision();
    const result = ensureLocalTrustedJwtSecret();

    expect(result).toBe(true);
    const content = readFileSync(tmpEnvPath, "utf-8");
    expect(content).toContain("EXISTING_KEY=existing_value");
    expect(content).toContain("PAPERCLIP_AGENT_JWT_SECRET=");
  });

  it("loads secret from existing .env file and sets process.env without re-minting", async () => {
    const { writeFileSync } = await import("node:fs");
    const existingSecret = "a".repeat(64);
    writeFileSync(tmpEnvPath, `PAPERCLIP_AGENT_JWT_SECRET=${existingSecret}\n`, { mode: 0o600 });

    const { ensureLocalTrustedJwtSecret } = await importProvision();
    const result = ensureLocalTrustedJwtSecret();

    // Secret was in file but not in env — it gets loaded without creating a new one
    expect(result).toBe(false);
    expect(process.env[secretEnv]).toBe(existingSecret);
  });
});
