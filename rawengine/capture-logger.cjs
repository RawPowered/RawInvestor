const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");

const captureLogBus = new EventEmitter();
const MAX_BYTES = 6 * 1024 * 1024;

function getLogsDir() {
  const { app } = require("electron");
  return path.join(app.getPath("userData"), "logs");
}

function getCaptureLogPath() {
  return path.join(getLogsDir(), "rawengine-capture.log");
}

function ensureLogsDir() {
  try {
    fs.mkdirSync(getLogsDir(), { recursive: true });
  } catch {
    /* ignore */
  }
}

function rotateIfNeeded(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const st = fs.statSync(filePath);
    if (st.size < MAX_BYTES) return;
    const bak = `${filePath}.1`;
    if (fs.existsSync(bak)) fs.unlinkSync(bak);
    fs.renameSync(filePath, bak);
  } catch {
    /* ignore */
  }
}

/**
 * @param {{ level?: string, scope?: string, message: string, detail?: unknown }} entry
 */
function appendCaptureLog(entry) {
  const ts = new Date().toISOString();
  const scope = String(entry.scope || "capture");
  const level = String(entry.level || "info");
  const msg = String(entry.message || "");
  let extra = "";
  if (entry.detail != null) {
    extra =
      typeof entry.detail === "string"
        ? ` ${entry.detail}`
        : ` ${JSON.stringify(entry.detail)}`;
  }
  const line = `[${ts}] [${level}] [${scope}] ${msg}${extra}\n`;

  try {
    ensureLogsDir();
    const p = getCaptureLogPath();
    rotateIfNeeded(p);
    fs.appendFileSync(p, line, "utf8");
  } catch (err) {
    console.error("[rawengine-capture-log]", err);
  }

  captureLogBus.emit("line", {
    text: line.trimEnd(),
    ts,
    level,
    scope,
    message: msg,
    detail: entry.detail,
  });
}

function readTailLines(n = 200) {
  const p = getCaptureLogPath();
  try {
    const raw = fs.readFileSync(p, "utf8");
    const lines = raw.split(/\r?\n/).filter((x) => x.length > 0);
    return lines.slice(-Math.max(1, Number(n) || 200)).join("\n");
  } catch {
    return "";
  }
}

module.exports = {
  appendCaptureLog,
  captureLogBus,
  getCaptureLogPath,
  readTailLines,
};
