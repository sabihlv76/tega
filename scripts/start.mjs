// `npm start`: runs the production build of the API and the web app. Build first with `npm run build`.
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { assertPortFree, paint, readEnvFiles, root, runServices } from "./run-services.mjs";

const env = readEnvFiles();
const apiPort = env.API_PORT || "4000";
const webPort = process.env.WEB_PORT || "4545";

const apiEntry = path.join(root, "dist", "server", "index.js");
const standalone = path.join(root, ".next", "standalone", "server.js");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

if (!existsSync(apiEntry) || !existsSync(path.join(root, ".next", "BUILD_ID"))) {
  console.error("No production build found. Run `npm run build` first.");
  process.exit(1);
}

try {
  await assertPortFree(apiPort, "API");
  await assertPortFree(webPort, "web app");
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

let web;
if (existsSync(standalone)) {
  // The standalone server serves static assets from folders next to it.
  cpSync(path.join(root, ".next", "static"), path.join(root, ".next", "standalone", ".next", "static"), { recursive: true });
  if (existsSync(path.join(root, "public"))) {
    cpSync(path.join(root, "public"), path.join(root, ".next", "standalone", "public"), { recursive: true });
  }
  web = { name: "web", color: "35", args: [standalone], env: { NODE_ENV: "production", PORT: webPort, HOSTNAME: env.HOSTNAME || "0.0.0.0" } };
} else {
  web = { name: "web", color: "35", args: [nextBin, "start", "-p", webPort], env: { NODE_ENV: "production" } };
}

console.log(paint("1", "FIKA production"));
console.log(`  web  ${paint("4", `http://localhost:${webPort}`)}`);
console.log(`  api  ${paint("4", `http://localhost:${apiPort}/api/v1/health`)}`);
console.log("");

runServices([{ name: "api", color: "36", args: [apiEntry], env: { NODE_ENV: "production" } }, web]);
