# Blueprint-Traceability: Anforderung → Epic/Aufgabe

Stand: 2026-11-04 · Pflege: Jede Aufgabe, die ein Epic abschließt, zieht ihre Zeile mit
Beleg nach. Entscheidungen: ADR-0005 (Plattform, Epic-Folge), ADR-0006 (Nyx), ADR-0007
(UI, Link), ADR-0008 (Meldungen, TTS). Rangfolge bei Widerspruch: ADR > Spec > Epic >
Blueprint/Init.

**Test-Kürzel:** U = Unit (`node --test` / Native) · C = Contract (Fixtures beidseitig) ·
I = Integration (Fake-Hub + `MemoryLink`) · S = Sim · G = Golden-Bild (Host-Preview, T6.2) ·
L = Asset-Linter · H = HIL am Board · M = Messlauf · HB = `test:hub` · A = Sichtabnahme/Foto.

**Stand aller Zeilen:** geplant, außer „vorhanden" (bereits belegt) und „verworfen" (mit
ADR, also bewusst zugeordnet, nicht vergessen).

## 1. Ausgewertete Eingaben

Die Bilder liegen unverändert in `assets/reference/`, der Blueprint als reproduzierbares
Archiv `assets/reference/VoidWarden_Technical_Blueprint-2026-11-03.tar.gz` (SHA-256 beginnt
mit `ab9d983f3666d216`; OP-6). Die Pfade unten gelten im Archiv. Die Originale im Checkout
`arbeitsbaeume/voidwarden` sind unangetastet.

| Eingabe | SHA-256 (Anfang) | Ausgewertet in |
|---|---|---|
| `VoidWarden/README.md` | `5942edb2e96e9ca1` | §2 R |
| `docs/01_PRODUCT_REQUIREMENTS.md` | `6f80412b82bb3327` | §2 PR |
| `docs/02_ARCHITECTURE.md` | `ef3732a41e13d071` | §2 AR |
| `docs/03_AGENT_EVENTS_API.md` | `23113b8b2e46aae1` | §2 EV |
| `docs/04_NYX_SPRITES.md` | `d987c1866cfe5c86` | §2 NY, §3 |
| `docs/05_TOUCH_UI.md` | `eaf5b253fec13642` | §2 UI, §3 |
| `docs/06_TTS.md` | `2eb365ab30e1f357` | §2 TT |
| `docs/07_IMPLEMENTATION_ROADMAP.md` | `6783994375dbcb33` | §2 RM |
| `docs/08_HARDWARE_DEPLOYMENT.md` | `823288de4772a001` | §2 HW |
| `docs/09_SECURITY_OBSERVABILITY.md` | `4f7d2de4bbc6489f` | §2 SE |
| `docs/10_AGENT_IMPLEMENTATION_PROMPT.md` | `8a869bd40a1beb2f` | §2 AP |
| `docs/11_SOURCES_DECISIONS.md` | `33e0ae31306e2ccc` | §2 SD |
| `examples/agent-event.json` | `fe1a1c98472f4d1c` | EV-01 |
| `examples/nyx-animations.json` | `fd05eab6e005a0e5` | NY-02, §3.2 |
| `assets/nyx-spritesheet1.png` (1448×1086) | `8af3dffa9f1a147f` | §3.3 |
| `assets/nyx-spritesheet2.png` (1448×1086) | `13cedb38764a13a0` | §3.3 |
| `assets/nyx-spritesheet_favorite.png` (1448×1086) | `b957e8681e0a1721` | §3.3 |
| `assets/nyx1.png` (1086×1448) | `a7584a2cd7032920` | §3.1, §3.4 |
| `docs/spec.md`, `architecture.md`, `adr/0001–0004`, `epics/*`, `VOIDWARDEN_init.md`, `bugs/*`, Messläufe | Git | §4 |

## 2. Anforderungen

### README

| ID | Anforderung | Umsetzung/Entscheidung | Aufgabe | Test |
|---|---|---|---|---|
| R-01 | Live-Überblick über mehrere Agents | Hub-Sessions als Zeilen | T7.2, T7.4 | U, G, HB |
| R-02 | Tasks, Runs, Tool-Aktivität, Blockaden | Hub liefert Blockade + `lastActivity`, keine Task-/Run-IDs: X-04 | T7.1, T7.5 | HB, S |
| R-03 | Nyx-Animationen und farbige Augen | Clips + LUT | T5.6, T5.7, T5.9 | U, L, H |
| R-04 | Blasen bei Ereignissen, periodische Zusammenfassung | Trigger + Composer | T8.1, T8.2 | U |
| R-05 | Tap: Status zeigen, bei TTS vorlesen; TTS aus: nur zeigen | | T8.5, T9.8 | I, M |
| R-06 | Optional manuelles Vorlesen bei Auto-Off | `manualSpeakOverride` | T9.6 | U |
| R-07 | TTS an/aus, Lautstärke, Quiet Hours, Unterbrechen, Queue, Prioritäten | | T9.4, T9.5, T9.6, T9.10 | U, M |
| R-08 | Offline-fähig, keine Cloud-/LLM-Pflicht | Vorhanden, Vorlagen statt LLM | T8.1, T9.1 | U |
| R-09 | React/Pixi, Fastify/WS/SQLite, Pi-Kiosk | **verworfen** | ADR-0005 | — |
| R-10 | Aseprite/LibreSprite, PNG + JSON | Dev-Werkzeug | T5.2, T5.4 | C, L |
| R-11 | Poster sind keine Produktions-Frames | Pipeline verweigert Pfad | T5.1 | U |
| R-12 | MVP-Definition Ablauf bis TTS, Ausfall sichtbar | Blase in P8, Abschluss P9 | T8.9, T9.11 | H, M |

