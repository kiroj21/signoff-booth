#!/bin/bash
# Sign-Off Booth for Linux: run this file (right-click > Run as a Program, or "Run in Terminal"). Keep the window open all event.
# Same booth as the Mac one. Differences: no Google Drive app on Linux, so clips are saved on this laptop and rclone copies them
# to Drive (set up once, see the README, Linux section); USB sticks appear under /media; the laptop is kept awake with systemd-inhibit.
# Works in the booth folder (flat) and in the kit (this file + app/ + brand/ + booth-settings.json; Node is used from runtime/ if you add it, otherwise the one installed on the computer).

ROOT="$(cd "$(dirname "$0")" && pwd)" || exit 1
cd "$ROOT" || exit 1
if [ -f "$ROOT/app/booth-server.js" ]; then APP="$ROOT/app"; else APP="$ROOT"; fi
export BOOTH_SETTINGS="$ROOT/booth-settings.json"

pause() { read -r -p "Press Return to close." _; }
echo "Sign-Off Booth (Linux)"
echo "======================"

chmod +x "$ROOT"/runtime/*/bin/node 2>/dev/null

# ---- Node: the copy inside this folder for this computer's chip, else one installed on the computer ----
case "$(uname -m)" in
  x86_64|amd64) ARCH=linux-x64 ;;
  aarch64|arm64) ARCH=linux-arm64 ;;
  *) ARCH="" ;;
esac
NODE=""
[ -n "$ARCH" ] && NODE="$ROOT/runtime/node-$ARCH/bin/node"
if [ -z "$NODE" ] || [ ! -x "$NODE" ] || ! "$NODE" -v >/dev/null 2>&1; then
  [ -n "$NODE" ] && [ -x "$NODE" ] && echo "The Node inside the runtime folder would not run here. Trying one installed on the computer."
  NODE="$(command -v node)"
fi
if [ -z "$NODE" ] || ! "$NODE" -v >/dev/null 2>&1; then
  echo "No working Node found. Install Node 18 or newer from https://nodejs.org (the LTS version), then start the booth again."
  pause; exit 1
fi
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
if [ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
  echo "This Node is too old (version $("$NODE" -v)). The booth needs Node 18 or newer. Install Node 18 or newer from https://nodejs.org, then start again."
  pause; exit 1
fi
echo "Node $("$NODE" -v) ($(uname -m))"

# ---- settings (booth-settings.json): the port; where clips go is set in the recorder ----
cfg() { "$NODE" -e 'try{var j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));var o=j;process.argv[2].split(".").forEach(function(k){o=(o||{})[k]});process.stdout.write(o==null||typeof o==="object"?"":String(o))}catch(e){}' "$BOOTH_SETTINGS" "$1"; }
# first run on Linux: a Mac-made settings file points at Google Drive for desktop, which Linux does not have.
# Switch it once to "save on this laptop" + "upload with rclone" (nothing else in the file is touched).
"$NODE" -e 'var fs=require("fs"),f=process.argv[1];try{var j=JSON.parse(fs.readFileSync(f,"utf8"));var s=j.storage||{};if(!s.sync&&/^(My Drive|Shared drives)/.test(s.location||"My Drive")){s.location="local";s.sync={type:"rclone",remote:"boothdrive:",path:""};j.storage=s;fs.writeFileSync(f+".part",JSON.stringify(j,null,2)+"\n");fs.renameSync(f+".part",f);console.log("First run on Linux: clips are now saved on this laptop and uploaded to Google Drive with rclone.")}}catch(e){}' "$BOOTH_SETTINGS"
PORT="${BOOTH_PORT:-$(cfg launcher.port)}"; [ -z "$PORT" ] && PORT=8080
export BOOTH_PORT="$PORT"

# ---- Chrome (or Chromium): BOOTH_BROWSER can name one; otherwise the first that is installed ----
BROWSER=""
for b in "$BOOTH_BROWSER" google-chrome-stable google-chrome chromium chromium-browser; do
  [ -n "$b" ] && command -v "$b" >/dev/null 2>&1 && { BROWSER="$(command -v "$b")"; break; }
done
open_page() { if [ -n "$BROWSER" ]; then nohup "$BROWSER" "$1" >/dev/null 2>&1 & else xdg-open "$1" >/dev/null 2>&1 & fi; }

# ---- already running? open the check page instead of failing on a busy port ----
if curl -s -m 2 "http://localhost:$PORT/info" 2>/dev/null | grep -q '"key"'; then
  echo "The booth is already running on this computer. Opening the check page."
  open_page "http://localhost:$PORT/check"
  pause; exit 0
fi
if { ss -ltn 2>/dev/null | grep -q ":$PORT "; } || { command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; }; then
  echo "Port $PORT is used by another program. Close it, or change the port in booth-settings.json (launcher > port)."
  pause; exit 1
fi

# ---- things that commonly go wrong on Linux: say so now, in plain words ----
if [ -z "$BROWSER" ]; then
  echo "WARNING: Google Chrome or Chromium was not found. Install Google Chrome (google.com/chrome), then start the booth again."
fi
if ! id -nG 2>/dev/null | tr ' ' '\n' | grep -qx video; then
  echo "WARNING: this user is not in the 'video' group, so the capture card may not show up as a camera."
  echo "         Fix once:  sudo usermod -aG video \$USER   then log out and back in."
fi
if ! ls /dev/video* >/dev/null 2>&1; then
  echo "WARNING: no camera device (/dev/video0) found. Plug in the capture card, check the HDMI cable and that the camera is on."
fi
SYNC_TYPE="$(cfg storage.sync.type)"
if [ "$SYNC_TYPE" = "rclone" ]; then
  REMOTE="$(cfg storage.sync.remote)"; [ -z "$REMOTE" ] && REMOTE="boothdrive:"
  if ! command -v rclone >/dev/null 2>&1; then
    echo "WARNING: rclone is not installed, so clips will NOT upload to Google Drive. Install it (README, Linux section, rclone)."
  elif ! rclone listremotes 2>/dev/null | grep -qx "${REMOTE%:}:"; then
    echo "WARNING: rclone has no remote called ${REMOTE%:}. Run  rclone config  once to add it (README, Linux section, rclone)."
  else
    echo "Drive upload: rclone, remote ${REMOTE}"
  fi
fi
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi "Status: active"; then
  echo "NOTE: the firewall (ufw) is on. If the tablet cannot connect, allow the booth once:  sudo ufw allow $PORT/tcp"
fi
echo

# keep the computer awake while the booth runs (released when this window closes)
if command -v systemd-inhibit >/dev/null 2>&1; then
  systemd-inhibit --what=idle:sleep:handle-lid-switch --who="Sign-Off Booth" --why="Booth is running" sleep infinity &
  INH=$!
  trap 'kill $INH 2>/dev/null' EXIT
else
  echo "NOTE: could not keep the computer awake automatically. In Settings > Power, set Screen blank and Suspend to Never."
fi
if [ -n "$DISPLAY" ] && command -v xset >/dev/null 2>&1; then xset s off -dpms 2>/dev/null; fi

# open the check page in Chrome once the server is up (it has a button to the recorder)
if [ -z "$BOOTH_NO_OPEN" ]; then
  ( for i in $(seq 1 30); do curl -s -m 1 "http://localhost:$PORT/info" >/dev/null 2>&1 && break; sleep 0.5; done
    open_page "http://localhost:$PORT/check" ) &
fi

"$NODE" "$APP/booth-server.js"
echo
echo "The booth server has stopped."
pause
