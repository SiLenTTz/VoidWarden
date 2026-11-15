// VoidWarden Firmware — EPIC-P2 T2.5/T2.6 Board-Betrieb:
// Serial-Link (hello/LineReader/Parser) -> Zustandsmaschine -> Renderer
// (nyx.spr aus LittleFS, Glitch, Ticker) -> Display (LovyanGFX).
#include <Arduino.h>
#include <LittleFS.h>

#include "hal/display.h"
#include "hal/line_reader.h"
#include "protocol/frames.h"
#include "render/font5x7.h"
#include "render/renderer.h"
#include "state/approval_flow.h"
#include "state/bubble_view.h"
#include "state/dim_controller.h"
#include "state/frame_stats.h"
#include "state/offline_info.h"
#include "state/state_machine.h"
#include "state/touch_map.h"
#include "state/touch_tracker.h"
#include "state/ui_layout.h"

namespace {

constexpr uint32_t kSerialBaud = 921600;
constexpr uint32_t kStatsIntervalMs = 30000;
constexpr uint8_t kDimLevel = 40;  // ~15 %: Nyx bleibt lesbar, Panel schont sich
// Roh→Pixel (T3.8): grob aus von Hand berührten Ecken (2026-11-05: raw x ≈ 550..3500,
// y ≈ 430..3680), noch kein vollständiger Fünf-Punkt-Lauf (AC-P3-8).
// 2026-11-05 Tour-Lauf: Tap auf ACCEPT (rechts) lieferte px_x 52–73 (= DECLINE), raw y 947–1164 →
// x muss gespiegelt werden (invert_x). y war richtig (px_y 186–191 in Button-Höhe).
constexpr vw::TouchCalibration kTouchCal = {500, 3600, 400, 3700, true, true, true, 320, 240};
constexpr vw::Zone kApproveZones[] = {{vw::kZoneDecline, 10, 150, 140, 80},
                                      {vw::kZoneApprove, 170, 150, 140, 80}};
constexpr uint8_t kFwMajor = 0, kFwMinor = 2, kFwPatch = 0;

vw::Display g_display;
vw::Renderer g_renderer;
vw::CanvasPusher g_pusher;
vw::StateMachine g_state;
vw::ApprovalFlow g_flow;
vw::TouchTracker g_tracker;
vw::DimController g_dim;  // dimAfter: Standard 60 s, Touch-Anbindung folgt mit T3.8/T3.4
vw::LineReader g_reader;
vw::SpriteStore g_store;
vw::BubbleView g_bubble;
// Fokus (ADR-0009): reine Anzeige, vom Companion per session_focus geliefert (K7: nach
// hello/resync kommt er neu; ein snapshot ohne Sessions leert ihn).
vw::SessionFocusFrame g_focus = {};
bool g_has_focus = false;

// nyx.spr liegt im RAM (80 kB Budget, Heap ~330 kB) — deterministisch, ohne
// LittleFS-Zugriff im Frame-Loop (architecture.md §2: keine dyn. Allokation im Loop;
// die Einmal-Allokation beim Boot ist bewusst).
uint8_t* g_spr_blob = nullptr;
size_t g_spr_blob_len = 0;

uint32_t g_last_stats_ms = 0;
uint32_t g_parse_err = 0;
vw::FrameStats g_frame_stats;
uint32_t g_reported_windows = 0;

int serialRead(void*) { return Serial.read(); }

void sendLog(uint8_t level, const char* msg) {
    char buf[vw::kMaxLineBytes + 1];
    const size_t n = vw::encodeLog(buf, sizeof buf, level, msg);
    if (n > 0) {
        buf[n] = '\0';
        Serial.write(buf, n);
        Serial.write('\n');
    }
}

void pushCanvas(const uint16_t* canvas, uint16_t x, uint16_t y, uint16_t w, uint16_t h) {
    if (canvas == nullptr) {
        g_display.fillRect(x, y, w, h, vw::kBackgroundColor);
        return;
    }
    // Canvas ist schon in Panel-Byte-Reihenfolge (kBackgroundPx): kein Konvertieren im Push.
    g_display.pushImage(x, y, w, h, reinterpret_cast<const lgfx::swap565_t*>(canvas));
}

void onTransition(vw::NyxState from, vw::NyxState to, void* user) {
    (void)from;
    (void)user;
    g_renderer.onStateChange(from, to, millis());
    g_dim.onState(to, millis());
    if (to == vw::NyxState::kOffline)
        g_flow.clear();  // der Hub ist die Wahrheit; snapshot stellt wieder her
}

void sendLine(const char* buf, size_t n) {
    Serial.write(buf, n);
    Serial.write('\n');
}

// Freigabe-Screen (T3.9): bewusst direkt auf dem Display, solange eine Freigabe offen ist. Nyx
// ist dann nicht sichtbar; der Screen-Manager (P6) bringt beides zusammen.
bool g_approval_shown = false;
uint32_t g_approval_key = 0;
bool g_press_flash = false;
uint8_t g_flash_zone = 0;
uint32_t g_flash_until = 0;

void drawButton(const vw::Zone& z, const char* label, uint16_t fill, bool flash) {
    g_display.fillRoundRect(z.x, z.y, z.w, z.h, 10, flash ? 0xFFFF : fill);
    g_display.setTextColor(flash ? fill : 0xFFFF, flash ? 0xFFFF : fill);
    g_display.setTextDatum(lgfx::textdatum_t::middle_center);
    g_display.setTextSize(2);
    g_display.drawString(label, z.x + z.w / 2, z.y + z.h / 2);
}

// --- Blase und Fokus-Indikator (ADR-0009) ------------------------------------------------
// Blase: rechte 120-px-Spalte (20 Zeichen à 6 px), Nyx rückt dann nach links. Text wird
// zeichenweise nachgezeichnet (Typewriter): je Loop nur die neu sichtbaren Glyphen.
constexpr int16_t kBubbleX = 196, kBubbleY = 48, kBubbleW = 120, kBubbleH = 180;
constexpr uint16_t kBubbleBg = 0x1082;
uint32_t g_bubble_rev = 0xffffffffu;
size_t g_bubble_drawn = 0;
uint8_t g_bubble_row = 0, g_bubble_col = 0;  // Schreibposition des Typewriters
bool g_bubble_on_screen = false;
uint32_t g_focus_key = 0xffffffffu;
bool g_tap_flash = false;
uint32_t g_tap_flash_until = 0;

void drawGlyph(int16_t x, int16_t y, const char* s, size_t len, uint16_t color, uint16_t bg,
               uint8_t scale = 1) {
    const vw::FontGlyph* g = vw::bubbleGlyph(s, len);
    if (g == nullptr) return;  // unbekanntes Zeichen: Lücke statt Absturz (wie der Ticker)
    for (uint8_t cx = 0; cx < 5; ++cx)
        for (uint8_t ry = 0; ry < 7; ++ry) {
            const uint16_t c = (g->cols[cx] & (1 << ry)) ? color : bg;
            if (scale == 1)
                g_display.drawPixel(x + cx, y + ry, c);
            else
                g_display.fillRect(x + cx * scale, y + ry * scale, scale, scale, c);
        }
}

uint16_t bubbleColor(uint8_t level) {
    switch (level) {
        case 1:
            return 0x07E0;  // success
        case 2:
            return 0xF800;  // error
        case 3:
            return 0xFD60;  // critical
        default:
            return 0x07FF;
    }
}

uint8_t utf8Len(unsigned char c) { return (c & 0x80) == 0 ? 1 : (c & 0xE0) == 0xC0 ? 2 : 3; }

void clearBubbleArea() {
    g_display.fillRect(kBubbleX - 4, 0, 320 - kBubbleX + 4, 240, vw::kBackgroundColor);
    g_bubble_on_screen = false;
}

void drawBubble(uint32_t now) {
    if (!g_bubble.visible()) {
        if (g_bubble_on_screen) clearBubbleArea();
        g_bubble_rev = g_bubble.revision();
        return;
    }
    const uint16_t accent = bubbleColor(g_bubble.level());
    if (g_bubble.revision() != g_bubble_rev || !g_bubble_on_screen) {
        g_bubble_rev = g_bubble.revision();
        g_display.fillRect(kBubbleX - 4, 0, 320 - kBubbleX + 4, 240, vw::kBackgroundColor);
        g_display.fillRoundRect(kBubbleX - 3, kBubbleY - 4, kBubbleW + 6, kBubbleH, 6, kBubbleBg);
        g_display.drawRoundRect(kBubbleX - 3, kBubbleY - 4, kBubbleW + 6, kBubbleH, 6, accent);
        const uint8_t sc = g_bubble.scale();
        int16_t y = kBubbleY;
        for (uint8_t r = 0; r < g_bubble.titleRowCount(); ++r) {
            const vw::TextRow& row = g_bubble.titleRow(r);
            int16_t x = kBubbleX;
            for (size_t i = 0; i < row.len;) {
                const uint8_t l =
                    utf8Len(static_cast<unsigned char>(g_bubble.title()[row.start + i]));
                drawGlyph(x, y, g_bubble.title() + row.start + i, l, accent, kBubbleBg, sc);
                i += l;
                x += vw::kFontAdvance * sc;
            }
            y += 9 * sc;
        }
        g_bubble_drawn = 0;
        g_bubble_row = 0;
        g_bubble_col = 0;
        g_bubble_on_screen = true;
    }
    // Körper: nur Glyphen nachzeichnen, die seit dem letzten Aufruf sichtbar wurden.
    const size_t visible = g_bubble.visibleBytes(now);
    const uint8_t sc = g_bubble.scale();
    const int16_t body_y = kBubbleY + g_bubble.titleRowCount() * 9 * sc + 6;
    while (g_bubble_drawn < visible && g_bubble_row < g_bubble.bodyRowCount()) {
        const vw::TextRow& row = g_bubble.bodyRow(g_bubble_row);
        const size_t end = static_cast<size_t>(row.start) + row.len;
        if (g_bubble_drawn < row.start) g_bubble_drawn = row.start;  // übersprungene Leerzeichen
        if (g_bubble_drawn >= end) {
            ++g_bubble_row;
            g_bubble_col = 0;
            continue;
        }
        const uint8_t l = utf8Len(static_cast<unsigned char>(g_bubble.body()[g_bubble_drawn]));
        drawGlyph(kBubbleX + g_bubble_col * vw::kFontAdvance * sc, body_y + g_bubble_row * 9 * sc,
                  g_bubble.body() + g_bubble_drawn, l, 0xFFFF, kBubbleBg, sc);
        g_bubble_drawn += l;
        ++g_bubble_col;
    }
    if (g_bubble.ackRequired()) {
        g_display.setTextDatum(0);
        g_display.setTextSize(1);
        g_display.setTextColor(accent, kBubbleBg);
        g_display.drawString("Tippen = gelesen", kBubbleX, kBubbleY + kBubbleH - 20);
    }
}

// Indikator oben rechts (nur ab 2 Sessions): "idx/total" plus Statussymbol — Farbe ist nie das
// einzige Signal. Der Tap darauf wechselt die Session (focus_next).
void drawFocusIndicator(bool flash) {
    const uint32_t key = g_has_focus ? (g_focus.idx | (g_focus.total << 8) |
                                        (g_focus.status << 16) | (flash ? 0x1000000u : 0u))
                                     : 0xffffffffu;
    if (key == g_focus_key) return;
    g_focus_key = key;
    g_display.fillRect(272, 0, 48, 44, vw::kBackgroundColor);
    if (!g_has_focus || g_focus.total < 2) return;
    static const char* const kSym[] = {"!", "?", "x", ">", "z", "-"};
    char buf[12];
    snprintf(buf, sizeof buf, "%u/%u", g_focus.idx, g_focus.total);
    g_display.setTextDatum(0);
    g_display.setTextSize(2);
    g_display.setTextColor(flash ? vw::kBackgroundColor : 0xFFFF,
                           flash ? 0xFFFF : vw::kBackgroundColor);
    g_display.drawString(buf, 274, 4);
    g_display.setTextColor(0xFD60, flash ? 0xFFFF : vw::kBackgroundColor);
    g_display.drawString(kSym[g_focus.status < 6 ? g_focus.status : 5], 274, 24);
}

// Lokales Tap-Feedback auf Nyx (W11): Rahmen knapp außerhalb des Canvas, vom Hub unabhängig.
void drawNyxFrame(uint16_t color) {
    const vw::UiLayout l = vw::computeLayout(g_bubble.visible(), false, false);
    g_display.drawRect(l.nyx_x - 1, l.nyx_y - 1, vw::kCanvasW + 2, vw::kSpriteH + 2, color);
}

// Session-Name links oben (ADR-0009): Alias aus der Kurz-ID, im freien Streifen über Nyx (y 0–11),
// damit man den Fokus auch ohne Indikator erkennt. Zeichen ohne Glyph bleiben Lücke.
uint32_t g_name_key = 0xffffffffu;
void drawSessionName(bool force) {
    uint32_t key = 0;
    if (g_has_focus)
        for (const char* c = g_focus.name; *c != '\0'; ++c)
            key = key * 31 + static_cast<uint8_t>(*c);
    if (!force && key == g_name_key) return;
    g_name_key = key;
    g_display.fillRect(0, 0, 270, 11, vw::kBackgroundColor);
    if (!g_has_focus) return;
    int16_t x = 4;
    for (size_t i = 0; g_focus.name[i] != '\0';) {
        const uint8_t l = utf8Len(static_cast<unsigned char>(g_focus.name[i]));
        drawGlyph(x, 2, g_focus.name + i, l, 0x8C71, vw::kBackgroundColor);
        i += l;
        x += vw::kFontAdvance;
    }
}

void sendUiAction(vw::UiAction a, const char* ref, uint32_t now) {
    char buf[vw::kMaxLineBytes + 1];
    const size_t n = vw::encodeUiAction(buf, sizeof buf, a, ref, now);
    if (n > 0) {
        sendLine(buf, n);
    } else {
        sendLog(2, "ui_action nicht kodierbar");  // Fail loud
    }
}

void applyZones(bool approval_active) {
    static uint32_t key = 0xffffffffu;
    const bool indicator = g_has_focus && g_focus.total >= 2;
    const bool bub = g_bubble.visible();
    uint32_t want;
    if (approval_active)
        want = g_flow.decidable() ? 1u : 2u;
    else
        want = 8u | (bub ? 1u : 0u) | (g_bubble.ackRequired() && bub ? 2u : 0u) |
               (indicator ? 4u : 0u);
    if (want == key) return;  // setZones verwirft die laufende Berührung: nur bei Wechsel
    key = want;
    if (approval_active) {
        g_tracker.setZones(kApproveZones, g_flow.decidable() ? 2 : 0);
    } else {
        const vw::UiLayout l = vw::computeLayout(bub, bub && g_bubble.ackRequired(), indicator);
        g_tracker.setZones(l.zones, l.zone_count);
    }
}

// Titel mit dem Pixelfont (kann Umlaute, der Standardfont nicht): bis zu `rows` Zeilen à `cols`
// Zeichen bei Maßstab 2 (12 px je Zeichen, 16 px je Zeile).
void drawPixelTitle(const char* t, int16_t x, int16_t y, uint8_t cols, uint8_t rows) {
    uint8_t col = 0, row = 0;
    for (size_t i = 0; t[i] != '\0' && row < rows;) {
        const uint8_t l = utf8Len(static_cast<unsigned char>(t[i]));
        if (col == cols) {
            col = 0;
            ++row;
            if (row == rows) break;
        }
        drawGlyph(x + col * 2 * vw::kFontAdvance, y + row * 18, t + i, l, 0xFFFF,
                  vw::kBackgroundColor, 2);
        i += l;
        ++col;
    }
}

void drawApproval(uint32_t now) {
    const uint32_t left = g_flow.remainingS(now);
    const uint32_t key = (left << 8) | (g_flow.decidable() ? 1u : 0u) | (g_flow.sent() ? 2u : 0u) |
                         (g_flash_zone << 4) | (g_press_flash ? 0x1000u : 0u) |
                         (g_flow.isQuestion() ? 0x2000u : 0u);
    if (g_approval_shown && key == g_approval_key) return;
    const bool entering = !g_approval_shown;
    if (entering) {
        g_display.fillScreen(vw::kBackgroundColor);
        sendLog(0, "approval_screen an");
    }
    g_approval_shown = true;
    g_approval_key = key;
    g_display.setTextDatum(0);
    g_display.setTextSize(2);
    g_display.setTextColor(0xFD60, vw::kBackgroundColor);     // Amber
    g_display.fillRect(0, 8, 320, 20, vw::kBackgroundColor);  // Kopfzeile wechselt FREIGABE/FRAGE
    g_display.drawString(g_flow.isQuestion() ? "FRAGE" : "FREIGABE", 10, 8);
    g_display.setTextColor(0xFFFF, vw::kBackgroundColor);
    // Titel nur bei neuer Freigabe zeichnen: der Countdown tickt sekündlich, der Titel soll nicht
    // flackern.
    uint32_t title_hash = g_flow.isQuestion() ? 7u : 5u;
    for (const char* c = g_flow.title(); *c != '\0'; ++c)
        title_hash = title_hash * 31 + static_cast<uint8_t>(*c);
    static uint32_t drawn_title = 0;
    if (entering || title_hash != drawn_title) {
        drawn_title = title_hash;
        g_display.fillRect(0, 36, 320, 72, vw::kBackgroundColor);
        drawPixelTitle(g_flow.title(), 10, 40, 26, 3);
    }
    g_display.setTextColor(0x8C71, vw::kBackgroundColor);
    char meta[32];
    snprintf(meta, sizeof meta, "Klasse: %s   noch %lu s", g_flow.approvalClass(),
             static_cast<unsigned long>(left));
    g_display.fillRect(0, 112, 320, 24, vw::kBackgroundColor);
    g_display.drawString(meta, 10, 114);
    g_display.fillRect(0, 140, 320, 100, vw::kBackgroundColor);
    if (g_flow.hasDeadline()) {
        // Countdown-Balken: auf einen Blick, wie lange die Freigabe noch offen ist (zweites Signal
        // neben der Zahl; unter 20 % rot).
        const uint8_t pct = g_flow.remainingPercent(now);
        g_display.drawRect(10, 138, 300, 8, 0x8C71);
        g_display.fillRect(11, 139, static_cast<int32_t>(298) * pct / 100, 6,
                           pct < 20 ? 0xF800 : 0xFD60);
    }
    if (g_flow.decidable()) {
        drawButton(kApproveZones[0], "DECLINE", 0xC8A2,
                   g_press_flash && g_flash_zone == vw::kZoneDecline);
        drawButton(kApproveZones[1], "ACCEPT", 0x0400,
                   g_press_flash && g_flash_zone == vw::kZoneApprove);
    } else {
        g_display.setTextColor(0xFD60, vw::kBackgroundColor);
        // Eine Frage ist nie am Gerät beantwortbar (ADR-0001); der Text sagt es ehrlich.
        g_display.drawString(g_flow.isQuestion() ? "Am Rechner beantworten"
                             : g_flow.sent()     ? "Antwort gesendet ..."
                                                 : "Nur am PC entscheidbar",
                             10, 170);
    }
}

void hideApproval() {
    if (!g_approval_shown) return;
    sendLog(0, "approval_screen aus");
    g_approval_shown = false;
    g_display.fillScreen(vw::kBackgroundColor);
    g_renderer.clearTicker();
    g_renderer.attachStore(g_store.frameCount() > 0 ? &g_store : nullptr);  // Canvas neu zeichnen
}

void handleTouch(uint32_t now) {
    int32_t rx = 0, ry = 0;
    const bool pressed = g_display.getTouchRaw(&rx, &ry);
    int16_t x = 0, y = 0;
    if (pressed &&
        !vw::mapTouch(kTouchCal, static_cast<int16_t>(rx), static_cast<int16_t>(ry), &x, &y)) {
        return;
    }
    g_tracker.sample(pressed, x, y, now);
    static bool was_pressed = false;
    if (pressed && !was_pressed) {  // je Berührung eine Zeile: Rohwerte für den Punktraster (T3.8)
        char msg[64];
        snprintf(msg, sizeof msg, "touch raw=%d,%d px=%d,%d t=%lu", static_cast<int>(rx),
                 static_cast<int>(ry), x, y, static_cast<unsigned long>(now));
        sendLog(0, msg);
    }
    was_pressed = pressed;
    if (g_tracker.takePressStart()) {
        // Erster Touch auf gedimmtem Display weckt nur (AC-P4-3)
        if (!g_dim.onTouch(now)) g_tracker.cancelCurrent();
        vw::Display::setBacklight(255);
    }
    uint8_t zone = 0;
    if (g_tracker.takeTap(&zone)) {
        bool approve = false;
        if (g_flow.onZoneTap(zone, now, &approve)) {
            g_press_flash = true;
            g_flash_zone = zone;
            g_flash_until = now + 120;  // sichtbares Feedback ≤ 100 ms (W11), unabhängig vom Hub
            char buf[vw::kMaxLineBytes + 1];
            const size_t n =
                vw::encodeActionResponse(buf, sizeof buf, g_flow.actionId(), approve, now);
            if (n > 0) sendLine(buf, n);
        } else if (!g_flow.active()) {
            // UI-Taps (ADR-0009): nie eine Entscheidung (W9), nur Anzeige-Wünsche an den Companion.
            g_tap_flash_until = now + 120;  // lokales Feedback ≤ 100 ms, unabhängig vom Hub
            if (zone == vw::kZoneNyx) {
                g_tap_flash = true;
                drawNyxFrame(0xFFFF);
                sendUiAction(vw::UiAction::kStatusTap, nullptr, now);
            } else if (zone == vw::kZoneFocus) {
                g_tap_flash = true;
                g_focus_key = 0xfffffffeu;  // Indikator als gedrückt neu zeichnen
                sendUiAction(vw::UiAction::kFocusNext, nullptr, now);
            } else if (zone == vw::kZoneBubble && g_bubble.criticalPending()) {
                char id[37];
                strncpy(id, g_bubble.id(), sizeof id - 1);
                id[sizeof id - 1] = '\0';
                g_bubble.ack(id);
                sendUiAction(vw::UiAction::kBubbleAck, id, now);
            }
        }
    }
}

bool loadSpriteBlob() {
    File f = LittleFS.open("/nyx.spr", "r");
    if (!f) return false;
    g_spr_blob_len = f.size();
    g_spr_blob = static_cast<uint8_t*>(malloc(g_spr_blob_len));
    if (g_spr_blob == nullptr) {
        f.close();
        return false;
    }
    f.read(g_spr_blob, g_spr_blob_len);
    f.close();
    return true;
}

// Letzter Report (spec §7 Ticker): die jüngste notification bleibt im Tickerband stehen, auch im
// Leerlauf. Der Offline-Hinweis hat Vorrang; danach kommt der Report zurück. Der Companion sendet
// die jüngste Meldung nach jedem snapshot erneut (K7), gleicher Text zeichnet nicht neu.
char g_report_title[vw::kTitleMaxChars + 1] = {0};
char g_report_body[vw::kBodyMaxChars + 1] = {0};
bool g_report_dirty = false;

void noteReport(const vw::NotificationFrame& n) {
    if (strcmp(n.title, g_report_title) == 0 && strcmp(n.body, g_report_body) == 0) return;
    strncpy(g_report_title, n.title, sizeof g_report_title - 1);
    strncpy(g_report_body, n.body, sizeof g_report_body - 1);
    g_report_dirty = true;
}

void updateReportTicker() {
    static bool was_offline = false;
    const bool offline = g_state.current() == vw::NyxState::kOffline;
    if (offline) {
        was_offline = true;
        return;
    }
    if (was_offline) {
        was_offline = false;
        g_report_dirty = true;  // der Offline-Hinweis hat das Band geleert
    }
    if (!g_report_dirty) return;
    g_report_dirty = false;
    if (g_report_title[0] == '\0' && g_report_body[0] == '\0') return;
    g_renderer.setTicker(g_report_title, g_report_body);
}

// Offline-Hinweis (T4.3): Grund und lokale Zeit des letzten bestätigten Stands im Tickerband;
// beim Wiederkommen leeren. Grundwechsel (Link → Hub) wird ebenfalls nachgezogen.
void updateOfflineTicker() {
    static vw::OfflineReason shown = vw::OfflineReason::kNone;
    const vw::OfflineReason now_reason = g_state.current() == vw::NyxState::kOffline
                                             ? g_state.offlineReason()
                                             : vw::OfflineReason::kNone;
    if (now_reason == shown) return;
    shown = now_reason;
    char l1[40], l2[40];
    if (vw::formatOffline(now_reason, g_state.lastGoodTs(), g_state.lastGoodHasOffset(),
                          g_state.lastGoodOffsetMin(), l1, sizeof l1, l2, sizeof l2)) {
        g_renderer.setTicker(l1, l2);
    } else {
        g_renderer.clearTicker();
    }
}

}  // namespace

