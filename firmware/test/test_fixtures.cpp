// EPIC-P2 T2.2: Firmware-Contract-Test — der echte Parser (protocol/frames)
// gegen dieselben Fixtures wie der Node-Test. Zeilenlängen-Grenze (W4/K5),
// Struktur-Validierung und Encoder-Roundtrips: kein IGNORE mehr.
#include <unity.h>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

// Unit-UnderTest direkt einbinden (kein separater Lib-Build im native-Env):
#include "fixtures.list.h"  // generiert: firmware/generate_fixture_list.py
#include "hal/line_reader.cpp"
#include "protocol/frames.cpp"
#include "protocol/json_scanner.cpp"
#include "render/font5x7.h"
#include "render/idle_life.cpp"
#include "render/renderer.cpp"
#include "state/approval_flow.cpp"
#include "state/bubble_view.cpp"
#include "state/dim_controller.cpp"
#include "state/frame_stats.cpp"
#include "state/offline_info.cpp"
#include "state/state_machine.cpp"
#include "state/touch_map.cpp"
#include "state/touch_tracker.cpp"
#include "state/ui_layout.cpp"

namespace {

struct Fixture {
    std::string name;
    std::string line;
};

std::string readLine(const std::string& base, const char* name) {
    FILE* in = fopen((base + "/" + name).c_str(), "rb");
    if (in == nullptr) return "";
    std::string out;
    char buf[600];
    const size_t n = fread(buf, 1, sizeof buf, in);
    fclose(in);
    out.assign(buf, n);
    while (!out.empty() && (out.back() == '\n' || out.back() == '\r')) out.pop_back();
    return out;
}

std::vector<Fixture> loadFixtures() {
    const char* bases[] = {"../protocol/fixtures", "protocol/fixtures"};
    std::vector<Fixture> out;
    for (const char* base : bases) {
        out.clear();
        for (size_t i = 0; i < FIXTURE_COUNT; ++i) {
            std::string line = readLine(base, FIXTURE_NAMES[i]);
            if (!line.empty()) out.push_back({FIXTURE_NAMES[i], line});
        }
        if (out.size() == FIXTURE_COUNT) break;
    }
    return out;
}

const char* typeName(vw::FrameType t) {
    switch (t) {
        case vw::FrameType::kSnapshot:
            return "snapshot";
        case vw::FrameType::kStateChange:
            return "state_change";
        case vw::FrameType::kNotification:
            return "notification";
        case vw::FrameType::kBubble:
            return "bubble";
        case vw::FrameType::kSessionFocus:
            return "session_focus";
        case vw::FrameType::kActionRequest:
            return "action_request";
        case vw::FrameType::kActionResult:
            return "action_result";
        case vw::FrameType::kHeartbeat:
            return "heartbeat";
        case vw::FrameType::kHello:
            return "hello";
        case vw::FrameType::kActionResponse:
            return "action_response";
        case vw::FrameType::kResync:
            return "resync";
        case vw::FrameType::kStats:
            return "stats";
        case vw::FrameType::kLog:
            return "log";
        default:
            return "unknown";
    }
}

}  // namespace

void test_fixtures_present() { TEST_ASSERT_EQUAL_INT(FIXTURE_COUNT, (int)loadFixtures().size()); }

void test_valid_fixture_lines_fit_512_bytes() {
    for (const Fixture& f : loadFixtures()) {
        if (f.name.find(".valid.") == std::string::npos) continue;
        TEST_ASSERT_LESS_OR_EQUAL_MESSAGE(512, (int)f.line.size(), f.name.c_str());
    }
}

void test_valid_fixtures_decode_ok_and_type_matches_filename() {
    // Nur PC→ESP32-Typen: hello/action_response/resync/stats/log sendet das
    // Geraet selbst — als Eingang sind sie Richtungsfehler (Encode-Test unten).
    const char* const incoming[] = {"snapshot",      "state_change",  "notification",
                                    "bubble",        "session_focus", "action_request",
                                    "action_result", "heartbeat"};
    int checked = 0;
    for (const Fixture& f : loadFixtures()) {
        if (f.name.find(".valid.") == std::string::npos) continue;
        const std::string base = f.name.substr(0, f.name.find('.'));
        bool is_incoming = false;
        for (const char* inc : incoming) {
            if (base == inc) is_incoming = true;
        }
        if (!is_incoming) continue;
        char buf[vw::kMaxLineBytes + 1];
        memcpy(buf, f.line.data(), f.line.size());
        buf[f.line.size()] = '\0';
        vw::DecodeOutcome res = vw::decodeFrame(buf, f.line.size());
        char msg[160];
        snprintf(msg, sizeof msg, "%s: %s", f.name.c_str(), res.ok ? "ok" : res.error);
        TEST_ASSERT_MESSAGE(res.ok, msg);
        const std::string expected_type = f.name.substr(0, f.name.find('.'));
        TEST_ASSERT_EQUAL_STRING_MESSAGE(expected_type.c_str(), typeName(res.frame.type),
                                         f.name.c_str());
        ++checked;
    }
    TEST_ASSERT_GREATER_THAN_MESSAGE(6, checked, "7 PC→ESP-Typen mind.");
}

void test_invalid_fixtures_rejected() {
    // Ungueltige PC→ESP-Fixtures muessen scheitern; ungueltige ESP→PC-Fixtures
    // scheitern automatisch (Richtungspruefung) — auch gezaehlt.
    int checked = 0;
    for (const Fixture& f : loadFixtures()) {
        if (f.name.find(".invalid-") == std::string::npos) continue;
        char buf[1024];
        memcpy(buf, f.line.data(), std::min(f.line.size(), sizeof buf - 1));
        buf[std::min(f.line.size(), sizeof buf - 1)] = '\0';
        vw::DecodeOutcome res = vw::decodeFrame(buf, f.line.size());
        char msg[160];
        snprintf(msg, sizeof msg, "%s sollte scheitern (%s)", f.name.c_str(),
                 res.ok ? "war ok" : res.error);
        TEST_ASSERT_MESSAGE(!res.ok, msg);
        ++checked;
    }
    TEST_ASSERT_GREATER_THAN_MESSAGE(10, checked, "alle invalid-Fixtures geprüft");
}

void test_oversize_fixture_exceeds_limit() {
    int found = 0;
    for (const Fixture& f : loadFixtures()) {
        if (f.name.find("invalid-oversize") == std::string::npos) continue;
        if (f.line.size() > 512) ++found;
    }
    TEST_ASSERT_GREATER_THAN_MESSAGE(0, found, "invalid-oversize-Fixture muss > 512 Byte sein");
}

void test_question_kind_is_parsed_and_never_decidable() {
    char q[] =
        "{\"v\":1,\"type\":\"snapshot\",\"seq\":13,\"state\":\"approval_pending\",\"sessions\":"
        "{\"total\":1,\"working\":0,\"waiting\":1,\"error\":0},\"approval\":{\"action_id\":"
        "\"0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6\",\"kind\":\"question\",\"agent_id\":\"a\","
        "\"class\":\"write\",\"payload\":{\"title\":\"Welche Variante?\",\"body\":\"x\"},"
        "\"timeout_s\":120,\"decidable\":false},\"hub\":\"up\",\"ts\":\"2026-11-05T12:00:00Z\"}";
    vw::DecodeOutcome r = vw::decodeFrame(q, strlen(q));
    TEST_ASSERT_TRUE_MESSAGE(r.ok, r.error);
    TEST_ASSERT_TRUE(r.frame.snapshot.approval.is_question);
    TEST_ASSERT_FALSE(r.frame.snapshot.approval.decidable);

    char plain[] =
        "{\"v\":1,\"type\":\"action_request\",\"seq\":1,\"action_id\":"
        "\"0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6\",\"agent_id\":\"a\",\"class\":\"write\","
        "\"payload\":{\"title\":\"t\",\"body\":\"b\"},\"timeout_s\":10,\"decidable\":true}";
    vw::DecodeOutcome p = vw::decodeFrame(plain, strlen(plain));
    TEST_ASSERT_TRUE(p.ok);
    TEST_ASSERT_FALSE_MESSAGE(p.frame.action_request.is_question, "Default ist approval");
}

void test_session_focus_fields_and_limits() {
    char ok[] =
        "{\"v\":1,\"type\":\"session_focus\",\"seq\":30,\"idx\":2,\"total\":3,\"ref\":\"3f9a2c\","
        "\"name\":\"Agent 3f9a2c\",\"status\":\"working\"}";
    vw::DecodeOutcome r = vw::decodeFrame(ok, strlen(ok));
    TEST_ASSERT_TRUE_MESSAGE(r.ok, r.error);
    TEST_ASSERT_EQUAL_UINT(30, r.frame.session_focus.seq);
    TEST_ASSERT_EQUAL_UINT8(2, r.frame.session_focus.idx);
    TEST_ASSERT_EQUAL_UINT8(3, r.frame.session_focus.total);
    TEST_ASSERT_EQUAL_STRING("3f9a2c", r.frame.session_focus.ref);
    TEST_ASSERT_EQUAL_STRING("Agent 3f9a2c", r.frame.session_focus.name);
    TEST_ASSERT_EQUAL_UINT8(3, r.frame.session_focus.status);  // working

    // idx > total ist ein Protokollfehler (Schema erzwingt es nicht, die Firmware schon)
    char bad[] =
        "{\"v\":1,\"type\":\"session_focus\",\"seq\":1,\"idx\":4,\"total\":3,\"ref\":\"r\","
        "\"name\":\"n\",\"status\":\"idle\"}";
    TEST_ASSERT_FALSE(vw::decodeFrame(bad, strlen(bad)).ok);
    char noseq[] =
        "{\"v\":1,\"type\":\"session_focus\",\"idx\":1,\"total\":1,\"ref\":\"r\",\"name\":\"n\","
        "\"status\":\"idle\"}";
    TEST_ASSERT_FALSE(vw::decodeFrame(noseq, strlen(noseq)).ok);
}

// --- ADR-0009: Sprechblase (Typewriter, Umbruch, Haltezeit, Verdrängung) und Touch-Layout ---
vw::BubbleFrame makeBubble(const char* id, uint8_t level, const char* title, const char* body,
                           uint8_t hold_s, bool ack) {
    vw::BubbleFrame f{};
    strncpy(f.bubble_id, id, sizeof f.bubble_id - 1);
    f.level = level;
    strncpy(f.title, title, sizeof f.title - 1);
    strncpy(f.body, body, sizeof f.body - 1);
    f.hold_s = hold_s;
    f.ack_required = ack;
    return f;
}

void test_bubble_typewriter_reveals_per_char_and_never_splits_utf8() {
    vw::BubbleView v;
    // 'ä' ist 2 Byte: die sichtbare Länge darf nie mitten im Zeichen enden.
    const vw::BubbleFrame f = makeBubble("b1", 0, "Nyx", "Äpfel und Öl", 6, false);
    TEST_ASSERT_EQUAL_INT(vw::BubbleView::Result::kShown, (int)v.show(f, 1000, false));
    TEST_ASSERT_EQUAL_UINT(0, v.visibleBytes(1000));
    TEST_ASSERT_EQUAL_UINT(2, v.visibleBytes(1000 + vw::kTypeMsPerChar));  // 'Ä' = 2 Byte
    TEST_ASSERT_EQUAL_UINT(3, v.visibleBytes(1000 + 2 * vw::kTypeMsPerChar));
    // Nie ein halbes Zeichen: jede Länge liegt auf einer Zeichengrenze.
    for (uint32_t t = 1000; t < 1000 + 20 * vw::kTypeMsPerChar; t += 7) {
        const size_t n = v.visibleBytes(t);
        TEST_ASSERT_TRUE(n == 0 || (static_cast<unsigned char>(v.body()[n]) & 0xC0) != 0x80);
    }
    const size_t total = strlen(v.body());
    TEST_ASSERT_EQUAL_UINT(total, v.visibleBytes(1000 + 1000 * vw::kTypeMsPerChar));
    TEST_ASSERT_FALSE(v.typingDone(1000 + 2 * vw::kTypeMsPerChar));
    TEST_ASSERT_TRUE(v.typingDone(1000 + 1000 * vw::kTypeMsPerChar));
}

void test_bubble_error_and_critical_show_full_text_at_once() {
    vw::BubbleView v;
    v.show(makeBubble("e1", 2, "Fehler", "Build fehlgeschlagen", 12, false), 0, false);
    TEST_ASSERT_EQUAL_UINT(strlen("Build fehlgeschlagen"), v.visibleBytes(0));
    vw::BubbleView c;
    c.show(makeBubble("c1", 3, "Freigabe", "Bitte bestätigen", 0, true), 0, false);
    TEST_ASSERT_EQUAL_UINT(strlen("Bitte bestätigen"), c.visibleBytes(0));
}

