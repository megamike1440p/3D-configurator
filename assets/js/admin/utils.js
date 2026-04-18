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
    if (!hex || typeof hex !== "string") {
        return [1, 1, 1, 1];
    }

    const c = hex.replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(c)) {
        return [1, 1, 1, 1];
    }

    const bigint = parseInt(c, 16);
    return [
        ((bigint >> 16) & 255) / 255,
        ((bigint >> 8) & 255) / 255,
        (bigint & 255) / 255,
        1
    ];
}
