#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "trigger";

const supportedCommands = new Set(["trigger", "list", "edit", "remove", "cancel", "dismiss", "snooze"]);
if (!supportedCommands.has(command)) {
  fail(`Unsupported command: ${command}. Use trigger, list, edit, remove, cancel, dismiss, or snooze.`);
}

if (args["delay-seconds"] && args["scheduled-at"]) {
  fail("Use either --delay-seconds or --scheduled-at, not both.");
}

if (command === "trigger") {
  const message = args.message || args.body;
  if (!message) {
    fail("--message is required");
  }
}

const baseUrl = (args["base-url"] || process.env.QUAVE_PAGER_BASE_URL || "https://pager.quave.ai").replace(/\/+$/, "");
const request = buildRequest(command, args);

if (!request) {
  fail(`Could not build request for ${command}.`);
}

if (args["dry-run"]) {
  console.log(JSON.stringify({ dryRun: true, baseUrl, request }, null, 2));
  process.exit(0);
}

const apiKey = process.env.QUAVE_PAGER_API_KEY;
if (!apiKey) {
  fail("QUAVE_PAGER_API_KEY is required. Ask the user to create or rotate a key in the Quave Pager Android app and expose it as an environment variable.");
}

const headers = { "Authorization": `Bearer ${apiKey}` };
if (request.body) {
  headers["Content-Type"] = "application/json";
}

const response = await fetch(`${baseUrl}${request.path}`, {
  method: request.method,
  headers,
  body: request.body ? JSON.stringify(request.body) : undefined
});

const body = await response.json().catch(() => ({}));
if (!response.ok) {
  fail(`Quave Pager request failed: HTTP ${response.status} ${JSON.stringify(body)}`);
}

console.log(JSON.stringify(formatResponse(command, body), null, 2));

function buildRequest(commandName, parsedArgs) {
  if (commandName === "trigger") {
    const payload = {
      title: parsedArgs.title || "Quave Pager",
      body: parsedArgs.message || parsedArgs.body,
      severity: parsedArgs.severity || "critical"
    };

    copyLinkIfPresent(payload, parsedArgs.link);
    const aiConversationResume = buildAiConversationResume(parsedArgs);
    if (aiConversationResume) {
      payload.aiConversationResume = aiConversationResume;
    }
    copyIfPresent(payload, "deviceId", parsedArgs["device-id"]);
    copyIfPresent(payload, "scheduledAt", parsedArgs["scheduled-at"]);
    copyIfPresent(payload, "timeZone", parsedArgs["time-zone"]);
    copyNumberIfPresent(payload, "delaySeconds", parsedArgs["delay-seconds"]);
    copyNumberIfPresent(payload, "ttlSeconds", parsedArgs["ttl-seconds"]);

    return { method: "POST", path: "/api/alarms", body: payload };
  }

  if (commandName === "list") {
    const query = parsedArgs["include-removed"] ? "?includeRemoved=true" : "";
    return { method: "GET", path: `/api/alarms${query}` };
  }

  const alarmId = parsedArgs.id || parsedArgs._[1];
  if (!alarmId) {
    fail(`${commandName} requires --id <alarm-id> or an alarm ID argument.`);
  }
  const encodedId = encodeURIComponent(alarmId);

  if (commandName === "remove") {
    return { method: "DELETE", path: `/api/alarms/${encodedId}` };
  }

  if (commandName === "cancel" || commandName === "dismiss") {
    return { method: "POST", path: `/api/alarms/${encodedId}/${commandName}`, body: {} };
  }

  if (commandName === "snooze") {
    const payload = {};
    copyIfPresent(payload, "scheduledAt", parsedArgs["scheduled-at"]);
    copyIfPresent(payload, "timeZone", parsedArgs["time-zone"]);
    copyNumberIfPresent(payload, "delaySeconds", parsedArgs["delay-seconds"]);
    return { method: "POST", path: `/api/alarms/${encodedId}/snooze`, body: payload };
  }

  const payload = {};
  copyIfPresent(payload, "title", parsedArgs.title);
  copyIfPresent(payload, "body", parsedArgs.message || parsedArgs.body);
  copyIfPresent(payload, "severity", parsedArgs.severity);
  copyLinkIfPresent(payload, parsedArgs.link);
  const aiConversationResume = buildAiConversationResume(parsedArgs);
  if (aiConversationResume) {
    payload.aiConversationResume = aiConversationResume;
  }
  copyIfPresent(payload, "deviceId", parsedArgs["device-id"]);
  copyIfPresent(payload, "scheduledAt", parsedArgs["scheduled-at"]);
  copyIfPresent(payload, "timeZone", parsedArgs["time-zone"]);
  copyIfPresent(payload, "expiresAt", parsedArgs["expires-at"]);
  copyIfPresent(payload, "status", parsedArgs.status);
  copyNumberIfPresent(payload, "delaySeconds", parsedArgs["delay-seconds"]);
  copyNumberIfPresent(payload, "ttlSeconds", parsedArgs["ttl-seconds"]);
  copyBooleanIfPresent(payload, "clearLink", parsedArgs["clear-link"]);
  copyBooleanIfPresent(payload, "clearAiConversationResume", parsedArgs["clear-ai-conversation-resume"]);
  copyBooleanIfPresent(payload, "clearDeviceId", parsedArgs["clear-device-id"]);

  if (Object.keys(payload).length === 0) {
    fail("edit requires at least one editable field.");
  }

  return { method: "PATCH", path: `/api/alarms/${encodedId}`, body: payload };
}