void test_bubble_wraps_words_at_20_cols_and_splits_overlong_words() {
    vw::BubbleView v;
    v.show(
        makeBubble("w1", 0, "Titel", "Zwei Agents arbeiten. Einer wartet auf Eingriff.", 6, false),
        0, false);
    TEST_ASSERT_GREATER_THAN(1, v.bodyRowCount());
    for (uint8_t i = 0; i < v.bodyRowCount(); ++i)
        TEST_ASSERT_LESS_OR_EQUAL(vw::kBubbleCols, v.bodyRow(i).cols);
    // Ein Wort länger als eine Zeile wird hart getrennt, nichts geht verloren.
    vw::BubbleView u;
    u.show(makeBubble("w2", 0, "T", "Donaudampfschifffahrtsgesellschaft", 6, false), 0, false);
    size_t bytes = 0;
    for (uint8_t i = 0; i < u.bodyRowCount(); ++i) {
        TEST_ASSERT_LESS_OR_EQUAL(vw::kBubbleCols, u.bodyRow(i).cols);
        bytes += u.bodyRow(i).len;
    }
    TEST_ASSERT_EQUAL_UINT(strlen("Donaudampfschifffahrtsgesellschaft"), bytes);
}

void test_bubble_full_body_160_chars_fits_the_row_budget() {
    vw::BubbleView v;
    char body[161];
    for (int i = 0; i < 160; ++i) body[i] = (i % 8 == 7) ? ' ' : 'a';
    body[160] = '\0';
    v.show(makeBubble("w3", 0, "Titel mit vierzig Zeichen Laenge ist hier", body, 6, false), 0,
           false);
    TEST_ASSERT_LESS_OR_EQUAL(vw::kBubbleMaxBodyRows, v.bodyRowCount());
    TEST_ASSERT_LESS_OR_EQUAL(vw::kBubbleMaxTitleRows, v.titleRowCount());
    TEST_ASSERT_LESS_OR_EQUAL(20,
                              (int)(v.titleRowCount() + v.bodyRowCount()));  // 20 × 9 px = 180 px
}

void test_bubble_hold_counts_from_typing_end_and_zero_hold_stays_until_ack() {
    vw::BubbleView v;
    v.show(makeBubble("h1", 0, "Nyx", "Hallo", 6, false), 0, false);
    const uint32_t typed = 5 * vw::kTypeMsPerChar;
    v.tick(typed + 5999);
    TEST_ASSERT_TRUE(v.visible());
    v.tick(typed + 6000);
    TEST_ASSERT_FALSE(v.visible());

    vw::BubbleView c;
    c.show(makeBubble("c2", 3, "Freigabe", "wichtig", 0, true), 0, false);
    c.tick(10000000);
    TEST_ASSERT_TRUE_MESSAGE(c.visible(), "kritisch bleibt bis Ack");
    TEST_ASSERT_TRUE(c.criticalPending());
    c.ack("anderes-id");
    TEST_ASSERT_TRUE(c.visible());
    c.ack("c2");
    TEST_ASSERT_FALSE(c.visible());
    TEST_ASSERT_FALSE(c.criticalPending());
}

void test_bubble_critical_hold_is_ignored_even_if_frame_sets_hold_s() {
    vw::BubbleView c;
    c.show(makeBubble("c3", 3, "x", "y", 5, true), 0, false);
    c.tick(60000);
    TEST_ASSERT_TRUE_MESSAGE(c.visible(), "ack_required überstimmt hold_s");
}

void test_bubble_same_id_does_not_restart_and_unacked_critical_is_never_replaced() {
    vw::BubbleView v;
    const vw::BubbleFrame a = makeBubble("a1", 0, "Nyx", "Hallo Welt", 6, false);
    TEST_ASSERT_EQUAL_INT(vw::BubbleView::Result::kShown, (int)v.show(a, 0, false));
    TEST_ASSERT_EQUAL_INT(vw::BubbleView::Result::kSame, (int)v.show(a, 500, false));
    TEST_ASSERT_EQUAL_UINT(0, v.rejected());

    vw::BubbleView c;
    c.show(makeBubble("k1", 3, "Wichtig", "bitte lesen", 0, true), 0, false);
    TEST_ASSERT_EQUAL_INT(
        vw::BubbleView::Result::kRejectedByCritical,
        (int)c.show(makeBubble("i1", 0, "Nyx", "Geplapper", 6, false), 10, false));
    TEST_ASSERT_EQUAL_STRING("k1", c.id());
    TEST_ASSERT_EQUAL_UINT(1, c.rejected());  // Fail loud: gezählt, nicht still verworfen
    // Eine neue kritische ersetzt die alte; eine normale darf nach dem Ack wieder erscheinen.
    TEST_ASSERT_EQUAL_INT(
        vw::BubbleView::Result::kShown,
        (int)c.show(makeBubble("k2", 3, "Noch wichtiger", "jetzt", 0, true), 20, false));
    c.ack("k2");
    TEST_ASSERT_EQUAL_INT(
        vw::BubbleView::Result::kShown,
        (int)c.show(makeBubble("i2", 0, "Nyx", "Wieder da", 6, false), 30, false));
}

void test_bubble_never_overlays_an_approval_and_critical_returns_after_it() {
    vw::BubbleView v;
    // Freigabe aktiv: normale Blasen werden abgelehnt und gezählt, nichts wird gezeichnet.
    TEST_ASSERT_EQUAL_INT(vw::BubbleView::Result::kRejectedApproval,
                          (int)v.show(makeBubble("i1", 0, "Nyx", "Hallo", 6, false), 0, true));
    TEST_ASSERT_FALSE(v.visible());
    TEST_ASSERT_EQUAL_UINT(1, v.rejected());
    // Eine laufende normale Blase verschwindet, wenn eine Freigabe erscheint.
    v.show(makeBubble("i2", 0, "Nyx", "Hallo", 6, false), 100, false);
    TEST_ASSERT_TRUE(v.visible());
    v.setApprovalActive(true);
    TEST_ASSERT_FALSE(v.visible());
    // Eine kritische Blase wird gemerkt, aber unter der Freigabe nicht gezeigt …
    vw::BubbleView c;
    c.show(makeBubble("k1", 3, "Wichtig", "bitte lesen", 0, true), 0, true);
    TEST_ASSERT_FALSE(c.visible());
    TEST_ASSERT_TRUE(c.criticalPending());
    // … und kommt nach der Freigabe zurück.
    c.setApprovalActive(false);
    TEST_ASSERT_TRUE(c.visible());
    TEST_ASSERT_EQUAL_STRING("k1", c.id());
}

void test_bubble_revision_changes_only_when_the_picture_changes() {
    vw::BubbleView v;
    const uint32_t r0 = v.revision();
    v.show(makeBubble("r1", 0, "Nyx", "Hallo", 6, false), 0, false);
    const uint32_t r1 = v.revision();
    TEST_ASSERT_NOT_EQUAL(r0, r1);
    v.show(makeBubble("r1", 0, "Nyx", "Hallo", 6, false), 5, false);  // gleiche ID
    TEST_ASSERT_EQUAL_UINT(r1, v.revision());
    v.tick(60000);
    TEST_ASSERT_NOT_EQUAL(r1, v.revision());  // abgelaufen → neues Bild
}

void test_layout_nyx_moves_left_for_a_bubble_and_zones_never_overlap() {
    for (int mask = 0; mask < 8; ++mask) {
        const bool bubble = (mask & 1) != 0;
        const bool critical = bubble && (mask & 2) != 0;
        const bool indicator = (mask & 4) != 0;
        const vw::UiLayout l = vw::computeLayout(bubble, critical, indicator);
        TEST_ASSERT_EQUAL_INT(bubble ? 0 : 64, l.nyx_x);
        TEST_ASSERT_EQUAL_INT(12, l.nyx_y);
        for (uint8_t i = 0; i < l.zone_count; ++i) {
            const vw::Zone& a = l.zones[i];
            TEST_ASSERT_TRUE(a.x >= 0 && a.y >= 0 && a.x + a.w <= 320 && a.y + a.h <= 240);
            for (uint8_t j = i + 1; j < l.zone_count; ++j) {
                const vw::Zone& b = l.zones[j];
                TEST_ASSERT_NOT_EQUAL(a.id, b.id);
                const bool overlap =
                    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
                TEST_ASSERT_FALSE_MESSAGE(overlap, "Touch-Zonen überlappen");
            }
        }
    }
}

// Der Pixelfont hat nur Großbuchstaben (+ ä ö ü ß): Kleinbuchstaben müssen auf Großbuchstaben
// fallen, sonst bleibt Blasentext lückenhaft (am Board gesehen, 2026-11-05).
void test_bubble_glyph_lowercase_falls_back_to_uppercase() {
    const char* a = "a";
    const char* up = "A";
    const vw::FontGlyph* lo = vw::bubbleGlyph(a, 1);
    const vw::FontGlyph* hi = vw::bubbleGlyph(up, 1);
    TEST_ASSERT_NOT_NULL(lo);
    TEST_ASSERT_EQUAL_PTR(hi, lo);
    TEST_ASSERT_NOT_NULL(vw::bubbleGlyph("\xC3\xA4", 2));  // ä hat ein eigenes Glyph
    TEST_ASSERT_NOT_EQUAL(vw::bubbleGlyph("\xC3\xA4", 2), vw::bubbleGlyph("\xC3\x84", 2));
    TEST_ASSERT_NULL(vw::bubbleGlyph("\xE2\x82\xAC", 3));  // € unbekannt: Lücke, kein Absturz
    for (char c = 'a'; c <= 'z'; ++c) TEST_ASSERT_NOT_NULL(vw::bubbleGlyph(&c, 1));
}

// Der Ticker (Letzter Report) zeigt Hub-Text: Kleinbuchstaben müssen wie Großbuchstaben erscheinen,
// sonst bleibt "Fertig" eine Lücke (am Board gesehen, 2026-11-05).
void test_ticker_draws_lowercase_like_uppercase() {
    static uint16_t lo[vw::kCanvasW * vw::kCanvasH];
    static uint16_t hi[vw::kCanvasW * vw::kCanvasH];
    memset(lo, 0, sizeof lo);
    memset(hi, 0, sizeof hi);
    vw::Ticker a, b;
    a.setText("fertig gruen", "");
    b.setText("FERTIG GRUEN", "");
    a.draw(lo, 0, 0xFFFF);
    b.draw(hi, 0, 0xFFFF);
    size_t lit = 0;
    for (size_t i = 0; i < vw::kCanvasW * vw::kCanvasH; ++i) lit += lo[i] != 0;
    TEST_ASSERT_GREATER_THAN(40, lit);
    TEST_ASSERT_EQUAL_MEMORY(hi, lo, sizeof lo);
}

// Kurze Blasen in doppelter Größe (besser lesbar), lange bleiben einfach, damit alles passt.
static vw::BubbleFrame bubbleOf(const char* title, const char* body) {
    vw::BubbleFrame f{};
    snprintf(f.bubble_id, sizeof f.bubble_id, "sz");
    snprintf(f.title, sizeof f.title, "%s", title);
    snprintf(f.body, sizeof f.body, "%s", body);
    f.hold_s = 6;
    return f;
}

void test_bubble_short_text_is_drawn_double_size_with_10_columns() {
    vw::BubbleView b;
    b.show(bubbleOf("Nyx", "Ich halte die Wacht."), 0, false);
    TEST_ASSERT_EQUAL_UINT8(2, b.scale());
    for (uint8_t r = 0; r < b.bodyRowCount(); ++r)
        TEST_ASSERT_LESS_OR_EQUAL_UINT8(10, b.bodyRow(r).cols);
    TEST_ASSERT_GREATER_THAN_UINT8(
        1, b.bodyRowCount());  // 20 Zeichen brauchen bei 10 Spalten 2+ Zeilen
}

void test_bubble_long_text_stays_single_size_with_20_columns() {
    vw::BubbleView b;
    b.show(
        bubbleOf("Nyx", "Dieser Text ist deutlich laenger als vierzig Zeichen und bleibt klein."),
        0, false);
    TEST_ASSERT_EQUAL_UINT8(1, b.scale());
    for (uint8_t r = 0; r < b.bodyRowCount(); ++r)
        TEST_ASSERT_LESS_OR_EQUAL_UINT8(20, b.bodyRow(r).cols);
}

void test_bubble_double_size_worst_case_fits_the_column_height() {
    vw::BubbleView b;
    // Titel 20, Körper 40 Zeichen aus lauter 9-Zeichen-Wörtern: ungünstigster Umbruch bei 10
    // Spalten.
    b.show(bubbleOf("aaaaaaaaa bbbbbbbbb", "cccccccc dddddddd eeeeeeee ffffffff"), 0, false);
    TEST_ASSERT_EQUAL_UINT8(2, b.scale());
    const int height = (b.titleRowCount() + b.bodyRowCount()) * 18 + 6;
    TEST_ASSERT_LESS_OR_EQUAL_INT(170, height);  // Spalte 176 px, Rand bleibt
}

