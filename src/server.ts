import { createServer as createHttpServer, type Server } from "node:http";

import { Router } from "./http/router.js";
import { sendJson } from "./http/json.js";
import { registerTaskRoutes } from "./tasks/routes.js";
import { TaskStore } from "./tasks/store.js";

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
      uptimeMs: Date.now() - startedAt,
      tasks: store.size,
    });
  });

  registerTaskRoutes(router, store);

  const server = createHttpServer((req, res) => {
    void router.handle(req, res);
  });

  return { server, store };
}
