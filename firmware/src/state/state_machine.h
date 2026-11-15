// EPIC-P2 T2.3: Nyx-Zustandsmaschine — hostfähig (keine Hardware-Includes),
// Zeit und Zufall injizierbar (docs/testing.md §2.2). Die Firmware hält keinen
// Wahrheits-Zustand (K7): alles kommt aus Frames; diese Maschine projiziert
// nur (spec.md §5). Priorität: offline > approval_pending > error > executing
// > success (transient ~1,5 s) > listening > idle.
#pragma once

#include <cstdint>

#include "protocol/frames.h"
#include "state/offline_info.h"

namespace vw {

struct StateMachineConfig {
    uint32_t heartbeat_timeout_ms = 15000;  // spec §4.3: 15 s → offline
    uint32_t success_transient_ms = 1500;   // spec §5.1: ~1,5 s
    uint32_t seq_gap_tolerance = 0;         // jede Lücke → resync (spec §4.4)
};

class StateMachine {
public:
    using TransitionHook = void (*)(NyxState from, NyxState to, void* user);

    explicit StateMachine(const StateMachineConfig& config = StateMachineConfig());

    /// Ein dekodierter PC→ESP-Frame (nur Richtungs-Typen; andere werden
    /// ignoriert und gezählt — Fail loud obliegt dem Aufrufer).
    void onFrame(const IncomingFrame& frame, uint32_t now_ms);

    /// Zeitlicher Takt: Heartbeat-Timeout, success-Transient-Ende prüfen.
    void tick(uint32_t now_ms);

    NyxState current() const { return state_; }
    NyxState projected() const { return projected_; }  // letzter Nicht-offline-Zustand

    /// Lücke erkannt (einmalig abfragen): seq > erwartet. Aufrufer sendet resync.
    bool takeSeqGap(uint32_t* last_seq_out);

    /// Heartbeat-Empfang vermerken (auch außerhalb von onFrame).
    void noteHeartbeat(uint32_t now_ms);

    void setTransitionHook(TransitionHook hook, void* user) {
        hook_ = hook;
        hook_user_ = user;
    }

    /// Offline-Anzeige (T4.3): Grund und letzter bestätigter Zeitstempel samt Offset.
    OfflineReason offlineReason() const { return offline_reason_; }
    const char* lastGoodTs() const { return last_good_ts_; }
    bool lastGoodHasOffset() const { return last_good_has_offset_; }
    int16_t lastGoodOffsetMin() const { return last_good_offset_min_; }

    uint32_t parse_errors() const { return parse_errors_; }
    uint32_t direction_errors() const { return direction_errors_; }

private:
    void enter(NyxState next, uint32_t now_ms);
    void applyProjected(NyxState next, uint32_t now_ms);

    StateMachineConfig config_;
    NyxState state_ = NyxState::kIdle;
    NyxState projected_ = NyxState::kIdle;  // letzte Projektion für offline-Gedimmt
    uint32_t last_heartbeat_ms_ = 0;
    bool heartbeat_seen_ = false;
    int32_t expected_seq_ = -1;
    bool seq_gap_ = false;
    uint32_t success_until_ms_ = 0;
    bool success_active_ = false;
    NyxState underlying_ = NyxState::kIdle;  // letzter nicht-transienter Zustand
    OfflineReason offline_reason_ = OfflineReason::kNone;
    char last_good_ts_[40] = {0};
    bool last_good_has_offset_ = false;
    int16_t last_good_offset_min_ = 0;
    void noteGood(const char* ts, bool has_offset, int16_t offset_min);
    uint32_t parse_errors_ = 0;
    uint32_t direction_errors_ = 0;
    TransitionHook hook_ = nullptr;
    void* hook_user_ = nullptr;
};

}  // namespace vw
