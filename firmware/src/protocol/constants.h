// EPIC-P2 T2.2: Link-Protokoll Konstanten — Quelle der Wahrheit ist protocol/
// (Schemas + Fixtures). Hostfähig: keine Arduino-Includes, keine dynamische
// Allokation, feste Puffer (docs/architecture.md §2 Firmware-Trennung).
#pragma once

namespace vw {

constexpr size_t kMaxLineBytes = 512;    // K5: Zeile ≤ 512 B, Überlänge = Fehler
constexpr uint8_t kProtocolVersion = 1;  // "v" in jeder Zeile (ADR-0002)
constexpr size_t kTitleMaxChars = 40;    // W4: payload.title
constexpr size_t kBodyMaxChars = 160;    // W4: payload.body (2×80)
constexpr size_t kLogMsgMaxChars = 200;  // log.msg

}  // namespace vw
