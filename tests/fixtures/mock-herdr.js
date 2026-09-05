#!/usr/bin/env node
// @ts-check

import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const logPath = requiredEnvironment("HERDR_MOCK_LOG");
const panesPath = requiredEnvironment("HERDR_MOCK_PANES");
const counterPath = requiredEnvironment("HERDR_MOCK_COUNTER");
const args = process.argv.slice(2);
appendFileSync(logPath, `${JSON.stringify(args)}\n`);

/** @type {{result: {panes: Array<Record<string, unknown>>}}} */
const state = JSON.parse(readFileSync(panesPath, "utf8"));
const [area, command] = args;

if (area !== "pane") fail(`unexpected mock invocation: ${args.join(" ")}`);

switch (command) {
  case "list":
    output(state);
    break;
  case "current":
    process.exitCode = 1;
    break;
  case "split": {
    const sourcePaneId = option(args, "--pane");
    const cwd = option(args, "--cwd");
    const sourcePane = state.result.panes.find((pane) => pane.pane_id === sourcePaneId);
    if (!sourcePane) fail(`source pane not found: ${sourcePaneId}`);

    const next = Number.parseInt(readFileSync(counterPath, "utf8"), 10) + 1;
    writeFileSync(counterPath, `${next}\n`);
    const pane = {
      pane_id: `w1:p${next}`,
      terminal_id: `term_${next}`,
      cwd,
      tab_id: sourcePane.tab_id,
      workspace_id: sourcePane.workspace_id,
      focused: false,
    };
    state.result.panes.push(pane);
    saveState(state);
    output({ result: { pane, marker: option(args, "--env") } });
    break;
  }
  case "close": {
    const paneId = args[2];
    state.result.panes = state.result.panes.filter((pane) => pane.pane_id !== paneId);
    saveState(state);
    output({ result: {} });
    break;
  }
  case "get": {
    const pane = state.result.panes.find((item) => item.pane_id === args[2]);
    output({ result: { pane } });
    break;
  }
  case "swap":
  case "run":
    output({ result: {} });
    break;
  default:
    fail(`unexpected mock invocation: ${args.join(" ")}`);
}

/**
 * @param {string} name
 * @returns {string}
 */
function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable: ${name}`);
  return value;
}

/**
 * @param {string[]} values
 * @param {string} name
 * @returns {string}
 */
function option(values, name) {
  const index = values.indexOf(name);
  if (index < 0 || !values[index + 1]) fail(`missing option: ${name}`);
  return values[index + 1];
}

/** @param {unknown} value */
function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/** @param {{result: {panes: Array<Record<string, unknown>>}}} value */
function saveState(value) {
  const temporaryPath = `${panesPath}.${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`);
  renameSync(temporaryPath, panesPath);
}

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(message);
  process.exit(1);
}
