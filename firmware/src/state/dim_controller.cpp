#include "state/dim_controller.h"

namespace vw {

void DimController::onState(NyxState state, uint32_t now_ms) {
    const bool pin = state == NyxState::kApprovalPending || state == NyxState::kError;
    // Beim Pinnen und beim Lösen startet die Frist neu: eine Freigabe, die gerade verschwand,
    // soll nicht sofort ins Dunkle kippen.
    if (pin || pinned_awake_) last_activity_ms_ = now_ms;
    if (pin) dimmed_ = false;
    pinned_awake_ = pin;
}

bool DimController::onTouch(uint32_t now_ms) {
    last_activity_ms_ = now_ms;
    if (dimmed_) {
        dimmed_ = false;
        return false;
    }
    return true;
}

void DimController::tick(uint32_t now_ms) {
    if (dim_after_ms_ == 0 || pinned_awake_ || dimmed_) return;
    if (now_ms - last_activity_ms_ >= dim_after_ms_) dimmed_ = true;
}

}  // namespace vw
