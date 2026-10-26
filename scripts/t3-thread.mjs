// T3 Code thread lookup and resume targets for AI conversation resume.
// T3 Code (https://t3.codes) hosts Claude Code, Codex, and Cursor sessions. Its desktop and
// Android apps both open t3code://threads/<environment-id>/<thread-id>.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function t3UserDataDir() {
  const home = (process.env.T3CODE_HOME || "").trim() || path.join(os.homedir(), ".t3");
  return path.join(home, "userdata");
}

export function readT3EnvironmentId() {
  try {
    return fs.readFileSync(path.join(t3UserDataDir(), "environment-id"), "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * Finds the T3 thread that hosts a native provider session (for example
 * $CLAUDE_CODE_SESSION_ID or $CODEX_THREAD_ID). Returns null outside T3.
 * Delegated child threads resolve to their root thread, which is the one in the user's list.
 */
export async function lookupT3Thread(sessionId) {
  if (!/^[A-Za-z0-9-]{8,128}$/.test(String(sessionId || ""))) return null;
  const dbPath = path.join(t3UserDataDir(), "statev2.sqlite");
  if (!fs.existsSync(dbPath)) return null;
  let db;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(dbPath, { readOnly: true, timeout: 2000 });
    const threadQuery = db.prepare(`
      select t.thread_id as threadId, t.title as title, p.title as projectTitle,
             json_extract(t.payload_json, '$.lineage.relationshipToParent') as relationship,
             json_extract(t.payload_json, '$.lineage.rootThreadId') as rootThreadId
      from orchestration_v2_projection_threads t
      left join projection_projects p on p.project_id = t.project_id
      where t.thread_id = ?`);
    const match = db.prepare(`
      select thread_id as threadId, coalesce(driver, provider) as driver
      from orchestration_v2_projection_provider_threads
      where json_extract(payload_json, '$.nativeThreadRef.nativeId') = ?
      order by updated_at desc limit 1`).get(sessionId);
    if (!match?.threadId) return null;
    const thread = threadQuery.get(match.threadId);
    if (!thread) return null;
    const isSubagent = thread.relationship === "subagent";
    const root = isSubagent && thread.rootThreadId ? threadQuery.get(thread.rootThreadId) : null;
    const target = root || thread;
    return {
      threadId: target.threadId,
      title: target.title,
      projectTitle: target.projectTitle && target.projectTitle !== "No project" ? target.projectTitle : "",
      environmentId: readT3EnvironmentId(),
      provider: providerForDriver(match.driver),
      isSubagent,
      childTitle: isSubagent ? thread.title : ""
    };
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch {}
  }
}

function providerForDriver(driver) {
  const value = String(driver || "").toLowerCase();
  if (value.startsWith("claude")) return "claude-code";
  if (value.startsWith("codex")) return "codex";
  if (value.startsWith("cursor")) return "cursor";
  return "other";
}

export function t3ResumeTargets(environmentId, threadId) {
  const ids = `${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
  return [
    {
      platforms: ["macos", "android"],
      kind: "deeplink",
      url: `t3code://threads/${ids}`,
      label: "Open in T3 Code"
    },
    {
      platforms: ["ios", "web"],
      kind: "url",
      url: `https://app.t3.codes/${ids}`,
      label: "Open in T3"
    }
  ];
}
