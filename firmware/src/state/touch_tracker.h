// EPIC-P3 T3.4: Tap-Erkennung — hostfähig, Zeit injiziert. Ein Tap zählt erst beim Loslassen
// und nur, wenn Aufsetzen und Loslassen in derselben Zone liegen (Wischen/Abrutschen löst
// nichts aus, W9). Entprellung ≥ 150 ms (spec §7), Sperre solange gesetzt.
#pragma once

#include <cstdint>

namespace vw {

struct Zone {
    uint8_t id;  // 0 ist reserviert (keine Zone)
    int16_t x, y, w, h;
};

constexpr uint8_t kMaxZones = 8;
constexpr uint32_t kTapDebounceMs = 150;

class TouchTracker {
public:
    /// Ersetzt die Zonen (z. B. beim Screenwechsel); laufende Berührung wird verworfen.
    void setZones(const Zone* zones, uint8_t count);

    /// Ein Abtastwert je Loop: pressed + Pixelposition.
    void sample(bool pressed, int16_t x, int16_t y, uint32_t now_ms);

    /// true, wenn seit dem letzten Aufruf ein Tap vollendet wurde.
    bool takeTap(uint8_t* zone_id);

    /// Verbraucht die aktuelle Berührung ohne Tap (z. B. Wecken aus dem Dimmen).
    void cancelCurrent() {
        down_zone_ = 0;
        cancelled_ = pressed_;
    }

    /// Sperre: solange gesetzt, entstehen keine Taps (nach Absenden bis action_result).
    void setLocked(bool locked) { locked_ = locked; }
    bool locked() const { return locked_; }

    /// Beim Aufsetzen einmal true (für Wecken aus dem Dimmen); danach false.
    bool takePressStart() {
        const bool v = press_start_;
        press_start_ = false;
        return v;
    }

private:
    uint8_t zoneAt(int16_t x, int16_t y) const;

    Zone zones_[kMaxZones] = {};
    uint8_t count_ = 0;
    bool pressed_ = false;
    bool cancelled_ = false;
    bool press_start_ = false;
    bool locked_ = false;
    uint8_t down_zone_ = 0;
    uint8_t last_zone_ = 0;
    uint8_t tap_zone_ = 0;
    uint32_t last_tap_ms_ = 0;
    bool had_tap_ = false;
};

}  // namespace vw
