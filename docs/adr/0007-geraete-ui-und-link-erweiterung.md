# ADR-0007 — Geräte-UI: Screens, Touch-Klassen, additive Link-Frames

**Status:** akzeptiert für die Planung (2026-11-04); jeder Frame gilt erst mit Schema und
Fixtures im Umsetzungs-Commit · **Betrifft:** `protocol/`, `firmware/`, `companion/`,
`docs/spec.md` §4/§7, EPIC-P4 und P6–P9 · **Erweitert:** ADR-0002

## Kontext

Der Blueprint verlangt Screens, Agentenliste, Blasen und Bedien-Elemente, die der
Zustand `state` + Ticker nicht tragen. Auf dem Gerät gibt es kein HTML und keinen
Vollbild-Framebuffer (`spec.md` §2). Der Touch-Controller des Boards ist noch nicht
identifiziert (T3.8). Sicherheitskritisch: Mehr Touch-Flächen dürfen nie zu einer
Hub-Entscheidung führen.

## Entscheidung

1. **Screens:** `idle`, `update_toast`, `details`, `settings`, `connection_lost`,
   `sleep` aus dem Blueprint, plus `approval` aus P3 als einziges Modal. Es liegt
   über allem und schaltet alle anderen Touch-Flächen ab. Die Screens sind reine
   Anzeige-Zustände und ändern `state` nie.
2. **Zielgerät und Umstellbarkeit (Inhaber, 2026-11-04):** Zuerst das 2,8"-Board mit
   320×240 quer (Ist-Firmware, `hello.screen`, Blueprint-Hauptlayout). Größe und
   Orientierung müssen **später ohne Umbau wechselbar** sein: Ein Display-Profil bündelt
   Panel-Treiber, Maße, Rotation, Touch-Transformation, Nyx-Skalierung und Layout-Tabelle.
   UI-Code liest nur das Profil, keine festen Pixelwerte. Ein neues Gerät heißt: neues
   Profil plus Goldens (T6.12). T6.1 prüft Hochformat am Board und darf den Default per
   Nachtrag ändern. Das Hochformat-Mockup `nyx1.png` wird nicht verkleinert.
3. **Touch-Klassen:**
   - Entscheidung (Approve/Decline): ≥ 100 px Kante, `spec.md` §7 unverändert.
   - Steuerfläche (Mute, Next, Details, Toggle): ≥ 44 px Kante.
   - Zeile/Inhalt (Agent, Blase, Nyx): Ziel ≥ 32 px Höhe, belegt durch T6.1.
4. **Zwei getrennte Rückkanäle (Sicherheitsgrenze, W9):** `ui_action` und
   `action_response` sind verschiedene Frames mit verschiedenen Code-Pfaden.
   `ui_action` hat kein Feld `decision` oder `action_id`, sein Schema setzt als
   bewusste Ausnahme von ADR-0002 `additionalProperties:false`, und der Handler
   kennt den `DecideClient` nicht. Text aus Events bestimmt nie Hitboxen oder Aktionen.
5. **Wahrheit liegt im Companion:** Einstellungen liegen in `data/settings.json`
   (Recovery: Datei, sonst Defaults + `warn`; das Gerät bekommt sie per Frame).
   Der Verlauf kommt aus `/api/notifications`, kein neuer Speicher (K7). Die
   Firmware speichert nichts davon.
6. **Bedienung ohne Touch:** `voidwarden ui <action>` sendet dieselben Aktionen
   über denselben Pfad an den Companion (Blueprint: „bei fehlendem Touch bedienbar").
   Decide ist darüber nicht erreichbar.

## Geplante Frames (additiv, `v:1`; je Schema + gültig/ungültig + beide Parser)

| Richtung | `type` | Felder (Grenzen) | Epic |
|---|---|---|---|
| PC→ESP | `settings_state` | `seq`, `tts`, `auto_speak`, `volume_pct`, `quiet_now`, `reduced_motion`, `lang` | T6.6 |
| PC→ESP | `agent_row` | `seq`, `idx`, `total`, `ref` (≤ 8), `name` (≤ 16), `status`, `activity_text` (≤ 40), `age_s` | T7.3 |
| PC→ESP | `agent_detail` | `seq`, `ref`, `payload{title,body}`, `blocked` | T7.3 |
| PC→ESP | `history_item` | `seq`, `idx`, `total`, `level`, `at`, `text` (≤ 80) | T7.8 |
| PC→ESP | `bubble` | `seq`, `bubble_id`, `level`, `payload{title,body}`, `hold_s`, `ack_required` | T8.3, **umgesetzt 2026-11-04** (Schema, 5 Fixtures, Companion-Codec + `Bridge.showBubble`, Firmware-Parser; `ui_action bubble_ack` folgt mit T6.6) |
| PC→ESP | `speech_state` | `seq`, `state` (`queued`, `started`, `finished`, `cancelled`, `failed`) | T9.7 |
| ESP→PC | `ui_action` | `action` (Enum), optional `ref`, `ms` | T6.6 |
| additiv | `snapshot`/`heartbeat` | `utc_offset_min` (ganzzahlig, −840…840, Minuten Ost von UTC; `ts` bleibt UTC) | T4.7, **umgesetzt 2026-11-04** (Schema, Fixtures, Companion `tz.ts`, Firmware-Parser) |
| additiv | `snapshot`/`state_change` | `activity` (`coding`, `thinking`, `unknown`) | T7.7 |

`ui_action.action` ∈ `status_tap`, `agent_tap`, `bubble_tap`, `bubble_ack`,
`tts_toggle`, `auto_speak_toggle`, `stop_speech`, `next`, `details_open`,
`details_close`, `settings_open`, `settings_set`, `focus_next`, `wake`.

Rechnung, kein Messwert: Nach `hello` gehen `snapshot`, `settings_state` und bis
zu 5 `agent_row` raus, also 7 Frames und unter 1 s bei ≤ 10 Frames/s. Das passt in
W5 (≤ 3 s); T7.3 belegt es per Messlauf.

## Konsequenzen

- Jede Zeile der Tabelle ist im Umsetzungs-Commit eine ADR-Bindung: Schema,
  Fixtures, `spec.md` §4 (ADR-0002). Vorher existiert der Frame nicht.
- `state`-Enum und `aggregate()`-Priorität bleiben unverändert.
- Der Default-Firmware-Parser zählt unbekannte Frames; ältere Firmware bricht nicht.

## Verworfen

- **LVGL für die UI:** Wiedervorlage laut ADR-0003 nur bei nachgewiesenem Bedarf;
  die Screens sind feste Tabellen ohne Widget-Bedarf.
- **Ein gemeinsamer Touch-Frame für alles:** spart ein Schema, verwischt aber die
  W9-Grenze.
- **Swipe als Standard:** Der Touch-Typ ist offen, `spec.md` §7 schiebt Swipe auf; die
  Agentenliste blättert per Tap.
