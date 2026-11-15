// EPIC-P2 T2.6: Link-I/O der Firmware (Arduino-Seite, bewusst dünn): liest
// Zeilen mit festem Puffer, schreibt Zeilen. Alles Protokoll-Lastige liegt in
// protocol/ (hostfähig); hier nur Serial-Transport (architecture.md §2).
#pragma once

#include <cstddef>
#include <cstdint>

namespace vw {

/// Zeilenleser über read()-Callback (testbar mit Pufferfakes). Kein Arduino-
/// Include — die readCallback kapselt Serial.read.
class LineReader {
public:
    static constexpr size_t kMaxLine = 512;  // K5

    /// Liefert true, wenn eine vollständige Zeile (ohne \n) vorliegt.
    /// len_out = Byte-Länge; Zeile bleibt bis zum nächsten nächsten Aufruf gültig.
    bool feed(int (*read_byte)(void*), void* ctx, char** line_out, size_t* len_out);

    /// Überlange Zeile ohne \n: wird verworfen und gezählt (rx_overrun).
    uint32_t overruns() const { return overruns_; }

private:
    char buf_[kMaxLine + 1];
    size_t fill_ = 0;
    bool overrun_ = false;
    uint32_t overruns_ = 0;
};

}  // namespace vw
