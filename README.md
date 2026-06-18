# Quave Pager Agent

Install this package so an AI agent can call your attention through Quave Pager.

## Android app

Download the latest public APK:

```text
https://github.com/quavedev/pager-agent/releases/latest/download/QuavePager.apk
```

Install it on Android, open Quave Pager, create or verify your account, and grant the requested alarm permissions:

- notifications
- full-screen alarm alerts
- exact alarms
- Do Not Disturb bypass / notification policy access
- ignore battery optimization / unrestricted battery usage

Copy the generated API key only into `QUAVE_PAGER_API_KEY` for your agent environment or approved secret store.

## macOS app

Recommended terminal install:

```bash
curl -fsSL https://pager.quave.ai/install-macos.sh | bash
```

Manual drag-and-drop install:

```text
https://github.com/quavedev/pager-agent/releases/latest/download/QuavePager-macOS.dmg
```

Open the DMG, drag Quave Pager into Applications, then open it. The terminal installer downloads the latest zip, installs Quave Pager into `~/Applications`, opens it, and prints the next setup steps.

Open Quave Pager on macOS, paste an existing API key, and enable launch-at-login in Preferences if you want desktop-first delivery. The macOS app stores the API key in Keychain, long-polls the same API as Android, locally schedules synced future alarms, and shows a full-screen looping alarm until dismiss or snooze.

The current public macOS DMG and zip are Developer ID signed, notarized, and stapled for direct download outside the Mac App Store. Local preview builds may still require an explicit Open action.

## Agent install

```bash
npx skills add quavedev/pager-agent --skill quave-pager -g -a '*'
```

Set your API key as `QUAVE_PAGER_API_KEY`. Create or rotate the key from the Quave Pager Android app, then reuse it in the macOS app if desired.

Dry-run:

```bash
npx -y github:quavedev/pager-agent trigger --dry-run --message "Quave Pager setup test."
```

Real page:

```bash
QUAVE_PAGER_API_KEY="<your key>" \
  npx -y github:quavedev/pager-agent trigger \
  --message "Look at Codex: I need your decision to continue." \
  --codex-thread-id "<thread-id>"
```

## Automatic paging (hooks)

The skill above pages on request, but a skill is **discretionary** — the agent has to decide
to call it, so it will not reliably page you on its own. For automatic paging when a task
finishes or the agent gets blocked, wire Quave Pager into your agent's **deterministic
notification hook**.

For Claude Code, configure `Stop` and `Notification` hooks in `settings.json` so every
finished turn and every input prompt fires a page. Full copy-paste setup, including where the
config lives for local vs. web sessions:

- [docs/claude-code-hooks.md](docs/claude-code-hooks.md)

Other agents follow the same pattern (e.g. point the Codex `notify` program in
`~/.codex/config.toml` at `npx -y github:quavedev/pager-agent trigger`).

## Link vs AI conversation resume

Use `--link` for the thing produced by the conversation: a PR, doc, checkout page, incident dashboard, Slack thread, etc. Use AI conversation resume fields when the button should return the user to Codex, Claude Code, Cursor, or another agent. Compatible Android/macOS clients show that as a separate **Resume AI conversation** action.

Examples:

```bash
# Codex: tell compatible clients how to return to the Codex conversation.
npx -y github:quavedev/pager-agent trigger \
  --message "Look at Codex: I need your decision." \
  --codex-thread-id "<thread-id>"

# Claude Code: copy a resume command on macOS.
npx -y github:quavedev/pager-agent trigger \
  --message "Claude Code is blocked." \
  --claude-session "<session-id>" \
  --ai-cwd "$PWD"

# Cursor: copy a resume command on macOS.
npx -y github:quavedev/pager-agent trigger \
  --message "Cursor agent needs you." \
  --cursor-session "<session-id>" \
  --ai-cwd "$PWD"

# Result/action URL: separate from returning to the AI conversation.
npx -y github:quavedev/pager-agent trigger \
  --message "Review the PR that is ready." \
  --link "https://github.com/example/repo/pull/123"
```

Advanced resume fields:

- `--ai-resume-json '<json object>'`: send the full `aiConversationResume` object.
- `--ai-provider codex|claude-code|cursor|other`
- `--ai-conversation-id <id>` / `--ai-title <title>` / `--ai-label <button label>`
- `--ai-resume-url <url>` with optional `--ai-platforms android,ios,macos,web`
- `--ai-resume-command <command>` with optional `--ai-cwd <path>`
- `--ai-resume-instructions <text>`
- `edit <alarm-id> --clear-ai-conversation-resume` removes resume metadata.

List, edit, and remove existing alarms:

```bash
npx -y github:quavedev/pager-agent list
npx -y github:quavedev/pager-agent edit <alarm-id> \
  --scheduled-at "2026-06-13 16:19:00" \
  --time-zone "America/Campo_Grande" \
  --status pending
npx -y github:quavedev/pager-agent remove <alarm-id>
```

Use `cancel`, `dismiss`, or `snooze` when you want lifecycle history instead of removal.

Never commit, log, or paste API keys into chat, URLs, or command arguments.
