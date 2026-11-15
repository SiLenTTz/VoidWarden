# ADR-0013 — Nyx-Stimme über eigene Hivemind-TTS-Dienste

**Status:** akzeptiert (2026-11-11, Nutzerauftrag) · **Betrifft:** P11 Nyx-Bühne
T11.10, W2/W9/W13. Ergänzt ADR-0008 für den Web-Kiosk; keine Änderung am
Serial-Link oder an Freigaberechten.

## Kontext

Auf Hivemind laufen Qwen3-TTS VoiceDesign und Voxtral-4B-TTS-2603 hinter
`POST /tts`. Der Companion schickte jedoch stets Qwen-Stimmnamen; Voxtral
lehnt diese ab. Die bisherige Kokoro-Konfiguration verfremdet andere Modelle
zusätzlich durch Pitch, Echo und Tempo. Die Bestandsvorgabe „nur Host-Audio"
aus ADR-0008 wurde bereits durch P11-Web-Audio erweitert.

## Entscheidung

- Qwen3 VoiceDesign (`Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`, Hivemind
  `100.74.58.126:18801/tts`) ist das Beispielprofil für natürliche Nyx-Sprache.
  Die serverseitige deutsche Standardstimme bleibt `nyx-female-de`.
- Voxtral (`Voxtral-4B-TTS-2603`, GGUF Q8_0, Port `18802`, Standardstimme
  `de_female`) ist eine explizit konfigurierbare Alternative. Beide Modelle
  erzeugen Audio; sie werden nicht hintereinander verkettet. Kein stiller
  Modellwechsel bei Ausfall, kein zufälliger Wechsel der Stimmidentität.
- Der gemeinsame Request enthält `text`, `speed` und `language`. Die jeweilige
  Registry löst die Standardstimme auf. Kein Qwen-Stimmname und kein `instruct`
  aus Anzeige- oder Hub-Daten. Nicht unterstützte Sprachen schlagen sichtbar
  fehl; insbesondere bietet der installierte Voxtral-Dienst kein Englisch an.
- Profil: `speed=1`, `pitchSemitones=0`, `tempo=1`, `timeoutMs=120000`.
  Dadurch entfällt Ghost-Processing. Kokoro-Defaults für Bestandskonfigurationen
  bleiben erhalten; die Beispielkonfiguration nutzt das neue Profil, opt-in.
- Automatische Ansagen bleiben deterministische deutsche Vorlagen. Sechs
  Varianten je Zustand; seltene Nyx-Note nur bei idle/listening. Keine
  Approval-UUIDs, keine erfundenen Abschlüsse, kein behauptetes Mithören.
- Eigene Hivemind-Hardware im LAN/Tailnet ist für diese Audioausgabe erlaubt.
  Browser → Companion → Hivemind, Rückgabe als WAV über denselben Browser-Origin.
  Keine externen Cloud-TTS-Dienste, kein Audio über Serial, kein Mikrofonpfad.
- AncientVoid-STT bleibt separat. Der geprüfte Hub nutzt Whisper; ein
  TTS-Modell gehört weder in dessen `stt.url` noch in den Agent-LLM-Katalog.

## Konsequenzen und Grenzen

Die Stimmprofile sind serververwaltet; Registry-Änderungen brauchen eine neue
Hörprobe. Lange Voxtral-Texte können das derzeit maximal konfigurierbare
Timeout überschreiten: kurze Statussätze verwenden, Fehler sichtbar melden.
Qwen-VoiceDesign kann bei wiederholter Synthese klanglich variieren; eine
identische Sprecheridentität wird damit nicht garantiert.

Voxtral-Gewichte stehen laut lokalem `/info` und Hersteller unter CC BY-NC 4.0;
dieses alternative Profil ist für nicht kommerziellen Betrieb vorgesehen.
Keine Modell- oder Paketupdates erforderlich.

Quellen: [Voxtral TTS Modellkarte](https://docs.mistral.ai/models/voxtral-tts-26-03),
[Qwen3-TTS Dokumentation](https://github.com/QwenLM/Qwen3-TTS/blob/main/README.md).
Ist-Prüfung und offene Hörabnahme: `docs/messlauf/2026-11-11-hivemind-stimme.md`.
