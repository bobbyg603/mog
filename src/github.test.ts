import { describe, test, expect } from "bun:test";
import { cleanIssueTitle, getConventionalPrefix } from "./github";
import type { Issue } from "./github";

function makeIssue(labels: string): Issue {
  return { title: "", body: "", labels, comments: "" };
}

describe("cleanIssueTitle", () => {
  test("strips conventional commit prefix", () => {
    expect(cleanIssueTitle("fix: BlueSky Integration")).toBe("BlueSky Integration");
    expect(cleanIssueTitle("feat: Add new feature")).toBe("Add new feature");
    expect(cleanIssueTitle("chore: Update deps")).toBe("Update deps");
    expect(cleanIssueTitle("refactor: Clean up code")).toBe("Clean up code");
  });

  test("strips trailing issue references", () => {
    expect(cleanIssueTitle("BlueSky Integration [#154]")).toBe("BlueSky Integration");
    expect(cleanIssueTitle("Some feature [#42]")).toBe("Some feature");
  });

  test("strips both prefix and issue reference", () => {
    expect(cleanIssueTitle("fix: BlueSky Integration [#154]")).toBe("BlueSky Integration");
  });

  test("strips multiple issue references", () => {
    expect(cleanIssueTitle("fix: Something [#1] [#2]")).toBe("Something");
    expect(cleanIssueTitle("BlueSky [#154] Integration [#184]")).toBe("BlueSky Integration");
  });

  test("leaves clean titles unchanged", () => {
    expect(cleanIssueTitle("BlueSky Integration")).toBe("BlueSky Integration");
    expect(cleanIssueTitle("Add support for webhooks")).toBe("Add support for webhooks");
  });

  test("is case-insensitive for prefix", () => {
    expect(cleanIssueTitle("Fix: BlueSky Integration")).toBe("BlueSky Integration");
    expect(cleanIssueTitle("FIX: BlueSky Integration")).toBe("BlueSky Integration");
  });
});

describe("getConventionalPrefix", () => {
  test("returns feat for enhancement label", () => {
    expect(getConventionalPrefix(makeIssue("enhancement"))).toBe("feat");
  });

  test("returns feat for feature label", () => {
    expect(getConventionalPrefix(makeIssue("feature"))).toBe("feat");
  });

  test("returns fix for bug label", () => {
    expect(getConventionalPrefix(makeIssue("bug"))).toBe("fix");
  });

  test("returns fix for no labels", () => {
    expect(getConventionalPrefix(makeIssue("none"))).toBe("fix");
  });

  test("does not false-positive on substring matches", () => {
    expect(getConventionalPrefix(makeIssue("no-enhancement"))).toBe("fix");
    expect(getConventionalPrefix(makeIssue("feature-request"))).toBe("fix");
  });

  test("handles multiple labels", () => {
    expect(getConventionalPrefix(makeIssue("bug, enhancement"))).toBe("feat");
    expect(getConventionalPrefix(makeIssue("priority, bug"))).toBe("fix");
  });
});
