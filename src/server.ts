import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";

import { Router } from "./http/router.js";
import { sendJson } from "./http/json.js";
import { registerTaskRoutes } from "./tasks/routes.js";
import { TaskStore } from "./tasks/store.js";

// Read at runtime rather than imported, so the same path works from src/ under
// Vitest and from dist/ after a build: package.json is one level up from both.
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

export interface App {
  server: Server;
  store: TaskStore;
}

/**
 * Builds the HTTP server and the store it talks to. Nothing listens yet — the
 * caller decides on a port, which is what lets the tests bind to port 0.
 */
export function createApp(store: TaskStore = new TaskStore()): App {
  const startedAt = Date.now();
  const router = new Router();

  router.get("/health", ({ res }) => {
    sendJson(res, 200, {
      status: "ok",
      version,
      uptimeMs: Date.now() - startedAt,
      tasks: store.size,
    });
  });

  registerTaskRoutes(router, store);

  const server = createHttpServer((req, res) => {
    // `handle` is written not to reject; this is the belt to that suspenders,
    // because an unhandled rejection here would take the process down.
    router.handle(req, res).catch((error: unknown) => {
      console.error("[router]", error);
      res.destroy();
    });
  });

  return { server, store };
}
