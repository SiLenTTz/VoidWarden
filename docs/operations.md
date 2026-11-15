# Betrieb: Runbook (EPIC-P4 T4.6)

Stand 2026-11-04. Geprüft am Board ESP32-2432S028R, CH340 an `/dev/ttyUSB0`, Arch/omarchy. Was von Hand
durchgespielt wurde und was nicht, steht in §7.

## 1. Voraussetzungen

- Node ≥ 22.5, `npm install` im Repo. PlatformIO (`pio`) für die Firmware, `clang-format` für den Lint.
- **Port-Rechte:** `/dev/ttyUSB0` gehört `root:uucp` (Modus 660). Einmalig `sudo usermod -aG uucp $USER`, dann
  neu anmelden. In einer bestehenden Sitzung hilft `newgrp uucp`. Ohne Rechte meldet `npm run test:hil` ein
  rotes `FAIL` (nie ein Skip); mehrere Boards nennt der Lauf mit Hinweis.
- Konfiguration: `voidwarden.config.json` aus `voidwarden.config.example.json` ableiten (git-ignoriert). Token nur als
  Datei mit Modus 600 (`hub.tokenFile`), nie im JSON. `serial.path: "auto"` sucht `ttyUSB*`/`ttyACM*`.

## 2. Firmware flashen

```bash
npm run assets                       # Atlas -> firmware/data/nyx.spr (NYX2) und Font
cd firmware
pio run -e esp32 -t upload           # Firmware (Hash wird verifiziert)
pio run -e esp32 -t uploadfs         # nyx.spr nach LittleFS: zwingend, sonst zeigt das Display "nyx.spr unlesbar"
```

Reihenfolge egal, beides nötig nach jeder Änderung an Firmware **und** Atlas. Danach Reset (Taste oder
`npm run test:hil`). Der Companion und `test:hil` dürfen den Port nicht gleichzeitig offen haben.
Erst bauen (`npm run build:fw`), dann flashen; Flashen nur mit Absicht.

**Läuft der Dienst, zuerst stoppen:** Er hält den Port, der Upload scheitert sonst mit `FAILED`. Ablauf:

```bash
systemctl --user stop voidwarden
(cd firmware && pio run -e esp32 -t upload && pio run -e esp32 -t uploadfs)
systemctl --user start voidwarden    # nach ~2 s zeigt das Board den Hub-Zustand (kein Reset nötig)
```

Der Dienst läuft aus dem Klon unter `~/.local/share/voidwarden`. Neuer Code kommt mit `git pull` in
diesem Klon (auf dem Branch, den du betreiben willst) und `systemctl --user restart voidwarden`.

## 3. Companion starten

```bash
npm run companion -- --config voidwarden.config.json
voidwarden status            # in einem zweiten Terminal: npm run status (Klartext mit Ampel; --json roh, --watch: npm run status:watch)
```

SIGTERM/SIGINT beendet sauber. Ein Konfigurations- oder Token-Fehler endet mit Exit-Code 1 und einer Meldung.
Hub nicht erreichbar oder Board fehlt: Der Companion läuft weiter, wiederholt mit Backoff und zeigt es im Status.

### systemd-User-Unit (2026-11-05 am Zielrechner eingerichtet, läuft)

**Einrichtung in einem Schritt:** `tools/service/install.sh` (ohne root, idempotent) erledigt Klon, `npm ci`, Contracts-Link,
Config (Modus 600, nur Token-*Pfade*) und Unit; Aufruf mit `HUB_TOKEN_FILE`, `DECIDE_TOKEN_FILE`, `AV_CONTRACTS` (Kopf des
Skripts). Was root braucht, druckt es am Ende: die udev-Regel `tools/service/99-voidwarden.rules` (CH340 per `uaccess`
und Gruppe `uucp`, Symlink `/dev/voidwarden`) und `loginctl enable-linger`. Die Schritte darunter erklären, was das Skript tut.

Eigener, sauberer Klon als Betriebsstand (nicht ein Arbeitsbaum): `git clone <remote> ~/.local/share/voidwarden && npm ci`.
Dazu zwei Eigenheiten dieses Rechners, die die frühere Vorlage nicht kannte:

- **`@ancientvoid/contracts`** ist eine `file:`-Abhängigkeit mit relativem Pfad (`../../AncientVoid/...`) und löst sich
  außerhalb von `arbeitsbaeume/` nicht auf: `ln -sfn <AncientVoid>/packages/contracts node_modules/@ancientvoid/contracts`.
- **Seriellen Port öffnen:** `SupplementaryGroups=` gilt nur für System-Units, `sg` fehlt. Der Benutzer steht in `uucp`
  (`/etc/group`), die Login-Sitzung kennt die Gruppe aber nicht; `newgrp uucp` liest Befehle von stdin.
- **Socket:** Der Unix-Socket-Pfad darf höchstens ~107 Zeichen haben; `VOIDWARDEN_SOCK=%t/voidwarden.sock` setzen.

`~/.config/systemd/user/voidwarden.service`:

