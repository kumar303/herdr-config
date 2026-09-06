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
const mockTmuxPath = join(repositoryRoot, "tests", "fixtures", "mock-tmux.js");

/** @typedef {Record<string, unknown>} Pane */

/** @type {string} */
let testDirectory;
/** @type {string} */
let herdrLogPath;
/** @type {string} */
let panesPath;
/** @type {string} */
let counterPath;
/** @type {string} */
let cacheDirectory;
/** @type {string} */
let tmuxLogPath;
/** @type {string} */
let tmuxSessionsPath;

beforeEach(() => {
  testDirectory = mkdtempSync(join(tmpdir(), "split-vim-above-"));
  herdrLogPath = join(testDirectory, "herdr-calls.log");
  panesPath = join(testDirectory, "panes.json");
  counterPath = join(testDirectory, "counter");
  cacheDirectory = join(testDirectory, "cache");
  tmuxLogPath = join(testDirectory, "tmux-calls.log");
  tmuxSessionsPath = join(testDirectory, "tmux-sessions.json");
  mkdirSync(cacheDirectory);
  writeFileSync(herdrLogPath, "");
  writeFileSync(tmuxLogPath, "");
  writeFileSync(counterPath, "100\n");
  writeFileSync(tmuxSessionsPath, '{"sessions":{}}\n');
});

afterEach(() => {
  rmSync(testDirectory, { recursive: true, force: true });
});

