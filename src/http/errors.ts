/**
 * The error vocabulary the API speaks. Every handler throws one of these and the
 * router turns it into a JSON response, so no handler writes an error body itself.
 */

export interface FieldError {
  /** Dotted path of the offending field, e.g. `title` or `dueDate`. */
  field: string;
  /** Human-readable reason, phrased so it can be shown to an API client. */
  message: string;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldError[] | undefined;

  constructor(status: number, code: string, message: string, fields?: FieldError[]) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export class ValidationError extends HttpError {
  constructor(fields: FieldError[]) {
    super(400, "validation_error", "The request body failed validation.", fields);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends HttpError {
  constructor(resource: string, id: string) {
    super(404, "not_found", `No ${resource} with id ${id}.`);
    this.name = "NotFoundError";
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, "bad_request", message);
    this.name = "BadRequestError";
  }
}

export class MethodNotAllowedError extends HttpError {
  constructor(method: string, path: string) {
    super(405, "method_not_allowed", `${method} is not allowed on ${path}.`);
    this.name = "MethodNotAllowedError";
  }
}
