import { describe, test, expect } from "bun:test";
import path from "path";

const entrypoint = path.join(import.meta.dir, "index.ts");
const bunPath = Bun.which("bun") ?? process.execPath;
const packageJson = require("../package.json");

describe("--version flag", () => {
  test("--version prints the version from package.json", async () => {
    const proc = Bun.spawn([bunPath, "run", entrypoint, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(stdout.trim()).toBe(packageJson.version);
  });

  test("-v prints the version from package.json", async () => {
    const proc = Bun.spawn([bunPath, "run", entrypoint, "-v"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(stdout.trim()).toBe(packageJson.version);
  });
});
