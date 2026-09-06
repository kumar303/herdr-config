#!/usr/bin/env node
// @ts-check

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const logPath = requiredEnvironment("TMUX_MOCK_LOG");
const sessionsPath = requiredEnvironment("TMUX_MOCK_SESSIONS");
const args = process.argv.slice(2);
appendFileSync(logPath, `${JSON.stringify(args)}\n`);

/** @type {{sessions: Record<string, {cwd: string, generation: number}>}} */
const state = JSON.parse(readFileSync(sessionsPath, "utf8"));
const commandIndex = args[0] === "-L" ? 2 : 0;
const command = args[commandIndex];
const commandArgs = args.slice(commandIndex + 1);
const sessionName = option(commandArgs, "-t") || option(commandArgs, "-s");

switch (command) {
  case "has-session":
    process.exitCode = sessionName && state.sessions[sessionName] ? 0 : 1;
    break;
  case "new-session": {
    if (!sessionName) fail("new-session requires -s");
    const previousGeneration = state.sessions[sessionName]?.generation || 0;
    state.sessions[sessionName] = {
      cwd: option(commandArgs, "-c") || "",
      generation: previousGeneration + 1,
    };
    saveState();
    break;
  }
  case "kill-session":
    if (!sessionName) fail("kill-session requires -t");
    delete state.sessions[sessionName];
    saveState();
    break;
  default:
    fail(`unexpected mock invocation: ${args.join(" ")}`);
}

/**
 * @param {string[]} values
 * @param {string} name
 * @returns {string | undefined}
 */
function option(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}

function saveState() {
  writeFileSync(sessionsPath, `${JSON.stringify(state)}\n`);
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
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(message);
  process.exit(1);
}
