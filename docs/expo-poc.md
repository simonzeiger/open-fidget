# Expo Go Haptic Validation POC

*Parent spec: [SPEC.md](../SPEC.md)*

## Purpose
Before designing enclosures or buying electronics, this proof-of-concept (POC) uses an iPhone's **Taptic Engine** and **accelerometer** via **Expo Go** to test a single core hypothesis:

> *Are eyes-free, vibration-driven fidgets and micro-puzzles genuinely satisfying and intuitive when you can't see a screen?*

A native mobile runtime (Expo Go) is used rather than a mobile web app because iOS Safari does not support programmatic haptic patterns.

## What's Being Tested
The POC includes five distinct haptic interaction paradigms plus a global **Eyes-Free** blackout toggle (pure black screen so you can test each mode purely by feel):

| Mode | Core Mechanic | What It Validates |
| :--- | :--- | :--- |
| **Safe Cracker** | Slide thumb across a 24-notch virtual dial; feel tension near the pin and a heavy double-thunk on the secret tumbler; release to lock. | Precision detent feel & eyes-free discovery puzzles |
| **Rhythm Echo** | Single-thumb Simon using quick taps (dot) vs. short holds (dash) with haptic confirmation when hold crosses threshold. | Coordinate-free memory & rhythm gameplay |
| **Virtual Marble** | Tilt the phone to roll an invisible marble over ridges, around pegs, or into a target hole. | Motion/IMU + physics-driven haptic immersion |
| **Hot-or-Cold Sonar** | Sweep thumb across the pad while a haptic heartbeat accelerates as you near a hidden beacon. | Continuous spatial feedback without visuals |
| **Fidget Sandbox** | Virtual switch (3 feels), magnetic 12-stop slider, bubble wrap grid, and a silent 4-7-8 palm breathing pacer. | Baseline tactile delight & calm/utility modes |

## Key Validation Questions
While testing on a real phone (especially with **Eyes-Free** enabled), pay attention to:
- Which modes do you instinctively keep playing without thinking about it?
- Where does flat glass hurt the experience (confirming what physical grooves, ridges, or force sensors the real hardware needs)?
- Which haptic cues are immediately distinguishable vs. ambiguous when you aren't looking?
- Does motion/tilt feel discreet enough for real-world use, or are thumb-only interactions stronger?

## Code Structure
- `App.js` + `src/` — Modular Expo app source (`src/haptics.js`, `src/theme.js`, and `src/modes/*`).
- `SnackApp.js` — Single-file bundle of the same app for direct phone launch via Expo Snack.

## Running the POC (Expo Go SDK 58)

> **Why not Expo Snack?** Expo Snack currently tops out at SDK 54, whereas the App Store version of Expo Go only runs SDK 58 projects. Running `expo start --tunnel` via GitHub Codespaces or a local machine serves SDK 58 cleanly to Expo Go.

### From your iPhone via GitHub Codespaces
1. Install **Expo Go** from the iOS App Store and sign in with a free Expo account.
2. Launch a free Codespace: [codespaces.new/simonzeiger/open-fidget](https://codespaces.new/simonzeiger/open-fidget)
3. Run in the terminal:
   ```bash
   npm install
   npx expo login
   npm run tunnel
   ```
4. Open **Expo Go** on your iPhone (signed into the same Expo account) — the app will appear under **Recently in development**.

> Note: iOS suppresses haptics when **Low Power Mode** is enabled or **System Haptics** is turned off in Settings.

### Locally
```bash
npm install
npx expo login
npx expo start
```
Scan the QR code with your iPhone to open in Expo Go.
