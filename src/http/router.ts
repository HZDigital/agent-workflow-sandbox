import type { IncomingMessage, ServerResponse } from "node:http";

import { BadRequestError, HttpError, MethodNotAllowedError } from "./errors.js";
import { sendError } from "./json.js";

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  /** Path parameters captured from the route pattern, e.g. `:id` → `params.id`. */
  params: Record<string, string>;
  query: URLSearchParams;
}

export type RouteHandler = (ctx: RequestContext) => void | Promise<void>;

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

/**
 * `decodeURIComponent` throws on a broken percent-escape such as `/tasks/%zz`.
 * That is a client mistake, not a server fault, so it becomes a 400.
 */
function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new BadRequestError("A path segment is not valid percent-encoding.");
  }
}

function matchSegments(
  pattern: string[],
  actual: string[],
): Record<string, string> | undefined {
  if (pattern.length !== actual.length) return undefined;

  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i += 1) {
    const expected = pattern[i] as string;
    const received = actual[i] as string;

    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeSegment(received);
      continue;
    }
    if (expected !== received) return undefined;
  }
  return params;
}

/**
 * A router small enough to read in one sitting: exact segments plus `:name`
 * placeholders, no wildcards, no middleware stack.
 */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: splitPath(pattern),
      handler,
    });
    return this;
  }

  get(pattern: string, handler: RouteHandler): this {
    return this.add("GET", pattern, handler);
  }

  post(pattern: string, handler: RouteHandler): this {
    return this.add("POST", pattern, handler);
  }

  patch(pattern: string, handler: RouteHandler): this {
    return this.add("PATCH", pattern, handler);
  }

  delete(pattern: string, handler: RouteHandler): this {
    return this.add("DELETE", pattern, handler);
  }

  /**
   * Never rejects: everything a route can throw — including a malformed
   * request target, which is parsed here rather than by the caller — is turned
   * into a response. A rejection here would reach Node's unhandled-rejection
   * handler and kill the process.
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      let url: URL;
      try {
        url = new URL(req.url ?? "/", "http://localhost");
      } catch {
        throw new BadRequestError("Request URL is malformed.");
      }

      const actual = splitPath(url.pathname);
      const method = (req.method ?? "GET").toUpperCase();
      // RFC 9110: HEAD must be served wherever GET is. Node drops the body for us.
      const lookup = method === "HEAD" ? "GET" : method;

      let pathMatched = false;

      for (const route of this.routes) {
        const params = matchSegments(route.segments, actual);
        if (!params) continue;
        pathMatched = true;
        if (route.method !== lookup) continue;

        await route.handler({ req, res, params, query: url.searchParams });
        return;
      }

      throw pathMatched
        ? new MethodNotAllowedError(method, url.pathname)
        : new HttpError(404, "route_not_found", `No route for ${method} ${url.pathname}.`);
    } catch (error) {
      sendError(res, error);
    }
  }
}
