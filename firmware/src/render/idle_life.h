// EPIC-P5 T5.8 (vorgezogen): Idle-Life als reiner Zusatz über der Zustandsmaschine.
// Hostfähig, ohne Arduino. Blinzeln aus dem Augen-LUT (keine eigenen Frames): zwei
// Halbphasen und eine geschlossene Phase. Der Zeitplan kommt aus einem injizierbaren Seed
// (deterministisch testbar); Idle-Life verzögert nie einen Zustandswechsel (AC-P5-7).
#pragma once

#include <cstdint>

#include "protocol/frames.h"

namespace vw {

constexpr uint32_t kBlinkMinGapMs = 4000;  // spec §5.2: alle 4–9 s
constexpr uint32_t kBlinkMaxGapMs = 9000;
constexpr uint32_t kBlinkPhaseMs = 90;  // blink-Clip aus dem Plan: 3 × 90 ms

class IdleLife {
public:
    /// Setzt den Zeitplan neu; der erste Blinzler kommt frühestens nach kBlinkMinGapMs.
    void begin(uint32_t seed, uint32_t now_ms);

    /// 0 offen, 1 halb, 2 geschlossen. In offline, error und approval_pending immer 0 und der
    /// Zeitplan läuft weiter, damit nach dem Ende des Alarms nicht sofort geblinzelt wird.
    uint8_t blinkLevel(NyxState state, uint32_t now_ms);

    /// Blinzeln ist in diesem Zustand erlaubt (Gegenstück zu AC-P5-7).
    static bool allowed(NyxState state);

private:
    uint32_t nextGap();

    uint32_t rng_ = 1;
    uint32_t next_ms_ = 0;  // Start des nächsten Blinzelns
    uint32_t blink_end_ms_ = 0;
    bool blinking_ = false;
};

}  // namespace vw
