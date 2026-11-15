/**
 * Demo-Modus (EPIC-P13 T13.1 Schritt 5): `?demo=<display>` speist statt des
 * WebSockets einen festen Anzeigezustand in die Bühne — für Fotos,
 * Golden-Bilder (W15) und Geräteabnahme. Im Demo-Modus sendet der Client nie
 * `decide` (decideAllowed) — es gibt keinen echten Zustand zu entscheiden.
 */
import type { DisplayState, StageInput } from "./stage.ts";

export const DEMO_DISPLAYS: readonly DisplayState[] = [
  "ws_offline", "offline", "approval", "question", "error",
  "executing", "success", "listening", "idle", "asleep",
];

/** `?demo=<display>` aus location.search; unbekannt/abwesend → null. */
export function parseDemoDisplay(search: string): DisplayState | null {
  const raw = new URLSearchParams(search).get("demo");
  if (raw === null) return null;
  if (!(DEMO_DISPLAYS as readonly string[]).includes(raw)) {
    // Fail loud light: Tippfehler im Parameter nicht still als Live-Modus ausgeben
    console.error(`demo: unbekannter Anzeigezustand "${raw}" (erlaubt: ${DEMO_DISPLAYS.join(", ")})`);
    return null;
  }
  return raw as DisplayState;
}

const demoApproval = (kind: "approval" | "question"): StageInput["approval"] => ({
  action_id: "demo-0000",
  kind,
  agent_id: "demo-session",
  class: "write",
  payload: { title: "Paket installieren", body: "bash.exec · npm install" },
  timeout_s: 300,
  decidable: kind === "approval",
});

/** Fester StageInput je Anzeigezustand — stageView darauf muss genau diesen liefern. */
export function demoStageInput(display: DisplayState): StageInput {
  const base: StageInput = {
    wsOffline: false,
    decayed: false,
    frameState: "idle",
    hub: "up",
    approval: null,
    focus: null,
    sessions: { total: 2, working: 0, waiting: 0, error: 0 },
    hubDownSinceMs: null,
  };
  switch (display) {
    case "ws_offline":
      return { ...base, wsOffline: true, sessions: { total: 2, working: 1, waiting: 0, error: 0 } };
    case "offline":
      return { ...base, hub: "down", frameState: "offline", hubDownSinceMs: new Date(2026, 10, 12, 9, 5).getTime() };
    case "approval":
      return { ...base, approval: demoApproval("approval"), sessions: { total: 2, working: 0, waiting: 2, error: 0 } };
    case "question":
      return { ...base, approval: demoApproval("question"), sessions: { total: 2, working: 0, waiting: 1, error: 0 } };
    case "error":
      return { ...base, frameState: "error", sessions: { total: 2, working: 0, waiting: 0, error: 2 } };
    case "executing":
      return { ...base, frameState: "executing", sessions: { total: 2, working: 2, waiting: 0, error: 0 } };
    case "success":
      return { ...base, frameState: "success" };
    case "listening":
      return { ...base, frameState: "listening" };
    case "idle":
      return base;
    case "asleep":
      return { ...base, decayed: true };
  }
}

/** Im Demo-Modus wird nie entschieden (kein decide an den Companion). */
export function decideAllowed(demo: DisplayState | null): boolean {
  return demo === null;
}
