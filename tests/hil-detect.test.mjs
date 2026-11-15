// Board-Erkennung für test:hil (EPIC-P2 T2.8): reine Auswahl, ohne Hardware.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickBoard } from "../scripts/hil/detect.mjs";

test("pickBoard: ttyUSB und ttyACM werden erkannt, andere Geräte ignoriert", () => {
  const { path, all } = pickBoard([
    { dir: "/dev", name: "tty" },
    { dir: "/dev", name: "ttyS0" },
    { dir: "/dev", name: "ttyUSB0" },
    { dir: "/dev", name: "ttyACM1" },
    { dir: "/dev", name: "ttyUSBx" },
  ]);
  assert.equal(path, "/dev/ttyUSB0");
  assert.deepEqual(all, ["/dev/ttyUSB0", "/dev/ttyACM1"]);
});

test("pickBoard: kein passendes Gerät → null (der Aufrufer meldet SKIP)", () => {
  assert.deepEqual(pickBoard([{ dir: "/dev", name: "ttyS0" }]), { path: null, all: [] });
  assert.deepEqual(pickBoard([]), { path: null, all: [] });
});

test("pickBoard: mehrere Treffer bleiben sichtbar, nicht still gewählt", () => {
  const { path, all } = pickBoard([
    { dir: "/dev", name: "ttyUSB1" },
    { dir: "/dev", name: "ttyUSB0" },
  ]);
  assert.equal(path, "/dev/ttyUSB1", "Eingabereihenfolge entscheidet, die Liste bleibt sichtbar");
  assert.equal(all.length, 2);
});
