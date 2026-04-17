/**
 * Pure utility functions for the admin builder.
 * No state imports, no side effects.
 */

export function safeParseJSON(str) {
    if (!str) return null;
    try { return JSON.parse(str); } catch { return null; }
}

export function escapeHtml(s) {
    return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function uid(prefix) {
    return (prefix || "node") + "_" + Math.random().toString(36).slice(2, 9);
}

export function hexToRGBA(hex) {
    const c = hex.replace("#", "");
    const bigint = parseInt(c, 16);
    return [
        ((bigint >> 16) & 255) / 255,
        ((bigint >> 8) & 255) / 255,
        (bigint & 255) / 255,
        1
    ];
}