void test_layout_zone_sizes_and_presence() {
    const vw::UiLayout plain = vw::computeLayout(false, false, false);
    TEST_ASSERT_EQUAL_UINT8(1, plain.zone_count);  // nur Nyx
    TEST_ASSERT_EQUAL_UINT8(vw::kZoneNyx, plain.zones[0].id);

    const vw::UiLayout full = vw::computeLayout(true, true, true);
    TEST_ASSERT_EQUAL_UINT8(3, full.zone_count);
    bool has_focus = false, has_bubble = false;
    for (uint8_t i = 0; i < full.zone_count; ++i) {
        const vw::Zone& z = full.zones[i];
        if (z.id == vw::kZoneFocus) {
            has_focus = true;
            TEST_ASSERT_GREATER_OR_EQUAL(44, z.w);  // Steuerfläche ≥ 44 px (ADR-0007)
            TEST_ASSERT_GREATER_OR_EQUAL(44, z.h);
        }
        if (z.id == vw::kZoneBubble) has_bubble = true;
    }
    TEST_ASSERT_TRUE(has_focus && has_bubble);

    // Eine nicht kritische Blase hat keine Tap-Fläche (nichts zu quittieren).
    const vw::UiLayout info = vw::computeLayout(true, false, false);
    TEST_ASSERT_EQUAL_UINT8(1, info.zone_count);
    // Ohne Mehr-Sessions kein Indikator.
    const vw::UiLayout one = vw::computeLayout(false, false, false);
    for (uint8_t i = 0; i < one.zone_count; ++i)
        TEST_ASSERT_NOT_EQUAL(vw::kZoneFocus, one.zones[i].id);
}

void test_additive_fields_counted_not_rejected() {
    char buf[] =
        "{\"v\":1,\"type\":\"heartbeat\",\"seq\":1,\"ts\":\"2026-11-03T12:00:00Z\",\"hub\":\"up\","
        "\"future_field\":{\"x\":1}}";
    vw::DecodeOutcome res = vw::decodeFrame(buf, strlen(buf));
    TEST_ASSERT_TRUE(res.ok);
    TEST_ASSERT_EQUAL_UINT(1, res.frame.unknown_fields);
}

void test_encoder_matches_golden_fixtures_bytewise() {
    // Die Encoder-Ausgaben muessen bytengleich zu den goldenen ESP→PC-Fixtures
    // sein (gleiche Feldreihenfolge, gleiche Formatierung) — Drift-Schutz.
    char buf[vw::kMaxLineBytes + 1];
    size_t n = vw::encodeHello(buf, sizeof buf, "0.1.0", 480, 320, "POWERON_RESET", 286000);
    buf[n] = '\0';
    TEST_ASSERT_EQUAL_STRING(
        "{\"v\":1,\"type\":\"hello\",\"fw\":\"0.1.0\",\"proto\":1,\"screen\":{\"w\":480,\"h\":320},"
        "\"reset_reason\":\"POWERON_RESET\",\"heap_free\":286000}",
        buf);

    n = vw::encodeActionResponse(buf, sizeof buf, "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6", true,
                                 8450);
    buf[n] = '\0';
    TEST_ASSERT_EQUAL_STRING(
        "{\"v\":1,\"type\":\"action_response\",\"action_id\":\"0e0f1e2e-3b4c-4d5e-8f9a-"
        "a1b2c3d4e5f6\","
        "\"decision\":\"approve\",\"ms\":8450}",
        buf);

    n = vw::encodeResync(buf, sizeof buf, 41);
    buf[n] = '\0';
    TEST_ASSERT_EQUAL_STRING("{\"v\":1,\"type\":\"resync\",\"last_seq\":41}", buf);

    // ui_action: bytengleich zu protocol/fixtures/ui_action.valid*.ndjson
    n = vw::encodeUiAction(buf, sizeof buf, vw::UiAction::kStatusTap, nullptr, 4210);
    buf[n] = '\0';
    TEST_ASSERT_EQUAL_STRING(
        "{\"v\":1,\"type\":\"ui_action\",\"action\":\"status_tap\",\"ms\":4210}", buf);
    n = vw::encodeUiAction(buf, sizeof buf, vw::UiAction::kFocusNext, nullptr, 9020);
    buf[n] = '\0';
    TEST_ASSERT_EQUAL_STRING(
        "{\"v\":1,\"type\":\"ui_action\",\"action\":\"focus_next\",\"ms\":9020}", buf);
    n = vw::encodeUiAction(buf, sizeof buf, vw::UiAction::kBubbleAck, "b-0007", 120);
    buf[n] = '\0';
    TEST_ASSERT_EQUAL_STRING(
        "{\"v\":1,\"type\":\"ui_action\",\"action\":\"bubble_ack\",\"ref\":\"b-0007\",\"ms\":120}",
        buf);

    n = vw::encodeStats(buf, sizeof buf, 28.4, 182000, 175000, 3600, 0, 0);
    buf[n] = '\0';
    TEST_ASSERT_EQUAL_STRING(
        "{\"v\":1,\"type\":\"stats\",\"fps\":28.4,\"heap_free\":182000,\"heap_min\":175000,"
        "\"uptime_s\":3600,\"rx_overrun\":0,\"parse_err\":0}",
        buf);
}

void test_ui_action_encoder_refuses_unsafe_ref_and_incoming_is_direction_error() {
    char buf[vw::kMaxLineBytes + 1];
    // Anführungszeichen, Backslash, Steuerzeichen und Überlänge dürfen nie in die Zeile
    // (kein JSON-Ausbruch, K5): der Encoder liefert 0 und schreibt nichts Gültiges.
    TEST_ASSERT_EQUAL_UINT(
        0, vw::encodeUiAction(buf, sizeof buf, vw::UiAction::kBubbleAck, "a\"b", 1));
    TEST_ASSERT_EQUAL_UINT(
        0, vw::encodeUiAction(buf, sizeof buf, vw::UiAction::kBubbleAck, "a\\b", 1));
    TEST_ASSERT_EQUAL_UINT(
        0, vw::encodeUiAction(buf, sizeof buf, vw::UiAction::kBubbleAck, "a\nb", 1));
    TEST_ASSERT_EQUAL_UINT(0, vw::encodeUiAction(buf, sizeof buf, vw::UiAction::kBubbleAck,
                                                 "0123456789012345678901234567890123456", 1));
    char in[] = "{\"v\":1,\"type\":\"ui_action\",\"action\":\"status_tap\",\"ms\":1}";
    vw::DecodeOutcome res = vw::decodeFrame(in, strlen(in));
    TEST_ASSERT_FALSE(res.ok);
    TEST_ASSERT_NOT_NULL(strstr(res.error, "ESP32→PC"));
}

void test_utc_offset_is_parsed_range_checked_and_optional() {
    char hb[] =
        "{\"v\":1,\"type\":\"heartbeat\",\"seq\":1,\"ts\":\"2026-11-03T12:00:10Z\","
        "\"hub\":\"up\",\"utc_offset_min\":-330}";
    vw::DecodeOutcome a = vw::decodeFrame(hb, strlen(hb));
    TEST_ASSERT_TRUE(a.ok);
    TEST_ASSERT_TRUE(a.frame.heartbeat.has_utc_offset);
    TEST_ASSERT_EQUAL_INT16(-330, a.frame.heartbeat.utc_offset_min);

    char plain[] =
        "{\"v\":1,\"type\":\"heartbeat\",\"seq\":1,\"ts\":\"2026-11-03T12:00:10Z\",\"hub\":\"up\"}";
    vw::DecodeOutcome b = vw::decodeFrame(plain, strlen(plain));
    TEST_ASSERT_TRUE(b.ok);
    TEST_ASSERT_FALSE_MESSAGE(b.frame.heartbeat.has_utc_offset, "fehlendes Feld bleibt gültig");

    char low[] =
        "{\"v\":1,\"type\":\"heartbeat\",\"seq\":1,\"ts\":\"2026-11-03T12:00:10Z\","
        "\"hub\":\"up\",\"utc_offset_min\":-841}";
    TEST_ASSERT_FALSE(vw::decodeFrame(low, strlen(low)).ok);
    char edge[] =
        "{\"v\":1,\"type\":\"heartbeat\",\"seq\":1,\"ts\":\"2026-11-03T12:00:10Z\","
        "\"hub\":\"up\",\"utc_offset_min\":840}";
    TEST_ASSERT_TRUE(vw::decodeFrame(edge, strlen(edge)).ok);
    char text[] =
        "{\"v\":1,\"type\":\"heartbeat\",\"seq\":1,\"ts\":\"2026-11-03T12:00:10Z\","
        "\"hub\":\"up\",\"utc_offset_min\":\"+01:00\"}";
    TEST_ASSERT_FALSE(vw::decodeFrame(text, strlen(text)).ok);
}

void test_scanner_rejects_control_chars_and_bad_escape() {
    char bad1[] = "{\"v\":1,\"type\":\"log\",\"msg\":\"a\\u0041b\"}";
    vw::json::ScanResult r1 = vw::json::scanLine(bad1, strlen(bad1));
    TEST_ASSERT_FALSE(r1.ok);  // \u ist Protokollfehler (rohes UTF-8, ADR-0002)
    char bad2[] = "{\"v\":1,\"type\":\"log\",\"msg\":\"a\tb\"}";
    vw::json::ScanResult r2 = vw::json::scanLine(bad2, strlen(bad2));
    TEST_ASSERT_FALSE(r2.ok);  // rohe Steuerzeichen im String
}

void test_encoder_outputs_valid_shapes() {
    char buf[vw::kMaxLineBytes + 1];
    size_t n = vw::encodeHello(buf, sizeof buf, "0.2.0", 480, 320, "POWERON_RESET", 123456);
    TEST_ASSERT_GREATER_THAN(0, (int)n);
    TEST_ASSERT_LESS_OR_EQUAL_INT(512, (int)n);
    TEST_ASSERT_NOT_NULL(strstr(buf, "\"type\":\"hello\""));
    TEST_ASSERT_NOT_NULL(strstr(buf, "\"proto\":1"));

    n = vw::encodeStats(buf, sizeof buf, 29.5, 1000, 900, 60, 0, 2);
    TEST_ASSERT_NOT_NULL(strstr(buf, "\"type\":\"stats\""));
    TEST_ASSERT_NOT_NULL(strstr(buf, "\"parse_err\":2"));

    n = vw::encodeLog(buf, sizeof buf, 3, "board warm");
    TEST_ASSERT_NOT_NULL(strstr(buf, "\"level\":\"error\""));

    n = vw::encodeActionResponse(buf, sizeof buf, "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6", false,
                                 8123);
    TEST_ASSERT_NOT_NULL(strstr(buf, "\"decision\":\"decline\""));

    n = vw::encodeResync(buf, sizeof buf, 41);
    TEST_ASSERT_NOT_NULL(strstr(buf, "\"last_seq\":41"));
}

void test_nyx_state_roundtrip() {
    const char* names[] = {"idle",    "listening", "approval_pending", "executing",
                           "success", "error",     "offline"};
    for (const char* n : names) {
        TEST_ASSERT_EQUAL_STRING(n, vw::nyxStateName(vw::nyxStateFromName(n)));
    }
    TEST_ASSERT_EQUAL_INT((int)vw::NyxState::kInvalid, (int)vw::nyxStateFromName("happy"));
}

// --- T2.3: Zustandsmaschine, tabellengetrieben (spec §5, testing.md §3) -------

vw::IncomingFrame makeStateChange(const char* state, uint32_t seq) {
    char buf[128];
    snprintf(buf, sizeof buf, "{\"v\":1,\"type\":\"state_change\",\"seq\":%lu,\"state\":\"%s\"}",
             static_cast<unsigned long>(seq), state);
    vw::IncomingFrame f{};
    vw::DecodeOutcome res = vw::decodeFrame(buf, strlen(buf));
    return res.frame;
}

vw::IncomingFrame makeHeartbeat(uint32_t seq, bool up) {
    char buf[128];
    snprintf(buf, sizeof buf,
             "{\"v\":1,\"type\":\"heartbeat\",\"seq\":%lu,\"ts\":\"2026-11-03T12:00:00Z\",\"hub\":"
             "\"%s\"}",
             static_cast<unsigned long>(seq), up ? "up" : "down");
    vw::DecodeOutcome res = vw::decodeFrame(buf, strlen(buf));
    return res.frame;
}

vw::IncomingFrame makeSnapshot(const char* state, uint32_t seq, bool approval, bool hub_up) {
    char buf[320];
    snprintf(buf, sizeof buf,
             "{\"v\":1,\"type\":\"snapshot\",\"seq\":%lu,\"state\":\"%s\","
             "\"sessions\":{\"total\":1,\"working\":1,\"waiting\":0,\"error\":0},"
             "\"approval\":%s,\"hub\":\"%s\",\"ts\":\"2026-11-03T12:00:00Z\"}",
             static_cast<unsigned long>(seq), state, approval ? "null" : "null",
             hub_up ? "up" : "down");
    vw::DecodeOutcome res = vw::decodeFrame(buf, strlen(buf));
    return res.frame;
}

void test_sm_table_states_via_state_change() {
    const char* names[] = {"idle", "listening", "approval_pending", "executing", "error"};
    for (const char* n : names) {
        vw::StateMachine sm;
        sm.onFrame(makeHeartbeat(1, true), 0);
        sm.onFrame(makeStateChange(n, 2), 10);
        char msg[96];
        snprintf(msg, sizeof msg, "state=%s", n);
        TEST_ASSERT_EQUAL_INT_MESSAGE((int)vw::nyxStateFromName(n), (int)sm.current(), msg);
    }
}