```ini
[Unit]
Description=VoidWarden Companion
After=network-online.target

[Service]
WorkingDirectory=%h/.local/share/voidwarden
Environment=VOIDWARDEN_SOCK=%t/voidwarden.sock
ExecStart=/bin/sh -c 'echo "exec %h/.local/share/mise/installs/node/26.7.0/bin/node companion/src/run.ts --config %h/.config/voidwarden/config.json" | /usr/bin/newgrp uucp'
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

Die Config liegt unter `~/.config/voidwarden/config.json` (Modus 600) und verweist mit absoluten Pfaden auf die
Token-Dateien. `systemctl --user daemon-reload && systemctl --user enable --now voidwarden`;
Log: `journalctl --user -u voidwarden`. Belegt: Dienst aktiv, Hub erreichbar, Port geöffnet. **Nicht belegt:** Neustart
nach Reboot (Lingering), Wiederanlauf nach USB-Abzug im Dienst, udev-Regel (die Gruppe wird per `newgrp` umgangen).

### Config-Schlüssel für Bedienung (`ui.*`)

| Schlüssel | Standard | Wirkung |
|---|---|---|
| `ui.dimAfterS` | 60 | Dimmen nach Ruhe; der erste Touch danach weckt nur |
| `ui.focusHoldS` | 30 | so lange bleibt die manuell gewählte Session im Fokus, danach gilt wieder der Auto-Fokus |
| `ui.chatter.enabled` | true | Nyx sagt im Leerlauf gelegentlich einen lokalen Satz |
| `ui.chatter.minGapS` / `jitterS` | 90 / 60 | Mindestabstand (≥ 60, W12) plus Zufallsanteil |

Nach einer Änderung `systemctl --user restart voidwarden`. Die Datei enthält Token-Pfade: Modus 600.

## 4. Diagnose-Reihenfolge

Kern in [`observability.md`](observability.md) §6:

1. `voidwarden status`: Link up? Hub up? letztes `hello`?
2. `data/logs/companion.jsonl` auf `level>=warn` filtern.
3. Letzte `stats`/`log`-Frames der Firmware (`component:"firmware"`): `fps_unter_25`, `frame_ueber_80ms`, `heap_min`.
4. `npm run sim` gegen den Companion, erst dann am Board.
5. Befund als `bugs/bug-NNNN-*.md` (Skill `bug-report`) mit redigiertem Ausschnitt.

## 5. Bekannte Fallen (aus echten Läufen)

| Symptom | Ursache | Maßnahme |
|---|---|---|
| Display weiß oder nur Balken | falsches Panelprofil (BUG-0001) | Profil ILI9341 320×240 im Querformat, nicht ST7796 |
| Falsche Farben/Salat | Byte-Reihenfolge (BUG-0003); der Canvas liegt seit T2.10 in Panel-Reihenfolge | Canvas nur über den Renderer schreiben |
| Nyx flackert | Löschen vor jedem Bild (BUG-0004) | behoben |
| `kein hello` nach Reset | `DTR` nicht gesetzt: Board bootet in den Download-Modus (`boot:0x3`) | beide Leitungen bei jedem Reset-Schritt setzen (`test:hil` tut das) |
| `hello` mit Müll davor | ROM-Bootlog (115200 Baud) ohne Zeilenende | Firmware schickt `\n` vor `hello`, der Companion zählt `line_prefix` und verwirft sichtbar (T2.9) |
| Node-Skript sieht Serial-Bytes erst nach Timer-Ende | ein einziger langer Timer, Ursache offen | in 20-ms-Schritten warten (`scripts/hil/`, `messlauf-p2.mjs`) |
| `serial.path: "auto"` findet nichts | Ausdruck gegen vollen Pfad (BUG-0005) | behoben |
| Touch trifft die falsche Fläche (z. B. ACCEPT löst DECLINE aus) | Touch-Achsen falsch kalibriert (2026-11-05: x war gespiegelt) | `npm run touch:calibrate` (5 Punkte), danach `npm run touch:calibrate -- --verify` |
| Upload scheitert mit `FAILED` | der Dienst hält den Port | Dienst stoppen (siehe §2) |
| Tap auf Nyx/Indikator ohne Wirkung | kein Companion läuft: der Tap ist nur ein Wunsch an ihn | `voidwarden status`, `systemctl --user status voidwarden` |
| Display bleibt nach Dienststart auf altem Stand | früher: kein `hello` bei laufendem Board (BUG-0008) | behoben: 1,5 s nach dem Start geht ein snapshot raus |
| "nyx.spr unlesbar" auf dem Display | LittleFS leer oder altes NYX1-Format | `npm run assets`, dann `uploadfs` |

## 6. Läufe am Board

| Zweck | Kommando | Hinweis |
|---|---|---|
| Handshake, alle Zustände, Stats | `npm run test:hil` | Prüft Frames, nicht Pixel; Foto-Abnahme separat |
| W3/Heap im Dauerlauf | `npm run messlauf:p2 -- 30` | 30 min, Bericht nach `docs/messlauf/`; flasht nie |
| Vorschau ohne Board | `npm run preview:nyx` | Host-Renderer, `data/preview/` |
| Alle Szenen ansehen (Zustände, Blase, Frage, Chatter, Tap, Fokus) | `node scripts/nyx-tour.mjs` (`--part2` nur der interaktive Teil, `--sim` ohne Board) | Dienst vorher stoppen; Tippen in den Tap-Szenen |
| Tap-Test mit Logs | `node scripts/nyx-tour.mjs --part2 --taponly --wait=120` | zeigt `touch raw=…`, `ui_action` und Antworten mit Zeit |
| Touch kalibrieren / Trefferprobe | `npm run touch:calibrate` / `-- --verify` | stoppt den Dienst und startet ihn danach wieder; Ergebnis von Hand in `kTouchCal` eintragen |

## 7. Was von Hand durchgespielt wurde

Durchgespielt (2026-11-04): Port-Rechte, Build, Flashen von Firmware und LittleFS, `test:hil`, `messlauf:p2`, Start und
Stopp des Companions in `companion/test/run.test.ts` (ohne Board). Am 2026-11-05 kam die systemd-Unit dazu (Dienst aktiv, Hub und Port geöffnet). **Nicht** durchgespielt: die udev-Regel
(braucht root), Reboot-Start (Lingering) und ein Companion-Dauerlauf am Board. AC-P4-6 ist damit nur teilweise belegt; das Runbook muss einmal vollständig am
Zielrechner abgearbeitet werden.
