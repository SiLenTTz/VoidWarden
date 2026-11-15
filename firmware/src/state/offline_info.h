// EPIC-P4 T4.3: Text der Offline-Anzeige — hostfähig. Die letzte Projektion bleibt
// stehen, ist aber als „veraltet" markiert und nennt Grund und lokale Uhrzeit (K10: kein
// grünes Bild bei toter Quelle). Uhrzeit = letzter bestätigter ts (UTC) + utc_offset_min (T4.7).
#pragma once

#include <cstddef>
#include <cstdint>

namespace vw {

enum class OfflineReason : uint8_t {
    kNone = 0,
    kLink,  // Heartbeat blieb aus: USB, Companion oder Port weg
    kHub,   // Companion lebt, meldet aber hub:"down"
};

/// Schreibt zwei Zeilen (≤ 32 Zeichen, passt in den Ticker): „veraltet seit hh:mm" und den
/// Grund. `ts` leer oder kein ISO-Zeitstempel → „veraltet, Zeit unbekannt" (sichtbar, nicht still).
/// Liefert false bei kNone oder zu kleinen Puffern.
bool formatOffline(OfflineReason reason, const char* ts, bool has_utc_offset,
                   int16_t utc_offset_min, char* line1, size_t cap1, char* line2, size_t cap2);

}  // namespace vw
