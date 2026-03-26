import { describe, test, expect } from "bun:test";
import { parseMogIncludeFile, copyIncludeFiles, cleanupIncludeFiles } from "./include";
import fs from "fs";
import path from "path";
import os from "os";

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mog-test-"));
}

describe("parseMogIncludeFile", () => {
  test("returns empty array when .moginclude does not exist", () => {
    const tmpDir = createTmpDir();
    expect(parseMogIncludeFile(tmpDir)).toEqual([]);
    fs.rmSync(tmpDir, { recursive: true });
  });

  test("parses paths from .moginclude file", () => {
    const tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, ".moginclude"), ".env\nconfig/local/\n");

    const result = parseMogIncludeFile(tmpDir);
    expect(result).toEqual([
      path.resolve(tmpDir, ".env"),
      path.resolve(tmpDir, "config/local/"),
    ]);

    fs.rmSync(tmpDir, { recursive: true });
  });

  test("ignores comments and blank lines", () => {
    const tmpDir = createTmpDir();
    fs.writeFileSync(
      path.join(tmpDir, ".moginclude"),
      "# This is a comment\n\n.env\n\n# Another comment\ndata/\n"
    );

    const result = parseMogIncludeFile(tmpDir);
    expect(result).toEqual([
      path.resolve(tmpDir, ".env"),
      path.resolve(tmpDir, "data/"),
    ]);

    fs.rmSync(tmpDir, { recursive: true });
  });

  test("trims whitespace from lines", () => {
    const tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, ".moginclude"), "  .env  \n  config/  \n");

    const result = parseMogIncludeFile(tmpDir);
    expect(result).toEqual([
      path.resolve(tmpDir, ".env"),
      path.resolve(tmpDir, "config/"),
    ]);

    fs.rmSync(tmpDir, { recursive: true });
  });

  test("returns empty array for empty file", () => {
    const tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, ".moginclude"), "");

    expect(parseMogIncludeFile(tmpDir)).toEqual([]);

    fs.rmSync(tmpDir, { recursive: true });
  });

  test("returns empty array for file with only comments and blanks", () => {
    const tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, ".moginclude"), "# comment\n\n# another\n");

    expect(parseMogIncludeFile(tmpDir)).toEqual([]);

    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe("copyIncludeFiles", () => {
  test("copies a single file preserving relative path", () => {
    const repoRoot = createTmpDir();
    const worktreeDir = createTmpDir();

    const srcFile = path.join(repoRoot, ".env");
    fs.writeFileSync(srcFile, "SECRET=abc");

    const copied = copyIncludeFiles([srcFile], repoRoot, worktreeDir);

    expect(copied).toEqual([path.join(worktreeDir, ".env")]);
    expect(fs.readFileSync(path.join(worktreeDir, ".env"), "utf-8")).toBe("SECRET=abc");

    fs.rmSync(repoRoot, { recursive: true });
    fs.rmSync(worktreeDir, { recursive: true });
  });

  test("copies a file in a nested directory preserving relative path", () => {
    const repoRoot = createTmpDir();
    const worktreeDir = createTmpDir();

    const nestedDir = path.join(repoRoot, "config", "local");
    fs.mkdirSync(nestedDir, { recursive: true });
    const srcFile = path.join(nestedDir, "settings.json");
    fs.writeFileSync(srcFile, '{"key": "value"}');

    const copied = copyIncludeFiles([srcFile], repoRoot, worktreeDir);

    expect(copied).toEqual([path.join(worktreeDir, "config", "local", "settings.json")]);
    expect(fs.readFileSync(copied[0]!, "utf-8")).toBe('{"key": "value"}');

    fs.rmSync(repoRoot, { recursive: true });
    fs.rmSync(worktreeDir, { recursive: true });
  });

  test("copies a directory recursively", () => {
    const repoRoot = createTmpDir();
    const worktreeDir = createTmpDir();

    const srcDir = path.join(repoRoot, "config", "local");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "a.txt"), "aaa");
    fs.writeFileSync(path.join(srcDir, "b.txt"), "bbb");

    const copied = copyIncludeFiles([srcDir], repoRoot, worktreeDir);

    expect(copied).toEqual([path.join(worktreeDir, "config", "local")]);
    expect(fs.readFileSync(path.join(worktreeDir, "config", "local", "a.txt"), "utf-8")).toBe("aaa");
    expect(fs.readFileSync(path.join(worktreeDir, "config", "local", "b.txt"), "utf-8")).toBe("bbb");

    fs.rmSync(repoRoot, { recursive: true });
    fs.rmSync(worktreeDir, { recursive: true });
  });

  test("copies multiple files and directories", () => {
    const repoRoot = createTmpDir();
    const worktreeDir = createTmpDir();

    // Create a file
    fs.writeFileSync(path.join(repoRoot, ".env"), "SECRET=123");

    // Create a directory with contents
    const dir = path.join(repoRoot, "fixtures");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "data.json"), '{"x":1}');

    const copied = copyIncludeFiles(
      [path.join(repoRoot, ".env"), dir],
      repoRoot,
      worktreeDir
    );

    expect(copied).toHaveLength(2);
    expect(fs.existsSync(path.join(worktreeDir, ".env"))).toBe(true);
    expect(fs.existsSync(path.join(worktreeDir, "fixtures", "data.json"))).toBe(true);

    fs.rmSync(repoRoot, { recursive: true });
    fs.rmSync(worktreeDir, { recursive: true });
  });

  test("copies a nested directory when parent does not exist in worktree", () => {
    const repoRoot = createTmpDir();
    const worktreeDir = createTmpDir();

    const srcDir = path.join(repoRoot, "config", "local");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "a.txt"), "aaa");

    // worktreeDir/config/ does not exist — copyIncludeFiles must create it
    const copied = copyIncludeFiles([srcDir], repoRoot, worktreeDir);

    expect(copied).toEqual([path.join(worktreeDir, "config", "local")]);
    expect(fs.readFileSync(path.join(worktreeDir, "config", "local", "a.txt"), "utf-8")).toBe("aaa");

    fs.rmSync(repoRoot, { recursive: true });
    fs.rmSync(worktreeDir, { recursive: true });
  });

  test("returns empty array when no files to copy", () => {
    const repoRoot = createTmpDir();
    const worktreeDir = createTmpDir();

    const copied = copyIncludeFiles([], repoRoot, worktreeDir);
    expect(copied).toEqual([]);

    fs.rmSync(repoRoot, { recursive: true });
    fs.rmSync(worktreeDir, { recursive: true });
  });
});

