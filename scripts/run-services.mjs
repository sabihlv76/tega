// Shared process runner for the dev and start launchers: runs several Node processes side by side,
// prefixes their output, and stops all of them (including child processes) on Ctrl+C or when one exits.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const ESC = "\x1b[";
export const paint = (code, text) => (process.stdout.isTTY ? `${ESC}${code}m${text}${ESC}0m` : text);

/** Reads KEY=value pairs from .env and .env.local (shell variables win), without exporting them. */
export function readEnvFiles() {
  const out = {};
  for (const file of [".env", ".env.local"]) {
    const full = path.join(root, file);
    if (!existsSync(full)) continue;
    for (const line of readFileSync(full, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  return { ...out, ...process.env };
}

/** Resolves when the TCP port is free on this machine, rejects with a friendly message otherwise. */
export function assertPortFree(port, label) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`Port ${port} (${label}) is already in use. Stop the other program or change the port.`)));
    probe.once("listening", () => probe.close(() => resolve()));
    probe.listen(Number(port));
  });
}

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (isWin) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

function pipeLines(stream, prefix, target) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) target.write(`${prefix} ${line}\n`);
  });
  stream.on("end", () => {
    if (buffer) target.write(`${prefix} ${buffer}\n`);
  });
}

/**
 * services: [{ name, color, args: [script, ...args], env? }]
 * Each service runs as `node <args>` from the project root.
 */
export function runServices(services) {
  const width = Math.max(...services.map((s) => s.name.length));
  const children = [];
  let stopping = false;

  const stopAll = (code) => {
    if (stopping) return;
    stopping = true;
    // Give processes a moment to shut down cleanly (they also receive Ctrl+C), then force-stop them.
    const timer = setTimeout(() => {
      for (const child of children) killTree(child);
      process.exit(code);
    }, 2500);
    timer.unref();
    if (!isWin) for (const child of children) killTree(child);
    Promise.all(children.map((c) => (c.exitCode !== null ? null : new Promise((r) => c.once("exit", r))))).then(() => process.exit(code));
  };

  for (const service of services) {
    const prefix = paint(service.color, `[${service.name.padEnd(width)}]`);
    const child = spawn(process.execPath, service.args, {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? "1" : "0", ...service.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: !isWin,
      windowsHide: true,
    });
    children.push(child);
    pipeLines(child.stdout, prefix, process.stdout);
    pipeLines(child.stderr, prefix, process.stderr);
    child.on("exit", (code, signal) => {
      // On Windows every process in the console receives Ctrl+C, so a child can exit just before
      // our own SIGINT handler runs. Wait a moment before treating an exit as unexpected.
      setTimeout(() => {
        if (stopping) return;
        console.error(`${prefix} exited (${signal ?? `code ${code}`}). Stopping the other services.`);
        stopAll(code || 1);
      }, 400);
    });
  }

  process.on("SIGINT", () => stopAll(0));
  process.on("SIGTERM", () => stopAll(0));
  return children;
}