void test_sm_snapshot_anchors_and_projects() {
    vw::StateMachine sm;
    sm.onFrame(makeSnapshot("listening", 5, false, true), 0);
    TEST_ASSERT_EQUAL_INT((int)vw::NyxState::kListening, (int)sm.current());
    sm.onFrame(makeSnapshot("idle", 9, false, true), 100);
    TEST_ASSERT_EQUAL_INT((int)vw::NyxState::kIdle, (int)sm.current());
}

void test_sm_heartbeat_timeout_offline_restore() {
    vw::StateMachine sm;
    sm.onFrame(makeHeartbeat(1, true), 0);
    sm.onFrame(makeStateChange("listening", 2), 10);
    sm.tick(20000);  // > 15 s ohne Heartbeat
    TEST_ASSERT_EQUAL_INT((int)vw::NyxState::kOffline, (int)sm.current());
    sm.onFrame(makeHeartbeat(3, true), 20100);  // Heartbeat kehrt zurück
    TEST_ASSERT_EQUAL_INT((int)vw::NyxState::kListening, (int)sm.current());
}

void test_sm_hub_down_heartbeat_wins_over_all() {
    vw::StateMachine sm;
    sm.onFrame(makeStateChange("error", 1), 0);
    sm.onFrame(makeHeartbeat(2, false), 10);  // hub down
    TEST_ASSERT_EQUAL_INT((int)vw::NyxState::kOffline, (int)sm.current());
}

void test_sm_seq_gap_flags_resync() {
    vw::StateMachine sm;
    sm.onFrame(makeStateChange("idle", 4), 0);
    sm.onFrame(makeStateChange("idle", 9), 10);  // Lücke 5..8
    uint32_t last = 0;
    TEST_ASSERT_TRUE(sm.takeSeqGap(&last));
    TEST_ASSERT_EQUAL_UINT(9, last);
    TEST_ASSERT_FALSE(sm.takeSeqGap(&last));  // einmalig
}

// BUG-0006: seq zählt im Companion über alle Frames. Heartbeat, notification, bubble und
// session_focus dazwischen sind keine Lücke; ein ausgebliebener Frame dagegen schon.
static vw::IncomingFrame decodeOk(const char* json) {
    char buf[512];
    snprintf(buf, sizeof buf, "%s", json);
    vw::DecodeOutcome res = vw::decodeFrame(buf, strlen(buf));
    TEST_ASSERT_TRUE_MESSAGE(res.ok, json);
    return res.frame;
}

void test_sm_other_frames_between_state_changes_are_no_gap() {
    vw::StateMachine sm;
    uint32_t last = 0;
    sm.onFrame(makeStateChange("idle", 1), 0);
    sm.onFrame(decodeOk("{\"v\":1,\"type\":\"heartbeat\",\"seq\":2,\"ts\":\"2026-11-05T12:00:00Z\","
                        "\"hub\":\"up\"}"),
               10);
    sm.onFrame(decodeOk("{\"v\":1,\"type\":\"notification\",\"seq\":3,\"agent_id\":\"a\",\"level\":"
                        "\"info\",\"payload\":{\"title\":\"t\",\"body\":\"b\"}}"),
               20);
    sm.onFrame(
        decodeOk(
            "{\"v\":1,\"type\":\"bubble\",\"seq\":4,\"bubble_id\":\"x\",\"level\":\"info\","
            "\"payload\":{\"title\":\"t\",\"body\":\"b\"},\"hold_s\":6,\"ack_required\":false}"),
        30);
    sm.onFrame(decodeOk("{\"v\":1,\"type\":\"session_focus\",\"seq\":5,\"idx\":1,\"total\":2,"
                        "\"ref\":\"abc123\",\"name\":\"Agent abc123\",\"status\":\"working\"}"),
               40);
    sm.onFrame(makeStateChange("listening", 6), 50);
    TEST_ASSERT_FALSE(sm.takeSeqGap(&last));
}

void test_sm_missing_heartbeat_is_a_real_gap() {
    vw::StateMachine sm;
    uint32_t last = 0;
    sm.onFrame(makeStateChange("idle", 1), 0);
    sm.onFrame(decodeOk("{\"v\":1,\"type\":\"heartbeat\",\"seq\":3,\"ts\":\"2026-11-05T12:00:00Z\","
                        "\"hub\":\"up\"}"),
               10);
    TEST_ASSERT_TRUE(sm.takeSeqGap(&last));
    TEST_ASSERT_EQUAL_UINT(3, last);
}

// Countdown-Balken des Freigabe-Screens: Anteil der Restzeit an der Gesamtfrist, rein und monoton.
void test_approval_remaining_percent_tracks_total_and_survives_snapshot_rearm() {
    vw::ApprovalFlow f;
    f.arm("a1", "t", "write", 100.0, true, 0);
    TEST_ASSERT_TRUE(f.hasDeadline());
    TEST_ASSERT_EQUAL_UINT8(100, f.remainingPercent(0));
    TEST_ASSERT_EQUAL_UINT8(50, f.remainingPercent(50000));
    TEST_ASSERT_EQUAL_UINT8(0, f.remainingPercent(100000));
    TEST_ASSERT_EQUAL_UINT8(0, f.remainingPercent(400000));  // nie negativ
    // Ein snapshot meldet nur noch die Restzeit: die Gesamtfrist der Freigabe bleibt.
    f.arm("a1", "t", "write", 40.0, true, 60000, true);
    TEST_ASSERT_EQUAL_UINT8(40, f.remainingPercent(60000));
    // Neue Freigabe: neue Gesamtfrist.
    f.arm("a2", "t", "write", 20.0, true, 70000);
    TEST_ASSERT_EQUAL_UINT8(100, f.remainingPercent(70000));
    TEST_ASSERT_EQUAL_UINT8(25, f.remainingPercent(85000));
}

void test_approval_without_deadline_has_no_bar() {
    vw::ApprovalFlow f;
    f.arm("a1", "t", "write", 0.0, true, 0);
    TEST_ASSERT_FALSE(f.hasDeadline());
    TEST_ASSERT_EQUAL_UINT8(0, f.remainingPercent(1000));
}

void test_sm_success_transient_decays() {
    vw::StateMachine sm;
    sm.onFrame(makeStateChange("listening", 1), 0);
    sm.onFrame(makeStateChange("success", 2), 100);
    TEST_ASSERT_EQUAL_INT((int)vw::NyxState::kSuccess, (int)sm.current());
    sm.tick(1600);  // > 1,5 s
    TEST_ASSERT_EQUAL_INT((int)vw::NyxState::kListening, (int)sm.current());
}

void test_sm_direction_errors_counted() {
    vw::StateMachine sm;
    char buf[] = "{\"v\":1,\"type\":\"resync\",\"last_seq\":1}";
    vw::DecodeOutcome res = vw::decodeFrame(buf, strlen(buf));
    sm.onFrame(res.frame, 0);
    TEST_ASSERT_EQUAL_UINT(1, sm.direction_errors());
}

void test_font_has_umlauts() {
    // Premortem 5: Schrift muss äöüß (und ÄÖÜ) enthalten — spec §6, UI Deutsch.
    const char* need[] = {"\xc3\xa4", "\xc3\xb6", "\xc3\xbc", "\xc3\x9f",
                          "\xc3\x84", "\xc3\x96", "\xc3\x9c"};
    for (const char* n : need) {
        bool found = false;
        for (size_t i = 0; i < vw::kFont5x7Count; ++i) {
            const vw::FontGlyph& g = vw::kFont5x7[i];
            if (strncmp(reinterpret_cast<const char*>(g.cp), n, g.len) == 0) found = true;
        }
        char msg[64];
        snprintf(msg, sizeof msg, "Glyphe %s fehlt", n);
        TEST_ASSERT_MESSAGE(found, msg);
    }
}

struct Feed {
    const char* data;
    size_t pos = 0;
};
static int feedRead(void* ctx) {
    Feed* f = static_cast<Feed*>(ctx);
    if (f->data[f->pos] == '\0') return -1;
    return static_cast<unsigned char>(f->data[f->pos++]);
}

void test_line_reader_splits_lines_and_counts_overruns() {
    vw::LineReader r;
    Feed feed{"{\"a\":1}\n{\"b\":2}\r\n"};
    char* line = nullptr;
    size_t len = 0;
    TEST_ASSERT_TRUE(r.feed(feedRead, &feed, &line, &len));
    TEST_ASSERT_EQUAL_UINT(7, len);
    TEST_ASSERT_TRUE(r.feed(feedRead, &feed, &line, &len));
    TEST_ASSERT_EQUAL_UINT(7, len);
    TEST_ASSERT_FALSE(r.feed(feedRead, &feed, &line, &len));
    TEST_ASSERT_EQUAL_UINT(0, r.overruns());

    // Überlange Zeile (>512 B) ohne \n-Verlust: verworfen und gezählt (K5)
    std::string big(600, 'x');
    big += "\n{\"ok\":1}\n";
    vw::LineReader r2;
    Feed feed2{big.c_str()};
    TEST_ASSERT_TRUE(r2.feed(feedRead, &feed2, &line, &len));
    TEST_ASSERT_EQUAL_UINT(8, len);  // {"ok":1} — normale Zeile nach der Überlangen
    TEST_ASSERT_EQUAL_UINT(1, r2.overruns());
}

// --- T2.5: Renderer nativ (Sprite-Compose, Glitch, Ticker) --------------------
static uint8_t spr_blob[131072];  // NYX2: 33 Frames 64×64 ≈ 68 kB
static size_t spr_len = 0;

int loadSpr() {
    const char* paths[] = {"../firmware/data/nyx.spr", "firmware/data/nyx.spr",
                           "../../firmware/data/nyx.spr"};
    for (const char* p : paths) {
        FILE* f = fopen(p, "rb");
        if (f == nullptr) continue;
        spr_len = fread(spr_blob, 1, sizeof spr_blob, f);
        fclose(f);
        return 0;
    }
    return -1;
}

void test_renderer_loads_spr_and_composes_idle() {
    TEST_ASSERT_EQUAL_MESSAGE(0, loadSpr(), "nyx.spr nicht gefunden (npm run assets)");
    vw::SpriteStore store;
    TEST_ASSERT_TRUE(store.load(spr_blob, spr_len));

    uint16_t canvas[vw::kCanvasW * vw::kCanvasH];
    store.blit(canvas, store.frameFor(vw::NyxState::kIdle, 0));
    TEST_ASSERT_EQUAL_HEX16_MESSAGE(vw::kBackgroundPx, canvas[0],
                                    "Display clear color must match the sprite background");

    vw::Renderer r;
    r.attachStore(&store);
    r.onStateChange(vw::NyxState::kIdle, vw::NyxState::kIdle, 0);
    r.tick(10);
    // Hintergrundpixel (0,0) = VOID_BLACK — Compose hat stattgefunden
    TEST_ASSERT_NOT_EQUAL(0u, r.canvas()[0]);
    // Augenband (Atlas-Zeilen 16–20 ×kScale): idle zeigt den Kern in der idle-Augenfarbe
    const uint16_t core = vw::Renderer::eyeColors(vw::NyxState::kIdle).core;
    bool eye_core = false;
    for (int y = 16 * vw::kScale; y < 21 * vw::kScale; ++y)
        for (int x = 28 * vw::kScale; x < 40 * vw::kScale; ++x)
            if (r.canvas()[y * vw::kCanvasW + x] == core) eye_core = true;
    TEST_ASSERT_TRUE_MESSAGE(eye_core, "Augenkern erscheint in der Zustandsfarbe (LUT-Tausch)");
}

void test_renderer_glitch_distorts_then_settles() {
    vw::SpriteStore store;
    TEST_ASSERT_TRUE(store.load(spr_blob, spr_len));
    vw::Renderer r;
    r.attachStore(&store);
    r.onStateChange(vw::NyxState::kIdle, vw::NyxState::kListening, 0);
    r.tick(50);  // mitten im Glitch (Phase 0)
    // Kopie als Referenz des unverbogenen Frames: neu komponieren ohne Glitch
    vw::Renderer plain;
    plain.attachStore(&store);
    plain.onStateChange(vw::NyxState::kIdle, vw::NyxState::kListening, 0);
    // plain.tick würde auch glitchen — direkt blitten:
    uint16_t ref[vw::kCanvasW * vw::kCanvasH];
    const vw::EyeColors listening_eyes = vw::Renderer::eyeColors(vw::NyxState::kListening);
    store.blit(ref, store.frameFor(vw::NyxState::kListening, 1), &listening_eyes);
    size_t diffs = 0;
    for (size_t i = 0; i < vw::kCanvasW * vw::kCanvasH; ++i)
        if (r.canvas()[i] != ref[i]) ++diffs;
    TEST_ASSERT_GREATER_THAN_MESSAGE(500, diffs, "Glitch verschieht sichtbar Zeilen");
    r.tick(1000);  // Glitch vorbei (450 ms)
    diffs = 0;
    const vw::EyeColors pulsed =
        vw::Renderer::animatedEyes(vw::NyxState::kListening, 1000, 0, store.darkColor());
    store.blit(ref, store.frameFor(vw::NyxState::kListening, 1), &pulsed);
    // nach Glitch: Zeilen wieder an Ort und Stelle (Nur Ticker kann untscheidbar sein → obere
    // Hälfte prüfen)
    for (size_t i = 0; i < vw::kCanvasW * 100; ++i)
        if (r.canvas()[i] != ref[i]) ++diffs;
    TEST_ASSERT_EQUAL_MESSAGE(0, diffs, "nach dem Glitch ist das Bild wieder geordnet");
}

