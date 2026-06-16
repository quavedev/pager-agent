---
name: quave-alarm
description: Call the user's attention through Quave Alarm when work is blocked and normal chat may be missed.
---

# Quave Alarm

Use Quave Alarm only when the user explicitly asks you to page them, or when your workflow is blocked on their decision, credential, device action, approval, or real-world action and a normal chat update may be missed.

Do not use this for routine progress updates, success notifications, or questions you can continue without.

## Setup

Use the user's API key from `QUAVE_ALARM_API_KEY`. If it is missing, ask the user to create or rotate a key in the Quave Alarm Android or macOS app and provide it through an environment variable or approved secret store. Never paste the key into files, commits, URLs, command arguments, or chat logs.

Discovery:

- API base URL: `https://alarm.quave.ai`
- OpenAPI: `https://alarm.quave.ai/openapi.json`
- Install metadata: `https://alarm.quave.ai/.well-known/quave-alarm.json`

## Dry Run

Before the first real page, use the CLI dry-run and inspect the request. This does not contact the API:

```bash
npx -y github:quavedev/quave-alarm-agent trigger \
  --message "Look at Codex: I need your decision to continue." \
  --codex-thread-id "<thread-id>" \
  --dry-run
```

## Page The User

Use a short message that says where the user should look and what is blocked.

`--link` and AI conversation resume are different:

- Use `--link` for the result/action URL from the conversation: a PR, document, checkout page, incident dashboard, Slack thread, etc.
- Use AI conversation resume fields when the alarm should return the user to Codex, Claude Code, Cursor, or another agent. Compatible Android/macOS clients show this as a separate "Resume AI conversation" action.

Preferred CLI examples:

```bash
npx -y github:quavedev/quave-alarm-agent trigger \
  --message "Look at Codex: I need your decision to continue." \
  --codex-thread-id "<thread-id>"

npx -y github:quavedev/quave-alarm-agent trigger \
  --message "Claude Code is blocked." \
  --claude-session "<session-id>" \
  --ai-cwd "$PWD"

npx -y github:quavedev/quave-alarm-agent trigger \
  --message "Cursor agent needs you." \
  --cursor-session "<session-id>" \
  --ai-cwd "$PWD"

npx -y github:quavedev/quave-alarm-agent trigger \
  --message "Review the PR that is ready." \
  --link "https://github.com/example/repo/pull/123"
```

Raw HTTP fallback:

```bash
curl -fsS -X POST https://alarm.quave.ai/api/alarms \
  -H "Authorization: Bearer $QUAVE_ALARM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Quave Alarm",
    "body": "Look at Codex: I need your decision to continue.",
    "severity": "critical",
    "aiConversationResume": {
      "provider": "codex",
      "conversationId": "<thread-id>",
      "targets": [
        { "platforms": ["android", "ios", "web"], "kind": "url", "url": "https://chatgpt.com/codex" },
        { "platforms": ["macos"], "kind": "deeplink", "url": "codex://threads/<thread-id>" }
      ],
      "fallbackInstructions": "Open Codex and resume this task."
    }
  }'
```

Useful options:

- `body`: required message.
- `title`: defaults to `Quave Alarm`.
- `severity`: `info`, `warning`, or `critical`; defaults to `critical`.
- `link`: optional `http://` or `https://` result/action destination.
- `aiConversationResume`: optional object for returning to Codex, Claude Code, Cursor, or another AI conversation.
- `delaySeconds`: relative scheduling.
- `scheduledAt`: exact ISO or local wall-clock timestamp.
- `timeZone`: IANA time zone for local wall-clock timestamps.
- `ttlSeconds`: delivery window.

Do not combine `delaySeconds` and `scheduledAt`.

AI resume CLI flags:

- `--codex-thread-id <thread-id>`: creates Codex Android/web URL and macOS deeplink resume targets.
- `--claude-session <session-id>`: creates a macOS copy-command target using `claude --resume`.
- `--cursor-session <session-id>`: creates a macOS copy-command target using `cursor-agent --resume`.
- `--ai-cwd <path>`: attach the working directory to copy-command targets.
- `--ai-resume-json '<json object>'`: send an explicit `aiConversationResume` object.
- `--ai-resume-url <url>` / `--ai-resume-command <command>` / `--ai-resume-instructions <text>`: generic targets.
- `--ai-platforms android,ios,macos,web`: override generic target device compatibility.

## Inspect, Edit, And Remove Alarms

When you need to correct or remove a previously created alarm, use the API directly. Removed alarms are logically deleted from normal lists and delivery.

List active alarms:

```bash
curl -fsS https://alarm.quave.ai/api/alarms \
  -H "Authorization: Bearer $QUAVE_ALARM_API_KEY"
```

Edit an alarm:

```bash
npx -y github:quavedev/quave-alarm-agent edit <alarm-id> \
  --scheduled-at "2026-06-13 16:19:00" \
  --time-zone "America/Campo_Grande" \
  --status pending

npx -y github:quavedev/quave-alarm-agent edit <alarm-id> \
  --clear-ai-conversation-resume
```

Remove an alarm from normal lists and delivery:

```bash
curl -fsS -X DELETE https://alarm.quave.ai/api/alarms/<alarm-id> \
  -H "Authorization: Bearer $QUAVE_ALARM_API_KEY"
```

Lifecycle helpers:

```bash
curl -fsS -X POST https://alarm.quave.ai/api/alarms/<alarm-id>/cancel \
  -H "Authorization: Bearer $QUAVE_ALARM_API_KEY"
curl -fsS -X POST https://alarm.quave.ai/api/alarms/<alarm-id>/dismiss \
  -H "Authorization: Bearer $QUAVE_ALARM_API_KEY"
curl -fsS -X POST https://alarm.quave.ai/api/alarms/<alarm-id>/snooze \
  -H "Authorization: Bearer $QUAVE_ALARM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"delaySeconds":600}'
```
