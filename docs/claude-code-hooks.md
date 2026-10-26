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
  waiting on you). Page with the `critical` Alarm Type.
- **`Stop`** — fires when Claude Code finishes responding (work done in the thread). Page with
  `regular` Alarm Type.

## 1. Set your API key

Expose your key as an environment variable. Never hardcode it into a committed file.

```bash
export QUAVE_PAGER_API_KEY="<key from the Quave Pager Android or macOS app>"
```

- **Local** (terminal / macOS app / IDE): put the `export` in `~/.zshrc` or `~/.bashrc`.
- **Claude Code on the web**: set `QUAVE_PAGER_API_KEY` in your environment's
  variables/secrets in the web UI.
- **Windows + Android**: follow [Windows + Android + Claude Code](windows-claude-code.md)
  for a PowerShell sender, forward-slash hook paths, and local diagnostics.

The hook commands below safely **no-op** when the key is unset, so they never break a session.
They also need a safe local log before making that decision; silent failures are
not a usable setup experience.

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
            "command": "log=$HOME/.claude/quave-pager.log; mkdir -p ${log%/*}; printf '%s hook started\\n' $(date -u +%Y-%m-%dT%H:%M:%SZ) >>$log; input=$(cat); [ -n \"$QUAVE_PAGER_API_KEY\" ] || { printf '%s skipped: QUAVE_PAGER_API_KEY is unset\\n' $(date -u +%Y-%m-%dT%H:%M:%SZ) >>$log; exit 0; }; sid=$(printf '%s' \"$input\" | jq -r '.session_id // empty'); dir=$(printf '%s' \"$input\" | jq -r '.cwd // empty'); msg=$(printf '%s' \"$input\" | jq -r '.message // \"Claude Code needs your input.\"'); jq -n --arg sid \"$sid\" --arg dir \"$dir\" --arg msg \"$msg\" '{title:\"Quave Pager\",body:$msg,alarmType:\"critical\",aiConversationResume:{provider:\"claude-code\",conversationId:$sid,targets:[{platforms:[\"macos\"],kind:\"copyCommand\",command:(\"claude --resume \"+$sid),cwd:$dir,label:\"Resume Claude Code\"},{platforms:[\"android\",\"ios\",\"web\"],kind:\"instructions\",instructions:(\"On the computer running Claude Code, run: cd \"+$dir+\" && claude --resume \"+$sid),label:\"Resume Claude Code on your computer\"}],fallbackInstructions:\"Open Claude Code and answer the prompt.\"}}' | curl -fsS -m 15 -X POST https://pager.quave.ai/api/alarms -H \"Authorization: Bearer $QUAVE_PAGER_API_KEY\" -H \"Content-Type: application/json\" -d @- >>$log 2>&1 || true"
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
            "command": "log=$HOME/.claude/quave-pager.log; mkdir -p ${log%/*}; printf '%s hook started\\n' $(date -u +%Y-%m-%dT%H:%M:%SZ) >>$log; input=$(cat); [ -n \"$QUAVE_PAGER_API_KEY\" ] || { printf '%s skipped: QUAVE_PAGER_API_KEY is unset\\n' $(date -u +%Y-%m-%dT%H:%M:%SZ) >>$log; exit 0; }; sid=$(printf '%s' \"$input\" | jq -r '.session_id // empty'); dir=$(printf '%s' \"$input\" | jq -r '.cwd // empty'); jq -n --arg sid \"$sid\" --arg dir \"$dir\" '{title:\"Quave Pager\",body:(\"Claude Code finished — \"+$dir),alarmType:\"regular\",aiConversationResume:{provider:\"claude-code\",conversationId:$sid,targets:[{platforms:[\"macos\"],kind:\"copyCommand\",command:(\"claude --resume \"+$sid),cwd:$dir,label:\"Resume Claude Code\"},{platforms:[\"android\",\"ios\",\"web\"],kind:\"instructions\",instructions:(\"On the computer running Claude Code, run: cd \"+$dir+\" && claude --resume \"+$sid),label:\"Resume Claude Code on your computer\"}],fallbackInstructions:\"Resume the Claude Code session.\"}}' | curl -fsS -m 15 -X POST https://pager.quave.ai/api/alarms -H \"Authorization: Bearer $QUAVE_PAGER_API_KEY\" -H \"Content-Type: application/json\" -d @- >>$log 2>&1 || true"
          }
        ]
      }
    ]
  }
}
```

Each hook reads the event JSON from stdin, extracts `session_id` and `cwd` (and `message`
for `Notification`), and POSTs an alarm to `https://pager.quave.ai/api/alarms`. The
`aiConversationResume` gives macOS a copyable **Resume Claude Code** command and Android/iOS/web
an instruction that names the original working directory and resume command. This avoids sending
Android-only users a macOS-only action.

