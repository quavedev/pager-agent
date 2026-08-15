# GitHub Actions to local Codex automation pilot

Quave Pager can deliver one closed, AI-to-AI automation action to a configured
macOS receiver. A failed GitHub Actions job sends a Pager `Automation` alarm;
the Mac maps the fixed action to a locally owned checkout and starts Codex.

This is not a general remote executor. Production currently accepts only:

- action: `codex-repair-main-to-staging`
- profile: `quaveone-main-to-staging`
- repositories: `quaveone/web` or `quaveone/infra`
- run URL: the matching `https://github.com/<repository>/actions/runs/<id>`

The API rejects arbitrary prompts, shell commands, executables, working
directories, and other repositories. Android filters out automation alarms and
never executes them.

## Mac prerequisites

1. Install and open the signed Quave Pager macOS app.
2. Install and authenticate the Codex CLI. `codex exec` must work from a login
   shell.
3. Keep the macOS device and its `Automation` Alarm Type enabled for the current
   delivery schedule.
4. Create `~/Library/Application Support/QuavePager/local-automation.json`:

```json
{
  "repositories": {
    "quaveone/web": "/absolute/path/to/web",
    "quaveone/infra": "/absolute/path/to/infra"
  }
}
```

These are local absolute paths. They are never supplied by the remote alarm.

## GitHub Actions step

Store the user-owned key as the `QUAVE_PAGER_API_KEY` repository secret. Put
this failure-only step after the step that may fail:

```yaml
- name: Request local Codex repair
  if: failure()
  env:
    QUAVE_PAGER_API_KEY: ${{ secrets.QUAVE_PAGER_API_KEY }}
  run: |
    curl -fsS -X POST https://pager.quave.ai/api/alarms \
      -H "Authorization: Bearer $QUAVE_PAGER_API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"title\":\"Main-to-staging repair\",\"body\":\"Inspect the failed GitHub Actions run.\",\"alarmType\":\"automation\",\"ttlSeconds\":900,\"localAutomation\":{\"action\":\"codex-repair-main-to-staging\",\"profile\":\"quaveone-main-to-staging\",\"repository\":\"$GITHUB_REPOSITORY\",\"runUrl\":\"https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID\"}}"
```

## Fixed behavior

The local profile fetches `origin/main` and `origin/staging`. If main is already
contained in staging it exits without changes. Otherwise it uses a disposable
worktree for a normal merge and focused validation. It must never create a
missing staging branch, rebase, force-push, delete, recreate, or rename staging,
or modify production infrastructure.

## Limitations and proof

- The Mac must be on, online, able to run the app, and listening before the
  alarm TTL expires.
- A paused device, paused Automation type, or inactive delivery schedule
  suppresses execution. Send a fresh alarm after resuming; expired alarms are
  not a durable job queue.
- The local repository mapping, Codex installation, authentication, and CLI
  compatibility are machine-owned prerequisites. The runner ignores the user's
  global Codex config so unrelated MCP servers and notification hooks cannot
  hang the unattended process; repository `AGENTS.md` instructions still apply.
- The macOS app reports local success or failure. Pager acknowledgment proves
  receipt/execution, not that a branch changed or GitHub CI became green.
  Re-check refs and Actions after every repair.
- Personal repositories, additional organizations, arbitrary Action failures,
  and other repairs require a new narrowly allowlisted profile contract. The
  current API rejects them.
