# ADR-0009 — Interaktive, session-bewusste Nyx: Fokus, Tap-Status, Idle-Chatter, Fragen

**Status:** akzeptiert (2026-11-05, Projektinhaber: Vorziehen aus P7/P8/P3, host-first) ·
**Betrifft:** `protocol/`, `companion/`, `firmware/`, `docs/spec.md` §4/§7/§11,
EPIC-P3, P7, P8 · **Erweitert:** ADR-0007, ADR-0008 (ändert beide nicht)

## Kontext

Nyx zeigt bisher einen Gesamtzustand plus Ticker. Gewünscht sind vier Dinge: Blasen mit
getipptem Text (Typewriter), gelegentliche Selbstäußerungen (Idle-Chatter), Tap auf Nyx
zeigt den Status der aktuellen Session, und bei mehreren Sessions ein Wechsel mit
Auto-Fokus nach Priorität. Alles liegt außerhalb des aktiven Epics P2 und gehört zu P3
(Fragen), P7 (Fokus), P8 (Blase, Tap). Der Inhaber hat das Vorziehen entschieden.

## Entscheidung

1. **Fokus liegt im Companion** (`focus.ts`, pure, Uhr injiziert). Priorität, höchste
   zuerst: wartet auf Mensch (Freigabe oder Frage) > Fehler > arbeitet > idle > Rest
   (`parked`, `stopped`, `interrupted`). Innerhalb einer Stufe gewinnt die Session mit der
   kürzesten Restzeit der Freigabe, sonst die frühere Listenposition (stabil, kein Zufall).
   Das ist `aggregate()` (spec §5.1) in Session-Form; der Gesamtzustand ändert sich nicht.
2. **Manueller Wechsel hat eine Rückfallzeit** (`ui.focusHoldS`, Default 30 s). Danach gilt
   wieder der Auto-Fokus. Eine **neue** Freigabe oder Frage in einer anderen Session löst
   die Fixierung sofort (Dringendes schlägt Manuelles). Verschwindet die fixierte Session,
   fällt der Fokus zurück.
3. **Freigaben bleiben modal und fokus-unabhängig.** Der Fokus bestimmt nur, welche
   Session Tap-Status und Indikator zeigen. Die Freigabe-Zonen zeigen weiter die
   kürzeste-Restzeit-Freigabe aller Sessions (spec §5.1) und überdecken Blasen und Indikator.
4. **Fragen (`tool` in `QUESTION_TOOLS` aus contracts) sind nur Anzeige.** Der Hub lehnt
   sie am Display mit 403 ab (ADR-0001). Der Companion setzt für sie `decidable=false` und
   `kind:"question"`; die Firmware zeigt Text und Hinweis „am Rechner beantworten", keine
   Zonen. *Bisher falsch:* Eine Frage der Klasse `write` galt als entscheidbar (Fix in
   eigenem Commit).
   *Für den Web-Kiosk fortgeschrieben durch ADR-0012 (Optionsfragen beantwortbar).*
5. **Tap auf Nyx** sendet `ui_action{status_tap}`. Der Companion antwortet mit einer
   `bubble` (info, Vorlage aus Hub-Zählern der fokussierten Session, Titel ≤ 40, Body ≤ 160 =
   2×80). Sofortiges lokales Feedback (≤ 100 ms) macht die Firmware vorab. Im
   Freigabe-Screen hat der Tap keine Wirkung.
6. **Session-Wechsel per Tap auf den Indikator** (kleine Zählerleiste „2/3"), nicht per
   Swipe (ADR-0007 „Swipe verworfen"). Sendet `ui_action{focus_next}`; der Companion
   antwortet mit `session_focus`.
7. **Idle-Chatter ist eine lokale Phrasenliste im Companion** (`chatter.ts`, DE), nie
   Agent-Text. Mindestabstand 90 s plus gleichverteilter Jitter 0–60 s (W12: höchstens 1 je
   60 s), Zufall und Uhr injiziert. Läuft nur im Zustand `idle`, nie bei offener
   Freigabe/Frage, nie über einer aktiven oder wartenden Blase. Chatter ist `info` und geht
   durch `BubblePolicy` (Dedupe, Rate-Limit). Er löst nie eine Aktion aus (ADR-0004).
8. **Typewriter ist reine Firmware-Darstellung** ohne Protokollfeld: sichtbare Zeichenzahl
   = f(Zeit seit Erscheinen), bei `reducedMotion`/kritisch sofort voll. Der Frame trägt den
   vollen Text; die Firmware hält keinen Zustand, der nicht aus Frames kommt (K7).

## Neue und geänderte Frames (additiv, `v:1`; je Schema + Fixtures + beide Parser)

| Richtung | `type` | Felder (Grenzen) |
|---|---|---|
| ESP→PC | `ui_action` | `action` ∈ `status_tap`, `focus_next`, `bubble_ack`; optional `ref` (≤ 36: Session-Kurz-ID bzw. `bubble_id`), `ms` (kein `seq`, wie alle ESP→PC-Frames). **Kein** `decision`/`action_id`; `additionalProperties:false` (ADR-0007 §4) |
| PC→ESP | `session_focus` | `seq`, `idx` (1-basiert), `total`, `ref` (≤ 8), `name` (≤ 16), `status` ∈ `approval`, `question`, `error`, `working`, `idle`, `other` |
| PC→ESP | `action_request` | additiv `kind` ∈ `approval` (Default), `question` |

Recovery (K7): Nach `hello`/`resync` sendet der Companion `snapshot`, dann `session_focus`.
Die Firmware speichert weder Liste noch Fokus. Session-Name nach ADR-0008 §6: Adapter + Kurz-ID,
bei `titleSource=manual` der bereinigte Titel; nie ein Prompt-Auszug (`auto`/`ai`) oder Aktivitätstext.

## Messlatten

W11 (Feedback ≤ 100 ms, Tap → Blase p95 ≤ 1 s, 0 `decide` aus `ui_action`), W12
(Chatter-Abstand, Dedupe, kritisch nie verdeckt), W10 (Statustext nur aus Hub-Zahlen), W9
(Fragen nie entscheidbar), W4/W5 (Frames ≤ 512 B, Fokus nach Reset rekonstruiert).

## Konsequenzen

- Keine neue Laufzeitabhängigkeit (ADR-0003 unverändert).
- `ui_action` ist von `action_response` getrennt: eigener Handler, der `DecideClient`
  nicht kennt (Test).
- Nicht belegt, bis `test:hub` mit `display:`-Token läuft (AV-V2, T7.1): ob der Hub
  Fragen in `/api/approvals?status=pending` an den Display-Akteur liefert. Der Companion
  erkennt sie anhand `tool`; fehlt das Signal, erscheint die Frage als normale Freigabe
  mit `decidable` aus der Klasse.

## Verworfen

- **Swipe zum Wechseln:** braucht Gestenerkennung und eine Änderung an ADR-0007.
- **Fokus im Gerät:** verletzt K7 (Firmware hält keinen Wahrheitszustand).
- **Chatter aus Agent-Text oder LLM:** Prompt-Injection-Grenze (PRD §8.5, ADR-0008).
- **Auto-Fokus verdeckt Freigabe nie, daher kein „Fokus folgt Freigabe" im Modal:** Das
  Modal zeigt immer die dringendste Freigabe unabhängig vom Fokus.
