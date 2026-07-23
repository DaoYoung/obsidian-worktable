/**
 * Regression: an orphaned pomodoro ticker must not record phantom sessions.
 *
 * Root cause history: WorktableView.render() emptied the container but never
 * unloaded widgetComponent, so a re-render/remount left the previous
 * instance's 1s ticker alive. That leaked ticker kept running against
 * detached DOM and, on expiry, wrote a session — producing two closely-timed
 * "专注" records where the user only ran one.
 *
 * The widget-side guard added to tick():
 *   if (!wrap.isConnected) { stopTicker(); return; }
 * self-terminates a detached instance before the expiry check. These tests
 * mirror that guard (the widget's tick() is a closure and can't be imported
 * directly, matching the mirror-style convention of the other pomodoro tests).
 */

import { describe, it, expect } from "vitest";

interface TickEnv {
  running: boolean;
  finishing: boolean;
  connected: boolean;
  endsAt: number | null;
}

/** Mirror of PomodoroWidget.tick() control flow. Returns what the tick did. */
function tick(env: TickEnv, now: number): {
  stopped: boolean;
  finished: boolean;
} {
  let stopped = false;
  let finished = false;
  if (!env.running || env.finishing) return { stopped, finished };
  // The orphan guard runs BEFORE the expiry check.
  if (!env.connected) {
    stopped = true; // stopTicker()
    return { stopped, finished };
  }
  if (env.endsAt == null) {
    env.running = false;
    return { stopped, finished };
  }
  const remaining = Math.max(0, Math.round((env.endsAt - now) / 1000));
  if (remaining <= 0) {
    finished = true; // finish() → records a session
    return { stopped, finished };
  }
  return { stopped, finished };
}

describe("pomodoro orphaned ticker guard", () => {
  it("connected + running + expired → finishes (records a session)", () => {
    const now = 1_000_000;
    const r = tick(
      { running: true, finishing: false, connected: true, endsAt: now - 1 },
      now,
    );
    expect(r.finished).toBe(true);
    expect(r.stopped).toBe(false);
  });

  it("detached (disconnected) + expired → stops, never finishes/records", () => {
    const now = 1_000_000;
    const r = tick(
      { running: true, finishing: false, connected: false, endsAt: now - 1 },
      now,
    );
    expect(r.finished).toBe(false);
    expect(r.stopped).toBe(true);
  });

  it("detached but not yet expired → still stops rather than ticking on", () => {
    const now = 1_000_000;
    const r = tick(
      { running: true, finishing: false, connected: false, endsAt: now + 60_000 },
      now,
    );
    expect(r.finished).toBe(false);
    expect(r.stopped).toBe(true);
  });

  it("connected but not running → no-op", () => {
    const now = 1_000_000;
    const r = tick(
      { running: false, finishing: false, connected: true, endsAt: now - 1 },
      now,
    );
    expect(r.finished).toBe(false);
    expect(r.stopped).toBe(false);
  });
});
