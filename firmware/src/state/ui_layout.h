// ADR-0009: Layout der Touch-Flächen und Nyx-Position auf dem 320×240-Display — hostfähig.
// Mit Blase rückt Nyx nach links, damit die Blase rechts in der 120-px-Spalte nichts überdeckt;
// die Flächen überlappen nie (Test). Freigabe-Zonen gehören dem Freigabe-Screen, nicht hierher.
#pragma once

#include <cstdint>

#include "state/touch_tracker.h"

namespace vw {

constexpr uint8_t kZoneNyx = 3;     // Tap auf Nyx: Status der fokussierten Session
constexpr uint8_t kZoneFocus = 4;   // Indikator oben rechts: nächste Session
constexpr uint8_t kZoneBubble = 5;  // nur kritische Blase: Tap quittiert

struct UiLayout {
    Zone zones[3];
    uint8_t zone_count;
    int16_t nyx_x, nyx_y;  // linke obere Ecke des Nyx-Canvas
};

/// `bubble`: eine Blase ist sichtbar; `critical`: sie verlangt Ack; `indicator`: ≥ 2 Sessions.
UiLayout computeLayout(bool bubble, bool critical, bool indicator);

}  // namespace vw
