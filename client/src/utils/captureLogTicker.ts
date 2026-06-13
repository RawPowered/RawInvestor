/** Strip ISO timestamp + level from rawengine-capture.log lines for compact HUD display. */

const LINE_RE = /^\[[^\]]+\]\s+\[(?:info|warn|error|debug)\]\s+(.+)$/i;

export function simplifyCaptureLogLine(line: string, maxLen = 220): string {
  const t = line.trim();
  if (!t) return '';
  const m = t.match(LINE_RE);
  const body = (m ? m[1] : t).trim();
  if (body.length <= maxLen) return body;
  return `${body.slice(0, maxLen - 1)}…`;
}

export function tailTextToHudLines(tail: string, maxLines = 10): string[] {
  const lines = tail
    .split(/\r?\n/)
    .map((s) => simplifyCaptureLogLine(s))
    .filter((s) => s.length > 0);
  return lines.slice(-maxLines);
}