void test_renderer_ticker_renders_umlauts() {
    vw::SpriteStore store;
    TEST_ASSERT_TRUE(store.load(spr_blob, spr_len));
    vw::Renderer r;
    r.attachStore(&store);
    r.onStateChange(vw::NyxState::kIdle, vw::NyxState::kError, 0);
    r.tick(600);  // Glitch vorbei
    // Ticker leer: unterer Bereich unverändert (nur Sprite)
    // Nun direkt den Ticker prüfen (ö = 0xC3 0xB6, ß = 0xC3 0x9F):
    vw::Ticker tick;
    tick.setText("GR\xc3\x96\xc3\x9fE", "");
    uint16_t canvas[vw::kCanvasW * vw::kCanvasH] = {0};
    tick.draw(canvas, 0, 0xffff);
    size_t bright = 0;
    for (size_t i = 0; i < vw::kCanvasW * vw::kCanvasH; ++i)
        if (canvas[i] != 0) ++bright;
    TEST_ASSERT_GREATER_THAN_MESSAGE(20, bright, "Umlaut-Text produziert Pixel");
}

void test_sprite_store_rejects_old_nyx1_format() {
    uint8_t old_blob[64] = {'N', 'Y', 'X', '1', 1, 32, 0, 48, 0, 1, 0, 12};
    vw::SpriteStore store;
    TEST_ASSERT_FALSE_MESSAGE(store.load(old_blob, sizeof old_blob),
                              "NYX1 muss abgelehnt werden (fail loud, kein stilles Falschrendern)");
}

void test_sprite_store_finds_every_state() {
    vw::SpriteStore store;
    TEST_ASSERT_TRUE(store.load(spr_blob, spr_len));
    TEST_ASSERT_EQUAL_UINT(33, store.frameCount());
    const struct {
        vw::NyxState state;
        uint8_t frames;
    } expect[] = {{vw::NyxState::kIdle, 7},
                  {vw::NyxState::kListening, 5},
                  {vw::NyxState::kApprovalPending, 4},
                  {vw::NyxState::kExecuting, 6},
                  {vw::NyxState::kSuccess, 3},
                  {vw::NyxState::kError, 4},
                  {vw::NyxState::kOffline, 4}};
    for (const auto& e : expect) {
        TEST_ASSERT_EQUAL_UINT_MESSAGE(e.frames, store.animationFrames(e.state),
                                       vw::nyxStateName(e.state));
        TEST_ASSERT_TRUE_MESSAGE(store.frameFor(e.state, 0) >= 0, vw::nyxStateName(e.state));
    }
}

void test_sprite_store_reports_atlas_frame_durations() {
    vw::SpriteStore store;
    TEST_ASSERT_TRUE(store.load(spr_blob, spr_len));
    TEST_ASSERT_EQUAL_UINT(64, store.frameWidth());
    TEST_ASSERT_EQUAL_UINT(64, store.frameHeight());
    // Dauern aus nyx-atlas.json (states[].duration_ms)
    TEST_ASSERT_EQUAL_UINT(130, store.frameDurationMs(store.frameFor(vw::NyxState::kIdle, 0)));
    TEST_ASSERT_EQUAL_UINT(110, store.frameDurationMs(store.frameFor(vw::NyxState::kListening, 0)));
    TEST_ASSERT_EQUAL_UINT(90, store.frameDurationMs(store.frameFor(vw::NyxState::kError, 3)));
    TEST_ASSERT_EQUAL_UINT(200, store.frameDurationMs(store.frameFor(vw::NyxState::kOffline, 0)));
    TEST_ASSERT_EQUAL_UINT(0, store.frameDurationMs(-1));
}

void test_blit_swaps_eye_markers_and_keeps_transparent_as_background() {
    vw::SpriteStore store;
    TEST_ASSERT_TRUE(store.load(spr_blob, spr_len));
    static uint16_t raw[vw::kCanvasW * vw::kCanvasH];
    static uint16_t err[vw::kCanvasW * vw::kCanvasH];
    const int frame = store.frameFor(vw::NyxState::kError, 0);
    const vw::EyeColors red = vw::Renderer::eyeColors(vw::NyxState::kError);
    store.blit(raw, frame, nullptr);
    store.blit(err, frame, &red);
    TEST_ASSERT_EQUAL_HEX16_MESSAGE(vw::kBackgroundPx, err[0], "transparent = Hintergrund");
    size_t marker_px = 0, swapped_px = 0, other_diffs = 0;
    for (size_t i = 0; i < vw::kSpriteW * vw::kSpriteH; ++i) {
        if (raw[i] == 0x1ff8) {  // #FF00FF = Marker core (Bytes vertauscht)
            ++marker_px;
            if (err[i] == red.core) ++swapped_px;
        } else if (raw[i] != err[i] && raw[i] != 0x18c0 && raw[i] != 0x1080) {
            ++other_diffs;  // nur mid (#C000C0) und dim (#800080) dürfen sonst abweichen
        }
    }
    TEST_ASSERT_GREATER_THAN_MESSAGE(0, marker_px, "Frame enthält Augenmarker");
    TEST_ASSERT_EQUAL_UINT_MESSAGE(marker_px, swapped_px,
                                   "jeder Kern-Marker trägt die Zustandsfarbe");
    TEST_ASSERT_EQUAL_UINT_MESSAGE(0, other_diffs, "außerhalb der Augen ändert sich nichts");
}

void test_tick_skips_unchanged_frames_and_redraws_on_change() {
    vw::SpriteStore store;
    TEST_ASSERT_TRUE(store.load(spr_blob, spr_len));
    vw::Renderer r;
    r.attachStore(&store);
    r.onStateChange(vw::NyxState::kIdle, vw::NyxState::kIdle, 0);
    TEST_ASSERT_TRUE_MESSAGE(r.tick(10), "erstes Bild nach Zustandswechsel");
    TEST_ASSERT_TRUE_MESSAGE(r.tick(20), "Glitch läuft: jedes Bild ändert sich");
    r.tick(460);  // Glitch vorbei, danach noch ein sauberes Bild (frame advance bei 130 ms)
    TEST_ASSERT_FALSE_MESSAGE(r.tick(461), "nichts geändert: kein Neuzeichnen, kein Push");
    TEST_ASSERT_FALSE(r.tick(500));
    TEST_ASSERT_TRUE_MESSAGE(r.tick(461 + 130), "nächster Atlas-Frame nach 130 ms (idle)");
    r.onStateChange(vw::NyxState::kIdle, vw::NyxState::kError, 2000);
    TEST_ASSERT_TRUE(r.tick(2001));
}

// --- P5 (vorgezogen): Idle-Life, Zweitsignal, Ring, Puls -----------------------
namespace {

// Zählt Canvas-Pixel mit genau diesem Wert im Augenband (Atlas-Zeilen 16–20, Spalten 28–40).
size_t eyePixels(const uint16_t* canvas, uint16_t px) {
    size_t n = 0;
    for (int y = 16 * vw::kScale; y < 21 * vw::kScale; ++y)
        for (int x = 28 * vw::kScale; x < 40 * vw::kScale; ++x)
            if (canvas[y * vw::kCanvasW + x] == px) ++n;
    return n;
}

bool sameCanvas(const uint16_t* a, const uint16_t* b) {
    return memcmp(a, b, sizeof(uint16_t) * vw::kCanvasW * vw::kCanvasH) == 0;
}

}  // namespace

void test_idle_life_schedule_is_seeded_and_in_range() {
    vw::IdleLife a, b;
    a.begin(42, 0);
    b.begin(42, 0);
    uint32_t last_end = 0, blinks = 0, first_start = 0;
    bool prev_open = true;
    for (uint32_t t = 0; t < 120000; t += 10) {
        const uint8_t la = a.blinkLevel(vw::NyxState::kIdle, t);
        TEST_ASSERT_EQUAL_UINT8(
            la, b.blinkLevel(vw::NyxState::kIdle, t));  // gleicher Seed, gleicher Plan
        if (la != 0 && prev_open) {
            if (blinks == 0)
                first_start = t;
            else
                TEST_ASSERT_TRUE_MESSAGE(t - last_end >= vw::kBlinkMinGapMs - 20, "Abstand ≥ 4 s");
            ++blinks;
        }
        if (la == 0 && !prev_open) last_end = t;
        prev_open = la == 0;
    }
    TEST_ASSERT_TRUE_MESSAGE(first_start >= vw::kBlinkMinGapMs, "erstes Blinzeln nicht vor 4 s");
    TEST_ASSERT_TRUE_MESSAGE(blinks >= 10 && blinks <= 30, "in 120 s etwa 12 bis 28 Blinzler");
}

void test_idle_life_never_blinks_in_alarm_states() {
    const vw::NyxState alarms[] = {vw::NyxState::kOffline, vw::NyxState::kError,
                                   vw::NyxState::kApprovalPending};
    for (const vw::NyxState s : alarms) {
        vw::IdleLife life;
        life.begin(7, 0);
        for (uint32_t t = 0; t < 120000; t += 10)
            TEST_ASSERT_EQUAL_UINT8_MESSAGE(0, life.blinkLevel(s, t), vw::nyxStateName(s));
    }
    // Nach dem Alarm blinzelt Nyx nicht sofort: erst nach neuem Abstand.
    vw::IdleLife life;
    life.begin(7, 0);
    life.blinkLevel(vw::NyxState::kError, 20000);
    TEST_ASSERT_EQUAL_UINT8(0, life.blinkLevel(vw::NyxState::kIdle, 20010));
}

void test_blink_closes_the_eyes_and_never_changes_the_body() {
    vw::SpriteStore store;
    TEST_ASSERT_TRUE(store.load(spr_blob, spr_len));
    static uint16_t open[vw::kCanvasW * vw::kCanvasH];
    static uint16_t shut[vw::kCanvasW * vw::kCanvasH];
    const int frame = store.frameFor(vw::NyxState::kIdle, 0);
    const vw::EyeColors o =
        vw::Renderer::animatedEyes(vw::NyxState::kIdle, 0, 0, store.darkColor());
    const vw::EyeColors c =
        vw::Renderer::animatedEyes(vw::NyxState::kIdle, 0, 2, store.darkColor());
    store.blit(open, frame, &o);
    store.blit(shut, frame, &c);
    TEST_ASSERT_TRUE_MESSAGE(eyePixels(open, o.core) > 0, "offene Augen leuchten");
    TEST_ASSERT_EQUAL_UINT(0, eyePixels(shut, o.core));
    size_t outside = 0;
    for (size_t i = 0; i < vw::kSpriteW * vw::kSpriteH; ++i)
        if (open[i] != shut[i] && open[i] != o.core && open[i] != o.mid && open[i] != o.dim)
            ++outside;
    TEST_ASSERT_EQUAL_UINT_MESSAGE(0, outside, "Silhouette bleibt byte-gleich");
}

void test_body_is_identical_for_every_state_token() {
    // AC-P5-6: nur die Augenpixel ändern sich, wenn die Farbe wechselt.
    vw::SpriteStore store;
    TEST_ASSERT_TRUE(store.load(spr_blob, spr_len));
    static uint16_t a[vw::kCanvasW * vw::kCanvasH];
    static uint16_t b[vw::kCanvasW * vw::kCanvasH];
    for (int s = 0; s < 7; ++s) {
        const vw::NyxState st = static_cast<vw::NyxState>(s);
        const int frame = store.frameFor(st, 0);
        const vw::EyeColors ea = vw::Renderer::eyeColors(st);
        const vw::EyeColors eb = vw::Renderer::eyeColors(vw::NyxState::kError);
        store.blit(a, frame, &ea);
        store.blit(b, frame, &eb);
        for (size_t i = 0; i < vw::kSpriteW * vw::kSpriteH; ++i) {
            if (a[i] == b[i]) continue;
            const bool eyeA = a[i] == ea.core || a[i] == ea.mid || a[i] == ea.dim;
            TEST_ASSERT_TRUE_MESSAGE(eyeA, vw::nyxStateName(st));
        }
    }
}

void test_second_signal_icons_per_state_and_none_for_idle() {
    vw::SpriteStore store;
    TEST_ASSERT_TRUE(store.load(spr_blob, spr_len));
    static uint16_t plain[vw::kCanvasW * vw::kCanvasH];
    for (int s = 0; s < 7; ++s) {
        const vw::NyxState st = static_cast<vw::NyxState>(s);
        vw::Renderer r;
        r.attachStore(&store);
        r.onStateChange(st, st, 0);
        r.tick(500);  // Glitch vorbei
        const vw::EyeColors e = vw::Renderer::animatedEyes(st, 500, 0, store.darkColor());
        store.blit(plain, store.frameFor(st, 0), &e);  // ohne Overlay, Frame 0
        size_t icon_px = 0;
        for (int y = 6; y < 6 + 7 * vw::kScale; ++y)
            for (int x = vw::kSpriteW - 7 * vw::kScale - 6; x < vw::kSpriteW - 6; ++x)
                if (r.canvas()[y * vw::kCanvasW + x] == e.core) ++icon_px;
        const bool expects_icon = st == vw::NyxState::kSuccess ||
                                  st == vw::NyxState::kApprovalPending ||
                                  st == vw::NyxState::kError || st == vw::NyxState::kOffline;
        if (expects_icon)
            TEST_ASSERT_TRUE_MESSAGE(icon_px > 20, vw::nyxStateName(st));
        else
            TEST_ASSERT_EQUAL_UINT_MESSAGE(0, icon_px, vw::nyxStateName(st));
    }
}

