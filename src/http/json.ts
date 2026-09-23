import type { IncomingMessage, ServerResponse } from "node:http";

import { BadRequestError, HttpError } from "./errors.js";

/** Bodies larger than this are rejected before they are buffered any further. */
export const MAX_BODY_BYTES = 64 * 1024;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status);
  res.end();
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (!(error instanceof HttpError)) {
    // The response says nothing useful on purpose; the stack has to go somewhere.
    console.error("[unhandled]", error);
  }

  const http =
    error instanceof HttpError
      ? error
      : new HttpError(500, "internal_error", "Something went wrong.");

  // A handler that already started writing cannot be given an error body.
  if (res.headersSent) {
    res.destroy();
    return;
  }

  sendJson(res, http.status, {
    error: {
      code: http.code,
      message: http.message,
      ...(http.fields ? { fields: http.fields } : {}),
    },
  });
}

/**
 * Reads and parses a JSON request body.
 *
 * An absent body is `undefined` rather than an error — the validators decide
 * whether a given route needs one, so the rule lives in one place.
 */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw new BadRequestError(`Request body exceeds ${MAX_BODY_BYTES} bytes.`);
    }
    chunks.push(buf);
  }

  if (size === 0) return undefined;

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw === "") return undefined;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new BadRequestError("Request body is not valid JSON.");
  }
}
