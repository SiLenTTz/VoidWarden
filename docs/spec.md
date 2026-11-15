# VoidWarden — Verbindliche Spezifikation

Stand: 2026-11-04 · Ersetzt [`VOIDWARDEN_init.md`](../VOIDWARDEN_init.md) als
Quelle der Wahrheit (die Init-Datei bleibt als Ausgangspunkt mit
Abweichungsliste stehen). Bei Widerspruch gilt: ADR > diese Spec > Epic >
Init-Datei. Architektur und Technologie: [`architecture.md`](architecture.md).
Testing: [`testing.md`](testing.md). Monitoring/Logging:
[`observability.md`](observability.md). Fahrplan: [`../epics/README.md`](../epics/README.md).
Blueprint-Abgleich: [`blueprint-traceability.md`](blueprint-traceability.md). §1–§10
beschreiben das **Ist**; das geplante Soll steht getrennt in §11.

## 1. Zweck und Abgrenzung

VoidWarden ist ein **Anzeige- und Freigabe-Terminal** für AncientVoid: ein
ESP32 mit Touch-Display am Entwicklungsrechner, auf dem die Figur **Nyx**
den aggregierten Zustand aller Agent-Sessions zeigt und **Freigaben der Klasse
`write`** per Touch entgegennimmt. Es ist ein *Client* des AncientVoid-Hubs,
kein zweiter Hub.

**Nicht-Ziele** (Scope-Schutz, Verstöße = Scope-Creep):
- Kein Chat, keine Prompt-Eingabe, keine Session-Steuerung (start/stop/park).
- Keine `destructive`-Freigaben und keine Freigaben, die eine Begründung
  verlangen (`reasonRequired`) — die bleiben am Handy (WebAuthn, ADR-0007).
- Kein Cloud-Zugriff, kein WiFi/BLE im MVP (Option nach P12).
- Kein Mikrofon, keine Sprachsteuerung (nur Sprachausgabe, ADR-0008); kein
  SSH-/Terminalzugriff und keine Code-Ausführung vom Display; keine LLM-Pflicht
  und keine LLM-erzeugten Statustexte (ADR-0005, ADR-0008).
- Kein eigener Event-Vertrag, keine eigene Ingestion, keine Agent-Adapter: Daten
  kommen ausschließlich vom Hub (ADR-0005).
- Keine Interpretation von Agent-Output als Instruktion (PRD §8.5): Text aus
  Events ist **Anzeige-Daten**, nie ein Befehl, auch nicht auf dem ESP32.

## 2. Hardware und Topologie

