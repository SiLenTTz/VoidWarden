#include "state/touch_map.h"

namespace vw {

namespace {
int32_t scale(int32_t v, int32_t lo, int32_t hi, int32_t out_max) {
    if (v < lo) v = lo;
    if (v > hi) v = hi;
    return (v - lo) * (out_max - 1) / (hi - lo);
}
}  // namespace

bool mapTouch(const TouchCalibration& cal, int16_t raw_x, int16_t raw_y, int16_t* x, int16_t* y) {
    if (cal.raw_x_max <= cal.raw_x_min || cal.raw_y_max <= cal.raw_y_min || cal.screen_w < 2 ||
        cal.screen_h < 2 || x == nullptr || y == nullptr) {
        return false;
    }
    int32_t px, py;
    if (cal.swap_xy) {
        // Rohachse X läuft entlang der Bildschirmhöhe, Y entlang der Breite
        px = scale(raw_y, cal.raw_y_min, cal.raw_y_max, cal.screen_w);
        py = scale(raw_x, cal.raw_x_min, cal.raw_x_max, cal.screen_h);
    } else {
        px = scale(raw_x, cal.raw_x_min, cal.raw_x_max, cal.screen_w);
        py = scale(raw_y, cal.raw_y_min, cal.raw_y_max, cal.screen_h);
    }
    if (cal.invert_x) px = cal.screen_w - 1 - px;
    if (cal.invert_y) py = cal.screen_h - 1 - py;
    *x = static_cast<int16_t>(px);
    *y = static_cast<int16_t>(py);
    return true;
}

}  // namespace vw
