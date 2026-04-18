/**
 * CurrentLuxury Configurator Runtime — Entry Point
 *
 * This file is the only one enqueued by WordPress. It:
 * 1. Imports all sub-modules
 * 2. Defines `updateAll()` — the top-level orchestrator that coordinates
 *    model swaps, effect passes, and UI re-renders
 * 3. Injects `updateAll` into shared state so sub-modules can call it
 *    without creating circular imports
 * 4. Boots on DOMContentLoaded
 */
import { state } from './state.js';
import { $, safeJSON } from './utils.js';
import { captureOriginalMaterials, snapshotOriginalMaterials, dumpMat, resetMaterials } from './material-manager.js';
import { warmLoadOne, swapModelById } from './model-manager.js';
import { applyDefaults, findParent } from './selection-manager.js';
import { collectSyncState, applyEffectsPass, computeDesiredModelId } from './effects-engine.js';
import { renderUI, updateUIStates, updatePrice } from './ui-render.js';

// -----------------------------
// Top-level orchestrator
// -----------------------------
let syncCartForm = null;

function updateAll() {
    // Check for a model swap first — avoid applying effects mid-pass
    const desiredModelId = computeDesiredModelId();
    if (desiredModelId && desiredModelId !== state.CURRENT_MODEL_ID) {
        if (!state.IS_MODEL_SWAPPING) swapModelById(desiredModelId);
        return;
    }

    state.MATERIAL_EPOCH++;
    state.PRICE_DELTA = 0;

    resetMaterials();

    const syncState = collectSyncState(); // PASS 1: collect texture sources
    applyEffectsPass(syncState);          // PASS 2: resolve sinks, apply effects

    updatePrice();
    renderUI();
    updateUIStates();
    if (syncCartForm) syncCartForm();
}

// Inject into shared state so sub-modules (e.g. model-manager) can call it
// after an async swap without importing from this entry point.
state.updateAll = updateAll;

// -----------------------------
// Debug helpers
// -----------------------------
window.MATERIALS = window.MATERIALS || {};
window.MATERIALS.dumpMat = dumpMat;
window.MATERIALS.listMats = () => Object.keys(state.MATERIAL_CACHE);
window.MATERIALS.mv = () => state.MV;

// -----------------------------
// Boot
// -----------------------------
document.addEventListener("DOMContentLoaded", () => {
    const root = document.querySelector("[data-configurator]");
    if (!root) return;

    state.CFG = safeJSON(root.getAttribute("data-config") || root.dataset.config);

    if (!state.CFG || !state.CFG.root) {
        state.CFG = buildEmptyConfig();
    }

    const fallbackModel = root.getAttribute("data-model") || root.dataset.model;

    state.MV = document.createElement("model-viewer");
    state.MV.src = state.CFG.models?.[0]?.src || fallbackModel || "";
    state.MV.setAttribute("camera-controls", "");
    state.MV.setAttribute("environment-image", "neutral");

    root.innerHTML = buildShellHTML(state.CFG.basePrice);

    $(".hm-viewer", root).appendChild(state.MV);

    (state.CFG.models || []).forEach(m => {
        if (m?.id) state.MODEL_SRC_BY_ID.set(m.id, String(m.src || ""));
    });

    const viewerWrap = $(".hm-viewer", root);
    const overlay = buildLoadingOverlay();
    viewerWrap.appendChild(overlay);
    state.MV.style.visibility = "hidden";

    (async () => {
        await warmLoadAllModels();

        state.MV.style.visibility = "visible";
        overlay.remove();

        applyDefaults(state.CFG.root);
        renderUI();
        syncCartForm = createCartFormSync(root);
        updateAll();
    })();
});

// -----------------------------
// Helpers
// -----------------------------

async function warmLoadAllModels() {
    const models = (state.CFG.models || []).filter(m => m?.id && m.src);
    const first = models[0] ?? null;

    if (!first?.src) return;

    for (const m of models.slice(1)) {
        await warmLoadOne(m.src);
        captureOriginalMaterials();
        state.ORIGINAL_MATERIALS_BY_MODEL.set(m.id, snapshotOriginalMaterials());
    }

    // Return to the first model so the user sees it immediately
    await warmLoadOne(first.src);
    state.CURRENT_MODEL_ID = first.id;
    captureOriginalMaterials();
    state.ORIGINAL_MATERIALS_BY_MODEL.set(first.id, snapshotOriginalMaterials());
}

function buildEmptyConfig() {
    return {
        schema: "configurator",
        basePrice: 0,
        models: [],
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

function buildShellHTML(basePrice) {
    return `
        <div class="hm-configurator">
            <div class="hm-viewer"></div>
            <div class="hm-side">
                <div class="price-bar">
                    <div class="price-value">$${Number(basePrice || 0).toFixed(2)}</div>
                </div>
                <div class="ui"></div>
            </div>
        </div>
    `;
}

function buildLoadingOverlay() {
    const overlay = document.createElement("div");
    overlay.className = "loading";
    overlay.innerHTML = `
        <div class="loading-inner">
            <strong>Loading models…</strong><br>
            <span>Preparing instant swaps</span>
        </div>
    `;
    return overlay;
}

function createCartFormSync(root) {
    if (!root || root.dataset.showCart !== "yes") return null;

    const form = document.querySelector("form.cart");
    if (!form) return null;

    const ensureHiddenInput = (name) => {
        let input = form.querySelector(`input[name="${name}"]`);
        if (!input) {
            input = document.createElement("input");
            input.type = "hidden";
            input.name = name;
            form.appendChild(input);
        }
        return input;
    };

    const nonceInput = ensureHiddenInput("configurator_nonce");
    const configInput = ensureHiddenInput("config_data");
    const priceInput = ensureHiddenInput("price_delta");

    const sync = () => {
        nonceInput.value = root.dataset.cartNonce || "";
        configInput.value = JSON.stringify(buildCartPayload(root));
        priceInput.value = String(Number(state.PRICE_DELTA || 0));
    };

    form.addEventListener("submit", sync);
    sync();

    return sync;
}

function buildCartPayload(root) {
    return {
        config_id: Number(root.dataset.configId || 0),
        selected_node_ids: Array.from(state.SELECTIONS),
        selections: buildSelectionSummary(),
    };
}

function buildSelectionSummary() {
    const summary = {};

    state.SELECTIONS.forEach((nodeId) => {
        const node = findNodeById(nodeId);
        if (!node || node.id === "root") return;

        const parent = findParent(node.id);
        const key = parent?.label || parent?.id || node.label || node.id;
        summary[key] = node.label || node.id;
    });

    return summary;
}

function findNodeById(id, node = state.CFG?.root) {
    if (!node) return null;
    if (node.id === id) return node;

    for (const child of (node.children || [])) {
        const found = findNodeById(id, child);
        if (found) return found;
    }

    return null;
}
