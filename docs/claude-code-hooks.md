# Automatic paging with Claude Code hooks

The `quave-pager` skill lets an agent page you on request. But a skill is **discretionary** —
the model has to *decide* to call it — so it will not reliably page you on its own when a
task finishes or when it gets blocked.

For reliable, automatic paging, wire Quave Pager into Claude Code **hooks**. A hook is a
**deterministic** trigger that Claude Code runs automatically on a lifecycle event, with no
model judgment involved. This is the same pattern other agents use (e.g. the Codex `notify`
program) to call you every time.

Two events cover the cases you usually want:

- **`Notification`** — fires when Claude Code needs your input (a permission prompt, or it is
  waiting on you). Page with `critical` severity.
- **`Stop`** — fires when Claude Code finishes responding (work done in the thread). Page with
  `warning` severity.

## 1. Set your API key

Expose your key as an environment variable. Never hardcode it into a committed file.

```bash
export QUAVE_PAGER_API_KEY="<key from the Quave Pager Android or macOS app>"
```

- **Local** (terminal / macOS app / IDE): put the `export` in `~/.zshrc` or `~/.bashrc`.
- **Claude Code on the web**: set `QUAVE_PAGER_API_KEY` in your environment's
  variables/secrets in the web UI.

The hook commands below safely **no-op** when the key is unset, so they never break a session.

## 2. Add the hooks to `settings.json`

Choose the file for your context:

| Context | File | Notes |
| --- | --- | --- |
| Local (terminal / macOS app / IDE) | `~/.claude/settings.json` | Global across all projects. |
| Claude Code on the web | the working repo's `.claude/settings.json` (committed), or have your environment's setup script write `~/.claude/settings.json` at session start | The web container is ephemeral, so config must come from the repo or environment, not a one-off session. |

Merge this `hooks` block into the file (keep any existing hooks):

```json
{
  "hooks": {
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "timeout": 20,
            "command": "input=$(cat); [ -n \"$QUAVE_PAGER_API_KEY\" ] || exit 0; sid=$(printf '%s' \"$input\" | jq -r '.session_id // empty'); dir=$(printf '%s' \"$input\" | jq -r '.cwd // empty'); msg=$(printf '%s' \"$input\" | jq -r '.message // \"Claude Code needs your input.\"'); jq -n --arg sid \"$sid\" --arg dir \"$dir\" --arg msg \"$msg\" '{title:\"Quave Pager\",body:$msg,severity:\"critical\",aiConversationResume:{provider:\"claude-code\",conversationId:$sid,targets:[{platforms:[\"macos\"],kind:\"copyCommand\",command:(\"claude --resume \"+$sid),cwd:$dir,label:\"Resume Claude Code\"}],fallbackInstructions:\"Open Claude Code and answer the prompt.\"}}' | curl -fsS -m 15 -X POST https://pager.quave.ai/api/alarms -H \"Authorization: Bearer $QUAVE_PAGER_API_KEY\" -H \"Content-Type: application/json\" -d @- >/dev/null 2>&1 || true"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "timeout": 20,
            "command": "input=$(cat); [ -n \"$QUAVE_PAGER_API_KEY\" ] || exit 0; sid=$(printf '%s' \"$input\" | jq -r '.session_id // empty'); dir=$(printf '%s' \"$input\" | jq -r '.cwd // empty'); jq -n --arg sid \"$sid\" --arg dir \"$dir\" '{title:\"Quave Pager\",body:(\"Claude Code finished — \"+$dir),severity:\"warning\",aiConversationResume:{provider:\"claude-code\",conversationId:$sid,targets:[{platforms:[\"macos\"],kind:\"copyCommand\",command:(\"claude --resume \"+$sid),cwd:$dir,label:\"Resume Claude Code\"}],fallbackInstructions:\"Resume the Claude Code session.\"}}' | curl -fsS -m 15 -X POST https://pager.quave.ai/api/alarms -H \"Authorization: Bearer $QUAVE_PAGER_API_KEY\" -H \"Content-Type: application/json\" -d @- >/dev/null 2>&1 || true"
          }
        ]
      }
    ]
  }
}
```

Each hook reads the event JSON from stdin, extracts `session_id` and `cwd` (and `message`
for `Notification`), and POSTs an alarm to `https://pager.quave.ai/api/alarms`. The
`aiConversationResume` block gives the phone/Mac a **Resume Claude Code** button that runs
`claude --resume <session-id>` in the original working directory.

Requires `jq` and `curl` on PATH (both are standard in Claude Code environments).

## 3. Reload and verify

1. Open `/hooks` in Claude Code once (or restart) so it loads the new config. You can review
   or disable the hooks from `/hooks` anytime.
2. Dry-run (does not contact the API):

   ```bash
   QUAVE_PAGER_API_KEY="dummy" npx -y github:quavedev/pager-agent trigger \
     --message "Claude Code hook test" --claude-session "test-123" --ai-cwd "$PWD" --dry-run
   ```

3. Real page:

   ```bash
   npx -y github:quavedev/pager-agent trigger \
     --message "Claude Code hook test" --claude-session "test-123" --ai-cwd "$PWD"
   ```

## Tuning

- **`Stop` fires on every turn.** On the web (one async task per session) that is exactly
  what you want, so keep it. Locally/interactively it pages on every reply — for local use,
  drop the `Stop` hook and keep only `Notification`, or lower the `Stop` `severity` to
  `"info"`.
- **`Notification`** is the "I need you" page — keep it enabled everywhere.
- **Never commit** `QUAVE_PAGER_API_KEY` into a repo, settings under version control, command
  arguments, or logs.

## Other agents

The same principle applies to any agent that exposes a deterministic notification hook —
configure that hook to call the Quave Pager CLI or API instead of relying on the skill. For
example, Codex runs a `notify` program (configured in `~/.codex/config.toml`) on events such
as turn completion; point it at `npx -y github:quavedev/pager-agent trigger` with a
`--codex-thread-id` resume target.
