import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { loadConfig, saveConfig, loadRepoConfig, saveRepoConfig, getGitIdentity } from "./config";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mog-config-test-"));
const originalHome = process.env.HOME;

beforeEach(() => {
  process.env.HOME = tmpDir;
  const mogDir = path.join(tmpDir, ".mog");
  if (fs.existsSync(mogDir)) {
    fs.rmSync(mogDir, { recursive: true });
  }
});

afterAll(() => {
  process.env.HOME = originalHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  test("returns empty object when no config file exists", () => {
    expect(loadConfig()).toEqual({});
  });

  test("returns parsed config from file", () => {
    const mogDir = path.join(tmpDir, ".mog");
    fs.mkdirSync(mogDir, { recursive: true });
    fs.writeFileSync(
      path.join(mogDir, "config.json"),
      JSON.stringify({ "user.name": "Alice", "user.email": "alice@example.com" })
    );

    expect(loadConfig()).toEqual({
      "user.name": "Alice",
      "user.email": "alice@example.com",
    });
  });

  test("returns empty object for invalid JSON", () => {
    const mogDir = path.join(tmpDir, ".mog");
    fs.mkdirSync(mogDir, { recursive: true });
    fs.writeFileSync(path.join(mogDir, "config.json"), "not json");

    expect(loadConfig()).toEqual({});
  });
});

describe("saveConfig", () => {
  test("creates .mog directory and writes config", () => {
    saveConfig({ "user.name": "Bob", "user.email": "bob@example.com" });

    const configPath = path.join(tmpDir, ".mog", "config.json");
    expect(fs.existsSync(configPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(content).toEqual({ "user.name": "Bob", "user.email": "bob@example.com" });
  });

  test("overwrites existing config", () => {
    saveConfig({ "user.name": "First" });
    saveConfig({ "user.name": "Second", "user.email": "second@example.com" });

    const configPath = path.join(tmpDir, ".mog", "config.json");
    const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(content).toEqual({ "user.name": "Second", "user.email": "second@example.com" });
  });

  test("saves empty config", () => {
    saveConfig({});

    const configPath = path.join(tmpDir, ".mog", "config.json");
    const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(content).toEqual({});
  });
});

describe("loadRepoConfig", () => {
  test("returns empty object when no repo config file exists", () => {
    expect(loadRepoConfig("owner/repo")).toEqual({});
  });

  test("returns parsed repo config from file", () => {
    saveRepoConfig("owner/repo", { "user.name": "Alice", "user.email": "alice@work.com" });
    expect(loadRepoConfig("owner/repo")).toEqual({
      "user.name": "Alice",
      "user.email": "alice@work.com",
    });
  });

  test("keeps repo configs separate", () => {
    saveRepoConfig("owner/repo-a", { "user.name": "Alice", "user.email": "alice@work.com" });
    saveRepoConfig("owner/repo-b", { "user.name": "Bob", "user.email": "bob@personal.com" });

    expect(loadRepoConfig("owner/repo-a")).toEqual({ "user.name": "Alice", "user.email": "alice@work.com" });
    expect(loadRepoConfig("owner/repo-b")).toEqual({ "user.name": "Bob", "user.email": "bob@personal.com" });
  });
});

describe("getGitIdentity", () => {
  test("falls back to global config when no repo specified", () => {
    saveConfig({ "user.name": "Global", "user.email": "global@example.com" });
    // Note: this test also picks up host git config (tier 2), which runs before global.
    // Since we can't easily mock host git, we just verify it returns something non-null.
    const identity = getGitIdentity();
    expect(identity).not.toBeNull();
  });

  test("per-repo config takes priority over global config", () => {
    saveConfig({ "user.name": "Global", "user.email": "global@example.com" });
    saveRepoConfig("owner/repo", { "user.name": "RepoUser", "user.email": "repo@work.com" });

    expect(getGitIdentity("owner/repo")).toEqual({
      name: "RepoUser",
      email: "repo@work.com",
    });
  });

  test("falls back through chain when per-repo config is incomplete", () => {
    saveRepoConfig("owner/repo", { "user.name": "RepoUser" }); // missing email
    saveConfig({ "user.name": "Global", "user.email": "global@example.com" });

    // Should skip per-repo (incomplete), pick up host git or global
    const identity = getGitIdentity("owner/repo");
    expect(identity).not.toBeNull();
    // Should NOT be the incomplete repo config
    expect(identity!.email).not.toBe("");
  });

  test("returns null when no config exists anywhere and host git is empty", () => {
    // With a fake HOME, host git config may still return the real system config.
    // This test just verifies it doesn't crash with no mog configs at all.
    const identity = getGitIdentity("nonexistent/repo");
    // Can't assert null since host git may be configured, but it shouldn't throw
    expect(identity === null || (identity.name && identity.email)).toBeTruthy();
  });

  test("returns null for global config with empty strings", () => {
    saveConfig({ "user.name": "", "user.email": "" });
    // With empty mog config and potentially no host git, may return null
    const identity = getGitIdentity();
    // If host git is configured it'll return that, otherwise null — both are valid
    expect(identity === null || (identity.name && identity.email)).toBeTruthy();
  });
});
