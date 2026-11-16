import type { TeardownObject } from "./types";

/**
 * Practice objects are built from primitives in the browser (see lib/game/practice.ts).
 * They exist so the game is playable before any Lux3D object has been generated,
 * and they are always labelled as practice objects in the UI.
 */
export const PRACTICE: TeardownObject[] = [
  {
    id: "practice-lamp",
    name: "Desk lamp",
    source: "practice",
    createdAt: 0,
    decoys: ["Microphone stand", "Showerhead", "Dentist's light"],
  },
  {
    id: "practice-robot",
    name: "Block robot",
    source: "practice",
    createdAt: 0,
    decoys: ["Vending machine", "Parking meter", "Coffee grinder"],
  },
  {
    id: "practice-camera",
    name: "Film camera",
    source: "practice",
    createdAt: 0,
    decoys: ["Car radio", "Binoculars", "Pocket projector"],
  },
];

export const GENERIC_DECOYS = [
  "Pencil sharpener",
  "Bicycle bell",
  "Egg timer",
  "Stapler",
  "Music box",
  "Thermos",
  "Hand mixer",
  "Padlock",
  "Sewing machine",
  "Kettle",
];