### 01 Produktanforderungen

| ID | Anforderung | Umsetzung/Entscheidung | Aufgabe | Test |
|---|---|---|---|---|
| PR-01 | Beliebig viele Agenten, kompakt 1–5, mehr per Details/Scroll | „+N" und Blättern | T7.4 | G, U |
| PR-02 | IDs, Namen, Task/Run, Phasen, Severity, Zeit, Fortschritt wenn vorhanden | Mapping in EPIC-P7 §3 | T7.1, T7.2 | HB, U |
| PR-03 | Nie Fortschritt ohne Daten | W10 | T7.2, T8.1 | U (Property) |
| PR-04 | `unknown`/`disconnected` sichtbar statt `healthy` | W10 | T7.2, T4.3 | U, H |
| PR-05 | Nyx 8–12 FPS, Idle schonend | Clip-Timing aus NYX2, Loop ≥ 25 fps (X-10) | T5.7, T5.10 | U, M |
| PR-06 | Blasen bei Wechsel + 60 s, nur Neues, Rate-Limit, Dedupe | W12 | T8.2 | U |
| PR-07 | Tap: Snapshot, Blase, TTS bei ON | | T8.5, T9.8 | I, M |
| PR-08 | Toggle TTS, `autoSpeak`, persistent | | T6.9, T9.6 | U |
| PR-09 | Keine ungebremsten Wiederholungen, Ton unterbrechbar | Circuit-Breaker, Stop | T9.5, T9.9 | U |
| PR-10 | Verlauf: letzte 20 | aus `/api/notifications` | T7.8 | C, I |
| PR-11 | Gerätestatus: Verbindung, Uhrzeit, Ton | Kopfzeile, Link statt WLAN | T6.7, T4.7 | G, S |
| PR-12 | Stille Zeiten, DE/EN, Lautstärke, Prioritätsmeldungen | | T9.6, T9.4, T11.7 | U |
| PR-13 | Mehrere Workspaces, wechselbarer Fokus | nur Anzeigefilter | T7.9 | U, S |
| PR-14 | Reconnect: sofort Stand, dann live | `hello`→`snapshot` vorhanden; Zeilen | T7.3 | I, M |
| PR-15 | WON'T: Chat, Review, Code-Ausführung, Mikrofon, SSH, LLM-Pflicht | Nicht-Ziele `spec.md` §1 | ADR-0005 | — |
| PR-16 | Story 1: `implementing` → cyan + Arbeitsanimation | `activity`, sonst `scan` | T7.7, T5.7 | U, S |
| PR-17 | Story 2: Fehler rot, verdrängt Info, bleibt | Blase + Zustand | T8.2, T8.8 | U |
| PR-18 | Story 3: Tap liefert nachvollziehbaren Text | | T8.5 | I |
| PR-19 | Story 4: TTS aus kein Audio; OFF stoppt sofort | W13 | T9.5, T9.6 | U, M |
| PR-20 | Story 5: Recovery mit Backoff, frischer Snapshot | teils vorhanden (P1) | T4.4 | I, H, M |
| PR-21 | Story 6: alte/doppelte Events überschreiben nicht | | T7.10 | U (Property) |
| PR-22 | Event→UI p95 < 500 ms | **nicht übernommen**, W2 gilt (X-09) | T7.11 | M |
| PR-23 | ≥ 12 FPS, adaptive Rate bei SPI | X-10 | T5.10 | M |
| PR-24 | 24/7, Auto-Reconnect, Service-Restart | | T11.1, T11.5 | H, M |
| PR-25 | Touch-Flächen 40–48 px | ≥ 44 px, Zeilen ≥ 32 px (X-15) | T6.5, T6.8 | G, H |
| PR-26 | Keine externen Accounts | Vorhanden; bleibt | T11.3 | U |
| PR-27 | Entscheidungspunkte Display, Host, Audio, Harness | gelöst oder OP | §5 | — |

### 02 Architektur

