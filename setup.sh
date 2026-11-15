#!/usr/bin/env bash
# VoidWarden — One-Command-Setup (EPIC-P14 T14.3).
#
# Wizard von der Klon-Position zum erreichbaren Web-Kiosk — die empfohlene
# Anzeige ist ein altes Smartphone/Tablet (Touch-Freigaben + Sprachausgabe);
# das ESP32-Board ist eine rein anzeigende Status-Variante (Nutzervorgabe
# 11.11.2026). Gemeinsame Kaskade mit AncientVoid: zuerst Hub (AncientVoid
# ./setup.sh), dann dieser Wizard — ohne Hub failt er laut mit Kaskaden-
# hinweis, statt einen Kiosk auf totem Hub zu starten.
#
# Flags:  --yes                keine Rückfragen, Defaults
#         --hub-url=<u>        AncientVoid-Hub (Default http://127.0.0.1:7373)
#         --av-checkout=<p>    AncientVoid-Checkout für @ancientvoid/contracts
#                             (Default: Sibling ../AncientVoid)
#         --web-port=<n>       Kiosk-Port (Default 8791; anders, wenn dort
#                             schon ein Dienst läuft)
#         --no-web-build       web/dist nicht bauen
#         --check-board        Firmware-Werkzeug/Board prüfen (nur Warnung)
# Exit:   0 ok · 2 Voraussetzung/Hub fehlt · 3 Config kaputt ·
#         4 Companion-Start fehlgeschlagen · 5 npm install fehlgeschlagen
set -euo pipefail
cd "$(dirname "$0")"

HUB_URL="http://127.0.0.1:7373"; AV_CHECKOUT="$(cd .. && pwd)/AncientVoid"; YES=0; WEB_BUILD=1; BOARD=0; WEB_PORT=""
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    --hub-url=*) HUB_URL="${arg#*=}" ;;
    --av-checkout=*) AV_CHECKOUT="${arg#*=}" ;;
    --web-port=*) WEB_PORT="${arg#*=}" ;;
    --no-web-build) WEB_BUILD=0 ;;
    --check-board) BOARD=1 ;;
    *) echo "unbekannte Option: $arg (siehe Skript-Kopf)" >&2; exit 2 ;;
  esac
done

say()  { printf '\n== %s\n' "$*"; }
ask_secret() { # ask_secret <Datei> <Prompt> — Token in Datei Modus 600, kein Echo
  local __file="$1" __q="$2" __val=""
  if [ "$YES" = 1 ] || [ ! -t 0 ]; then return; fi
  read -r -s -p "$__q (eingeben, Enter; leer = später): " __val || true; echo
  [ -n "$__val" ] && printf '%s' "$__val" > "$__file" && chmod 600 "$__file"
}

# ---------------------------------------------------------------- 0 · Prüfungen
say "0/5 Voraussetzungen"
fail_req() { echo "FEHLT: $*" >&2; echo "Beheben und erneut ausführen — der Wizard ist idempotent." >&2; exit 2; }
command -v node >/dev/null || fail_req "Node.js (>= 22.5)"
NODE_VER="$(node --version 2>/dev/null || echo v0.0.0)"
NODE_MAJ="${NODE_VER#v}"; NODE_MAJ="${NODE_MAJ%%.*}"
NODE_MIN="${NODE_VER#v}"; NODE_MIN="${NODE_MIN#*.}"; NODE_MIN="${NODE_MIN%%.*}"
if [ "$NODE_MAJ" -lt 22 ] || { [ "$NODE_MAJ" = 22 ] && [ "$NODE_MIN" -lt 5 ]; }; then
  fail_req "Node >= 22.5 (gefunden: $NODE_VER)"
fi
command -v npm >/dev/null || fail_req "npm"
command -v git >/dev/null || fail_req "git"
command -v curl >/dev/null || fail_req "curl"
echo "ok: node $NODE_VER, npm $(npm --version)"

# ------------------------------------------------------- 1 · Hub (Kaskade!)
say "1/5 AncientVoid-Hub ($HUB_URL)"
# Nutzervorgabe aus dem Epic: Provider zuerst — das passiert im AncientVoid-
# Wizard. Hier gilt: ohne Hub kein Kiosk; laut failen statt Halbding starten.
if curl -sf -m 3 "$HUB_URL/api/health" >/dev/null 2>&1; then
  echo "ok: Hub antwortet ($(curl -sf -m 3 "$HUB_URL/api/health" | head -c 60)…)"
