// ADR-0009: Sprechblase am Gerät — hostfähig (keine Hardware-Includes, keine dynamische
// Allokation). Die Blase hält nur Anzeige-Daten aus dem bubble-Frame (K7: nach hello kommt eine
// kritische erneut vom Companion). Typewriter, Zeilenumbruch, Haltezeit und die Verdrängungsregeln
// sind reine Funktionen der Eingaben und der Zeit. Eine Blase überdeckt nie eine Freigabe, und eine
// unquittierte kritische Blase wird von nichts Niedrigerem verdrängt (W12).
#pragma once

#include <cstddef>
#include <cstdint>

#include "protocol/frames.h"
#include "render/font5x7.h"

namespace vw {

constexpr uint8_t kBubbleCols = 20;  // Zeichen je Zeile in der 120-px-Spalte (6 px je Zeichen)
// Kurze Blasen in doppelter Größe (besser lesbar): nur wenn Titel und Körper in die Spalte passen,
// sonst einfache Größe mit 20 Spalten.
constexpr uint8_t kBubbleBigMaxTitle = 20;
constexpr uint8_t kBubbleBigMaxBody = 40;
constexpr uint8_t kBubbleMaxTitleRows = 4;
constexpr uint8_t kBubbleMaxBodyRows = 16;
constexpr uint32_t kTypeMsPerChar = 25;  // 40 Zeichen/s

struct TextRow {
    uint16_t start;  // Byte-Offset im Text
    uint8_t len;     // Länge in Bytes
    uint8_t cols;    // Länge in Zeichen (UTF-8-Codepoints)
};

/// Glyph für ein UTF-8-Zeichen. Der Pixelfont kennt nur Großbuchstaben (und ä ö ü ß): ASCII-
/// Kleinbuchstaben fallen auf den Großbuchstaben. nullptr = unbekannt (Lücke, kein Absturz).
const FontGlyph* bubbleGlyph(const char* utf8, size_t len);

class BubbleView {
public:
    enum class Result : uint8_t { kShown, kSame, kRejectedApproval, kRejectedByCritical };

    /// Zeigt eine Blase. Dieselbe `bubble_id` startet den Typewriter nicht neu (Companion sendet
    /// kritische Blasen nach hello/resync erneut). Abgelehntes wird gezählt (`rejected`).
    Result show(const BubbleFrame& f, uint32_t now_ms, bool approval_active);

    /// Quittierung der kritischen Blase (lokal, nach Tap); andere IDs ändern nichts.
    void ack(const char* bubble_id);

    /// Freigabe-Screen aktiv: normale Blasen verschwinden, die kritische bleibt gemerkt.
    void setApprovalActive(bool active);

    /// Haltezeit: normale Blasen laufen `hold_s` nach Ende des Tippens ab; kritische nie.
    void tick(uint32_t now_ms);

    /// Maßstab der Zeichen (1 oder 2); Spalten je Zeile = kBubbleCols / Maßstab.
    uint8_t scale() const { return scale_; }
    bool visible() const { return active_ && !suppressed_; }
    bool criticalPending() const { return active_ && ack_required_; }
    bool ackRequired() const { return ack_required_; }
    uint8_t level() const { return level_; }
    const char* id() const { return id_; }
    const char* title() const { return title_; }
    const char* body() const { return body_; }

    uint8_t titleRowCount() const { return title_rows_n_; }
    uint8_t bodyRowCount() const { return body_rows_n_; }
    const TextRow& titleRow(uint8_t i) const { return title_rows_[i]; }
    const TextRow& bodyRow(uint8_t i) const { return body_rows_[i]; }

    /// Sichtbare Bytes des Textes (Typewriter), immer auf einer Zeichengrenze.
    size_t visibleBytes(uint32_t now_ms) const;
    bool typingDone(uint32_t now_ms) const;

    /// Ändert sich bei jeder Änderung des Bildes (neu, weg, wieder sichtbar).
    uint32_t revision() const { return revision_; }
    uint32_t rejected() const { return rejected_; }

private:
    void hide();
    uint32_t typeDurationMs() const;

    bool active_ = false;
    bool suppressed_ = false;
    bool ack_required_ = false;
    uint8_t level_ = 0;
    uint8_t scale_ = 1;
    uint8_t hold_s_ = 0;
    uint32_t shown_ms_ = 0;
    uint32_t revision_ = 0;
    uint32_t rejected_ = 0;
    size_t body_chars_ = 0;
    char id_[37] = {0};
    char title_[kTitleMaxChars + 1] = {0};
    char body_[kBodyMaxChars + 1] = {0};
    TextRow title_rows_[kBubbleMaxTitleRows] = {};
    TextRow body_rows_[kBubbleMaxBodyRows] = {};
    uint8_t title_rows_n_ = 0;
    uint8_t body_rows_n_ = 0;
};

}  // namespace vw
