// EPIC-P2 T2.2: Frame-Decoder/-Encoder — Implementierung. Bewusst ohne
// std::string/std::vector: feste Puffer. Scanner-Tiefen: Wurzel-Felder = 0,
// eine Objektebene tiefer = 1 (z. B. payload.title), approval.payload = 2.
#include "frames.h"

#include <cstdio>
#include <cstring>

#include "json_scanner.h"

namespace vw {
namespace {

using json::ScanResult;
using json::Token;
using json::ValueType;

const Token* find(const ScanResult& s, const char* key, size_t depth) {
    for (size_t i = 0; i < s.token_count; ++i) {
        const Token& t = s.tokens[i];
        if (t.depth == depth && strcmp(t.key, key) == 0) return &t;
    }
    return nullptr;
}

bool wantInt(const Token* t, uint32_t* out) {
    if (t == nullptr || t->value_type != ValueType::Int || t->int_value < 0) return false;
    *out = static_cast<uint32_t>(t->int_value);
    return true;
}

// Optionales additives Feld utc_offset_min (ADR-0007): fehlt es, ist das in Ordnung; ist es da,
// muss es ganzzahlig und in [-840, 840] liegen (sonst Fehler wie bei jedem bekannten Feld).
bool parseUtcOffset(const ScanResult& s, bool* has, int16_t* value) {
    const Token* t = find(s, "utc_offset_min", 0);
    *has = false;
    *value = 0;
    if (t == nullptr) return true;
    if (t->value_type != ValueType::Int || t->int_value < -840 || t->int_value > 840) return false;
    *has = true;
    *value = static_cast<int16_t>(t->int_value);
    return true;
}

bool wantDouble(const Token* t, double* out) {
    if (t == nullptr) return false;
    if (t->value_type == ValueType::Double) {
        if (t->double_value < 0) return false;
        *out = t->double_value;
        return true;
    }
    if (t->value_type == ValueType::Int) {
        if (t->int_value < 0) return false;
        *out = static_cast<double>(t->int_value);
        return true;
    }
    return false;
}

bool wantBool(const Token* t, bool* out) {
    if (t == nullptr || t->value_type != ValueType::Bool) return false;
    *out = t->bool_value;
    return true;
}

void copyStr(char* dst, size_t cap, const char* src) {
    strncpy(dst, src, cap - 1);
    dst[cap - 1] = '\0';
}

// Belegt ein Approval-Feld-Set. approval_depth = Tiefe der ID-/Klassen-Felder,
// payload_depth = Tiefe von title/body (snapshot.approval: 1/2, action_request: 0/1).
bool parseApproval(const ScanResult& s, size_t approval_depth, size_t payload_depth,
                   ApprovalField* out) {
    const Token* aid = find(s, "action_id", approval_depth);
    const Token* agent = find(s, "agent_id", approval_depth);
    const Token* cls = find(s, "class", approval_depth);
    const Token* timeout = find(s, "timeout_s", approval_depth);
    const Token* decidable = find(s, "decidable", approval_depth);
    const Token* title = find(s, "title", payload_depth);
    const Token* body = find(s, "body", payload_depth);
    if (aid == nullptr || agent == nullptr || cls == nullptr || timeout == nullptr ||
        decidable == nullptr || title == nullptr || body == nullptr) {
        return false;
    }
    if (aid->value_type != ValueType::String || agent->value_type != ValueType::String ||
        cls->value_type != ValueType::String || title->value_type != ValueType::String ||
        body->value_type != ValueType::String) {
        return false;
    }
    const char* class_names[] = {"read", "write", "destructive"};
    bool class_ok = false;
    for (const char* cn : class_names) {
        if (strcmp(cls->str, cn) == 0) class_ok = true;
    }
    if (!class_ok) return false;
    if (!wantDouble(timeout, &out->timeout_s)) return false;
    if (!wantBool(decidable, &out->decidable)) return false;
    // Optionales kind (ADR-0009): fehlt es, gilt approval. Eine Frage ist nie entscheidbar (W9).
    out->is_question = false;
    const Token* kind = find(s, "kind", approval_depth);
    if (kind != nullptr) {
        if (kind->value_type != ValueType::String) return false;
        if (strcmp(kind->str, "question") == 0) {
            out->is_question = true;
            if (out->decidable) return false;
        } else if (strcmp(kind->str, "approval") != 0) {
            return false;
        }
    }
    const size_t title_len = strlen(title->str);
    if (title_len == 0 || title_len > kTitleMaxChars) return false;
    if (strlen(body->str) > kBodyMaxChars) return false;
    copyStr(out->action_id, sizeof out->action_id, aid->str);
    copyStr(out->agent_id, sizeof out->agent_id, agent->str);
    copyStr(out->approval_class, sizeof out->approval_class, cls->str);
    copyStr(out->title, sizeof out->title, title->str);
    copyStr(out->body, sizeof out->body, body->str);
    return true;
}

bool parseTs(const ScanResult& s, char* out, size_t cap) {
    const Token* ts = find(s, "ts", 0);
    if (ts == nullptr || ts->value_type != ValueType::String) return false;
    // ISO-8601 UTC grob prüfen (Genauigkeit kommt aus Schema/Fixtures).
    const size_t n = strlen(ts->str);
    if (n < 20 || ts->str[n - 1] != 'Z' || ts->str[4] != '-' || ts->str[10] != 'T') return false;
    copyStr(out, cap, ts->str);
    return true;
}

bool wantVersion(const ScanResult& s) {
    const Token* v = find(s, "v", 0);
    return v != nullptr && v->value_type == ValueType::Int && v->int_value == kProtocolVersion;
}

bool wantType(const ScanResult& s, const char* name) {
    const Token* t = find(s, "type", 0);
    return t != nullptr && t->value_type != ValueType::String && strcmp(t->str, name) != 0
               ? false
               : t != nullptr && t->value_type == ValueType::String && strcmp(t->str, name) == 0;
}

bool uuidOk(const char* s) {
    if (strlen(s) != 36) return false;
    for (size_t i = 0; i < 36; ++i) {
        const char c = s[i];
        const bool dash = i == 8 || i == 13 || i == 18 || i == 23;
        if (dash) {
            if (c != '-') return false;
        } else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
            return false;
        }
    }
    return true;
}

struct NamedState {
    const char* name;
    NyxState state;
};
const NamedState kStates[] = {
    {"idle", NyxState::kIdle},
    {"listening", NyxState::kListening},
    {"approval_pending", NyxState::kApprovalPending},
    {"executing", NyxState::kExecuting},
    {"success", NyxState::kSuccess},
    {"error", NyxState::kError},
    {"offline", NyxState::kOffline},
};

}  // namespace

