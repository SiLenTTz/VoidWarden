// EPIC-P2 T2.5: Renderer — hostfähig (keine Hardware-Includes). Arbeitet auf
// einem festen Canvas (192×216 RGB565: Nyx-Bereich 64×64-Quelle ×3 plus Tickerzeilen)
// mit Dirty-Rect-Rückmeldung an den HAL (Board: pushImage; ADR-0003 Dirty-Rect).
// Keine dynamische Allokation im Zeichnen-Pfad (architecture.md §2).
#pragma once

#include <cstdint>

#include "protocol/frames.h"
#include "render/idle_life.h"
#include "state/state_machine.h"

namespace vw {

constexpr uint8_t kScale = 3;  // ganzzahlig, nearest-neighbor (spec §6, ADR-0006)
constexpr uint16_t kSpriteW = 64 * kScale;
constexpr uint16_t kSpriteH = 64 * kScale;
constexpr uint16_t kTickerH = 24;
constexpr uint16_t kCanvasW = kSpriteW;
constexpr uint16_t kCanvasH = kSpriteH + kTickerH;  // Ticker überdeckt Nyx nie
constexpr uint16_t kBackgroundColor = 0x0841;  // VOID_BLACK #0A0A0F in RGB565 (für HAL-fillRect).
// Canvas-Pixel liegen mit vertauschten Bytes (Panel-Reihenfolge): Der Push braucht dann weder
// Konvertierung noch Kopie; am Board kostete die Konvertierung rund die Hälfte der Push-Zeit.
constexpr uint16_t kBackgroundPx = 0x4108;  // kBackgroundColor, Bytes vertauscht
static_assert(kBackgroundPx ==
                  static_cast<uint16_t>((kBackgroundColor << 8) | (kBackgroundColor >> 8)),
              "kBackgroundPx muss kBackgroundColor mit vertauschten Bytes sein");

struct Rect {
    uint16_t x, y, w, h;
};

/// Augenfarben eines Zustands: die Marker-Indizes 1–3 der Palette (core/mid/dim)
/// werden beim Blitten getauscht (ADR-0006, keine duplizierten Frames).
struct EyeColors {
    uint16_t core, mid, dim;
};

/// Dekodiert eine nyx.spr-Datei im Speicher (firmware/data, LittleFS auf dem
/// Board). Kopf: "NYX2"|u8 ver|u16 fw|u16 fh|u16 frames|u8 palette, dann
/// Palette (RGB888; 0 = transparent, 1–3 Augenmarker, 4.. Körper), Frame-
/// Metadaten (18 B je Frame: Name[16], Index, Dauer in 10 ms), Pixeldaten (4-Bit).
class SpriteStore {
public:
    /// false bei falschem Magic (z. B. altes NYX1), kaputten Maßen oder wenn der
    /// Frame ×kScale nicht in den Nyx-Bereich des Canvas passt (fail loud).
    bool load(const uint8_t* blob, size_t len);

    uint16_t frameWidth() const { return fw_; }
    uint16_t frameHeight() const { return fh_; }
    /// Dunkelste Körperfarbe (Palette-Index 4): geschlossene Augen im Blinzeln.
    uint16_t darkColor() const { return palette_ > 4 ? lut_[4] : lut_[0]; }
    uint16_t frameCount() const { return frames_; }
    /// Index des ersten Frames eines Zustands (linear über die Metadaten).
    int frameFor(NyxState state, uint8_t animation_index) const;
    uint8_t animationFrames(NyxState state) const;

    /// Anzeigedauer des Frames in ms; 0 = Datei nennt keine (Renderer-Standard).
    uint16_t frameDurationMs(int frame_idx) const;

