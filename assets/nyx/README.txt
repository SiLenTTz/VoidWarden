Nyx v2 — näher am großen Referenzporträt

Neue Gestaltung: gefaltete Kapuze, schwarzes Gesicht, leuchtende Augen,
asymmetrisch nach links wehende Mantelbahnen, Schulterbroschen und Kette,
Runen-Stola und Charakter-Halo. Die Silhouette ist schlanker und die
Stofflagen sind stärker getrennt als in der bisherigen Konstruktion.

Dateien:
  nyx-master.png          Hochauflösender Imagegen-Entwurf mit Transparenz
  nyx-neutral-64.png      Spielsprite, 64×64, harte Transparenz
  nyx-atlas.png           33 Frames als Streifen, 2112×64
  nyx-atlas.json          Zustände, Frame-Reihenfolge, Dauern und Palette
  nyx-source.aseprite     33 Frames, 7 Tags, getrennte Ebenen Halo/Nyx
  nyx-neutral-128.png     Detailreichere Bonusansicht, keine Firmware-Palette
  preview/               Vergleich, Frame-Übersicht und Animationen
  prompt.txt             Vollständiger Prompt des Imagegen-Entwurfs
  tools/build.mjs         Reproduzierbarer Raster-/Animations-Export

Die 64er-Exporte verwenden höchstens 12 Körperfarben und drei reservierte
Augenmarker (#FF00FF, #C000C0, #800080). Nur die Augen verwenden Marker;
Halo und Schmuck bleiben violett. Kein gebackener Status-Ring.
Offline: Halo aus, Augen zur dunklen Zeile geschlossen, Schmuck gedimmt.

Animationsreihenfolge in der Frame-Übersicht (eine Zeile pro Zustand):
idle, listening, approval_pending, executing, success, error, offline.
Frame-Anzahlen und Dauern entsprechen dem bisherigen Atlas.
Die Bewegungen entstehen aus der gemeinsamen Pose; es sind keine
33 unabhängig generierten Zeichnungen. So bleibt die Figur konsistent.

Erstellung: eingebautes Imagegen-Werkzeug für die neue Zeichnung;
ImageMagick für Rasterung/Exporte und Node für Palette, Animation und
Aseprite-Verpackung. Kein API-/CLI-Fallback für die Bildgenerierung.

Export erneut ausführen (Node und ImageMagick erforderlich):
  node assets/nyx/v2/tools/build.mjs

Geprüft: 33 Frames, 7 Zustände, Palette, Marker ausschließlich in der
Augenregion, keine abgeschnittenen Pixel; Aseprite-Rückexport gegen Atlas.
Die hochauflösende Vorlage und die 128er-Bonusansicht sind Illustrations-
Assets und unterliegen nicht der 12-Farben-Grenze des 64er-Spielatlas.
Eine Prüfung im echten ESP32-Renderer ist nicht Teil dieses Asset-Entwurfs.

Alle neu erstellten Produktionsdateien dieser Bearbeitung liegen in v2.
Die bisherige Version steht unverändert in ../v1/ als Backup bereit.
