import { randomUUID } from "node:crypto";

import { NotFoundError } from "../http/errors.js";
import type { CreateTaskInput, ListTasksQuery, Task, UpdateTaskInput } from "./types.js";

/** Spreading a task would share its `tags` array with the caller. */
function snapshot(task: Task): Task {
  return { ...task, tags: [...task.tags] };
}

/**
 * In-memory task storage. Insertion order is the list order, which keeps the
 * API deterministic without a sort key. Nothing is persisted — restarting the
 * server empties it, which is the point of a sandbox.
 */
export class TaskStore {
  private readonly tasks = new Map<string, Task>();

  private readonly now: () => string;

  constructor(now: () => string = () => new Date().toISOString()) {
    this.now = now;
  }

  get size(): number {
    return this.tasks.size;
  }

  clear(): void {
    this.tasks.clear();
  }

  create(input: CreateTaskInput): Task {
    const timestamp = this.now();
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      status: input.status,
      priority: input.priority,
      tags: [...input.tags],
      dueDate: input.dueDate,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.tasks.set(task.id, task);
    return snapshot(task);
  }

  list(query: ListTasksQuery): Task[] {
    const matches: Task[] = [];
    for (const task of this.tasks.values()) {
      if (query.status !== undefined && task.status !== query.status) continue;
      if (query.priority !== undefined && task.priority !== query.priority) continue;
      matches.push(snapshot(task));
      if (matches.length === query.limit) break;
    }
    return matches;
  }

  /** Returns the task, or throws `NotFoundError` — callers never handle `undefined`. */
  get(id: string): Task {
    const task = this.tasks.get(id);
    if (!task) throw new NotFoundError("task", id);
    return snapshot(task);
  }

  update(id: string, patch: UpdateTaskInput): Task {
    const existing = this.tasks.get(id);
    if (!existing) throw new NotFoundError("task", id);

    const updated: Task = {
      ...existing,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.tags !== undefined ? { tags: [...patch.tags] } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
      updatedAt: this.now(),
    };

    this.tasks.set(id, updated);
    return snapshot(updated);
  }

  remove(id: string): void {
    if (!this.tasks.delete(id)) throw new NotFoundError("task", id);
  }
}
