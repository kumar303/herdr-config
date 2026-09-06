#!/usr/bin/env node
// @ts-check

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {object} Pane
 * @property {string} pane_id
 * @property {string} [terminal_id]
 * @property {string} cwd
 * @property {string} tab_id
 * @property {string} workspace_id
 * @property {boolean} [focused]
 */

/** @typedef {{result: {panes: Pane[]}}} PaneListResponse */
/** @typedef {{result: {pane: Pane}}} PaneResponse */
/** @typedef {{pane_id: string, terminal_id: string}} PaneMarker */
/** @typedef {{cwd: string, session_name: string, last_opened_at: number}} VimSession */

const herdrCommand = process.env.HERDR_COMMAND || "herdr";
const tmuxCommand = process.env.TMUX_COMMAND || "tmux";
const tmuxSocketName = "herdr-config-kumar303";
const sessionLifetimeMs = 2 * 60 * 60 * 1_000;
const cacheDirectory =
  process.env.HERDR_CONFIG_CACHE_DIR || join(homedir(), ".cache", "herdr-config-kumar303");
const paneMarkerDirectory = join(cacheDirectory, "pane-markers");
const vimSessionDirectory = join(cacheDirectory, "vim-sessions");

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{allowFailure?: boolean}} [options]
 */
function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
  });

  if (result.error) {
    throw new Error(`could not run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0 && !options.allowFailure) {
    const detail = result.stderr.trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

/**
 * @template T
 * @param {string[]} args
 * @param {{allowFailure?: boolean}} [options]
 * @returns {T | null}
 */
function runHerdr(args, options = {}) {
  const result = runProcess(herdrCommand, args, options);
  if (result.status !== 0) return null;

  const output = result.stdout.trim();
  if (!output) return /** @type {T} */ ({});

  try {
    return /** @type {T} */ (JSON.parse(output));
  } catch {
    throw new Error(`herdr ${args.join(" ")} returned invalid JSON`);
  }
}

/**
 * @param {string[]} args
 * @param {{allowFailure?: boolean}} [options]
 */
function runTmux(args, options = {}) {
  return runProcess(tmuxCommand, ["-L", tmuxSocketName, ...args], options);
}

/** @param {string} sessionName */
function tmuxSessionExists(sessionName) {
  return runTmux(["has-session", "-t", sessionName], { allowFailure: true }).status === 0;
}

/** @returns {number} */
function now() {
  return process.env.HERDR_NOW_MS ? Number(process.env.HERDR_NOW_MS) : Date.now();
}

/**
 * @param {Pane[]} panes
 * @returns {Pane | undefined}
 */
function findSourcePane(panes) {
  for (const candidate of [process.env.HERDR_ACTIVE_PANE_ID, process.env.HERDR_PANE_ID]) {
    if (!candidate) continue;
    const pane = panes.find(({ pane_id }) => pane_id === candidate);
    if (pane) return pane;
  }

  const current = runHerdr(/** @type {string[]} */ (["pane", "current"]), {
    allowFailure: true,
  });
  const currentPane = /** @type {PaneResponse | null} */ (current)?.result?.pane;
  if (currentPane?.focused) return currentPane;

  return panes.find(
    (pane) =>
      pane.focused &&
      (!process.env.HERDR_ACTIVE_TAB_ID || pane.tab_id === process.env.HERDR_ACTIVE_TAB_ID) &&
      (!process.env.HERDR_ACTIVE_WORKSPACE_ID ||
        pane.workspace_id === process.env.HERDR_ACTIVE_WORKSPACE_ID),
  );
}

/**
 * @template T
 * @param {string} path
 * @returns {T | null}
 */
function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return /** @type {T} */ (JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

/**
 * @param {string} path
 * @param {unknown} value
 */
function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

/**
 * @param {string} lockDirectory
 * @returns {boolean}
 */
function acquireLock(lockDirectory) {
  try {
    mkdirSync(lockDirectory);
  } catch {
    let lockPid = 0;
    try {
      lockPid = Number.parseInt(readFileSync(join(lockDirectory, "pid"), "utf8"), 10);
      process.kill(lockPid, 0);
      return false;
    } catch {
      rmSync(lockDirectory, { recursive: true, force: true });
      mkdirSync(lockDirectory);
    }
  }

  writeFileSync(join(lockDirectory, "pid"), `${process.pid}\n`);
  return true;
}

/** @param {string} cwd */
function vimSessionIdentity(cwd) {
  const id = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
  return {
    id,
    sessionName: `herdr-vim-${id}`,
    stateFile: join(vimSessionDirectory, `${id}.json`),
  };
}

/**
 * Return the persistent tmux session for a directory, replacing it after two
 * hours without an open request from this script.
 *
 * @param {string} cwd
 */
function openVimSession(cwd) {
  mkdirSync(vimSessionDirectory, { recursive: true });
  const identity = vimSessionIdentity(cwd);
  const lockDirectory = `${identity.stateFile}.lock`;
  if (!acquireLock(lockDirectory)) {
    if (tmuxSessionExists(identity.sessionName)) return identity.sessionName;
    throw new Error(`Vim session is already being started for ${cwd}`);
  }

  try {
    const state = readJson(identity.stateFile);
    const session = /** @type {Partial<VimSession> | null} */ (state);
    const isFresh =
      session?.cwd === cwd &&
      session.session_name === identity.sessionName &&
      typeof session.last_opened_at === "number" &&
      now() - session.last_opened_at <= sessionLifetimeMs;
    const exists = tmuxSessionExists(identity.sessionName);

    if (!isFresh || !exists) {
      if (exists) {
        runTmux(["kill-session", "-t", identity.sessionName]);
      }
      runTmux(["new-session", "-d", "-s", identity.sessionName, "-c", cwd, 'exec vim "$PWD"']);
    }

    writeJsonAtomically(identity.stateFile, {
      cwd,
      session_name: identity.sessionName,
      last_opened_at: now(),
    });
    return identity.sessionName;
  } finally {
    rmSync(lockDirectory, { recursive: true, force: true });
  }
}

function startReaper() {
  if (process.env.HERDR_DISABLE_REAPER) return;
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--reap"], {
    detached: true,
    env: process.env,
    stdio: "ignore",
  });
  child.on("error", () => {});
  child.unref();
}

function reapExpiredSessions() {
  mkdirSync(vimSessionDirectory, { recursive: true });
  let activeSessions = 0;

  for (const entry of readdirSync(vimSessionDirectory)) {
    if (!entry.endsWith(".json")) continue;
    const stateFile = join(vimSessionDirectory, entry);
    const state = /** @type {Partial<VimSession> | null} */ (readJson(stateFile));
    if (
      !state?.session_name ||
      !state.cwd ||
      typeof state.last_opened_at !== "number" ||
      !tmuxSessionExists(state.session_name)
    ) {
      rmSync(stateFile, { force: true });
      continue;
    }

    if (now() - state.last_opened_at > sessionLifetimeMs) {
      runTmux(["kill-session", "-t", state.session_name], { allowFailure: true });
      rmSync(stateFile, { force: true });
      continue;
    }
    activeSessions += 1;
  }

  return activeSessions;
}

function runReaper() {
  mkdirSync(cacheDirectory, { recursive: true });
  const lockDirectory = join(cacheDirectory, "vim-reaper.lock");
  if (!acquireLock(lockDirectory)) return;

  try {
    do {
      const activeSessions = reapExpiredSessions();
      if (process.env.HERDR_REAPER_RUN_ONCE || activeSessions === 0) return;
      const interval = Number(process.env.HERDR_REAPER_INTERVAL_MS || 60_000);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, interval);
    } while (true);
  } finally {
    rmSync(lockDirectory, { recursive: true, force: true });
  }
}

function main() {
  const paneList = runHerdr(/** @type {string[]} */ (["pane", "list"]));
  const panes = /** @type {PaneListResponse} */ (paneList).result.panes;
  const sourcePane = findSourcePane(panes);

  if (!sourcePane?.pane_id || !sourcePane.tab_id || !sourcePane.workspace_id || !sourcePane.cwd) {
    throw new Error("could not determine the focused pane, tab, and cwd");
  }

  mkdirSync(paneMarkerDirectory, { recursive: true });
  try {
    chmodSync(cacheDirectory, 0o700);
  } catch {
    // A restrictive mode is best effort on filesystems without POSIX modes.
  }

  const scope = `${encodeURIComponent(sourcePane.workspace_id)}__${encodeURIComponent(sourcePane.tab_id)}`;
  const stateFile = join(paneMarkerDirectory, `${scope}.json`);
  const lockDirectory = `${stateFile}.lock`;
  if (!acquireLock(lockDirectory)) return;

  try {
    const marker = /** @type {Partial<PaneMarker> | null} */ (readJson(stateFile));
    const markedPane = marker
      ? panes.find(
          (pane) =>
            pane.pane_id === marker.pane_id &&
            pane.terminal_id === marker.terminal_id &&
            pane.tab_id === sourcePane.tab_id &&
            pane.workspace_id === sourcePane.workspace_id,
        )
      : undefined;

    if (markedPane) {
      runHerdr(["pane", "close", markedPane.pane_id]);
      rmSync(stateFile, { force: true });
      return;
    }
    rmSync(stateFile, { force: true });

    const vimSessionName = openVimSession(sourcePane.cwd);
    startReaper();

    /** @type {string | undefined} */
    let newPaneId;
    try {
      const split = /** @type {PaneResponse} */ (
        runHerdr([
          "pane",
          "split",
          "--pane",
          sourcePane.pane_id,
          "--direction",
          "down",
          "--ratio",
          "0.8",
          "--cwd",
          sourcePane.cwd,
          "--env",
          `HERDR_CONFIG_VIM_EDIT_PANE=${sourcePane.workspace_id}/${sourcePane.tab_id}`,
          "--no-focus",
        ])
      );
      newPaneId = split.result?.pane?.pane_id;
      if (!newPaneId) throw new Error("split did not return a new pane ID");

      runHerdr(["pane", "swap", "--pane", newPaneId, "--direction", "up"]);
      runHerdr([
        "pane",
        "run",
        newPaneId,
        "env",
        "-u",
        "TMUX",
        tmuxCommand,
        "-L",
        tmuxSocketName,
        "attach-session",
        "-t",
        vimSessionName,
      ]);

      let terminalId = split.result.pane.terminal_id;
      if (!terminalId) {
        const pane = /** @type {PaneResponse} */ (runHerdr(["pane", "get", newPaneId]));
        terminalId = pane.result?.pane?.terminal_id;
      }
      if (!terminalId) {
        throw new Error("could not determine the new pane terminal ID");
      }

      writeJsonAtomically(stateFile, {
        pane_id: newPaneId,
        terminal_id: terminalId,
      });
      newPaneId = undefined;
    } finally {
      if (newPaneId) {
        try {
          runHerdr(["pane", "close", newPaneId]);
        } catch {
          // Preserve the original error if cleanup also fails.
        }
      }
    }
  } finally {
    rmSync(lockDirectory, { recursive: true, force: true });
  }
}

try {
  if (process.argv[2] === "--reap") {
    runReaper();
  } else {
    main();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`split-vim-above: ${message}`);
  process.exitCode = 1;
}
