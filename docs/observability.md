# Monitoring und Logging — verbindlich

Stand: 2026-11-02 · Orientiert an AncientVoid ADR-0010 (lokal, JSON-Lines,
kein Cloud-APM). Messlatten: [`spec.md` §9](spec.md).

## 1. Prinzipien

1. **Lokal first:** Logs und Zähler bleiben auf dem Rechner. Kein
   Prometheus/OTel, kein externer Dienst.
2. **Fail loud:** Jeder Fehlerpfad hinterlässt Log-Zeile **und** Zähler **und**
   (wo der Nutzer ihn sehen muss) einen Ticker-Eintrag auf Nyx.
3. **Nichts Sensibles:** Token, `Authorization`-Header und Payload-Texte
   (Titel/Body stammen aus Agent-Output und können Geheimnisse enthalten)
   stehen standardmäßig *nicht* im Log — nur Länge und SHA-256-Kurzhash.
   Volltext nur mit `VOIDWARDEN_LOG_PAYLOADS=1` (Debug, nie Default).
4. **Ein Kanal pro Zweck:** Auf dem Link läuft ausschließlich das Protokoll;
   Firmware-Logs reisen als `log`-Frames (§3), nicht als rohe `Serial.print`.

## 2. Companion-Logging

- Format: JSON-Lines nach stdout **und** `data/logs/companion.jsonl`
  (Rotation: 5 × 10 MB). Felder: `ts` (ISO-UTC), `level`
  (`debug|info|warn|error`), `component` (`hub|link|bridge|aggregate|cli`),
  `msg`, optionale Zusatzfelder; `child(fields)` für Kontext (`action_id`).
- Level-Steuerung: `VOIDWARDEN_LOG_LEVEL`, Default `info`.
- **Redaction** (gleiche Schlüsselliste wie AncientVoid ADR-0010):
  `authorization`, `token`, `cookie`, `password`, `secret`, `apiKey`, `api_key`.
  Pflicht-Test: Klartext-Token taucht nirgends auf.
- Pflicht-Ereignisse (Level): Start/Stop `info`; Link auf/zu `info`; Reconnect
  `warn`; Hub nicht erreichbar/wieder erreichbar `warn`/`info`; Protokollfehler
  `warn`; unbekannter Hub-Status `error`; jede Entscheidung (`action_id`,
  Entscheidung, Hub-Status, Latenz) `info` — das ist das lokale Audit; Dedupe-
  Treffer `info`.
- Entscheidungs-Audit zusätzlich in `data/decisions.jsonl` (append-only, ein
  Eintrag je `action_id`); dient auch als Dedupe-Wiederherstellung nach Neustart
  (K7-Pfad).

## 3. Firmware-Logging

- API `LOG(level, msg, fields)` schreibt in einen RAM-Ringpuffer (32 Einträge)
  und sendet daraus `log`-Frames, **rate-limitiert** (max. 5/s, Überschuss wird
  gezählt und als ein Sammel-Frame `dropped:N` gemeldet).
- Nie im Render- oder Touch-Pfad blockierend loggen.
- `hello` trägt `reset_reason` (Brownout/WDT/Panic) und `heap_free`; ein
  Reset-Grund ≠ Power-on erzeugt im Companion `warn`.
- Der Companion schreibt `log`-Frames mit `component:"firmware"` in dasselbe JSONL.

## 4. Monitoring (Zähler und Gesundheit)

Companion-Zähler (in-memory, Neustart → 0, spezifiziert): `frames_tx`,
`frames_rx`, `frames_dropped`, `parse_err`, `reconnects`, `hub_errors`,
`hub_polls`, `decisions_sent`, `decisions_deduped`, `decision_latency_ms`
(Histogramm → p50/p95), `hub_state` (`up|down`), `link_state`, `last_hello_ts`.

ESP32-Zähler (alle 30 s als `stats`): `fps`, `heap_free`, `heap_min`,
`uptime_s`, `rx_overrun`, `parse_err`.

Abfrage: `voidwarden status` (CLI über Unix-Socket im Runtime-Verzeichnis)
liefert Link-/Hub-Zustand, Zähler, letzte `stats`, Version von Companion und
Firmware als JSON. `voidwarden status --watch` für die Beobachtung.
Kein HTTP-Listener (kein eingehender Port). Der CLI sucht den Socket im
Runtime-Verzeichnis des jeweiligen Ausführe-Klons: aus dem Betrieb-Klon
(`~/.local/share/voidwarden`) funktioniert er direkt, aus einem anderen
Checkout nur mit `VOIDWARDEN_SOCK` (der Dienst setzt `%t/voidwarden.sock`,
siehe `docs/operations.md` §3) — sonst meldet er „läuft nicht“, obwohl der
Dienst läuft.

**Schwellen (warnen, nicht abstürzen):**

| Signal | Warn-Schwelle | Aktion |
|---|---|---|
| `heap_min` | < 20 KB | `warn` + Ticker „Speicher knapp" |
| `fps` (Renderkapazität) | < 25 über zwei aufeinanderfolgende 5-s-Fenster mit ≥ 3 gezeichneten Bildern | `warn` `fps_unter_25` (W3, Firmware-Log) |
| Frame-Dauer | > 80 ms im Fenster | `warn` `frame_ueber_80ms` (W3, Firmware-Log, einmal je Fenster) |
| `rx_overrun` | > 0 | `error` (W2) |
| `decision_latency_ms` p95 | > 500 | `warn` (W1) |
| `reconnects` | > 5 / 10 min | `warn` „Link instabil" |
| Companion-CPU | > 15 % über 60 s | `warn` (W7) |

## 5. Messläufe (Beleg für W-Nummern)

Skripte `scripts/messlauf-<thema>.mjs` schreiben ihr Ergebnis nach
`docs/messlauf/`. Pflichtläufe pro Epic stehen im jeweiligen Epic-AC. Mindest-
menge: `latency` (W1/W2, n ≥ 20), `recovery` (W5/W6: ESP-Reset, Companion-Kill,
Hub-Restart, jeweils 5 Läufe), `soak` (W8, 24 h, `stats` im Minutentakt),
`resources` (W7). Jeder Lauf nennt Board-Typ, Commit und „Was das nicht sagt".

## 6. Diagnose-Reihenfolge (Runbook-Kern)

1. `voidwarden status` — Link up? Hub up? letzte `hello`?
2. `data/logs/companion.jsonl` nach `level>=warn` filtern.
3. Letzte `stats`/`log`-Frames der Firmware (`component:"firmware"`).
4. Sim gegen Companion reproduzieren (`npm run sim`), erst dann am Board.
5. Erkenntnis → Skill `bug-report` (`bugs/bug-NNNN-slug.md`) mit Log-Ausschnitt
   (redigiert) und Testlücke.
