# ADR-0010 — Projektname als Session-Name, letzte Agent-Nachricht im Ticker und Tap-Status

**Status:** akzeptiert (2026-11-06, Projektinhaber) · **Betrifft:** `companion/`, `docs/spec.md` §7 ·
**Ändert:** ADR-0008 §6 (Anzeigename), ADR-0008 „nie `detail`/Agent-Text" für die fokussierte Session ·
**Protokoll:** unverändert (`notification`, `session_focus.name`, `bubble`)

## Kontext

Der Alias „claude 4a19b9" sagt nicht, woran die Session arbeitet, und im Leerlauf zeigte Nyx
nur „idle". Gewünscht: links oben der Projektname, unter Nyx dauerhaft die letzte Nachricht
des Agenten (durchlaufend), beim Tap dieselbe Nachricht in der Blase.

## Entscheidung

1. **Name = Verzeichnisname von `project`** (Hub-Session-Feld), bereinigt, ≤ 16 Zeichen. Fehlt er,
   gelten die Regeln aus ADR-0008 §6 (manueller Titel, sonst Adapter + Kurz-ID). Der Prompt-Auszug
   (`auto`/`ai`-Titel) bleibt tabu.
2. **Letzte Nachricht** = `summary` des jüngsten `assistant`-Events der **fokussierten** Session
   (`GET /api/sessions/:id/events?afterSeq=lastSeq-60&limit=60`, nur bei neuer `lastSeq`, höchstens
   ein Abruf zugleich). Sie ist **Anzeige-Text** (ADR-0004): bereinigt (`sanitizeText`, Markdown-Zeichen
   entfernt), ≤ 160 Zeichen, kein Pfad zu einer Aktion.
3. **Ticker:** der Companion sendet sie als `notification` (Titel = Name, Body = Text); die Firmware
   scrollt Zeilen über 53 Spalten bereits. Hub-Notifications der Stufe `info`/`success` verdrängen sie
   nicht, solange eine Nachricht angezeigt wird; `warning`/`error` laufen wie bisher durch.
4. **Tap-Status** hängt „Zuletzt: …" an den Kerntext (Body ≤ 160, Haltezeit 14 s statt 8 s).
5. Schlägt der Abruf fehl, bleibt der alte Text stehen und `hub:last_message_error` wird geloggt
   (fail loud); K7: nach Neustart holt der nächste Poll die Nachricht erneut.

## Folgen

- Ein zusätzlicher kleiner Hub-Request pro Poll nur bei neuem Event der fokussierten Session.
- Ein manipulierter Agent kann Text auf dem Display platzieren, aber nichts auslösen (W9 unberührt).
