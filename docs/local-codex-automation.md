# GitHub Actions to local Codex automation pilot

Quave Pager can deliver a closed, AI-to-AI automation action to a configured
macOS receiver. A failed GitHub Actions workflow sends a Pager `Automation`
alarm; the Mac maps the named action and profile to a locally owned checkout and
prompt, then starts Codex.

This is not a remote shell or remote-prompt API. GitHub sends only:

- a named action;
- a named profile;
- a repository name;
- the matching `https://github.com/<repository>/actions/runs/<id>` URL.

The API rejects prompt, command, executable, and working-directory fields.
Android filters out automation alarms and never executes them.

## Production allowlist

| Action | Profile | Repository | Purpose |
| --- | --- | --- | --- |
| `codex-investigate-actions-failure` | `quaveone-web-actions-failure` | `quaveone/web` | Diagnose and, when safe, repair any failed monitored workflow |
| `codex-repair-main-to-staging` | `quaveone-main-to-staging` | `quaveone/web`, `quaveone/infra` | Legacy guarded main-to-staging repair |

## Mac setup

1. Install and open the signed Quave Pager macOS app.
2. Install and authenticate the Codex CLI in `/opt/homebrew/bin`,
   `/usr/local/bin`, or `~/.local/bin`.
3. Keep the macOS device manually enabled and keep its `Automation` Alarm Type
   enabled.
4. Create `~/Library/Application Support/QuavePager/local-automation.json`.

The web failure profile below owns both the absolute path and the prompt on the
Mac. The remote alarm can select this exact profile, but cannot replace either
value.

```json
{
  "repositories": {
    "quaveone/web": "/Users/filipe/Documents/quave/ws/quaveone/web",
    "quaveone/infra": "/Users/filipe/Documents/quave/ws/quaveone/infra"
  },
  "profiles": {
    "quaveone-web-actions-failure": {
      "action": "codex-investigate-actions-failure",
      "repository": "quaveone/web",
      "repositoryPath": "/Users/filipe/Documents/quave/ws/quaveone/web",
      "prompt": "Handle the failed GitHub Actions run {{runUrl}} for {{repository}}. Treat {{repositoryPath}} as the canonical checkout and do not overwrite existing changes. Read the repository AGENTS.md before acting. Inspect the exact run, failed jobs, failed logs, event, commit, branch, and associated pull request with gh before concluding. Classify the cause as a repository regression, workflow/configuration defect, transient failure, external dependency, credentials/permissions problem, or deployment/runtime failure. If it is safely actionable in the repository, reuse or create a GitHub issue, work in a disposable worktree from the appropriate remote ref, create a codex/actions-run-<run-id> branch, implement the smallest fix, run focused validation plus the repository-required checks, commit, push, and open a draft PR against the run's target branch. If a writable Filipe/Codex-owned PR already owns the failing commit, a narrow fix may be pushed to that PR branch instead. Never overwrite a dirty checkout, force-push, rebase shared branches, push directly to main/staging/beta, expose or rotate secrets, mutate production data/infrastructure, or bypass a required approval. A safe transient rerun may be attempted once and must be verified. For external, credential, permission, or real-world blockers, preserve exact evidence in the associated issue or PR and use Quave Pager for the one required user action. Do not stop at diagnosis when a safe repository fix is available. Finish with links, checks, live GitHub status, remaining risk, and worktree cleanup."
    }
  }
}
```

The placeholders `{{runUrl}}`, `{{repository}}`, and
`{{repositoryPath}}` are substituted by the macOS app as plain Codex prompt
text. They are not evaluated by a shell. The runner starts:

```text
codex exec --ignore-user-config -c 'approval_policy="never"' -c 'features.shell_snapshot=false' -s danger-full-access -C <repositoryPath> <resolved-prompt>
```

Repository `AGENTS.md` instructions still apply. Global Codex config is ignored
so unrelated hooks and MCP servers cannot hang an unattended run. The app uses
a fixed non-interactive launcher that passes every Codex argument, including the
local prompt, positionally; prompt text is never evaluated as shell syntax. It
supplies only `HOME`, the local user, a fixed executable `PATH`, locale, and
temporary-directory variables. It does not forward API keys or unrelated
service credentials from the app's environment. Shell snapshotting is disabled
so Codex does not start the user's login shell merely to reconstruct that
environment.

## Repository-wide GitHub Actions monitor

Store the user-owned key as the repository secret
`QUAVE_PAGER_API_KEY`. A default-branch `workflow_run` monitor can watch
every current workflow without adding a failure step to every job:

```yaml
name: Pager GitHub Actions failure monitor
on:
  workflow_run:
    workflows:
      - Branch CI
      - Website Deploy ONE
      # Include every other workflow name in this repository.
    types: [completed]

permissions:
  actions: read
  contents: read

jobs:
  notify:
    if: ${{ github.event.workflow_run.conclusion == 'failure' }}
    runs-on: ubuntu-latest
    steps:
      - name: Request local Codex investigation
        env:
          QUAVE_PAGER_API_KEY: ${{ secrets.QUAVE_PAGER_API_KEY }}
          RUN_URL: ${{ github.event.workflow_run.html_url }}
        run: |
          payload=$(jq -n --arg runUrl "$RUN_URL" '{
            title: "GitHub Actions failure needs local Codex",
            body: ("Inspect and handle " + $runUrl),
            alarmType: "automation",
            ttlSeconds: 21600,
            link: $runUrl,
            localAutomation: {
              action: "codex-investigate-actions-failure",
              profile: "quaveone-web-actions-failure",
              repository: "quaveone/web",
              runUrl: $runUrl
            }
          }')
          curl --fail-with-body --silent --show-error \
            -X POST https://pager.quave.ai/api/alarms \
            -H "Authorization: Bearer $QUAVE_PAGER_API_KEY" \
            -H "Content-Type: application/json" \
            --data "$payload"
```

`workflow_run` is centralized and receives repository secrets from the trusted
default-branch workflow. It must not check out or execute code from the failed
run. GitHub requires workflow names to be listed, so add every new workflow name
to the monitor; use a repository test to detect drift.

## Delivery and proof

- Local automation is non-ringing. It bypasses the Mac device's saved human
  delivery-hours schedule so overnight CI can still run, but it respects an
  explicit whole-device pause and the Automation Alarm Type's manual or
  scheduled pause.
- The Mac must be on, online, able to run the app, and listening before the alarm
  TTL expires. Pager is not a durable job queue.
- The local profile, repository path, Codex installation, GitHub authentication,
  and Codex authentication are machine-owned prerequisites.
- The runner does not inherit API keys from a login shell. Commands used by the
  local agent must authenticate through their own machine-owned stores (for
  example, Codex auth and `gh auth`).
- The macOS runner overwrites `~/Library/Logs/QuavePager/local-automation.log`
  for each run with owner-only permissions. Use it to diagnose a non-zero Codex
  exit without creating an unread output pipe or a growing log archive.
- Pager acknowledgment proves receipt and local process completion. It does not
  prove that CI became green; the local prompt requires GitHub status, commit,
  PR, and validation evidence.
- Additional repositories require a new server allowlist entry plus a
  machine-owned local profile. Remote callers still cannot supply prompts or
  commands.
