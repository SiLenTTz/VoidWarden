/** BUG-0012: Ist ein Cue beim Broadcast-Zeitpunkt noch aktuell? */
export interface CueRef {
  event: "state_change" | "attention";
  state: string;
  approvalId?: string;
}

export interface NowRef {
  state: string;
  approvalId: string | null;
}

/**
 * state_change: aktuell, solange der Aggregatzustand noch derselbe ist.
 * attention: aktuell, solange genau diese Approval noch offen ist —
 * entschieden, abgelaufen oder abgelöst bedeutet veraltet.
 */
export function isCueCurrent(cue: CueRef, now: NowRef): boolean {
  if (cue.event === "attention") {
    return now.approvalId !== null && now.approvalId === cue.approvalId;
  }
  return now.state === cue.state;
}
