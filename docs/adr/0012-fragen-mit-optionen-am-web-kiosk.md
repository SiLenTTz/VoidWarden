# ADR-0012 — Fragen mit Optionen am Web-Kiosk, Halte-Freigabe, Titel in Kacheln

**Status:** akzeptiert (2026-11-12, Nutzerentscheid E11 vom 11.11.2026, EPIC-P13 T13.6) ·
**Betrifft:** `companion/src/{hub,aggregate,web-server,decide,main}.ts`, `web/`,
`protocol/schema/ws/`, `protocol/config.schema.json`, `docs/spec.md` §1/§7/§9/§10 ·
**Ändert:** ADR-0009 Punkt 4 (nur für den Web-Kiosk), ADR-0008 §6 (nur für Kacheln des
Web-Kiosks), `spec.md` §7 „Approve = Einzeltipp“ (nur Web-Kiosk) ·
**Protokoll:** Link-Protokoll `v:1` (Serial) **unverändert**; der WS-Export wird additiv erweitert.

## Kontext

ADR-0009 Punkt 4 und W9 legen fest: Eine Frage des Agenten (`AskUserQuestion`) ist am Gerät
nie entscheidbar; der Hub lehnt sie für den Akteur `display` mit 403 ab (AncientVoid ADR-0048
Punkt 4). Der Kiosk zeigt deshalb nur „Am Rechner beantworten“. Der Nutzer will Fragen, bei
denen der Agent selbst Optionen vorgibt, am Kiosk beantworten können (Entscheidung E11,
Design-Review im AncientVoid-Repo). Zugleich liegt der Kiosk offen auf dem Tisch; ein Wischer
darf nichts freigeben. Und zwei Sessions desselben Projekts sind auf den Kacheln nicht
unterscheidbar, weil dort nur der Projektname steht.

## Entscheidung

1. **Enger Fall, vom Hub bestimmt.** Der Web-Kiosk darf eine Frage beantworten, wenn der Hub
   sie für den anfragenden Display-Token als beantwortbar ausweist (Feld `displayAnswerable`
   in `GET /api/approvals`, AncientVoid AV-D3). Der Companion leitet die Beantwortbarkeit
   **nie** selbst her. Fehlt das Feld oder ist es `false`, bleibt alles wie in ADR-0009.
2. **Nur Optionen des Agenten, kein am Gerät erzeugter Text.** Der Client sendet je Teilfrage
   einen **Index**. Der Companion übersetzt den Index in den **unveränderten Originaltext**
   der Option, den er aus der Hub-Antwort vorhält, und sendet ihn über den bestehenden Weg
   `POST /api/approvals/:id/decide` mit `answers`. Der Hub prüft wortgleich gegen die
   gespeicherte Anfrage. Kein Freitext, keine Mehrfachauswahl.
3. **Anzeigegrenzen sind Beantwortbarkeitsgrenzen.** Höchstens 2 Teilfragen, je höchstens
   4 Optionen, jede Option ≤ 40 Zeichen, Fragetext ≤ 200 Zeichen. Was darüber liegt, wird am
   Kiosk nicht gekürzt beantwortbar gemacht, sondern als nicht beantwortbar angezeigt
   („Am Rechner beantworten“). Gekürzte Optionen könnten zwei verschiedene Antworten gleich
   aussehen lassen.
4. **Eine Frage wird am Kiosk nur beantwortet, nie abgelehnt.** Es gibt keine „Nein“-Zone für
   Fragen; Ablehnen bleibt dem Rechner/Handy vorbehalten.
5. **Vorauswahl nur bei gekennzeichneter Empfehlung.** Vorgewählt ist eine Option nur, wenn
   ihr Text auf `(Recommended)` oder `(Empfohlen)` endet (Groß-/Kleinschreibung egal).
   Sonst ist nichts vorgewählt und die Halte-Zone ist gesperrt, bis gewählt wurde.