| ID | Anforderung | Umsetzung/Entscheidung | Aufgabe | Test |
|---|---|---|---|---|
| AR-01 | Komponentenskizze Ingest → UI | **verworfen**, Hub-Client | ADR-0005 | — |
| AR-02 | Tech-Tabelle (Pixi, Fastify, WS, SQLite, Kiosk) | **verworfen**; Piper bleibt | ADR-0005, T9.1 | M |
| AR-03 | Trennung Ingest/Reducer/Summary/Presentation/Transport | Bridge, `aggregate`, `agents`, `Composer`, Renderer, Link | T7.2, T8.1 | U |
| AR-04 | Reducer deterministisch | `aggregate` vorhanden (pure) | T7.2 | U |
| AR-05 | Tap-Datenfluss in 6 Schritten | `ui_action` statt POST | T6.6, T8.5, T9.7, T9.8 | I, M |
| AR-06 | Zustandspriorität | **Spec bleibt** (X-06), Overlay | T7.6 | U |
| AR-07 | `disconnected` als Überlagerung | `offline`, `connection_lost` | T4.3, T6.4 | U, H |
| AR-08 | `success_recent` begrenzt, nicht vor Fehler | Spec-Transient (X-23) | T8.2 | U |
| AR-09 | Repo-Vorschlag, pnpm | **verworfen** | ADR-0005 | — |
| AR-10 | Audio-Ort klären | OP-5 | T9.1 | M |

### 03 Events und API

| ID | Anforderung | Umsetzung/Entscheidung | Aufgabe | Test |
|---|---|---|---|---|
| EV-01 | Event-Vertrag v1 (auch `examples/agent-event.json`) | **verworfen**, Hub-Daten | ADR-0005 | — |
| EV-02 | Taxonomie `agent.*`, `build.*`, `tests.*` | Mapping auf Hub; Felder live prüfen | T7.1, T8.2 | HB |
| EV-03 | Phasen | `status` + `activity` | T7.1, T7.7 | HB, U |
| EV-04 | `GET /snapshot`, `/events`, `/settings`, `/health`; `POST /actions/*`; `WS /stream` | **verworfen** als Server; auf Link und CLI abgebildet | T6.6, T6.9, T9.5 | C, I |
| EV-05 | Dedupe, monotone Ordnung | | T7.10 | U (Property) |
| EV-06 | Heartbeat 30 s/90 s je Quelle | Link 5/15 s bleibt; 90 s als `stale` (X-08) | T7.2 | U |
| EV-07 | `progressPct=null` bleibt unbekannt | | T7.2 | U |
| EV-08 | Whitelist-Metadaten, kein Dump | Zeilen-Frames, Sanitizing | T7.2, T7.3 | U, C |
| EV-09 | Snapshot, dann höhere Version, Resync | `seq` + `resync` vorhanden; auf Zeilen erweitert | T7.3 | I |
| EV-10 | Adapter Hook/Harness/Hermes/CI | **verworfen**, AncientVoid-Sache | ADR-0005 | — |
| EV-11 | Szenario A/B/C: Overlay `1 Fehler · 1 wartet · 1 arbeitet` | amber statt rot (X-06) | T7.6, T7.11 | U, HB |
| EV-12 | `agent.completed`: Erfolg-Toast, dann Idle | `level=success` | T8.2, T8.4 | U, G |
| EV-13 | `thinking` ohne Lebenszeichen → `stale` | | T7.2 | U |

### 04 Nyx

| ID | Anforderung | Umsetzung/Entscheidung | Aufgabe | Test |
|---|---|---|---|---|
| NY-01 | Stil Gothic-Tech, kein Franchise-Nachbau | Kanon Favorite | T5.2 | A |
| NY-02 | Master 64×64, Compact 48×48 | | T5.2, T10.7 | L |
| NY-03 | Anker bottom-center, nur ganzzahlig | | T5.5, T5.7 | L, U |
| NY-04 | Layer `body` … `shadow` | | T5.2 | L |
| NY-05 | Augenmaske statt Duplikate | LUT | T5.6 | U |
| NY-06 | Export `nyx-atlas.png/.json`, Quelldatei | | T5.4 | C |
| NY-07 | 11 MVP-Animationen, `blink` unregelmäßig | 12 mit `scan`, §3.2; Idle-Life | T5.8, T5.9 | L, H, U |
| NY-08 | 15 Erweiterungen, gestaffelt | §3.2; nur mit belegtem Auslöser, Budget entscheidet | T10.1, T10.2, T10.3, T10.5, T10.9 | L, H, M |
| NY-09 | Statusfarben + Zweitsignal | ADR-0006 | T5.6, T6.10 | U, G |
| NY-10 | Farbe nie allein, `reducedMotion`, keine Vollbild-Blitze | | T5.6, T10.6 | U, G |
| NY-11 | Basis/Overlay/One-Shot, Priorität | | T5.7 | U |
| NY-12 | Speaking überschreibt nicht | | T5.7, T9.7 | U |
| NY-13 | Prozedurale Effekte | | T5.7 | U, M |
| NY-14 | Produktion: Model Sheet bis Export (Schritte 1–7) | | T5.2, T5.9 | L, A |
| NY-15 | Asset-Linter (Schritt 8) | | T5.5 | U |
| NY-16 | Vorschau in physischer Größe (Schritt 9) | | T5.10, T6.1 | A |
| NY-17 | Runtime-Recolor, Glow begrenzt (Schritt 10) | | T5.6, T5.7 | U, M |
| NY-18 | Loader passt Aseprite-Format an | | T5.4 | C |
| NY-19 | QA: Kanten, Silhouette, Loop, keine Kollision, kein Freeze, 24 h | | T5.5, T5.6, T5.10, T6.11, T11.5 | L, M |

