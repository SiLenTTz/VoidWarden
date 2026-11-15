# ADR-0003 — Technologie: Node-Companion, PlatformIO-Firmware, kein LVGL

**Status:** akzeptiert (Messwerte aus T0.5 eingearbeitet; Grafikbibliothek offen bis P2 T2.1 — Blocker HW-P0-A) ·
**Betrifft:** `companion/`, `firmware/`, `docs/architecture.md` §2

## Entscheidung

1. **Companion: Node ≥ 22.5, ESM, TypeScript strict über Node-strip-types, kein
   Build.** Dieselben Syntaxgrenzen wie AncientVoid (keine Enums,
   Parameter-Properties, Namespaces; `.ts`-Imports), damit
   `@ancientvoid/contracts` direkt importierbar ist.
2. **Serial:** `serialport` ist die **einzige native Laufzeit-Abhängigkeit**
   (Prebuilds vorhanden). Gekapselt hinter dem Interface `Link`; Tests laufen auf
   `MemoryLink`/PTY ohne native Module. Fällt `serialport` unter Node-Updates
   aus, ist der Rückfall `stty` + `node:fs`-Streams (nur Linux) — als Task, nicht
   vorab gebaut.
3. **Tests:** `node --test` (stdlib), kein vitest-Zwang; Lint ESLint; Typecheck
   `tsc --noEmit`.
4. **Firmware:** PlatformIO, Arduino-Framework, C++17, gepinnte Libs. Hosttests
   über `pio test -e native` (Unity); Logik (`protocol`, `state`, `touch`-Logik)
   ohne Arduino-Includes.
5. **Rendering:** LovyanGFX oder TFT_eSPI mit Sprite-/Dirty-Rect-Rendering;
   **kein LVGL** im MVP (kein Widget-Bedarf, RAM/Flash). Endgültige Wahl der
   Grafikbibliothek trifft EPIC-P2 T2.1 nach Messung am echten Board
   (Heap, fps, Treiberunterstützung des Waveshare-Panels) und ergänzt dieses ADR.
6. **Persistenz:** nur Dateien (JSONL) unter `data/`; `node:sqlite` nur mit ADR.

## Konsequenzen

- Neue Laufzeit-Abhängigkeit oder Bibliothek in der Firmware = Zeile in diesem
  ADR (Name, Version, Grund).
- Die Hardware-Zahlen (Heap, Flash) stehen mit Messlauf-Verweis in der Spec
  (siehe Abschnitt „Messwerte aus EPIC-P0 T0.5"); fps folgt nach Behebung des
  Blockers HW-P0-A.

## Messwerte aus EPIC-P0 T0.5 (2026-11-03, Messlauf `docs/messlauf/2026-11-03-p0-hardware-spike.md`)

- Board: **ESP32-D0WD-V3**, Rev 301, 4 MB Flash @ 40 MHz, **kein PSRAM**,
  330.640 B Heap frei nach Boot (Spike-Firmware). ⇒ Vollbild-Framebuffer
  ausgeschlossen, Dirty-Rect zwingend; 4 MB Flash erzwingen ~2,25 MB App +
  ~1,75 MB LittleFS (Sprite-Asset-Budget für P2).
- Serial: 921600 Baud, 10 min Volllast (~98 % Linienlast), Byte-exakter Echo:
  **verlustfrei** (Standard-RX-Puffer des Arduino-Cores reicht für Echo-Last).
- LittleFS: 65.585-B-Testdatei CRC-bestätigt gelesen; Partition muss das Label
  `spiffs` tragen (Arduino-Bindung findet Label, nicht Subtyp).
- Grafikbibliothek: **LovyanGFX 1.2.36** (T0.5-Endmessung: 50,6 fps Sprite-Dirty-
  Rect, max 19,9 ms — W3 mit 2× Reserve). 1.2.0 ist mit arduino-esp32 3.x
  inkompatibel (i2c-Treiberkonflikt → Boot-Loop); unter 25 fps wäre TFT_eSPI
  als Alternative zu messen gewesen (nicht nötig). Slowpath-Vermeidung:
  Transparent-Push durch fillRect-Löschen ersetzt.

## Laufzeit-Abhängigkeiten (Stand EPIC-P1 T1.3)

| Paket | Version | Grund |
|---|---|---|
| `serialport` | ^13 (prebuilds) | einzige native Abhängigkeit: USB-Serial zum ESP32, hinter `Link` gekapselt (Tests/Sim auf `MemoryLink`) |
| `zod` | ^4.6.5 | Schema-Validierung wie AncientVoid; Version folgt `@ancientvoid/contracts` |
| `@ancientvoid/contracts` | file:../../AncientVoid/packages/contracts (0.1.0) | Hub-Contract-Typen (Hub-Isolation: einziger AncientVoid-Import) |

Dev-Abhängigkeiten (eslint, typescript, ajv, @types/node, …) sind kein
Laufzeit-Fall und stehen in `package.json`.

## Vorgemerkt für EPIC-P5 und EPIC-P9 (noch nicht in Betrieb)

Keine npm-Laufzeit-Abhängigkeit. Version, Lizenz und Bezug setzt die genannte
Aufgabe als feste Zeile; ohne diese Zeile geht das Werkzeug nicht in Betrieb.

| Werkzeug | Art | Grund | Bindet |
|---|---|---|---|
| Piper | externer Prozess, optional | lokale Sprachausgabe (ADR-0008) | T9.1 |
| `espeak-ng` | externer Prozess, optional | Rückfall ohne Piper-Stimme (ADR-0008) | T9.1 |
| Aseprite oder LibreSprite | Dev-Werkzeug, kein Build-Muss | Quelle des Atlas (ADR-0006) | T5.2 |

## Korrektur BUG-0001 — Panelprofil (2026-11-03, Farbtest am Board bestätigt)

Die bisherige ST7796-/480×320-Annahme ist für das angeschlossene
ESP32-2432S028R falsch. Selbst der einfache Farbtest blieb weiß; nach
Korrektur von Power-Registern wurde nur der 320 Pixel breite Ausschnitt
sichtbar. Die Firmware verwendet das vorhandene LovyanGFX-ILI9341-Profil
mit 240×320 im Hochformat bzw. 320×240 im Querformat. Die Host-Canvasgröße
128×192 bleibt erhalten; Zentrierung und `hello.screen` verwenden die
Treibermaße. Es gibt keine neue Abhängigkeit und keine Protokolländerung.
Belege und verbleibende Hardwareprüfungen: [BUG-0001](../../bugs/bug-0001-weisses-display.md).
Die früheren W3-Werte sind kein Nachweis für dieses korrigierte Panelprofil.
