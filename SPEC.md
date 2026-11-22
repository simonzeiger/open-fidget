# Open Fidget — Product Vision & High-Level Spec

## Overview
**Open Fidget** is a slim, palm-sized, screen-free electronic fidget device designed to be used discreetly—in a pocket, under a desk, or in the palm of one hand—without looking at it.

Marketed primarily toward people with ADHD and neurodivergent adults (as well as anyone who wants tactile focus without screen distraction), Open Fidget bridges the gap between passive analog fidget toys and interactive micro-games using programmable **haptic feedback** as its primary output.

## The Problem
- **Traditional fidget toys** are often noisy, visually conspicuous, or quickly lose novelty.
- **Smartphones** are discreet, but pulling out a screen invites distraction and doomscrolling.
- **No screen-free tactile platform exists** that combines the quiet physical satisfaction of a worry stone with the replayability of programmable micro-games and fidget modes.

## Core Design Principles
1. **Eyes-Free First:** Every interaction must make sense purely by touch and vibration. No screen required.
2. **Discreet & Quiet:** Slim, pocketable form factor with solid-state haptics engineered to be felt in the hand rather than heard across a quiet room.
3. **Great on Day One:** Before any third-party ecosystem exists, the device must feel deeply satisfying out of the box as a standalone fidget and micro-puzzle object.
4. **Tactile Clarity:** Physical landmarks (grooves, dimples, ridges, or force-activated inputs) so a thumb can orient naturally without accidental triggers.
5. **Software-Defined Feel:** A single piece of hardware should be able to emulate many physical sensations—detent dials, mechanical switches, rolling marbles, pulses, and puzzles.

## Interaction Model (Directional)
- **Output:** High-definition haptic feedback capable of expressing crisp clicks, soft thuds, textures, rhythms, and spatial proximity.
- **Inputs (to be validated):** Combinations of touch/slide zones, pressure/squeeze sensing, and motion/tilt sensing.
- **Experience Categories:**
  - *Pure tactile fidgets* (virtual switches, magnetic sliders, rolling physics)
  - *Eyes-free micro-puzzles & games* (safe cracking, rhythm/memory echoes, hot-or-cold sonar, balance challenges)
  - *Calm & focus utilities* (silent breathing pacers, discreet timers, grounding pulses)

## Future Direction: Open Developer Platform
Once the core hardware ergonomics and eyes-free interaction language are proven, Open Fidget is intended to become an **open, programmable platform** where developers and makers can create, share, and load new haptic fidgets, puzzles, and micro-games onto the device.

## Validation Roadmap
1. **Phase 0 — Software Haptic Validation (Current):** Validate which eyes-free haptic sensations and micro-game loops are genuinely fun and satisfying using an iPhone's Taptic Engine before investing in custom hardware. See [Expo Haptic POC](docs/expo-poc.md).
2. **Phase 1 — Off-the-Shelf Hardware Prototype:** Build a handheld electronics prototype using breakout modules (microcontroller, haptic driver/actuator, motion + touch/force sensors) to test real-world ergonomics, acoustics, and pocketability.
3. **Phase 2 — Slim Custom Hardware & SDK:** Consolidate into a compact custom enclosure/PCB and define a clean, approachable developer API for community-built modes.