void test_executing_ring_moves_and_other_states_have_none() {
    vw::SpriteStore store;
    TEST_ASSERT_TRUE(store.load(spr_blob, spr_len));
    static uint16_t first[vw::kCanvasW * vw::kCanvasH];
    vw::Renderer r;
    r.attachStore(&store);
    r.onStateChange(vw::NyxState::kIdle, vw::NyxState::kExecuting, 0);
    r.tick(1000);
    memcpy(first, r.canvas(), sizeof first);
    // Gleicher Atlas-Frame, nächster Ring-Schritt (90 ms): nur der Ring bewegt sich.
    vw::Renderer r2;
    r2.attachStore(&store);
    r2.onStateChange(vw::NyxState::kIdle, vw::NyxState::kExecuting, 0);
    r2.tick(1000 + 90);
    size_t diff = 0;
    for (size_t i = 0; i < vw::kSpriteW * vw::kSpriteH; ++i) diff += first[i] != r2.canvas()[i];
    TEST_ASSERT_TRUE_MESSAGE(diff > 0, "Ring läuft weiter (oder Frame wechselt)");
}

void test_pulse_changes_only_eye_colors_and_blink_skips_alarms_in_render() {
    vw::SpriteStore store;
    TEST_ASSERT_TRUE(store.load(spr_blob, spr_len));
    const uint16_t dark = store.darkColor();
    const vw::EyeColors lo = vw::Renderer::animatedEyes(vw::NyxState::kListening, 400, 0, dark);
    const vw::EyeColors hi = vw::Renderer::animatedEyes(vw::NyxState::kListening, 0, 0, dark);
    TEST_ASSERT_NOT_EQUAL_MESSAGE(hi.core, lo.core, "listening pulsiert");
    const vw::EyeColors idle_a = vw::Renderer::animatedEyes(vw::NyxState::kIdle, 0, 0, dark);
    const vw::EyeColors idle_b = vw::Renderer::animatedEyes(vw::NyxState::kIdle, 400, 0, dark);
    TEST_ASSERT_EQUAL_HEX16_MESSAGE(idle_a.core, idle_b.core, "idle pulsiert nicht");
    // Alarmzustand mit erzwungenem Blink-Pegel 0: Augen offen (Renderer ruft Idle-Life nur bei
    // erlaubt).
    vw::Renderer r;
    r.attachStore(&store);
    r.seedIdleLife(3, 0);
    r.onStateChange(vw::NyxState::kIdle, vw::NyxState::kError, 0);
    for (uint32_t t = 500; t < 60000; t += 50) {
        r.tick(t);
        const vw::EyeColors e = vw::Renderer::animatedEyes(vw::NyxState::kError, t, 0, dark);
        TEST_ASSERT_TRUE_MESSAGE(eyePixels(r.canvas(), e.core) > 0, "error: Augen nie geschlossen");
    }
}

void test_state_change_is_drawn_immediately_regardless_of_idle_life() {
    vw::SpriteStore store;
    TEST_ASSERT_TRUE(store.load(spr_blob, spr_len));
    vw::Renderer r;
    r.attachStore(&store);
    uint32_t t = 0;
    for (int i = 0; i < 100; ++i) {
        t += 137;
        const vw::NyxState to = static_cast<vw::NyxState>(i % 7);
        r.onStateChange(vw::NyxState::kIdle, to, t);
        TEST_ASSERT_TRUE_MESSAGE(r.tick(t), "Wechsel wird im selben Tick gezeichnet");
    }
}

void test_push_height_skips_empty_ticker_band() {
    vw::Renderer r;
    TEST_ASSERT_EQUAL_UINT(vw::kSpriteH, r.takePushHeight());
}

void test_ticker_band_is_cleared_each_tick() {
    vw::SpriteStore store;
    TEST_ASSERT_TRUE(store.load(spr_blob, spr_len));
    vw::Renderer r;
    r.attachStore(&store);
    r.onStateChange(vw::NyxState::kIdle, vw::NyxState::kIdle, 0);
    r.tick(600);
    for (size_t i = static_cast<size_t>(vw::kSpriteH) * vw::kCanvasW;
         i < vw::kCanvasW * vw::kCanvasH; ++i)
        TEST_ASSERT_EQUAL_HEX16(vw::kBackgroundPx, r.canvas()[i]);
}

void test_state_colors_match_palette() {
    // error = ERROR_RED #FF3355 → RGB565 mit Rot-Anteil, idle = VIOLET ≠ error
    TEST_ASSERT_NOT_EQUAL(0u, vw::Renderer::stateColor(vw::NyxState::kError));
    TEST_ASSERT_NOT_EQUAL(vw::Renderer::stateColor(vw::NyxState::kIdle),
                          vw::Renderer::stateColor(vw::NyxState::kError));
    TEST_ASSERT_NOT_EQUAL(0u, vw::Renderer::stateColor(vw::NyxState::kOffline));
}

struct CanvasPush {
    const uint16_t* canvas;
    uint16_t x, y, w, h;
};
static std::vector<CanvasPush> canvas_pushes;

static void captureCanvasPush(const uint16_t* canvas, uint16_t x, uint16_t y, uint16_t w,
                              uint16_t h) {
    canvas_pushes.push_back({canvas, x, y, w, h});
}

void test_canvas_pusher_overwrites_stationary_frame_without_blank() {
    uint16_t canvas[vw::kCanvasW * vw::kCanvasH] = {0};
    vw::CanvasPusher pusher;
    pusher.begin(captureCanvasPush);
    canvas_pushes.clear();
    pusher.update(canvas, 96, 24);
    TEST_ASSERT_EQUAL_UINT(1, canvas_pushes.size());
    TEST_ASSERT_EQUAL_PTR(canvas, canvas_pushes[0].canvas);

    canvas_pushes.clear();
    pusher.update(canvas, 96, 24);
    TEST_ASSERT_EQUAL_UINT_MESSAGE(1, canvas_pushes.size(),
                                   "Stationary opaque frames must not insert a blank frame");
    TEST_ASSERT_EQUAL_PTR(canvas, canvas_pushes[0].canvas);

    canvas_pushes.clear();
    pusher.update(canvas, 100, 30);
    TEST_ASSERT_EQUAL_UINT(2, canvas_pushes.size());
    TEST_ASSERT_NULL(canvas_pushes[0].canvas);
    TEST_ASSERT_EQUAL_UINT(96, canvas_pushes[0].x);
    TEST_ASSERT_EQUAL_UINT(24, canvas_pushes[0].y);
    TEST_ASSERT_EQUAL_UINT(vw::kCanvasW, canvas_pushes[0].w);
    TEST_ASSERT_EQUAL_UINT(vw::kCanvasH, canvas_pushes[0].h);
    TEST_ASSERT_EQUAL_PTR(canvas, canvas_pushes[1].canvas);
    TEST_ASSERT_EQUAL_UINT(100, canvas_pushes[1].x);
    TEST_ASSERT_EQUAL_UINT(30, canvas_pushes[1].y);
}

// EPIC-P2 T2.10: Fenster-Messgröße (Frame-Statistik) mit injizierter Uhr.
namespace {

// Frames mit fester Periode über `span_ms` Millisekunden, Start bei `start_ms`.
void feed(vw::FrameStats& s, uint32_t start_ms, uint32_t period_ms, uint32_t span_ms,
          uint32_t duration_us = 1000) {
    for (uint32_t t = 0; t <= span_ms; t += period_ms) s.onFrame(start_ms + t, duration_us);
}

}  // namespace

void test_no_window_completed_yet_reports_zero() {
    vw::FrameStats s;
    feed(s, 0, 40, 4000);
    TEST_ASSERT_EQUAL_UINT32(0, s.completedWindows());
    TEST_ASSERT_EQUAL_FLOAT(0.0f, s.fps());
}

void test_fps_is_capacity_from_draw_time_not_loop_rate() {
    vw::FrameStats s;
    // 100 gezeichnete Bilder in 5 s zu je 20 ms: Kapazität 50/s, nicht 20/s Takt.
    feed(s, 0, 50, 5000, 20000);
    TEST_ASSERT_EQUAL_UINT32(1, s.completedWindows());
    TEST_ASSERT_FLOAT_WITHIN(0.5f, 50.0f, s.fps());
}

void test_slowdown_is_visible_in_the_next_window() {
    // Boot-Mittelwert würde den Einbruch verdecken; das Fenster zeigt ihn sofort.
    vw::FrameStats s;
    feed(s, 0, 50, 5000, 20000);
    feed(s, 5000, 200, 5000, 100000);  // 100 ms je Bild: 10/s Kapazität
    TEST_ASSERT_EQUAL_UINT32(2, s.completedWindows());
    TEST_ASSERT_FLOAT_WITHIN(0.5f, 10.0f, s.fps());
}

void test_sparse_window_keeps_last_value_and_streak() {
    vw::FrameStats s;
    feed(s, 0, 50, 5000, 50000);  // 20/s: unter der Grenze
    TEST_ASSERT_FLOAT_WITHIN(0.5f, 20.0f, s.fps());
    s.onFrame(5000, 1000);
    s.onFrame(10000, 1000);  // zweites Fenster hat nur 2 Bilder: keine Aussage
    TEST_ASSERT_EQUAL_UINT32(2, s.completedWindows());
    TEST_ASSERT_FLOAT_WITHIN(0.5f, 20.0f, s.fps());
}

void test_max_frame_time_is_the_longest_in_the_window() {
    vw::FrameStats s;
    feed(s, 0, 40, 2000, 1000);
    s.onFrame(2040, 90000);  // ein Ausreißer über 80 ms
    feed(s, 2080, 40, 3000, 1000);
    TEST_ASSERT_EQUAL_UINT32(90000, s.maxFrameUs());
    TEST_ASSERT_TRUE(s.maxFrameUs() > vw::kFrameCeilingUs);
}

void test_max_resets_for_the_next_window() {
    vw::FrameStats s;
    feed(s, 0, 40, 5000, 1000);
    s.onFrame(2000, 95000);  // im ersten Fenster
    feed(s, 5000, 40, 5000, 1000);
    TEST_ASSERT_EQUAL_UINT32(1000, s.maxFrameUs());
}

void test_two_slow_windows_in_a_row_are_flagged_and_recover() {
    vw::FrameStats s;
    feed(s, 0, 50, 5000, 50000);  // 20/s
    TEST_ASSERT_FALSE(s.belowFloorTwice());
    feed(s, 5000, 50, 5000, 50000);
    TEST_ASSERT_TRUE(s.belowFloorTwice());
    feed(s, 10000, 50, 5000, 20000);
    TEST_ASSERT_FALSE(s.belowFloorTwice());
}

void test_window_survives_millis_wraparound() {
    vw::FrameStats s;
    const uint32_t start = 0xFFFFFFFFu - 2000;  // Überlauf liegt mitten im Fenster
    feed(s, start, 50, 5000, 20000);
    TEST_ASSERT_EQUAL_UINT32(1, s.completedWindows());
    TEST_ASSERT_FLOAT_WITHIN(0.5f, 50.0f, s.fps());
}

// --- T4.2 DimController (AC-P4-3, W9) ---
void test_dim_after_inactivity() {
    vw::DimController d(1000);
    d.onState(vw::NyxState::kIdle, 0);
    d.tick(999);
    TEST_ASSERT_FALSE(d.dimmed());
    d.tick(1000);
    TEST_ASSERT_TRUE(d.dimmed());
}
void test_first_touch_on_dimmed_display_only_wakes() {
    vw::DimController d(1000);
    d.tick(1000);
    TEST_ASSERT_TRUE(d.dimmed());
    TEST_ASSERT_FALSE(d.onTouch(1100));  // verbraucht: keine Entscheidung
    TEST_ASSERT_FALSE(d.dimmed());
    TEST_ASSERT_TRUE(d.onTouch(1200));  // erst jetzt zur UI
}
void test_touch_restarts_the_timer() {
    vw::DimController d(1000);
    TEST_ASSERT_TRUE(d.onTouch(900));
    d.tick(1500);
    TEST_ASSERT_FALSE(d.dimmed());
    d.tick(1900);
    TEST_ASSERT_TRUE(d.dimmed());
}
void test_approval_and_error_wake_and_pin() {
    for (auto s : {vw::NyxState::kApprovalPending, vw::NyxState::kError}) {
        vw::DimController d(1000);
        d.tick(1000);
        TEST_ASSERT_TRUE(d.dimmed());
        d.onState(s, 1500);
        TEST_ASSERT_FALSE(d.dimmed());
        d.tick(900000);
        TEST_ASSERT_FALSE(d.dimmed());  // bleibt wach, solange es anliegt
        d.onState(vw::NyxState::kIdle, 900000);
        d.tick(900999);
        TEST_ASSERT_FALSE(d.dimmed());
        d.tick(901000);
        TEST_ASSERT_TRUE(d.dimmed());
    }
}
void test_other_states_do_not_wake() {
    vw::DimController d(1000);
    d.tick(1000);
    d.onState(vw::NyxState::kExecuting, 1100);
    TEST_ASSERT_TRUE(d.dimmed());
    d.onState(vw::NyxState::kOffline, 1200);
    TEST_ASSERT_TRUE(d.dimmed());
}
void test_dim_disabled_with_zero() {
    vw::DimController d(0);
    d.tick(0xFFFFFFF0u);
    TEST_ASSERT_FALSE(d.dimmed());
}
void test_dim_survives_millis_wraparound() {
    vw::DimController d(1000);
    d.onTouch(0xFFFFFF00u);
    d.tick(0xFFFFFF00u + 999);
    TEST_ASSERT_FALSE(d.dimmed());
    d.tick(0xFFFFFF00u + 1000);  // über den Überlauf hinweg
    TEST_ASSERT_TRUE(d.dimmed());
}

