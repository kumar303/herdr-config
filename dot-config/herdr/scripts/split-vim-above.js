#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * @typedef {object} Pane
 * @property {string} pane_id
 * @property {string} terminal_id
 * @property {string} cwd
 * @property {string} tab_id
 * @property {string} workspace_id
 * @property {boolean} [focused]
 */

/** @typedef {{result: {panes: Pane[]}}} PaneListResponse */
/** @typedef {{result: {pane: Pane}}} PaneResponse */
/** @typedef {{pane_id: string, terminal_id: string}} PaneMarker */

const herdrCommand = process.env.HERDR_COMMAND || "herdr";

/**
 * @template T
 * @param {string[]} args
 * @param {{allowFailure?: boolean}} [options]
 * @returns {T | null}
 */
function runHerdr(args, options = {}) {
  const result = spawnSync(herdrCommand, args, {
    encoding: "utf8",
    env: process.env,
  });

  if (result.error) {
    throw new Error(`could not run ${herdrCommand}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (options.allowFailure) return null;
    const detail = result.stderr.trim();
    throw new Error(`herdr ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }

  const output = result.stdout.trim();
  if (!output) return /** @type {T} */ ({});

  try {
    return /** @type {T} */ (JSON.parse(output));
  } catch {
    throw new Error(`herdr ${args.join(" ")} returned invalid JSON`);
  }
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
 * @param {string} stateFile
 * @returns {PaneMarker | null}
 */
function readMarker(stateFile) {
  if (!existsSync(stateFile)) return null;

  try {
    const value = /** @type {Partial<PaneMarker>} */ (JSON.parse(readFileSync(stateFile, "utf8")));
    if (value.pane_id && value.terminal_id) {
      return /** @type {PaneMarker} */ (value);
    }
  } catch {
    // The caller removes invalid and stale state.
  }
  return null;
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

function main() {
  const paneList = runHerdr(/** @type {string[]} */ (["pane", "list"]));
  const panes = /** @type {PaneListResponse} */ (paneList).result.panes;
  const sourcePane = findSourcePane(panes);

  if (!sourcePane?.pane_id || !sourcePane.tab_id || !sourcePane.workspace_id || !sourcePane.cwd) {
    throw new Error("could not determine the focused pane, tab, and cwd");
  }

  const stateRoot =
    process.env.HERDR_VIM_TOGGLE_STATE_DIR ||
    join(
      process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
      "herdr-config",
      "vim-pane-toggle",
    );
  mkdirSync(stateRoot, { recursive: true });
  try {
    chmodSync(stateRoot, 0o700);
  } catch {
    // A restrictive mode is best effort on filesystems without POSIX modes.
  }

  const scope = `${encodeURIComponent(sourcePane.workspace_id)}__${encodeURIComponent(sourcePane.tab_id)}`;
  const stateFile = join(stateRoot, `${scope}.json`);
  const lockDirectory = `${stateFile}.lock`;
  if (!acquireLock(lockDirectory)) return;

  try {
    const marker = readMarker(stateFile);
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
      runHerdr(["pane", "run", newPaneId, "vim", sourcePane.cwd]);

      let terminalId = split.result.pane.terminal_id;
      if (!terminalId) {
        const pane = /** @type {PaneResponse} */ (runHerdr(["pane", "get", newPaneId]));
        terminalId = pane.result?.pane?.terminal_id;
      }
      if (!terminalId) {
        throw new Error("could not determine the new pane terminal ID");
      }

      const temporaryStateFile = `${stateFile}.${process.pid}`;
      writeFileSync(
        temporaryStateFile,
        `${JSON.stringify({ pane_id: newPaneId, terminal_id: terminalId })}\n`,
        { mode: 0o600 },
      );
      renameSync(temporaryStateFile, stateFile);
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
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`split-vim-above: ${message}`);
  process.exitCode = 1;
}