| Komponente | Festlegung |
|---|---|
| Display | ESP32-2432S028R (2,8"): ESP32-D0WD-V3, 4 MB Flash (GD), kein PSRAM, ILI9341 320×240 im Querformat, USB-CH340 — Pins: HSPI 14/12/13, CS15, DC2 (GPIO2), Backlight GPIO21 (GPIO25 ist der Touch-CLK, nicht Backlight); Touch XPT2046 am eigenen Bus (CLK25, MOSI32, MISO39, CS33; IRQ36 unbenutzt, Berührung über Druck) — Ruhewerte per Probe belegt, Berührungswerte und Kalibrierung stehen aus (T3.8); Treiber LovyanGFX@1.2.36 |
| Link | USB-CDC/UART direkt am Rechner, Start 921600 Baud, per Config änderbar |
| Firmware | Arduino-Framework auf PlatformIO |
| Renderer | auf dem ESP32; Sprites in LittleFS; kein Browser, kein Pi |

**Belegt durch den Hardware-Spike (EPIC-P0 T0.5, 2026-11-03,**
[`messlauf/2026-11-03-p0-hardware-spike.md`](messlauf/2026-11-03-p0-hardware-spike.md)**):**
ESP32-D0WD-V3 (Rev 301, 240 MHz, 2 Kerne), 4 MB Flash (GD) @ 40 MHz, **kein PSRAM**,
~330 kB Heap frei nach Boot. Vollbild-Framebuffer ausgeschlossen — Renderer arbeitet
mit Teilflächen (Dirty Rectangles). Die frühere ST7796-Zuordnung war falsch
(BUG-0001); der im Spike gemessene Sprite-Durchsatz belegt keine sichtbare Ausgabe mit der korrigierten
ILI9341-Konfiguration. W3 muss damit am Board erneut verifiziert werden.
Serial-Echo 921600 Baud 10 min verlustfrei, LittleFS
CRC-bestätigt. Grafikbibliothek: **LovyanGFX 1.2.36** (1.2.0 kollidiert mit
arduino-esp32 3.x — i2c-Treiberkonflikt, Lektion im Messlauf).

## 3. Datenfluss

```
AncientVoid-Hub (loopback :7373)
   │  HTTP: GET /api/sessions · /api/approvals · /api/notifications   (Poll, 1–2 s)
   │  HTTP: POST /api/approvals/:id/decide                            (ab EPIC-P3)
   ▼
Companion-Service (Node, reiner Hub-Client)  ── NDJSON über USB-Serial ──▶  ESP32 (Nyx)
   ▲                                          ◀── hello · action_response · stats · log
```

Der Hub hat **keinen globalen Event-Bus**; es gibt Pro-Session-WS-Tails
(`/api/events/:id/tail`) und die REST-Aggregate oben. Der Companion aggregiert
daraus einen einzigen Display-Zustand und sendet nur **Änderungen** (Coalescing,
K2-Disziplin). Die ESP32-Seite hält **keinen Wahrheits-Zustand**: Nach Boot,
Reconnect oder Lücke schickt der Companion einen vollständigen `snapshot`
(K7-Analogie, §4.4).

## 4. Link-Protokoll v1 (NDJSON)

Eine JSON-Zeile pro Frame, UTF-8, `\n`-terminiert, **≤ 512 Byte** pro Zeile
(K5-Analogie; längere Frames sind ein Protokollfehler, kein Truncate).
Jede Zeile trägt `"v":1`. Unbekannte `type`/Felder werden **gezählt und als
`log`-Frame gemeldet**, nie still verworfen (AGENTS.md Regel 6).
Die maschinenlesbare Fassung (JSON-Schema + goldene Fixtures) liegt in
`protocol/` und ist Quelle der Wahrheit für Companion **und** Firmware
(Contracts first).

### 4.1 PC → ESP32

| `type` | Pflichtfelder | Zweck |
|---|---|---|
| `snapshot` | `seq`, `state`, `sessions{total,working,waiting,error}`, `approval` (oder `null`), `hub` (`up`/`down`), `ts`, optional `utc_offset_min` | Voller Zustand; Antwort auf `hello`/`resync` |
| `state_change` | `seq`, `state`, optional `agent_id`, `payload` | Änderung des Nyx-Zustands |
| `notification` | `seq`, `agent_id`, `level`, `payload{title,body}` | Ticker-Eintrag (Quelle: `/api/notifications`) |
| `bubble` | `seq`, `bubble_id` (≤ 36), `level` (`info`, `success`, `error`, `critical`), `payload{title ≤ 40, body ≤ 160}`, `hold_s` (0–255, 0 = bis Ack/Ablösung), `ack_required` | Sprechblase aus dem Composer (ADR-0007/0008, T8.3). Überlänge kürzt der Companion, die Firmware lehnt sie ab; eine aktive kritische Blase sendet der Companion nach `hello`/`resync` erneut (K7) |
| `session_focus` | `seq`, `idx` (1-basiert, ≤ `total`), `total` (1–255), `ref` (≤ 8, Kurz-ID), `name` (≤ 16, Adapter + Kurz-ID; bei `titleSource=manual` der bereinigte Titel, ADR-0008 §6), `status` (`approval`, `question`, `error`, `working`, `idle`, `other`) | Fokussierte Session für Indikator und Tap-Status (ADR-0009). Der Fokus liegt im Companion (K7): nach `hello`/`resync` folgt der Frame auf den `snapshot`; die Firmware hält keine Session-Liste |
| `action_request` | `seq`, `action_id`, optional `kind` (`approval` Default, `question`), `agent_id`, `class`, `payload{title,body}`, `timeout_s`, `decidable` | Freigabe-Anfrage. `kind=question` (Rückfrage des Agents, `AskUserQuestion`) ist nur Anzeige und verlangt `decidable:false` (Schema + beide Parser, W9, ADR-0009). Dasselbe optionale `kind` trägt `snapshot.approval` |
| `action_result` | `seq`, `action_id`, `status` | Wahrheit zur Entscheidung: `approved` · `rejected` · `timed_out` · `stale` · `error` |
| `heartbeat` | `seq`, `ts`, `hub`, optional `utc_offset_min` | alle 5 s; trägt Hub-Erreichbarkeit |

`state` ∈ `idle | listening | approval_pending | executing | success | error | offline`.
`payload.title` ≤ 40 Zeichen, `payload.body` ≤ 2×80 Zeichen; der Companion
kürzt mit „…" und entfernt Steuerzeichen. Die Firmware prüft die Grenzen in UTF-8-**Bytes**
(`strlen`), also kürzt der Companion auf 40/160 Bytes (Umlaut = 2, „…" = 3 Byte); sonst verwirft sie
den Frame und die Seq-Lücke löst ein Resync aus. `action_id` = die Approval-ID des Hubs
(`crypto.randomUUID()`-Format, unverändert durchgereicht). `timeout_s` ist die
**Restzeit** bis `timeoutAt` des Hubs, nicht ein eigener Timer.
`decidable:false` markiert Anfragen, die das Gerät nur anzeigen darf
(`destructive`, `reasonRequired`, Policy verbietet es): Nyx zeigt „Am Handy
bestätigen", keine Touch-Zonen.

### 4.2 ESP32 → PC

| `type` | Felder | Zweck |
|---|---|---|
| `hello` | `fw`, `proto`, `screen`, `reset_reason`, `heap_free` | Boot/Reconnect; löst `snapshot` aus |
| `action_response` | `action_id`, `decision` (`approve`/`decline`), `ms` (Touch-Zeit seit `hello`) | Touch-Entscheidung |
| `ui_action` | `action` (`status_tap`, `focus_next`, `bubble_ack`), optional `ref` (≤ 36: Session-Kurz-ID bzw. `bubble_id`), `ms` | Touch ohne Entscheidung (ADR-0009). Schema ist `additionalProperties:false` und kennt weder `decision` noch `action_id` (W9); der Handler im Companion kennt den `DecideClient` nicht |
| `resync` | `last_seq` | Lücke erkannt → neuer `snapshot` |
| `stats` | `fps`, `heap_free`, `heap_min`, `uptime_s`, `rx_overrun`, `parse_err` | alle 30 s; `fps` ist die **Renderkapazität** des letzten 5-s-Fensters mit ≥ 3 gezeichneten Bildern (Bilder je Sekunde Zeichenzeit samt Push, T2.10), kein Boot-Mittel und nicht die Schleifenfrequenz |
| `log` | `level`, `msg`, optional `fields` | Firmware-Log (rate-limitiert, §7 observability) |

`decision` wird im Link `approve|decline` genannt; der Companion übersetzt auf
das Hub-Vokabular (`approve|reject`, `DecideApprovalInput`). Die Übersetzung ist
**eine** getestete Funktion, nirgends sonst.

### 4.3 Heartbeat und Offline

PC sendet alle 5 s `heartbeat`. Ohne Heartbeat für 15 s geht Nyx in `offline`
(„schläft"). Offline ist ein eigener sichtbarer Zustand (kein Fehler) und zeigt
die **letzte Projektion gedimmt mit Zeitstempel** („seit hh:mm", K10-Analogie).
Der Companion sendet weiter Heartbeats, wenn nur der **Hub** nicht erreichbar
ist, mit `hub:"down"`; Nyx geht dann ebenfalls `offline`, der Ticker nennt den
Grund („Hub nicht erreichbar"). So sind „USB weg" und „Hub weg" unterscheidbar.

**Umsetzung (T4.3):** Der Ticker zeigt zwei Zeilen: `veraltet seit hh:mm` (lokale Zeit aus dem
letzten bestätigten `ts` plus `utc_offset_min`; ohne Offset mit Zusatz `UTC`, bei unlesbarem
`ts` `veraltet, Zeit unbekannt`) und den Grund `Link weg` (Heartbeat blieb aus) oder `Hub weg`
(`hub:"down"`). Ein Heartbeat oder Snapshot mit `hub:"down"` überschreibt den „letzten guten"
Zeitstempel nicht. Beim Wiederkommen wird der Ticker geleert. Logik: `firmware/src/state/offline_info`.

### 4.4 Reihenfolge, Lücken, Idempotenz

- `seq` steigt pro Link-Sitzung monoton (Reset bei `hello`) und zählt **alle** PC→ESP-Frames
  (heartbeat, notification, bubble, session_focus, state_change, action_*). Springt `seq` bei
  einem beliebigen davon, sendet die Firmware `resync`; der Companion antwortet mit `snapshot`.
  Ein `snapshot` verankert den Zähler neu. (BUG-0006: vorher prüfte die Firmware nur `state_change`
  und meldete nach jedem Heartbeat eine Scheinlücke.)
- Der Companion führt pro `action_id` **höchstens eine** Entscheidung an den Hub
  aus (Dedupe-Menge, in `data/` als JSONL persistiert, nach Neustart geladen).
  Doppeltippen, Wiederholung nach Reconnect und verspätete Antworten erzeugen
  keinen zweiten `decide`-Call (Hub-seitig zusätzlich ADR-0019: „höchstens
  einmal").
- Antwortet der Hub 4xx/422 (schon entschieden, abgelaufen; live 2026-11-11
  belegt, §4.5), holt der Companion den Approval-Status und sendet
  `action_result{stale|timed_out|approved|rejected}`.
  Die Anzeige zeigt nie ein Ergebnis, das der Hub nicht bestätigt hat.

### 4.5 Hub-Verifikation AV-V1 (T1.1, belegt 2026-11-03 am laufenden Hub 127.0.0.1:7373)

- `agent:voidwarden` (read-only, ADR-0001) erhält **200** auf `GET /api/health`,
  `/api/ready`, `/api/sessions` (flache Liste; `/api/sessions/:id`),
  `/api/approvals` (Liste; `/api/approvals/:id`), `/api/notifications`.
- `GET /api/approvals` liefert **default alle** Approvals inklusive
  entschiedener; offene Freigaben werden über **`?status=pending`** gefiltert
  (leere Liste = nichts offen). `?sessionId=` existiert ebenfalls. Der
  Companion pollt also `?status=pending`.
- `POST /api/approvals/:id/decide` mit agent-Token → **403** „Nicht erlaubt für
  agent:voidwarden: approvals.decide" — auch bei **unbekannter** ID (Policy
  prüft vor Existenz, kein Info-Leak). Least Privilege damit live belegt.
- Zeitstempel (`createdAt`/`timeoutAt`/`decidedAt`): ISO-8601 UTC **mit
  Millisekunden**, z. B. `2026-10-31T12:09:41.118Z`.
- Konflikt-Status-Codes (T3.10, belegt 2026-11-11 am laufenden Hub mit dem
  `display:`-Token, ADR-0048): beide Konfliktfälle antworten **422** (nicht 409 —
  der Platzhalter hier erwartete falsch):
  - „schon entschieden“ — zweiter `POST /api/approvals/:id/decide` auf dieselbe
    `action_id` → **422** mit `{ok:false, detail:"already rejected"}`; der erste
    decide selbst ist **200**.
  - „abgelaufen“ — decide nach `timeoutAt` (Hub lazy `timed_out`, 60 s Default)
    → **422** mit `detail:"already timed_out"`.
  Der Companion behandelt beides über denselben 4xx-Pfad (§4.4: Status holen,
  `action_result{stale}`); `test:hub` assertiert beide Codes.

## 5. Zustandsmaschine Nyx

> **Stand Atlas v2 (2026-11-04, vorgezogener Teil von EPIC-P5/ADR-0006):** Die Figur
> kommt aus `assets/nyx/` (64×64, 12 Körperfarben, violett; Halo statt Void-Orb). Die
> Augen sind Marker, die die Firmware je Zustand färbt: idle `#AF72FF`, listening und
> executing `#45E4F7`, approval_pending `#FF9F43`, success `#FFE38A`, error `#FF526E`,
> offline `#737185` (mid 75 %, dim 50 %). Frame-Anzahl und -Dauer stehen im Atlas
> (7/5/4/6/3/4/4 Frames; 130/110/150/90/120/90/200 ms). Die folgende Palette gilt nur noch
> für den Ticker und die Zustandstabelle; Aktivitäts-Varianten (grün, blau) und Clips
> bringt P5.
>
> **Lebendigkeit ohne neue Frames (vorgezogen aus P5, 2026-11-04):** Blinzeln über den Augen-
> LUT (§5.2), Puls der Augen in listening (800 ms) und approval_pending (600 ms), ein
> 7×7-Zweitsignal oben rechts (success Haken, approval_pending „!“, error Warndreieck,
> offline Kreuz) und ein umlaufender Ring um den Kopf in executing (ohne Prozentwert).
> Alles in Augenfarbe, prozedural, nur im Renderer; Silhouette und Atlas bleiben
> unverändert.

Palette (fest; 6 definierte Token, bis zu 6 weitere Dithering-Zwischentöne,
**max. 12 Farben** gesamt):

| Token | Hex | Verwendung |
|---|---|---|
| VOID_BLACK | `#0A0A0F` | Hintergrund |
| VOID_GRAY | `#1C1C26` | Silhouette/Kapuze |
| VOID_VIOLET | `#7B2FBE` | idle / neutral |
| NEON_CYAN | `#00E5FF` | arbeitend / aktiv |
| ALERT_AMBER | `#FFB300` | Freigabe nötig |
| ERROR_RED | `#FF3355` | Fehler |

| Zustand | Frames | Loop | Farbe | Trigger (Companion-Aggregation, §5.1) |
|---|---|---|---|---|
| idle | 6–8 | langsam | VIOLET | keine Session aktiv |
| listening | 4–6 | pulsierend | CYAN weich | ≥ 1 Session `starting`/`working` |
| approval_pending | 4 | Amber-Glow | AMBER | ≥ 1 offene Freigabe (`pending`) |
| executing | 6 | Fortschrittsring | CYAN schnell | Freigabe vom Gerät bestätigt, Operation läuft |
| success | 3 | einmalig | CYAN-Flash | Operation `done` (ADR-0019) |
| error | 4 | Glitch-Loop | ROT | Session `error` oder Operation `failed` |
| offline | 4 | schlafend, gedimmt | — | Heartbeat-Timeout (15 s) oder `hub:"down"` |

Übergänge: prozeduraler 3-Frame-Glitch-Morph (Zeilenversatz, Farbflackern,
Noise) — keine vorberechneten Übergangs-Frames.

### 5.1 Aggregation und Priorität

Ein Zustand für das ganze System. Priorität, höchste zuerst:
`offline` > `approval_pending` > `error` > `executing` > `success` (transient,
~1,5 s) > `listening` > `idle`. Quelle ist ausschließlich der Hub-Zustand
(`SessionStatus` aus `@ancientvoid/contracts`: `idle, starting, working,
waiting_approval, parked, stopping, stopped, interrupted, error`; Approvals; Operationen).
Mapping `waiting_approval`+pending Approval → `approval_pending`; `parked`,
`stopped`, `interrupted` → `idle` (unterbrochene Läufe sind kein Agent-Fehler,
AncientVoid ADR-0044; ihre Sichtbarkeit kommt über `/api/notifications` in den
Ticker). Ein nicht abbildbarer Hub-Status ist ein
Protokollfehler: sichtbar als `error`-Ticker „unbekannter Hub-Status", nie
stilles `idle`.

Mehrere offene Freigaben: Nyx zeigt die **älteste** (kürzeste Restzeit); nach
Entscheidung rückt die nächste nach; Zähler „+N" im Ticker.

### 5.2 Idle-Life-System

Blinzeln (alle 4–9 s, `IdleLife` mit injizierbarem Seed, nur in idle, listening, executing,
success; nie in offline, error, approval_pending). Blickrichtung und Medaillon-Glimmen
brauchen Clips (P5/P10). Display dimmt nach konfigurierbarer Inaktivität; `approval_pending`
und `error` wecken mit Amber-/Rot-Glow (Wake-on-Event). Idle-Life darf nie
einen Zustandswechsel verzögern.

## 6. Assets

- Sprite 64×64 px, PNG-Atlas (`assets/nyx/nyx-atlas.png` + `.json`, 33 Frames) → Build-
  Schritt (`npm run assets`) erzeugt das LittleFS-Image `nyx.spr` im Format NYX2
  (ADR-0006); Skalierung auf dem Display ganzzahlig ×3 (192×192, darunter 24 px Ticker).
- Palette: Index 0 transparent (Renderer setzt `#0A0A0F`), 1–3 Augenmarker
  (`#FF00FF`/`#C000C0`/`#800080`, nur im Augenband; Firmware und Web-Kiosk tauschen
  sie je Zustand, BUG-0016), 4–15 höchstens 12 Körperfarben.
- Figur: gothische Kapuzenfigur mit Halo, Runen-Stola und Kette; Lichtquellen = Augen +
  Halo. Quelle und Herkunft: `assets/nyx/README.txt` (Pixel-Art-Produktion außerhalb des
  Repos, Aseprite-Quelle liegt bei).
- Asset-Pipeline (`tools/assets`) ist deterministisch: gleiche Quell-PNGs →
  byte-gleiches Image; geprüft werden Körperfarben (>12 = Build-Fehler), binäres Alpha,
  Marker-Zeilenband und Zustandsnamen (≤ 16 Zeichen). Das Format `NYX1` wird von der
  Firmware abgelehnt, nicht still falsch gerendert.
- Schrift muss `äöüß` enthalten (UI Deutsch). Code/Schema/Logs Englisch.
- Quell-PNGs sind Repo-Inhalt (`assets/`); generierte Images nicht.

## 7. Touch-UX

- Approve/Decline: zwei Zonen, je ≥ 100 px Kante, einhändig erreichbar;
  Decline ist immer Einzeltipp.
- Approve = Einzeltipp, außer die Aktion steht in `criticalActions` der
  Config (Default: leer) → Slider-Bestätigung. `destructive` und
  `reasonRequired` sind nie am Gerät entscheidbar (§1).
- Am Web-Kiosk (BUG-0015): bei Bedarf erscheint ein Aufmerksamkeits-Symbol neben
  Nyx; Tippen öffnet ein Popup mit Freigabetext und kleinen Tippen-Buttons
  (Freigeben/Nein). Das Öffnen des Badges ist die bewusste Geste (ersetzt die
  frühere Hold-Zone am Band). Keine Tastatur/`<input>` am Kiosk. Hör-Eingabe
  füllt nur den geteilten Session-Entwurf im AncientVoid-Composer (ADR-0025 /
  AncientVoid ADR-0069) — nie Steer/Prompt und nie Freitext an `decide`
  (ADR-0012). `ui.approveGesture` bleibt Config für ältere Clients; das Board
  liest den Schlüssel nicht.
- Fragen des Agents (`kind=question`, `AskUserQuestion`): gleicher Screen mit Kopfzeile „FRAGE“, ohne
  Zonen und mit dem Hinweis „Am Rechner beantworten“. Eine Frage ist nie am Gerät entscheidbar, auch
  nicht bei falsch gesetztem `decidable` (Companion, Parser und `ApprovalFlow` prüfen es je einzeln, W9).
- Letzter Report (Ticker): Die jüngste `notification` bleibt im Tickerband stehen, auch im Leerlauf;
  der Offline-Hinweis hat Vorrang. Der Companion sendet die jüngste Meldung nach jedem `snapshot`
  erneut (K7), die Firmware zeichnet bei gleichem Text nicht neu. Das Gerät zeigt nur Hub-Text,
  nie als Aktion (ADR-0004). Im Normalbetrieb ist der Report die letzte Agent-Nachricht der fokussierten
  Session (Titel = Projektname), `info`/`success`-Meldungen verdrängen sie nicht (ADR-0010); der Tap-Status
  nennt sie als „Zuletzt: …". Der Sessionname links oben ist der Projektname.
- Blase und Fokus (ADR-0009): Eine Blase steht rechts in einer 120-px-Spalte (20 Zeichen je Zeile; kurze
  Blasen mit Titel ≤ 20 und Text ≤ 40 Zeichen in doppelter Größe, 10 Spalten), Nyx
  rückt dann nach links; der Text erscheint per Typewriter (25 ms je Zeichen), Fehler und kritische
  Blasen sofort voll. Eine Blase überdeckt nie eine Freigabe; eine unquittierte kritische wird von
  nichts Niedrigerem verdrängt. Tap auf Nyx sendet `ui_action{status_tap}` (Status der fokussierten
  Session als Blase); bei ≥ 2 Sessions zeigt der Indikator oben rechts „n/N“ samt Statussymbol, Tap
  darauf sendet `focus_next`. `ui_action` trägt nie eine Entscheidung (W9).
- Touch-Entprellung ≥ 150 ms; nach Absenden sind die Zonen bis `action_result`
  gesperrt (kein Doppel-Senden, Spinner/Ring).
- Visuelles Feedback ≤ 100 ms nach Touch, unabhängig von der Hub-Antwort.
- Ticker: max. 2 Zeilen, automatisch scrollend; Tap = Detailansicht (liest nur).
- Swipe-Navigation zwischen Agent-Karten: nach P12.

## 8. Konfiguration

Eine Datei `voidwarden.config.json` (Beispiel eingecheckt, echte Datei und
Token git-ignored). Schlüssel, Defaults und Wertebereiche sind im JSON-Schema
`protocol/config.schema.json` definiert. Pflicht: `hub.url`, `hub.tokenFile`
(Pfad, nie der Token selbst), `serial.path` (oder `auto`), `serial.baud`
(921600), `heartbeat.intervalMs` (5000), `heartbeat.timeoutMs` (15000),
`poll.intervalMs` (1500), `ui.dimAfterS`, `ui.criticalActions` (`[]`). Optional (ADR-0009): `ui.focusHoldS` (30, Rückfallzeit nach
manuellem Session-Wechsel), `ui.chatter.enabled` (`true`), `ui.chatter.minGapS` (90, mindestens 60 wegen W12),
`ui.chatter.jitterS` (60). Optional (EPIC-P13 T13.5, ADR-0012): `ui.approveGesture` (`"tap"` | `"hold"`, ohne
Default; nur der Web-Kiosk liest ihn, Client-Standard dort `hold`).
Tokens: nur Hash im Hub, im Companion nur als Datei mit Modus `600`.

## 9. Messlatten

VoidWarden-eigene Messlatten **W1–W9**, jede mit Bezug auf PRD §9 K1–K10 von
AncientVoid. Jedes Epic nennt die berührten W-Nummern; Verletzungen sind
Testfehler, keine Notizen. Messläufe nach [`observability.md` §5](observability.md).

| ID | Messlatte | Zielwert | K-Bezug |
|---|---|---|---|
| W1 | Approve-Latenz am Companion: `action_response` empfangen → Hub-2xx | p95 ≤ 500 ms (Gesamtbudget K1 < 5 s bleibt unberührt) | K1 |
| W2 | Zustandsänderung im Hub → sichtbar auf Nyx; Companion-Coalescing bei 30 ev/s Hub-Last | p95 ≤ 2,5 s; ≤ 10 Frames/s auf dem Link; `rx_overrun` = 0 | K2 |
| W3 | Renderer-Framerate (echtes Board) | Renderkapazität ≥ 25 fps (`stats.fps`, aus der Dauer der gezeichneten Bilder), kein Bild > 80 ms im Dauerlauf; der Renderer zeichnet nur bei Änderung (Dirty-Rect), die Leerlauf-Schleife zählt nicht | — (Hardware-Messlatte) |
| W4 | Frame-Größe auf dem Link; Textlängen | ≤ 512 B; title ≤ 40; body ≤ 2×80; Überschreitung = Fehler, nie Truncate im Protokoll | K5 |
| W5 | Wiederherstellung: ESP-Reset **oder** Companion-Neustart **oder** Hub-Restart → korrekter Zustand | ≤ 3 s nach `hello`/Hub-Rückkehr; 100 % identisch zu Hub-Zustand | K7 |
| W6 | Ausfall sichtbar: USB getrennt / Companion tot / Hub down | `offline` ≤ 15 s (Hub down: ≤ 10 s), letzte Projektion + Zeitstempel, kein schwarzer Schirm | K9, K10 |
| W7 | Companion-Ressourcen | CPU ≤ 15 % eines Kerns im Idle (Ziel ≤ 3 %); RSS ≤ 150 MB | — |
| W8 | 24-h-Soak (echtes Board, simulierte Hub-Last) | 0 unerholte Disconnects; `heap_min`-Drift ≤ 5 %; 0 Abstürze | K7 |
| W9 | Fehlentscheidungs-Schutz | 0 doppelte `decide`-Calls je `action_id` (Property-Test); 0 Entscheidungen auf `decidable:false`; 0 Auto-Decline am Gerät | PRD §8 |

K3, K4, K6, K8 betreffen VoidWarden nicht (kein Diff, kein MCP, keine
Sprach-zu-Text-Strecke, kein Adapter). Die geplante Sprachausgabe (EPIC-P9) misst
W13, nicht K6.

### 9.1 Geplante Messlatten W10–W15 (Soll, aktiv ab dem genannten Epic)

Zielwerte sind Vorgaben aus dem Blueprint-Abgleich, **keine Messwerte**. Das
erste Epic setzt sie per Messlauf durch oder korrigiert sie per ADR.

| ID | Messlatte | Zielwert | Bezug | Ab |
|---|---|---|---|---|
| W10 | Wahrhaftigkeit der Anzeige | 0 falsch-grüne Zustände; kein Fortschritt/Status ohne Hub-Beleg; `unknown`, `stale`, `offline` sichtbar statt `healthy`; alte Daten überschreiben neue nie (Tabellen-/Property-Test) | K9, K10, Regel 7 | P7 |
| W11 | Touch: Reaktion und Zuverlässigkeit | Feedback ≤ 100 ms; Tap auf Nyx → Blase p95 ≤ 1 s; 1000 Interaktionen am Board: 0 Doppel-Auslösungen; 0 `decide` aus `ui_action` (W9) | K1-Analogie | P6 |
| W12 | Blasen-Disziplin | 0 identische Blasen im Dedupe-Fenster; automatisch höchstens 1 je 60 s ohne neuen Zustand; Fehler ≥ 12 s, Erfolg ≈ 4 s; kritisch nie ohne Ack verdeckt | K2-Analogie | P8 |
| W13 | Sprachkontrolle | `ttsEnabled=false` → 0 Audiostarts (Property-Test); OFF → Stille ≤ 300 ms; höchstens 1 Stimme; Quiet Hours → 0 Autoaudio; Sprechtext ≤ 180 Zeichen, nur Vorlagen; Tap → Tonstart p95 ≤ 2 s | PRD §8.5 | P9 |
| W14 | Asset-Integrität | byte-gleiche Doppelläufe; Linter: Pivot, Maße, Tags, Augenmaske, ≤ 12 Körperfarben; Image ≤ 1,2 MB; keine Poster-Herkunft | Regel 1 | P5 |
| W15 | Layout-Treue | je Screen/Profil Golden-Bild; 0 Überlappungen Nyx/Text/Steuerflächen; Steuerflächen ≥ 44 px, Entscheidung ≥ 100 px, Zeilen ≥ 32 px; Foto am Board | Lesbarkeit | P6 |

## 10. Sicherheit

1. **Least Privilege:** Der Companion nutzt einen eigenen Token. Bis EPIC-P3
   *nur lesend* (`agent:voidwarden`, Policy `read`=allow,
   `approvals.decide`=deny — ADR-0021 in AncientVoid). Entscheiden darf er erst
   mit dem Akteur `display:<name>` (ADR-0001, AncientVoid ADR-0048, MR !290);
   **ein menschliches Geräte-Token darf nie hinterlegt werden.**
2. **Prompt-Injection-Grenze:** Titel/Body stammen aus Agent- und Provider-
   Output. Sie werden gekürzt, von Steuerzeichen befreit und nur gerendert.
   Kein Pfad vom Text zu einer Aktion.
3. **Kein Auto-Decline, kein Auto-Approve am Gerät** (ADR-0004): Ablauf liefert
   der Hub (`timed_out`); das Gerät zeigt ihn nur an.
4. **Secrets:** Token nie in Logs, Config-Commits oder Frames; Redaction-Liste
   wie ADR-0010 von AncientVoid.
5. **Fail loud:** Link- und Hubfehler werden Events/Ticker/Logs, nie still
   gedroppt.

## 11. Geplante Erweiterung aus dem Blueprint (Soll, noch nicht umgesetzt)

Dieser Abschnitt ist Planung und beschreibt **kein** vorhandenes Verhalten. Das
umsetzende Epic überführt seinen Teil in §1–§10 **im selben Commit** wie die
Verhaltensänderung und streicht ihn hier. Entscheidungen: ADR-0005 bis ADR-0008.

| Bereich | Soll | Ersetzt/ändert später | Epic |
|---|---|---|---|
| Figur, Palette, Frames | Gothic-Tech-Kanon; 64×64; `NYX2`; Augen per LUT; Komposition Basis/Overlay/One-Shot | §5 Palette, §5.2, §6 | P5 |
| Idle-Life | Blinzeln, Blick, Hover aus Clips statt Orb | §5.2 | P5 |
| Screens, Touch | sieben Screens, drei Touch-Klassen, Display-Profile (2,8" zuerst, umstellbar), `ui_action`, `settings_state` | §4, §7, §8 | P6 |
| Mehr-Agenten-Überblick | Zeilen, Detail, Zähler, `stale`, `unknown`, Verlauf, Fokus | §4, §5.1 um `activity` | P7 |
| Sprechblasen, Tap auf Nyx | `bubble`, `Composer`; ersetzt den Ticker als Anzeige, Fail-loud bleibt | §4, §7 Ticker | P8 |
| Interaktive Session-Nyx | `ui_action`, `session_focus`, `action_request.kind`; Fokus-Priorität, Tap-Status, Idle-Chatter, Fragen nur Anzeige (ADR-0009) | §4, §5.1, §7 | P3, P7, P8 (vorgezogen) |
| Sprachausgabe | `Speaker`, Queue, Einstellungen, Quiet Hours, `speech_state` | §1 Zweck, §3, §4, §8, §10 | P9 |
| Sonderanimationen, reduzierte Bewegung | 14 Clips, Sonderfarben, `reducedMotion`, Nachtmodus | §5, §7 | P10 |
| Betrieb, Release | Autostart, Retention, 1000-Touch, Release-Soak, DE/EN | §8, §10 | P11 |

### Ergänzung 2026-11-11: Hivemind-Stimme im Web-Kiosk (P11 T11.10)

Für den bereits vorhandenen Web-Kiosk darf der Companion eigene TTS-Dienste
auf Hivemind über LAN/Tailnet ansprechen (ADR-0013, W9/W13). Das Beispielprofil
nutzt Qwen3 VoiceDesign auf `http://100.74.58.126:18801/tts`, alternativ ist
Voxtral-4B-TTS auf Port `18802` wählbar. Beide sprechen dieselbe `/tts`-API;
der Server wählt die zur Sprache passende Standardstimme. Kein automatischer
Fallback und keine generierten Statusformulierungen. Für beide Profile gilt
Speed/Tempo 1, Pitch 0, Timeout 120000 ms; TTS bleibt standardmäßig deaktiviert.
Automatische Ansagen verwenden sechs deutsche Vorlagen je Zustand. Dringende
Meldungen enthalten keinen poetischen Anhang und keine Approval-IDs. Der
ESP32-Link und die Zustands-/Freigabehoheit des Hubs bleiben unverändert.
