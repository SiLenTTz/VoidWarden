# Architektur und Technologie-Regeln

Stand: 2026-11-04 · Fachliche Festlegungen: [`spec.md`](spec.md). Entscheidungen:
[`adr/`](adr/). Diese Datei beschreibt die **Ziel-Struktur** und die
verbindlichen Technologie-Regeln. Solange ein Verzeichnis noch nicht existiert,
steht in der Spalte „Entsteht in" das Epic, das es anlegt — nichts hier ist
bereits umgesetzt, bevor das Epic abgeschlossen ist.

## 1. Komponenten

| Komponente | Pfad | Entsteht in | Sprache/Runtime |
|---|---|---|---|
| Protokoll-Verträge | `protocol/` | EPIC-P0 | JSON-Schema + goldene NDJSON-Fixtures |
| Companion-Service | `companion/` (`@voidwarden/companion`) | EPIC-P1 | Node ≥ 22.5, ESM, TypeScript strict (strip-types) |
| Serial-Simulator (Fake-ESP32) | `companion/src/sim/` | EPIC-P1 | wie Companion |
| Firmware | `firmware/` | EPIC-P2 | C++17, Arduino auf PlatformIO |
| Asset-Pipeline | `tools/assets/` | EPIC-P2 | Node (Skript) |
| Assets (Quell-PNGs) | `assets/` | EPIC-P2 | PNG |
| Atlas-Quelle und Referenzbilder | `assets/nyx/`, `assets/reference/` | EPIC-P5 | Aseprite + Export; Referenzen nie Pipeline-Eingabe |
| Host-Preview, Golden-Bilder | `tools/preview/`, `firmware/test/golden/` | EPIC-P6 | Native-Renderer → PNG |
| UI-Module Firmware | `firmware/src/ui/` (Screens, Layout, Text, Gesten) | EPIC-P6 | C++17, hostfähig ohne `Arduino.h` |
| Agenten-Projektion, Composer | `companion/src/{agents,composer,messages,settings}.ts` | EPIC-P6–P8 | pure Funktionen + dünner Zustand |
| Sprachausgabe | `companion/src/speech/` | EPIC-P9 | `Speaker`-Interface, externer Prozess |

Abhängigkeitsrichtung:

```
protocol/  ←  companion/   (importiert Schemas/Typen)
protocol/  ←  firmware/    (Fixtures als native Tests; Header-Konstanten generiert)
companion/ →  AncientVoid-Hub  (nur HTTP, nie Hub-Interna)
```

Regeln:
1. **Contracts first.** Alles, was Companion und Firmware teilen, steht in
   `protocol/`. Eine Änderung am Link-Protokoll braucht ein ADR und einen
   `v`-Bump bei Inkompatibilität (additive Felder: kein Bump, Firmware ignoriert
   und **zählt** Unbekanntes).
2. **Der Companion kennt den Hub nur über dessen öffentliche HTTP-API** und
   darf aus AncientVoid ausschließlich `@ancientvoid/contracts` importieren
   (Typen/Schemas, z. B. `ApprovalRequest`, `SessionStatus`,
   `DecideApprovalInput`). Keine Imports aus `@ancientvoid/core`/`hub`, kein
   Zugriff auf `data/`, SQLite oder JSONL des Hubs.
3. **Eine Aggregationsfunktion, rein:** `aggregate(hubState) → displayState`
   ist eine pure Funktion ohne I/O (testbar per Tabelle, §3 `testing.md`).
4. **Firmware ist zustandslos bezüglich der Wahrheit** (K7): alles Dauerhafte
   kommt per `snapshot`. Lokal gehalten werden nur Anzeige-Zustand,
   Idle-Randomizer, Konfig (NVS) und Ringpuffer für Logs.
5. **Transport austauschbar:** Der Companion spricht über das Interface
   `Link` (`open/read/write/close`). Implementierungen: `SerialLink`
   (Produktion), `PtyLink`/`MemoryLink` (Tests/Sim). Kein Code außerhalb
   von `link/` kennt `serialport`.

