# Security

> **Draft.** This is the M1 guardrail policy (TRACK-2728). It gets audited and
> hardened in M2; until then, treat anything marked *known limitation* as open.

This repository is public on purpose (see the README). That means two things hold
at all times:

- Anyone on the internet can open an issue, a pull request or a comment here.
- The pipeline holds a credential that can write to this repository.

Everything below exists to keep the second from being steered by the first.

## Gates: which ones actually enforce

| Signal | Set by | Enforcing? |
|---|---|---|
| `test` check | the GitHub Actions app, running `.github/workflows/test.yml` | **Yes.** Required by the ruleset, pinned to the Actions app |
| `agent-workflow/gate` commit status | the pipeline, with its PAT | **No — advisory.** The same credential that opens the PR sets it, so it cannot be a security boundary |
| `claude-review` check + review threads | the GitHub Actions app, running `.github/workflows/claude-review.yml` | **No — advisory.** An input to `agent-workflow/gate`, never required by the ruleset: a reviewer that is wrong, rate-limited or down must not block a merge |
| "A human clicks merge" | convention | **No — policy only.** See *Known limitations* |

The `test` check is the only gate the automation cannot *report* for itself:

1. The ruleset requires `test` **from integration `15368` (GitHub Actions)**. The
   pipeline's PAT has *Commit statuses: write*, so it could post a status literally
   named `test` — but a status from the wrong source does not satisfy the rule
   (verified: a forged `test=success` left the PR blocked).
2. The PAT has **no *Workflows* permission**, so the pipeline cannot push a change
   to `.github/workflows/test.yml`.
3. The ruleset has **no bypass actors**, so no identity — the PAT included — can
   merge past a red `test` (verified with `gh pr merge`, `--admin` and the REST API).

What it does **not** stop: the pipeline can still change *what `test` runs*. The
job runs `npm ci`, `npm test` and `npm run build`, so a PR that edits
`package.json`, `package-lock.json`, a Vitest or TypeScript config, or the tests
themselves can make a genuine, Actions-reported `test` go green on nothing. See
*Known limitations*.

## Ruleset on `main`

Defined as code in [`.github/rulesets/main.json`](../.github/rulesets/main.json).
The ruleset's name carries the "`agent-workflow/gate` is advisory" note, because
rulesets have no description field.

| Rule | Setting |
|---|---|
| Target | the default branch (`~DEFAULT_BRANCH`) |
| Require a pull request | yes, **0 approvals** — PRs are opened under the owner's account, and an author cannot approve their own PR (ADR-0005) |
| Required status check | `test`, from GitHub Actions only; branch need not be up to date |
| Force-push | blocked |
| Deletion | blocked |
| Bypass | **none**, not even admins. The pipeline PAT acts as the owner, who is an admin, so any admin bypass would be the pipeline's bypass too |

Apply or re-apply (needs an admin token — your normal `gh` login, **not** the
pipeline PAT):

```bash
# first time
gh api -X POST repos/HZDigital/agent-workflow-sandbox/rulesets --input .github/rulesets/main.json
# later changes
id=$(gh api repos/HZDigital/agent-workflow-sandbox/rulesets --jq '.[] | select(.name | startswith("main ")) | .id')
gh api -X PUT "repos/HZDigital/agent-workflow-sandbox/rulesets/$id" --input .github/rulesets/main.json
```

The file in the repo is the source of truth; if the live ruleset drifts from it,
the file wins.

**Emergency** (a red `test` must land): switch the ruleset's enforcement to
*Evaluate* in Settings → Rules, merge, and switch it back. That needs
*Administration*, which the PAT does not have, and it leaves an audit-log entry.

Two repository settings (Settings → Actions → General) are part of this policy:
the default workflow `GITHUB_TOKEN` is **read-only**, and GitHub Actions is **not
allowed to approve pull requests** — otherwise a workflow could supply the approval
a future "require 1 approval" rule asks for.

## The pipeline's credential

One **fine-grained** personal access token, created in the GitHub web UI
(Settings → Developer settings → Fine-grained tokens):

| Field | Value |
|---|---|
| Resource owner | `HZDigital` |
| Repository access | **Only select repositories** → `agent-workflow-sandbox` |
| Expiration | 90 days |
| Contents | Read and write |
| Pull requests | Read and write |
| Commit statuses | Read and write |
| Issues | **Read** — Linear is the tracker, and top-level PR comments only need *Pull requests: write*. Raise it only for a named pipeline step that writes issues |
| Metadata | Read (mandatory) |
| Everything else | **No access** — in particular no *Workflows*, no *Administration*, no *Secrets*, and no organization permissions |

The org may require an owner to approve the token before it works; it shows as
*pending* until then.

Name it `agent-workflow-sandbox pipeline` so it is recognisable in the token list
and the audit log.

### Where it lives

