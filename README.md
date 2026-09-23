# agent-workflow-sandbox

**This repository is an agent sandbox. Everything in it is disposable.**

It exists so that the Agent-workflow pipeline — Linear ticket →
AI enrichment → coding agent → pull request → cross-AI review → deterministic gate →
human merge click — has somewhere realistic to do its work. The app below is a
plausible codebase, not a product. Nobody depends on it, nothing is deployed from
it, and any part of it may be rewritten, broken or deleted by an automated agent at
any time.

Two rules follow from that:

- **No client material, ever.** No customer data, no customer names, no code copied
  out of a client project, no secrets. The repository is **public**, which is
  deliberate: the GitHub free plan refuses branch rulesets on private repositories,
  and without a ruleset the "a human clicks merge" gate would be a convention rather
  than something GitHub enforces.
- **Treat a green `main` as a courtesy, not a promise.** If you want something here
  to keep working, it needs a test — that is the only thing the pipeline is
  required to respect.

## The app

A small task-tracker HTTP API on Node's built-in `http` module. No framework, no
database, no runtime dependencies — the whole point is that a change is easy to
read in a diff.

| Method | Path | Does |
|---|---|---|
| `GET` | `/health` | Liveness, uptime and the current task count |
| `GET` | `/tasks` | List tasks. Optional `?status=`, `?priority=`, `?limit=` |
| `POST` | `/tasks` | Create a task |
| `GET` | `/tasks/:id` | Read one task |
| `PATCH` | `/tasks/:id` | Partially update a task |
| `DELETE` | `/tasks/:id` | Delete a task |

Tasks live in memory and are gone when the process stops.

```
src/
  index.ts              entrypoint — reads PORT, listens, shuts down on a signal
  server.ts             builds the router and the store; binds nothing itself
  http/
    errors.ts           the error vocabulary (ValidationError, NotFoundError, …)
    json.ts             body reading, JSON responses, the error-to-response mapping
    router.ts           method + `/path/:param` matching, ~100 lines
  tasks/
    types.ts            Task, the status and priority enums, the input shapes
    validation.ts       every input rule, reporting all broken fields at once
    store.ts            in-memory repository
    routes.ts           wires store + validation onto the router
```

Requests are validated in exactly one place (`tasks/validation.ts`) and return the
complete list of problems rather than the first one:

```console
$ curl -s -X POST localhost:3000/tasks -H 'content-type: application/json' \
       -d '{"title":"","dueDate":"2026-02-31"}'
{"error":{"code":"validation_error","message":"The request body failed validation.",
 "fields":[{"field":"title","message":"title must not be empty."},
           {"field":"dueDate","message":"dueDate must be an ISO calendar date (YYYY-MM-DD) or null."}]}}
```

## Running it

Node 20.11 or newer (CI runs 22).

```bash
npm install
npm test          # the whole suite, ~2 seconds
npm run typecheck # tsc, no emit
npm run build     # tsc → dist/
npm start         # http://localhost:3000, override with PORT
```

Tests sit next to the code they cover (`src/**/*.test.ts`) and run on
[Vitest](https://vitest.dev). The HTTP tests bind a real server to port 0 and talk
to it over `fetch`, so the routing, body parsing and error mapping are exercised for
real rather than mocked.

## CI

`.github/workflows/test.yml` runs install → typecheck → test → build on every pull
request and on every push to `main`. The job is called **`test`**, and that name is
load-bearing: it is the check name the branch ruleset on `main` is configured
against, and the one signal in the pipeline that the automation cannot produce for
itself.

Keep the check honest: do not make it conditional, do not add `continue-on-error`,
and do not let it pass on a test run that collected nothing.

Two things that are true today and worth stating rather than assuming:

- **The ruleset is not in place yet.** Until it is, `test` is a signal, not a gate.
  The `rulesets` API answers `200` on this repo — which is the whole reason it is
  public, since the org's GitHub free plan refuses rulesets on private repos.
- **A required check pins a *name*, not its contents.** A pull request can edit
  `.github/workflows/test.yml` in the same diff the check is gating, and GitHub will
  happily report the weakened job as green under the required name. Closing that
  needs a `CODEOWNERS` entry on `.github/**` plus "require review from Code Owners",
  so a change to the gate needs a human the automation cannot impersonate.

The actions are pinned to commit SHAs rather than to `@v7`, because a mutable major
tag can be repointed upstream at code that then runs on every pull request here.
The version is in the trailing comment; bump both together.
