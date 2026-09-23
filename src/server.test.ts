import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MAX_BODY_BYTES } from "./http/json.js";
import { createApp } from "./server.js";
import type { TaskStore } from "./tasks/store.js";

let baseUrl: string;
let port: number;
let store: TaskStore;
let close: () => Promise<void>;

beforeAll(async () => {
  const app = createApp();
  store = app.store;

  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address() as AddressInfo;
  port = address.port;
  baseUrl = `http://127.0.0.1:${port}`;

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

/**
 * `fetch` refuses to send some malformed request targets (a lone `%` becomes
 * `%25`), so the nastiest paths have to be written onto the socket by hand.
 */
const CRLF = "\r\n";

function rawRequest(requestLine: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write([requestLine, "Host: localhost", "Connection: close", "", ""].join(CRLF));
    });

    let data = "";
    socket.setTimeout(5_000, () => {
      socket.destroy();
      reject(new Error("raw request timed out — the server probably died"));
    });
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
    });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });
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

  it("rejects a body larger than the limit", async () => {
    const response = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(MAX_BODY_BYTES) }),
    });

    expect(response.status).toBe(400);
  });

  it("answers 400 for a malformed percent-escape and stays alive", async () => {
    // `decodeURIComponent("%zz")` throws. Before this was handled, the throw
    // escaped `handle`, became an unhandled rejection and killed the process —
    // the second half of this test is the part that matters.
    const response = await fetch(`${baseUrl}/tasks/%zz`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "bad_request",
    );

    expect((await api("GET", "/health")).status).toBe(200);
  });

  it("answers 400 for a lone percent sign on a raw socket and stays alive", async () => {
    // The proof-of-concept that killed the process: `decodeURIComponent("%")`
    // throws, and the throw used to escape the router entirely.
    const response = await rawRequest("GET /tasks/% HTTP/1.1");

    expect(response.split(CRLF)[0]).toBe("HTTP/1.1 400 Bad Request");
    expect((await api("GET", "/health")).status).toBe(200);
  });

  it("serves HEAD wherever it serves GET", async () => {
    const response = await fetch(`${baseUrl}/health`, { method: "HEAD" });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
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
