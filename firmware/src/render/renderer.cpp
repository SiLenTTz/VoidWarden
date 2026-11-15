// EPIC-P2 T2.5: Renderer — Implementierung (hostfähig, feste Puffer).
#include "renderer.h"

#include <cstring>

#include "font5x7.h"
#include "state/bubble_view.h"

namespace vw {
namespace {

constexpr size_t kMetaBytes = 18;  // Name[16] + Index + Dauer (tools/assets/pipeline.mjs)
constexpr size_t kNameBytes = 16;

// RGB565 mit vertauschten Bytes (Canvas-Format, siehe kBackgroundPx).
uint16_t rgb888to565(uint8_t r, uint8_t g, uint8_t b) {
    const uint16_t c = static_cast<uint16_t>(((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3));
    return static_cast<uint16_t>((c << 8) | (c >> 8));
}

// Deterministischer Hash-Noise für Glitch (kein rand(): fest berechenbar).
uint32_t noise(uint32_t x) {
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    return x;
}

// Zweitsignal je Zustand (Farbe ist nie das einzige Signal, AC-P5-6): 7×7-Symbole, MSB links,
// Zeile oben. Gezeichnet in Augenfarbe oben rechts im Sprite-Bereich.
constexpr uint8_t kIconBits = 7;
constexpr uint8_t kIconCheck[kIconBits] = {0x00, 0x01, 0x02, 0x44, 0x28, 0x10, 0x00};
constexpr uint8_t kIconBang[kIconBits] = {0x08, 0x08, 0x08, 0x08, 0x08, 0x00, 0x08};
constexpr uint8_t kIconWarn[kIconBits] = {0x08, 0x14, 0x14, 0x22, 0x2a, 0x41, 0x7f};
constexpr uint8_t kIconCross[kIconBits] = {0x41, 0x22, 0x14, 0x08, 0x14, 0x22, 0x41};

const uint8_t* iconFor(NyxState s) {
    switch (s) {
        case NyxState::kSuccess:
            return kIconCheck;
        case NyxState::kApprovalPending:
            return kIconBang;
        case NyxState::kError:
            return kIconWarn;
        case NyxState::kOffline:
            return kIconCross;
        default:
            return nullptr;
    }
}

// Umlaufpunkte für den Ring um den Kopf (Executing): 8 Positionen, Radius 36 Canvas-Pixel.
constexpr int8_t kRing[8][2] = {{36, 0},  {25, 25},   {0, 36},  {-25, 25},
                                {-36, 0}, {-25, -25}, {0, -36}, {25, -25}};
constexpr uint32_t kRingStepMs = 90;
constexpr uint16_t kRingCx = 99, kRingCy = 42, kRingDot = 5;

void putRect(uint16_t* canvas, int x, int y, int w, int h, uint16_t px) {
    for (int yy = y; yy < y + h; ++yy) {
        if (yy < 0 || yy >= kSpriteH) continue;
        for (int xx = x; xx < x + w; ++xx) {
            if (xx >= 0 && xx < kCanvasW) canvas[yy * kCanvasW + xx] = px;
        }
    }
}

// Helligkeit eines Canvas-Pixels (Bytes vertauscht) in Promille skalieren.
uint16_t scalePx(uint16_t px, uint32_t permille) {
    const uint16_t c = static_cast<uint16_t>((px << 8) | (px >> 8));
    const uint32_t r = ((c >> 11) & 31) * permille / 1000;
    const uint32_t g = ((c >> 5) & 63) * permille / 1000;
    const uint32_t b = (c & 31) * permille / 1000;
    const uint16_t o = static_cast<uint16_t>((r << 11) | (g << 5) | b);
    return static_cast<uint16_t>((o << 8) | (o >> 8));
}

// Puls: Dreieckswelle in 100-ms-Stufen, 70 bis 100 %.
uint32_t pulsePermille(uint32_t step, uint32_t period_steps) {
    const uint32_t p = step % period_steps;
    const uint32_t half = period_steps / 2;
    const uint32_t up = p < half ? p : period_steps - p;
    return 700 + 300 * up / half;
}

constexpr uint32_t kPulseStepMs = 100;

}  // namespace

// --- SpriteStore -------------------------------------------------------------

bool SpriteStore::load(const uint8_t* blob, size_t len) {
    if (blob == nullptr || len < 12) return false;
    if (memcmp(blob, "NYX2", 4) != 0) return false;
    fw_ = blob[5] | (blob[6] << 8);
    fh_ = blob[7] | (blob[8] << 8);
    frames_ = blob[9] | (blob[10] << 8);
    palette_ = blob[11];
    if (fw_ == 0 || fh_ == 0 || frames_ == 0 || palette_ < 4 || palette_ > 16) return false;
    if (fw_ * kScale > kCanvasW || fh_ * kScale > kSpriteH) return false;
    const size_t meta_off = 12 + palette_ * 3;
    const size_t pixel_off = meta_off + static_cast<size_t>(frames_) * kMetaBytes;
    const size_t need = pixel_off + (static_cast<size_t>(fw_) * fh_ * frames_) / 2;
    if (len < need) return false;
    for (uint8_t i = 0; i < palette_; ++i) {
        const size_t p = 12 + i * 3;
        lut_[i] = rgb888to565(blob[p], blob[p + 1], blob[p + 2]);
    }
    lut_[0] = kBackgroundPx;  // Index 0 ist transparent: Nyx sitzt auf dem Void
    blob_ = blob;
    len_ = len;
    return true;
}

int SpriteStore::frameFor(NyxState state, uint8_t animation_index) const {
    if (blob_ == nullptr) return -1;
    const char* name = nyxStateName(state);
    const size_t meta_off = 12 + palette_ * 3;
    int first = -1;
    uint8_t count = 0;
    for (uint16_t f = 0; f < frames_; ++f) {
        const size_t m = meta_off + f * kMetaBytes;
        if (strncmp(reinterpret_cast<const char*>(blob_ + m), name, kNameBytes) == 0) {
            if (first < 0) first = static_cast<int>(f);
            ++count;
        }
    }
    if (first < 0) return -1;
    return first + (animation_index % count);
}

uint8_t SpriteStore::animationFrames(NyxState state) const {
    if (blob_ == nullptr) return 0;
    const char* name = nyxStateName(state);
    const size_t meta_off = 12 + palette_ * 3;
    uint8_t count = 0;
    for (uint16_t f = 0; f < frames_; ++f) {
        const size_t m = meta_off + f * kMetaBytes;
        if (strncmp(reinterpret_cast<const char*>(blob_ + m), name, kNameBytes) == 0) ++count;
    }
    return count;
}

uint16_t SpriteStore::frameDurationMs(int frame_idx) const {
    if (blob_ == nullptr || frame_idx < 0 || frame_idx >= frames_) return 0;
    const size_t meta_off = 12 + palette_ * 3;
    return static_cast<uint16_t>(
        blob_[meta_off + static_cast<size_t>(frame_idx) * kMetaBytes + kNameBytes + 1] * 10);
}

void SpriteStore::blit(uint16_t* canvas, int frame_idx, const EyeColors* eyes) const {
    if (blob_ == nullptr || frame_idx < 0 || frame_idx >= frames_) return;
    uint16_t lut[16];
    memcpy(lut, lut_, sizeof lut);
    if (eyes != nullptr && palette_ > 3) {
        lut[1] = eyes->core;
        lut[2] = eyes->mid;
        lut[3] = eyes->dim;
    }
    const size_t meta_off = 12 + palette_ * 3;
    const size_t pixel_off = meta_off + static_cast<size_t>(frames_) * kMetaBytes;
    for (uint16_t y = 0; y < fh_; ++y) {
        uint16_t* first_row = canvas + static_cast<size_t>(y) * kScale * kCanvasW;
        for (uint16_t x = 0; x < fw_; ++x) {
            const size_t byte =
                pixel_off + (static_cast<size_t>(frame_idx) * fw_ * fh_ + y * fw_ + x) / 2;
            const uint8_t idx = (x & 1) == 0 ? (blob_[byte] >> 4) : (blob_[byte] & 0x0f);
            const uint16_t color = lut[idx];
            for (uint16_t sx = 0; sx < kScale; ++sx) first_row[x * kScale + sx] = color;
        }
        // Ganzzahlige Skalierung: erste Zeile ×kScale spalten, dann Zeile kopieren
        for (uint16_t sy = 1; sy < kScale; ++sy) {
            memcpy(first_row + static_cast<size_t>(sy) * kCanvasW, first_row,
                   static_cast<size_t>(fw_) * kScale * sizeof(uint16_t));
        }
    }
}

// --- Glitch ------------------------------------------------------------------

void Glitch::begin(uint32_t now_ms) {
    start_ms_ = now_ms;
    active_ = true;
}

bool Glitch::apply(uint16_t* canvas, uint32_t now_ms, uint32_t seed) const {
    if (!active_) return false;
    const uint32_t t = now_ms - start_ms_;
    if (t >= 450) return false;  // 3 Phasen à 150 ms (spec: 3-Frame-Morph)
    const uint32_t phase = t / 150;
    for (uint16_t y = 0; y < kCanvasH; ++y) {
        // Zeilenversatz: deterministisch aus Zeile+Phase+Seed, Amplitude sinkt
        const uint32_t amp = (3 - phase) * 6;
        const uint32_t h = noise(seed + y * 31 + phase * 977);
        const int16_t shift = static_cast<int16_t>(h % (2 * amp + 1)) - static_cast<int16_t>(amp);
        if (shift == 0) continue;
        uint16_t row[kCanvasW];
        memcpy(row, canvas + y * kCanvasW, sizeof row);
        // Farbflackern in Phase 0: einzelne Zeilen ins Zustandskomplement (je Zeile konstant)
        const uint16_t flip = (phase == 0 && (noise(y + seed) & 7) == 0)
                                  ? 0xef7b
                                  : 0;  // 0x7bef mit vertauschten Bytes
        int32_t src = -static_cast<int32_t>(shift);
        if (src < 0) src += kCanvasW;
        if (src >= kCanvasW) src -= kCanvasW;
        uint16_t* dst = canvas + y * kCanvasW;
        for (uint16_t x = 0; x < kCanvasW; ++x) {
            dst[x] = row[src] ^ flip;
            if (++src == kCanvasW) src = 0;
        }
    }
    return true;
}

// --- Ticker ------------------------------------------------------------------

void Ticker::setText(const char* utf8_line1, const char* utf8_line2) {
    strncpy(line1_, utf8_line1 != nullptr ? utf8_line1 : "", sizeof line1_ - 1);
    line1_[sizeof line1_ - 1] = '\0';
    strncpy(line2_, utf8_line2 != nullptr ? utf8_line2 : "", sizeof line2_ - 1);
    line2_[sizeof line2_ - 1] = '\0';
    empty_ = line1_[0] == '\0' && line2_[0] == '\0';
}

void Ticker::clear() {
    line1_[0] = '\0';
    line2_[0] = '\0';
    empty_ = true;
}

void Ticker::draw(uint16_t* canvas, uint32_t now_ms, uint16_t color) const {
    if (empty_) return;
    const char* lines[2] = {line1_, line2_};
    const uint16_t base_y = kCanvasH - 22;
    for (uint8_t li = 0; li < 2; ++li) {
        const char* s = lines[li];
        // Scrollen, wenn die Zeile breiter ist als der Canvas (6 px/Zeichen)
        size_t chars = 0;
        for (size_t i = 0; s[i] != '\0';) {
            const uint8_t l = (s[i] & 0x80) == 0 ? 1 : (s[i] & 0xe0) == 0xc0 ? 2 : 3;
            i += l;
            ++chars;
        }
        const uint16_t max_cols = kCanvasW / kFontAdvance;
        int32_t scroll = 0;
        if (chars > max_cols) {
            scroll = -static_cast<int32_t>((now_ms / 250) % (chars - max_cols + 4));
        }
        int32_t col = scroll;
        for (size_t i = 0; s[i] != '\0';) {
            const uint8_t l = (s[i] & 0x80) == 0 ? 1 : (s[i] & 0xe0) == 0xc0 ? 2 : 3;
            const FontGlyph* g = bubbleGlyph(s + i, l);
            i += l;
            if (g == nullptr) continue;  // unbekannt: Lücke statt Absturz
            if (col >= static_cast<int32_t>(max_cols)) break;
            if (col >= 0) {
                for (uint8_t cx = 0; cx < 5; ++cx) {
                    for (uint8_t ry = 0; ry < 7; ++ry) {
                        if (g->cols[cx] & (1 << ry)) {
                            canvas[(base_y + li * 9 + ry) * kCanvasW + col * kFontAdvance + cx] =
                                color;
                        }
                    }
                }
            }
            ++col;
        }
    }
}

// --- Renderer ----------------------------------------------------------------

uint16_t Renderer::stateColor(NyxState s) {
    switch (s) {
        case NyxState::kIdle:
            return rgb888to565(0x7b, 0x2f, 0xbe);  // VOID_VIOLET
        case NyxState::kListening:
            return rgb888to565(0x00, 0xe5, 0xff);  // NEON_CYAN
        case NyxState::kApprovalPending:
            return rgb888to565(0xff, 0xb3, 0x00);  // ALERT_AMBER
        case NyxState::kExecuting:
            return rgb888to565(0x00, 0xe5, 0xff);
        case NyxState::kSuccess:
            return rgb888to565(0x00, 0xe5, 0xff);
        case NyxState::kError:
            return rgb888to565(0xff, 0x33, 0x55);  // ERROR_RED
        case NyxState::kOffline:
            return rgb888to565(0x1c, 0x1c, 0x26);  // VOID_GRAY
        default:
            return 0;
    }
}

EyeColors Renderer::eyeColors(NyxState s) {
    uint32_t rgb = 0;
    switch (s) {
        case NyxState::kIdle:
            rgb = 0xaf72ff;  // standby violett
            break;
        case NyxState::kListening:
        case NyxState::kExecuting:
            rgb = 0x45e4f7;  // cyan
            break;
        case NyxState::kApprovalPending:
            rgb = 0xff9f43;  // amber
            break;
        case NyxState::kSuccess:
            rgb = 0xffe38a;  // gold
            break;
        case NyxState::kError:
            rgb = 0xff526e;  // rot
            break;
        case NyxState::kOffline:
            rgb = 0x737185;  // grau
            break;
        default:
            rgb = 0xaf72ff;
            break;
    }
    const uint8_t r = rgb >> 16, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
    // mid/dim haben im Atlas 75 % bzw. 50 % der Marker-Helligkeit (#C000C0, #800080)
    return EyeColors{rgb888to565(r, g, b), rgb888to565(r * 3 / 4, g * 3 / 4, b * 3 / 4),
                     rgb888to565(r / 2, g / 2, b / 2)};
}

EyeColors Renderer::animatedEyes(NyxState s, uint32_t now_ms, uint8_t blink, uint16_t dark) {
    EyeColors e = eyeColors(s);
    if (s == NyxState::kListening) {
        const uint32_t k = pulsePermille(now_ms / kPulseStepMs, 8);  // Periode 800 ms
        e = EyeColors{scalePx(e.core, k), scalePx(e.mid, k), scalePx(e.dim, k)};
    } else if (s == NyxState::kApprovalPending) {
        const uint32_t k = pulsePermille(now_ms / kPulseStepMs, 6);  // wacher: 600 ms
        e = EyeColors{scalePx(e.core, k), scalePx(e.mid, k), scalePx(e.dim, k)};
    }
    if (blink == 1) return EyeColors{e.mid, e.dim, e.dim};
    if (blink >= 2) return EyeColors{dark, dark, dark};
    return e;
}

void Renderer::markAllDirty() {
    if (dirty_cb_ != nullptr) dirty_cb_(Rect{0, 0, kCanvasW, kCanvasH}, dirty_user_);
}

void Renderer::onStateChange(NyxState from, NyxState to, uint32_t now_ms) {
    (void)from;
    current_ = to;
    anim_frame_ = 0;
    dirty_ = true;
    last_anim_ms_ = now_ms;
    glitch_.begin(now_ms);
    markAllDirty();
}

bool Renderer::tick(uint32_t now_ms) {
    // Animations-Takt: Dauer je Frame aus dem Atlas (spec §5), 125 ms ohne Angabe
    uint16_t frame_ms = 0;
    if (store_ != nullptr)
        frame_ms = store_->frameDurationMs(store_->frameFor(current_, anim_frame_));
    if (frame_ms == 0) frame_ms = 125;
    if (now_ms - last_anim_ms_ >= frame_ms) {
        last_anim_ms_ = now_ms;
        const uint8_t n = store_ != nullptr ? store_->animationFrames(current_) : 1;
        anim_frame_ = (anim_frame_ + 1) % (n > 0 ? n : 1);
    }
    // Bildschlüssel: ändert sich nichts Sichtbares, wird weder gezeichnet noch gepusht.
    const uint8_t blink = idle_.blinkLevel(current_, now_ms);
    const bool pulses = current_ == NyxState::kListening || current_ == NyxState::kApprovalPending;
    const uint32_t pulse_step = pulses ? now_ms / kPulseStepMs : 0;
    const uint32_t ring_step = current_ == NyxState::kExecuting ? now_ms / kRingStepMs : 0;
    const uint32_t key =
        anim_frame_ | (blink << 8) | ((pulse_step & 0xff) << 10) | ((ring_step & 0xff) << 18);
    const bool glitch = glitch_.running(now_ms);
    if (!dirty_ && key == last_key_ && !glitch && !glitch_was_running_ && !ticker_.visible()) {
        return false;
    }
    dirty_ = false;
    last_key_ = key;
    glitch_was_running_ = glitch;
    // Tickerband gehört nicht zum Sprite-Blit: jedes Bild leeren, sonst bleibt Text stehen
    for (size_t i = static_cast<size_t>(kSpriteH) * kCanvasW;
         i < sizeof canvas_ / sizeof canvas_[0]; ++i)
        canvas_[i] = kBackgroundPx;
    if (store_ != nullptr) {
        const EyeColors eyes = animatedEyes(current_, now_ms, blink, store_->darkColor());
        store_->blit(canvas_, store_->frameFor(current_, anim_frame_), &eyes);
        drawSignals(eyes.core, ring_step);
    }
    glitch_.apply(canvas_, now_ms, static_cast<uint32_t>(current_) * 7919);
    ticker_.draw(canvas_, now_ms, stateColor(current_));
    markAllDirty();
    return true;
}

void Renderer::drawSignals(uint16_t color, uint32_t ring_step) {
    if (const uint8_t* icon = iconFor(current_)) {
        const int ox = kSpriteW - kIconBits * kScale - 6;
        for (uint8_t y = 0; y < kIconBits; ++y) {
            for (uint8_t x = 0; x < kIconBits; ++x) {
                if (icon[y] & (0x40 >> x))
                    putRect(canvas_, ox + x * kScale, 6 + y * kScale, kScale, kScale, color);
            }
        }
    }
    if (current_ == NyxState::kExecuting) {
        // Ring ohne Prozentwert: ein heller Punkt und drei Schleppen laufen um den Kopf.
        for (uint8_t t = 0; t < 4; ++t) {
            const uint8_t pos = static_cast<uint8_t>((ring_step + 8 - t) % 8);
            const uint16_t px =
                t == 0 ? color : scalePx(color, t == 1 ? 650 : (t == 2 ? 400 : 220));
            putRect(canvas_, kRingCx + kRing[pos][0] - kRingDot / 2,
                    kRingCy + kRing[pos][1] - kRingDot / 2, kRingDot, kRingDot, px);
        }
    }
}

// --- CanvasPusher -----------------------------------------------------------

void CanvasPusher::begin(void (*push)(const uint16_t*, uint16_t, uint16_t, uint16_t, uint16_t)) {
    push_ = push;
}

void CanvasPusher::update(const uint16_t* canvas, uint16_t x, uint16_t y, uint16_t h) {
    if (push_ == nullptr) return;
    if (!first_ && (x != last_x_ || y != last_y_)) {
        push_(nullptr, last_x_, last_y_, kCanvasW, kCanvasH);  // nullptr = löschen (schwarz)
    }
    push_(canvas, x, y, kCanvasW, h);
    last_x_ = x;
    last_y_ = y;
    first_ = false;
}

}  // namespace vw
