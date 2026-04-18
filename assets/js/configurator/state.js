/**
 * Central state store for the configurator runtime.
 *
 * All mutable runtime data lives here so every module can import state
 * without creating circular dependencies between each other.
 *
 * `updateAll` is injected by the entry point (configurator.js) after it
 * assembles all modules — this breaks the circular dep between the model
 * manager (which calls updateAll after a swap) and the effects engine
 * (which triggers swaps).
 */
export const state = {
    MV: null,
    CURRENT_MODEL_ID: null,

    // One-viewer multi-model warm loading
    MODEL_SRC_BY_ID: new Map(),            // modelId → src
    ORIGINAL_MATERIALS_BY_MODEL: new Map(), // modelId → { name → {baseColor, texture, emissive} }
    IS_MODEL_SWAPPING: false,
    PENDING_MODEL_ID: null,

    MATERIAL_CACHE: {},     // name → material
    ORIGINAL_MATERIALS: {}, // name → { baseColor, texture, emissive }
    SELECTIONS: new Set(),  // selected node ids

    PRICE_DELTA: 0,
    MATERIAL_EPOCH: 0,

    // Texture caching — avoids re-downloading on every click
    TEXTURE_PROMISES: new Map(), // url → Promise(texture)

    // Injected by entry point to avoid circular dependency
    updateAll: null,
};