## 2. Technologie-Regeln

### Companion (Node)
- Node ≥ 22.5, ESM, TypeScript strict, **kein Build-Schritt** (Node
  strip-types): keine Parameter-Properties, keine Enums, keine Namespaces;
  Imports mit `.ts`-Endung, `import type` wo möglich. (Gleiche Regeln wie
  AncientVoid, damit Contracts-Typen direkt importierbar sind.)
- npm workspaces; Pakete `@voidwarden/<name>`.
- Zeitstempel ISO-8601 UTC; IDs `crypto.randomUUID()` (Approval-IDs kommen vom Hub).
- Persistenz nur Dateien unter `data/` (git-ignored): JSONL (Logs, Dedupe-Log).
  Keine Datenbank – `node:sqlite` erst mit eigenem ADR.
- Abhängigkeiten minimal: Laufzeit nur `serialport` (einzige native Abhängigkeit,
  begründet in ADR-0003) und `zod` (Schema-Validierung, wie AncientVoid
  Contracts). Neue Laufzeit-Abhängigkeit = ADR-Zeile. HTTP über `fetch`
  (global), Tests über `node:test`.
- Netz: nur der konfigurierte Hub (loopback/Tailnet). Kein Telemetrie-Egress.

### Firmware (ESP32)
- PlatformIO, Arduino-Framework, C++17, **ein** Build-Env `esp32` plus ein
  `native`-Env für Hosttests (Unity). Bibliotheks-Versionen gepinnt in
  `platformio.ini` (exakte Versionen, keine `^`).
- Grafik: direkt über LovyanGFX oder TFT_eSPI mit Sprite-/Dirty-Rect-Rendering;
  **kein LVGL im MVP** (RAM/Flash-Budget, kein Widget-Bedarf; Wiedervorlage nur
  per ADR bei nachgewiesenem Bedarf).
- Trennung: `protocol` (Parser/Encoder, hostfähig), `state` (Zustandsmaschine,
  hostfähig, keine Hardware-Includes), `render`, `touch`, `hal` (alles
  Hardware). Nur `hal` und `render` dürfen `Arduino.h`/Treiber includen —
  alles andere läuft im `native`-Test.
- Keine dynamische Allokation im Frame-Loop; JSON-Parsing mit fester
  Puffergröße (512 B + Terminator). Überlauf = `parse_err++` + `log`.
- Flash: LittleFS-Image aus `tools/assets`, nicht eingecheckt.

### Gemeinsam
- Code/Schema/Logs Englisch, UI-Texte Deutsch, Doku Deutsch.
- Kommentare sparsam, „Warum" statt „Was".
- Keine Secrets in Commits; `voidwarden.config.json` und `data/` git-ignored.
- Kein TODO ohne Epic-Referenz.

## 3. AncientVoid-Integration (Ist-Stand der Gegenseite, verifiziert 2026-11-02)

| Bedarf | Hub-Oberfläche (heute vorhanden) | Hinweis |
|---|---|---|
| Session-Zustände | `GET /api/sessions` (`SessionStatus`) | Poll; kein globaler Bus |
| Offene Freigaben | `GET /api/approvals`, `GET /api/approvals/:id` | `ApprovalRequest` mit `class`, `status`, `timeoutAt`, `reasonRequired`, `summary` |
| Entscheidung | `POST /api/approvals/:id/decide` `{decision:"approve"\|"reject", reason?}` | Policy `approvals.decide`: nur `human`/`fleet` = allow; `agent`, `companion` = deny (ADR-0021) |
| Hinweise | `GET /api/notifications` (`HubNotification`) | Ticker-Quelle |
| Gesundheit | `GET /api/health` (offen), `GET /api/ready` | Hub-Erreichbarkeit |
| Detail-Tail | `WS /api/events/:id/tail` | nicht im MVP; Poll genügt für W2 |
| Auth | `Authorization: Bearer <device-token>`; Label bestimmt Akteur | Token via `hubctl token issue <label>` |

