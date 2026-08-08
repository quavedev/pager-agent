#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "trigger";

const supportedCommands = new Set(["trigger", "list", "edit", "remove", "cancel", "dismiss", "snooze", "alarm-types", "doctor"]);
if (!supportedCommands.has(command)) {
  fail(`Unsupported command: ${command}. Use trigger, list, edit, remove, cancel, dismiss, snooze, alarm-types, or doctor.`);
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
if (command === "doctor") {
  process.exit(await runDoctor(args, baseUrl));
}
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
  if (commandName === "alarm-types") {
    return buildAlarmTypesRequest(parsedArgs);
  }

  if (commandName === "trigger") {
    const payload = {
      title: parsedArgs.title || "Quave Pager",
      body: parsedArgs.message || parsedArgs.body
    };
    const hasAlarmType = Boolean(parsedArgs["alarm-type-id"] || parsedArgs["alarm-type"]);
    copyIfPresent(payload, "alarmTypeId", parsedArgs["alarm-type-id"]);
    copyIfPresent(payload, "alarmType", parsedArgs["alarm-type"]);
    if (!hasAlarmType && parsedArgs.severity) {
      payload.severity = parsedArgs.severity;
    } else if (!hasAlarmType) {
      payload.alarmType = "critical";
    }

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
  copyIfPresent(payload, "alarmTypeId", parsedArgs["alarm-type-id"]);
  copyIfPresent(payload, "alarmType", parsedArgs["alarm-type"]);
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

function buildAlarmTypesRequest(parsedArgs) {
  const sub = parsedArgs._[1] || "list";
  if (sub === "list") {
    const query = parsedArgs["include-removed"] ? "?includeRemoved=true" : "";
    return { method: "GET", path: `/api/alarm-types${query}` };
  }
  if (sub === "create") {
    if (!parsedArgs.name) {
      fail("alarm-types create requires --name <name>.");
    }
    const payload = {};
    copyIfPresent(payload, "name", parsedArgs.name);
    copyIfPresent(payload, "severity", parsedArgs.severity);
    copyIfPresent(payload, "description", parsedArgs.description);
    copyIfPresent(payload, "color", parsedArgs.color);
    copyIfPresent(payload, "key", parsedArgs.key);
    copyNumberIfPresent(payload, "sortOrder", parsedArgs["sort-order"]);
    return { method: "POST", path: "/api/alarm-types", body: payload };
  }

  const typeId = parsedArgs.id || parsedArgs._[2];
  if (!typeId) {
    fail(`alarm-types ${sub} requires --id <alarm-type-id> or an alarm type ID argument.`);
  }
  const encoded = encodeURIComponent(typeId);
  if (sub === "remove") {
    return { method: "DELETE", path: `/api/alarm-types/${encoded}` };
  }
  if (sub === "edit") {
    const payload = {};
    copyIfPresent(payload, "name", parsedArgs.name);
    copyIfPresent(payload, "severity", parsedArgs.severity);
    copyIfPresent(payload, "description", parsedArgs.description);
    copyIfPresent(payload, "color", parsedArgs.color);
    copyNumberIfPresent(payload, "sortOrder", parsedArgs["sort-order"]);
    if (Object.keys(payload).length === 0) {
      fail("alarm-types edit requires at least one of --name, --description, --color, --sort-order.");
    }
    return { method: "PATCH", path: `/api/alarm-types/${encoded}`, body: payload };
  }
  fail(`Unsupported alarm-types subcommand: ${sub}. Use list, create, edit, or remove.`);
  return undefined;
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
    targets.push({
      platforms: ["android", "ios", "web"],
      kind: "instructions",
      instructions: `On the computer running Claude Code, ${parsedArgs["ai-cwd"] ? `run \`cd ${parsedArgs["ai-cwd"]}\` and then ` : ""}run \`${command}\`.`,
      label: "Resume Claude Code on your computer"
    });
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
  if (commandName === "alarm-types") {
    if (Array.isArray(body.alarmTypes)) {
      return { ok: true, alarmTypes: body.alarmTypes };
    }
    return { ok: true, alarmType: body.alarmType };
  }

  if (commandName === "list") {
    return {
      ok: true,
      alarms: Array.isArray(body.alarms) ? body.alarms.map((alarm) => ({
        id: alarm.id,
        title: alarm.title,
        body: alarm.body,
        status: alarm.status,
        alarmTypeId: alarm.alarmTypeId,
        alarmTypeName: alarm.alarmTypeName,
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
    alarmTypeId: body.alarm?.alarmTypeId,
    alarmTypeName: body.alarm?.alarmTypeName,
    scheduledAt: body.alarm?.scheduledAt,
    timeZone: body.alarm?.timeZone,
    expiresAt: body.alarm?.expiresAt,
    removedAt: body.alarm?.removedAt,
    link: body.alarm?.link,
    aiConversationResume: body.alarm?.aiConversationResume
  };
}

async function runDoctor(parsedArgs, baseUrl) {
  const staleSeconds = positiveNumber(parsedArgs["max-stale-seconds"], 24 * 60 * 60, "max-stale-seconds");
  const testTimeoutSeconds = positiveNumber(parsedArgs["test-timeout-seconds"], 30, "test-timeout-seconds");
  const testAlarmType = parsedArgs["test-alarm-type"] || "regular";
  if (parsedArgs["dry-run"]) {
    console.log(JSON.stringify({
      dryRun: true,
      baseUrl,
      checks: ["API authentication", "registered receivers", "lastSeenAt freshness", "receiver and Critical pause state", "AI-resume capabilities"],
      testDelivery: parsedArgs["test-delivery"] === true ? { alarmType: testAlarmType, timeoutSeconds: testTimeoutSeconds } : false
    }, null, 2));
    return 0;
  }

  const apiKey = process.env.QUAVE_PAGER_API_KEY;
  if (!apiKey) {
    fail("QUAVE_PAGER_API_KEY is required. Ask the user to create or rotate a key in the Quave Pager Android or macOS app and expose it as an environment variable.");
  }
  const headers = { Authorization: `Bearer ${apiKey}` };
  const [status, alarmTypes] = await Promise.all([
    requestJson(baseUrl, "/api/status", { headers }),
    requestJson(baseUrl, "/api/alarm-types", { headers })
  ]);
  const report = buildDoctorReport(status, alarmTypes, staleSeconds);
  if (parsedArgs["test-delivery"] === true) {
    report.testDelivery = await testDelivery(baseUrl, headers, status, alarmTypes, testAlarmType, testTimeoutSeconds);
    if (!report.testDelivery.confirmed) {
      report.healthy = false;
      report.issues.push({ code: "test_delivery_unconfirmed", message: report.testDelivery.message });
    }
  }
  console.log(JSON.stringify(report, null, 2));
  return report.healthy ? 0 : 2;
}

function buildDoctorReport(status, alarmTypes, staleSeconds) {
  const now = Date.now();
  const devices = Array.isArray(status.devices) ? status.devices.filter((device) => !device.removedAt) : [];
  const types = Array.isArray(alarmTypes.alarmTypes) ? alarmTypes.alarmTypes : [];
  const critical = types.find((type) => type.key === "critical");
  const issues = [];
  const deviceReports = devices.map((device) => {
    const lastSeenMs = Date.parse(device.lastSeenAt || "");
    const ageSeconds = Number.isFinite(lastSeenMs) ? Math.max(0, Math.floor((now - lastSeenMs) / 1000)) : undefined;
    const criticalState = critical ? device.alarmTypeStates?.[critical.id] : undefined;
    return {
      deviceId: device.deviceId,
      name: device.name,
      platform: device.platform,
      enabled: device.enabled === true,
      manuallyEnabled: device.manualEnabled !== false,
      criticalEnabled: criticalState?.manualEnabled !== false,
      lastSeenAt: device.lastSeenAt,
      lastSeenAgeSeconds: ageSeconds,
      fresh: Number.isFinite(lastSeenMs) && now - lastSeenMs <= staleSeconds * 1000,
      aiConversationResumeKinds: device.capabilities?.aiConversationResumeKinds || ""
    };
  });
  if (deviceReports.length === 0) {
    issues.push({ code: "no_registered_devices", message: "No active receiver is registered to this account." });
  }
  const manuallyEnabled = deviceReports.filter((device) => device.manuallyEnabled);
  if (deviceReports.length > 0 && manuallyEnabled.length === 0) {
    issues.push({ code: "all_devices_paused", message: "All registered receivers are manually paused." });
  }
  if (manuallyEnabled.length > 0 && !manuallyEnabled.some((device) => device.fresh)) {
    issues.push({ code: "no_fresh_enabled_device", message: `No enabled receiver has checked in within ${Math.floor(staleSeconds / 3600)} hours.` });
  }
  if (manuallyEnabled.length > 0 && !manuallyEnabled.some((device) => device.criticalEnabled)) {
    issues.push({ code: "critical_paused_everywhere", message: "Critical alarms are manually paused on every enabled receiver." });
  }
  return {
    ok: issues.length === 0,
    healthy: issues.length === 0,
    checkedAt: new Date(now).toISOString(),
    staleAfterSeconds: staleSeconds,
    issues,
    devices: deviceReports,
    alarmTypes: types.map((type) => ({ id: type.id, key: type.key, name: type.name, isDefault: type.isDefault }))
  };
}

async function testDelivery(baseUrl, headers, status, alarmTypes, alarmType, timeoutSeconds) {
  const types = Array.isArray(alarmTypes.alarmTypes) ? alarmTypes.alarmTypes : [];
  const selectedType = types.find((type) => type.id === alarmType || type.key === alarmType || type.name.toLowerCase() === String(alarmType).toLowerCase());
  if (!selectedType) {
    return { confirmed: false, message: `Alarm Type ${alarmType} was not found.` };
  }
  const devices = Array.isArray(status.devices) ? status.devices : [];
  const target = devices.find((device) => !device.removedAt && device.enabled === true && device.alarmTypeStates?.[selectedType.id]?.enabled !== false);
  if (!target) {
    return { confirmed: false, message: `No enabled receiver can ring the ${selectedType.name} test alarm.` };
  }

  let alarmId;
  try {
    const created = await requestJson(baseUrl, "/api/alarms", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Quave Pager doctor test",
        body: "Delivery-health test. This alarm will stop automatically after confirmation.",
        alarmTypeId: selectedType.id,
        deviceId: target.deviceId,
        ttlSeconds: Math.max(60, timeoutSeconds + 30)
      })
    });
    alarmId = created.alarm?.id;
    if (!alarmId) {
      return { confirmed: false, message: "The API accepted the test without returning an alarm id." };
    }
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      await sleep(2000);
      const nextStatus = await requestJson(baseUrl, "/api/status", { headers });
      const ringing = (nextStatus.devices || []).find((device) => device.deviceId === target.deviceId)?.ringingAlarm;
      if (ringing?.alarmId === alarmId) {
        return { confirmed: true, alarmId, deviceId: target.deviceId, message: "The receiver reported that this test alarm is ringing." };
      }
    }
    return { confirmed: false, alarmId, deviceId: target.deviceId, message: `No ringing receipt arrived within ${timeoutSeconds} seconds.` };
  } finally {
    if (alarmId) {
      try {
        await requestJson(baseUrl, `/api/alarms/${encodeURIComponent(alarmId)}/cancel`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: "{}"
        });
      } catch {
        // The test result remains useful even if stopping the local ringer is
        // delayed; the server expiry is deliberately short as a final guard.
      }
    }
  }
}

async function requestJson(baseUrl, path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    fail(`Quave Pager doctor failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

function positiveNumber(value, fallback, flag) {
  if (value === undefined || value === true || value === "") {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    fail(`--${flag} must be a positive number.`);
  }
  return number;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
