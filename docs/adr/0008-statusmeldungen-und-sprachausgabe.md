# ADR-0008 — Deterministische Statusmeldungen, Sprachausgabe nur im Companion

**Status:** akzeptiert für die Planung (2026-11-04); Engine-Wahl bindet T9.1 ·
**Betrifft:** `companion/`, `docs/spec.md` §1/§10, EPIC-P8, EPIC-P9 ·
**Übernimmt:** Blueprint-ADR-002 und -003

## Kontext

Der Blueprint will Sprechblasen und lokales TTS (Piper) mit Queue, Quiet Hours und
Stop. Offen lässt er, wo der Ton physisch herauskommt („Audio auf dem Server ist
nicht automatisch Audio am Display"). Der Hub liefert keine reinen Statusfelder:
Laut `packages/contracts/src/sessions/session.ts` ist `title` die erste Zeile des
Start-Prompts, und `lastActivity.text` enthält Assistenten-Text oder „Du: …"
(`activityOf` im AncientVoid-Core, per Code gelesen, live belegt erst T7.1). Der
Blueprint verbietet genau diese Inhalte für Anzeige und TTS.

## Entscheidung

1. **Texte kommen aus Vorlagen, nicht aus einem LLM.** Der `Composer` ist eine pure
   Funktion über Hub-Zählern und erlaubten Feldern. Ein LLM ist kein Teil des Plans.
2. **Nichts wird erfunden.** `progressPct` existiert nicht, also keine Prozentzahl.
   Veraltete Daten heißen „Keine neuen Statusmeldungen seit …".
3. **Status und Sprache sind getrennte Zustände.** `speech_state` ändert `state`
   nicht und läuft ohne Rückwirkung auf Hub oder Freigaben.
4. **TTS läuft im Companion auf dem Entwicklungsrechner.** Die Engine ist ein
   **externer Prozess** hinter dem Interface `Speaker` (Piper primär, `espeak-ng`
   Rückfall, Mock im Test); der Ton kommt aus dem Host-Audio. Kein Audio-Stream über
   den Link: 921600 Baud sind dafür nicht ausgelegt, und das Protokoll bleibt K5-treu.
   Ein Lautsprecher am Board ist Option per neuem ADR (OP-5).
5. **Audio-Freigabe:** `ttsEnabled=false` (Default) heißt kein Audio, auch nicht bei
   Tap. `autoSpeak` wirkt nur bei `ttsEnabled=true`. `manualSpeakOverride` (Default
   `false`) ist die Blueprint-Option „Tap spricht trotz Auto-Off" und übersteuert
   nie Mute oder Quiet Hours.
6. **Sprechen ist enger als Anzeigen.** Vorgelesen werden nur Vorlagen mit Zählern,
   Agent-Aliasen und erlaubten Enums. `title`, `lastActivity.text` und
   `notification.detail` werden **nie** vorgelesen. Angezeigt werden sie nur
   bereinigt (`sanitizeText`); `title` nur bei `titleSource=manual`, sonst der Alias
   aus Adapter und Kurz-ID (`ui.agentNames`, OP-7).
7. **Kein Pfad von Text zu Aktion.** Engine-Aufruf mit Argument-Array und Text über
   stdin, keine Shell. Der Text ist nie Teil eines Kommandos.

## Konsequenzen

- `spec.md` §9 korrigiert den Satz „K6 … keine Sprache": K6 misst Sprach-zu-Text und
  bleibt unberührt, TTS bekommt die eigene Messlatte W13.
- ADR-0003 führt Piper und `espeak-ng` als vorgemerkte externe Werkzeuge; T9.1 setzt
  Version, Lizenz und Stimme. Keine davon ist npm-Laufzeitabhängigkeit.
- Companion-Netz bleibt „nur Hub": Stimmen werden einmalig installiert, nie zur
  Laufzeit geladen.
- Status des Piper-Repos und Lizenz der Stimme sind ungeprüft; das ist Teil von T9.1.

## Verworfen

- **TTS im ESP32:** kein Budget ohne PSRAM.
- **Remote-TTS oder Browser Web Speech API:** Cloud- bzw. Browser-Abhängigkeit,
  beides Nicht-Ziel.
- **`lastActivity.text` vorlesen, weil es am nützlichsten klingt:** Es kann Prompts
  und Pfade enthalten; ein Filter allein ist keine Grenze gegen Agent-Output.
