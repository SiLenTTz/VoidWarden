// EPIC-P3 T3.8: Roh→Pixel-Transformation des Touch-Controllers — hostfähig. Die Konstanten
// (Min/Max, Achsen) stammen aus dem HIL-Punktraster, nicht aus dem Datenblatt (AC-P3-8).
#pragma once

#include <cstdint>

namespace vw {

struct TouchCalibration {
    int16_t raw_x_min, raw_x_max, raw_y_min, raw_y_max;
    bool swap_xy;   // Rohachsen X/Y vertauschen (Querformat)
    bool invert_x;  // nach dem Vertauschen
    bool invert_y;
    uint16_t screen_w, screen_h;
};

/// Rechnet einen Rohwert (12 Bit) auf Bildschirmpixel um; Werte außerhalb des
/// Kalibrierbereichs werden an den Rand geklemmt. false bei entartetem Bereich.
bool mapTouch(const TouchCalibration& cal, int16_t raw_x, int16_t raw_y, int16_t* x, int16_t* y);

}  // namespace vw
