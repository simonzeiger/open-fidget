# Open Fidget — Haptic Validation Lab (v0)

An Expo Go prototype for validating eyes-free haptic fidget mechanics and micro-games on iPhone before building custom hardware.

## Included Prototypes
1. **Safe Cracker** — Drag your thumb slowly across 24 virtual dial detents, feel the tension and heavy double-thunk of the secret tumbler, and lift to lock pins.
2. **Rhythm Echo** — Single-thumb eyes-free Simon using quick taps (`DOT`) and 0.25s holds (`DASH`) with instant haptic confirmation.
3. **Virtual Marble** — Accelerometer physics box with 3 tactile trays (*Wooden Ridges*, *Pinball Pegs*, and *Hole Drop*).
4. **Hot-or-Cold Sonar** — Sweep your thumb to find a hidden beacon using an accelerating haptic heartbeat.
5. **Fidget Sandbox** — Test 4 core tactile sensations (*Virtual Switch*, *Magnetic Slider*, *Bubble Pop*, and *4-7-8 Palm Breathing*).

Every mode supports an **Eyes-Free (`◐ EYES-FREE`)** blackout toggle so you can test whether the feel works without looking at the screen.

## Running on iPhone

### Option 1: Directly from your phone via Expo Snack (no computer required)
1. Install **Expo Go** from the iOS App Store and sign in with a free Expo account.
2. Open on your iPhone:
   `https://snack.expo.dev/?platform=mydevice&name=Open%20Fidget%20Lab&dependencies=expo-haptics,expo-sensors&sourceUrl=https%3A%2F%2Fraw.githubusercontent.com%2Fsimonzeiger%2Fopen-fidget%2Fmain%2FSnackApp.js`
3. Tap **Open in Expo Go**.

### Option 2: Locally from a computer
```bash
npm install
npx expo start
```
Scan the QR code with your iPhone camera to open in Expo Go.
