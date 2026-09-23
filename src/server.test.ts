import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "./server.js";
import type { TaskStore } from "./tasks/store.js";

let baseUrl: string;
let store: TaskStore;
let close: () => Promise<void>;

beforeAll(async () => {
  const app = createApp();
  store = app.store;

  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  close = () =>
    new Promise<void>((resolve, reject) => {
      app.server.close((error) => (error ? reject(error) : resolve()));
    });
});

afterAll(async () => {
  await close();
});

beforeEach(() => {
  store.clear();
});

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });

  const text = await response.text();
  return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
}

describe("GET /health", () => {
  it("reports ok and the current task count", async () => {
    const response = await api("GET", "/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.tasks).toBe(0);
    expect(typeof response.body.uptimeMs).toBe("number");
  });
});

describe("the task lifecycle", () => {
  it("creates, reads, updates and deletes a task", async () => {
    const created = await api("POST", "/tasks", { title: "Ship it", tags: ["CI", "ci"] });
    expect(created.status).toBe(201);
    expect(created.body.task).toMatchObject({
      title: "Ship it",
      status: "todo",
      priority: "normal",
      tags: ["ci"],
      dueDate: null,
    });

    const id = created.body.task.id as string;

    const read = await api("GET", `/tasks/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.task.id).toBe(id);

    const updated = await api("PATCH", `/tasks/${id}`, { status: "done" });
    expect(updated.status).toBe(200);
    expect(updated.body.task.status).toBe("done");
    expect(updated.body.task.title).toBe("Ship it");

    const deleted = await api("DELETE", `/tasks/${id}`);
    expect(deleted.status).toBe(204);
    expect(deleted.body).toBeUndefined();

    expect((await api("GET", `/tasks/${id}`)).status).toBe(404);
  });
});

describe("GET /tasks", () => {
  it("lists what was created and filters by status", async () => {
    await api("POST", "/tasks", { title: "one" });
    await api("POST", "/tasks", { title: "two", status: "done" });

    const all = await api("GET", "/tasks");
    expect(all.status).toBe(200);
    expect(all.body.count).toBe(2);

    const done = await api("GET", "/tasks?status=done");
    expect(done.body.count).toBe(1);
    expect(done.body.tasks[0].title).toBe("two");
  });

  it("rejects an unknown status filter", async () => {
    const response = await api("GET", "/tasks?status=archived");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
    expect(response.body.error.fields[0].field).toBe("status");
  });
});

describe("error handling", () => {
  it("returns a field list when the body fails validation", async () => {
    const response = await api("POST", "/tasks", { title: "", priority: "urgent" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
    expect(response.body.error.fields.map((field: { field: string }) => field.field)).toEqual([
      "title",
      "priority",
    ]);
  });

  it("returns 400 for a body that is not JSON", async () => {
    const response = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });

    const payload = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("bad_request");
  });

  it("returns 400 when POST /tasks has no body at all", async () => {
    const response = await api("POST", "/tasks");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
  });

  it("returns 404 for an unknown route", async () => {
    const response = await api("GET", "/nope");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("route_not_found");
  });

  it("returns 405 when the path exists but the method does not", async () => {
    const response = await api("DELETE", "/tasks");

    expect(response.status).toBe(405);
    expect(response.body.error.code).toBe("method_not_allowed");
  });

  it("returns 404 when patching a task that does not exist", async () => {
    const response = await api("PATCH", "/tasks/00000000-0000-0000-0000-000000000000", {
      status: "done",
    });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("not_found");
  });
});
