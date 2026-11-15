#include "state/bubble_view.h"

#include <cstring>

namespace vw {
namespace {

uint8_t cpLen(unsigned char c) {
    return (c & 0x80) == 0 ? 1 : (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3 : 4;
}

size_t countChars(const char* s) {
    size_t n = 0;
    for (size_t i = 0; s[i] != '\0'; i += cpLen(static_cast<unsigned char>(s[i]))) ++n;
    return n;
}

// Greedy-Umbruch an Wortgrenzen auf kBubbleCols Zeichen; zu lange Wörter werden hart getrennt.
// Liefert die Zeilenzahl; was über max_rows hinausgeht, wird nicht gezeichnet (Aufrufer kürzt
// vorher auf die Frame-Grenzen, Test belegt 160 Zeichen).
uint8_t wrap(const char* text, TextRow* rows, uint8_t max_rows, uint8_t max_cols) {
    uint8_t n = 0;
    size_t i = 0;
    const size_t total = strlen(text);
    while (i < total && n < max_rows) {
        while (i < total && text[i] == ' ') ++i;  // führende Leerzeichen einer Zeile
        if (i >= total) break;
        const size_t start = i;
        size_t cols = 0;
        size_t last_space = 0;  // Byte-Index des letzten Leerzeichens in dieser Zeile
        size_t last_space_cols = 0;
        size_t j = i;
        while (j < total && cols < max_cols) {
            if (text[j] == ' ') {
                last_space = j;
                last_space_cols = cols;
            }
            j += cpLen(static_cast<unsigned char>(text[j]));
            ++cols;
        }
        size_t end = j;
        size_t end_cols = cols;
        if (j < total && text[j] != ' ' && last_space != 0) {
            end = last_space;  // am Wort umbrechen
            end_cols = last_space_cols;
        }
        rows[n].start = static_cast<uint16_t>(start);
        rows[n].len = static_cast<uint8_t>(end - start);
        rows[n].cols = static_cast<uint8_t>(end_cols);
        ++n;
        i = end;
    }
    return n;
}

const FontGlyph* findExact(const char* s, size_t len) {
    for (size_t i = 0; i < kFont5x7Count; ++i) {
        const FontGlyph& g = kFont5x7[i];
        if (g.len == len && memcmp(g.cp, s, len) == 0) return &g;
    }
    return nullptr;
}

}  // namespace

const FontGlyph* bubbleGlyph(const char* utf8, size_t len) {
    const FontGlyph* g = findExact(utf8, len);
    if (g != nullptr || len != 1 || utf8[0] < 'a' || utf8[0] > 'z') return g;
    const char up = static_cast<char>(utf8[0] - 'a' + 'A');
    return findExact(&up, 1);
}

uint32_t BubbleView::typeDurationMs() const {
    // Fehler und kritische Blasen erscheinen sofort (nichts Wichtiges hinter einer Animation).
    if (level_ >= 2 || ack_required_) return 0;
    return static_cast<uint32_t>(body_chars_) * kTypeMsPerChar;
}

BubbleView::Result BubbleView::show(const BubbleFrame& f, uint32_t now_ms, bool approval_active) {
    if (active_ && strcmp(id_, f.bubble_id) == 0) return Result::kSame;
    if (active_ && ack_required_ && !f.ack_required) {
        ++rejected_;
        return Result::kRejectedByCritical;
    }
    if (approval_active && !f.ack_required) {
        ++rejected_;
        return Result::kRejectedApproval;
    }
    strncpy(id_, f.bubble_id, sizeof id_ - 1);
    id_[sizeof id_ - 1] = '\0';
    strncpy(title_, f.title, sizeof title_ - 1);
    title_[sizeof title_ - 1] = '\0';
    strncpy(body_, f.body, sizeof body_ - 1);
    body_[sizeof body_ - 1] = '\0';
    level_ = f.level;
    hold_s_ = f.hold_s;
    ack_required_ = f.ack_required;
    shown_ms_ = now_ms;
    body_chars_ = countChars(body_);
    scale_ = (countChars(title_) <= kBubbleBigMaxTitle && body_chars_ <= kBubbleBigMaxBody) ? 2 : 1;
    const uint8_t cols = kBubbleCols / scale_;
    title_rows_n_ = wrap(title_, title_rows_, kBubbleMaxTitleRows, cols);
    body_rows_n_ = wrap(body_, body_rows_, kBubbleMaxBodyRows, cols);
    active_ = true;
    suppressed_ = approval_active;  // nur eine kritische Blase kommt hier mit Freigabe durch
    ++revision_;
    return Result::kShown;
}

void BubbleView::hide() {
    if (!active_) return;
    active_ = false;
    ack_required_ = false;
    ++revision_;
}

void BubbleView::ack(const char* bubble_id) {
    if (active_ && ack_required_ && strcmp(id_, bubble_id) == 0) hide();
}

void BubbleView::setApprovalActive(bool active) {
    if (suppressed_ == active) return;
    suppressed_ = active;
    // Eine normale Blase unter einer Freigabe wird verworfen; die kritische bleibt gemerkt.
    if (active && active_ && !ack_required_) hide();
    ++revision_;
}

void BubbleView::tick(uint32_t now_ms) {
    if (!active_ || ack_required_ || hold_s_ == 0) return;
    const uint32_t end = shown_ms_ + typeDurationMs() + static_cast<uint32_t>(hold_s_) * 1000u;
    if (static_cast<int32_t>(now_ms - end) >= 0) hide();
}

size_t BubbleView::visibleBytes(uint32_t now_ms) const {
    if (!active_) return 0;
    const size_t total = strlen(body_);
    if (typeDurationMs() == 0) return total;
    const uint32_t elapsed = now_ms - shown_ms_;
    size_t chars = elapsed / kTypeMsPerChar;
    size_t bytes = 0;
    while (chars > 0 && bytes < total) {
        bytes += cpLen(static_cast<unsigned char>(body_[bytes]));
        --chars;
    }
    return bytes > total ? total : bytes;
}

bool BubbleView::typingDone(uint32_t now_ms) const {
    return active_ && now_ms - shown_ms_ >= typeDurationMs();
}

}  // namespace vw
