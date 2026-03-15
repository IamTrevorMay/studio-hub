#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "╔══════════════════════════════════════════════════╗"
echo "║     Git → Obsidian Sync — Setup                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# 1. Install dependencies
echo "→ Installing dependencies..."
cd "$SCRIPT_DIR"
npm install

# 2. Create .env if missing
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo ""
  echo "→ No .env file found. Let's create one."
  read -p "  Enter your Anthropic API key: " API_KEY
  read -p "  Poll interval in seconds [60]: " POLL
  POLL=${POLL:-60}
  read -p "  Port [3456]: " PORT
  PORT=${PORT:-3456}

  cat > "$SCRIPT_DIR/.env" <<EOF
ANTHROPIC_API_KEY=${API_KEY}
POLL_INTERVAL_SECONDS=${POLL}
PORT=${PORT}
EOF
  echo "  .env created!"
else
  echo "→ .env already exists, skipping."
fi

echo ""
echo "→ Setup complete!"
echo ""
echo "  To run manually:        cd $SCRIPT_DIR && npm start"
echo "  To run as a service:    See below"
echo ""

# 3. Offer to install as a system service
OS="$(uname)"
if [ "$OS" = "Darwin" ]; then
  echo "═══ macOS: Install as Launch Agent (auto-start on login) ═══"
  echo ""
  PLIST_PATH="$HOME/Library/LaunchAgents/com.git-obsidian-sync.plist"
  NODE_PATH="$(which node)"

  read -p "Install as macOS Launch Agent? [y/N]: " INSTALL_SERVICE
  if [ "$INSTALL_SERVICE" = "y" ] || [ "$INSTALL_SERVICE" = "Y" ]; then
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.git-obsidian-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${SCRIPT_DIR}/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${SCRIPT_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${SCRIPT_DIR}/logs/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${SCRIPT_DIR}/logs/stderr.log</string>
</dict>
</plist>
EOF
    mkdir -p "$SCRIPT_DIR/logs"
    launchctl load "$PLIST_PATH" 2>/dev/null || true
    launchctl start com.git-obsidian-sync 2>/dev/null || true
    echo "  Installed and started! It will auto-launch on login."
    echo "  Stop:    launchctl stop com.git-obsidian-sync"
    echo "  Remove:  launchctl unload $PLIST_PATH && rm $PLIST_PATH"
    echo "  Logs:    $SCRIPT_DIR/logs/"
  fi

elif [ "$OS" = "Linux" ]; then
  echo "═══ Linux: Install as systemd user service ═══"
  echo ""
  SERVICE_DIR="$HOME/.config/systemd/user"
  SERVICE_PATH="$SERVICE_DIR/git-obsidian-sync.service"
  NODE_PATH="$(which node)"

  read -p "Install as systemd user service? [y/N]: " INSTALL_SERVICE
  if [ "$INSTALL_SERVICE" = "y" ] || [ "$INSTALL_SERVICE" = "Y" ]; then
    mkdir -p "$SERVICE_DIR"
    cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=Git to Obsidian Sync
After=network.target

[Service]
Type=simple
ExecStart=${NODE_PATH} ${SCRIPT_DIR}/server.js
WorkingDirectory=${SCRIPT_DIR}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable git-obsidian-sync
    systemctl --user start git-obsidian-sync
    echo "  Installed and started!"
    echo "  Status:  systemctl --user status git-obsidian-sync"
    echo "  Logs:    journalctl --user -u git-obsidian-sync -f"
    echo "  Stop:    systemctl --user stop git-obsidian-sync"
    echo "  Remove:  systemctl --user disable git-obsidian-sync && rm $SERVICE_PATH"
  fi
fi

echo ""
echo "Done! Open http://localhost:${PORT:-3456} to manage your projects."