describe("cleanupIncludeFiles", () => {
  test("unstages a copied file but leaves it on disk", () => {
    const worktreeDir = createTmpDir();
    const filePath = path.join(worktreeDir, ".env");
    fs.writeFileSync(filePath, "SECRET=abc");

    cleanupIncludeFiles([filePath], worktreeDir);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("SECRET=abc");

    fs.rmSync(worktreeDir, { recursive: true });
  });

  test("unstages a copied directory but leaves it on disk", () => {
    const worktreeDir = createTmpDir();
    const dirPath = path.join(worktreeDir, "config", "local");
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, "a.txt"), "aaa");

    cleanupIncludeFiles([dirPath], worktreeDir);

    expect(fs.existsSync(dirPath)).toBe(true);
    expect(fs.readFileSync(path.join(dirPath, "a.txt"), "utf-8")).toBe("aaa");

    fs.rmSync(worktreeDir, { recursive: true });
  });

  test("handles already-removed files gracefully", () => {
    const worktreeDir = createTmpDir();
    const filePath = path.join(worktreeDir, "gone.txt");

    // Should not throw
    cleanupIncludeFiles([filePath], worktreeDir);

    fs.rmSync(worktreeDir, { recursive: true });
  });

  test("unstages multiple files and directories but leaves them on disk", () => {
    const worktreeDir = createTmpDir();

    const file = path.join(worktreeDir, ".env");
    fs.writeFileSync(file, "data");

    const dir = path.join(worktreeDir, "fixtures");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "x.txt"), "x");

    cleanupIncludeFiles([file, dir], worktreeDir);

    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.readFileSync(path.join(dir, "x.txt"), "utf-8")).toBe("x");

    fs.rmSync(worktreeDir, { recursive: true });
  });
});
