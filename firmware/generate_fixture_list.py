#!/usr/bin/env python
# EPIC-P0 T0.4: erzeugt firmware/test/fixtures.list.h aus protocol/fixtures/
# (einzige Quelle der Wahrheit — dieselben Dateien wie im Node-Contract-Test).
import os
from pathlib import Path

Import("env")  # noqa: F821 (PlatformIO)

fw_dir = Path(env["PROJECT_DIR"])          # firmware/
fixtures = fw_dir.parent / "protocol" / "fixtures"
names = sorted(p.name for p in fixtures.glob("*.ndjson"))

lines = ",\n".join(f'    "{n}"' for n in names)
header = (
    "// Generiert von firmware/generate_fixture_list.py — nicht von Hand editieren.\n"
    f"#define FIXTURE_COUNT {len(names)}\n"
    f"static const char* FIXTURE_NAMES[] = {{\n{lines},\n}};\n"
)
out = fw_dir / "test" / "fixtures.list.h"
out.write_text(header, encoding="utf-8")
assert len(names) > 0, "keine Fixtures gefunden — Contract-Check kann nicht laufen"
