# Windows + Android + Claude Code

This path takes a Windows computer running Claude Code and an Android phone from
zero to a verifiable Quave Pager channel. It intentionally uses a small local
PowerShell script: it gives every hook one sender, avoids JSON quoting traps,
and writes a safe local log before it decides not to page.

## 1. Prepare Android first

Install the current Android APK, sign in, and allow notifications, full-screen
alerts, exact alarms, Do Not Disturb access, and unrestricted battery use. Then
copy an API key into a **user** environment variable on Windows:

```powershell
[Environment]::SetEnvironmentVariable("QUAVE_PAGER_API_KEY", "<your key>", "User")
```

Close and reopen Claude Code (and its terminal) after setting the variable.
Never put the key in `settings.json`, the hook script, a repository, or a log.

## 2. Save one sender script

Create `%USERPROFILE%/QuavePager/pager-hook.ps1` with this content. The log
contains timestamps, event names, alarm ids, and errors; it never writes your
API key.

```powershell
param([Parameter(Mandatory = $true)][ValidateSet("Notification", "Stop")][string]$EventName)

$logDirectory = Join-Path $HOME "QuavePager"
$logPath = Join-Path $logDirectory "pager.log"
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
function Write-PagerLog([string]$Message) {
  Add-Content -Path $logPath -Value "$(Get-Date -Format o) [$EventName] $Message"
}

Write-PagerLog "hook started"
if (-not $env:QUAVE_PAGER_API_KEY) { Write-PagerLog "skipped: QUAVE_PAGER_API_KEY is unset"; exit 0 }

try {
  $inputJson = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $sessionId = [string]$inputJson.session_id
  $cwd = [string]$inputJson.cwd
  $body = if ($EventName -eq "Notification") { [string]$inputJson.message } else { "Claude Code finished — $cwd" }
  if (-not $body) { $body = if ($EventName -eq "Notification") { "Claude Code needs your input." } else { "Claude Code finished." } }
  $alarmType = if ($EventName -eq "Notification") { "critical" } else { "regular" }
  $resumeCommand = "claude --resume '$sessionId'"
  $payload = @{ title = "Quave Pager"; body = $body; alarmType = $alarmType; aiConversationResume = @{ provider = "claude-code"; conversationId = $sessionId; targets = @(
    @{ platforms = @("macos"); kind = "copyCommand"; command = $resumeCommand; cwd = $cwd; label = "Copy Claude resume command" },
    @{ platforms = @("android", "ios", "web"); kind = "instructions"; instructions = "On the computer running Claude Code, open a terminal, cd to $cwd, then run: $resumeCommand"; label = "Resume Claude Code on your computer" }
  ); fallbackInstructions = "Open Claude Code on the computer that owns this session." } }
  $response = Invoke-RestMethod -Method Post -Uri "https://pager.quave.ai/api/alarms" -Headers @{ Authorization = "Bearer $env:QUAVE_PAGER_API_KEY" } -ContentType "application/json" -Body ($payload | ConvertTo-Json -Depth 8 -Compress) -TimeoutSec 15
  if (-not $response.alarm.id) { throw "The API response did not include alarm.id." }
  Write-PagerLog "sent alarm $($response.alarm.id)"
} catch {
  Write-PagerLog "failed: $($_.Exception.Message)"
}
```

## 3. Add hooks with forward-slash paths

Merge this block into `%USERPROFILE%/.claude/settings.json`. The `args` form
runs `powershell.exe` directly, so it does not depend on Git Bash. Keep the
forward slashes in the script path; they avoid the Windows hook path parsing
failure observed with backslashes.

```json
{
  "hooks": {
    "Notification": [{
      "hooks": [{
        "type": "command",
        "command": "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
        "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:/Users/<your-user>/QuavePager/pager-hook.ps1", "Notification"]
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
        "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:/Users/<your-user>/QuavePager/pager-hook.ps1", "Stop"]
      }]
    }]
  }
}
```

Replace `<your-user>` once. Open `/hooks` in Claude Code to confirm both hooks
are registered. If they do not run, inspect `%USERPROFILE%/QuavePager/pager.log`
and Claude Code's debug log (`claude --debug`).

## 4. Prove it works

Run the non-disruptive health check first:

```powershell
npx -y github:quavedev/pager-agent doctor
```

Then run an explicit, real delivery test. It targets one eligible receiver,
waits until that receiver reports it is ringing, and cancels the test alarm.

```powershell
npx -y github:quavedev/pager-agent doctor --test-delivery
```

HTTP `201` only means the API accepted an alarm. A successful doctor test means
the receiver reported that the test alarm is ringing. It does not claim that a
human heard the sound.
