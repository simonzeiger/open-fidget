# Open Fidget — Haptic Validation Lab (v0)

An Expo Go prototype for validating eyes-free haptic fidget mechanics and micro-games on iPhone before building custom hardware.

- **Product Vision & Rough Spec:** [SPEC.md](SPEC.md)
- **Expo POC Overview:** [docs/expo-poc.md](docs/expo-poc.md)

## Included Prototypes
1. **Safe Cracker** — Drag your thumb slowly across 24 virtual dial detents, feel the tension and heavy double-thunk of the secret tumbler, and lift to lock pins.
2. **Rhythm Echo** — Single-thumb eyes-free Simon using quick taps (`DOT`) and 0.25s holds (`DASH`) with instant haptic confirmation.
3. **Virtual Marble** — Accelerometer physics box with 3 tactile trays (*Wooden Ridges*, *Pinball Pegs*, and *Hole Drop*).
4. **Hot-or-Cold Sonar** — Sweep your thumb to find a hidden beacon using an accelerating haptic heartbeat.
5. **Fidget Sandbox** — Test 4 core tactile sensations (*Virtual Switch*, *Magnetic Slider*, *Bubble Pop*, and *4-7-8 Palm Breathing*).

Every mode supports an **Eyes-Free (`◐ EYES-FREE`)** blackout toggle so you can test whether the feel works without looking at the screen.

## Running on iPhone (Expo Go SDK 58)

> **Note on Expo Snack:** Snack currently caps out at SDK 54 while App Store Expo Go requires SDK 58, so use **GitHub Codespaces** (works from your phone browser!) or a laptop with Expo CLI.

### Option 1: From your iPhone using GitHub Codespaces (no laptop needed)
1. Install **Expo Go** from the iOS App Store and sign in with a free Expo account.
2. Open a free Codespace for this repo: https://codespaces.new/simonzeiger/open-fidget
3. In the Codespace terminal, run:
   ```bash
   npm install
   npx expo login
   npm run tunnel
   ```
4. Sign in with the **same Expo account** as Expo Go, then open Expo Go on your iPhone — **Open Fidget Lab** will appear under **Recently in development** (or tap the `exp://` link printed in the terminal).

### Option 2: Locally from a computer
```bash
npm install
npx expo login
npx expo start
```
Scan the QR code with your iPhone camera (or open via **Recently in development** in Expo Go).
