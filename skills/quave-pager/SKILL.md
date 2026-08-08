---
name: quave-pager
description: Call the user's attention through Quave Pager when work is blocked and normal chat may be missed.
---

# Quave Pager

Use Quave Pager only when the user explicitly asks you to page them, or when your workflow is blocked on their decision, credential, device action, approval, or real-world action and a normal chat update may be missed.

Do not use this for routine progress updates, success notifications, or questions you can continue without.

## Setup

Use the user's API key from `QUAVE_PAGER_API_KEY`. If it is missing, ask the user to create or rotate a key in the Quave Pager Android or macOS app and provide it through an environment variable or approved secret store. Never paste the key into files, commits, URLs, command arguments, or chat logs.

Discovery:

- API base URL: `https://pager.quave.ai`
- OpenAPI: `https://pager.quave.ai/openapi.json`
- Install metadata: `https://pager.quave.ai/.well-known/quave-pager.json`

## Dry Run

Before the first real page, use the CLI dry-run and inspect the request. This does not contact the API:

```bash
npx -y github:quavedev/pager-agent trigger \
  --alarm-type critical \
  --message "Look at Codex: I need your decision to continue." \
  --codex-thread-id "${CODEX_THREAD_ID:-<thread-id>}" \
  --dry-run
```

## Page The User

Use a short message that says where the user should look and what is blocked.

`--link` and AI conversation resume are different:

- Use `--link` only for the result/action URL from the conversation: a PR, document, checkout page, incident dashboard, Slack thread, etc. It must be `http://` or `https://`.
- Use AI conversation resume fields when the alarm should return the user to Codex, Claude Code, Cursor, or another agent. Compatible Android/macOS clients show this as a separate "Resume AI conversation" action.
- Do not put `codex://...` in `--link`. Codex deep links belong in AI conversation resume, preferably via `--codex-thread-id`. The CLI accepts `--link codex://threads/<thread-id>` only as a compatibility alias and converts it into AI resume metadata.

Preferred CLI examples:

```bash
# Codex Desktop exposes the current thread id in CODEX_THREAD_ID.
npx -y github:quavedev/pager-agent trigger \
  --alarm-type critical \
  --message "Look at Codex: I need your decision to continue." \
  --codex-thread-id "${CODEX_THREAD_ID:-<thread-id>}"

npx -y github:quavedev/pager-agent trigger \
  --alarm-type critical \
  --message "Claude Code is blocked." \
  --claude-session "<session-id>" \
  --ai-cwd "$PWD"

npx -y github:quavedev/pager-agent trigger \
  --alarm-type critical \
  --message "Cursor agent needs you." \
  --cursor-session "<session-id>" \
  --ai-cwd "$PWD"

npx -y github:quavedev/pager-agent trigger \
  --alarm-type regular \
  --message "Review the PR that is ready." \
  --link "https://github.com/example/repo/pull/123"
```

## Alarm Type Selection Policy

New callers should be Alarm-Type-first. Pass `--alarm-type` / `alarmType`, or
`--alarm-type-id` / `alarmTypeId`, whenever the caller knows the intent. Use
legacy `severity` only for backwards compatibility; do not create a separate criticality concept for new callers.

Default users start with these stable built-in type keys. Custom user types should win when they clearly match the intent (for example, use `Time sensitive` for cooking timers if that type exists):

| Alarm Type key | Display name | Use for |
| --- | --- | --- |
| `critical` | Critical | The user must act now: blocked work, approval/credential/device/real-world action, production or customer incident, release failure that prevents progress. |
| `regular` | Regular | Actionable but not emergency: work done, PR/doc/release ready for review, routine approval, follow-up where prompt response is useful but not urgent. |
| `info` | Info | FYI only: low-priority status, summaries, successful background checks, non-blocking reminders. |
| `calendar` | Calendar | Reserved for Google Calendar cloud-sync event reminders. Agents should not use this for normal AI notifications. |

Why this matters: native clients let users pause or route one Alarm Type on one
receiver without muting the rest. If every caller sends `critical`, the user
cannot control noisy sources. Alarm Type is the user-facing intent; legacy
`severity` is only a compatibility shim for older callers.

Caller rules:

1. Prefer the built-in keys `critical`, `regular`, and `info` instead of display
   names. Users may rename the display names, but the built-in keys stay stable.
2. Long-lived clients should periodically call `alarm-types list` or
   `GET /api/alarm-types` and use the returned `id` for custom types.
3. Use a custom Alarm Type only when it already exists and clearly matches the
   source/intent, for example `Time sensitive` for cooking timers, `Deploys`,
   `Compliance`, `Customer incident`, or `Family`.
4. Do not create, edit, or remove Alarm Types automatically unless the user
   explicitly asks or the app is in an onboarding/admin flow. Fall back to
   `critical`, `regular`, or `info` when a custom type is absent. Do not fall back to `calendar` unless you are the Calendar sync integration.
5. Hooks that page on "needs input" should use `critical`; hooks that page on
   "finished / ready for review" should use `regular`; pure FYI hooks should use
   `info`.

Raw HTTP fallback:

```bash
curl -fsS -X POST https://pager.quave.ai/api/alarms \
  -H "Authorization: Bearer $QUAVE_PAGER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Quave Pager",
    "body": "Look at Codex: I need your decision to continue.",
    "alarmType": "critical",
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
- `title`: defaults to `Quave Pager`.
- `alarmType` / `alarmTypeId`: choose a user-controlled Alarm Type by id, key, or name. Prefer built-in keys `critical`, `regular`, and `info` for agent-created pages because display names can be renamed; `calendar` is reserved for Google Calendar sync reminders; use a returned custom type id when one clearly matches the intent. See "Alarm Types" below.
- `link`: optional `http://` or `https://` result/action destination.
- `aiConversationResume`: optional object for returning to Codex, Claude Code, Cursor, or another AI conversation.
- `delaySeconds`: relative scheduling.
- `scheduledAt`: exact ISO or local wall-clock timestamp.
- `timeZone`: IANA time zone for local wall-clock timestamps.
- `ttlSeconds`: delivery window.

