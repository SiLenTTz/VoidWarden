// EPIC-P2 T2.2: Implementierung des JSON-Subset-Scanners (siehe Header für
// die bewussten Grenzen). Kein Arduino, kein new/malloc. Explizite
// Zustandsmaschine: nach '{' Schlüssel (oder '}'), nach ':' Wert, nach Wert
// ',' oder '}' — String-Werte und String-Schlüssel sind dadurch eindeutig.
#include "json_scanner.h"

#include <cstdlib>
#include <cstring>

namespace vw::json {
namespace {

constexpr size_t kKeyLen = 24;

struct Cursor {
    char* p;
    char* end;
    size_t unknown = 0;
    const char* error = nullptr;
};

bool isWs(char c) { return c == ' ' || c == '\t' || c == '\r'; }

// Parst einen String ab der öffnenden Anführung und terminiert ihn in-place.
char* parseString(Cursor& c) {
    ++c.p;  // über "
    char* out = c.p;
    char* write = c.p;
    while (c.p < c.end) {
        char ch = *c.p;
        if (ch == '"') {
            *write = '\0';
            ++c.p;
            return out;
        }
        if (ch == '\\') {
            ++c.p;
            if (c.p >= c.end) {
                c.error = "Escape am Zeilenende";
                return nullptr;
            }
            char esc = *c.p;
            switch (esc) {
                case '"':
                    *write++ = '"';
                    ++c.p;
                    break;
                case '\\':
                    *write++ = '\\';
                    ++c.p;
                    break;
                case '/':
                    *write++ = '/';
                    ++c.p;
                    break;
                case 'n':
                    *write++ = '\n';
                    ++c.p;
                    break;
                case 't':
                    *write++ = '\t';
                    ++c.p;
                    break;
                case 'r':
                    *write++ = '\r';
                    ++c.p;
                    break;
                case 'b':
                    *write++ = '\b';
                    ++c.p;
                    break;
                case 'f':
                    *write++ = '\f';
                    ++c.p;
                    break;
                default:
                    // \u und alles Unbekannte: Protokollfehler — das Protokoll
                    // nutzt rohes UTF-8 (ADR-0002), keine \u-Escapes.
                    c.error = "unbekanntes String-Escape";
                    return nullptr;
            }
            continue;
        }
        if (static_cast<unsigned char>(ch) < 0x20) {
            c.error = "Steuerzeichen im String";
            return nullptr;
        }
        *write++ = ch;
        ++c.p;
    }
    c.error = "String nicht terminiert";
    return nullptr;
}

}  // namespace

ScanResult scanLine(char* line, size_t line_len) {
    ScanResult res{};
    res.ok = false;
    if (line == nullptr || line_len == 0) {
        res.error = "leere Zeile";
        return res;
    }
    Cursor c{line, line + line_len};

    // Verschachtelung: pro Ebene der zuletzt gesehene Schlüssel (für flache
    // key-Pfade wie payload.title) und ein "offenes Werteschlüssel"-Flag.
    struct Level {
        char key[kKeyLen];
        bool key_seen;
    };
    Level levels[kMaxDepth + 1] = {};
    size_t depth = 0;

    enum class State { KeyOrEnd, Value, AfterValue };
    State state = State::KeyOrEnd;

    auto addToken = [&](const char* key, size_t d) -> Token* {
        if (res.token_count >= kMaxTokens) {
            c.error = "zu viele Tokens";
            return nullptr;
        }
        Token& t = res.tokens[res.token_count++];
        strncpy(t.key, key, sizeof t.key - 1);
        t.key[sizeof t.key - 1] = '\0';
        t.depth = d;
        t.str = nullptr;
        t.int_value = 0;
        t.double_value = 0;
        t.bool_value = false;
        t.value_type = ValueType::Null;
        return &t;
    };

    if (*c.p != '{') {
        res.error = "Zeile ist kein JSON-Objekt";
        return res;
    }
    ++c.p;

    while (c.p < c.end) {
        while (c.p < c.end && isWs(*c.p)) ++c.p;
        if (c.p >= c.end) break;
        char ch = *c.p;

        if (ch == '}') {
            ++c.p;
            if (depth == 0) {
                // Wurzel-Objekt zu — nur noch Whitespace erlaubt
                while (c.p < c.end && isWs(*c.p)) ++c.p;
                if (c.p != c.end) {
                    res.error = "Inhalt nach Objektende";
                    return res;
                }
                res.unknown_count = c.unknown;
                res.ok = true;
                return res;
            }
            --depth;
            state = State::AfterValue;
            continue;
        }
        if (ch == ',') {
            if (state != State::AfterValue) {
                res.error = "Komma an falscher Stelle";
                return res;
            }
            ++c.p;
            state = State::KeyOrEnd;
            continue;
        }

        if (state == State::KeyOrEnd) {
            if (ch != '"') {
                res.error = "Schlüssel (String) erwartet";
                return res;
            }
            char* key = parseString(c);
            if (key == nullptr) {
                res.error = c.error;
                return res;
            }
            while (c.p < c.end && isWs(*c.p)) ++c.p;
            if (c.p >= c.end || *c.p != ':') {
                res.error = "Doppelpunkt erwartet";
                return res;
            }
            ++c.p;
            strncpy(levels[depth].key, key, kKeyLen - 1);
            levels[depth].key[kKeyLen - 1] = '\0';
            levels[depth].key_seen = true;
            state = State::Value;
            continue;
        }

        // state == Value
        if (ch == '{') {
            if (depth + 1 > kMaxDepth) {
                res.error = "zu tiefe Verschachtelung";
                return res;
            }
            Token* t = addToken(levels[depth].key, depth);
            if (t != nullptr) t->value_type = ValueType::Object;
            ++depth;
            ++c.p;
            state = State::KeyOrEnd;
            continue;
        }
        if (ch == '"') {
            char* s = parseString(c);
            if (s == nullptr) {
                res.error = c.error;
                return res;
            }
            Token* t = addToken(levels[depth].key, depth);
            if (t != nullptr) {
                t->value_type = ValueType::String;
                t->str = s;
            }
            state = State::AfterValue;
            continue;
        }
        if (ch == '[') {
            // Arrays kommen in Frames nicht vor: Inhalt überspringen, zählen.
            size_t bracket = 1;
            ++c.p;
            while (c.p < c.end && bracket > 0) {
                if (*c.p == '[') ++bracket;
                if (*c.p == ']') --bracket;
                ++c.p;
            }
            if (bracket != 0) {
                res.error = "Array nicht terminiert";
                return res;
            }
            ++c.unknown;
            state = State::AfterValue;
            continue;
        }
        if ((ch >= '0' && ch <= '9') || ch == '-') {
            char* num_end = nullptr;
            const long long iv = strtoll(c.p, &num_end, 10);
            if (num_end == c.p) {
                res.error = "Zahl unlesbar";
                return res;
            }
            bool is_double = false;
            if (num_end < c.end && (*num_end == '.' || *num_end == 'e' || *num_end == 'E')) {
                is_double = true;
                strtod(c.p, &num_end);  // Ende der kompletten Gleitzahl
                if (num_end == c.p) {
                    res.error = "Gleitzahl unlesbar";
                    return res;
                }
            }
            Token* t = addToken(levels[depth].key, depth);
            if (t == nullptr) {
                res.error = "zu viele Tokens";
                return res;
            }
            if (is_double) {
                t->value_type = ValueType::Double;
                t->double_value = strtod(c.p, nullptr);
            } else {
                t->value_type = ValueType::Int;
                t->int_value = static_cast<int32_t>(iv);
            }
            c.p = num_end;
            state = State::AfterValue;
            continue;
        }
        if (strncmp(c.p, "true", 4) == 0) {
            Token* t = addToken(levels[depth].key, depth);
            if (t != nullptr) {
                t->value_type = ValueType::Bool;
                t->bool_value = true;
            }
            c.p += 4;
            state = State::AfterValue;
            continue;
        }
        if (strncmp(c.p, "false", 5) == 0) {
            Token* t = addToken(levels[depth].key, depth);
            if (t != nullptr) {
                t->value_type = ValueType::Bool;
                t->bool_value = false;
            }
            c.p += 5;
            state = State::AfterValue;
            continue;
        }
        if (strncmp(c.p, "null", 4) == 0) {
            Token* t = addToken(levels[depth].key, depth);
            if (t != nullptr) t->value_type = ValueType::Null;
            c.p += 4;
            state = State::AfterValue;
            continue;
        }
        res.error = "unerwartetes Zeichen im Wert";
        return res;
    }
    res.error = "unerwartetes Zeilenende";
    return res;
}

}  // namespace vw::json
