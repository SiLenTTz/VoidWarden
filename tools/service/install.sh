#!/usr/bin/env bash
# Richtet den Companion als systemd-User-Dienst ein (docs/operations.md §3). Läuft ohne root;
# was root braucht (udev-Regel, Lingering), gibt das Skript am Ende als Befehle aus.
#
#   HUB_TOKEN_FILE=/pfad/agent-token.txt DECIDE_TOKEN_FILE=/pfad/display-token.txt \
#   AV_CONTRACTS=/pfad/AncientVoid/packages/contracts tools/service/install.sh
#
# Token-Inhalte werden nie gelesen oder gedruckt, nur die Pfade landen in der Config.
set -euo pipefail

: "${HUB_TOKEN_FILE:?Pfad zur agent:voidwarden-Token-Datei fehlt}"
: "${DECIDE_TOKEN_FILE:?Pfad zur display-Token-Datei fehlt}"
: "${AV_CONTRACTS:?Pfad zu AncientVoid/packages/contracts fehlt}"
HUB_URL="${HUB_URL:-http://127.0.0.1:7373}"
REMOTE="${VW_REMOTE:-$(git -C "$(dirname "$0")/../.." remote get-url origin)}"
DEST="${VW_DEST:-$HOME/.local/share/voidwarden}"
NODE="${VW_NODE:-$(command -v node)}"
HERE="$(cd "$(dirname "$0")" && pwd)"

for f in "$HUB_TOKEN_FILE" "$DECIDE_TOKEN_FILE"; do [ -r "$f" ] || { echo "Token-Datei nicht lesbar: $f" >&2; exit 1; }; done
[ -d "$AV_CONTRACTS" ] || { echo "AncientVoid-Contracts fehlen: $AV_CONTRACTS" >&2; exit 1; }

if [ -d "$DEST/.git" ]; then git -C "$DEST" pull --ff-only; else git clone "$REMOTE" "$DEST"; fi
(cd "$DEST" && npm ci --silent)
# file:-Abhängigkeit mit relativem Pfad löst sich außerhalb von arbeitsbaeume/ nicht auf
mkdir -p "$DEST/node_modules/@ancientvoid"
ln -sfn "$AV_CONTRACTS" "$DEST/node_modules/@ancientvoid/contracts"

mkdir -p "$HOME/.config/voidwarden" "$HOME/.config/systemd/user"
CFG="$HOME/.config/voidwarden/config.json"
"$NODE" -e '
const fs = require("fs");
const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
c.hub.url = process.argv[4];
c.hub.tokenFile = process.argv[2];
c.hub.decideTokenFile = process.argv[3];
fs.writeFileSync(process.argv[5], JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
' "$DEST/voidwarden.config.example.json" "$HUB_TOKEN_FILE" "$DECIDE_TOKEN_FILE" "$HUB_URL" "$CFG"

cat > "$HOME/.config/systemd/user/voidwarden.service" <<UNIT
[Unit]
Description=VoidWarden Companion
After=network-online.target

[Service]
WorkingDirectory=$DEST
Environment=VOIDWARDEN_SOCK=%t/voidwarden.sock
# Kein SupplementaryGroups in User-Units, kein sg: newgrp holt uucp, solange die Sitzung die Gruppe nicht kennt.
ExecStart=/bin/sh -c 'echo "exec $NODE companion/src/run.ts --config $CFG" | /usr/bin/newgrp uucp'
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now voidwarden
sleep 5
systemctl --user is-active voidwarden

cat <<MSG

Noch von Hand (braucht root):
  sudo cp "$HERE/99-voidwarden.rules" /etc/udev/rules.d/ && sudo udevadm control --reload && sudo udevadm trigger
  sudo loginctl enable-linger $USER      # Dienst startet beim Boot ohne Login
Log: journalctl --user -u voidwarden -f
MSG