**Display-Akteur (AV-D1, umgesetzt in AncientVoid ADR-0048, MR !290 — Merge steht
aus):** Token-Label `display:<name>` (`hubctl token issue <name> --display`).
Erreichbar sind nur `GET` auf `/api/health`, `/api/ready`, `/api/notifications`,
`/api/sessions`(`/:id`), `/api/approvals`(`/:id`) und `POST /api/approvals/:id/decide`
(nur Klasse `write`, ohne `reasonRequired`, keine `tool.question`; sonst 403).
Nicht erreichbar: Session-Events/WS-Tail, Loop- und Factory-Routen, WebAuthn.
Bis zum Merge: Lese-Betrieb mit `agent:voidwarden`; ADR-0001.

**Verifiziert in EPIC-P1 T1.1 (2026-11-03, live am Hub 127.0.0.1:7373):**
`agent:voidwarden` liest alle GET-Routen (200, auch `/api/sessions/:id`,
`/api/approvals/:id`); `GET /api/approvals` trennt offene von entschiedenen
per `?status=pending` (Default: alle); `decide` mit agent-Token → 403, auch bei
unbekannter ID (Policy vor Existenz); Zeitstempel ISO-8601 UTC mit Millisekunden.
Details: `spec.md` §4.5. Offen für P3: 409-Codes mit `display:<name>` (AV-D1).

**Für den Agenten-Überblick (Code-Lesung 2026-11-04, live belegt erst T7.1):**
`SessionRecord` trägt `status`, `updatedAt`, `adapter`, `project`, `title`,
`titleSource`, `lastActivity{text,type,at}`, `archived`, `parentSessionId`;
`lastActivity.type` ∈ `assistant`, `user`, `tool_use`, `gate`, `error`, `system`.
`HubNotification` trägt `id`, `sessionId`, `level`, `title`, `detail`, `kind`,
`createdAt`. **Nicht vorhanden:** Phasen-Enum, Fortschritt in Prozent,
Run-/Task-IDs in der Session, `build.*`-/`tests.*`-Events. `title` und
`lastActivity.text` können Prompt- oder Agent-Text enthalten; deshalb gelten ADR-0008
§6 und die Namensregel in T7.2. Der Display-Akteur darf keine Session-Events lesen
(AncientVoid ADR-0048). Reicht das für `activity` nicht, wird daraus AV-D2, kein Workaround.

**Quellen-Verifikation EPIC-P10 T10.1 (live am Hub 127.0.0.1:7373, 2026-11-06,
`display:web-1`-Klasse Token via data/display-token.txt):**

| Frage | Ergebnis | Beleg |
|---|---|---|
| (a) letzte Assistant-Nachricht je Session | **Companion-Aggregation** (kein AV-Change nötig) | `display:` auf `GET /api/sessions/:id/events` → 403 „display token not allowed here"; der Companion liest die Events mit dem read-only `agent:voidwarden` (`hub.lastAssistantMessage`, letzte 60 Events, jüngstes `type==="assistant"` mit nicht-leerem `summary`) und exportiert sie als `session.lastAssistantMessage` im WS-Stream (T10.3). Dasselbe Zwei-Token-Muster wie P1/P3: reads=agent, decide=display. |
| (b) letzter Aktivitäts-Zeitstempel | **ja** | `GET /api/sessions` unter `display:` → 200; `SessionRecord.updatedAt` + `lastActivity.at` (beide ISO-8601 UTC). |
| (c) Aufmerksamkeits-Status | **ja** | `GET /api/sessions` (Session-Status), `GET /api/approvals` und `GET /api/notifications` unter `display:` → 200. Aufmerksamkeit = Session-Status + wartende Freigaben + Notification-Level (T10.1-Definition, Umsetzung im Companion-Export). |
| (d) Frage-Antwort-HITL | **eingeschränkt** | `POST /api/approvals/:id/decide` unter `display:`: `write` ohne `reasonRequired` erlaubt; `destructive`, `reasonRequired` und `tool.question` → 403 „Nicht am Display entscheidbar" (ADR-0048, approvals.routes.ts:63). **Epic-Notiz:** Fragen (AskUserQuestion) sind im Web-Client nur lesbar; der 403-Text des Hubs wird unverändert angezeigt (fail loud), kein Client-Workaround. |