void setup() {
    Serial.begin(kSerialBaud);
    vw::Display::backlightOn();
    g_display.init();
    g_display.setRotation(1);  // Landscape 320×240 (BUG-0001)
    g_display.fillScreen(vw::kBackgroundColor);

    if (!LittleFS.begin(false)) {
        g_display.setTextColor(0xFFFF, 0);
        g_display.setTextDatum(lgfx::textdatum_t::middle_center);
        g_display.drawString("LittleFS fehlt: npm run assets + uploadfs", g_display.width() / 2,
                             g_display.height() / 2);
    } else if (loadSpriteBlob() && g_store.load(g_spr_blob, g_spr_blob_len)) {
        g_renderer.attachStore(&g_store);
    } else {
        g_display.setTextColor(0xFFFF, 0);
        g_display.setTextDatum(lgfx::textdatum_t::middle_center);
        g_display.drawString("nyx.spr unlesbar", g_display.width() / 2, g_display.height() / 2);
    }

    g_pusher.begin(pushCanvas);
    g_state.setTransitionHook(onTransition, nullptr);
    g_renderer.seedIdleLife(esp_random(), millis());
    g_renderer.onStateChange(vw::NyxState::kIdle, vw::NyxState::kIdle, 0);

    // Zeilenende vor hello: ROM-Bytes des Boots bleiben so in einer eigenen Zeile und
    // verschlucken das hello nicht (EPIC-P2 T2.9, Companion-Seite in bridge.ts).
    Serial.write('\n');
    char line[vw::kMaxLineBytes + 1];
    const size_t n = vw::encodeHello(line, sizeof line, "0.2.0", g_display.width(),
                                     g_display.height(), "POWERON_RESET", ESP.getFreeHeap());
    if (n > 0) {
        line[n] = '\0';
        Serial.write(line, n);
        Serial.write('\n');
    }
    g_last_stats_ms = millis();
}

