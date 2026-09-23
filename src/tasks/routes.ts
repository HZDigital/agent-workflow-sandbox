import type { Router } from "../http/router.js";
import { readJsonBody, sendEmpty, sendJson } from "../http/json.js";
import type { TaskStore } from "./store.js";
import { parseCreateTask, parseListQuery, parseUpdateTask } from "./validation.js";

export function registerTaskRoutes(router: Router, store: TaskStore): Router {
  router.get("/tasks", ({ res, query }) => {
    const parsed = parseListQuery(query);
    const tasks = store.list(parsed);
    sendJson(res, 200, { tasks, count: tasks.length });
  });

  router.post("/tasks", async ({ req, res }) => {
    const body = await readJsonBody(req);
    const task = store.create(parseCreateTask(body));
    sendJson(res, 201, { task });
  });

  router.get("/tasks/:id", ({ res, params }) => {
    sendJson(res, 200, { task: store.get(params["id"] as string) });
  });

  router.patch("/tasks/:id", async ({ req, res, params }) => {
    const body = await readJsonBody(req);
    const task = store.update(params["id"] as string, parseUpdateTask(body));
    sendJson(res, 200, { task });
  });

  router.delete("/tasks/:id", ({ res, params }) => {
    store.remove(params["id"] as string);
    sendEmpty(res, 204);
  });

  return router;
}
