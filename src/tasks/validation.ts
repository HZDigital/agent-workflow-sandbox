import type { FieldError } from "../http/errors.js";
import { ValidationError } from "../http/errors.js";
import type {
  CreateTaskInput,
  ListTasksQuery,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
} from "./types.js";
import { TASK_PRIORITIES, TASK_STATUSES } from "./types.js";

export const TITLE_MAX_LENGTH = 120;
export const TAG_MAX_LENGTH = 24;
export const MAX_TAGS = 10;
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `YYYY-MM-DD` that is also a real calendar date — the shape check alone would
 * happily accept `2026-02-31`.
 */
export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

function checkTitle(value: unknown, errors: FieldError[]): string | undefined {
  if (typeof value !== "string") {
    errors.push({ field: "title", message: "title must be a string." });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    errors.push({ field: "title", message: "title must not be empty." });
    return undefined;
  }
  if (trimmed.length > TITLE_MAX_LENGTH) {
    errors.push({
      field: "title",
      message: `title must be at most ${TITLE_MAX_LENGTH} characters.`,
    });
    return undefined;
  }
  return trimmed;
}

function checkStatus(value: unknown, errors: FieldError[]): TaskStatus | undefined {
  if (typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value)) {
    return value as TaskStatus;
  }
  errors.push({
    field: "status",
    message: `status must be one of: ${TASK_STATUSES.join(", ")}.`,
  });
  return undefined;
}

function checkPriority(value: unknown, errors: FieldError[]): TaskPriority | undefined {
  if (typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value)) {
    return value as TaskPriority;
  }
  errors.push({
    field: "priority",
    message: `priority must be one of: ${TASK_PRIORITIES.join(", ")}.`,
  });
  return undefined;
}

function checkTags(value: unknown, errors: FieldError[]): string[] | undefined {
  if (!Array.isArray(value)) {
    errors.push({ field: "tags", message: "tags must be an array of strings." });
    return undefined;
  }
  if (value.length > MAX_TAGS) {
    errors.push({ field: "tags", message: `tags must hold at most ${MAX_TAGS} entries.` });
    return undefined;
  }

  const errorsBefore = errors.length;
  const normalised: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string") {
      errors.push({ field: `tags[${index}]`, message: "tags must be an array of strings." });
      continue;
    }
    const tag = entry.trim().toLowerCase();
    if (tag.length === 0) {
      errors.push({ field: `tags[${index}]`, message: "a tag must not be empty." });
      continue;
    }
    if (tag.length > TAG_MAX_LENGTH) {
      errors.push({
        field: `tags[${index}]`,
        message: `a tag must be at most ${TAG_MAX_LENGTH} characters.`,
      });
      continue;
    }
    if (!normalised.includes(tag)) normalised.push(tag);
  }

  return errors.length === errorsBefore ? normalised : undefined;
}

function checkDueDate(value: unknown, errors: FieldError[]): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && isCalendarDate(value)) return value;
  errors.push({
    field: "dueDate",
    message: "dueDate must be an ISO calendar date (YYYY-MM-DD) or null.",
  });
  return undefined;
}

/** Parses a `POST /tasks` body, reporting every problem at once rather than the first. */
export function parseCreateTask(input: unknown): CreateTaskInput {
  if (!isRecord(input)) {
    throw new ValidationError([{ field: "body", message: "Request body must be a JSON object." }]);
  }

  const errors: FieldError[] = [];
  const title = checkTitle(input["title"], errors);
  const status = "status" in input ? checkStatus(input["status"], errors) : "todo";
  const priority = "priority" in input ? checkPriority(input["priority"], errors) : "normal";
  const tags = "tags" in input ? checkTags(input["tags"], errors) : [];
  const dueDate = "dueDate" in input ? checkDueDate(input["dueDate"], errors) : null;

  if (errors.length > 0) throw new ValidationError(errors);

  return {
    title: title as string,
    status: status as TaskStatus,
    priority: priority as TaskPriority,
    tags: tags as string[],
    dueDate: dueDate as string | null,
  };
}

/** Parses a `PATCH /tasks/:id` body. At least one known field must be present. */
export function parseUpdateTask(input: unknown): UpdateTaskInput {
  if (!isRecord(input)) {
    throw new ValidationError([{ field: "body", message: "Request body must be a JSON object." }]);
  }

  const errors: FieldError[] = [];
  const patch: UpdateTaskInput = {};

  if ("title" in input) {
    const title = checkTitle(input["title"], errors);
    if (title !== undefined) patch.title = title;
  }
  if ("status" in input) {
    const status = checkStatus(input["status"], errors);
    if (status !== undefined) patch.status = status;
  }
  if ("priority" in input) {
    const priority = checkPriority(input["priority"], errors);
    if (priority !== undefined) patch.priority = priority;
  }
  if ("tags" in input) {
    const tags = checkTags(input["tags"], errors);
    if (tags !== undefined) patch.tags = tags;
  }
  if ("dueDate" in input) {
    const dueDate = checkDueDate(input["dueDate"], errors);
    if (dueDate !== undefined) patch.dueDate = dueDate;
  }

  if (errors.length > 0) throw new ValidationError(errors);
  if (Object.keys(patch).length === 0) {
    throw new ValidationError([
      { field: "body", message: "Provide at least one of: title, status, priority, tags, dueDate." },
    ]);
  }

  return patch;
}

/** Parses the `GET /tasks` query string. Unknown parameters are ignored. */
export function parseListQuery(query: URLSearchParams): ListTasksQuery {
  const errors: FieldError[] = [];

  const rawStatus = query.get("status");
  const status = rawStatus === null ? undefined : checkStatus(rawStatus, errors);

  const rawPriority = query.get("priority");
  const priority = rawPriority === null ? undefined : checkPriority(rawPriority, errors);

  let limit = DEFAULT_LIST_LIMIT;
  const rawLimit = query.get("limit");
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIST_LIMIT) {
      errors.push({
        field: "limit",
        message: `limit must be an integer between 1 and ${MAX_LIST_LIMIT}.`,
      });
    } else {
      limit = parsed;
    }
  }

  if (errors.length > 0) throw new ValidationError(errors);
  return { status, priority, limit };
}
