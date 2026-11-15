# ADR-0011 — Web-Client als PWA statt nativ

**Status:** akzeptiert (2026-11-06, EPIC-P10 T10.2) · **Betrifft:** `companion/src/web-server.ts`,
`web/`, `protocol/` · **Ändert:** — · **Protokoll:** Link-Protokoll `v:1` unverändert; der
WebSocket-Export ist ein Companion-Frontend, kein neues Link-Protokoll (kein `v`-Bump)

## Kontext

Ein zweiter VoidWarden-Client soll auf einem vorhandenen Android-Smartphone (OnePlus 6/8,
AMOLED) laufen — ohne das Gerät zu verändern (kein Root, keine APK-Installation, nur Chrome).
Gefordert: Dashboard, Session-Detail im Volltext, Idle-Ticker („Nyx erzählt", 5–15 min zufällig),
45-Minuten-Verfall, HITL-Kurzpfad für `write`-Freigaben, Attention-Signale (Sound + Vibration).
Zur Auswahl: native Android-App, TWA-Wrapping, PWA.

## Entscheidung

1. **PWA (Vite + TypeScript) im Repo-Workspace `web/`.** Alle geforderten Fähigkeiten sind mit
   Chrome-Web-APIs abdeckbar (Web Notifications, Vibration, Wake Lock, Web Audio, Service
   Worker). Eine native App bräuchte eine dritte Toolchain (Gradle/Android SDK) und verletzte
   das Ziel „Smartphone so lassen". Die PWA importiert die `protocol/`-TS-Typen direkt —
   Contracts-first bleibt strukturell gewahrt.

2. **WebSocket-Export im Companion, kein neues Protokoll.** Der Companion erhält ein opt-in
   `web`-Modul (`companion/src/web-server.ts`): ein WS-Server, der denselben
   Snapshot-/`state_change`-Strom ausspielt, den heute die Firmware per NDJSON erhält — plus
   `session.lastAssistantMessage` (Companion-Aggregation aus Hub-Events, Ergebnis T10.1) und
   einen Decide-Proxy. Die Frames sind JSON-Objekte mit `type`-Diskriminator, per Fixture in
   `protocol/` verankert (`check:protocol`). Das Link-Protokoll der Serial-Brücke bleibt
   unberührt: WS ist ein Companion-Export, kein Link-Protokoll; K5-Frame-Grenzen (≤ 512 B)
   gelten nur für den Board-Pfad, nicht für WS.

3. **Token-Trennung wie P1/P3 (Ergebnis T10.1, architecture.md §3).** Der WS-Datenstrom liest
   Hub-Daten mit dem read-only `agent:voidwarden`-Token (Companion-seitig, wie P1); der
   Decide-Proxy leitet Entscheidungen mit dem `display:web-1`-Token an
   `POST /api/approvals/:id/decide` weiter (wie P3). Der Hub erzwingt ADR-0048 serverseitig:
   `destructive`, `reasonRequired` und `tool.question` → 403; dieser Text wird im Client
   unverändert angezeigt (fail loud). Fragen (AskUserQuestion) sind im Web-Client damit nur
   lesbar — Epic-Notiz in architecture.md §3, kein Client-Workaround.

4. **Sicherheitsregeln (W9).** WS-Server bindet per Default auf Loopback/LAN-Interface
   (`127.0.0.1` bzw. konfigurierte LAN-Adresse) — kein `0.0.0.0` ohne expliziten Opt-in.
   Tokens nur als Datei (Modus 600), nie im Repo, nie in Logs; der Browser bekommt nie ein
   Hub-Token, er spricht nur mit dem Companion-WS. Kein Push über externe Dienste —
   Notifications nur lokal, solange der WS lebt. Payloads nie im Klartext-Log.

5. **Idle-Modell als Client-Zustand (T10.5).** Ticker-Intervall (5–15 min, zufällig, pro Tag
   geseedet — Displays ticken nicht synchron), 45-Minuten-Verfall und Tap-auf-Nyx sind reine
   Client-Zustände, gespeist aus dem WS-Snapshot-Strom; keine Protokoll-Änderung. Die Zeitlogik
   ist eine reine Funktion mit injizierbarer Uhr (Muster `companion/src/clock.ts`) und ohne
   `Date.now()`-Hardcoding testbar. `idleTicker.enabled: false` ist Feature-Flag ab Tag 1.

## Alternativen

- **Native Android-App (Kotlin/APK):** größte API-Garantie, aber dritte Toolchain im TS+C++-Repo,
  APK-Install bricht „Gerät unverändert lassen", Play-Store-Pflicht oder Sideloading. Abgelehnt.
- **TWA (Trusted Web Activity) ab Tag 1:** wäre nur ein Wrapper über derselben PWA; bringt
  Signing/Play-Secrets mit, ohne Mehrwert solange Chrome reicht. **Ausstiegspfad:** falls
  Web-APIs später nicht reichen (z. B. Kiosk-Enforcement), TWA-Wrapping der unveränderten PWA
  (PWA Builder) ohne Codeverlust.
- **Zweites Link-Protokoll / direkter Hub-WS im Browser:** würde Either die Hub-Isolation
  brechen (Browser bräuchte einen Hub-Token — Angriffsfläche) oder ein zweites Protokoll
  pflegen. Abgelehnt: der Companion ist die eine Verluststelle (Single point of translation),
  der Browser bleibt dumm und tokenlos.

## Folgen

- Der Web-Client läuft ohne laufendes Serial-Board (HITL am Smartphone validierbar, solange
  das Board nicht angeschlossen ist — HW-P0-A-Puffer).
- Firmware-Verhalten ist unberührt (AC-P10-6: A/B-Messlauf in T10.7 belegt Identität).
- Neue Runtime-Abhängigkeit `ws` im Companion gemäß ADR-0003-Zeile erforderlich; die PWA hat
  außer Vite-Dev-Dependencies keine.
- Messlatten W1/W2/W5/W6/W9 gelten auch für den WS-Pfad (Heartbeat/Dedupe/Reconnect analog P1).
