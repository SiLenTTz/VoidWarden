// Generiert von tools/assets/extract-web-pixelfont.mjs aus firmware/src/render/font5x7.h — nicht von Hand editieren.
// EPIC-P11 T11.7: 1:1-Pixelfont des Boards für den Web-Client. Kodierung wie Firmware:
// 5 Spaltenbytes je Glyphe, Bit y = Zeile y (LSB = Zeile 0 oben), kFontAdvance = 6.
export const FONT_W = 5;
export const FONT_H = 7;
export const FONT_ADVANCE = 6;

export interface PixGlyph {
  cp: string;
  cols: number[];
}

export const FONT5X7: readonly PixGlyph[] = [
  { cp: "A", cols: [120, 20, 20, 20, 120] }, // "A"
  { cp: "B", cols: [124, 84, 84, 84, 40] }, // "B"
  { cp: "C", cols: [56, 68, 68, 68, 68] }, // "C"
  { cp: "D", cols: [124, 68, 68, 68, 56] }, // "D"
  { cp: "E", cols: [124, 84, 84, 84, 68] }, // "E"
  { cp: "F", cols: [124, 20, 20, 20, 4] }, // "F"
  { cp: "G", cols: [56, 68, 68, 84, 116] }, // "G"
  { cp: "H", cols: [124, 16, 16, 16, 124] }, // "H"
  { cp: "I", cols: [68, 68, 124, 68, 68] }, // "I"
  { cp: "J", cols: [32, 64, 68, 60, 4] }, // "J"
  { cp: "K", cols: [124, 16, 16, 40, 68] }, // "K"
  { cp: "L", cols: [124, 64, 64, 64, 64] }, // "L"
  { cp: "M", cols: [124, 8, 16, 8, 124] }, // "M"
  { cp: "N", cols: [124, 8, 16, 32, 124] }, // "N"
  { cp: "O", cols: [56, 68, 68, 68, 56] }, // "O"
  { cp: "P", cols: [124, 20, 20, 20, 8] }, // "P"
  { cp: "Q", cols: [56, 68, 84, 36, 88] }, // "Q"
  { cp: "R", cols: [124, 20, 20, 52, 72] }, // "R"
  { cp: "S", cols: [72, 84, 84, 84, 36] }, // "S"
  { cp: "T", cols: [4, 4, 124, 4, 4] }, // "T"
  { cp: "U", cols: [60, 64, 64, 64, 60] }, // "U"
  { cp: "V", cols: [28, 32, 64, 32, 28] }, // "V"
  { cp: "W", cols: [124, 32, 16, 32, 124] }, // "W"
  { cp: "X", cols: [68, 40, 16, 40, 68] }, // "X"
  { cp: "Y", cols: [4, 8, 112, 8, 4] }, // "Y"
  { cp: "Z", cols: [68, 100, 84, 76, 68] }, // "Z"
  { cp: "Ä", cols: [120, 21, 20, 21, 120] }, // "Ä"
  { cp: "Ö", cols: [56, 69, 68, 69, 56] }, // "Ö"
  { cp: "Ü", cols: [60, 65, 64, 65, 60] }, // "Ü"
  { cp: "0", cols: [56, 100, 84, 76, 56] }, // "0"
  { cp: "1", cols: [0, 72, 124, 64, 0] }, // "1"
  { cp: "2", cols: [72, 100, 84, 84, 72] }, // "2"
  { cp: "3", cols: [68, 84, 84, 84, 40] }, // "3"
  { cp: "4", cols: [28, 16, 16, 124, 16] }, // "4"
  { cp: "5", cols: [92, 84, 84, 84, 36] }, // "5"
  { cp: "6", cols: [56, 84, 84, 84, 32] }, // "6"
  { cp: "7", cols: [4, 68, 36, 20, 12] }, // "7"
  { cp: "8", cols: [40, 84, 84, 84, 40] }, // "8"
  { cp: "9", cols: [8, 84, 84, 84, 56] }, // "9"
  { cp: ".", cols: [0, 64, 64, 0, 0] }, // "."
  { cp: ",", cols: [0, 96, 32, 0, 0] }, // ","
  { cp: ":", cols: [0, 40, 40, 0, 0] }, // ":"
  { cp: "!", cols: [0, 0, 60, 0, 0] }, // "!"
  { cp: "?", cols: [8, 4, 84, 20, 8] }, // "?"
  { cp: "-", cols: [16, 16, 16, 16, 16] }, // "-"
  { cp: "+", cols: [16, 16, 56, 16, 16] }, // "+"
  { cp: "/", cols: [64, 32, 16, 8, 4] }, // "/"
  { cp: "(", cols: [0, 0, 56, 68, 0] }, // "("
  { cp: ")", cols: [0, 68, 56, 0, 0] }, // ")"
  { cp: "%", cols: [68, 32, 16, 8, 68] }, // "%"
  { cp: " ", cols: [0, 0, 0, 0, 0] }, // " "
  { cp: "ä", cols: [120, 21, 20, 21, 120] }, // "ä"
  { cp: "ö", cols: [56, 69, 68, 69, 56] }, // "ö"
  { cp: "ü", cols: [60, 65, 64, 65, 60] }, // "ü"
  { cp: "ß", cols: [120, 68, 84, 56, 0] }, // "ß"
];
