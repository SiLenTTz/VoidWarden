# Testing — verbindlich

Stand: 2026-11-02 · Messlatten: [`spec.md` §9](spec.md) (W1–W9) · Rezept für
Agenten: Skill `write-tests`. Ein Epic gilt erst als abgeschlossen, wenn
`npm run gate` lokal grün ist und alle **sichtbaren Skips** benannt sind.

## 1. Pyramide

| Ebene | Was | Werkzeug | Läuft ohne Hardware |
|---|---|---|---|
| Unit (Companion) | `aggregate`, Protokoll-Encode/Decode, Kürzen/Sanitizing, Status-Übersetzung, Dedupe | `node --test` | ja |
| Contract | Goldene Fixtures `protocol/fixtures/*.ndjson` gegen Schema — **beide Seiten** | `node --test` (Companion), Unity `native` (Firmware) | ja |
| Unit (Firmware) | Zustandsmaschine, Parser, Entprellung, Slider-Logik, Idle-Randomizer (mit festem Seed) | `pio test -e native` | ja |
| Integration | Companion ↔ Fake-Hub (HTTP) ↔ `MemoryLink`/PTY-Sim; Reconnect, Backoff, Hub-Restart | `node --test` | ja |
| Gegen echten Hub | Companion gegen laufenden AncientVoid-Hub (Dummy-Adapter), echte Approval | `npm run test:hub` | braucht Hub; skippt sichtbar |
| HIL (Hardware-in-the-Loop) | echtes Board: Handshake, Render-fps, Touch, Soak | `npm run test:hil` | braucht Board; skippt sichtbar |
| Messlauf | W1–W9 mit Zahlen | `scripts/messlauf-*.mjs` | teils |

## 2. Regeln

1. **Rot-dann-grün.** Neues Verhalten und jeder Bugfix: zuerst ein Test, der
   ohne die Änderung scheitert; im MR/Commit belegen.
2. **Kein Test gegen Zufall und Uhr.** Zeit (`now`, Timer) und Zufall (Idle-
   Randomizer) werden injiziert. Firmware-Randomizer läuft im Test mit festem
   Seed; Companion nutzt eine `Clock`-Abstraktion (Fake-Timer).
3. **Contract-Fixtures sind Pflicht.** Jedes Frame-`type` hat mindestens ein
   gültiges und ein ungültiges Fixture (zu lang, falsche Typen, unbekanntes
   `type`, fehlendes `v`). `npm run check:protocol` stellt sicher, dass
   Companion **und** Firmware dieselben Fixtures konsumieren.
4. **Fail-loud ist testbar:** Für jeden Fehlerpfad aus
   [`architecture.md` §4](architecture.md) existiert ein Test, der die
   *Sichtbarkeit* prüft (Log-Eintrag, `log`-Frame, Ticker-Text, Zähler), nicht
   nur „kein Absturz".
5. **Sicherheits-Invarianten als Test (W9):**
   - Property-Test: beliebige Folgen aus `action_response`, Reconnects, Doppel-
     tipp → je `action_id` höchstens ein `decide`-Call am Fake-Hub.
   - `decidable:false` (destructive, `reasonRequired`) → Touch erzeugt nie eine
     `action_response`.
   - Gerät sendet nie ein `decline` aufgrund eines Timeouts.
   - Titel/Body mit Steuerzeichen, ANSI, überlangem Text → bereinigt/gekürzt.
   - Token erscheint in keiner Log-Zeile (Redaction-Test).
6. **Sichtbare Skips.** `test:hub` und `test:hil` brechen ohne Voraussetzung
   *nicht* ab, sondern melden `SKIP: <Grund>` und werden in Gate-Ausgabe und MR
   genannt. Ein Skip zählt **nie** als Pass; Epic-Abnahme verlangt, dass die
   für die ACs nötigen HIL-/Hub-Läufe real gelaufen sind (Beleg im Messlauf).
7. **Keine Roh-Logs/Seriennummern in Fixtures.** Fixtures sind anonymisiert und
   secret-gescannt.

## 3. Aggregations-Tabelle (Pflicht-Testfälle)

`aggregate()` wird tabellengetrieben getestet; mindestens: alle
`SessionStatus`-Werte einzeln; Mischungen (working+error → `error`; pending
Approval + error → `approval_pending`); Approval `timed_out` → Rückfall;
`parked`/`stopped` → `idle`; leerer Hub → `idle`; unbekannter Status →
Protokollfehler-Pfad (kein `idle`); Hub down → `offline`; mehrere Approvals →
älteste zuerst, Zähler korrekt.

## 4. Simulator und Hub-Attrappe

- `companion/src/sim/` ist ein Fake-ESP32 (spricht Protokoll v1 über PTY/Memory):
  sendet `hello`, `stats`, `action_response`, kann Lücken, Müll, Überlänge und
  Stille erzeugen. Er ist das Abnahme-Werkzeug von EPIC-P1.
- Der Fake-Hub ist ein kleiner `node:http`-Server, der die in
  `architecture.md` §3 verifizierten Routen mit Zod-validierten Antworten
  (`@ancientvoid/contracts`) nachstellt. Weicht er vom echten Hub ab, gewinnt der
  echte Hub: Abweichung = Bug im Fake plus Fixture-Update.

## 5. Gate

```bash
npm run typecheck    # tsc --noEmit (Companion, Protocol)
npm run lint         # eslint (JS/TS) + clang-format --dry-run (Firmware, falls vorhanden)
npm test             # node --test: Unit + Contract + Integration
npm run test:fw      # pio test -e native
npm run build:fw     # pio run -e esp32 (Kompiliert; kein Flash)
npm run check:protocol   # Fixtures beidseitig
npm run check:assets     # Asset-Linter (assets/nyx/, Ausnahmen in lint-exceptions.json)
npm run check:commits    # Commit-Notation
npm run gate         # alles oben
npm run test:hub     # optional/sichtbarer Skip
npm run test:hil     # optional/sichtbarer Skip
npm run assets       # Atlas → firmware/data/nyx.spr (NYX2), Font
npm run preview:nyx  # Host-Vorschau aller Zustände/Frames → data/preview/ (kein Gate)
```

Pflicht vor jedem Commit-Vorschlag: `test`, `lint`, `typecheck` (bei Firmware-
Änderungen zusätzlich `test:fw` + `build:fw`). Vor Epic-MRs: `gate` plus die
HIL-/Hub-Läufe, die die Epic-ACs verlangen. Die Kommandos entstehen in
EPIC-P0 T0.2; **bis dahin ist `gate` nicht verfügbar** und Epics dürfen nicht
beginnen (Gating).

## 6. Messläufe

Ablage `docs/messlauf/YYYY-MM-DD-<thema>.md` (Skill `messlauf`): Messgröße,
Methode, Gerät/Board-Typ, Commit, Rohzahlen (n ≥ 20 für Latenz-p95), Urteil
gegen W-Nummer, „Was das nicht sagt". Zahlen werden nur zitiert, wenn ein
Messlauf sie belegt.
