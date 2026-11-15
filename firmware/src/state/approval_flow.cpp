#include "state/approval_flow.h"

#include <cstring>

namespace vw {

void ApprovalFlow::arm(const char* action_id, const char* title, const char* approval_class,
                       double timeout_s, bool decidable, uint32_t now_ms, bool unlock,
                       bool is_question) {
    const bool same = active_ && strcmp(id_, action_id) == 0;
    strncpy(id_, action_id, sizeof id_ - 1);
    id_[sizeof id_ - 1] = '\0';
    strncpy(title_, title, sizeof title_ - 1);
    title_[sizeof title_ - 1] = '\0';
    strncpy(class_, approval_class, sizeof class_ - 1);
    class_[sizeof class_ - 1] = '\0';
    active_ = true;
    if (!same || unlock) sent_ = false;  // gleiche ID hebt die Sperre nur mit unlock auf
    // Das Gerät entscheidet nie destructive, egal was `decidable` sagt (ADR-0001).
    is_question_ = is_question;
    decidable_ = decidable && !is_question && strcmp(class_, "destructive") != 0;
    has_deadline_ = timeout_s > 0;
    const uint32_t timeout_ms = static_cast<uint32_t>(timeout_s * 1000.0);
    deadline_ms_ = now_ms + timeout_ms;
    if (!same || timeout_ms > total_ms_) total_ms_ = timeout_ms;
}

void ApprovalFlow::onResult(const char* action_id) {
    if (active_ && strcmp(id_, action_id) == 0) clear();
}

void ApprovalFlow::clear() {
    active_ = false;
    sent_ = false;
    decidable_ = false;
    is_question_ = false;
    id_[0] = '\0';
}

void ApprovalFlow::tick(uint32_t now_ms) {
    if (active_ && has_deadline_ && static_cast<int32_t>(now_ms - deadline_ms_) >= 0) clear();
}

uint32_t ApprovalFlow::remainingS(uint32_t now_ms) const {
    if (!active_ || !has_deadline_) return 0;
    const int32_t left = static_cast<int32_t>(deadline_ms_ - now_ms);
    return left <= 0 ? 0 : static_cast<uint32_t>((left + 999) / 1000);
}

uint8_t ApprovalFlow::remainingPercent(uint32_t now_ms) const {
    if (!active_ || !has_deadline_ || total_ms_ == 0) return 0;
    const int32_t left = static_cast<int32_t>(deadline_ms_ - now_ms);
    if (left <= 0) return 0;
    const uint32_t pct = static_cast<uint32_t>((static_cast<uint64_t>(left) * 100) / total_ms_);
    return pct > 100 ? 100 : static_cast<uint8_t>(pct);
}

bool ApprovalFlow::onZoneTap(uint8_t zone, uint32_t now_ms, bool* approve) {
    if (!decidable()) return false;
    if (has_deadline_ && static_cast<int32_t>(now_ms - deadline_ms_) >= 0) return false;
    if (zone != kZoneApprove && zone != kZoneDecline) return false;
    sent_ = true;  // genau eine Antwort je action_id; Sperre bis action_result
    if (approve != nullptr) *approve = zone == kZoneApprove;
    return true;
}

}  // namespace vw
