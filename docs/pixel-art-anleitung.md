# Pixel-Art-Anleitung: Nyx selbst pixeln

Für den Projektinhaber oder eine Pixel-Art-Kraft. Verbindlich sind ADR-0006 und
[EPIC-P5](../epics/EPIC-P5-nyx-atlas.md) §3; diese Seite macht daraus einen Arbeitsablauf.
Der Art-Vorlauf berührt keinen Produktcode und bricht das Epic-Gating nicht. Die Pipeline,
die den Atlas liest, entsteht erst in T5.4; die Marker-Farben unten kann T5.4 noch
präzisieren.

## Werkzeug

| Werkzeug | Bezug | Einsatz |
|---|---|---|
| **LibreSprite** (Empfehlung zum Start) | `sudo pacman -S libresprite` (Arch extra, GPL-2.0, kostenlos) | Reicht für alles hier: Layer, Tags, Frame-Dauern, Sheet-Export |
| **Aseprite** | kostenpflichtig von aseprite.org; alternativ `yay -S aseprite` (AUR, baut aus dem Quellcode, Aseprite-EULA) | Vom Blueprint vorgesehen, komfortabler; lohnt sich, wenn du länger pixelst |
| Piskel | im Browser | Nur für schnelle Skizzen: keine Layer-Struktur wie unten |

Ob der Sheet-Export von LibreSprite alle Felder liefert, die der Adapter braucht, prüft T5.4
an deiner Datei. Beide Programme speichern `.aseprite`.

## Datei anlegen

- **Eine** Datei `assets/nyx/nyx-source.aseprite`, Canvas **64×64**, RGBA, transparenter Hintergrund.
- Vorlage: `assets/reference/nyx-spritesheet_favorite.png` daneben öffnen oder als eigene Ebene
  `ref` einblenden. **Neu pixeln, nicht ausschneiden und nicht verkleinern**: Weichgezeichnete
  Pixel taugen nicht. Die Ebene `ref` vor dem Export ausblenden.
- Füße/Schatten stehen in jedem Frame auf derselben Grundlinie, mittig (`bottom-center`).
  Beim Zeichnen immer in 100 % und ganzzahligen Stufen prüfen. Nyx wird am Board etwa 128 px
  groß, auf einem 2,8"-Panel also klein: **Der Kopf muss in Originalgröße sofort erkennbar sein.**

## Ebenen

`shadow`, `cloak-back`, `body`, `hood`, `cloak-front`, `runes`, `eyes-glow`, `eyes-mask`, `fx`.

## Farben

- **Körper: höchstens 12 Farben**, dazu Transparenz. Dunkle Violett-Töne aus der
  „Palette (core)" im Favorite. Dithering statt Verläufe.
- **Augen: genau 3 Marker-Farben**, die sonst nirgends vorkommen:
  `#FF00FF` Kern, `#C000C0` Mitte, `#800080` Glow. Die Firmware ersetzt sie zur Laufzeit durch
  die Statusfarbe. Deshalb zeichnest du die Augen **nur einmal in diesen Markern**, nie in
  Grün, Rot usw. Alle Augenfarben entstehen automatisch, auch der Regenbogen.
- Ringe und Glow um die Figur baut der Renderer; bitte nicht einzeichnen.

## Reihenfolge

1. **Nur die Neutralpose** (ein Frame). Schick sie, bevor du animierst: Sie wird am Board
   fotografiert. Eine zu kleine Figur lässt sich hier billig korrigieren, später nicht mehr.
2. `idle_breathe` und `blink`, wieder am Board prüfen.
3. Die übrigen Clips aus EPIC-P5 §3 als **Tags** mit exakt diesen Namen, je Frame die Dauer in
   ms aus der Tabelle. Zwischenbilder von Hand zeichnen, keine automatische Interpolation.
4. Die Erweiterungs-Clips stehen in EPIC-P10 §3 und haben Zeit.

## Abgabe

Lege `assets/nyx/nyx-source.aseprite` ab oder schick sie mir, und sag Bescheid. Export, wenn
das Programm eine Kommandozeile hat (Blueprint `04`):

```bash
aseprite -b assets/nyx/nyx-source.aseprite --sheet assets/nyx/nyx-atlas.png \
  --data assets/nyx/nyx-atlas.json --format json-array --list-tags
```

Abgenommen wird nach Aussehen am Board; die Technik prüft der Asset-Linter (T5.5).