Claude Code does not have a verified stable conversation deeplink in this package today, so
the hook uses a copyable resume command instead of a custom URL scheme.

Requires `jq` and `curl` on PATH (both are standard in Claude Code environments).

## 3. Reload and verify

1. Open `/hooks` in Claude Code once (or restart) so it loads the new config. You can review
   or disable the hooks from `/hooks` anytime.
2. Dry-run (does not contact the API):

   ```bash
   QUAVE_PAGER_API_KEY="dummy" npx -y github:quavedev/pager-agent trigger \
     --alarm-type regular --message "Claude Code hook test" --claude-session "test-123" --ai-cwd "$PWD" --dry-run
   ```

3. Real page:

   ```bash
   npx -y github:quavedev/pager-agent trigger \
     --alarm-type regular --message "Claude Code hook test" --claude-session "test-123" --ai-cwd "$PWD"
   ```

## Tuning

- **`Stop` fires on every turn.** On the web (one async task per session) that is exactly
  what you want, so keep it. Locally/interactively it pages on every reply — for local use,
  drop the `Stop` hook and keep only `Notification`, or change the `Stop` Alarm Type to
  `info`.
- **`Notification`** is the "I need you" page — keep it enabled everywhere.
- **Never commit** `QUAVE_PAGER_API_KEY` into a repo, settings under version control, command
  arguments, or logs.

## Claude Code inside T3 Code

When Claude Code runs inside [T3 Code](https://t3.codes), use the packaged Node hook
[`scripts/claude-code-hook.cjs`](../scripts/claude-code-hook.cjs) instead of the inline
commands above. On every `Notification` and `Stop` it:

- finds the T3 thread that hosts the Claude session (read-only lookup in
  `~/.t3/userdata/statev2.sqlite`, or `$T3CODE_HOME/userdata`; needs Node 22.5+ for `node:sqlite`);
- titles the alarm `Needs you: <thread title>` (`critical`) or `Done: <thread title>` (`regular`),
  and words the body for the event ("Claude asked you a question." for `AskUserQuestion`);
- sends **Resume AI conversation** targets: `t3code://threads/<environment-id>/<thread-id>` for
  macOS and Android (Quave Pager 0.1.96+ with the T3 Code Android app), and
  `https://app.t3.codes/<environment-id>/<thread-id>` for iOS/web;
- points delegated child threads at their root thread, and skips `Stop` pages from child threads;
- falls back to the plain Claude Code page (copyable `claude --resume`) when the session is not in T3.

On Android, T3 may open on Home instead of the thread when it was not already running.
Open T3 once and tap **Resume AI conversation** again.

Install:

```bash
mkdir -p ~/.claude/hooks
curl -fsSL https://raw.githubusercontent.com/quavedev/pager-agent/main/scripts/claude-code-hook.cjs \
  -o ~/.claude/hooks/quave-pager-hook.cjs
```

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "permission_prompt|idle_prompt|elicitation_dialog",
        "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/hooks/quave-pager-hook.cjs\"", "timeout": 15 }]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/hooks/quave-pager-hook.cjs\"", "timeout": 15 }]
      }
    ]
  }
}
```

The hook reads
`QUAVE_PAGER_API_KEY` from the environment, then from an interactive `zsh`, and no-ops without it.
Preview the payload without sending:

```bash
echo '{"hook_event_name":"Stop","session_id":"'"$CLAUDE_CODE_SESSION_ID"'","cwd":"'"$PWD"'"}' \
  | node ~/.claude/hooks/quave-pager-hook.cjs --dry-run
```

Set `QUAVE_PAGER_HOOK_DEBUG=1` to print the API status code.

For manual pages from an agent inside T3, use
`--t3-session "${CLAUDE_CODE_SESSION_ID:-$CODEX_THREAD_ID}"` with the CLI.

## Other agents

The same principle applies to any agent that exposes a deterministic notification hook —
configure that hook to call the Quave Pager CLI or API instead of relying on the skill. Use the `critical` Alarm Type for input/blocker hooks, `regular` for done/review hooks, and `info` for FYI-only hooks. For
example, Codex runs a `notify` program (configured in `~/.codex/config.toml`) on events such
as turn completion. Codex Desktop exposes `CODEX_THREAD_ID`; for completion notifications, point the hook at
`npx -y github:quavedev/pager-agent trigger --alarm-type regular --message "Codex turn finished." --codex-thread-id "$CODEX_THREAD_ID"` so
Quave Pager receives `codex://threads/<thread-id>` as AI resume metadata. Use `critical` instead only for
hooks that specifically mean input/blocker required now. Do not send `codex://...` through
`--link`; `--link` is for `http(s)` result/action URLs.

Cursor should follow the same copy-command approach as Claude Code until a stable Cursor
conversation deeplink is verified: use `--cursor-session <session-id> --ai-cwd "$PWD"`.
