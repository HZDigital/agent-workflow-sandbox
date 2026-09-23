import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError } from "../http/errors.js";
import { TaskStore } from "./store.js";
import type { CreateTaskInput } from "./types.js";

const DEFAULTS: CreateTaskInput = {
  title: "A task",
  status: "todo",
  priority: "normal",
  tags: [],
  dueDate: null,
};

function input(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return { ...DEFAULTS, ...overrides };
}

describe("TaskStore", () => {
  let store: TaskStore;
  let clock: number;

  beforeEach(() => {
    clock = 0;
    store = new TaskStore(() => {
      clock += 1000;
      return new Date(clock).toISOString();
    });
  });

  it("starts empty", () => {
    expect(store.size).toBe(0);
    expect(store.list({ status: undefined, priority: undefined, limit: 50 })).toEqual([]);
  });

  it("assigns an id and stamps both timestamps on create", () => {
    const task = store.create(input({ title: "First" }));

    expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(task.title).toBe("First");
    expect(task.createdAt).toBe(task.updatedAt);
    expect(store.size).toBe(1);
  });

  it("returns copies, so a caller cannot mutate the stored task", () => {
    const created = store.create(input({ tags: ["api"] }));
    created.title = "mutated";
    created.tags.push("extra");

    const fetched = store.get(created.id);
    expect(fetched.title).toBe("A task");
    expect(fetched.tags).toEqual(["api"]);
  });

  it("lists in insertion order", () => {
    store.create(input({ title: "one" }));
    store.create(input({ title: "two" }));
    store.create(input({ title: "three" }));

    const titles = store
      .list({ status: undefined, priority: undefined, limit: 50 })
      .map((task) => task.title);
    expect(titles).toEqual(["one", "two", "three"]);
  });

  it("filters by status and priority", () => {
    store.create(input({ title: "a", status: "done" }));
    store.create(input({ title: "b", status: "todo", priority: "high" }));
    store.create(input({ title: "c", status: "done", priority: "high" }));

    expect(
      store.list({ status: "done", priority: undefined, limit: 50 }).map((task) => task.title),
    ).toEqual(["a", "c"]);
    expect(
      store.list({ status: "done", priority: "high", limit: 50 }).map((task) => task.title),
    ).toEqual(["c"]);
  });

  it("honours the limit", () => {
    for (let i = 0; i < 5; i += 1) store.create(input({ title: `task-${i}` }));
    expect(store.list({ status: undefined, priority: undefined, limit: 2 })).toHaveLength(2);
  });

  it("applies a partial update and moves updatedAt only", () => {
    const created = store.create(input({ title: "before", tags: ["api"] }));
    const updated = store.update(created.id, { title: "after" });

    expect(updated.title).toBe("after");
    expect(updated.tags).toEqual(["api"]);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
  });

  it("clears the due date when the patch sets it to null", () => {
    const created = store.create(input({ dueDate: "2026-12-01" }));
    expect(store.update(created.id, { dueDate: null }).dueDate).toBeNull();
  });

  it("removes a task", () => {
    const created = store.create(input());
    store.remove(created.id);

    expect(store.size).toBe(0);
    expect(() => store.get(created.id)).toThrow(NotFoundError);
  });

  it("throws NotFoundError for an unknown id", () => {
    expect(() => store.get("missing")).toThrow(NotFoundError);
    expect(() => store.update("missing", { title: "x" })).toThrow(NotFoundError);
    expect(() => store.remove("missing")).toThrow(NotFoundError);
  });
});