`%USERPROFILE%\.agent-workflow\.env` — outside every repository, so no `git add`
and no worktree can pick it up **by accident**. That is all the location protects
against: the file is readable by your account, and the coding agents run as your
account — see the rules below.

```
GITHUB_TOKEN=github_pat_...
```

Lock the folder down to your account (plus `SYSTEM`) and strip inherited access:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.agent-workflow" | Out-Null
icacls "$env:USERPROFILE\.agent-workflow" /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" "SYSTEM:(OI)(CI)F"
icacls "$env:USERPROFILE\.agent-workflow"   # verify: exactly those two entries
```

Rules for the pipeline:

- The token belongs to the **orchestrator only**. Read it **once, at the start of a
  run**, and hold it in memory for that run.
- **Coding agents never get it.** Launch them with a scrubbed environment (no
  `GH_TOKEN`, no `GITHUB_TOKEN`), deny them reads of `~/.agent-workflow/**` and
  `gh auth token`, and route every GitHub write (push, PR, comment, status) through
  orchestrator code the agent cannot call with arbitrary arguments. One prompt
  injection must not be able to print the token into a PR body.
- Never print it, never write it into a repo, a log, a PR body, a comment or an
  agent prompt.
- Pass it to the orchestrator's own child processes through the environment (`GH_TOKEN`), not as an
  argument — command lines are visible to other processes.

### Rotation

Because every run reads the token once at start, swapping the file never breaks a
run that is already going.

1. Create the new token with the same settings (before the old one expires —
   GitHub emails a week ahead).
2. Write it to `%USERPROFILE%\.agent-workflow\.env.new`.
3. Replace atomically: `Move-Item -Force .env.new .env`. New runs pick up the new
   token; runs in flight keep the old one.
4. Wait until every run started before step 3 has finished (or the maximum run
   duration has passed).
5. Revoke the old token in the web UI.

**Suspected leak:** skip step 4. Revoke the old token immediately, accept that
runs in flight fail, then do steps 1–3 and re-run them.

## The reviewer's credential

`claude-review` runs on the repository secret **`CLAUDE_CODE_OAUTH_TOKEN`**, the
owner's Claude subscription token from `claude setup-token`. It is set with
`gh secret set` from the owner's own terminal and never goes through an agent
session. Only the model step of the `claude-review-analyse` job receives it.

- **Rotation:** run `claude setup-token` again, `gh secret set` the new value, then
  revoke the old token in the Claude account settings. Write down the expiry date
  when you create it, because an expired token only shows up as a failed
  `claude-review` job.
- **Suspected leak:** revoke it first, then rotate it. Treat any PR that changed
  `.github/workflows/**` since the last known-good run as the likely source.

## Comment-author policy

On a public repository every comment is untrusted input. The pipeline acts on a PR
comment, a review comment or a review **only** if one of these is true:

- its `author_association` is `OWNER`, `MEMBER` or `COLLABORATOR` **and** the
  author's permission on this repository
  (`GET /repos/{owner}/{repo}/collaborators/{login}/permission` → `role_name`) is
  `admin`, `maintain` or `write`. `MEMBER` alone covers any HZDigital org member
  and `COLLABORATOR` includes read-only collaborators, so the association is
  necessary but not sufficient; or
- its author's login is on the bot allow-list below, **and** the login ends in
  `[bot]` with `user.type == "Bot"`.

| Allow-listed bot | Why | Extra condition |
|---|---|---|
| `github-actions[bot]` | cross-review findings from `claude-review` (TRACK-2731) | see below; without it, ignored like any other bot |

`github-actions[bot]` is **not** one reviewer. It is whatever any workflow in this
repository posts with its `GITHUB_TOKEN`, including a workflow edited on a PR
branch. So the pipeline takes a review thread from it as a **finding**, and as
nothing else, only if all of these hold:

- the thread's first comment carries `<!-- claude-review:v1 -->`, and it belongs
  to a review whose body carries `<!-- claude-review:v1 sha=<commit> -->`;
- a check run named `claude-review`, from GitHub Actions (app `15368`), concluded
  `success` on that commit;
- the thread is still unresolved. A thread resolved by anyone other than
  `github-actions[bot]` counts as **unresolved**: only the reviewer closes its
  own findings, so the pipeline's PAT cannot turn the gate green by resolving
  them. On the next review, the reviewer re-checks such a thread against the
  current code. It closes the thread itself if the problem is fixed, and
  reopens it otherwise, so the UI shows what the gate counts.

A finding is data for the coding agent. Like every allowed comment, it can steer
the code change and nothing else. Every other `github-actions[bot]` comment is
ignored, and review threads from anyone who fails the rules above do not count
towards the gate, so a stranger cannot stall it by opening threads.

Not allow-listed: `chatgpt-codex-connector[bot]` (Codex, not in use: the
connector answers but has no account connected, see TRACK-2731) and
`copilot-pull-request-reviewer[bot]`.

Everything else — `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `NONE`,
and any bot not on the list — is **ignored**: not acted on, not quoted into an
agent prompt, not summarised. Ignoring it silently is correct; replying would give
an attacker a feedback channel.

Details that matter:

- Check **on every event**, including `edited` — and on an edit, check the editor
  (`sender.login`) as well as the original author.
- **The pipeline's own output is not an instruction.** Everything the pipeline
  posts goes out under the owner's PAT, so it comes back as `OWNER`. Every comment,
  review and PR body it writes carries the marker `<!-- agent-workflow:bot -->`,
  and anything carrying the marker is data, never direction — otherwise one
  steered run can plant instructions for the next.
- Even an allowed comment is **data for the agent, not instructions to the
  pipeline**. It can steer what the code change should be; it cannot change what
  the pipeline itself is allowed to do (merge, touch other repos, read secrets).
- Other attacker-controlled text — issue bodies, PR titles and bodies, branch
  names, commit messages, fork PRs — is not covered by this filter. The pipeline
  only reads PRs it opened itself, from branches it pushed; if that ever changes,
  this policy has to grow first.

## Known limitations

- **The pipeline could merge its own PR.** With 0 required approvals,
  *Contents + Pull requests: write* is enough to merge a green PR through the API,
  and the PAT is the owner's own identity, so GitHub cannot tell the pipeline from
  a human click. "The pipeline never merges" is a rule in the pipeline's code, not
  something GitHub enforces. It stays that way until the pipeline gets its own
  bot identity and the ruleset requires an approval.
- **The pipeline can weaken what `test` runs.** No *Workflows* permission stops
  edits to `test.yml`, not to `package.json`, `package-lock.json`,
  `vitest.config.*`, `tsconfig*.json` or `**/*.test.ts` — and a human
  collaborator's PR can edit `test.yml` too. Combined with the self-merge above, a
  steered pipeline can land code with a genuine green `test`. Follow-up:
  `CODEOWNERS` over `.github/**` and those files, plus "require review from Code
  Owners" with 1 approval (only workable once the pipeline has its own identity),
  and a tripwire in `test.yml` that fails if the collected test count drops below
  a floor.
- **The owner's identity is the pipeline's identity.** Everything the pipeline
  does is attributed to the owner — in the audit log and in `author_association`.
  A separate bot identity fixes this and the two limitations above; it is the
  biggest M2 item here.
- **Secrets at rest are a plain file.** The ACL keeps other local accounts out; it
  does not protect against malware running as you. A secrets manager is an M2
  question.
- **Anyone with write access can read the reviewer's Claude token.** On
  `pull_request`, GitHub runs the workflow file from the PR itself. A PR that edits
  `claude-review.yml`, or adds a workflow, gets `CLAUDE_CODE_OAUTH_TOKEN`. That
  token is the owner's personal Claude subscription token. The pipeline PAT cannot
  do this, because it has no *Workflows* permission, but every repo admin can.
  Follow-up: move to an `ANTHROPIC_API_KEY` from a dedicated Console workspace with
  a spend cap, and put `.github/**` under the CODEOWNERS item above.
- **The reviewer can be steered.** It reads a diff that the pipeline wrote, so a
  prompt injection in the code can make it miss a real bug, or report a false one.
  What limits the damage: it has no shell, no network, no GitHub tools and no
  write access; reads of `/proc`, `/etc`, `/tmp` and the runner's home are
  denied; it never sees PR comments; it refuses PRs that change its own instructions
  (`CLAUDE.md`, the `AGENTS.md` that file imports, `.claude/`, `.mcp.json`),
  and loads only the base branch's copies of them whatever the PR does;
  and plain code posts its findings, after scanning them for anything that
  looks like a credential. It stays advisory, and
  a human still reads the diff.
- **The reviewer's post job can push.** GitHub only lets `resolveReviewThread`
  run with `contents: write`, so the `claude-review` job's `GITHUB_TOKEN` could
  push to any branch except `main`, which the ruleset protects. The job has no
  checkout and no model. Its only input is the analyse job's JSON, which it
  treats as data, and all its code is inline in the workflow file, behind the
  *Workflows* permission.
- **The reviewer's CLI is fetched at run time.** The action is pinned to a SHA,
  but it installs Claude Code with `curl https://claude.ai/install.sh | bash`,
  so a compromised install origin would run with the token in its environment.
  This is accepted for M1. The fix is to pre-install a checksummed binary and
  pass `path_to_claude_code_executable`.
- **The reviewer shares the coder's quota and blind spots.** Both run on the
  owner's Claude subscription, so a long implementation run can rate-limit the
  review. That fails the `claude-review` check, and the gate reads a failed check
  as "review pending". A same-vendor model is a second opinion, not a cross-vendor
  check.
- **Never debug `claude-review`.** Debug logging makes the action log every tool
  result, and the logs are public. The job refuses to start when
  `runner.debug == '1'`. Never set `ACTIONS_STEP_DEBUG` in this repository.