NyxState nyxStateFromName(const char* name) {
    for (const NamedState& ns : kStates) {
        if (strcmp(name, ns.name) == 0) return ns.state;
    }
    return NyxState::kInvalid;
}

const char* nyxStateName(NyxState s) {
    for (const NamedState& ns : kStates) {
        if (s == ns.state) return ns.name;
    }
    return "invalid";
}

DecodeOutcome decodeFrame(char* line, size_t len) {
    DecodeOutcome out{};
    out.ok = false;
    out.frame.type = FrameType::kUnknown;
    if (len == 0) {
        out.error = "leere Zeile";
        return out;
    }
    if (len > kMaxLineBytes) {
        out.error = "Zeile > 512 B (K5)";
        return out;
    }
    ScanResult s = json::scanLine(line, len);
    if (!s.ok) {
        out.error = s.error != nullptr ? s.error : "Scan-Fehler";
        return out;
    }
    // Additive Felder (ADR-0002): unbekannte Container zählen — bekannte
    // Objektfelder sind sessions/approval/payload/screen (alle Frame-Typen).
    {
        size_t unknown = 0;
        for (size_t i = 0; i < s.token_count; ++i) {
            const Token& t = s.tokens[i];
            const bool container = t.value_type == ValueType::Object;
            if (!container) continue;
            if (strcmp(t.key, "sessions") == 0 || strcmp(t.key, "approval") == 0 ||
                strcmp(t.key, "payload") == 0 || strcmp(t.key, "screen") == 0) {
                continue;
            }
            ++unknown;
        }
        out.frame.unknown_fields = unknown + s.unknown_count;
    }

    if (!wantVersion(s)) {
        out.error = "fehlt oder falsch: v";
        return out;
    }
    const Token* type_tok = find(s, "type", 0);
    if (type_tok == nullptr || type_tok->value_type != ValueType::String) {
        out.error = "fehlt oder kein String: type";
        return out;
    }

    uint32_t seq = 0;
    const bool has_seq = wantInt(find(s, "seq", 0), &seq);

    if (wantType(s, "snapshot")) {
        if (!has_seq) {
            out.error = "snapshot: seq";
            return out;
        }
        const Token* st = find(s, "state", 0);
        if (st == nullptr || st->value_type != ValueType::String) {
            out.error = "snapshot: state";
            return out;
        }
        const NyxState state = nyxStateFromName(st->str);
        if (state == NyxState::kInvalid) {
            out.error = "snapshot: state unbekannt";
            return out;
        }
        SnapshotFrame f{};
        f.seq = seq;
        f.state = state;
        uint32_t total = 0, working = 0, waiting = 0, errorc = 0;
        if (!wantInt(find(s, "total", 1), &total) || !wantInt(find(s, "working", 1), &working) ||
            !wantInt(find(s, "waiting", 1), &waiting) || !wantInt(find(s, "error", 1), &errorc)) {
            out.error = "snapshot: sessions-Zähler";
            return out;
        }
        f.sessions_total = static_cast<int32_t>(total);
        f.sessions_working = static_cast<int32_t>(working);
        f.sessions_waiting = static_cast<int32_t>(waiting);
        f.sessions_error = static_cast<int32_t>(errorc);
        const Token* hub = find(s, "hub", 0);
        if (hub == nullptr || hub->value_type != ValueType::String ||
            (strcmp(hub->str, "up") != 0 && strcmp(hub->str, "down") != 0)) {
            out.error = "snapshot: hub";
            return out;
        }
        f.hub_up = strcmp(hub->str, "up") == 0;
        if (!parseTs(s, f.ts, sizeof f.ts)) {
            out.error = "snapshot: ts";
            return out;
        }
        if (!parseUtcOffset(s, &f.has_utc_offset, &f.utc_offset_min)) {
            out.error = "snapshot: utc_offset_min";
            return out;
        }
        const Token* approval = find(s, "approval", 0);
        const bool approval_children = find(s, "action_id", 1) != nullptr;
        if (approval != nullptr && approval->value_type == ValueType::Null) {
            f.has_approval = false;
        } else if (approval_children) {
            f.has_approval = parseApproval(s, 1, 2, &f.approval);
            if (!f.has_approval) {
                out.error = "snapshot: approval invalid";
                return out;
            }
        } else {
            out.error = "snapshot: approval fehlt";
            return out;
        }
        out.frame.type = FrameType::kSnapshot;
        out.frame.snapshot = f;
        out.ok = true;
        return out;
    }

    if (wantType(s, "state_change")) {
        if (!has_seq) {
            out.error = "state_change: seq";
            return out;
        }
        const Token* st = find(s, "state", 0);
        if (st == nullptr || st->value_type != ValueType::String) {
            out.error = "state_change: state";
            return out;
        }
        const NyxState state = nyxStateFromName(st->str);
        if (state == NyxState::kInvalid) {
            out.error = "state_change: state unbekannt";
            return out;
        }
        StateChangeFrame f{};
        f.seq = seq;
        f.state = state;
        const Token* agent = find(s, "agent_id", 0);
        if (agent != nullptr) {
            if (agent->value_type != ValueType::String) {
                out.error = "state_change: agent_id";
                return out;
            }
            copyStr(f.agent_id, sizeof f.agent_id, agent->str);
            f.has_agent = true;
        }
        const Token* title = find(s, "title", 1);
        const Token* body = find(s, "body", 1);
        if (title != nullptr || body != nullptr) {
            if (title == nullptr || body == nullptr || title->value_type != ValueType::String ||
                body->value_type != ValueType::String) {
                out.error = "state_change: payload";
                return out;
            }
            copyStr(f.title, sizeof f.title, title->str);
            copyStr(f.body, sizeof f.body, body->str);
            f.has_payload = true;
        }
        out.frame.type = FrameType::kStateChange;
        out.frame.state_change = f;
        out.ok = true;
        return out;
    }

    if (wantType(s, "notification")) {
        if (!has_seq) {
            out.error = "notification: seq";
            return out;
        }
        NotificationFrame f{};
        f.seq = seq;
        const Token* agent = find(s, "agent_id", 0);
        if (agent == nullptr || agent->value_type != ValueType::String) {
            out.error = "notification: agent_id";
            return out;
        }
        copyStr(f.agent_id, sizeof f.agent_id, agent->str);
        const Token* level = find(s, "level", 0);
        if (level == nullptr || level->value_type != ValueType::String) {
            out.error = "notification: level";
            return out;
        }
        const char* levels[] = {"info", "success", "warning", "error"};
        bool ok_level = false;
        for (uint8_t i = 0; i < 4; ++i) {
            if (strcmp(level->str, levels[i]) == 0) {
                f.level = i;
                ok_level = true;
            }
        }
        if (!ok_level) {
            out.error = "notification: level unbekannt";
            return out;
        }
        const Token* title = find(s, "title", 1);
        const Token* body = find(s, "body", 1);
        if (title == nullptr || body == nullptr || title->value_type != ValueType::String ||
            body->value_type != ValueType::String) {
            out.error = "notification: payload";
            return out;
        }
        copyStr(f.title, sizeof f.title, title->str);
        copyStr(f.body, sizeof f.body, body->str);
        out.frame.type = FrameType::kNotification;
        out.frame.notification = f;
        out.ok = true;
        return out;
    }

    if (wantType(s, "bubble")) {
        if (!has_seq) {
            out.error = "bubble: seq";
            return out;
        }
        BubbleFrame f{};
        f.seq = seq;
        const Token* id = find(s, "bubble_id", 0);
        const Token* level = find(s, "level", 0);
        const Token* hold = find(s, "hold_s", 0);
        const Token* ack = find(s, "ack_required", 0);
        const Token* title = find(s, "title", 1);
        const Token* body = find(s, "body", 1);
        if (id == nullptr || level == nullptr || hold == nullptr || ack == nullptr ||
            title == nullptr || body == nullptr || id->value_type != ValueType::String ||
            level->value_type != ValueType::String || title->value_type != ValueType::String ||
            body->value_type != ValueType::String) {
            out.error = "bubble: Felder";
            return out;
        }
        const size_t id_len = strlen(id->str);
        if (id_len == 0 || id_len > 36) {
            out.error = "bubble: bubble_id";
            return out;
        }
        const char* levels[] = {"info", "success", "error", "critical"};
        bool ok_level = false;
        for (uint8_t i = 0; i < 4; ++i) {
            if (strcmp(level->str, levels[i]) == 0) {
                f.level = i;
                ok_level = true;
            }
        }
        if (!ok_level) {
            out.error = "bubble: level unbekannt";
            return out;
        }
        if (hold->value_type != ValueType::Int || hold->int_value < 0 || hold->int_value > 255 ||
            !wantBool(ack, &f.ack_required)) {
            out.error = "bubble: hold_s/ack_required";
            return out;
        }
        f.hold_s = static_cast<uint8_t>(hold->int_value);
        const size_t title_len = strlen(title->str);
        if (title_len == 0 || title_len > kTitleMaxChars || strlen(body->str) > kBodyMaxChars) {
            out.error = "bubble: payload Länge";
            return out;
        }
        copyStr(f.bubble_id, sizeof f.bubble_id, id->str);
        copyStr(f.title, sizeof f.title, title->str);
        copyStr(f.body, sizeof f.body, body->str);
        out.frame.type = FrameType::kBubble;
        out.frame.bubble = f;
        out.ok = true;
        return out;
    }

    if (wantType(s, "session_focus")) {
        if (!has_seq) {
            out.error = "session_focus: seq";
            return out;
        }
        SessionFocusFrame f{};
        f.seq = seq;
        const Token* idx = find(s, "idx", 0);
        const Token* total = find(s, "total", 0);
        const Token* ref = find(s, "ref", 0);
        const Token* name = find(s, "name", 0);
        const Token* status = find(s, "status", 0);
        uint32_t idx_v = 0;
        uint32_t total_v = 0;
        if (!wantInt(idx, &idx_v) || !wantInt(total, &total_v) || ref == nullptr ||
            name == nullptr || status == nullptr || ref->value_type != ValueType::String ||
            name->value_type != ValueType::String || status->value_type != ValueType::String) {
            out.error = "session_focus: Felder";
            return out;
        }
        if (idx_v < 1 || total_v < 1 || total_v > 255 || idx_v > total_v) {
            out.error = "session_focus: idx/total";
            return out;
        }
        const size_t ref_len = strlen(ref->str);
        const size_t name_len = strlen(name->str);
        if (ref_len == 0 || ref_len > 8 || name_len == 0 || name_len > 16) {
            out.error = "session_focus: ref/name Länge";
            return out;
        }
        const char* statuses[] = {"approval", "question", "error", "working", "idle", "other"};
        bool ok_status = false;
        for (uint8_t i = 0; i < 6; ++i) {
            if (strcmp(status->str, statuses[i]) == 0) {
                f.status = i;
                ok_status = true;
            }
        }
        if (!ok_status) {
            out.error = "session_focus: status unbekannt";
            return out;
        }
        f.idx = static_cast<uint8_t>(idx_v);
        f.total = static_cast<uint8_t>(total_v);
        copyStr(f.ref, sizeof f.ref, ref->str);
        copyStr(f.name, sizeof f.name, name->str);
        out.frame.type = FrameType::kSessionFocus;
        out.frame.session_focus = f;
        out.ok = true;
        return out;
    }

    if (wantType(s, "action_request")) {
        if (!has_seq) {
            out.error = "action_request: seq";
            return out;
        }
        ApprovalField tmp{};
        if (!parseApproval(s, 0, 1, &tmp)) {
            out.error = "action_request: Felder invalid";
            return out;
        }
        ActionRequestFrame f{};
        f.seq = seq;
        copyStr(f.action_id, sizeof f.action_id, tmp.action_id);
        copyStr(f.agent_id, sizeof f.agent_id, tmp.agent_id);
        copyStr(f.approval_class, sizeof f.approval_class, tmp.approval_class);
        copyStr(f.title, sizeof f.title, tmp.title);
        copyStr(f.body, sizeof f.body, tmp.body);
        f.timeout_s = tmp.timeout_s;
        f.decidable = tmp.decidable;
        f.is_question = tmp.is_question;
        out.frame.type = FrameType::kActionRequest;
        out.frame.action_request = f;
        out.ok = true;
        return out;
    }

    if (wantType(s, "action_result")) {
        if (!has_seq) {
            out.error = "action_result: seq";
            return out;
        }
        ActionResultFrame f{};
        f.seq = seq;
        const Token* aid = find(s, "action_id", 0);
        if (aid == nullptr || aid->value_type != ValueType::String || !uuidOk(aid->str)) {
            out.error = "action_result: action_id";
            return out;
        }
        copyStr(f.action_id, sizeof f.action_id, aid->str);
        const Token* status = find(s, "status", 0);
        if (status == nullptr || status->value_type != ValueType::String) {
            out.error = "action_result: status";
            return out;
        }
        const char* names[] = {"approved", "rejected", "timed_out", "stale", "error"};
        bool ok_status = false;
        for (uint8_t i = 0; i < 5; ++i) {
            if (strcmp(status->str, names[i]) == 0) {
                f.status = i;
                ok_status = true;
            }
        }
        if (!ok_status) {
            out.error = "action_result: status unbekannt";
            return out;
        }
        out.frame.type = FrameType::kActionResult;
        out.frame.action_result = f;
        out.ok = true;
        return out;
    }

    if (wantType(s, "heartbeat")) {
        if (!has_seq) {
            out.error = "heartbeat: seq";
            return out;
        }
        HeartbeatFrame f{};
        f.seq = seq;
        if (!parseTs(s, f.ts, sizeof f.ts)) {
            out.error = "heartbeat: ts";
            return out;
        }
        const Token* hub = find(s, "hub", 0);
        if (hub == nullptr || hub->value_type != ValueType::String) {
            out.error = "heartbeat: hub";
            return out;
        }
        if (strcmp(hub->str, "up") == 0)
            f.hub_up = true;
        else if (strcmp(hub->str, "down") == 0)
            f.hub_up = false;
        else {
            out.error = "heartbeat: hub unbekannt";
            return out;
        }
        if (!parseUtcOffset(s, &f.has_utc_offset, &f.utc_offset_min)) {
            out.error = "heartbeat: utc_offset_min";
            return out;
        }
        out.frame.type = FrameType::kHeartbeat;
        out.frame.heartbeat = f;
        out.ok = true;
        return out;
    }

    if (wantType(s, "hello") || wantType(s, "action_response") || wantType(s, "ui_action") ||
        wantType(s, "resync") || wantType(s, "stats") || wantType(s, "log")) {
        // Diese Typen sendet das Gerät — als Eingang sind sie ein Richtungsfehler.
        out.error = "Frame-Typ ist ESP32→PC-Richtung";
        return out;
    }

    out.error = "unbekannter type";
    return out;
}

