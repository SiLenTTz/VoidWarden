// EPIC-P0 T0.5 Stufe 8 (v2): W3-Messung mit LovyanGFX@1.2.0 (ADR-0003/OD-1).
// Board: Waveshare 3,5" 2432S028R-Derivat — ST7796 am HSPI SCK14/MISO12/MOSI13,
// CS15, DC2, RST nicht geführt (an EN), Backlight 21/25. Init-Sequenz und Pins
// im Messlauf 2026-11-03 §Stufe 6 belegt (Violettfüllung visuell bestätigt).
#include <Arduino.h>

#include <LovyanGFX.hpp>

class Disp : public lgfx::LGFX_Device {
    lgfx::Panel_ST7796 _panel{};
    lgfx::Bus_SPI _bus{};

public:
    Disp() {
        auto cfg = _bus.config();
        cfg.spi_host = HSPI_HOST;
        cfg.spi_mode = 0;
        cfg.freq_write = 40000000;
        cfg.freq_read = 16000000;
        cfg.pin_sclk = 14;
        cfg.pin_mosi = 13;
        cfg.pin_miso = 12;
        cfg.pin_dc = 2;
        _bus.config(cfg);
        _panel.setBus(&_bus);
        auto pcfg = _panel.config();
        pcfg.pin_cs = 15;
        pcfg.pin_rst = -1;
        pcfg.panel_width = 320;
        pcfg.panel_height = 480;
        pcfg.memory_width = 320;
        pcfg.memory_height = 480;
        pcfg.invert = true;
        pcfg.rgb_order = false;
        _panel.config(pcfg);
        setPanel(&_panel);
    }
};

namespace {
constexpr uint32_t kSerialBaud = 921600;
constexpr uint16_t SPR_W = 128, SPR_H = 192;
}  // namespace

void setup() {
    Serial.begin(kSerialBaud);
    Serial.println("[s8] boot");
    Serial.flush();
    delay(300);
    pinMode(21, OUTPUT);
    digitalWrite(21, HIGH);
    pinMode(25, OUTPUT);
    digitalWrite(25, HIGH);

    static Disp display;
    Serial.println("[s8] vor init");
    Serial.flush();
    display.init();
    Serial.println("[s8] nach init");
    Serial.flush();
    display.setRotation(1);
    display.fillScreen(0x0204);

    static lgfx::LGFX_Sprite spr(&display);
    spr.setColorDepth(16);
    spr.createSprite(SPR_W, SPR_H);
    spr.fillSprite(0x0204);
    spr.fillEllipse(64, 80, 42, 70, 0x39E7);
    spr.fillEllipse(48, 52, 5, 4, 0xB9DF);
    spr.fillEllipse(80, 52, 5, 4, 0xB9DF);
    spr.fillCircle(64, 122, 8, 0x07FF);

    auto measure = [&](const char* label, uint8_t rotation) {
        display.setRotation(rotation);
        const uint16_t sw = rotation == 0 ? 320u : 480u;
        const uint16_t sh = rotation == 0 ? 480u : 320u;
        display.fillScreen(0x0204);
        const int steps = 30;
        uint32_t sum = 0, mx = 0, frames = 0;
        uint16_t last_x = 0, last_y = 0;
        for (int round = 0; round < 4; ++round) {
            for (int i = 0; i < steps; ++i) {
                const uint16_t x = (sw - SPR_W) * i / (steps - 1);
                const uint16_t y = (sh - SPR_H) * i / (steps - 1);
                const uint32_t t0 = micros();
                // Loeschen per fillRect (DMA-FastPath) statt Transparent-Push
                display.fillRect(last_x, last_y, SPR_W, SPR_H, 0x0204);
                spr.pushSprite(x, y);
                const uint32_t dt = micros() - t0;
                last_x = x;
                last_y = y;
                sum += dt;
                if (dt < 10000000UL && dt > mx) mx = dt;
                ++frames;
            }
        }
        Serial.printf("[s8] %s: frames=%lu mittel=%.2f ms (%.1f fps) max=%lu us\n", label,
                      static_cast<unsigned long>(frames), sum / 1000.0f / frames,
                      1000.0f * frames / (sum / 1000.0f), static_cast<unsigned long>(mx));
    };
    measure("rot0_portrait", 0);
    measure("rot1_landscape", 1);
    measure("rot3_landscape", 3);
    display.setRotation(1);
    spr.pushSprite((480 - SPR_W) / 2, (320 - SPR_H) / 2);
    Serial.println("[s8] done — Nyx grüßt");
}

void loop() { delay(10000); }