Do not combine `delaySeconds` and `scheduledAt`.

AI resume CLI flags:

- `--codex-thread-id <thread-id>`: creates Codex Android/web URL and macOS `codex://threads/<thread-id>` deeplink resume targets. In Codex Desktop, prefer `${CODEX_THREAD_ID}` when set. If the thread id is not known, do not invent one.
- `--codex-deeplink codex://threads/<thread-id>`: explicit Codex app deeplink target.
- `--claude-session <session-id>`: creates a macOS copy-command target plus Android/iOS/web resume instructions using `claude --resume`.
- `--cursor-session <session-id>`: creates a macOS copy-command target using `cursor-agent --resume`.
- `--ai-cwd <path>`: attach the working directory to copy-command targets.
- `--ai-resume-json '<json object>'`: send an explicit `aiConversationResume` object.
- `--ai-resume-url <url>` / `--ai-resume-command <command>` / `--ai-resume-instructions <text>`: generic targets.
- `--ai-platforms android,ios,macos,web`: override generic target device compatibility.

## Why Codex Deep Links Can Be Missing

If a Codex page only opens the generic Codex screen, the alarm probably used `--link https://chatgpt.com/codex` or omitted AI resume metadata. If a `codex://threads/<thread-id>` value was sent through `link`, older instructions also caused the API to reject it because `link` is intentionally `http(s)` only. The reliable pattern is:

```bash
npx -y github:quavedev/pager-agent trigger \
  --alarm-type regular \
  --message "Look at Codex: the work is done." \
  --codex-thread-id "${CODEX_THREAD_ID:-<thread-id>}"
```

Codex currently has a known macOS deep link (`codex://threads/<thread-id>`). Claude Code and Cursor do not have a verified stable conversation deeplink in this package. `--claude-session` and `--cursor-session` provide a macOS copy-command target and an Android/iOS/web instruction target; use `--ai-cwd` so the instruction names the right workspace.

## Verify delivery health

Before relying on a new channel, run:

```bash
npx -y github:quavedev/pager-agent doctor
```

It checks API access, registered devices, recent sync, whole-device/Critical
pause state, and resume capabilities without printing the key. Use
`doctor --test-delivery` only when a real test alarm is wanted; success means
the selected receiver reported it is ringing, not merely that the API returned
`201`. See `docs/doctor.md` in the public package for details.

## Inspect, Edit, And Remove Alarms

When you need to correct or remove a previously created alarm, use the API directly. Removed alarms are logically deleted from normal lists and delivery.

List active alarms:

```bash
curl -fsS https://pager.quave.ai/api/alarms \
  -H "Authorization: Bearer $QUAVE_PAGER_API_KEY"
```

Edit an alarm:

```bash
npx -y github:quavedev/pager-agent edit <alarm-id> \
  --scheduled-at "2026-06-13 16:19:00" \
  --time-zone "America/Campo_Grande" \
  --status pending

npx -y github:quavedev/pager-agent edit <alarm-id> \
  --clear-ai-conversation-resume
```

Remove an alarm from normal lists and delivery:

```bash
curl -fsS -X DELETE https://pager.quave.ai/api/alarms/<alarm-id> \
  -H "Authorization: Bearer $QUAVE_PAGER_API_KEY"
```

Lifecycle helpers:

```bash
curl -fsS -X POST https://pager.quave.ai/api/alarms/<alarm-id>/cancel \
  -H "Authorization: Bearer $QUAVE_PAGER_API_KEY"
curl -fsS -X POST https://pager.quave.ai/api/alarms/<alarm-id>/dismiss \
  -H "Authorization: Bearer $QUAVE_PAGER_API_KEY"
curl -fsS -X POST https://pager.quave.ai/api/alarms/<alarm-id>/snooze \
  -H "Authorization: Bearer $QUAVE_PAGER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"delaySeconds":600}'
```

## Alarm Types

Prefer `alarmType` / `alarmTypeId` for new automations. Alarm Type is the user-facing concept; legacy `severity` is not a separate user-facing setting for new callers.
Default types have stable keys `critical`, `regular`, `info`, and `calendar`; users can rename their display names or add custom types later. `calendar` is reserved for Google Calendar sync reminders, not normal agent pages.

```bash
npx -y github:quavedev/pager-agent alarm-types list
npx -y github:quavedev/pager-agent alarm-types create --name "Time sensitive" --description "Cooking timers and other time-sensitive reminders"
npx -y github:quavedev/pager-agent alarm-types edit <alarm-type-id> --name "Family" --description "Family interruptions"
npx -y github:quavedev/pager-agent alarm-types remove <alarm-type-id>

npx -y github:quavedev/pager-agent trigger \
  --alarm-type regular \
  --message "Review the PR when you can."
```

Use custom Alarm Types when they already exist and match the intent. For example, if `alarm-types list` shows `Time sensitive`, use it for cooking timers or other real-world reminders that need timely attention. Treat `severity` as a legacy compatibility field only.

## Response Pattern

After paging the user, report only:

- that a Quave Pager was created;
- the alarm ID and expiry/scheduled time if useful;
- the reason/message sent.

Never include the API key or raw secret source in the final answer.
