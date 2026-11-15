// EPIC-P2 T2.2: JSON-Subset-Scanner für NDJSON-Frames. Bewusst eigener,
// strikter Scanner statt Bibliothek: feste Puffer, keine dynamische Allokation
// im Parse-Pfad, hostfähig (native-Tests), und jedes nicht verstandene Zeichen
// ist ein zählbarer Protokollfehler statt stiller Überraschung (Fail loud).
// Unterstützt: Objekte (≤ 6 Ebenen), Strings mit Basis-Escapes, Zahlen
// (int/double), true/false/null, Arrays (nur als Wert übersprungen — Frame-
// Felder nutzen keine). Keine \u-Escapes: das Protokoll nutzt rohes UTF-8
// (ADR-0002); ein \u ist ein Protokollfehler.
#pragma once

#include <cstddef>
#include <cstdint>

namespace vw::json {

constexpr size_t kMaxTokens = 40;
constexpr size_t kMaxDepth = 6;

enum class ValueType { String, Int, Double, Bool, Null, Object, Array, Skipped };

struct Token {
    char key[24];     // Schlüsselkopie (Eigentum des Tokens — der Scanner-
                      // Stack stirbt mit scanLine, Zeiger wären dangling)
    const char* str;  // bei String: nullterminierter Zeiger ins Eingabepuffer-Fenster
    int32_t int_value;
    double double_value;
    bool bool_value;
    ValueType value_type;
    size_t depth;  // Objekttiefe (0 = Wurzel-Ebene)
};

struct ScanResult {
    // Flache Liste aller key/value-Paare; verschachtelte Objekte erscheinen als
    // depth>0-Einträge (z. B. payload.title). Reicht für alle Frame-Typen.
    Token tokens[kMaxTokens];
    size_t token_count;
    size_t unknown_count;  // nicht verstandene Konstrukte (gezählt, nie still)
    bool ok;
    const char* error;  // Fehlerstelle in Worten (statisch)
};

// Scannt eine Zeile (wird in-place mutiert: Strings werden terminiert).
// line muss nullterminiert sein und bleibt besitz des Aufrufers.
ScanResult scanLine(char* line, size_t line_len);

}  // namespace vw::json
