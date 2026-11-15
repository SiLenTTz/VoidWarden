# ADR-0006 — Nyx-Kanon, Atlas-Format NYX2, Augenfarben per LUT

**Status:** akzeptiert für die Planung (2026-11-04); Formatdetails bindet T5.4 ·
**Ablösung:** ersetzt `spec.md` §5 (Palette) und §6 (Assets), sobald EPIC-P5 das umsetzt;
bis dahin gilt die Spec · **Betrifft:** `tools/assets/`, `firmware/src/render/`, EPIC-P5, EPIC-P10

## Kontext

Vier Quellen widersprechen sich:

| Quelle | Figur | Frame | Augen |
|---|---|---|---|
| `spec.md` §5/§6 und `assets/nyx-spritesheet.png` (Ist) | Kapuze, Void-Orb, „keine Linie heller 40 %" | 32×48, 33 Frames, 7 Zustände | 6 Token, ≤ 12 Farben |
| Blueprint `04_NYX_SPRITES` | „Version 2: Gothic-Tech Warden", Runen, Medaillon | 64×64, zusätzlich 48×48 | 10 Token mit anderen Hex-Werten |
| `nyx-spritesheet_favorite.png` („Final", „Atlas v2.0") | Gothic-Tech, Runen, Medaillon | Aufdruck 48×48 | 12 Varianten |
| `nyx-spritesheet1.png` / `nyx-spritesheet2.png` | Chibi / „Proposal C", Spectral Warden | „320px-class" | 6 bzw. 7, teils andere Bedeutung |

Der Blueprint stellt klar: Die Bilder sind Designreferenzen, keine Frames, und
dürfen nicht per Raster zerlegt werden. Das Board hat kein PSRAM; die Heap-Werte
stehen in [`messlauf/2026-11-03-display-fix.md`](../messlauf/2026-11-03-display-fix.md).

## Entscheidung

1. **Kanon:** `nyx-spritesheet_favorite.png` ist die Designreferenz (Silhouette,
   Kapuze, Medaillon, Runen). Vom Projektinhaber am 2026-11-04 bestätigt (OP-2). `nyx-spritesheet1.png`
   und `nyx-spritesheet2.png` sind Nebenreferenzen für Animationsideen und
   Interaction-Icons. `nyx1.png` ist Layout-Mockup, keine Pixelvorgabe. Der
   Void-Orb entfällt; das Medaillon übernimmt seine Rolle.
2. **Frames:** Master 64×64, transparent, Anker `bottom-center`; Skalierung nur
   ganzzahlig nearest-neighbor. Die 48×48-Variante kommt erst mit T10.7, wenn ein
   Screen sie braucht. Keine Automatik: Skalieren oder Raster-Zerlegen als
   Produktions-Asset ist verboten; jede Variante wird gepixelt.
3. **Format `NYX2` (ersetzt `NYX1`):** 4-Bit-Indizes wie heute. Index 0 ist
   transparent, **Indizes 1–3 sind für die Augen reserviert** (Kern/Mitte/Glow),
   4–15 für den Körper, also **≤ 12 Körperfarben** wie bisher. Dazu Clip-Tabelle
   (Name, erster Frame, Anzahl, Frame-Dauer je Frame, Loop-Flag) und Pivot.
