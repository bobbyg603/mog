import { describe, test, expect } from "bun:test";
import { readPlanFile, getUncheckedItems, isPlanComplete } from "./sandbox";
import fs from "fs";
import path from "path";
import os from "os";

describe("getUncheckedItems", () => {
  test("returns unchecked items from plan content", () => {
    const plan = `# Plan
- [ ] First task
- [x] Second task (done)
- [ ] Third task`;
    expect(getUncheckedItems(plan)).toEqual([
      "- [ ] First task",
      "- [ ] Third task",
    ]);
  });

  test("returns empty array when all items are checked", () => {
    const plan = `# Plan
- [x] First task
- [x] Second task`;
    expect(getUncheckedItems(plan)).toEqual([]);
  });

  test("returns empty array for content with no checklist items", () => {
    expect(getUncheckedItems("Just some text")).toEqual([]);
  });

  test("returns empty array for empty string", () => {
    expect(getUncheckedItems("")).toEqual([]);
  });
});

describe("isPlanComplete", () => {
  test("returns true when all items are checked", () => {
    const plan = `# Plan
- [x] First task
- [x] Second task`;
    expect(isPlanComplete(plan)).toBe(true);
  });

  test("returns false when unchecked items remain", () => {
    const plan = `# Plan
- [x] First task
- [ ] Second task`;
    expect(isPlanComplete(plan)).toBe(false);
  });

  test("returns false when there are no checklist items at all", () => {
    expect(isPlanComplete("Just some text")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isPlanComplete("")).toBe(false);
  });
});

describe("readPlanFile", () => {
  test("returns file content when plan file exists", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mog-test-"));
    const planContent = "# Plan\n- [ ] Task one\n";
    fs.writeFileSync(path.join(tmpDir, "IMPLEMENTATION_PLAN.md"), planContent);

    expect(readPlanFile(tmpDir)).toBe(planContent);

    fs.rmSync(tmpDir, { recursive: true });
  });

  test("returns null when plan file does not exist", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mog-test-"));

    expect(readPlanFile(tmpDir)).toBeNull();

    fs.rmSync(tmpDir, { recursive: true });
  });
});
