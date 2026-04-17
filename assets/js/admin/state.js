/**
 * Central state store for the admin builder.
 *
 * `render` is injected by the entry point (admin-configurator.js) so that
 * sub-modules (tree-renderer, details-renderer) can trigger a full re-render
 * without creating circular imports back to the entry point.
 */
export const state = {
    CFG: null,
    SELECTED_NODE_ID: null,
    ADMIN_VIEWER: null,
    ADMIN_MODEL_READY: false,
    LAST_PREVIEW_NODE_ID: null,
    PREVIEW_TOUCHED: new Set(),
    PREVIEW_ORIG: new Map(),       // matName → { baseColorFactor, texture, alphaMode }
    PREVIEW_TEXTURE_PROMISES: new Map(), // url → Promise(texture)
    PREVIEW_MATERIAL_EPOCH: 0,
    EXPANDED_NODE_IDS: new Set(),

    // Injected by entry point to avoid circular dependency
    render: null,
};