// --- T4.3 Offline-Anzeige (AC-P4-5, K10) ---
void test_offline_text_local_time_with_offset() {
    char a[40], b[40];
    TEST_ASSERT_TRUE(vw::formatOffline(vw::OfflineReason::kLink, "2026-11-04T18:15:47.110Z", true,
                                       60, a, sizeof a, b, sizeof b));
    TEST_ASSERT_EQUAL_STRING("veraltet seit 19:15", a);
    TEST_ASSERT_EQUAL_STRING("Link weg", b);
}
void test_offline_text_wraps_midnight_and_negative_offsets() {
    char a[40], b[40];
    vw::formatOffline(vw::OfflineReason::kHub, "2026-07-01T23:30:00Z", true, 120, a, sizeof a, b,
                      sizeof b);
    TEST_ASSERT_EQUAL_STRING("veraltet seit 01:30", a);
    TEST_ASSERT_EQUAL_STRING("Hub weg", b);
    vw::formatOffline(vw::OfflineReason::kHub, "2026-07-01T00:10:00Z", true, -300, a, sizeof a, b,
                      sizeof b);
    TEST_ASSERT_EQUAL_STRING("veraltet seit 19:10", a);
}
void test_offline_text_without_offset_says_utc() {
    char a[40], b[40];
    vw::formatOffline(vw::OfflineReason::kLink, "2026-11-04T18:15:47Z", false, 0, a, sizeof a, b,
                      sizeof b);
    TEST_ASSERT_EQUAL_STRING("veraltet seit 18:15 UTC", a);
}
void test_offline_text_bad_ts_is_visible_not_silent() {
    char a[40], b[40];
    for (const char* ts : {"", "garbage", "2026-11-04X18:15", "2026-11-04T25:15:00Z"}) {
        TEST_ASSERT_TRUE(
            vw::formatOffline(vw::OfflineReason::kLink, ts, true, 60, a, sizeof a, b, sizeof b));
        TEST_ASSERT_EQUAL_STRING("veraltet, Zeit unbekannt", a);
    }
    TEST_ASSERT_FALSE(vw::formatOffline(vw::OfflineReason::kNone, "2026-11-04T18:15:47Z", true, 0,
                                        a, sizeof a, b, sizeof b));
}
void test_sm_tracks_offline_reason_and_last_good_ts() {
    vw::StateMachine sm;
    vw::IncomingFrame f{};
    f.type = vw::FrameType::kHeartbeat;
    f.heartbeat.hub_up = true;
    f.heartbeat.has_utc_offset = true;
    f.heartbeat.utc_offset_min = 60;
    strcpy(f.heartbeat.ts, "2026-11-04T18:15:47Z");
    sm.onFrame(f, 1000);
    TEST_ASSERT_EQUAL_STRING("2026-11-04T18:15:47Z", sm.lastGoodTs());
    TEST_ASSERT_EQUAL(60, sm.lastGoodOffsetMin());
    sm.tick(1000 + 15001);  // Heartbeat blieb aus
    TEST_ASSERT_EQUAL(static_cast<int>(vw::NyxState::kOffline), static_cast<int>(sm.current()));
    TEST_ASSERT_EQUAL(static_cast<int>(vw::OfflineReason::kLink),
                      static_cast<int>(sm.offlineReason()));
    f.heartbeat.hub_up = false;
    strcpy(f.heartbeat.ts, "2026-11-04T18:20:00Z");
    sm.onFrame(f, 17000);
    TEST_ASSERT_EQUAL(static_cast<int>(vw::OfflineReason::kHub),
                      static_cast<int>(sm.offlineReason()));
    // hub down aktualisiert den „letzten guten" Stand nicht
    TEST_ASSERT_EQUAL_STRING("2026-11-04T18:15:47Z", sm.lastGoodTs());
    f.heartbeat.hub_up = true;
    strcpy(f.heartbeat.ts, "2026-11-04T18:21:00Z");
    sm.onFrame(f, 18000);
    TEST_ASSERT_EQUAL(static_cast<int>(vw::OfflineReason::kNone),
                      static_cast<int>(sm.offlineReason()));
}
void test_renderer_ticker_set_and_clear_redraw() {
    vw::Renderer r;
    r.tick(1000);
    r.setTicker("veraltet seit 19:15", "Link weg");
    TEST_ASSERT_TRUE(r.tick(1001));
    TEST_ASSERT_EQUAL(vw::kCanvasH, r.takePushHeight());
    r.clearTicker();
    TEST_ASSERT_TRUE(r.tick(1002));
    TEST_ASSERT_EQUAL(vw::kCanvasH, r.takePushHeight());  // einmal volles Band leeren
    TEST_ASSERT_EQUAL(vw::kSpriteH, r.takePushHeight());
}

void test_bubble_fields_are_decoded() {
    char line[] =
        "{\"v\":1,\"type\":\"bubble\",\"seq\":22,\"bubble_id\":\"b-1\",\"level\":\"critical\","
        "\"payload\":{\"title\":\"Freigabe nötig\",\"body\":\"1 wartet\"},\"hold_s\":0,"
        "\"ack_required\":true}";
    vw::DecodeOutcome res = vw::decodeFrame(line, strlen(line));
    TEST_ASSERT_TRUE(res.ok);
    TEST_ASSERT_EQUAL(static_cast<int>(vw::FrameType::kBubble), static_cast<int>(res.frame.type));
    TEST_ASSERT_EQUAL(22, res.frame.bubble.seq);
    TEST_ASSERT_EQUAL(3, res.frame.bubble.level);
    TEST_ASSERT_EQUAL(0, res.frame.bubble.hold_s);
    TEST_ASSERT_TRUE(res.frame.bubble.ack_required);
    TEST_ASSERT_EQUAL_STRING("b-1", res.frame.bubble.bubble_id);
    TEST_ASSERT_EQUAL_STRING("Freigabe nötig", res.frame.bubble.title);
}
void test_bubble_hold_out_of_range_is_rejected() {
    char line[] =
        "{\"v\":1,\"type\":\"bubble\",\"seq\":1,\"bubble_id\":\"b\",\"level\":\"info\","
        "\"payload\":{\"title\":\"t\",\"body\":\"\"},\"hold_s\":256,\"ack_required\":false}";
    TEST_ASSERT_FALSE(vw::decodeFrame(line, strlen(line)).ok);
}
void test_sm_ignores_bubble_without_transition() {
    vw::StateMachine sm;
    vw::IncomingFrame f{};
    f.type = vw::FrameType::kBubble;
    sm.onFrame(f, 10);
    TEST_ASSERT_EQUAL(static_cast<int>(vw::NyxState::kIdle), static_cast<int>(sm.current()));
    TEST_ASSERT_EQUAL(0, sm.direction_errors());
}

// --- T3.8 TouchMap (AC-P3-8) ---
const vw::TouchCalibration kCal = {300, 3900, 200, 3700, true, false, true, 320, 240};
void test_touch_map_corners_and_center() {
    int16_t x, y;
    // swap: Raw-Y läuft entlang der Breite, Raw-X (invertiert) entlang der Höhe
    TEST_ASSERT_TRUE(vw::mapTouch(kCal, 300, 200, &x, &y));
    TEST_ASSERT_EQUAL(0, x);
    TEST_ASSERT_EQUAL(239, y);
    vw::mapTouch(kCal, 3900, 3700, &x, &y);
    TEST_ASSERT_EQUAL(319, x);
    TEST_ASSERT_EQUAL(0, y);
    vw::mapTouch(kCal, 2100, 1950, &x, &y);
    TEST_ASSERT_INT_WITHIN(2, 160, x);
    TEST_ASSERT_INT_WITHIN(2, 120, y);
}
void test_touch_map_clamps_out_of_range() {
    int16_t x, y;
    vw::mapTouch(kCal, 0, 4095, &x, &y);
    TEST_ASSERT_EQUAL(319, x);
    TEST_ASSERT_EQUAL(239, y);
}
void test_touch_map_rejects_degenerate_calibration() {
    vw::TouchCalibration bad = kCal;
    bad.raw_x_max = bad.raw_x_min;
    int16_t x, y;
    TEST_ASSERT_FALSE(vw::mapTouch(bad, 1000, 1000, &x, &y));
}

// --- T3.4 TouchTracker (W9) ---
const vw::Zone kZones[] = {{vw::kZoneApprove, 170, 150, 140, 80},
                           {vw::kZoneDecline, 10, 150, 140, 80}};
void test_tracker_tap_on_release_in_same_zone() {
    vw::TouchTracker t;
    t.setZones(kZones, 2);
    uint8_t z = 0;
    t.sample(true, 200, 180, 1000);
    TEST_ASSERT_FALSE(t.takeTap(&z));  // noch nicht losgelassen
    t.sample(true, 205, 182, 1050);
    t.sample(false, 0, 0, 1100);
    TEST_ASSERT_TRUE(t.takeTap(&z));
    TEST_ASSERT_EQUAL(vw::kZoneApprove, z);
    TEST_ASSERT_FALSE(t.takeTap(&z));
}
void test_tracker_slide_out_or_into_other_zone_is_no_tap() {
    vw::TouchTracker t;
    t.setZones(kZones, 2);
    uint8_t z = 0;
    t.sample(true, 200, 180, 1000);
    t.sample(true, 50, 180, 1050);  // auf Decline gerutscht
    t.sample(false, 0, 0, 1100);
    TEST_ASSERT_FALSE(t.takeTap(&z));
    t.sample(true, 200, 180, 2000);
    t.sample(true, 200, 20, 2050);  // aus der Zone heraus
    t.sample(false, 0, 0, 2100);
    TEST_ASSERT_FALSE(t.takeTap(&z));
}
void test_tracker_touch_outside_zones_is_ignored() {
    vw::TouchTracker t;
    t.setZones(kZones, 2);
    uint8_t z = 0;
    t.sample(true, 5, 5, 1000);
    t.sample(false, 0, 0, 1100);
    TEST_ASSERT_FALSE(t.takeTap(&z));
}
void test_tracker_debounce_150ms() {
    vw::TouchTracker t;
    t.setZones(kZones, 2);
    uint8_t z = 0;
    t.sample(true, 200, 180, 1000);
    t.sample(false, 0, 0, 1010);
    TEST_ASSERT_TRUE(t.takeTap(&z));
    t.sample(true, 200, 180, 1020);
    t.sample(false, 0, 0, 1100);  // 90 ms nach dem ersten Tap
    TEST_ASSERT_FALSE(t.takeTap(&z));
    t.sample(true, 200, 180, 1200);
    t.sample(false, 0, 0, 1160 + 100);  // ≥ 150 ms
    TEST_ASSERT_TRUE(t.takeTap(&z));
}
void test_tracker_lock_blocks_taps() {
    vw::TouchTracker t;
    t.setZones(kZones, 2);
    uint8_t z = 0;
    t.setLocked(true);
    t.sample(true, 200, 180, 1000);
    t.sample(false, 0, 0, 1100);
    TEST_ASSERT_FALSE(t.takeTap(&z));
    t.setLocked(false);
    t.sample(true, 200, 180, 2000);
    t.sample(false, 0, 0, 2100);
    TEST_ASSERT_TRUE(t.takeTap(&z));
}
void test_tracker_cancel_current_consumes_touch_for_wake() {
    vw::TouchTracker t;
    t.setZones(kZones, 2);
    uint8_t z = 0;
    t.sample(true, 200, 180, 1000);
    TEST_ASSERT_TRUE(t.takePressStart());
    t.cancelCurrent();  // erster Touch aus dem Dimmen: nur Wecken
    t.sample(false, 0, 0, 1100);
    TEST_ASSERT_FALSE(t.takeTap(&z));
}
void test_tracker_zone_change_drops_running_touch() {
    vw::TouchTracker t;
    t.setZones(kZones, 2);
    uint8_t z = 0;
    t.sample(true, 200, 180, 1000);
    t.setZones(kZones, 2);  // Screenwechsel mitten in der Berührung
    t.sample(false, 0, 0, 1100);
    TEST_ASSERT_FALSE(t.takeTap(&z));
}

