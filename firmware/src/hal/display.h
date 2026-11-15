// EPIC-P2 T2.5 (Board): Display-HAL — LovyanGFX-Instanz für das identifizierte
// ESP32-2432S028R-Board (ILI9341 am HSPI 14/12/13, CS15, DC2, RST nicht
// geführt, BL21/25; BUG-0001 korrigiert die ST7796-Annahme). Nur diese Datei
// und hal/display.cpp includen LovyanGFX (architecture.md §2 Trennung).
#pragma once
#include <LovyanGFX.hpp>

namespace vw {

class Display : public lgfx::LGFX_Device {
    lgfx::Panel_ILI9341 _panel{};
    lgfx::Bus_SPI _bus{};
    lgfx::Touch_XPT2046 _touch{};

public:
    Display();

    /// Backlight sicher auf 'an' (GPIO21; GPIO25 ist der Touch-CLK und bleibt unberührt).
    static void backlightOn();

    /// Helligkeit 0–255 per PWM auf GPIO21 (T4.2); backlightOn() bleibt der sichere
    /// Start.
    static void setBacklight(uint8_t level);
};

}  // namespace vw
