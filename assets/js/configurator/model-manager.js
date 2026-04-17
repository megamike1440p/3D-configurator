/**
 * Model Manager — controls model-viewer src and camera across swaps.
 *
 * Responsibilities:
 * - Warm-load a GLB and resolve a Promise when it's ready
 * - Swap to a new model by ID, preserving camera state
 * - Re-capture material originals after each swap
 *
 * `state.updateAll` is called after a swap completes — it is injected
 * by the entry point to avoid a circular import.
 */
import { state } from './state.js';
import { dbg } from './utils.js';
import { captureOriginalMaterials, snapshotOriginalMaterials } from './material-manager.js';

export function getCameraState() {
    try {
        if (!state.MV) return null;
        if (
            typeof state.MV.getCameraOrbit === 'function' &&
            typeof state.MV.getCameraTarget === 'function' &&
            typeof state.MV.getFieldOfView === 'function'
        ) {
            return {
                orbit: state.MV.getCameraOrbit(),
                target: state.MV.getCameraTarget(),
                fov: state.MV.getFieldOfView()
            };
        }
    } catch { /* ignore */ }
    return null;
}

export function setCameraState(camState) {
    try {
        if (!state.MV || !camState) return;
        if (typeof state.MV.setCameraOrbit === 'function' && camState.orbit) state.MV.setCameraOrbit(camState.orbit);
        if (typeof state.MV.setCameraTarget === 'function' && camState.target) state.MV.setCameraTarget(camState.target);
        if (typeof state.MV.setFieldOfView === 'function' && camState.fov) state.MV.setFieldOfView(camState.fov);
    } catch { /* ignore */ }
}

/**
 * Load a GLB src into the active model-viewer and resolve when done.
 * Resolves on load, error, or timeout — never rejects.
 */
export function warmLoadOne(src, timeoutMs = 25000) {
    return new Promise((resolve) => {
        if (!src) return resolve();

        let finished = false;

        const finish = async () => {
            if (finished) return;
            finished = true;
            try {
                if (state.MV.updateComplete) await state.MV.updateComplete;
            } catch { /* ignore */ }
            resolve();
        };

        const timer = setTimeout(() => {
            state.MV.removeEventListener('error', onError);
            finish();
        }, timeoutMs);

        const onError = () => {
            clearTimeout(timer);
            finish();
        };

        state.MV.addEventListener('load', () => {
            clearTimeout(timer);
            state.MV.removeEventListener('error', onError);
            finish();
        }, { once: true });

        state.MV.addEventListener('error', onError, { once: true });

        state.MV.src = src;
    });
}

export function swapModelById(modelId) {
    if (!modelId) return;
    if (state.IS_MODEL_SWAPPING && state.PENDING_MODEL_ID === modelId) return;
    if (modelId === state.CURRENT_MODEL_ID) return;

    const src =
        state.MODEL_SRC_BY_ID.get(modelId) ||
        (state.CFG.models || []).find(m => m.id === modelId)?.src ||
        "";

    if (!src) {
        dbg("swapModelById: missing src for", modelId);
        return;
    }

    state.IS_MODEL_SWAPPING = true;
    state.PENDING_MODEL_ID = modelId;

    const cam = getCameraState();

    state.MV.addEventListener("load", () => {
        setCameraState(cam);

        state.CURRENT_MODEL_ID = modelId;
        captureOriginalMaterials();
        state.ORIGINAL_MATERIALS_BY_MODEL.set(modelId, snapshotOriginalMaterials());

        state.IS_MODEL_SWAPPING = false;
        state.PENDING_MODEL_ID = null;

        // Re-apply selections on the new model. updateAll is injected from the entry point.
        if (state.updateAll) state.updateAll();
    }, { once: true });

    state.MV.src = src;
}

export function swapModel(model) {
    if (!model) return;
    swapModelById(model.id);
}