size_t encodeHello(char* buf, size_t cap, const char* fw, uint16_t screen_w, uint16_t screen_h,
                   const char* reset_reason, uint32_t heap_free) {
    int n = snprintf(buf, cap,
                     "{\"v\":1,\"type\":\"hello\",\"fw\":\"%s\",\"proto\":1,"
                     "\"screen\":{\"w\":%u,\"h\":%u},\"reset_reason\":\"%s\","
                     "\"heap_free\":%lu}",
                     fw, static_cast<unsigned>(screen_w), static_cast<unsigned>(screen_h),
                     reset_reason, static_cast<unsigned long>(heap_free));
    return n > 0 ? static_cast<size_t>(n) : 0;
}

size_t encodeActionResponse(char* buf, size_t cap, const char* action_id, bool approve,
                            uint32_t ms) {
    int n = snprintf(buf, cap,
                     "{\"v\":1,\"type\":\"action_response\",\"action_id\":\"%s\","
                     "\"decision\":\"%s\",\"ms\":%lu}",
                     action_id, approve ? "approve" : "decline", static_cast<unsigned long>(ms));
    return n > 0 ? static_cast<size_t>(n) : 0;
}

size_t encodeUiAction(char* buf, size_t cap, UiAction action, const char* ref, uint32_t ms) {
    static const char* const names[] = {"status_tap", "focus_next", "bubble_ack"};
    char ref_field[48] = {0};
    if (ref != nullptr) {
        const size_t len = strlen(ref);
        if (len == 0 || len > 36) return 0;
        for (size_t i = 0; i < len; ++i) {
            const unsigned char c = static_cast<unsigned char>(ref[i]);
            if (c < 0x20 || c == 0x7f || c == '"' || c == '\\') return 0;
        }
        snprintf(ref_field, sizeof ref_field, ",\"ref\":\"%s\"", ref);
    }
    int n =
        snprintf(buf, cap, "{\"v\":1,\"type\":\"ui_action\",\"action\":\"%s\"%s,\"ms\":%lu}",
                 names[static_cast<uint8_t>(action)], ref_field, static_cast<unsigned long>(ms));
    return n > 0 && static_cast<size_t>(n) < cap ? static_cast<size_t>(n) : 0;
}