void loop() {
    const uint32_t now = millis();

    char* line = nullptr;
    size_t len = 0;
    while (g_reader.feed(serialRead, nullptr, &line, &len)) {
        vw::DecodeOutcome res = vw::decodeFrame(line, len);
        if (res.ok) {
            if (res.frame.type == vw::FrameType::kNotification) noteReport(res.frame.notification);
            g_state.onFrame(res.frame, now);
            switch (res.frame.type) {
                case vw::FrameType::kActionRequest: {
                    const auto& a = res.frame.action_request;
                    g_flow.arm(a.action_id, a.title, a.approval_class, a.timeout_s, a.decidable,
                               now, false, a.is_question);
                    break;
                }
                case vw::FrameType::kSnapshot: {
                    const auto& sn = res.frame.snapshot;
                    sendLog(0,
                            sn.has_approval ? "snapshot mit approval" : "snapshot ohne approval");
                    if (sn.sessions_total == 0) g_has_focus = false;  // K7: Liste leer, Fokus weg
                    if (sn.has_approval) {
                        g_flow.arm(sn.approval.action_id, sn.approval.title,
                                   sn.approval.approval_class, sn.approval.timeout_s,
                                   sn.approval.decidable, now, true, sn.approval.is_question);
                    } else {
                        g_flow.clear();
                    }
                    break;
                }
                case vw::FrameType::kActionResult:
                    g_flow.onResult(res.frame.action_result.action_id);
                    break;
                case vw::FrameType::kBubble: {
                    const auto r = g_bubble.show(res.frame.bubble, now, g_flow.active());
                    char dbg[48];
                    snprintf(dbg, sizeof dbg, "bubble rx result=%u vis=%d t=%lu",
                             static_cast<unsigned>(r), g_bubble.visible() ? 1 : 0,
                             static_cast<unsigned long>(now));
                    sendLog(0, dbg);
                    if (r == vw::BubbleView::Result::kRejectedApproval ||
                        r == vw::BubbleView::Result::kRejectedByCritical) {
                        sendLog(1, "bubble verworfen (Freigabe/kritische Blase)");  // Fail loud
                    }
                    break;
                }
                case vw::FrameType::kSessionFocus:
                    g_focus = res.frame.session_focus;
                    g_has_focus = true;
                    {
                        char dbg[48];
                        snprintf(dbg, sizeof dbg, "focus rx %u/%u st=%u t=%lu", g_focus.idx,
                                 g_focus.total, g_focus.status, static_cast<unsigned long>(now));
                        sendLog(0, dbg);
                    }
                    break;
                default:
                    break;
            }
        } else {
            ++g_parse_err;
        }
    }

    uint32_t last_seq = 0;
    if (g_state.takeSeqGap(&last_seq)) {
        char buf[vw::kMaxLineBytes + 1];
        const size_t n = vw::encodeResync(buf, sizeof buf, last_seq);
        if (n > 0) {
            buf[n] = '\0';
            Serial.write(buf, n);
            Serial.write('\n');
        }
    }

    g_state.tick(now);
    g_flow.tick(now);
    g_bubble.setApprovalActive(g_flow.active());
    g_bubble.tick(now);
    handleTouch(now);
    if (g_press_flash && static_cast<int32_t>(now - g_flash_until) >= 0) g_press_flash = false;
    if (g_tap_flash && static_cast<int32_t>(now - g_tap_flash_until) >= 0) {
        g_tap_flash = false;
        drawNyxFrame(vw::kBackgroundColor);
        g_focus_key = 0xfffffffeu;  // Indikator normal neu zeichnen
    }
    applyZones(g_flow.active());
    g_tracker.setLocked(g_flow.sent());
    updateOfflineTicker();
    updateReportTicker();

    const bool was_dimmed = g_dim.dimmed();
    g_dim.tick(now);
    if (g_dim.dimmed() != was_dimmed) {
        vw::Display::setBacklight(g_dim.dimmed() ? kDimLevel : 255);
    }

    // Frame-Loop: gezeichnet wird nur bei Änderung (Dirty-Rect); gemessen werden die
    // gezeichneten Bilder samt Push (stats.fps = Renderkapazität, frame_stats.h).
    if (g_flow.active())
        drawApproval(now);
    else
        hideApproval();
    if (g_flow.active()) {
        g_focus_key = 0xffffffffu;  // nach der Freigabe neu zeichnen
        g_name_key = 0xffffffffu;
        g_bubble_on_screen = false;
    } else {
        // Nyx rückt für die Blase nach links. Beim Verschwinden zuerst die Spalte leeren, dann
        // schiebt der Push Nyx zurück; beim Erscheinen zeichnet drawBubble nach dem Push, weil der
        // Push beim Verschieben die alte Fläche löscht (BUG-0004) und die Blasenspalte berührt.
        static bool last_visible = false;
        const bool vis = g_bubble.visible();
        if (vis != last_visible) {
            last_visible = vis;
            g_renderer.attachStore(g_store.frameCount() > 0 ? &g_store : nullptr);  // dirty
            if (vis)
                g_bubble_on_screen = false;
            else
                clearBubbleArea();
        }
    }
    const uint32_t t0 = micros();
    if (!g_flow.active() && g_renderer.tick(now)) {
        const vw::UiLayout lay = vw::computeLayout(g_bubble.visible(), false, false);
        g_pusher.update(g_renderer.canvas(), lay.nyx_x, (g_display.height() - vw::kCanvasH) / 2,
                        g_renderer.takePushHeight());
        g_frame_stats.onFrame(now, micros() - t0);
    }
    if (!g_flow.active()) {
        drawBubble(now);
        drawFocusIndicator(g_tap_flash);
        drawSessionName(false);
    }
    // W3 (observability §4): Einbruch und Ausreißer sichtbar machen, einmal je Fenster.
    if (g_frame_stats.completedWindows() != g_reported_windows) {
        g_reported_windows = g_frame_stats.completedWindows();
        if (g_frame_stats.maxFrameUs() > vw::kFrameCeilingUs) sendLog(2, "frame_ueber_80ms");
        if (g_frame_stats.belowFloorTwice()) sendLog(2, "fps_unter_25");
    }

    if (now - g_last_stats_ms >= kStatsIntervalMs) {
        g_last_stats_ms = now;
        const float fps = g_frame_stats.fps();
        char buf[vw::kMaxLineBytes + 1];
        const size_t n =
            vw::encodeStats(buf, sizeof buf, fps, ESP.getFreeHeap(), ESP.getMinFreeHeap(),
                            now / 1000, g_reader.overruns(), g_parse_err);
        if (n > 0) {
            buf[n] = '\0';
            Serial.write(buf, n);
            Serial.write('\n');
        }
    }
    delay(1);
}