else
  echo "KEIN HUB: $HUB_URL/api/health antwortet nicht." >&2
  echo "Kaskade: zuerst im AncientVoid-Repo  ./setup.sh  (richtet Hub + ersten" >&2
  echo "Provider + Tokens ein; für VoidWarden dort  ./setup.sh --voidwarden )." >&2
  exit 2
fi

# ------------------------------------------------- 2 · contracts auflösen
say "2/5 @ancientvoid/contracts"
CONTRACTS="$AV_CHECKOUT/packages/contracts"
if [ -d "$CONTRACTS" ]; then
  echo "ok: $CONTRACTS"
else
  echo "FEHLT: $CONTRACTS nicht gefunden." >&2
  echo "  Die package.json verlangt file:../../AncientVoid/packages/contracts —" >&2
  echo "  VoidWarden muss neben einem AncientVoid-Checkout liegen, oder:" >&2
  echo "  ./setup.sh --av-checkout=/pfad/zum/AncientVoid-Checkout" >&2
  exit 2
fi

# ------------------------------------------------------------- 3 · installieren
say "3/5 npm install"
if [ ! -d node_modules ] || [ ! -d node_modules/@ancientvoid/contracts ]; then
  npm install || { echo "npm install fehlgeschlagen" >&2; exit 5; }
fi
# npm löst file:-Deps als Symlink — außerhalb der Sibling-Anordnung bricht das;
# der dokumentierte Fix (docs/operations.md §3) ist der manuelle Symlink.
if [ ! -e node_modules/@ancientvoid/contracts ]; then
  mkdir -p node_modules/@ancientvoid
  ln -sfn "$CONTRACTS" node_modules/@ancientvoid/contracts
  echo "Symlink gesetzt: node_modules/@ancientvoid/contracts -> $CONTRACTS"
fi
node -e "import('@ancientvoid/contracts').then(() => console.log('ok: contracts importierbar'), (e) => { console.error('contracts nicht importierbar:', e.message); process.exit(3) })"

# ---------------------------------------------------------------- 4 · Konfigurieren
say "4/5 voidwarden.config.json + Token"
if [ ! -f voidwarden.config.json ]; then
  node - "$HUB_URL" "$WEB_PORT" <<'EOF'
