#include "render/idle_life.h"

namespace vw {

uint32_t IdleLife::nextGap() {
    rng_ ^= rng_ << 13;
    rng_ ^= rng_ >> 17;
    rng_ ^= rng_ << 5;
    return kBlinkMinGapMs + rng_ % (kBlinkMaxGapMs - kBlinkMinGapMs + 1);
}

void IdleLife::begin(uint32_t seed, uint32_t now_ms) {
    rng_ = seed != 0 ? seed : 1;  // xorshift darf nicht bei 0 starten
    blinking_ = false;
    next_ms_ = now_ms + nextGap();
}

bool IdleLife::allowed(NyxState state) {
    return state == NyxState::kIdle || state == NyxState::kListening ||
           state == NyxState::kExecuting || state == NyxState::kSuccess;
}

uint8_t IdleLife::blinkLevel(NyxState state, uint32_t now_ms) {
    if (!blinking_ && static_cast<int32_t>(now_ms - next_ms_) >= 0) {
        if (allowed(state)) {
            blinking_ = true;
            blink_end_ms_ = next_ms_ + 3 * kBlinkPhaseMs;
        } else {
            next_ms_ = now_ms + nextGap();  // Alarm läuft: nicht direkt danach blinzeln
        }
    }
    if (!blinking_) return 0;
    if (!allowed(state) || static_cast<int32_t>(now_ms - blink_end_ms_) >= 0) {
        blinking_ = false;
        next_ms_ = now_ms + nextGap();
        return 0;
    }
    const uint32_t phase = (now_ms - (blink_end_ms_ - 3 * kBlinkPhaseMs)) / kBlinkPhaseMs;
    return phase == 1 ? 2 : 1;
}

}  // namespace vw