### 05 Touch-UI

| ID | Anforderung | Umsetzung/Entscheidung | Aufgabe | Test |
|---|---|---|---|---|
| UI-01 | Layout Quer 480×320 | 320×240 zuerst, Display-Profile, 480×320 als Prüfprofil | T6.1, T6.4, T6.12 | H, G |
| UI-02 | Alternative Hochformat | im Spike geprüft | T6.1 | H |
| UI-03 | Poster nicht verkleinern | Mockup ist Idee | T6.1 | A |
| UI-04 | Gesten | §3.1 | T6.5 | U, H |
| UI-05 | Vorlage statt LLM | | T8.1 | U |
| UI-06 | Veraltet-Text | | T8.1 | U |
| UI-07 | Max. 2 Zeilen, Seiten | | T6.3, T8.4 | U, G |
| UI-08 | 60-s-Regel, `messageHash` | | T8.2 | U |
| UI-09 | Fehler 12 s, Erfolg 4 s, kritisch mit Ack | | T8.2, T8.6 | U |
| UI-10 | Sechs Anzeigezustände, Modal nur kritisch | plus `approval` | T6.4 | U, G |
| UI-11 | Bedienbar ohne Touch/Maus | `voidwarden ui` | T6.9 | I |
| UI-12 | Kontrast, Schrift auf Panel prüfen, Symbole, Night/Quiet | | T6.1, T10.6 | A, G |
| UI-13 | Kein Doppel-Trigger | | T6.5 | U |

### 06 TTS

| ID | Anforderung | Umsetzung/Entscheidung | Aufgabe | Test |
|---|---|---|---|---|
| TT-01 | Kette bis `speech.*` | | T9.2, T9.4, T9.7 | U, C |
| TT-02 | Audio-Ort klären | Host (ADR-0008), OP-5 | T9.1 | M |
| TT-03 | Piper, deutsche Stimme, Lizenz | | T9.1 | M |
| TT-04 | Async, nicht blockierend | eigener Prozess | T9.2 | U |
| TT-05 | Rückfall `espeak-ng` | | T9.1, T9.2 | U |
| TT-06 | Web Speech API | **verworfen** | ADR-0008 | — |
| TT-07 | Settings-JSON | §3 EPIC-P9 | T9.6 | U |
| TT-08 | `ttsEnabled`/`autoSpeak`/Override-Logik | Wahrheitstabelle | T9.6 | U |
| TT-09 | Queue-Regeln 1–7 | | T9.4, T9.3 | U |
| TT-10 | Nur sanitizte Kurztexte, keine Keys, Pfade, Stacktraces, Prompts | enger als Anzeige | T9.3 | U (Property) |
| TT-11 | `speech.*`-Events, Talk-Overlay | `speech_state` | T9.7 | C, U |
| TT-12 | Tests: kein Audio-Gerät, OFF im Satz, Doppeltipp, Neustart, Engine-Exit | | T9.5, T9.8, T9.9 | U, M |

### 07 Roadmap

| ID | Anforderung | Umsetzung/Entscheidung | Aufgabe | Test |
|---|---|---|---|---|
| RM-01 | Phase 0: Hardware bestimmen | vorhanden; Touch offen | T3.8 | H |
| RM-02 | Phase 0: Event-Contract | verworfen; Frames | T6.6, T7.3 | C |
| RM-03 | Phase 0: Priorität, Frische als Tests | | T7.2 | U |
| RM-04 | Phase 0: Sprite-Master | | T5.2 | L, A |
| RM-05 | Phase 1: Ingest, Reducer, Kiosk | Hub-Client + Screens | ADR-0005, T7.2, T6.4 | U |
| RM-06 | Phase 1: Base-Sprite + 4 Arten | | T5.3, T5.9 | U, H |
| RM-07 | Phase 1: Tap + TTS + Stop | | T8.5, T9.5 | I, M |
| RM-08 | Phase 1: Demo-Emitter, Smoke-Test | Sim + Fake-Hub vorhanden; Szenarien | T6.2 | S, G |
| RM-09 | Phase 2: 11 Clips, Recolor | | T5.6, T5.9 | L, U |
| RM-10 | Phase 2: 12 Farben mit Semantik | | T10.4 | U, A |
| RM-11 | Phase 2: Hover, Glint, Wake, Celebrate, Attention, Quiet | | T10.1, T10.2, T10.6 | L, H |
| RM-12 | Phase 2: Text-Kürzung, Detail, Queue | | T6.3, T7.5, T8.7 | U |
| RM-13 | Phase 3: Harness-/Hermes-Adapter | **verworfen** | ADR-0005 | — |
| RM-14 | Phase 3: Repo-/Workspace-Filter, Namen | | T7.9, T7.2 | U |
| RM-15 | Phase 4: Autostart, Restart, Backoff, Standby | Dimmen + Service | T4.2, T11.1 | H |
| RM-16 | Phase 4: Test am Display | | T6.11, T11.4 | H, M |
| RM-17 | Phase 4: 24 h, Ausfälle, Duplikate | | T11.5 | M |
| RM-18 | Phase 4: Security, Tokens, Retention | | T11.2, T11.3 | U |
| RM-19 | Testpyramide inkl. Visual, 1000 Touches | | T6.2, T11.6 | G, M |
| RM-20 | Release-Kriterien | | T11.9 | M |