function buildAiConversationResume(parsedArgs) {
  if (parsedArgs["ai-resume-json"]) {
    try {
      const parsed = JSON.parse(parsedArgs["ai-resume-json"]);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        fail("--ai-resume-json must be a JSON object.");
      }
      return parsed;
    } catch (error) {
      fail(`--ai-resume-json must be valid JSON: ${error.message}`);
    }
  }

  const targets = [];
  let provider = parsedArgs["ai-provider"];
  let conversationId = parsedArgs["ai-conversation-id"] || parsedArgs["ai-thread-id"] || parsedArgs["ai-session-id"];
  const codexDeepLink = parsedArgs["codex-deeplink"]
    ? parseCodexThreadDeeplink(parsedArgs["codex-deeplink"], { strict: true })
    : parseCodexThreadDeeplink(parsedArgs.link);

  if (parsedArgs["codex-thread-id"] || codexDeepLink) {
    provider = provider || "codex";
    const codexThreadId = parsedArgs["codex-thread-id"] || codexDeepLink.threadId;
    conversationId = conversationId || codexThreadId;
    targets.push({
      platforms: ["android", "ios", "web"],
      kind: "url",
      url: parsedArgs["codex-url"] || "https://chatgpt.com/codex",
      label: "Open Codex"
    });
    targets.push({
      platforms: ["macos"],
      kind: "deeplink",
      url: parsedArgs["codex-deeplink"] || codexDeepLink?.url || `codex://threads/${encodeURIComponent(codexThreadId)}`,
      label: "Open Codex app",
      compatibility: "Use when the local Codex app supports this thread route."
    });
  }

  if (parsedArgs["claude-session"]) {
    provider = provider || "claude-code";
    conversationId = conversationId || parsedArgs["claude-session"];
    const command = parsedArgs["claude-command"] || `claude --resume ${shellQuote(parsedArgs["claude-session"])}`;
    targets.push(commandTarget(command, parsedArgs["ai-cwd"], "Copy Claude resume command"));
  }

  if (parsedArgs["claude-remote-url"]) {
    provider = provider || "claude-code";
    targets.push(urlTarget(parsedArgs["claude-remote-url"], "Open Claude conversation"));
  }

  if (parsedArgs["cursor-session"]) {
    provider = provider || "cursor";
    conversationId = conversationId || parsedArgs["cursor-session"];
    const command = parsedArgs["cursor-command"] || `cursor-agent --resume ${shellQuote(parsedArgs["cursor-session"])}`;
    targets.push(commandTarget(command, parsedArgs["ai-cwd"], "Copy Cursor resume command"));
  }

  if (parsedArgs["ai-resume-url"]) {
    targets.push(urlTarget(parsedArgs["ai-resume-url"], parsedArgs["ai-resume-label"], parsedArgs["ai-platforms"]));
  }

  if (parsedArgs["ai-resume-command"]) {
    targets.push(commandTarget(parsedArgs["ai-resume-command"], parsedArgs["ai-cwd"], parsedArgs["ai-resume-label"], parsedArgs["ai-platforms"] || "macos"));
  }

  if (parsedArgs["ai-resume-instructions"]) {
    targets.push({
      platforms: platformList(parsedArgs["ai-platforms"] || "android,ios,macos,web"),
      kind: "instructions",
      instructions: parsedArgs["ai-resume-instructions"],
      label: parsedArgs["ai-resume-label"] || "Resume AI conversation"
    });
  }

  const fallbackInstructions = parsedArgs["ai-fallback-instructions"];
  const title = parsedArgs["ai-title"];
  const label = parsedArgs["ai-label"];
  if (!provider && !conversationId && !title && !label && !fallbackInstructions && targets.length === 0) {
    return undefined;
  }
  return removeEmpty({
    provider: provider || "other",
    conversationId,
    title,
    label,
    targets: targets.length ? targets : undefined,
    fallbackInstructions
  });
}