4. **Augenfarbe = LUT-Tausch der Indizes 1–3.** Keine duplizierten Frames; dieselbe
   Silhouette je Status gilt damit konstruktiv. Der Blueprint verlangt das
   sinngemäß („Masken statt 12-facher Duplikation"); ein gebackener Glow entfällt.
5. **Quelle:** Aseprite oder LibreSprite als **Dev-Werkzeug**, kein Laufzeitbestandteil.
   Eingecheckt werden die Quelle (`.aseprite` oder Layer-PNGs),
   exportiertes PNG und Export-JSON im Aseprite-Format. Gate und Build
   laufen ohne Aseprite auf dem Export. Ein Adapter übersetzt Aseprites JSON nach
   NYX2, denn der Blueprint-Beispiel-JSON ist nur schematisch.
6. **Komposition:** Basis-Clip + Overlay + One-Shot + LUT, Priorität
   `offline/error > approval > Touch-Feedback > success > Loop`. Ringe und Glows
   entstehen prozedural im Renderer. Der Glitch-Morph bleibt, gedrosselt durch
   `reducedMotion` (T10.6).
7. **Status und Sprechen sind getrennt:** Sprechen setzt ein Overlay (Sprechlinien)
   und ändert die Augen nur, wenn der Basis-Status `idle` ist. `talk` verdeckt nie
   `error` oder `approval_pending`.

## Zuordnung (Soll, bindend ab T5.6/T5.7)

| Nyx-Zustand (`spec.md` §5) | Bedingung | Basis-Clip | Auge | Hex | Zweitsignal |
|---|---|---|---|---|---|
| `idle` | keine Session | `idle_breathe` | standby violett | `#AF72FF` | ruhiger Umhang |
| `idle` | Sessions da, alle frisch, keine aktiv | `idle_breathe` | healthy grün | `#54F58A` | kleiner Haken |
| `listening` | `activity=coding` | `coding` | cyan | `#45E4F7` | Code-Partikel |
| `listening` | `activity=thinking` | `thinking` | blau | `#608CFF` | pulsierender Ring |
| `listening` | `activity=unknown` | `scan` | cyan | `#45E4F7` | Scan-Bogen |
| `approval_pending` | | `warning`, ab T10.1 `needs_approval` | amber | `#FF9F43` | Ausrufezeichen |
| `executing` | | `coding` | cyan | `#45E4F7` | Ring **ohne** Prozentwert |
| `success` | | `success` (One-Shot) | gold | `#FFE38A` | Funken |
| `error` | | `error`, danach Halteschleife | rot | `#FF526E` | Warndreieck + Glitch |
| `offline` | | `connection_lost` | grau | `#737185` | durchgestrichener Link |
| Display gedimmt | kein Alarm | `sleep` | `#737185`, gedimmt | | „Z" |
| *(Overlay)* | TTS läuft | `talk` | `#CC9CFF` nur bei `idle` | | Sprechlinien |

`waiting` gelb (`#FFD46A`) gilt für Agent-Zeilen `starting`/`queued`-artig, nicht
für den Gesamtzustand. Sonderfarben (Pink, Teal, Weiß) und
den Regenbogen regelt T10.4. Der Regenbogen ist ein zeitgesteuerter LUT-Lauf ohne eigene
Frames (Inhaber, 2026-11-04). Damit deckt der Plan alle 12 Augen-Varianten des Favorite ab.

## Umsetzungsstand (2026-11-04, Import Atlas v2)

Vorgezogen aus EPIC-P5, damit Nyx mit den neuen Sprites am Board läuft:

- `assets/nyx/` enthält Atlas v2 (`nyx-atlas.png` sha256 `f64ddb7c…`, `nyx-atlas.json`,
  `nyx-source.aseprite` sha256 `c1fa2bc1…`, `README.txt`), gelesen aus dem externen
  Produktionsordner `nyx-sprites/assets/nyx/v2`, dort unverändert.
- `NYX2` ist umgesetzt, soweit der Atlas es braucht: Indizes 0/1–3/4–15, Frame-Metadaten
  18 B (Name[16], Index, Dauer in 10 ms), Pivot und Clip-Flags fehlen noch (T5.4).
  Der Namensslot wurde von 10 auf 16 Zeichen verbreitert: `approval_pending` passte nicht in
  `NYX1` und wurde am Board nicht gefunden.
- Augenfarbe je Zustand per LUT-Tausch (Zustandsebene; grün/blau/Sonderfarben bleiben P5/P10).
- Skalierung ×3 statt ×2: Nyx ist 192 px hoch; ob das für das Layout bleibt, entscheidet T6.1.
  `kScale` ist die einzige Stelle.

## Konsequenzen

- Rechnung, kein Messwert: 64×64 mit 4 Bit = 2.048 B je Frame; 71 MVP-Frames
  ≈ 145 KB, alle 155 Frames ≈ 317 KB, gegen 1,75 MB LittleFS (`spec.md`, Partition).
  Der RAM-Canvas schrumpft bei ×2 von 49.152 B (128×192) auf 32.768 B (128×128).
- Bei ×2 ist Nyx 128 px hoch statt heute 192 px. Ob das auf dem 2,8"-Panel wirkt,
  entscheidet der Layout-Spike T6.1 mit Foto; ×3 nimmt der Agentenliste Platz.
- Bestehende Tests zu `nyx.spr` und `SpriteStore` werden mit T5.4 migriert.
- Die Produktion der Pixel-Art ist Handarbeit (Abhängigkeit **ART-1**); bis dahin
  läuft ein klar markierter Platzhalter-Atlas (T5.3).
- **Maßstab ist das Ergebnis, nicht der Urheber (OP-3, Inhaber 2026-11-04):** Es gilt
  die Fassung, die am Board am besten aussieht und den Linter besteht. Der Inhaber kann selbst
  pixeln ([Anleitung](../pixel-art-anleitung.md)); sonst liefert der Agent den ersten Entwurf.
  Reicht er nach zwei Runden nicht, wird eine externe Pixel-Art-Kraft empfohlen.

## Verworfen

- **Augenfarbe als eigene Frames:** verdoppelt Flash ohne Nutzen.
- **RGB565- oder 8-Bit-Frames:** 8 KB bzw. 4 KB je Frame, RAM-Pfad teurer; 16 Farben
  reichen für den dunklen Stil. Wiedervorlage nur, wenn das Art-Review scheitert.
- **Poster automatisch zerlegen:** Der Blueprint schließt das aus, und Beschriftung
  und Hintergrund machen es technisch unbrauchbar.
