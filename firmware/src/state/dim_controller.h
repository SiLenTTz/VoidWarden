// EPIC-P4 T4.2: Dimmen und Wake-on-Event — hostfähig (keine Hardware-Includes), Zeit
// injiziert. Ein gedimmtes Display zeigt keine Freigabe: approval_pending und error
// halten es wach (Premortem P4 #2). Der erste Touch auf dem gedimmten Display weckt
// nur und erreicht die UI nicht (W9, AC-P4-3). Hält keinen Wahrheits-Zustand (K7).
#pragma once

#include <cstdint>

#include "protocol/frames.h"

namespace vw {

class DimController {
public:
    explicit DimController(uint32_t dim_after_ms = 60000) : dim_after_ms_(dim_after_ms) {}

    /// 0 schaltet das Dimmen ab.
    void setDimAfterMs(uint32_t ms) { dim_after_ms_ = ms; }

    /// Zustandswechsel: approval_pending/error wecken und sperren das Dimmen, solange sie
    /// anliegen. Alle anderen Zustände starten den Inaktivitäts-Timer nicht neu.
    void onState(NyxState state, uint32_t now_ms);

    /// Touch: true = Touch darf zur UI/Entscheidung, false = wurde als Wecken verbraucht.
    bool onTouch(uint32_t now_ms);

    void tick(uint32_t now_ms);

    bool dimmed() const { return dimmed_; }

private:
    uint32_t dim_after_ms_;
    uint32_t last_activity_ms_ = 0;
    bool pinned_awake_ = false;
    bool dimmed_ = false;
};

}  // namespace vw