### 08 Hardware

| ID | Anforderung | Umsetzung/Entscheidung | Aufgabe | Test |
|---|---|---|---|---|
| HW-01 | 3,5" sagt nichts über Auflösung; Modell prüfen | ESP32-2432S028R 2,8" (X-01) | vorhanden, T3.8 | H |
| HW-02 | Pi-/HDMI-/Mini-PC-Varianten | **verworfen** | ADR-0005 | — |
| HW-03 | Kleine Dirty-Regionen | | T6.4 | U, M |
| HW-04 | Kiosk | **verworfen** | ADR-0005 | — |
| HW-05 | Service, unprivilegiert | | T11.1 | H |
| HW-06 | Backend nur localhost | kein eingehender Port (`observability.md` §4) | T11.3 | U |
| HW-07 | Agenten auf anderem Host via Tailscale | `hub.url` im Tailnet | T11.3 | HB |
| HW-08 | Reconnect mit exponentiellem Backoff | vorhanden (P1) | T4.4 | I |
| HW-09 | Audio-Optionen, Bluetooth-Rückfall | Host-Audio; Bluetooth über `AudioSink` | T9.1, T9.9 | M, U |
| HW-10 | Messplan | | T11.4 | M |

### 09 Sicherheit

| ID | Anforderung | Umsetzung/Entscheidung | Aufgabe | Test |
|---|---|---|---|---|
| SE-01 | Event-Text nur als Text | Renderer zeichnet Text, kein HTML | T8.4, T11.3 | U, Review |
| SE-02 | Keine Shell-Commands aus Status | | T9.2, T9.3 | U |
| SE-03 | Getrennte Tokens, Authentisierung | `display:`-Token; kein Ingest | T3.6, T11.3 | HB |
| SE-04 | Längenlimits, Allowlist, Rate-Limit | Frames + Sanitizing | T7.3, T8.2 | C, U |
| SE-05 | Kein HTML/JS/Markdown-Link in Blasen | | T8.3, T8.4 | C |
| SE-06 | Keine Dateien/Env in Ausgaben | | T9.3, T11.3 | U |
| SE-07 | Journal mit TTL | Kein SQLite; Log-Grenzen | T11.2 | U |
| SE-08 | Kein Token im Browser | Entfällt; Token nur Datei | T11.3 | U |
| SE-09 | Sandbox, kein root | | T11.1 | H |
| SE-10 | Metriken | Mapping EPIC-P11 §3 | T11.2, T9.9 | U |
| SE-11 | Logging pseudonymisiert, Rolling | vorhanden, Erweiterung | T11.2 | U |
| SE-12 | Fehler und Netz auf Display | | T6.7, T8.8 | G, U |
| SE-13 | Circuit-Breaker, Speech-Dedupe | | T9.4, T9.9 | U |
| SE-14 | Offline: letzter Zustand als **veraltet** | | T4.3 | U, H |
| SE-15 | Keine Prompts, Rohausgaben, Dumps auf Display/TTS | Alias-Regel (OP-7) | T7.2, T9.3 | U |

### 10 Agent-Prompt

| ID | Anforderung | Umsetzung/Entscheidung | Aufgabe | Test |
|---|---|---|---|---|
| AP-01 | Monorepo, Fastify, UI-Stack | **verworfen** | ADR-0005 | — |
| AP-02 | Markierte Platzhalter | | T5.3 | U |
| AP-03 | Asset-Import, später ohne Codeumbau | | T5.3, T5.4 | C |
| AP-04 | TTS auswechselbar, Mock | | T9.2 | U |
| AP-05 | Echter Adapter erst nach Inspektion | Sinn gewahrt: T7.1 prüft den Hub | T7.1 | HB |
| AP-06 | E2E Demo→Renderer→Bubble→Touch→TTS, Reconnect, Duplikate | | T9.11, T7.10 | H, U |
| AP-07 | Doku, Screenshots, bekannte Grenzen, Restarbeiten | | T11.8 | Durchlauf |
| AP-08 | Testbar ohne Display | Host-Preview + Sim statt Browser | T6.2 | G, S |
| AP-09 | Jede Kernfunktion mit Test | Epic-Struktur | T11.9 | Checkliste |
| AP-10 | Screenshots 480×320/320×480 | reales Profil + Prüfprofile | T6.2, T6.12 | G |

### 11 Quellen

| ID | Anforderung | Umsetzung/Entscheidung | Aufgabe | Test |
|---|---|---|---|---|
| SD-01 | Blueprint-ADR-001 React + Pixi | **verworfen** | ADR-0005 | — |
| SD-02 | Blueprint-ADR-002 Deterministische Texte | übernommen | ADR-0008, T8.1 | U |
| SD-03 | Blueprint-ADR-003 Status vs. Sprechen | übernommen | ADR-0008, T9.7 | U |
| SD-04 | Fünf offene Auswahlen | §5 | OP-1, OP-5, OP-4, T9.1 | — |

