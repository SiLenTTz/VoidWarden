// EPIC-P2 T2.2: Typisierter Frame-Decoder/-Encoder über dem JSON-Scanner.
// Validiert dieselben Regeln wie die Schemas in protocol/ (Enums, Wert-
// bereiche, Pflichtfelder, W4-Längen); Grenzfall über 512 B wird VOR dem
// Parsen abgelehnt (K5, fester Puffer). Fail loud: unbekannter type/Fehler
// liefert ok=false mit Grund — Aufrufer zählt parse_err und loggt.
#pragma once

#include <cstddef>
#include <cstdint>

#include "constants.h"

namespace vw {

enum class NyxState : uint8_t {
    kIdle,
    kListening,
    kApprovalPending,
    kExecuting,
    kSuccess,
    kError,
    kOffline,
    kInvalid,
};

enum class FrameType : uint8_t {
    kSnapshot,
    kStateChange,
    kNotification,
    kActionRequest,
    kActionResult,
    kHeartbeat,
    kBubble,
    kSessionFocus,
    kHello,
    kActionResponse,
    kResync,
    kStats,
    kLog,
    kUnknown,
};

struct ApprovalField {
    char action_id[40];
    char agent_id[48];
    char approval_class[12];  // "class" kollidiert mit C++-Schlüsselwort-Umfeld
    char title[kTitleMaxChars + 1];
    char body[kBodyMaxChars + 1];
    double timeout_s;
    bool decidable;
    bool is_question;  // kind=question (AskUserQuestion): nur Anzeige, nie entscheidbar (ADR-0009)
};

struct SnapshotFrame {
    uint32_t seq;
    NyxState state;
    int32_t sessions_total, sessions_working, sessions_waiting, sessions_error;
    bool has_approval;
    ApprovalField approval;
    bool hub_up;
    char ts[40];
    bool has_utc_offset;
    int16_t utc_offset_min;  // Minuten Ost von UTC (T4.7), nur gültig mit has_utc_offset
};

struct StateChangeFrame {
    uint32_t seq;
    NyxState state;
    char agent_id[48];
    char title[kTitleMaxChars + 1];
    char body[kBodyMaxChars + 1];
    bool has_payload;
    bool has_agent;
};

struct NotificationFrame {
    uint32_t seq;
    char agent_id[48];
    uint8_t level;  // 0 info, 1 success, 2 warning, 3 error
    char title[kTitleMaxChars + 1];
    char body[kBodyMaxChars + 1];
};

struct BubbleFrame {
    uint32_t seq;
    char bubble_id[37];
    uint8_t level;  // 0 info, 1 success, 2 error, 3 critical
    char title[kTitleMaxChars + 1];
    char body[kBodyMaxChars + 1];
    uint8_t hold_s;  // 0 = bis Ack/Ablösung
    bool ack_required;
};

/// Fokussierte Session (ADR-0009). status: 0 approval, 1 question, 2 error, 3 working, 4 idle,
/// 5 other. Die Firmware hält weder Liste noch Fokus; nach hello/resync kommt der Frame neu.
struct SessionFocusFrame {
    uint32_t seq;
    uint8_t idx;    // 1-basiert, ≤ total
    uint8_t total;  // ≥ 1
    char ref[9];
    char name[17];
    uint8_t status;
};

struct ActionRequestFrame {
    uint32_t seq;
    char action_id[40];
    char agent_id[48];
    char approval_class[12];
    char title[kTitleMaxChars + 1];
    char body[kBodyMaxChars + 1];
    double timeout_s;
    bool decidable;
    bool is_question;
};

struct ActionResultFrame {
    uint32_t seq;
    char action_id[40];
    uint8_t status;  // 0 approved, 1 rejected, 2 timed_out, 3 stale, 4 error
};

struct HeartbeatFrame {
    uint32_t seq;
    char ts[40];
    bool hub_up;
    bool has_utc_offset;
    int16_t utc_offset_min;
};

struct HelloFrame {
    char fw[16];
    uint16_t screen_w, screen_h;
    char reset_reason[24];
    uint32_t heap_free;
};

struct ActionResponseFrame {
    char action_id[40];
    bool approve;  // true=approve, false=decline
    uint32_t ms;
};

struct ResyncFrame {
    uint32_t last_seq;
};

struct StatsFrame {
    double fps;
    uint32_t heap_free, heap_min, uptime_s, rx_overrun, parse_err;
};

struct LogFrame {
    uint8_t level;  // 0 debug, 1 info, 2 warn, 3 error
    char msg[kLogMsgMaxChars + 1];
};

struct IncomingFrame {
    FrameType type;
    SnapshotFrame snapshot;
    StateChangeFrame state_change;
    NotificationFrame notification;
    BubbleFrame bubble;
    SessionFocusFrame session_focus;
    ActionRequestFrame action_request;
    ActionResultFrame action_result;
    HeartbeatFrame heartbeat;
    HelloFrame hello;
    ActionResponseFrame action_response;
    ResyncFrame resync;
    StatsFrame stats;
    LogFrame log;
    /// Additive Felder (ADR-0002): gültig, aber gezählt (Fail loud beim Zähler).
    size_t unknown_fields;
};

struct DecodeOutcome {
    bool ok;
    IncomingFrame frame;
    const char* error;  // statischer Fehlertext
};

/// Dekodiert eine NDJSON-Zeile (WIRDN IN-PLACE MUTIERT — Scanner terminiert
/// Strings). len = Byte-Länge ohne Terminator; line braucht len+1 Bytes.
DecodeOutcome decodeFrame(char* line, size_t len);

// --- Encoder (ESP32 → PC), snprintf in feste Puffer, liefern Zeilenlänge ----

size_t encodeHello(char* buf, size_t cap, const char* fw, uint16_t screen_w, uint16_t screen_h,
                   const char* reset_reason, uint32_t heap_free);
size_t encodeActionResponse(char* buf, size_t cap, const char* action_id, bool approve,
                            uint32_t ms);
size_t encodeResync(char* buf, size_t cap, uint32_t last_seq);
size_t encodeStats(char* buf, size_t cap, double fps, uint32_t heap_free, uint32_t heap_min,
                   uint32_t uptime_s, uint32_t rx_overrun, uint32_t parse_err);
size_t encodeLog(char* buf, size_t cap, uint8_t level, const char* msg);

/// Touch-Aktionen ohne Entscheidung (ADR-0009). Nie ein Entscheidungsfeld: W9.
enum class UiAction : uint8_t { kStatusTap, kFocusNext, kBubbleAck };

/// `ref` darf nullptr sein. Liefert 0, wenn `ref` > 36 Zeichen ist oder `"`, `\\` oder
/// Steuerzeichen enthält (kein JSON-Ausbruch, K5) oder der Puffer nicht reicht.
size_t encodeUiAction(char* buf, size_t cap, UiAction action, const char* ref, uint32_t ms);

const char* nyxStateName(NyxState s);
NyxState nyxStateFromName(const char* name);

}  // namespace vw
