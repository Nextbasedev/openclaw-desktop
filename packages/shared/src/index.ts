/**
 * Shared types, constants, and utilities for Jarvis.
 *
 * This package is imported by both the UI (Next.js) and Desktop (Tauri) packages.
 * Keep it dependency-free except for Zod (validation at boundaries).
 */

export * from "./types";
