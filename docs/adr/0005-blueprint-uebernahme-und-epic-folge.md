# ADR-0005 — Blueprint-Übernahme: ESP32 bleibt Plattform, Hub bleibt Wahrheit

**Status:** akzeptiert (2026-11-04) · **Betrifft:** `docs/spec.md`, `docs/architecture.md`,
`epics/README.md`, EPIC-P2 bis EPIC-P12 · **Abgleich:**
[`blueprint-traceability.md`](../blueprint-traceability.md)

## Kontext

Der „VoidWarden Technical Blueprint" (Stand 2026-11-03) beschreibt das gewünschte
Produkt: Mehr-Agenten-Überblick, ausdrucksstarke Nyx, Sprechblasen, Touch-UI,
lokale Sprachausgabe. Er setzt dafür einen eigenen Stack voraus: React/PixiJS im
Kiosk-Browser auf einem Raspberry Pi, Fastify-Backend mit eigener
Event-Ingestion, WebSocket, SQLite-Journal und eigenen Agent-Adaptern. Er nennt
seine Technikwahl selbst „Architekturvorschläge, keine gemessenen Benchmarks" und
listet Display, Host und ersten Event-Producer als offen.

Dieses Repo hat diese Fragen beantwortet: ESP32-Board am USB (P0, BUG-0001),
Node-Companion als reiner Hub-Client (P1), `write`-Freigaben per Touch (P3),
Regel „kein Browser, kein Pi" (`spec.md` §2) und „kein zweiter Hub" (§1).

## Entscheidung

1. **Der Blueprint liefert das Was, das Repo das Wie.** Funktionen, UI-Elemente,
   Animationen, Texte, TTS-Regeln und Akzeptanzgeschichten werden übernommen und
   einem Epic zugeordnet. Stack-Vorgaben nicht: kein React, Vite, PixiJS, Kiosk,
   Raspberry Pi; kein Fastify, kein eingehender Port, kein WebSocket-Server, kein
   SQLite-Journal, kein pnpm.
2. **Kein eigener Event-Vertrag, keine Ingestion, keine Agent-Adapter.** Der
   Blueprint-Event-Vertrag (`POST /api/v1/events`, Taxonomie `build.*`, `agent.*`)
   entfällt. „Agent" heißt hier **Hub-Session**. Datenquellen bleiben
   `GET /api/sessions`, `/api/approvals`, `/api/notifications`. Fehlt dem Hub ein
   Signal, wird es **nicht erfunden**, sondern fehlt sichtbar oder wird als
   AncientVoid-Abhängigkeit (AV-D*) benannt. Hermes-, CI- und Git-Anbindungen
   gehören als Adapter nach AncientVoid.
3. **Blueprint-API wird auf den Link abgebildet.** `status-speak`, `stop-speech`
   und `settings` werden zu `ui_action`-Frames (ADR-0007) und CLI-Kommandos im
   Companion; `snapshot`, `stream` und `speech.*` zu Link-Frames.
4. **Bei Widerspruch gilt weiter ADR > Spec > Epic.** Der Blueprint steht wie
   `VOIDWARDEN_init.md` darunter. Jeder Widerspruch ist mit Auflösung in
   `blueprint-traceability.md` §4 festgehalten.
5. **Nicht-Ziele bleiben.** `spec.md` §1 wird nicht gelockert. Dazu kommen die
   WON'T-Punkte des Blueprints (Mikrofon, SSH/Terminal, LLM-Pflicht). Neu im Zweck
   ist allein die **lokale Sprachausgabe** (ADR-0008); sie berührt kein bisheriges
   Nicht-Ziel und wird ausdrücklich, nicht nebenbei, aufgenommen.
6. **Epic-Folge.** P0–P4 behalten ihre Nummern. Neu sind P5 (Nyx-Atlas), P6
   (UI-Shell + Touch), P7 (Agenten-Überblick), P8 (Sprechblasen), P9 (TTS), P10
   (Persönlichkeit), P11 (Betrieb + Release). Das bisherige P5 „Erweiterbarkeit"
   wird **P12**: Es stammt aus dem Init-Plan, nicht aus dem Blueprint, und soll
   nicht vor dem Blueprint-Produkt laufen. Idle-Life wandert aus P4 nach P5, weil
   es Clips des neuen Atlas braucht und sonst doppelt gebaut würde.

## Konsequenzen

- Der Blueprint-Wunsch „Testbar ohne Display dank Browser-Demo" wird durch
  Host-Preview, Sim und Golden-Bilder erfüllt (T6.2), nicht durch einen Browser.
- Der Blueprint nennt 3,5"/480×320; das angeschlossene Board ist 2,8"/320×240
  (BUG-0001). Der Inhaber hat am 2026-11-04 entschieden: zuerst 2,8", später
  skalier- und umstellbar. Das sichern Display-Profile ab (ADR-0007 §2, T6.12).
- Die Grenzen aus `AGENTS.md` (Hub-Isolation, Least Privilege, K5/K7, Fail loud,
  Prompt-Injection-Grenze) gelten für alle neuen Epics unverändert.

## Verworfen

- **Pi + Kiosk als zweite Plattform:** bessere Grafik, aber zweiter Stack, zweiter
  Betrieb und Verzicht auf die belegte P0–P3-Arbeit. Erst per neuem ADR, wenn eine
  Messung zeigt, dass der ESP32 den Blueprint nicht tragen kann.
- **Blueprint-Epics hinter P5 hängen:** wahrt die Nummern, zöge aber optionale
  Partikel-Layer vor das eigentliche Produkt.