## 3. UI-, Animations- und Sprite-Inventar

### 3.1 Screens und Interaktionen

| Element | Quelle | Aufgabe | Test |
|---|---|---|---|
| Screen `idle` | 05, `nyx1` | T6.4 | U, G |
| Screen `update_toast` | 05 | T6.4, T8.4 | U, G |
| Screen `details` | 05 | T6.4, T7.8 | U, G |
| Screen `settings` | 05 | T6.4, T6.9 | U, G |
| Screen `connection_lost` | 05 | T6.4, T4.3 | U, G, H |
| Screen `sleep`, Wake per Tap | 05 | T4.2, T6.4 | U, H |
| Screen `approval` (Repo) | spec §7 | T3.9, T6.4 | U, S, H |
| Tap auf Nyx | 05 | T8.5 | I, M |
| Long-Press | 05 | T6.5, T8.6 | U |
| Tap auf Agent | 05 | T7.5 | U, S |
| Tap auf Blase | 05 | T8.6 | U, S |
| TTS-Symbol: Stopp + speichern | 05 | T9.5, T9.10 | U |
| Next | 05, `nyx1` | T8.7 | U, S |
| Mute | 05, `nyx1` | T6.8, T9.5 | G, M |
| Details | 05, `nyx1` | T6.8, T7.8 | G, S |
| Approve/Decline, Slider | spec §7 | T3.4 | U, H |
| Kopfzeile: Logo, Titel, Zähler-Chip | `nyx1`, Favorite | T6.7 | G |
| Kopfzeile: Uhr | `nyx1` | T6.7, T4.7 | G, C |
| WLAN-Symbol → Link-/Hub-Symbol | `nyx1`, X-20 | T6.7 | G, S |
| Akku-Symbol → entfällt | `nyx1`, X-20 | — (T6.7 prüft Abwesenheit) | G |
| Blase mit Spitze | alle Sheets, `nyx1` | T8.4 | G |
| Agenten-Panel: Icon, Name, Unterzeile | `nyx1` | T7.4 | G |
| Sync- und Haken-Icon | `nyx1` | T6.10, T7.4 | G |
| TTS ON/OFF-Toggle | `nyx1` | T6.9, T9.10 | G, H |
| Hinweis „Tippe auf Nyx" | `nyx1` | T6.8 | G |
| Namens-Chip „Nyx" | `nyx1` | T6.8 | G |
| Szenen-Hintergrund | `nyx1` | T10.8 | M, G |
| Lautstärke | 06 | T9.10 | G |

### 3.2 Animationen

| Clip | Frames (Blueprint) | Epic |
|---|---|---|
| `idle_breathe`, `blink`, `thinking`, `coding`, `talk`, `tap_ack`, `success`, `warning`, `error`, `sleep`, `connection_lost` | 6, 3, 6, 8, 6, 4, 8, 6, 8, 4, 4 | T5.9; `blink` alle 4–9 s: T5.8 |
| `scan` (vorgezogen) | 8 | T5.9 |
| `needs_approval`, `wake`, `sync`, `focused` | 6, 6, 6, 4 | T10.1 |
| `hover_float`, `cloak_flutter`, `glint`, `look_left`, `look_right`, `celebrate` | 8, 8, 5, 4, 4, 10 | T10.2 |
| `summon_status_bubble`, `dismiss_bubble`, `panic`, `pet_reaction` | 5, 4, 8, 6 | T10.3 |
| Glitch-Morph (Repo) | prozedural | vorhanden, T10.6 drosselt |

`examples/nyx-animations.json` nennt nur eine Teilmenge mit `assetStatus:
SPECIFICATION_ONLY_NOT_RENDERABLE_ATLAS`, `error` dort ohne Loop; EPIC-P5 §3 fasst das als Intro
mit Halteschleife.

### 3.3 Spritesheets