Konsequenz für T10.3: der Companion-WS-Export nutzt für den Datenstrom das
read-only `agent:voidwarden`-Token (wie P1) und für den Decide-Proxy das
`display:web-1`-Token (wie P3); das Link-Protokoll bleibt unangetastet.

## 4. Fehler- und Ausfallmodell

| Ausfall | Erkennung | Verhalten |
|---|---|---|
| USB getrennt / ESP reset | Serial-Close, kein `stats`/`hello` | Companion: Reconnect mit Backoff (250 ms → 5 s, Jitter); bei `hello` → `snapshot` |
| Companion tot | ESP: 15 s ohne Heartbeat | `offline`, letzte Projektion gedimmt |
| Hub nicht erreichbar | Companion: Poll-Fehler ≥ 2 | `heartbeat{hub:"down"}`, Nyx `offline` mit Grund; Backoff beim Poll |
| Hub-Restart | Poll-Fehler, dann wieder ok | `snapshot` nach Rückkehr (W5) |
| Hub-Antwort unlesbar/unbekannter Status | Zod-Parse schlägt fehl | `log`-Event, Ticker „unbekanntes Format", kein Absturz |
| Link-Zeile > 512 B oder kein JSON | Parser | `parse_err++`, `log`-Frame, Zeile verworfen **mit** Zählung |
| *(Soll, P6)* `data/settings.json` unlesbar | Laden beim Start | Defaults (TTS aus), `warn`, Ticker/Blase „Einstellungen zurückgesetzt" |
| *(Soll, P7)* Session ohne frische Aktivität | `updatedAt` älter als Grenze | Zeile `stale`, nie grün; Gesamtzustand unverändert |
| *(Soll, P9)* TTS-Engine fehlt oder stirbt | Prozess-Exit, Circuit-Breaker | `speech_state{failed}`, sichtbarer Dienstfehler, UI bleibt nutzbar |

**Sicherheitsgrenze der Touch-Pfade (Soll, ADR-0007):** `action_response` → `decide`-Pfad
(P3) und `ui_action` → UI-Handler sind getrennte Module. Der UI-Handler importiert den
`DecideClient` nicht; ein Isolations-Test prüft das (T6.6, W9).

## 5. Verzeichnis-Zielbild (nach EPIC-P2; Erweiterungen aus P5–P9 siehe §1)

```
protocol/            schema/*.json · fixtures/*.ndjson · config.schema.json
companion/           src/{main,config,hub,aggregate,link,bridge,log,metrics,sim}/ · test/
firmware/            platformio.ini · src/{protocol,state,render,touch,hal}/ · test/ · data/ (generiert)
tools/assets/        Pipeline · Palette-Check · tools/preview/ (Host-Vorschau)
assets/              nyx/ (Atlas v2: PNG · JSON · Aseprite-Quelle) · reference/
scripts/             check-commits.mjs · commit-notation.mjs · messlauf-*.mjs
docs/  epics/  data/ (git-ignored)
```

## Ergänzung: Web-Kiosk-TTS auf Hivemind (P11 T11.10)

Der bestehende Pfad `main.ts → VoiceService → POST /tts → WAV-Cache → /voice/:id`
unterstützt Qwen3 VoiceDesign und Voxtral-4B-TTS (ADR-0013). `voice.url` wählt
explizit den Dienst; `language` wählt dessen Standardstimme. Das Browser-Audio
bleibt beim Companion-Origin. Bei Pitch 0 und Tempo 1 wird FFmpeg umgangen.
AncientVoid-STT (Mikrofon → Whisper → Text) ist davon unabhängig und wird
nicht als Teil der Nyx-Sprachausgabe aufgerufen.
