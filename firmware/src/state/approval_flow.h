// EPIC-P3 T3.4/T3.9: Freigabe-Ablauf am Gerät — hostfähig. Das Gerät entscheidet nur, was der
// Hub zur Entscheidung freigibt: nie `destructive`, nie ohne `decidable`, höchstens einmal je
// action_id (W9, ADR-0001/0004). Kein Auto-Approve, kein Auto-Decline: Ablauf blendet nur aus.
#pragma once

#include <cstdint>

#include "protocol/frames.h"

namespace vw {

constexpr uint8_t kZoneApprove = 1;
constexpr uint8_t kZoneDecline = 2;

class ApprovalFlow {
public:
    /// Aktive Freigabe aus action_request oder snapshot.approval (Recovery nach Reset, K7).
    /// Eine neue action_id hebt eine alte Sperre auf; `unlock` (snapshot: der Hub zeigt die
    /// Freigabe weiter als offen, die Antwort ging also verloren) erlaubt eine erneute Antwort. Der
    /// Hub und das Dedupe-Log des Companions fangen ein Doppel je action_id ab.
    /// `is_question` (kind=question, ADR-0009): reine Anzeige, nie entscheidbar — unabhängig davon,
    /// was `decidable` sagt.
    void arm(const char* action_id, const char* title, const char* approval_class, double timeout_s,
             bool decidable, uint32_t now_ms, bool unlock = false, bool is_question = false);

    /// action_result: gleiche action_id beendet die Freigabe (egal welcher Status).
    void onResult(const char* action_id);

    /// Kein Approval mehr (snapshot ohne approval, offline): ausblenden.
    void clear();

    /// Läuft die Anzeige-Frist ab, verschwinden die Zonen. Entschieden wird nie.
    void tick(uint32_t now_ms);

    bool active() const { return active_; }
    bool isQuestion() const { return active_ && is_question_; }
    /// Zonen dürfen nur bei decidable, nicht destructive und noch nicht abgesandt reagieren.
    bool decidable() const { return active_ && decidable_ && !sent_; }
    bool sent() const { return sent_; }
    const char* actionId() const { return id_; }
    const char* title() const { return title_; }
    const char* approvalClass() const { return class_; }
    /// Verbleibende Sekunden (0 nach Ablauf oder ohne Frist).
    uint32_t remainingS(uint32_t now_ms) const;
    bool hasDeadline() const { return active_ && has_deadline_; }
    /// Restzeit in Prozent der Gesamtfrist dieser Freigabe (Countdown-Balken); 0 ohne Frist.
    uint8_t remainingPercent(uint32_t now_ms) const;

    /// Tap auf eine Zone: true, wenn jetzt `action_response` zu senden ist.
    bool onZoneTap(uint8_t zone, uint32_t now_ms, bool* approve);

private:
    bool active_ = false;
    bool decidable_ = false;
    bool sent_ = false;
    bool is_question_ = false;
    char id_[40] = {0};
    char title_[kTitleMaxChars + 1] = {0};
    char class_[12] = {0};
    uint32_t deadline_ms_ = 0;
    uint32_t total_ms_ =
        0;  // Gesamtfrist; ein snapshot meldet nur die Rest-Frist, sie bleibt erhalten
    bool has_deadline_ = false;
};

}  // namespace vw