const fs = require("node:fs");
const cfg = JSON.parse(fs.readFileSync("voidwarden.config.example.json", "utf8"));
const [hubUrl, webPort] = [process.argv[2], process.argv[3] ? Number(process.argv[3]) : null];
cfg.hub = { ...cfg.hub, url: hubUrl };
if (webPort) cfg.web = { ...cfg.web, port: webPort };
fs.writeFileSync("voidwarden.config.json", JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
EOF
  echo "angelegt: voidwarden.config.json (git-ignored; Token nur als Datei-Pfad, Modus 600)"
else
  echo "bestehende voidwarden.config.json — nichts geändert"
fi
node -e 'JSON.parse(require("fs").readFileSync("voidwarden.config.json","utf8"))' || { echo "voidwarden.config.json ist kein gültiges JSON" >&2; exit 3; }
mkdir -p data
CFG_TOKEN="$(node -e 'process.stdout.write(require("./voidwarden.config.json").hub?.tokenFile ?? "data/display.token")')"
CFG_DECIDE="$(node -e 'process.stdout.write(require("./voidwarden.config.json").hub?.decideTokenFile ?? "")')"
if [ ! -s "$CFG_TOKEN" ]; then
  echo "Token-Datei $CFG_TOKEN fehlt/leer. Tokens entstehen auf der AncientVoid-Seite:"
  echo "  npm run hubctl -- token issue voidwarden --agent   # lesen (agent:voidwarden)"
  echo "  npm run hubctl -- token issue web-1 --display     # Freigaben (display:web-1)"
  ask_secret "$CFG_TOKEN" "agent:-Token jetzt einfügen"
  [ -s "$CFG_TOKEN" ] || echo "  → später einfügen und Wizard erneut laufen lassen (idempotent)."
fi
if [ -n "$CFG_DECIDE" ] && [ ! -s "$CFG_DECIDE" ]; then
  [ -e "$CFG_DECIDE" ] || { : > "$CFG_DECIDE"; chmod 600 "$CFG_DECIDE"; }
  ask_secret "$CFG_DECIDE" "display:-Token jetzt einfügen (Freigaben am Kiosk)"
  [ -s "$CFG_DECIDE" ] || echo "  → ohne display:-Token zeigt der Kiosk weiter alles an, Freigaben sind am Gerät aber nicht entscheidbar."
fi

# --------------------------------------------------------------- 5 · Kiosk + Start
if [ "$WEB_BUILD" = 1 ]; then
  say "5/5 Web-Kiosk bauen"; npm run web:build
else
  say "5/5 Web-Kiosk bauen — übersprungen (--no-web-build)"
fi
WEB_PORT_CFG="$(node -e 'process.stdout.write(String(require("./voidwarden.config.json").web?.port ?? 8791))')"
WEB_HOST_CFG="$(node -e 'process.stdout.write(require("./voidwarden.config.json").web?.host ?? "127.0.0.1")')"
say "5b/5 Companion starten"
# Ohne lesbares agent:-Token startet der Companion nicht — Ursache melden, bevor
# der Symptom-Fehler ("kommt nicht hoch") jemanden rätseln lässt.
if [ ! -s "$CFG_TOKEN" ]; then
  echo "TOKEN FEHLT: $CFG_TOKEN ist leer/fehlt — Companion-Start nicht möglich." >&2
  echo "Tokens entstehen im AncientVoid-Repo (Kaskade):" >&2
  echo "  npm run hubctl -- token issue voidwarden --agent --db data/hub.db" >&2
  echo "Token in die Datei $CFG_TOKEN schreiben (Modus 600), dann ./setup.sh erneut (idempotent)." >&2
  exit 4
fi
if curl -sf -m 2 "http://$WEB_HOST_CFG:$WEB_PORT_CFG/" >/dev/null 2>&1; then
  echo "auf Port $WEB_PORT_CFG läuft bereits ein Companion-Kiosk — verwende bestehenden (kein Start)"
elif systemctl --user cat voidwarden.service >/dev/null 2>&1 && [ "$WEB_PORT_CFG" = "8791" ]; then
  # Der Dienst gehört zum Standard-Port — nie einen zweiten auf 8791 starten.
  echo "systemd-Dienst voidwarden existiert — nicht doppelt starten."
  systemctl --user is-active --quiet voidwarden.service && echo "Dienst läuft bereits." || echo "Start: systemctl --user start voidwarden  (Betrieb: tools/service/install.sh)"
else
  if systemctl --user cat voidwarden.service >/dev/null 2>&1; then
    echo "Hinweis: systemd-Dienst läuft auf anderem Port — eigener Probelauf auf $WEB_PORT_CFG"
    echo "         (beide dürfen die Seriell-Schnittstelle nicht gleichzeitig offen halten)"
  fi
  setsid node companion/src/run.ts --config "$(pwd)/voidwarden.config.json" >> /tmp/voidwarden-setup.log 2>&1 < /dev/null &
  echo $! > /tmp/voidwarden-setup.pid
  up=0
  for _ in $(seq 1 40); do
    curl -sf -m 2 "http://$WEB_HOST_CFG:$WEB_PORT_CFG/" >/dev/null 2>&1 && { up=1; break; }; sleep 0.5
  done
  if [ "$up" = 1 ]; then
    echo "Companion läuft (Log: /tmp/voidwarden-setup.log, Stop: kill \$(cat /tmp/voidwarden-setup.pid))"
  else
    echo "Companion-Kiosk kommt nicht hoch — Log: /tmp/voidwarden-setup.log" >&2; exit 4
  fi
fi
if [ "$BOARD" = 1 ]; then
  say "Board-Check (optional — reine Statusanzeige)"
  command -v pio >/dev/null || echo "Hinweis: PlatformIO (pio) fehlt — Firmware-Flashen nicht möglich (Web-Kiosk läuft ohne)."
  command -v pio >/dev/null && echo "ok: pio $(pio --version 2>/dev/null | head -c 40)"
  ls /dev/ttyUSB* /dev/ttyACM* >/dev/null 2>&1 || echo "Hinweis: kein Seriell-Gerät (/dev/ttyUSB*|ttyACM*) — Board nicht angeschlossen."
  id -Gn | grep -qw uucp || echo "Hinweis: Nutzer nicht in Gruppe uucp — Seriell-Zugriff verweigert (sudo usermod -aG uucp \$USER, dann neu anmelden)."
fi

say "fertig"
echo "  Kiosk:      http://$WEB_HOST_CFG:$WEB_PORT_CFG  (Handy/Tablet im selben Netz:"
echo "              web.host auf 0.0.0.0 + web.optInAllInterfaces true — oder Tailscale)"
echo "  Board:      optional — Flashen und Kalibrieren: docs/operations.md §2"
echo "  Betrieb:    tools/service/install.sh (systemd-Dienst, Klon unter ~/.local/share)"
echo "  Diagnose:   npm run status · Skill setup-wizard · docs/operations.md §4"
