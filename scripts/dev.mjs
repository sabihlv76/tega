// `npm run dev`: starts the API (auto-restarts on change) and the web app (hot reload) together.
import { existsSync } from "node:fs";
import path from "node:path";
import { assertPortFree, paint, readEnvFiles, root, runServices } from "./run-services.mjs";

const env = readEnvFiles();
const apiPort = env.API_PORT || "4000";
const webPort = process.env.WEB_PORT || "4544";

const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
if (!existsSync(tsx) || !existsSync(next)) {
  console.error("Dependencies are missing. Run `npm install` first.");
  process.exit(1);
}

try {
  await assertPortFree(apiPort, "API");
  await assertPortFree(webPort, "web app");
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

console.log(paint("1", "FIKA development"));
console.log(`  web  ${paint("4", `http://localhost:${webPort}`)}`);
console.log(`  api  ${paint("4", `http://localhost:${apiPort}/api/v1/health`)}`);
if (!env.MONGODB_URI) {
  console.log(
    paint("33", "  No MONGODB_URI set: the API uses a local database (.data/mongo) with the bus parks and RURA fares.\n  Set MONGODB_URI in .env to use MongoDB Atlas."),
  );
}
console.log("");

const webEnv = {};
if (!env.API_URL) webEnv.API_URL = `http://localhost:${apiPort}`;
if (apiPort !== "4000" && !env.NEXT_PUBLIC_SOCKET_URL) webEnv.NEXT_PUBLIC_SOCKET_URL = `http://localhost:${apiPort}`;

runServices([
  { name: "api", color: "36", args: [tsx, "watch", "--clear-screen=false", "server/index.ts"] },
  { name: "web", color: "35", args: [next, "dev", "-p", webPort], env: webEnv },
]);
