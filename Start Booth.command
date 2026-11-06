#!/bin/bash
# Sign-Off Booth: double-click to start. Keep this Terminal window open for the whole event.
# Where clips are saved (this laptop, another folder or Google Drive for desktop, plus an optional USB backup) is chosen in the
# recorder under Settings > Where clips are saved. The server prints what it found. Closing this window stops the booth.
# Works in the booth folder (flat) and in the kit (Start Booth.command + app/ + brand/ + booth-settings.json; Node is used from runtime/ if you add it, otherwise the one installed on the computer).

ROOT="$(cd "$(dirname "$0")" && pwd)" || exit 1
cd "$ROOT" || exit 1
if [ -f "$ROOT/app/booth-server.js" ]; then APP="$ROOT/app"; else APP="$ROOT"; fi
export BOOTH_SETTINGS="$ROOT/booth-settings.json"

pause() { read -r -p "Press Return to close." _; }
echo "Sign-Off Booth"
echo "=============="

# files copied by AirDrop, USB stick or download arrive "quarantined" and may lose run permission
xattr -dr com.apple.quarantine "$ROOT" 2>/dev/null
chmod +x "$ROOT"/runtime/*/bin/node 2>/dev/null

# ---- Node: the copy inside this folder for this Mac's chip, else one installed on the Mac ----
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then ARCH=arm64; else ARCH=x64; fi
NODE="$ROOT/runtime/node-$ARCH/bin/node"
if [ ! -x "$NODE" ] || ! "$NODE" -v >/dev/null 2>&1; then
  [ -x "$NODE" ] && echo "The Node inside the runtime folder would not run on this Mac. Trying one installed on the Mac."
  NODE="$(command -v node)"
fi
if [ -z "$NODE" ] || ! "$NODE" -v >/dev/null 2>&1; then
  echo "No working Node found. Install Node 18 or newer from https://nodejs.org (the LTS version), then start the booth again."
  pause; exit 1
fi
echo "Node $("$NODE" -v) ($ARCH)"

# ---- settings (booth-settings.json > launcher): only the port and the browser. Where clips are saved is set in the recorder. ----
cfg() { "$NODE" -e 'try{var j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));var v=(j.launcher||{})[process.argv[2]];process.stdout.write(v==null?"":String(v))}catch(e){}' "$BOOTH_SETTINGS" "$1"; }
CHROME="$(cfg chromeApp)";          [ -z "$CHROME" ] && CHROME="Google Chrome"
PORT="${BOOTH_PORT:-$(cfg port)}";  [ -z "$PORT" ] && PORT=8080
export BOOTH_PORT="$PORT"

# ---- already running? open the check page instead of failing on a busy port ----
if curl -s -m 2 "http://localhost:$PORT/info" 2>/dev/null | grep -q '"key"'; then
  echo "The booth is already running on this Mac. Opening the check page."
  open -a "$CHROME" "http://localhost:$PORT/check" 2>/dev/null
  pause; exit 0
fi
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is used by another program. Close it, or change the port in booth-settings.json (launcher > port)."
  pause; exit 1
fi

if ! open -Ra "$CHROME" 2>/dev/null; then
  echo "WARNING: $CHROME is not installed. Install it from google.com/chrome, then start the booth again."
fi
echo

# keep the Mac awake while the booth runs (released when this window closes)
caffeinate -dimsu &
CAF=$!
trap 'kill $CAF 2>/dev/null' EXIT

# open the check page in Chrome once the server is up (it has a button to the recorder)
if [ -z "$BOOTH_NO_OPEN" ]; then
  ( for i in $(seq 1 30); do curl -s -m 1 "http://localhost:$PORT/info" >/dev/null 2>&1 && break; sleep 0.5; done
    open -a "$CHROME" "http://localhost:$PORT/check" ) &
fi

"$NODE" "$APP/booth-server.js"
echo
echo "The booth server has stopped."
pause
