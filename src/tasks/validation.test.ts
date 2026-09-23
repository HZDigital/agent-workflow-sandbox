import { describe, expect, it } from "vitest";

import { ValidationError } from "../http/errors.js";
import {
  MAX_LIST_LIMIT,
  TITLE_MAX_LENGTH,
  isCalendarDate,
  parseCreateTask,
  parseListQuery,
  parseUpdateTask,
} from "./validation.js";

function fieldsOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) {
      return (error.fields ?? []).map((entry) => entry.field);
    }
    throw error;
  }
  throw new Error("Expected a ValidationError, but nothing was thrown.");
}

describe("isCalendarDate", () => {
  it("accepts a real date", () => {
    expect(isCalendarDate("2026-09-23")).toBe(true);
  });

  it("rejects a day that does not exist in that month", () => {
    expect(isCalendarDate("2026-02-31")).toBe(false);
  });

  it("rejects anything that is not YYYY-MM-DD", () => {
    for (const value of ["23-09-2026", "2026-9-23", "2026-09-23T00:00:00Z", "tomorrow", ""]) {
      expect(isCalendarDate(value)).toBe(false);
    }
  });
});

describe("parseCreateTask", () => {
  it("fills in the defaults when only a title is given", () => {
    expect(parseCreateTask({ title: "Write the runbook" })).toEqual({
      title: "Write the runbook",
      status: "todo",
      priority: "normal",
      tags: [],
      dueDate: null,
    });
  });

  it("trims the title", () => {
    expect(parseCreateTask({ title: "  padded  " }).title).toBe("padded");
  });

  it("normalises tags to lower case and drops duplicates", () => {
    expect(parseCreateTask({ title: "t", tags: ["API", " api ", "Docs"] }).tags).toEqual([
      "api",
      "docs",
    ]);
  });

  it("keeps every accepted field", () => {
    expect(
      parseCreateTask({
        title: "Ship the gate",
        status: "in_progress",
        priority: "high",
        tags: ["ci"],
        dueDate: "2026-12-01",
      }),
    ).toEqual({
      title: "Ship the gate",
      status: "in_progress",
      priority: "high",
      tags: ["ci"],
      dueDate: "2026-12-01",
    });
  });

  it("rejects a body that is not an object", () => {
    for (const body of [null, undefined, "title", 42, ["title"]]) {
      expect(fieldsOf(() => parseCreateTask(body))).toEqual(["body"]);
    }
  });

  it("requires a title", () => {
    expect(fieldsOf(() => parseCreateTask({}))).toEqual(["title"]);
    expect(fieldsOf(() => parseCreateTask({ title: "   " }))).toEqual(["title"]);
    expect(fieldsOf(() => parseCreateTask({ title: 7 }))).toEqual(["title"]);
  });

  it("caps the title length", () => {
    const title = "x".repeat(TITLE_MAX_LENGTH + 1);
    expect(fieldsOf(() => parseCreateTask({ title }))).toEqual(["title"]);
    expect(parseCreateTask({ title: "x".repeat(TITLE_MAX_LENGTH) }).title).toHaveLength(
      TITLE_MAX_LENGTH,
    );
  });

  it("rejects unknown enum values", () => {
    expect(fieldsOf(() => parseCreateTask({ title: "t", status: "archived" }))).toEqual(["status"]);
    expect(fieldsOf(() => parseCreateTask({ title: "t", priority: "urgent" }))).toEqual([
      "priority",
    ]);
  });

  it("rejects an impossible due date", () => {
    expect(fieldsOf(() => parseCreateTask({ title: "t", dueDate: "2026-02-31" }))).toEqual([
      "dueDate",
    ]);
  });

  it("allows an explicitly absent due date", () => {
    expect(parseCreateTask({ title: "t", dueDate: null }).dueDate).toBeNull();
  });

  it("rejects more than ten tags", () => {
    const tags = Array.from({ length: 11 }, (_, index) => `tag-${index}`);
    expect(fieldsOf(() => parseCreateTask({ title: "t", tags }))).toEqual(["tags"]);
  });

  it("reports every broken field at once", () => {
    expect(
      fieldsOf(() => parseCreateTask({ title: "", status: "nope", priority: "nope" })),
    ).toEqual(["title", "status", "priority"]);
  });
});

describe("parseUpdateTask", () => {
  it("returns only the fields that were sent", () => {
    expect(parseUpdateTask({ status: "done" })).toEqual({ status: "done" });
  });

  it("treats an explicit null due date as clearing it", () => {
    expect(parseUpdateTask({ dueDate: null })).toEqual({ dueDate: null });
  });

  it("refuses an empty patch", () => {
    expect(fieldsOf(() => parseUpdateTask({}))).toEqual(["body"]);
  });

  it("refuses a patch that only carries unknown keys", () => {
    expect(fieldsOf(() => parseUpdateTask({ assignee: "nobody" }))).toEqual(["body"]);
  });

  it("applies the same field rules as create", () => {
    expect(fieldsOf(() => parseUpdateTask({ title: "  " }))).toEqual(["title"]);
    expect(fieldsOf(() => parseUpdateTask({ status: "archived" }))).toEqual(["status"]);
  });
});

describe("parseListQuery", () => {
  it("defaults to no filters and a bounded limit", () => {
    expect(parseListQuery(new URLSearchParams())).toEqual({
      status: undefined,
      priority: undefined,
      limit: 50,
    });
  });

  it("reads the filters it knows and ignores the rest", () => {
    const query = new URLSearchParams({ status: "done", priority: "high", sort: "title" });
    expect(parseListQuery(query)).toEqual({ status: "done", priority: "high", limit: 50 });
  });

  it("rejects a limit outside the allowed range", () => {
    for (const limit of ["0", "-1", "1.5", "abc", String(MAX_LIST_LIMIT + 1)]) {
      expect(fieldsOf(() => parseListQuery(new URLSearchParams({ limit })))).toEqual(["limit"]);
    }
  });

  it("accepts a limit at the boundary", () => {
    expect(parseListQuery(new URLSearchParams({ limit: String(MAX_LIST_LIMIT) })).limit).toBe(
      MAX_LIST_LIMIT,
    );
  });
});
