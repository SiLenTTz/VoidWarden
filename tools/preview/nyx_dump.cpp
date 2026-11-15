// Host-Vorschau (Dev-Werkzeug, kein Firmware-Code): rendert die Bilder aller Zustände
// mit dem echten SpriteStore und den Augenfarben des Renderers und schreibt sie als
// rohes RGB565 (Panel-Reihenfolge, Bytes vertauscht, kSpriteW×kSpriteH je Frame) nach stdout.
// Aufruf über scripts/preview-nyx.mjs; Ausgabe: erst "w h count", dann die Frames.
#include <cstdio>
#include <vector>

#include "protocol/frames.cpp"
#include "protocol/json_scanner.cpp"
#include "render/idle_life.cpp"
#include "render/renderer.cpp"
#include "state/state_machine.cpp"

int main(int argc, char** argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: nyx_dump nyx.spr\n");
        return 2;
    }
    FILE* f = fopen(argv[1], "rb");
    if (f == nullptr) {
        fprintf(stderr, "cannot open %s\n", argv[1]);
        return 2;
    }
    std::vector<uint8_t> blob;
    uint8_t buf[4096];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf, f)) > 0) blob.insert(blob.end(), buf, buf + n);
    fclose(f);

    vw::SpriteStore store;
    if (!store.load(blob.data(), blob.size())) {
        fprintf(stderr, "nyx.spr unlesbar (Format oder Maße)\n");
        return 1;
    }
    // Je Zustand ein echter Renderer (Atlas-Frames, Augenfarbe, Puls, Zweitsignal, Ring): nach dem
    // Glitch (500 ms) werden die nächsten `frames` gezeichneten Bilder ausgegeben.
    // Blinzeln fehlt hier absichtlich (Zeitplan zufällig, Seed fest, erste Lücke ≥ 4 s).
    for (int s = 0; s < 7; ++s) {
        const vw::NyxState st = static_cast<vw::NyxState>(s);
        const uint8_t frames = store.animationFrames(st);
        printf("%s %u %u\n", vw::nyxStateName(st), frames,
               frames > 0 ? store.frameDurationMs(store.frameFor(st, 0)) : 0);
        static vw::Renderer r;
        r = vw::Renderer();
        r.attachStore(&store);
        r.onStateChange(vw::NyxState::kIdle, st, 0);
        uint8_t out = 0;
        for (uint32_t t = 0; out < frames && t < 20000; t += 10) {
            if (r.tick(t) && t >= 500) {
                fwrite(r.canvas(), 2, static_cast<size_t>(vw::kSpriteW) * vw::kSpriteH, stdout);
                ++out;
            }
        }
        if (out != frames) {
            fprintf(stderr, "%s: nur %u von %u Bildern\n", vw::nyxStateName(st), out, frames);
            return 1;
        }
    }
    return 0;
}