| Sheet-Inhalt | Zuordnung | Aufgabe |
|---|---|---|
| **Favorite:** Idle, Cloak Flutter, Blink/Focus, Tap, Talking, Scanning, Hover, Warning/Error, Success, Sleep | Clips | T5.9, T10.2 |
| **Favorite:** Cycle Preview | Prüfbild für Sichtabnahme | T5.10 |
| **Favorite:** Palette (core, 7 Töne) | Körperpalette ≤ 12 | T5.2, T5.5 |
| **Favorite:** Icon-Legende (8 Icons) | Icon-Satz | T6.10 |
| **Favorite:** Augen Violet, Green, Cyan, Blue, Amber, Red, Gold, Dim | LUT mit Status | T5.6 |
| **Favorite:** Augen White, Pink, Teal | Sonderfarben | T10.4 |
| **Favorite:** Rainbow | Zeitgesteuerter LUT-Lauf, Feier-Moment (OP-9) | T10.4 |
| **Favorite:** UI-Beispiele Speech, Status-Chip | Blase, Zähler-Chip | T8.4, T6.7 |
| **Favorite:** Hero-Bild mit Runen, Ketten | Design-Ziel; Kettendetail im 64×64 nur soweit lesbar | T5.2 |
| **Sheet 1:** Chibi-Figur, Idle, Blink, Hover/Breathe, Talking, Tap, Alert Pulse | Nebenreferenz; Alert-Ring prozedural | T5.7 |
| **Sheet 1:** Front/Side/Back | Referenz, kein Clip | T5.2 |
| **Sheet 1:** Eye-Varianten, Blase | Bedeutungs-Vergleich X-13 | T5.6 |
| **Sheet 2:** Proposal C, Spectral Warden, Idle Float, Sparkle, Speaking, Scanning, Warning Flare, Sleep | Nebenreferenz; Scan-Bogen und Sparkle als Ideen | T5.9, T10.2 |
| **Sheet 2:** Interaction Icons Speech, Sound On/Off, Touch | Icon-Satz | T6.10 |
| **Sheet 2:** Augen Idle-Weiß, Busy-Orange | **abgelöst** durch ADR-0006 | T5.6 |
| **Sheet 2:** Tiny Display Preview | Prüfidee für physische Größe | T5.10 |
| **`nyx1`** | Layout-Idee, §3.1 | T6.1 |
| Bestand `assets/nyx-spritesheet.png` (32×48, 33 Frames, Orb) | ersetzt durch Atlas v2 (`assets/nyx/`, 2026-11-04); Platzhalter entfällt | T5.3 (Rest: Clips, ART-1) |

Im Mockup und den Beispielen stehen Agentennamen wie „Zeratul", „Orion", „Helix". Das sind
Beispieldaten; sie gehören weder in Code noch in Fixtures, die Namen kommen aus dem Hub (T7.2).

## 4. Widersprüche und Auflösung

