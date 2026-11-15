// EPIC-P3 T3.8: Touch-Probe ohne LovyanGFX — liest einen XPT2046 am eigenen SPI-Bus
// (Hypothese: CLK25 MOSI32 MISO39 CS33 IRQ36) roh aus und druckt Zeilen "T x y z1 z2 irq".
// Ohne Berührung sind z1≈0 und irq=1; eine Berührung hebt z1 und senkt irq. Kein Controller
// liefert dagegen konstant 0x000/0xFFF. Nur Diagnose, nicht Teil der Produktfirmware.
#include <Arduino.h>
#include <SPI.h>

namespace {
constexpr int kClk = 25, kMosi = 32, kMiso = 39, kCs = 33, kIrq = 36;
SPIClass g_spi(VSPI);

uint16_t readCmd(uint8_t cmd) {
    g_spi.transfer(cmd);
    const uint8_t hi = g_spi.transfer(0);
    const uint8_t lo = g_spi.transfer(0);
    return ((hi << 8) | lo) >> 3;  // 12 Bit
}
}  // namespace

void setup() {
    Serial.begin(921600);
    pinMode(kCs, OUTPUT);
    digitalWrite(kCs, HIGH);
    pinMode(kIrq, INPUT);
    g_spi.begin(kClk, kMiso, kMosi, kCs);
    Serial.println("\ntouchprobe start");
}

void loop() {
    g_spi.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
    digitalWrite(kCs, LOW);
    const uint16_t z1 = readCmd(0xB1);
    const uint16_t z2 = readCmd(0xC1);
    const uint16_t x = readCmd(0xD1);
    const uint16_t y = readCmd(0x91);
    readCmd(0x90);  // Power-down
    digitalWrite(kCs, HIGH);
    g_spi.endTransaction();
    Serial.printf("T %u %u %u %u %d\n", x, y, z1, z2, digitalRead(kIrq));
    delay(100);
}
