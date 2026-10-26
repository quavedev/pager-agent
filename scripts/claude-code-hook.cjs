#!/usr/bin/env node
'use strict';

const https = require('https');
const fs = require('fs');
const os = require('os');
const pathModule = require('path');
const { execFileSync } = require('child_process');

const API_URL = new URL(process.env.QUAVE_PAGER_BASE_URL || 'https://pager.quave.ai');
const DRY_RUN = process.argv.includes('--dry-run') || process.env.QUAVE_PAGER_HOOK_DRY_RUN === '1';
const DEBUG = process.env.QUAVE_PAGER_HOOK_DEBUG === '1';

function exitOk() {
  process.exit(0);
}

process.on('uncaughtException', (error) => {
  if (DEBUG) console.error(`[quave-pager-hook] ${error.stack || error.message}`);
  exitOk();
});
process.on('unhandledRejection', (error) => {
  if (DEBUG) console.error(`[quave-pager-hook] ${error && (error.stack || error.message) || error}`);
  exitOk();
});

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

function safeParseJson(text) {
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    return {};
  }
}

function keyFromInteractiveZsh() {
  try {
    const output = execFileSync('/bin/zsh', [
      '-ic',
      'printf "\\n__QUAVE_PAGER_KEY_BEGIN__\\n%s\\n__QUAVE_PAGER_KEY_END__\\n" "${QUAVE_PAGER_API_KEY-}"'
    ], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env }
    });
    const match = output.match(/__QUAVE_PAGER_KEY_BEGIN__\n([\s\S]*?)\n__QUAVE_PAGER_KEY_END__/);
    return match ? match[1].trim() : '';
  } catch (_error) {
    return '';
  }
}

