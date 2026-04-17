/**
 * Effects Engine — processes active node effects against the 3D model.
 *
 * Responsibilities:
 * - Walk the choice tree with inherited context (e.g. syncGroup propagation)
 * - PASS 1: Collect texture sync-group sources
 * - PASS 2: Resolve sync sinks and dispatch each effect to the material manager
 * - Determine which model ID should currently be active
 */
import { state } from './state.js';
import { dbg } from './utils.js';
import { isNodeActive } from './selection-manager.js';
import { hideMaterial, showMaterial, applyTextureEffect, applyColor } from './material-manager.js';

/**
 * Walk the tree depth-first, carrying a context object that inherits
 * the nearest ancestor's syncGroup so sinks can find their source.
 */
export function walkWithCtx(node, ctx, fn) {
    const nextCtx = { ...(ctx || {}) };

    const texSyncHere = (node.effects || []).find(e => e.type === "texture" && e.syncGroup)?.syncGroup;
    if (texSyncHere) nextCtx.texSyncGroup = texSyncHere;

    fn(node, nextCtx);
    (node.children || []).forEach(c => walkWithCtx(c, nextCtx, fn));
}

/**
 * PASS 1 — Collect texture sync-group sources.
 * A "source" is an active texture effect that carries a URL and a syncGroup.
 */
export function collectSyncState() {
    const syncState = {};

    walkWithCtx(state.CFG.root, { texSyncGroup: "" }, (node, ctx) => {
        if (!isNodeActive(node)) return;

        (node.effects || []).forEach(eff => {
            if (eff.type !== "texture") return;

            const group = eff.syncGroup || ctx.texSyncGroup;
            if (!group || !eff.url) return;

            syncState[group] = { url: eff.url, color: eff.color, mode: eff.mode };
        });
    });

    return syncState;
}

/**
 * PASS 2 — Resolve sync sinks and apply all effects.
 * Sinks (same syncGroup, no url) inherit url/color/mode from the source.
 */
export function applyEffectsPass(syncState) {
    const epoch = state.MATERIAL_EPOCH;

    walkWithCtx(state.CFG.root, { texSyncGroup: "" }, (node, ctx) => {
        if (!isNodeActive(node)) return;

        const resolvedEffects = (node.effects || []).map(e0 => {
            const e = { ...e0 }; // clone — never mutate the config JSON

            if (e.type === "texture") {
                const group = e.syncGroup || ctx.texSyncGroup;

                if (group && syncState[group]) {
                    const src = syncState[group];
                    const isSink = !e.url;

                    if (isSink) e.url = src.url;
                    if (!e.mode) e.mode = src.mode;
                    // Sinks always inherit color so e.g. arms->wood gets the chosen tint
                    if (isSink) e.color = src.color;
                }
            }

            return e;
        });

        applyEffects(resolvedEffects, epoch);
    });
}

export function applyEffects(effects, epoch) {
    if (!effects?.length) return;
    dbg("[] applyEffects", effects);

    effects.forEach(eff => {
        dbg("[] effect", eff);
        switch (eff.type) {
            case "price":
                state.PRICE_DELTA += Number(eff.delta || 0);
                break;
            case "model":
                // Model selection is handled up-front in updateAll to avoid mid-pass swaps.
                break;
            case "hideMaterial":
                hideMaterial(eff.material);
                break;
            case "showMaterial":
                showMaterial(eff.material);
                break;
            case "texture":
                applyTextureEffect(eff, epoch);
                break;
            case "colorize":
                applyColor(eff.material, eff.color);
                break;
        }
    });
}

/** Walk the tree and return the last model ID demanded by an active "model" effect. */
export function computeDesiredModelId() {
    let desired = null;

    (function walk(node) {
        if (!node) return;
        if (isNodeActive(node)) {
            for (const eff of (node.effects || [])) {
                if (eff?.type === "model" && eff.modelId) desired = eff.modelId;
            }
        }
        for (const c of (node.children || [])) walk(c);
    })(state.CFG.root);

    return desired;
}