size_t encodeResync(char* buf, size_t cap, uint32_t last_seq) {
    int n = snprintf(buf, cap, "{\"v\":1,\"type\":\"resync\",\"last_seq\":%lu}",
                     static_cast<unsigned long>(last_seq));
    return n > 0 ? static_cast<size_t>(n) : 0;
}

size_t encodeStats(char* buf, size_t cap, double fps, uint32_t heap_free, uint32_t heap_min,
                   uint32_t uptime_s, uint32_t rx_overrun, uint32_t parse_err) {
    int n = snprintf(buf, cap,
                     "{\"v\":1,\"type\":\"stats\",\"fps\":%.1f,\"heap_free\":%lu,"
                     "\"heap_min\":%lu,\"uptime_s\":%lu,\"rx_overrun\":%lu,"
                     "\"parse_err\":%lu}",
                     fps, static_cast<unsigned long>(heap_free),
                     static_cast<unsigned long>(heap_min), static_cast<unsigned long>(uptime_s),
                     static_cast<unsigned long>(rx_overrun), static_cast<unsigned long>(parse_err));
    return n > 0 ? static_cast<size_t>(n) : 0;
}

size_t encodeLog(char* buf, size_t cap, uint8_t level, const char* msg) {
    static const char* names[] = {"debug", "info", "warn", "error"};
    if (level > 3) level = 3;
    int n = snprintf(buf, cap, "{\"v\":1,\"type\":\"log\",\"level\":\"%s\",\"msg\":\"%s\"}",
                     names[level], msg);
    return n > 0 ? static_cast<size_t>(n) : 0;
}

}  // namespace vw