// --- T3.4/T3.9 ApprovalFlow (W9, ADR-0001/0004) ---
void test_flow_question_is_display_only_even_if_marked_decidable() {
    vw::ApprovalFlow f;
    // Auch ein (fälschlich) entscheidbar markierter Frame darf eine Frage nie entscheidbar machen.
    f.arm("q1", "Welche Variante?", "write", 60, true, 0, false, true);
    TEST_ASSERT_TRUE(f.active());
    TEST_ASSERT_TRUE(f.isQuestion());
    TEST_ASSERT_FALSE(f.decidable());
    bool approve = true;
    TEST_ASSERT_FALSE(f.onZoneTap(vw::kZoneApprove, 10, &approve));
    TEST_ASSERT_FALSE(f.onZoneTap(vw::kZoneDecline, 10, &approve));
    TEST_ASSERT_FALSE_MESSAGE(f.sent(), "kein Absenden bei einer Frage");
    // Die nächste normale Freigabe ist wieder entscheidbar, die Frage-Markierung ist weg.
    f.arm("a1", "Datei schreiben", "write", 60, true, 20);
    TEST_ASSERT_FALSE(f.isQuestion());
    TEST_ASSERT_TRUE(f.decidable());
    f.clear();
    TEST_ASSERT_FALSE(f.isQuestion());
}

void test_flow_tap_sends_exactly_one_decision_per_action() {
    vw::ApprovalFlow f;
    f.arm("a1", "Datei schreiben", "write", 60, true, 0);
    bool approve = false;
    TEST_ASSERT_TRUE(f.onZoneTap(vw::kZoneApprove, 1000, &approve));
    TEST_ASSERT_TRUE(approve);
    TEST_ASSERT_FALSE(f.onZoneTap(vw::kZoneDecline, 1100, &approve));  // gesperrt bis Ergebnis
    TEST_ASSERT_FALSE(f.onZoneTap(vw::kZoneApprove, 1200, &approve));
    f.onResult("a1");
    TEST_ASSERT_FALSE(f.active());
}
void test_flow_decline_sets_approve_false() {
    vw::ApprovalFlow f;
    f.arm("a1", "t", "write", 60, true, 0);
    bool approve = true;
    TEST_ASSERT_TRUE(f.onZoneTap(vw::kZoneDecline, 10, &approve));
    TEST_ASSERT_FALSE(approve);
}
void test_flow_never_decides_destructive_or_undecidable() {
    vw::ApprovalFlow f;
    bool approve = false;
    f.arm("d1", "t", "destructive", 60, true,
          0);  // Hub sagt decidable, Gerät entscheidet trotzdem nie
    TEST_ASSERT_FALSE(f.decidable());
    TEST_ASSERT_FALSE(f.onZoneTap(vw::kZoneApprove, 10, &approve));
    f.arm("n1", "t", "write", 60, false, 0);
    TEST_ASSERT_FALSE(f.onZoneTap(vw::kZoneApprove, 10, &approve));
    f.arm("r1", "t", "read", 60, false, 0);
    TEST_ASSERT_FALSE(f.onZoneTap(vw::kZoneDecline, 10, &approve));
}
void test_flow_expiry_hides_but_never_decides() {
    vw::ApprovalFlow f;
    bool approve = false;
    f.arm("a1", "t", "write", 10, true, 0);
    TEST_ASSERT_EQUAL(10, f.remainingS(0));
    TEST_ASSERT_EQUAL(1, f.remainingS(9001));
    TEST_ASSERT_FALSE(f.onZoneTap(vw::kZoneApprove, 10000, &approve));  // Frist um
    f.tick(10000);
    TEST_ASSERT_FALSE(f.active());
    TEST_ASSERT_EQUAL(0, f.remainingS(10000));
}
void test_flow_new_action_unlocks_but_same_id_does_not_unless_snapshot() {
    vw::ApprovalFlow f;
    bool approve = false;
    f.arm("a1", "t", "write", 60, true, 0);
    TEST_ASSERT_TRUE(f.onZoneTap(vw::kZoneApprove, 10, &approve));
    f.arm("a1", "t", "write", 60, true, 20);  // Wiederholung derselben ID
    TEST_ASSERT_FALSE(f.decidable());
    f.arm("a1", "t", "write", 60, true, 30,
          true);  // snapshot: Hub zeigt noch offen → Antwort ging verloren
    TEST_ASSERT_TRUE(f.decidable());
    TEST_ASSERT_TRUE(f.onZoneTap(vw::kZoneApprove, 40, &approve));
    f.arm("a2", "t", "write", 60, true, 50);
    TEST_ASSERT_TRUE(f.decidable());
}
void test_flow_result_for_other_id_keeps_active() {
    vw::ApprovalFlow f;
    f.arm("a1", "t", "write", 60, true, 0);
    f.onResult("zzz");
    TEST_ASSERT_TRUE(f.active());
}
void test_flow_unknown_zone_is_ignored() {
    vw::ApprovalFlow f;
    bool approve = false;
    f.arm("a1", "t", "write", 60, true, 0);
    TEST_ASSERT_FALSE(f.onZoneTap(9, 10, &approve));
    TEST_ASSERT_TRUE(f.decidable());
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_touch_map_corners_and_center);
    RUN_TEST(test_touch_map_clamps_out_of_range);
    RUN_TEST(test_touch_map_rejects_degenerate_calibration);
    RUN_TEST(test_tracker_tap_on_release_in_same_zone);
    RUN_TEST(test_tracker_slide_out_or_into_other_zone_is_no_tap);
    RUN_TEST(test_tracker_touch_outside_zones_is_ignored);
    RUN_TEST(test_tracker_debounce_150ms);
    RUN_TEST(test_tracker_lock_blocks_taps);
    RUN_TEST(test_tracker_cancel_current_consumes_touch_for_wake);
    RUN_TEST(test_tracker_zone_change_drops_running_touch);
    RUN_TEST(test_flow_tap_sends_exactly_one_decision_per_action);
    RUN_TEST(test_flow_question_is_display_only_even_if_marked_decidable);
    RUN_TEST(test_flow_decline_sets_approve_false);
    RUN_TEST(test_flow_never_decides_destructive_or_undecidable);
    RUN_TEST(test_flow_expiry_hides_but_never_decides);
    RUN_TEST(test_flow_new_action_unlocks_but_same_id_does_not_unless_snapshot);
    RUN_TEST(test_flow_result_for_other_id_keeps_active);
    RUN_TEST(test_flow_unknown_zone_is_ignored);
    RUN_TEST(test_bubble_fields_are_decoded);
    RUN_TEST(test_bubble_hold_out_of_range_is_rejected);
    RUN_TEST(test_sm_ignores_bubble_without_transition);
    RUN_TEST(test_offline_text_local_time_with_offset);
    RUN_TEST(test_offline_text_wraps_midnight_and_negative_offsets);
    RUN_TEST(test_offline_text_without_offset_says_utc);
    RUN_TEST(test_offline_text_bad_ts_is_visible_not_silent);
    RUN_TEST(test_sm_tracks_offline_reason_and_last_good_ts);
    RUN_TEST(test_renderer_ticker_set_and_clear_redraw);
    RUN_TEST(test_dim_after_inactivity);
    RUN_TEST(test_first_touch_on_dimmed_display_only_wakes);
    RUN_TEST(test_touch_restarts_the_timer);
    RUN_TEST(test_approval_and_error_wake_and_pin);
    RUN_TEST(test_other_states_do_not_wake);
    RUN_TEST(test_dim_disabled_with_zero);
    RUN_TEST(test_dim_survives_millis_wraparound);
    RUN_TEST(test_fixtures_present);
    RUN_TEST(test_valid_fixture_lines_fit_512_bytes);
    RUN_TEST(test_valid_fixtures_decode_ok_and_type_matches_filename);
    RUN_TEST(test_invalid_fixtures_rejected);
    RUN_TEST(test_oversize_fixture_exceeds_limit);
    RUN_TEST(test_additive_fields_counted_not_rejected);
    RUN_TEST(test_utc_offset_is_parsed_range_checked_and_optional);
    RUN_TEST(test_scanner_rejects_control_chars_and_bad_escape);
    RUN_TEST(test_ui_action_encoder_refuses_unsafe_ref_and_incoming_is_direction_error);
    RUN_TEST(test_session_focus_fields_and_limits);
    RUN_TEST(test_question_kind_is_parsed_and_never_decidable);
    RUN_TEST(test_bubble_typewriter_reveals_per_char_and_never_splits_utf8);
    RUN_TEST(test_bubble_error_and_critical_show_full_text_at_once);
    RUN_TEST(test_bubble_wraps_words_at_20_cols_and_splits_overlong_words);
    RUN_TEST(test_bubble_full_body_160_chars_fits_the_row_budget);
    RUN_TEST(test_bubble_hold_counts_from_typing_end_and_zero_hold_stays_until_ack);
    RUN_TEST(test_bubble_critical_hold_is_ignored_even_if_frame_sets_hold_s);
    RUN_TEST(test_bubble_same_id_does_not_restart_and_unacked_critical_is_never_replaced);
    RUN_TEST(test_bubble_never_overlays_an_approval_and_critical_returns_after_it);
    RUN_TEST(test_bubble_revision_changes_only_when_the_picture_changes);
    RUN_TEST(test_layout_nyx_moves_left_for_a_bubble_and_zones_never_overlap);
    RUN_TEST(test_layout_zone_sizes_and_presence);
    RUN_TEST(test_bubble_short_text_is_drawn_double_size_with_10_columns);
    RUN_TEST(test_bubble_long_text_stays_single_size_with_20_columns);
    RUN_TEST(test_bubble_double_size_worst_case_fits_the_column_height);
    RUN_TEST(test_ticker_draws_lowercase_like_uppercase);
    RUN_TEST(test_bubble_glyph_lowercase_falls_back_to_uppercase);
    RUN_TEST(test_encoder_outputs_valid_shapes);
    RUN_TEST(test_nyx_state_roundtrip);
    RUN_TEST(test_encoder_matches_golden_fixtures_bytewise);
    RUN_TEST(test_sm_table_states_via_state_change);
    RUN_TEST(test_sm_snapshot_anchors_and_projects);
    RUN_TEST(test_sm_heartbeat_timeout_offline_restore);
    RUN_TEST(test_sm_hub_down_heartbeat_wins_over_all);
    RUN_TEST(test_sm_seq_gap_flags_resync);
    RUN_TEST(test_sm_other_frames_between_state_changes_are_no_gap);
    RUN_TEST(test_sm_missing_heartbeat_is_a_real_gap);
    RUN_TEST(test_approval_remaining_percent_tracks_total_and_survives_snapshot_rearm);
    RUN_TEST(test_approval_without_deadline_has_no_bar);
    RUN_TEST(test_sm_success_transient_decays);
    RUN_TEST(test_sm_direction_errors_counted);
    RUN_TEST(test_font_has_umlauts);
    RUN_TEST(test_line_reader_splits_lines_and_counts_overruns);
    RUN_TEST(test_renderer_loads_spr_and_composes_idle);
    RUN_TEST(test_renderer_glitch_distorts_then_settles);
    RUN_TEST(test_renderer_ticker_renders_umlauts);
    RUN_TEST(test_sprite_store_rejects_old_nyx1_format);
    RUN_TEST(test_sprite_store_finds_every_state);
    RUN_TEST(test_sprite_store_reports_atlas_frame_durations);
    RUN_TEST(test_blit_swaps_eye_markers_and_keeps_transparent_as_background);
    RUN_TEST(test_tick_skips_unchanged_frames_and_redraws_on_change);
    RUN_TEST(test_idle_life_schedule_is_seeded_and_in_range);
    RUN_TEST(test_idle_life_never_blinks_in_alarm_states);
    RUN_TEST(test_blink_closes_the_eyes_and_never_changes_the_body);
    RUN_TEST(test_body_is_identical_for_every_state_token);
    RUN_TEST(test_second_signal_icons_per_state_and_none_for_idle);
    RUN_TEST(test_executing_ring_moves_and_other_states_have_none);
    RUN_TEST(test_pulse_changes_only_eye_colors_and_blink_skips_alarms_in_render);
    RUN_TEST(test_state_change_is_drawn_immediately_regardless_of_idle_life);
    RUN_TEST(test_push_height_skips_empty_ticker_band);
    RUN_TEST(test_ticker_band_is_cleared_each_tick);
    RUN_TEST(test_state_colors_match_palette);
    RUN_TEST(test_canvas_pusher_overwrites_stationary_frame_without_blank);
    RUN_TEST(test_no_window_completed_yet_reports_zero);
    RUN_TEST(test_fps_is_capacity_from_draw_time_not_loop_rate);
    RUN_TEST(test_sparse_window_keeps_last_value_and_streak);
    RUN_TEST(test_slowdown_is_visible_in_the_next_window);
    RUN_TEST(test_max_frame_time_is_the_longest_in_the_window);
    RUN_TEST(test_max_resets_for_the_next_window);
    RUN_TEST(test_two_slow_windows_in_a_row_are_flagged_and_recover);
    RUN_TEST(test_window_survives_millis_wraparound);
    return UNITY_END();
}
