# Quick start

From download to a working test recording in about 10 minutes. You do not need to write code. You need a laptop, Chrome, and a camera (a laptop webcam is fine for a first test).

## 1. Install what it needs (3 minutes)

1. Install **Google Chrome** from google.com/chrome if you do not have it.
2. Install **Node.js** from nodejs.org. Choose the **LTS** version (18 or newer).
3. Check Node is there. Open a terminal (on a Mac: Terminal in Applications > Utilities) and type:

```bash
node -v
```

You should see a version number such as `v20.11.1`. If you see "command not found", close the terminal, open a new one and try again.

## 2. Get the program (1 minute)

1. Download this folder (on GitHub: **Code > Download ZIP**) and unzip it somewhere you can find, such as your Desktop.
2. You should see `Start Booth.command`, `app`, `brand` and `booth-settings.json` inside it.

## 3. Start it (1 minute)

- **Mac:** double-click `Start Booth.command`. If the Mac refuses, right-click the file, choose **Open**, and confirm once.
- **Linux:** in a terminal, in the folder, run:

```bash
bash "Start Booth (Linux).sh"
```

- **Windows:** there is no launcher yet, and it has not been tested on Windows. In a terminal in the folder, run:

```bash
node app/booth-server.js
```

Then open `http://localhost:8080/check` in Chrome.

**What you should see:** a terminal window that prints "Sign-Off Booth server running." and a list of addresses, and Chrome opening the **Booth check** page. Leave the terminal window open. Closing it stops the booth.

The check page is a list. Green is fine. Amber and red tell you what to fix, in plain words. At this point expect a red or amber line about the **consent text** (you have not written it yet) and maybe the camera. Carry on.

## 4. Make it yours in the control panel (2 minutes)

1. On the check page, click **Logo, colours and wording**. (Or open `http://localhost:8080/control` in Chrome on this laptop. It does not open from other devices, on purpose.)
2. On the left, fill in:
   - **Event**: your organisation, the two title lines, the year, a tagline.
   - **Logo**: click **Choose a logo file** and pick your logo (PNG, JPG, SVG or WebP).
   - **Colours and font**: pick the main colour, accent colour and background with the colour pickers.
   - **Wording** and **Consent**: write what the graduate should read. Write your own consent line.
3. Watch the **preview on the right** change as you type. Use the buttons above it (Start, Countdown, Recording, QR code, Thank you, Idle screen) to look at each screen.
4. Click **Save**. It says "Saved". Your choices are written to `brand/brand.json`, and your logo to the `brand` folder.

If you do not like the result, **Reset to defaults** puts the standard logo, colours, wording and timings back. Your previous branding is kept in `brand/brand.previous.json`.

## 5. Connect the camera (1 minute)

1. Go back to the check page and click **Open the recorder** (or open `http://localhost:8080/recorder`).
2. Chrome asks to use the camera. Click **Allow**.
3. Open **Settings** on the recorder page, and under **Camera** choose your camera from the list. For a camera with a capture card, it appears by the card's name.

**What you should see:** your own picture on the recorder page and a **Camera** chip that is green. The Performance card shows the picture size (for example 1920 x 1080) and the frames per second.

## 6. Connect the tablet (1 minute)

1. On the recorder, find **Connect the tablet**. It shows a QR code and an address.
2. On the tablet, scan the QR code with its camera, or type the address into Chrome. The laptop and the tablet must be on the **same Wi-Fi**.
3. Do not tap Start yet. The tablet goes full screen when you do, in step 7.

**What you should see:** the tablet shows your event title, logo and colours, with the live camera picture behind them. The **Tablet** chip on the recorder turns green.

No tablet yet? Use the laptop: open the address from step 6 in another Chrome window.

## 7. Make a test recording (1 minute)

1. On the tablet, tap **Start**. The countdown runs, then the recording, with a clock showing the seconds left.
2. Sign your name (to a camera, or on a pane of glass if you have the rig). Tap **Finish**.
3. Tap **Looks good**.
4. A **QR code** appears on the tablet.

**What you should see:** the clip in the **Saved clips** list on the recorder, and two files in your clips folder (the folder is named under **Where clips are saved**): a clean one in `Masters`, and one with your logo in `Share`.

## 8. Test the QR share (1 minute)

1. With your phone on the **same Wi-Fi** as the laptop, scan the QR code on the tablet.
2. Your phone opens the download page with your clip. Tap **Download**. On an iPhone, open the downloaded file and choose **Save Video**.

If the phone cannot open the page, see the troubleshooting list below. If guests will not be on your Wi-Fi, see "Share link" in the README.

## On the day

Before people arrive:

1. Start the booth and open the check page. Fix anything red.
2. Make two test clips and watch them back. Check the writing reads correctly and the face is lit.
3. Clean the glass. Put the markers out.
4. Laptop and camera on mains power.

While it runs:

- Keep the terminal window open.
- Wipe the glass between people.
- Glance at the recorder now and then for warnings.

After:

- Close the terminal window to stop the booth.
- Copy the clips folder somewhere safe. Delete what you do not need.

## If something goes wrong

| What you see | What to do |
|---|---|
| **Picture has black bars at the sides, or looks 3:2** | The camera is in photo mode. Switch it to video mode. The recorder's Performance card should show a 16:9 size such as 1920 x 1080. |
| **Clips stutter, or the Performance card shows 25 fps** | The recorder asks for 30 fps but cannot force the camera. Set the camera to 30 fps (often under a PAL / NTSC or system frequency setting). |
| **Camera not in the list** | Check the cable and capture card. Click **Refresh list**. Make sure no other app (Zoom, Photo Booth) is using the camera. Allow camera access: the camera icon in Chrome's address bar. |
| **Capture card gives a small or squashed picture** | It is probably a USB 2.0 dongle. Use a USB 3.0 one and plug it into a USB 3 port. |
| **Phone cannot open the QR link** | The phone is on a different Wi-Fi. Join the laptop's Wi-Fi, or host the share page elsewhere (`shareBase` in the control panel's Sharing section). |
| **Uploads to Google Drive fail with "quota"** (Linux with rclone) | rclone's built-in Google client is shared by everyone. Make your own Google OAuth client and use it in `rclone config`. See the README. |
| **The tablet says "Reconnecting"** | Wi-Fi dropped, or the booth stopped. Check the terminal window is still open. The tablet reconnects by itself. |
| **Control panel says it must be opened on the laptop** | Use `http://localhost:8080/control` on the booth laptop, not the laptop's network address. |
| **Port 8080 is busy** | Change `port` under `launcher` in `booth-settings.json`, then start again. |

More detail: [README.md](README.md). The kit used to build the booth: [EQUIPMENT.md](EQUIPMENT.md).
