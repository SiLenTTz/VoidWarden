// EPIC-P2 T2.6: LineReader — Implementierung (hostfähig, festes 512-B-Fenster).
#include "line_reader.h"

namespace vw {

bool LineReader::feed(int (*read_byte)(void*), void* ctx, char** line_out, size_t* len_out) {
    for (;;) {
        const int c = read_byte(ctx);
        if (c < 0) return false;  // nichts da
        if (c == '\n') {
            const bool was_overrun = overrun_;
            overrun_ = false;
            if (was_overrun) {
                // Überlange Zeile komplett verwerfen (K5: nie truncaten).
                fill_ = 0;
                continue;
            }
            buf_[fill_] = '\0';
            *line_out = buf_;
            *len_out = fill_;
            fill_ = 0;
            return true;
        }
        if (c == '\r') continue;  // CRLF tolerieren
        if (fill_ >= kMaxLine) {
            if (!overrun_) {
                overrun_ = true;
                overruns_ += 1;
            }
            continue;  // weiterlesen bis \n, dann verwerfen
        }
        buf_[fill_++] = static_cast<char>(c);
    }
}

}  // namespace vw