function getApiKey() {
  const direct = (process.env.QUAVE_PAGER_API_KEY || '').trim();
  if (direct) return direct;
  return keyFromInteractiveZsh();
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function shorten(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function basename(path) {
  const text = String(path || '').replace(/\/+$/, '');
  return text.split('/').filter(Boolean).pop() || text || 'unknown cwd';
}

function t3UserDataDir() {
  const home = (process.env.T3CODE_HOME || '').trim() || pathModule.join(os.homedir(), '.t3');
  return pathModule.join(home, 'userdata');
}

// Maps the Claude session to the T3 thread that hosts it. Returns null outside T3.
function lookupT3Thread(sessionId) {
  if (!/^[A-Za-z0-9-]{8,128}$/.test(String(sessionId || ''))) return null;
  const userData = t3UserDataDir();
  const dbPath = pathModule.join(userData, 'statev2.sqlite');
  if (!fs.existsSync(dbPath)) return null;

  let db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(dbPath, { readOnly: true, timeout: 2000 });
    const threadQuery = db.prepare(`
      select t.thread_id as threadId, t.title as title, p.title as projectTitle,
             json_extract(t.payload_json, '$.lineage.relationshipToParent') as relationship,
             json_extract(t.payload_json, '$.lineage.rootThreadId') as rootThreadId
      from orchestration_v2_projection_threads t
      left join projection_projects p on p.project_id = t.project_id
      where t.thread_id = ?`);
    const match = db.prepare(`
      select thread_id as threadId
      from orchestration_v2_projection_provider_threads
      where json_extract(payload_json, '$.nativeThreadRef.nativeId') = ?
      order by updated_at desc limit 1`).get(sessionId);
    if (!match || !match.threadId) return null;

    const thread = threadQuery.get(match.threadId);
    if (!thread) return null;
    const isSubagent = thread.relationship === 'subagent';
    // Delegated child threads are not in Filipe's thread list; point at the root thread instead.
    const root = isSubagent && thread.rootThreadId ? threadQuery.get(thread.rootThreadId) : null;
    const target = root || thread;

    let environmentId = '';
    try {
      environmentId = fs.readFileSync(pathModule.join(userData, 'environment-id'), 'utf8').trim();
    } catch (_error) {}

    return {
      threadId: target.threadId,
      title: target.title,
      projectTitle: target.projectTitle || '',
      environmentId,
      isSubagent,
      childTitle: isSubagent ? thread.title : ''
    };
  } catch (error) {
    if (DEBUG) console.error(`[quave-pager-hook] T3 lookup failed: ${error.message}`);
    return null;
  } finally {
    try { if (db) db.close(); } catch (_error) {}
  }
}

function describeNotification(input) {
  const message = String(input.message || '');
  if (/AskUserQuestion/.test(message)) return 'Claude asked you a question.';
  if (input.notification_type === 'idle_prompt') return 'Claude is waiting for your reply.';
  if (input.notification_type === 'elicitation_dialog') return 'An MCP server is asking for your input.';
  if (input.notification_type === 'permission_prompt') return shorten(message || 'Claude needs a permission decision.', 160);
  return shorten(message || 'Claude is waiting for your input.', 160);
}

function buildT3Payload(input, t3) {
  const isStop = input.hook_event_name === 'Stop';
  const where = t3.projectTitle && t3.projectTitle !== 'No project' ? ` (${t3.projectTitle})` : '';
  const child = t3.childTitle ? ` Delegated task: ${t3.childTitle}.` : '';
  const ids = t3.environmentId
    ? `${encodeURIComponent(t3.environmentId)}/${encodeURIComponent(t3.threadId)}`
    : '';

  const payload = isStop ? {
    title: shorten(`Done: ${t3.title}`, 120),
    body: shorten(`Claude finished a turn in T3${where}.${child}`, 320),
    alarmType: 'regular'
  } : {
    title: shorten(`Needs you: ${t3.title}`, 120),
    body: shorten(`${describeNotification(input)} T3 thread${where}.${child}`, 320),
    alarmType: 'critical'
  };

  payload.aiConversationResume = {
    provider: 'claude-code',
    conversationId: t3.threadId,
    title: shorten(t3.title, 200),
    label: 'Open in T3',
    fallbackInstructions: shorten(`Open T3 Code and go to the thread "${t3.title}".`, 400),
    targets: ids ? [
      {
        // T3 Code desktop and the T3 Code Android app both register t3code://.
        platforms: ['macos', 'android'],
        kind: 'deeplink',
        url: `t3code://threads/${ids}`,
        label: 'Open in T3 Code'
      },
      {
        platforms: ['ios', 'web'],
        kind: 'url',
        url: `https://app.t3.codes/${ids}`,
        label: 'Open in T3'
      }
    ] : undefined
  };
  return payload;
}

function buildPayload(input) {
  const eventName = input.hook_event_name || '';
  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || '';
  const cwdLabel = basename(cwd);

  const isStop = eventName === 'Stop';
  const isNotification = eventName === 'Notification';

  const notificationType = input.notification_type ? `/${input.notification_type}` : '';
  const sourceLabel = `${eventName || 'Claude Code'}${notificationType}`;
  const notificationMessage = shorten(input.message || input.title || 'Claude Code is waiting for your input.', 180);

  const payload = isStop ? {
    title: 'Claude Code finished',
    body: shorten(`Claude Code finished a turn in ${cwdLabel}. Review the thread; resume from ${cwd}.`, 260),
    alarmType: 'regular'
  } : {
    title: 'Claude Code needs input',
    body: shorten(`Claude Code needs input (${sourceLabel}): ${notificationMessage} Resume from ${cwd}.`, 320),
    alarmType: 'critical'
  };

  if (sessionId) {
    payload.aiConversationResume = {
      provider: 'claude-code',
      conversationId: String(sessionId),
      targets: [
        {
          platforms: ['macos'],
          kind: 'copyCommand',
          command: `claude --resume ${shellQuote(sessionId)}`,
          cwd,
          label: 'Copy Claude resume command'
        }
      ]
    };
  }

  if (!isStop && !isNotification) {
    payload.title = 'Claude Code notification';
    payload.alarmType = 'info';
  }

  return payload;
}

function postAlarm(apiKey, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const options = {
      protocol: API_URL.protocol,
      hostname: API_URL.hostname,
      port: API_URL.port || undefined,
      path: '/api/alarms',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 10000
    };

    const request = https.request(options, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(0));
    request.end(body);
  });
}

(async () => {
  const input = safeParseJson(await readStdin());
  const eventName = input.hook_event_name || '';

  if (!['Notification', 'Stop'].includes(eventName)) exitOk();

  const t3 = lookupT3Thread(input.session_id);
  // A delegated child finishing a turn is not something Filipe needs to hear about.
  if (t3 && t3.isSubagent && eventName === 'Stop') exitOk();
  const payload = t3 ? buildT3Payload(input, t3) : buildPayload(input);

  if (DRY_RUN) {
    console.log(JSON.stringify({
      dryRun: true,
      baseUrl: API_URL.origin,
      request: {
        method: 'POST',
        path: '/api/alarms',
        body: payload
      }
    }, null, 2));
    exitOk();
  }

  const apiKey = getApiKey();
  if (!apiKey) exitOk();

  const status = await postAlarm(apiKey, payload);
  if (DEBUG) console.error(`[quave-pager-hook] POST /api/alarms -> ${status}`);
  if (status === 400 && t3) {
    // Older servers reject t3code:// deeplinks; still page with the thread title.
    payload.aiConversationResume.targets = (payload.aiConversationResume.targets || [])
      .filter(target => target.kind !== 'deeplink');
    await postAlarm(apiKey, payload);
  }
  exitOk();
})();
