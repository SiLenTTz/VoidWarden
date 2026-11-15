#include "state/offline_info.h"

#include <cstdio>

namespace vw {

namespace {

bool digit(char c) { return c >= '0' && c <= '9'; }

// "YYYY-MM-DDTHH:MM…" → Minuten seit Mitternacht (UTC)
bool minutesOfDay(const char* ts, int* out) {
    if (ts == nullptr) return false;
    for (int i = 0; i < 16; ++i) {
        if (ts[i] == '\0') return false;
    }
    if (ts[10] != 'T' || ts[13] != ':' || !digit(ts[11]) || !digit(ts[12]) || !digit(ts[14]) ||
        !digit(ts[15])) {
        return false;
    }
    const int h = (ts[11] - '0') * 10 + (ts[12] - '0');
    const int m = (ts[14] - '0') * 10 + (ts[15] - '0');
    if (h > 23 || m > 59) return false;
    *out = h * 60 + m;
    return true;
}

}  // namespace

bool formatOffline(OfflineReason reason, const char* ts, bool has_utc_offset,
                   int16_t utc_offset_min, char* line1, size_t cap1, char* line2, size_t cap2) {
    if (reason == OfflineReason::kNone || line1 == nullptr || line2 == nullptr || cap1 < 33 ||
        cap2 < 33) {
        return false;
    }
    int mins = 0;
    if (minutesOfDay(ts, &mins)) {
        const int offset = has_utc_offset ? utc_offset_min : 0;
        const int local = ((mins + offset) % 1440 + 1440) % 1440;
        // Ohne Offset bleibt die Zeit UTC: das wird ausgewiesen, statt eine Ortszeit zu behaupten.
        snprintf(line1, cap1,
                 has_utc_offset ? "veraltet seit %02d:%02d" : "veraltet seit %02d:%02d UTC",
                 local / 60, local % 60);
    } else {
        snprintf(line1, cap1, "veraltet, Zeit unbekannt");
    }
    snprintf(line2, cap2, "%s", reason == OfflineReason::kHub ? "Hub weg" : "Link weg");
    return true;
}

}  // namespace vw
