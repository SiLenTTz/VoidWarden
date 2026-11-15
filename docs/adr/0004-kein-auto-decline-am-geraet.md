# ADR-0004 — Kein Auto-Decline und kein Auto-Approve am Gerät

**Status:** akzeptiert · **Betrifft:** EPIC-P3, `docs/spec.md` §4.1, §7, §10;
löst einen Widerspruch der Init-Spezifikation (M3 „Auto-Decline-Timeout")

## Kontext

Die Init-Spec verlangt für M3 einen konfigurierbaren Auto-Decline-Timeout. Der
Hub hat bereits ein Ablaufmodell (`timeoutAt`, Status `timed_out`, ADR-0007). Ein
vom Gerät gesendetes `decline` bei Timeout würde im Audit eine *menschliche*
Ablehnung behaupten, die nie stattfand, und könnte mit dem Hub-Ablauf racen.

## Entscheidung

1. Das Gerät und der Companion senden **nie** eine Entscheidung ohne Touch.
2. `timeout_s` im Frame ist die **Restzeit** bis `timeoutAt`; Nyx zeigt einen
   Countdown. Bei Ablauf gewinnt der Hub: `action_result{timed_out}` räumt die
   Anfrage auf.
3. „Konfigurierbarer Timeout" bedeutet: Anzeige-Dauer/Warnschwelle (z. B. Amber
   → Rot bei < 20 s), nicht Entscheidung.
4. Idempotenz: höchstens ein `decide` je `action_id` (Dedupe-Log, W9).

## Konsequenzen

- Die Init-Datei führt diesen Punkt in ihrer Abweichungsliste.
- Test: kein `decide` ohne `action_response` (Property-Test, `testing.md` §2.5).