describe("split-vim-above", () => {
  it("starts persistent Vim and opens it above the source pane", () => {
    setPanes([sourcePane({ cwd: "/tmp/a dir" })]);

    runScript();

    expect(herdrCalls()).toContainEqual([
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
    const newSession = tmuxCommandCalls("new-session")[0];
    expect(newSession).toEqual([
      "-L",
      "herdr-config-kumar303",
      "new-session",
      "-d",
      "-s",
      expect.stringMatching(/^herdr-vim-[a-f0-9]{16}$/),
      "-c",
      "/tmp/a dir",
      'exec vim "$PWD"',
    ]);
    const sessionName = option(newSession, "-s");
    expect(herdrCalls()).toContainEqual([
      "pane",
      "run",
      "w1:p101",
      "env",
      "-u",
      "TMUX",
      mockTmuxPath,
      "-L",
      "herdr-config-kumar303",
      "attach-session",
      "-t",
      sessionName,
    ]);
  });

  it("closes the marked pane in the current tab without splitting", () => {
    setPanes([sourcePane()]);
    runScript();
    clearHerdrCalls();

    runScript();

    expect(herdrCalls()).toContainEqual(["pane", "close", "w1:p101"]);
    expect(herdrCommandCalls("split")).toHaveLength(0);
  });

  it("reconnects to the same Vim process for the same cwd", () => {
    setPanes([sourcePane({ cwd: "/tmp/project" })]);

    runScript({ now: 1_000 });
    runScript({ now: 2_000 });
    runScript({ now: 3_000 });

    expect(tmuxCommandCalls("new-session")).toHaveLength(1);
    const attachCalls = herdrCommandCalls("run");
    expect(attachCalls).toHaveLength(2);
    expect(option(attachCalls[0], "-t")).toBe(option(attachCalls[1], "-t"));
  });

  it("starts separate Vim processes for different directories", () => {
    setPanes([
      sourcePane({ cwd: "/tmp/project-one" }),
      sourcePane({
        pane_id: "w1:p2",
        terminal_id: "term_source_two",
        cwd: "/tmp/project-two",
        tab_id: "w1:t2",
        focused: false,
      }),
    ]);

    runScript({ paneId: "w1:p1" });
    runScript({ paneId: "w1:p2" });

    const newSessions = tmuxCommandCalls("new-session");
    expect(newSessions).toHaveLength(2);
    expect(option(newSessions[0], "-s")).not.toBe(option(newSessions[1], "-s"));
  });

  it("replaces a Vim process not opened in over two hours", () => {
    setPanes([sourcePane({ cwd: "/tmp/project" })]);

    runScript({ now: 1_000 });
    runScript({ now: 2_000 });
    runScript({ now: 2 * 60 * 60 * 1_000 + 1_001 });

    expect(tmuxCommandCalls("new-session")).toHaveLength(2);
    expect(tmuxCommandCalls("kill-session")).toHaveLength(1);
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
    writePaneMarker("w2", "w2:t9", {
      pane_id: "w2:p9",
      terminal_id: "term_other",
    });

    runScript();

    expect(herdrCommandCalls("split")).toHaveLength(1);
    expect(herdrCalls()).not.toContainEqual(["pane", "close", "w2:p9"]);
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

    expect(herdrCommandCalls("split")).toHaveLength(1);
    expect(herdrCalls()).not.toContainEqual(["pane", "close", "w1:p8"]);
  });

  it("opens instead of closing a pane whose ID matches stale state", () => {
    setPanes([sourcePane()]);
    writePaneMarker("w1", "w1:t1", {
      pane_id: "w1:p1",
      terminal_id: "old_terminal",
    });

    runScript();

    expect(herdrCommandCalls("split")).toHaveLength(1);
    expect(herdrCalls()).not.toContainEqual(["pane", "close", "w1:p1"]);
  });

  it("alternates open, close, and open with spaces in the cwd", () => {
    setPanes([sourcePane({ cwd: "/tmp/a dir" })]);

    runScript();
    runScript();
    runScript();

    expect(herdrCommandCalls("split")).toHaveLength(2);
    expect(herdrCalls()).toContainEqual(["pane", "close", "w1:p101"]);
    expect(tmuxCommandCalls("new-session")).toHaveLength(1);
  });

  it("starts a background reaper that removes stale directory sessions", async () => {
    setPanes([sourcePane({ cwd: "/tmp/current" })]);
    const staleSession = "herdr-vim-0000000000000000";
    setTmuxSessions({
      [staleSession]: { cwd: "/tmp/stale", generation: 1 },
    });
    writeVimSession("stale", {
      cwd: "/tmp/stale",
      session_name: staleSession,
      last_opened_at: 1_000,
    });

    runScript({ now: 2 * 60 * 60 * 1_000 + 1_001, runReaperOnce: true });

    await expect
      .poll(() => tmuxCommandCalls("kill-session"), { timeout: 2_000 })
      .toContainEqual(["-L", "herdr-config-kumar303", "kill-session", "-t", staleSession]);
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

/** @param {Record<string, {cwd: string, generation: number}>} sessions */
function setTmuxSessions(sessions) {
  writeFileSync(tmuxSessionsPath, `${JSON.stringify({ sessions })}\n`);
}

/**
 * @param {{paneId?: string, now?: number, runReaperOnce?: boolean}} [options]
 */
function runScript(options = {}) {
  const result = spawnSync(scriptPath, {
    encoding: "utf8",
    env: {
      ...process.env,
      HERDR_ACTIVE_PANE_ID: options.paneId || "w1:p1",
      HERDR_COMMAND: mockHerdrPath,
      HERDR_CONFIG_CACHE_DIR: cacheDirectory,
      HERDR_DISABLE_REAPER: options.runReaperOnce ? undefined : "1",
      HERDR_MOCK_COUNTER: counterPath,
      HERDR_MOCK_LOG: herdrLogPath,
      HERDR_MOCK_PANES: panesPath,
      HERDR_NOW_MS: String(options.now ?? 1_000),
      HERDR_REAPER_RUN_ONCE: options.runReaperOnce ? "1" : undefined,
      HOME: testDirectory,
      TMUX_COMMAND: mockTmuxPath,
      TMUX_MOCK_LOG: tmuxLogPath,
      TMUX_MOCK_SESSIONS: tmuxSessionsPath,
    },
  });

  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
}

/** @returns {string[][]} */
function herdrCalls() {
  return readCalls(herdrLogPath);
}

/** @returns {string[][]} */
function tmuxCalls() {
  return readCalls(tmuxLogPath);
}

/** @param {string} command */
function herdrCommandCalls(command) {
  return herdrCalls().filter((args) => args[0] === "pane" && args[1] === command);
}

/** @param {string} command */
function tmuxCommandCalls(command) {
  return tmuxCalls().filter((args) => args[0] === "-L" && args[2] === command);
}

/** @param {string} path */
function readCalls(path) {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => /** @type {string[]} */ (JSON.parse(line)));
}

function clearHerdrCalls() {
  writeFileSync(herdrLogPath, "");
}

/**
 * @param {string[]} args
 * @param {string} name
 */
function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

/**
 * @param {string} workspaceId
 * @param {string} tabId
 * @param {{pane_id: string, terminal_id: string}} marker
 */
function writePaneMarker(workspaceId, tabId, marker) {
  const stateDirectory = join(cacheDirectory, "pane-markers");
  mkdirSync(stateDirectory, { recursive: true });
  const scope = `${encodeURIComponent(workspaceId)}__${encodeURIComponent(tabId)}`;
  writeFileSync(join(stateDirectory, `${scope}.json`), JSON.stringify(marker));
}

/**
 * @param {string} id
 * @param {{cwd: string, session_name: string, last_opened_at: number}} marker
 */
function writeVimSession(id, marker) {
  const stateDirectory = join(cacheDirectory, "vim-sessions");
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(join(stateDirectory, `${id}.json`), JSON.stringify(marker));
}