    /// Zeichnet Frame frame_idx skaliert in den Nyx-Bereich des Canvas. Transparent
    /// wird kBackgroundPx; `eyes` ersetzt die Marker, nullptr = Marker der Datei.
    void blit(uint16_t* canvas, int frame_idx, const EyeColors* eyes = nullptr) const;

private:
    const uint8_t* blob_ = nullptr;
    size_t len_ = 0;
    uint16_t fw_ = 0, fh_ = 0, frames_ = 0;
    uint8_t palette_ = 0;
    uint16_t lut_[16] = {0};
};

/// Glitch-Übergang: 3 Frames prozedural (Zeilenversatz, Flackern, Noise;
/// spec §5 „keine vorberechneten Übergangs-Frames").
class Glitch {
public:
    void begin(uint32_t now_ms);
    /// true, solange der Übergang läuft (jedes Bild verändert sich dann).
    bool running(uint32_t now_ms) const { return active_ && now_ms - start_ms_ < 450; }
    /// Liefert true, solange der Übergang läuft; verbiegt Zeilen des Canvas.
    bool apply(uint16_t* canvas, uint32_t now_ms, uint32_t seed) const;

private:
    uint32_t start_ms_ = 0;
    bool active_ = false;
};

/// Ticker: 2 Zeilen à font5x7, automatisch scrollend (spec §7).
class Ticker {
public:
    void setText(const char* utf8_line1, const char* utf8_line2);
    bool visible() const { return !empty_; }
    /// Rendert in den unteren Ticker-Bereich des Canvas (y >= kSpriteH).
    void draw(uint16_t* canvas, uint32_t now_ms, uint16_t color) const;
    void clear();

private:
    char line1_[81] = {0};
    char line2_[81] = {0};
    bool empty_ = true;
};

/// Board-Adapter (EPIC-P2 T2.5): pusht den Renderer-Canvas (128×192) an eine
/// Position auf dem 320×240-Display und meldet Dirty-Rects zurück ans Display.
/// hostfähig bleibt Renderer selbst; dieser Adapter lebt im hal-Layer.
class CanvasPusher {
public:
    void begin(void (*push)(const uint16_t*, uint16_t, uint16_t, uint16_t, uint16_t));
    /// Pusht opak; löscht die alte Fläche nur beim Verschieben (BUG-0004).
    /// `h` ist die zu pushende Höhe ab Zeile 0 (ohne Ticker nur der Sprite-Bereich).
    void update(const uint16_t* canvas, uint16_t x, uint16_t y, uint16_t h = kCanvasH);

private:
    void (*push_)(const uint16_t*, uint16_t, uint16_t, uint16_t, uint16_t) = nullptr;
    uint16_t last_x_ = 0, last_y_ = 0;
    bool first_ = true;
};

class Renderer {
public:
    Renderer() {
        idle_.begin(1, 0);
    }  // Standard-Seed; das Board setzt per seedIdleLife einen eigenen

    using DirtyCb = void (*)(const Rect&, void* user);

    void setDirtyCallback(DirtyCb cb, void* user) {
        dirty_cb_ = cb;
        dirty_user_ = user;
    }
    void attachStore(const SpriteStore* store) {
        store_ = store;
        dirty_ = true;
    }

    /// Zustands-Update mit Übergangs-Glitch (hookpt StateMachine-Transitionen).
    void onStateChange(NyxState from, NyxState to, uint32_t now_ms);

    /// Tickerband setzen/leeren (T4.3 Offline-Hinweis); beides löst ein Neuzeichnen aus.
    void setTicker(const char* line1, const char* line2) {
        ticker_.setText(line1, line2);
        dirty_ = true;
    }
    void clearTicker() {
        ticker_.clear();
        dirty_ = true;
    }

    /// Ein Render-Tick: Animation fortsetzen, Glitch anwenden, Ticker zeichnen.
    /// Liefert false, wenn sich nichts geändert hat: Canvas und Push bleiben dann
    /// unangetastet (Dirty-Rect, ADR-0003; der Push eines 192×216-Canvas kostet am Board
    /// den Großteil der Frame-Zeit).
    bool tick(uint32_t now_ms);

    const uint16_t* canvas() const { return canvas_; }

    /// Zu pushende Canvas-Höhe: ohne Ticker nur der Sprite-Bereich (spart ein Neuntel Push).
    /// Nach dem Ausblenden des Tickers einmal volle Höhe, damit das Band auf dem Panel leer wird.
    uint16_t takePushHeight() {
        const bool full = ticker_.visible() || band_stale_;
        band_stale_ = ticker_.visible();
        return full ? kCanvasH : kSpriteH;
    }

    /// Zustandsfarbe (spec §5) als RGB565.
    static uint16_t stateColor(NyxState s);

    /// Augenfarben je Zustand (ADR-0006 Zuordnung, Zustandsebene ohne Aktivität).
    static EyeColors eyeColors(NyxState s);

    /// Augenfarben mit Puls (listening, approval_pending) und Blinzeln (`blink` 0/1/2, dark =
    /// geschlossenes Auge). Rein: gleiche Eingabe, gleiche Farben (Native-Test).
    static EyeColors animatedEyes(NyxState s, uint32_t now_ms, uint8_t blink, uint16_t dark);

    /// Beginnt Idle-Life neu (Seed injizierbar; Board nimmt eine feste Quelle).
    void seedIdleLife(uint32_t seed, uint32_t now_ms) { idle_.begin(seed, now_ms); }

private:
    void markAllDirty();
    void drawSignals(uint16_t color, uint32_t ring_step);

    uint16_t canvas_[kCanvasW * kCanvasH] = {0};
    const SpriteStore* store_ = nullptr;
    NyxState current_ = NyxState::kIdle;
    uint8_t anim_frame_ = 0;
    uint32_t last_anim_ms_ = 0;
    Glitch glitch_;
    Ticker ticker_;
    IdleLife idle_;
    uint32_t last_key_ = 0xffffffffu;  // Bildschlüssel: Frame, Blinzeln, Puls, Ring
    bool band_stale_ = false;          // Ticker war sichtbar: Band einmal leer pushen
    bool dirty_ = true;                // Zustand/Store geändert, Canvas veraltet
    bool glitch_was_running_ = false;  // nach dem Glitch noch ein sauberes Bild zeichnen
    DirtyCb dirty_cb_ = nullptr;
    void* dirty_user_ = nullptr;
};

}  // namespace vw
