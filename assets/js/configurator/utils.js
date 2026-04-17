/**
 * Shared utilities for the configurator runtime.
 * Pure functions only — no side effects, no state imports.
 */

export const DEBUG = true;

export function $(sel, root = document) {
    return root.querySelector(sel);
}

export function $all(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
}

export function safeJSON(str) {
    try { return JSON.parse(str); } catch { return null; }
}

export function dbg(...args) {
    if (DEBUG) console.log(...args);
}

export function hexToRGBA(hex) {
    if (!hex) return [1, 1, 1, 1];
    const h = hex.replace("#", "");
    const bigint = parseInt(h, 16);
    if (h.length === 6) {
        return [
            ((bigint >> 16) & 255) / 255,
            ((bigint >> 8) & 255) / 255,
            (bigint & 255) / 255,
            1
        ];
    }
    return [1, 1, 1, 1];
}

export function isSelectable(node) {
    // Default true unless explicitly false
    return node?.selectable !== false;
}