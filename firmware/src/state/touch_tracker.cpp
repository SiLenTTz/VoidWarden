#include "state/touch_tracker.h"

namespace vw {

void TouchTracker::setZones(const Zone* zones, uint8_t count) {
    count_ = count > kMaxZones ? kMaxZones : count;
    for (uint8_t i = 0; i < count_; ++i) zones_[i] = zones[i];
    down_zone_ = 0;
    tap_zone_ = 0;
    cancelled_ = pressed_;  // laufende Berührung gehört zum alten Screen
}

uint8_t TouchTracker::zoneAt(int16_t x, int16_t y) const {
    for (uint8_t i = 0; i < count_; ++i) {
        const Zone& z = zones_[i];
        if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) return z.id;
    }
    return 0;
}

void TouchTracker::sample(bool pressed, int16_t x, int16_t y, uint32_t now_ms) {
    if (pressed) {
        if (!pressed_) {
            pressed_ = true;
            cancelled_ = false;
            press_start_ = true;
            down_zone_ = zoneAt(x, y);
        }
        last_zone_ = zoneAt(x, y);
        return;
    }
    if (!pressed_) return;
    pressed_ = false;
    const bool cancelled = cancelled_;
    cancelled_ = false;
    const uint8_t zone = down_zone_;
    down_zone_ = 0;
    if (cancelled || zone == 0 || zone != last_zone_ || locked_) return;
    if (had_tap_ && now_ms - last_tap_ms_ < kTapDebounceMs) return;
    had_tap_ = true;
    last_tap_ms_ = now_ms;
    tap_zone_ = zone;
}

bool TouchTracker::takeTap(uint8_t* zone_id) {
    if (tap_zone_ == 0) return false;
    if (zone_id != nullptr) *zone_id = tap_zone_;
    tap_zone_ = 0;
    return true;
}

}  // namespace vw
