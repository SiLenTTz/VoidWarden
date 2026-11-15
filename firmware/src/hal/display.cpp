#include "display.h"

#include <Arduino.h>

namespace vw {

Display::Display() {
    auto cfg = _bus.config();
    cfg.spi_host = HSPI_HOST;
    cfg.spi_mode = 0;
    cfg.spi_3wire = false;  // Das Board führt MISO separat auf GPIO12.
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
    pcfg.panel_width = 240;
    pcfg.panel_height = 320;
    pcfg.memory_width = 240;
    pcfg.memory_height = 320;
    pcfg.invert = false;
    pcfg.rgb_order = false;
    _panel.config(pcfg);
    setPanel(&_panel);

    // Touch: XPT2046 am eigenen Bus (T3.8; Ruhewerte im Probe-Lauf konsistent, Berührung steht
    // aus). pin_int bleibt unbenutzt, die Berührung wird über den Druck erkannt.
    auto tcfg = _touch.config();
    tcfg.spi_host = VSPI_HOST;
    tcfg.freq = 1000000;
    tcfg.pin_sclk = 25;
    tcfg.pin_mosi = 32;
    tcfg.pin_miso = 39;
    tcfg.pin_cs = 33;
    tcfg.pin_int = -1;
    tcfg.bus_shared = false;
    _touch.config(tcfg);
    _panel.setTouch(&_touch);
}

void Display::backlightOn() {
    pinMode(21, OUTPUT);
    digitalWrite(21, HIGH);
}

void Display::setBacklight(uint8_t level) {
    static bool attached = false;
    if (!attached) {
        attached = ledcAttach(21, 5000, 8);
    }
    if (attached) {
        ledcWrite(21, level);
    }
}

}  // namespace vw