6. **Halte-Geste am Web-Kiosk.** Neuer Config-Schlüssel `ui.approveGesture` (`"tap"` |
   `"hold"`). Der Web-Kiosk verwendet `hold` als Standard, wenn der Schlüssel fehlt: Freigeben
   und Antworten lösen erst nach 800 ms ununterbrochenem Halten aus. Das Board bleibt beim
   Einzeltipp bzw. Slider (`criticalActions`). Ablehnen bleibt überall Einzeltipp.
7. **W9 bleibt, die Formulierung wird genauer.** Neu: „0 doppelte `decide`-Calls je
   `action_id`; 0 Entscheidungen auf `decidable:false`; 0 Antworten auf Fragen ohne
   `answerable:true`; 0 Antworten mit anderem Text als einer Hub-Option; 0 Auto-Decline am
   Gerät.“ Dedupe (`DecisionStore`) gilt für Antworten wie für Freigaben.
8. **Board unverändert.** Firmware, Serial-Frames und `action_request.kind=question` bleiben
   reine Anzeige. `decidable` bleibt für Fragen `false` (Schema-Invariante bleibt bestehen);
   die neue Fähigkeit steht in einem eigenen Feld `answerable`.
9. **Titel in Kacheln.** Die Kacheln des Web-Kiosks dürfen den Session-Titel jeder
   `titleSource` zeigen (bereinigt, ≤ 40 Zeichen), dazu eine Aktivitätszeile aus
   `lastActivity` des Hubs. Beides wird nur gerendert und löst nie eine Aktion aus
   (`spec.md` §10.2). Der Sessionname am Board und in Blasen bleibt nach ADR-0008 §6/ADR-0010.

## Protokoll (WS-Export, additiv)

| Frame | Feld | Grenzen |
|---|---|---|
| `snapshot`/`state_change` → `approval` | `answerable` (bool, optional, Default `false`) | nur bei `kind:"question"` darf es `true` sein |
| | `questions[]` (optional) | 1–2 Einträge; je `text` (1–200), `options[]` (2–4 Strings, je 1–40), optional `recommended` (Index in `options`) |
| `snapshot`/`state_change` → `sessionList[]` | `title` (optional, ≤ 40), `activity` (optional, ≤ 40) | leer/fehlend erlaubt |
| Client → Companion `decide` | `answers` (optional) | Array ganzer Zahlen ≥ 0, Länge = Anzahl `questions`; nur mit `decision:"approve"` |

Ältere Clients ignorieren die neuen Felder. `decidable` bleibt bei Fragen `false`.

## Verworfen

- **Beantwortbarkeit im Companion herleiten** (Optionen vorhanden ⇒ beantwortbar): würde die
  Policy des Hubs nachbauen und driften. Der Hub ist die einzige Wahrheit.
- **Optionstext vom Client senden:** öffnet einen Weg, auf dem ein manipulierter Client
  beliebigen Text zum Agenten schickt.
- **Gekürzte Optionen beantwortbar machen:** siehe Punkt 3.
- **Fragen auch am Board beantworten:** 480×320 und Touch-Genauigkeit reichen für bis zu vier
  Optionen nicht verlässlich; eigenes ADR, falls je gewünscht.

## Konsequenzen

- Der Display-Token des Companions braucht die Hub-Berechtigung zum Beantworten (AncientVoid:
  `hubctl token issue <name> --display --answer-questions`); ohne sie meldet der Hub jede
  Frage als nicht beantwortbar, und der Kiosk verhält sich wie bisher.
- Tests: Property-Test „keine Antwort ohne `answerable`“, „Index außerhalb ⇒ kein Hub-Call“,
  „gesendeter Text ist immer byte-gleich einer Hub-Option“; Negativ-Fixtures im Schema.
- `spec.md` §1, §7, §9 (W9) und §10 werden mit der Umsetzung (T13.5, T13.7) nachgezogen;
  der Wortlaut steht in [`../p13-umsetzungsspezifikation.md`](../p13-umsetzungsspezifikation.md) §9.
- Umsetzung von Punkt 1–5 erst, wenn AV-D3 im Hub gemergt ist.
