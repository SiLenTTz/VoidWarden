// EPIC-P2 T2.3: Implementierung der Nyx-Zustandsmaschine (siehe Header).
#include "state_machine.h"

#include <cstring>

namespace vw {

StateMachine::StateMachine(const StateMachineConfig& config) : config_(config) {}

void StateMachine::enter(NyxState next, uint32_t now_ms) {
    if (next == state_) return;
    const NyxState from = state_;
    state_ = next;
    if (hook_ != nullptr) hook_(from, next, hook_user_);
    if (next != NyxState::kOffline) offline_reason_ = OfflineReason::kNone;
    (void)now_ms;
}

void StateMachine::applyProjected(NyxState next, uint32_t now_ms) {
    if (next == NyxState::kSuccess) {
        // success ist transient (§5.1): 1,5 s zeigen, dann zurück auf den
        // letzten nicht-transienten Zustand.
        underlying_ = projected_;
        success_active_ = true;
        success_until_ms_ = now_ms + config_.success_transient_ms;
        projected_ = next;
        enter(next, now_ms);
        return;
    }
    success_active_ = false;
    projected_ = next;
    enter(next, now_ms);
}

void StateMachine::noteGood(const char* ts, bool has_offset, int16_t offset_min) {
    strncpy(last_good_ts_, ts, sizeof last_good_ts_ - 1);
    last_good_ts_[sizeof last_good_ts_ - 1] = '\0';
    last_good_has_offset_ = has_offset;
    last_good_offset_min_ = offset_min;
}

void StateMachine::noteHeartbeat(uint32_t now_ms) {
    last_heartbeat_ms_ = now_ms;
    if (!heartbeat_seen_) {
        heartbeat_seen_ = true;
        // Erster Heartbeat nach offline: letzte Projektion gedimmt zeigen —
        // der Companion liefert per snapshot die Wahrheit nach (K7).
        if (state_ == NyxState::kOffline) enter(projected_, now_ms);
    }
}

namespace {
// seq der PC→ESP-Frames: der Companion zählt sie über alle Typen in einem Zähler (spec §4.4).
bool seqOf(const IncomingFrame& f, uint32_t* seq) {
    switch (f.type) {
        case FrameType::kHeartbeat:
            *seq = f.heartbeat.seq;
            return true;
        case FrameType::kStateChange:
            *seq = f.state_change.seq;
            return true;
        case FrameType::kNotification:
            *seq = f.notification.seq;
            return true;
        case FrameType::kBubble:
            *seq = f.bubble.seq;
            return true;
        case FrameType::kSessionFocus:
            *seq = f.session_focus.seq;
            return true;
        case FrameType::kActionRequest:
            *seq = f.action_request.seq;
            return true;
        case FrameType::kActionResult:
            *seq = f.action_result.seq;
            return true;
        default:
            return false;  // snapshot verankert selbst; ESP→PC-Typen tragen kein seq
    }
}
}  // namespace

void StateMachine::onFrame(const IncomingFrame& frame, uint32_t now_ms) {
    // Lücke = ein Frame fehlt, egal welcher Typ (BUG-0006): ein ausgebliebener Heartbeat ist kein
    // Schaden, ein ausgebliebenes state_change schon, und von außen ist beides nicht zu trennen.
    uint32_t seq = 0;
    if (seqOf(frame, &seq)) {
        if (expected_seq_ >= 0 && static_cast<int32_t>(seq) > expected_seq_ + 1) seq_gap_ = true;
        expected_seq_ = static_cast<int32_t>(seq);
    }
    switch (frame.type) {
        case FrameType::kHeartbeat:
            noteHeartbeat(now_ms);
            if (frame.heartbeat.hub_up) {
                noteGood(frame.heartbeat.ts, frame.heartbeat.has_utc_offset,
                         frame.heartbeat.utc_offset_min);
                // hub down wäre offline; heartbeat mit up bestätigt Projektion
                if (state_ == NyxState::kOffline) enter(projected_, now_ms);
            } else {
                offline_reason_ = OfflineReason::kHub;
                enter(NyxState::kOffline, now_ms);
            }
            break;

        case FrameType::kSnapshot: {
            const SnapshotFrame& f = frame.snapshot;
            expected_seq_ = static_cast<int32_t>(f.seq);  // Sitzung neu verankert
            seq_gap_ = false;
            if (!f.hub_up) {
                offline_reason_ = OfflineReason::kHub;
                enter(NyxState::kOffline, now_ms);
                break;
            }
            noteGood(f.ts, f.has_utc_offset, f.utc_offset_min);
            NyxState next = f.state;
            if (f.state == NyxState::kApprovalPending && !f.has_approval) {
                // waiting ohneApproval-Fenster: amber bleiben (spec §5.1)
                next = NyxState::kApprovalPending;
            }
            applyProjected(next, now_ms);
            break;
        }

        case FrameType::kStateChange: {
            const StateChangeFrame& f = frame.state_change;
            applyProjected(f.state, now_ms);
            break;
        }

        case FrameType::kSessionFocus:  // Anzeige-Daten (ADR-0009): kein Zustandsübergang
        case FrameType::kBubble:        // Anzeige-Daten wie notification: kein Zustandsübergang
        case FrameType::kNotification:
            // Ticker-Daten, kein Zustandsübergang (Anzeige obliegt dem Renderer)
            break;

        case FrameType::kActionRequest:
            // Freigabe-Anfrage hat Vorrang vor allem außer offline (§5.1);
            // decidable beeinflusst nur Touch-Zonen (P3), nicht die Zustandsfarbe.
            applyProjected(NyxState::kApprovalPending, now_ms);
            break;

        case FrameType::kActionResult: {
            const ActionResultFrame& f = frame.action_result;
            if (f.status == 0) {  // approved → executing laut Spec-Tabelle
                applyProjected(NyxState::kExecuting, now_ms);
            } else if (f.status == 4) {  // error
                applyProjected(NyxState::kError, now_ms);
            } else {
                // rejected/timed_out/stale: zurück zur Projektion des Hubs —
                // die nächstes snapshot/state_change liefert; bis dahn idle-ish:
                applyProjected(projected_, now_ms);
            }
            break;
        }

        case FrameType::kHello:
        case FrameType::kActionResponse:
        case FrameType::kResync:
        case FrameType::kStats:
        case FrameType::kLog:
        case FrameType::kUnknown:
            direction_errors_ += 1;  // ESP→PC-Typ als Eingang: gezählt (Fail loud)
            break;
    }
}

void StateMachine::tick(uint32_t now_ms) {
    if (heartbeat_seen_ && now_ms - last_heartbeat_ms_ > config_.heartbeat_timeout_ms &&
        state_ != NyxState::kOffline) {
        offline_reason_ = OfflineReason::kLink;
        enter(NyxState::kOffline, now_ms);
    }
    if (success_active_ && static_cast<int32_t>(now_ms - success_until_ms_) >= 0) {
        success_active_ = false;
        enter(underlying_, now_ms);  // transient abgelaufen
    }
}

bool StateMachine::takeSeqGap(uint32_t* last_seq_out) {
    if (!seq_gap_) return false;
    seq_gap_ = false;
    if (last_seq_out != nullptr) {
        *last_seq_out = expected_seq_ > 0 ? static_cast<uint32_t>(expected_seq_) : 0;
    }
    return true;
}

}  // namespace vw
