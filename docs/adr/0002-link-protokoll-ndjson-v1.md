# ADR-0002 — Link-Protokoll: NDJSON v1, Snapshot-Recovery, Heartbeat

**Status:** akzeptiert · **Betrifft:** `protocol/`, EPIC-P0, EPIC-P1, EPIC-P2, `docs/spec.md` §4

## Kontext

Companion und Firmware müssen ein Protokoll teilen, das auf dem ESP32 mit
festen Puffern parsebar ist, sich nach jedem Abbruch selbst heilt und
Fehler sichtbar macht. Die Init-Spezifikation empfahl NDJSON für den MVP und ein
Binärprotokoll bei Engpässen.

## Entscheidung

1. **NDJSON, UTF-8, `\n`-terminiert, ≤ 512 Byte je Zeile, `"v":1` in jeder Zeile.**
   Überlänge/Nicht-JSON = Protokollfehler (gezählt, als `log` gemeldet), nie
   stilles Truncate oder Drop.
2. **Quelle der Wahrheit ist `protocol/`** (JSON-Schema + goldene Fixtures);
   Companion (Zod aus dem Schema) und Firmware (native Tests) konsumieren
   dieselben Fixtures.
3. **Zustandslose Firmware:** `hello` (ESP) löst `snapshot` (PC) aus; `seq`-Lücke
   löst `resync` → `snapshot` aus. Der Zustand ist jederzeit aus dem Hub
   rekonstruierbar (K7-Prinzip, AGENTS.md Regel 4).
4. **Heartbeat** alle 5 s vom PC, Timeout 15 s → `offline`; `hub:"down"` im
   Heartbeat trennt „Link weg" von „Hub weg".
5. **Zusätze gegenüber der Init-Spec:** `hello`, `snapshot`, `action_result`,
   `resync`, `stats`, `log`, `decidable`, `seq`, `v`.
6. **Binärprotokoll:** nur per neuem ADR und nur mit Messung, die W2/W3
   verletzt. Bis dahin YAGNI.

## Konsequenzen

- Jeder neue Frame-Typ braucht Schema, gültiges + ungültiges Fixture und
  Einträge in `spec.md` §4 — im selben Commit.
- Inkompatible Änderung = `v:2` + Übergangsregel; additive Felder bleiben `v:1`.

## Umsetzung (EPIC-P0 T0.3, 2026-11-03)

- `protocol/schema/frame/<type>.schema.json` je Frame (draft-07, selbstenthalten,
  `$id` https://voidwarden.dev/...); Feldlängen (`title` ≤ 40, `body` ≤ 160,
  `msg` ≤ 200) stehen im Schema. Unbekannte Zusatzfelder sind schema-seitig
  erlaubt (additive Evolution, oben), werden zur Laufzeit aber gezählt und
  geloggt (Fail loud).
- **Die 512-Byte-Grenze ist ein Zeilen-/Byte-Urteil, kein JSON-Schema-Schlüssel:**
  erzwungen in `scripts/check-protocol.mjs` (Fixture-Prüfung), im Node-Contract-
  Test (`protocol/test/contract.test.ts`) und im Firmware-Parser (fester
  512-B-Puffer, P0-Gerüst prüft die Zeilenlänge der Fixtures echt; strukturelle
  Validierung folgt mit dem Parser in EPIC-P2 — sichtbares IGNORE).
- `protocol/config.schema.json` (spec.md §8) + eingechecktes Beispiel
  `voidwarden.config.example.json`; die echte Config bleibt git-ignored.