function urlTarget(url, label, platforms) {
  return removeEmpty({
    platforms: platformList(platforms || "android,ios,macos,web"),
    kind: "url",
    url,
    label: label || "Open AI conversation"
  });
}

function commandTarget(command, cwd, label, platforms = "macos") {
  return removeEmpty({
    platforms: platformList(platforms),
    kind: "copyCommand",
    command,
    cwd,
    label: label || "Copy resume command"
  });
}

function platformList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function removeEmpty(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}

function parseCodexThreadDeeplink(value, { strict = false } = {}) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return undefined;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    if (strict) {
      fail("Invalid Codex deeplink. Use codex://threads/<thread-id> or --codex-thread-id <thread-id>.");
    }
    return undefined;
  }
  if (url.protocol !== "codex:") {
    if (strict) {
      fail("Invalid Codex deeplink. Use codex://threads/<thread-id> or --codex-thread-id <thread-id>.");
    }
    return undefined;
  }
  const segments = [url.hostname, ...url.pathname.split("/")].filter(Boolean);
  if (segments[0] !== "threads" || !segments[1]) {
    fail("Unsupported Codex deeplink. Use codex://threads/<thread-id> or --codex-thread-id <thread-id>.");
  }
  return {
    threadId: decodeURIComponent(segments[1]),
    url: raw
  };
}

function copyLinkIfPresent(target, value) {
  const link = typeof value === "string" ? value.trim() : "";
  if (!link) {
    return;
  }
  if (parseCodexThreadDeeplink(link)) {
    return;
  }
  target.link = normalizeHttpLink(link);
}

function normalizeHttpLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("unsupported_protocol");
    }
    return url.toString();
  } catch {
    fail("--link must be a valid http:// or https:// result/action URL. For Codex deep links use --codex-thread-id <thread-id> or --codex-deeplink codex://threads/<thread-id>.");
  }
}

function formatResponse(commandName, body) {
  if (commandName === "list") {
    return {
      ok: true,
      alarms: Array.isArray(body.alarms) ? body.alarms.map((alarm) => ({
        id: alarm.id,
        title: alarm.title,
        body: alarm.body,
        status: alarm.status,
        scheduledAt: alarm.scheduledAt,
        timeZone: alarm.timeZone,
        expiresAt: alarm.expiresAt,
        removedAt: alarm.removedAt,
        aiConversationResume: alarm.aiConversationResume
      })) : []
    };
  }

  return {
    ok: true,
    alarmId: body.alarm?.id,
    status: body.alarm?.status,
    scheduledAt: body.alarm?.scheduledAt,
    timeZone: body.alarm?.timeZone,
    expiresAt: body.alarm?.expiresAt,
    removedAt: body.alarm?.removedAt,
    link: body.alarm?.link,
    aiConversationResume: body.alarm?.aiConversationResume
  };
}

function parseArgs(values) {
  const parsed = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      parsed._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function copyIfPresent(target, field, value) {
  if (typeof value === "string" && value.trim()) {
    target[field] = value.trim();
  }
}

function copyNumberIfPresent(target, field, value) {
  if (value !== undefined && value !== true && value !== "") {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      fail(`${field} must be a number.`);
    }
    target[field] = number;
  }
}

function copyBooleanIfPresent(target, field, value) {
  if (value !== undefined) {
    target[field] = value === true || value === "true";
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
