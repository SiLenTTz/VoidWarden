// EPIC-P2 T2.10: Messgröße für stats.fps und W3 (spec §9, observability §4).
// Gleitendes Fenster statt Boot-Mittelwert: Ein Mittel über die ganze Laufzeit
// verdeckt nach langem Betrieb jeden Einbruch. Hostfähig, ohne Arduino (state/).
// Der Renderer zeichnet nur bei Änderung (Dirty-Rect); gezählt werden daher nur
// gezeichnete Bilder, und fps ist die Renderkapazität: Bilder je Sekunde Zeichenzeit.
// Die Schleifen-Frequenz im Leerlauf würde W3 sonst trivial bestehen.
#pragma once

#include <cstdint>

namespace vw {

constexpr uint32_t kFpsWindowMs = 5000;
constexpr uint32_t kMinFramesPerWindow = 3;  // weniger Bilder: Fenster ohne Aussage
constexpr float kFpsFloor = 25.0f;           // W3: ≥ 25 fps
constexpr uint32_t kFrameCeilingUs = 80000;  // W3: kein Frame > 80 ms

class FrameStats {
public:
    /// Ein gezeichnetes Bild (nicht jeder Schleifendurchlauf): Zeitpunkt in ms
    /// (wrap-sicher) und Dauer in µs inklusive Display-Push.
    void onFrame(uint32_t now_ms, uint32_t duration_us);

    /// Renderkapazität (Bilder/s Zeichenzeit) des letzten Fensters mit ≥ kMinFramesPerWindow
    /// Bildern; 0, solange keines vorliegt.
    float fps() const { return fps_; }
    /// Längste Frame-Dauer des letzten abgeschlossenen Fensters in µs.
    uint32_t maxFrameUs() const { return max_us_; }
    /// Zählt abgeschlossene Fenster; daran erkennt der Aufrufer neue Messwerte.
    uint32_t completedWindows() const { return completed_; }
    /// Zwei Fenster in Folge unter kFpsFloor (observability §4: „fps < 25 über 10 s“).
    bool belowFloorTwice() const { return below_run_ >= 2; }

private:
    bool started_ = false;
    uint32_t win_start_ms_ = 0;
    uint32_t frames_ = 0;
    uint64_t busy_us_ = 0;
    uint32_t cur_max_us_ = 0;
    uint32_t max_us_ = 0;
    float fps_ = 0.0f;
    uint32_t completed_ = 0;
    uint32_t below_run_ = 0;
};

}  // namespace vw
