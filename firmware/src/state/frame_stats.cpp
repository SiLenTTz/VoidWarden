#include "state/frame_stats.h"

namespace vw {

void FrameStats::onFrame(uint32_t now_ms, uint32_t duration_us) {
    if (!started_) {
        started_ = true;
        win_start_ms_ = now_ms;
    }
    ++frames_;
    busy_us_ += duration_us;
    if (duration_us > cur_max_us_) cur_max_us_ = duration_us;

    // Vorzeichenlose Differenz bleibt auch über den millis()-Überlauf korrekt.
    const uint32_t elapsed = now_ms - win_start_ms_;
    if (elapsed < kFpsWindowMs) return;

    max_us_ = cur_max_us_;
    // Wenige Bilder (ruhiges Nyx) sagen nichts über die Kapazität: Wert und Serie bleiben.
    if (frames_ >= kMinFramesPerWindow && busy_us_ > 0) {
        fps_ = 1e6f * static_cast<float>(frames_) / static_cast<float>(busy_us_);
        below_run_ = fps_ < kFpsFloor ? below_run_ + 1 : 0;
    }
    ++completed_;
    win_start_ms_ = now_ms;
    frames_ = 0;
    busy_us_ = 0;
    cur_max_us_ = 0;
}

}  // namespace vw
