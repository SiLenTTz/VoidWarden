#include "state/ui_layout.h"

namespace vw {

UiLayout computeLayout(bool bubble, bool critical, bool indicator) {
    UiLayout l{};
    l.nyx_x = bubble ? 0 : 64;  // (320 − 192) / 2 mittig, mit Blase links
    l.nyx_y = 12;               // (240 − 216) / 2
    // Nyx-Fläche = Sprite (192 × 192); das Tickerband darunter reagiert nicht.
    l.zones[l.zone_count++] = {kZoneNyx, l.nyx_x, l.nyx_y, 192, 192};
    if (indicator) l.zones[l.zone_count++] = {kZoneFocus, 272, 0, 48, 44};  // ≥ 44 px (ADR-0007)
    if (bubble && critical) l.zones[l.zone_count++] = {kZoneBubble, 196, 48, 120, 180};
    return l;
}

}  // namespace vw
