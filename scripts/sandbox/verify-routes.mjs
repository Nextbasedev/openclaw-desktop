#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

const ROUTES = [
  { path: "/", waitFor: "OpenClaw", expectMain: "Select model" },
  { path: "/connect", waitFor: "Gateway Settings", expectMain: "Gateway Settings" },
  { path: "/settings", waitFor: "Memory", expectMain: "Memory" },
  { path: "/skill", waitFor: "Discover Skills", expectMain: "Discover Skills" },
  { path: "/notifications", waitFor: "Cron Jobs", expectMain: "Cron Jobs" },
];

function parseArgs(argv) {
  const options = { port: 3000, host: "127.0.0.1", timeout: 15_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }
    if (key === "port") {
      options.port = Number(value);
    } else if (key === "host") {
      options.host = value;
    } else if (key === "timeout") {
      options.timeout = Number(value);
    } else {
      throw new Error(`Unknown option: --${key}`);
    }
  }
  return options;
}

function runRoute(route, options) {
  const args = [
    "scripts/sandbox/verify-ui.mjs",
    `--port=${options.port}`,
    `--host=${options.host}`,
    `--path=${route.path}`,
    `--wait-for=${route.waitFor}`,
    `--expect-main=${route.expectMain}`,
    `--timeout=${options.timeout}`,
  ];

  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", (code) => resolve({ route, code }));
  });
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const results = [];
  for (const route of ROUTES) {
    console.log(`\n=== Verifying ${route.path} ===`);
    results.push(await runRoute(route, options));
  }

  const failures = results.filter((result) => result.code !== 0);
  if (failures.length > 0) {
    console.error(
      `\nRoute sandbox failed for: ${failures.map((failure) => failure.route.path).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nAll route sandbox checks passed.");
}

run().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
