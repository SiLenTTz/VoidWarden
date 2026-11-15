// BUG-0005: Board-Erkennung für serial.path "auto" muss volle Linux-Pfade erkennen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isBoardPath } from "../src/serial-link.ts";

test("isBoardPath erkennt volle ttyUSB-/ttyACM-Pfade und blanke Namen", () => {
  assert.equal(isBoardPath("/dev/ttyUSB0"), true);
  assert.equal(isBoardPath("/dev/ttyACM12"), true);
  assert.equal(isBoardPath("ttyUSB1"), true);
});

test("isBoardPath weist Nicht-USB-Ports und Fremdnamen ab", () => {
  assert.equal(isBoardPath("/dev/ttyS0"), false);
  assert.equal(isBoardPath("/dev/ttyUSB"), false);
  assert.equal(isBoardPath("/dev/mytyUSB0"), false);
  assert.equal(isBoardPath(""), false);
});
