/**
 * UI Renderer — builds and syncs the configurator DOM.
 *
 * Responsibilities:
 * - Render the full choice-tree UI from scratch
 * - Build individual option buttons (with optional thumbnails)
 * - Reflect selection state back onto existing DOM nodes
 * - Update the displayed price
 */
import { state } from './state.js';
import { $, $all, isSelectable } from './utils.js';
import { isNodeVisible, toggleSelection, applyDefaults } from './selection-manager.js';

export function renderUI() {
    const uiRoot = document.querySelector(".ui");
    if (!uiRoot) return;
    uiRoot.innerHTML = "";

    // Render root as a proper group so top-level choices become buttons
    renderGroupForNode(state.CFG.root, uiRoot, { isRoot: true });
}

/**
 * Renders a "group" (layer) for a node's children.
 *
 * - Selectable children get an option button.
 * - Category-only children (selectable:false) skip the button
 *   but still render their own child groups.
 */
export function renderGroupForNode(node, container, { isRoot = false } = {}) {
    if (!isNodeVisible(node)) return;

    const group = document.createElement("div");
    group.className = "hm-group";
    group.dataset.nodeId = node.id;

    if (!isRoot) {
        const title = document.createElement("div");
        title.className = "hm-title";
        title.textContent = node.label || node.id;
        group.appendChild(title);
    }

    const opts = document.createElement("div");
    opts.className = "hm-options";

    const children = Array.isArray(node.children) ? node.children : [];

    children.forEach(child => {
        if (!isNodeVisible(child) || !isSelectable(child)) return;

        const btn = buildOptionButton(child);
        btn.addEventListener("click", () => {
            toggleSelection(child, node);
            if (state.updateAll) state.updateAll();
        });

        opts.appendChild(btn);
    });

    if (opts.childElementCount) {
        group.appendChild(opts);
    }

    container.appendChild(group);

    // Render deeper layers for children that have their own children
    children.forEach(child => {
        if (!isNodeVisible(child) || !child.children?.length) return;

        const revealMode = child.childReveal === "always" ? "always" : "whenSelected";

        if (!isSelectable(child)) {
            // Category-only: can't be selected, treat childReveal as always
            renderGroupForNode(child, container, { isRoot: false });
            return;
        }

        if (revealMode === "always" || state.SELECTIONS.has(child.id)) {
            renderGroupForNode(child, container, { isRoot: false });
        }
    });
}

function buildOptionButton(child) {
    const btn = document.createElement("div");
    btn.className = "hm-option";
    btn.dataset.id = child.id;

    const thumbUrl =
        child.thumbUrl ||
        child.thumbnailUrl ||
        (child.thumb && child.thumb.url) ||
        (child.thumbnail && child.thumbnail.url) ||
        "";

    if (thumbUrl) {
        btn.classList.add("has-thumb");
        const thumb = document.createElement("div");
        thumb.className = "hm-option-thumb";

        const image = document.createElement("img");
        image.className = "hm-option-thumb-img";
        image.src = thumbUrl;
        image.alt = "";
        image.loading = "lazy";
        thumb.appendChild(image);

        const label = document.createElement("div");
        label.className = "hm-option-label";
        label.textContent = child.label || child.id;

        btn.appendChild(thumb);
        btn.appendChild(label);
    } else {
        const label = document.createElement("div");
        label.className = "hm-option-label";
        label.textContent = child.label || child.id;
        btn.appendChild(label);
    }
    return btn;
}

export function updateUIStates() {
    // Apply defaults for any newly reachable groups
    applyDefaults(state.CFG.root);

    // Reflect selection state into the DOM
    $all(".hm-option").forEach(el => {
        el.classList.toggle("active", state.SELECTIONS.has(el.dataset.id));
    });
}

export function updatePrice() {
    const base = Number(state.CFG.basePrice || 0);
    const total = base + state.PRICE_DELTA;
    const el = $(".price-value");
    if (el) el.textContent = `$${total.toFixed(2)}`;
}
