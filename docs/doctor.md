# `pager-agent doctor`

`doctor` checks the server-visible health of a Quave Pager channel without
printing the API key. It verifies API authentication, registered receivers,
receiver `lastSeenAt`, whole-device and Critical pause state, and the AI-resume
capabilities each receiver advertises.

```bash
npx -y github:quavedev/pager-agent doctor
```

The default stale threshold is 24 hours. Override it for a stricter local check:

```bash
npx -y github:quavedev/pager-agent doctor --max-stale-seconds 3600
```

Use `--test-delivery` only when you deliberately want a real alarm. The command
targets one eligible receiver with a Regular test alarm, waits for its
server-reported `ringingAlarm` receipt, then cancels the test alarm.

```bash
npx -y github:quavedev/pager-agent doctor --test-delivery
```

`201 Created` is only server acceptance; `dismissed` is a later user action.
Neither alone proves that a receiver rang. The test succeeds only after the
target receiver reports the test alarm as ringing.

`doctor` also detects a missing or invalid API key in the machine that is
trying to page the user, which the Pager server cannot infer from an unknown
local environment variable.
