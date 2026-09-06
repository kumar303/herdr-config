// @ts-check

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repositoryRoot, "dot-config", "herdr", "scripts", "split-vim-above.js");
const mockHerdrPath = join(repositoryRoot, "tests", "fixtures", "mock-herdr.js");

/** @typedef {Record<string, unknown>} Pane */

/** @type {string} */
let testDirectory;
/** @type {string} */
let logPath;
/** @type {string} */
let panesPath;
/** @type {string} */
let counterPath;
/** @type {string} */
let stateHome;

beforeEach(() => {
  testDirectory = mkdtempSync(join(tmpdir(), "split-vim-above-"));
  logPath = join(testDirectory, "calls.log");
  panesPath = join(testDirectory, "panes.json");
  counterPath = join(testDirectory, "counter");
  stateHome = join(testDirectory, "state");
  mkdirSync(stateHome);
  writeFileSync(logPath, "");
  writeFileSync(counterPath, "100\n");
});

afterEach(() => {
  rmSync(testDirectory, { recursive: true, force: true });
});

describe("split-vim-above", () => {
  it("opens Vim above the source pane when no marked pane exists", () => {
    setPanes([sourcePane({ cwd: "/tmp/a dir" })]);

    runScript();

    expect(calls()).toContainEqual([
      "pane",
      "split",
      "--pane",
      "w1:p1",
      "--direction",
      "down",
      "--ratio",
      "0.8",
      "--cwd",
      "/tmp/a dir",
      "--env",
      "HERDR_CONFIG_VIM_EDIT_PANE=w1/w1:t1",
      "--no-focus",
    ]);
    expect(calls()).toContainEqual(["pane", "swap", "--pane", "w1:p101", "--direction", "up"]);
    expect(calls()).toContainEqual(["pane", "run", "w1:p101", "vim", "/tmp/a dir"]);
  });

  it("closes the marked pane in the current tab without splitting", () => {
    setPanes([sourcePane()]);
    runScript();
    clearCalls();

    runScript();

    expect(calls()).toContainEqual(["pane", "close", "w1:p101"]);
    expect(commandCalls("split")).toHaveLength(0);
  });

  it("ignores a marked pane in another tab and workspace", () => {
    setPanes([
      sourcePane(),
      {
        pane_id: "w2:p9",
        terminal_id: "term_other",
        cwd: "/other",
        tab_id: "w2:t9",
        workspace_id: "w2",
        focused: true,
      },
    ]);
    writeMarker("w2", "w2:t9", {
      pane_id: "w2:p9",
      terminal_id: "term_other",
    });

    runScript();

    expect(commandCalls("split")).toHaveLength(1);
    expect(calls()).not.toContainEqual(["pane", "close", "w2:p9"]);
  });

  it("leaves an unrelated Vim pane alone", () => {
    setPanes([
      sourcePane(),
      {
        pane_id: "w1:p8",
        terminal_id: "term_manual",
        cwd: "/current",
        tab_id: "w1:t1",
        workspace_id: "w1",
        focused: false,
        title: "vim",
      },
    ]);

    runScript();

    expect(commandCalls("split")).toHaveLength(1);
    expect(calls()).not.toContainEqual(["pane", "close", "w1:p8"]);
  });

  it("opens instead of closing a pane whose ID matches stale state", () => {
    setPanes([sourcePane()]);
    writeMarker("w1", "w1:t1", {
      pane_id: "w1:p1",
      terminal_id: "old_terminal",
    });

    runScript();

    expect(commandCalls("split")).toHaveLength(1);
    expect(calls()).not.toContainEqual(["pane", "close", "w1:p1"]);
  });

  it("alternates open, close, and open with spaces in the cwd", () => {
    setPanes([sourcePane({ cwd: "/tmp/a dir" })]);

    runScript();
    runScript();
    runScript();

    expect(commandCalls("split")).toHaveLength(2);
    expect(calls()).toContainEqual(["pane", "close", "w1:p101"]);
    expect(calls()).toContainEqual(["pane", "run", "w1:p102", "vim", "/tmp/a dir"]);
  });
});

/**
 * @param {Partial<Pane>} [overrides]
 * @returns {Pane}
 */
function sourcePane(overrides = {}) {
  return {
    pane_id: "w1:p1",
    terminal_id: "term_source",
    cwd: "/current",
    tab_id: "w1:t1",
    workspace_id: "w1",
    focused: true,
    ...overrides,
  };
}

/** @param {Pane[]} panes */
function setPanes(panes) {
  writeFileSync(panesPath, `${JSON.stringify({ result: { panes } })}\n`);
}

function runScript() {
  const result = spawnSync(scriptPath, {
    encoding: "utf8",
    env: {
      ...process.env,
      HERDR_ACTIVE_PANE_ID: "w1:p1",
      HERDR_COMMAND: mockHerdrPath,
      HERDR_MOCK_COUNTER: counterPath,
      HERDR_MOCK_LOG: logPath,
      HERDR_MOCK_PANES: panesPath,
      HOME: testDirectory,
      XDG_STATE_HOME: stateHome,
    },
  });

  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
}

/** @returns {string[][]} */
function calls() {
  return readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => /** @type {string[]} */ (JSON.parse(line)));
}

/** @param {string} command */
function commandCalls(command) {
  return calls().filter((args) => args[0] === "pane" && args[1] === command);
}

function clearCalls() {
  writeFileSync(logPath, "");
}

/**
 * @param {string} workspaceId
 * @param {string} tabId
 * @param {{pane_id: string, terminal_id: string}} marker
 */
function writeMarker(workspaceId, tabId, marker) {
  const stateDirectory = join(stateHome, "herdr-config", "vim-pane-toggle");
  mkdirSync(stateDirectory, { recursive: true });
  const scope = `${encodeURIComponent(workspaceId)}__${encodeURIComponent(tabId)}`;
  writeFileSync(join(stateDirectory, `${scope}.json`), JSON.stringify(marker));
}