| ID | Widerspruch | Auflösung | Festgelegt in |
|---|---|---|---|
| X-01 | Display: Blueprint, Sheets, Init und P0 sagen 3,5"/480×320 (Init: kapazitiv, Blueprint: resistiv); BUG-0001 belegt 2,8"/ILI9341/320×240; Touch-Typ unbelegt | Inhaber: zuerst 2,8", umstellbar per Display-Profil; T3.8 klärt Touch | ADR-0007 §2, T3.8, T6.1, T6.12 |
| X-02 | Plattform: React/Pixi-Kiosk auf Pi vs. Renderer auf ESP32 („kein Browser, kein Pi") | ESP32 | ADR-0005 |
| X-03 | Backend: Fastify, Port, WS, SQLite vs. reiner Hub-Client ohne eingehenden Port, „kein zweiter Hub" | Hub-Client | ADR-0005 |
| X-04 | Event-Vertrag: Run-ID, Phase, `build.*`, Fortschritt vs. real vorhandene Felder | Keine Erfindung; T7.1 prüft; AV-D2 bedingt | ADR-0005, T7.1 |
| X-05 | Eigene Adapter vs. Spec K8 „kein Adapter" | AncientVoid-Sache | ADR-0005 |
| X-06 | Priorität: Blueprint `critical > blocked`, Beispiel rot; Spec `approval_pending > error` | Spec bleibt, weil die Freigabe abläuft; Fehler per Overlay sichtbar | EPIC-P7 §3, T7.6 |
| X-07 | Vokabular: 10+ Blueprint-Status vs. 7 `state` | `state` unverändert; `activity` und Zeilenstatus additiv | ADR-0007 |
| X-08 | Heartbeat 30/90 s vs. Link 5/15 s (Invariant) | Link bleibt; 90 s als Session-`stale` | T7.2 |
| X-09 | Latenz p95 < 500 ms vs. W2 p95 ≤ 2,5 s, Poll 1,5 s | W2 bleibt; 500 ms ist mit Poll nicht erreichbar; WS nur laut OD-4 | `spec.md` §9 |
| X-10 | 8–12 FPS vs. W3 ≥ 25 fps | Kein echter Widerspruch: Clip-Takt vs. Renderloop | T5.7 |
| X-11 | Frame-Größe 64/48, Favorite 48, Spec/Ist 32×48 | Master 64×64 | ADR-0006 |
| X-12 | Frame-Zahlen: Blueprint vs. Poster (2–4) vs. Spec | Blueprint gilt, Poster sind Stil | EPIC-P5 §3 |
| X-13 | Farben: Spec-Token, Blueprint-Hex und drei Poster mit abweichender Bedeutung (Weiß: Idle/Attention; Gelb: Waiting/Gold; Orange: Warning/Busy) | Blueprint-Hex, Tabelle ADR-0006 | ADR-0006 |
| X-14 | Figur: Orb und „Sith-artig" (Init), „nichts heller 40 %" (Spec) vs. Medaillon, Runen, leuchtend; „Version 2" nennt keine Datei | Favorite gilt (Inhaber bestätigt), Orb entfällt | ADR-0006 |
| X-15 | Touch: 40–48 px vs. ≥ 100 px | Drei Klassen | ADR-0007 |
| X-16 | Ticker (Spec) vs. Sprechblase (Blueprint) | Blase ersetzt Anzeige, Fail-loud-Regression | T8.8 |
| X-17 | Spec „K6 … keine Sprache" vs. TTS | K6 ist Sprache-zu-Text; TTS bekommt W13; Satz korrigiert | `spec.md` §9 |
| X-18 | Einstellungen per REST vs. kein HTTP-Listener | Link + CLI | ADR-0007 |
| X-19 | SQLite-Journal vs. nur JSONL, Hub als Wahrheit | Verlauf aus dem Hub, kein Speicher | T7.8 |
| X-20 | Mockup zeigt WLAN und Akku; Board läuft an USB, WiFi ist Nicht-Ziel | Link-/Hub-Symbol; Akku entfällt | EPIC-P6 §3 |
| X-21 | Mockup englisch vs. UI Deutsch; Blueprint DE/EN | Default Deutsch, EN in T11.7 | T11.7 |
| X-22 | Blueprint kennt keine Freigabe, Repo schon; „Modal nur bei kritischer Aktion" | Freigabe bleibt das einzige Modal | ADR-0007 |
| X-23 | Erfolg 1,5 s (Spec) vs. 4 s (Blueprint) | Zustand 1,5 s, Blase 4 s | T8.2 |
| X-24 | Browser-Demo, E2E im Browser vs. `node --test`, Sim, HIL | Host-Preview | T6.2 |
| X-25 | Blueprint-ADR-Nummern kollidieren begrifflich mit dem Repo | Inhalt übernommen, Nummern nicht | ADR-0008 |
| X-26 | Swipe/Scroll vs. Spec „Swipe später" | Blättern per Tap | ADR-0007 |
| X-27 | Spec: `display:` darf keine Session-Events lesen; Blueprint: Tool-Aktivität | Nur `lastActivity`, AV-D2 bedingt | T7.1 |
| X-28 | `title`/`lastActivity.text` enthalten ggf. Prompt-Text; Blueprint verbietet das | Alias-Default, nie vorlesen | ADR-0008 |
| X-29 | Repo intern: README nannte AV-D1 offen und gemergt; HW-P0-A stand offen und gelöst; ADR-0001 „Merge steht aus"; P0 zitiert 50,6 fps für ein falsches Panelprofil | Korrigiert, W3 neu in T2.10/T2.7 | `epics/README.md` |

## 5. Offene Punkte

Offen sind noch OP-5, -7, -8, -10; der Default gilt, bis jemand ihn ändert.

| ID | Frage | Default | Wer/Wann |
|---|---|---|---|
| OP-1 | Gibt es ein eigenes 3,5"-Zielgerät, oder ist das 2,8"-Board das Produkt? | **Entschieden (Inhaber, 2026-11-04):** zuerst 2,8", später skalier- und umstellbar | T6.12 |
| OP-2 | Ist `nyx-spritesheet_favorite.png` wirklich „Version 2"? | **Entschieden (Inhaber, 2026-11-04):** ja | T5.2 |
| OP-3 | Wer pixelt (ART-1)? | **Entschieden (Inhaber, 2026-11-04):** was am besten aussieht und am saubersten läuft. Inhaber nach `pixel-art-anleitung.md` oder Agent-Entwurf, Urteil nach Foto am Board; nach zwei Runden ohne Erfolg Empfehlung einer externen Kraft (Kosten entscheidet der Inhaber) | T5.2 |
| OP-4 | Erster Producer | Hub-Sessions (ADR-0005) | erledigt |
| OP-5 | Wo soll der Ton herauskommen? | Rechner; Board-Lautsprecher nur per ADR und Hardware-Beleg | T9.1 |
| OP-6 | Blueprint und Poster versionieren? | **Entschieden (Empfehlung, vom Inhaber übertragen, 2026-11-04):** ja, in `assets/reference/`, weil die ungetrackten Dateien sonst die einzige Kopie sind. Blueprint als Archiv, damit `docs/` flach bleibt und die Dateien unverändert sind | erledigt, Guard in T5.1 |
| OP-7 | Dürfen Sitzungstitel am Tisch sichtbar sein? | Nur `manual`, sonst Alias | T7.2, `ui.agentNames` |
| OP-8 | Darf kritisch nachts sprechen? | Nein (`quietHours.allowCritical=false`) | T9.6 |
| OP-9 | Regenbogen-Augen: welches Ereignis? | **Entschieden (Inhaber, 2026-11-04):** umsetzen; Bedeutung Feier-Moment mit `celebrate`, nie bei Alarm | T10.4 |
| OP-10 | Stimme, Sprechercharakter, Lizenz | deutsche Piper-Stimme mit klarer Lizenz, sonst `espeak-ng` | T9.1 |

**Doku-Nachzug außerhalb dieses Abgleichs:** `AGENTS.md` und Skills nennen W1–W9; Nachzug in
T11.8. `.factory/stories.md` führt nur P0–P3 und wurde nicht angefasst. Das ungetrackte
`scripts/hil-states.mjs` im Haupt-Checkout ist eine mögliche Basis für T2.8.
