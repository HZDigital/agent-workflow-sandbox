@AGENTS.md

## Claude-specific

- The `claude-review` workflow loads this file, and through it `AGENTS.md`, into
  the CI reviewer's context. A PR that changes either file therefore skips the
  automated review and needs a human reviewer (see the guard in
  `.github/workflows/claude-review.yml`).
