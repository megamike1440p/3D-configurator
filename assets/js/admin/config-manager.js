/**
 * Config Manager — owns all reads and writes to CFG and the hidden JSON field.
 *
 * Responsibilities:
 * - Parse, normalize, and validate the configuration object
 * - Walk the node tree and locate nodes by ID
 * - Move, remove, and normalize individual nodes
 * - Sync CFG back to the hidden textarea and fire the config-updated event
 * - Build default effect objects by type
 */
import { state } from './state.js';
import { uid } from './utils.js';

const $ = window.jQuery;

// -----------------------------
// DOM value helpers
// -----------------------------

export function getBasePrice() {
    const v = Number($("#base_price").val() || 0);
    return Number.isFinite(v) ? v : 0;
}

export function getMaterialsList() {
    const list = window.MATERIALS && Array.isArray(window.MATERIALS.list)
        ? window.MATERIALS.list
        : [];
    return list.slice();
}

// -----------------------------
// Config serialization
// -----------------------------

export function syncHiddenJSON() {
    state.CFG.basePrice = getBasePrice();
    const json = JSON.stringify(state.CFG);
    const $ta = $("#config_json");
    $ta.val(json);
    // Notify material scanner and other admin helpers
    $(document).trigger("config-updated", [state.CFG]);
    $ta.trigger("input");
}

// -----------------------------
// Tree traversal
// -----------------------------

export function walk(node, fn, parentId) {
    fn(node, parentId);
    (node.children || []).forEach(ch => walk(ch, fn, node.id));
}

export function listAllNodes() {
    const out = [];
    walk(state.CFG.root, (n, parentId) => out.push({ id: n.id, label: n.label, parentId }), null);
    return out;
}

export function findNodeById(id) {
    let found = null;
    walk(state.CFG.root, (n) => { if (n.id === id) found = n; }, null);
    return found;
}

export function findNodeByIdDeep(id) {
    if (!state.CFG?.root || !id) return null;

    let found = null;
    (function walkDeep(n) {
        if (!n || found) return;
        if (n.id === id) { found = n; return; }
        (n.children || []).forEach(walkDeep);
    })(state.CFG.root);

    return found;
}

export function findParentOf(childId) {
    let parent = null;
    walk(state.CFG.root, (n) => {
        if ((n.children || []).some(ch => ch.id === childId)) parent = n;
    }, null);
    return parent;
}

// -----------------------------
// Tree mutations
// -----------------------------

export function removeNodeById(id) {
    if (id === "root") return false;
    const parent = findParentOf(id);
    if (!parent) return false;
    parent.children = (parent.children || []).filter(ch => ch.id !== id);
    return true;
}

export function moveNode(id, direction) {
    if (id === "root") return;
    const parent = findParentOf(id);
    if (!parent) return;

    const kids = parent.children || [];
    const idx = kids.findIndex(k => k.id === id);
    if (idx < 0) return;

    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= kids.length) return;

    [kids[idx], kids[newIdx]] = [kids[newIdx], kids[idx]];
}

export function cleanupDanglingReferences(deletedId) {
    walk(state.CFG.root, (n) => {
        n.visibleIf = (n.visibleIf || []).filter(r => r.targetId !== deletedId);
    }, null);
}

// -----------------------------
// Normalization
// -----------------------------

export function normalizeModelId(raw) {
    let id = String(raw || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    return id || uid("model");
}

export function normalizeNode(node, isRoot = false) {
    const n = (node && typeof node === "object") ? node : {};
    const id = String(n.id || (isRoot ? "root" : uid("choice")));
    const label = String(n.label || (isRoot ? "Configuration" : "New Choice"));
    const thumbId = n.thumbId != null ? Number(n.thumbId) : null;
    const thumbUrl = n.thumbUrl ? String(n.thumbUrl) : "";
    const selectable = n.selectable !== false;
    const isDefault = n.default === true;
    const childSelect = (n.childSelect === "multi") ? "multi" : "single";
    const childReveal = (n.childReveal === "always") ? "always" : "whenSelected";

    const visibleIf = Array.isArray(n.visibleIf)
        ? n.visibleIf
            .filter(r => r && typeof r === "object" && r.targetId)
            .map(r => ({
                targetId: String(r.targetId),
                state: r.state === "unselected" ? "unselected" : "selected"
            }))
        : [];

    const effects = Array.isArray(n.effects)
        ? n.effects
            .filter(e => e && typeof e === "object" && e.type)
            .map(e => ({
                ...e,
                type: String(e.type),
                materials: Array.isArray(e.materials) ? e.materials : [],
                syncGroup: typeof e.syncGroup === "string" ? e.syncGroup : ""
            }))
        : [];

    const children = Array.isArray(n.children)
        ? n.children.map(c => normalizeNode(c, false))
        : [];

    return { id, label, thumbId, thumbUrl, selectable, default: isDefault, childSelect, childReveal, visibleIf, effects, children };
}

export function ensureConfig(raw) {
    const basePrice = getBasePrice();

    if (raw && typeof raw === "object" && raw.schema === "configurator" && raw.root) {
        raw.basePrice = Number(raw.basePrice ?? basePrice);
        raw.models = Array.isArray(raw.models) ? raw.models : [];
        raw.root = normalizeNode(raw.root, true);
        if (!raw.models.length) raw.models.push({ id: "default", label: "Default Model", src: "" });
        return raw;
    }

    return {
        schema: "configurator",
        basePrice: Number(basePrice),
        models: [{ id: "default", label: "Default Model", src: "" }],
        root: {
            id: "root",
            label: "Configuration",
            childSelect: "single",
            childReveal: "always",
            visibleIf: [],
            effects: [],
            children: []
        }
    };
}

// -----------------------------
// Default effect factories
// -----------------------------

export function createDefaultEffect(type) {
    switch (type) {
        case "price": return { type: "price", delta: 0 };
        case "model": return { type: "model", modelId: (state.CFG.models?.[0]?.id || "default") };
        case "showMaterial": return { type: "showMaterial", material: "" };
        case "hideMaterial": return { type: "hideMaterial", material: "" };
        case "colorize": return { type: "colorize", material: "", color: "#ffffff" };
        case "texture": return { type: "texture", materials: [], imageId: null, url: "", mode: "final", color: "#ffffff", syncGroup: "" };
    }
}