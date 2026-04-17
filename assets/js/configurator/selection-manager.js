/**
 * Selection Manager — tracks which nodes are selected and evaluates visibility.
 *
 * Responsibilities:
 * - Toggle selections (single or multi mode)
 * - Auto-apply default selections when a group is first revealed
 * - Determine whether a node is visible (visibleIf rules)
 * - Determine whether a node is "active" (selected + all ancestors selected)
 * - Find a node's parent by walking the tree
 */
import { state } from './state.js';
import { isSelectable } from './utils.js';

const DEFAULT_APPLIED = new Set();

export function toggleSelection(node, parent) {
    if (!parent || !isSelectable(node)) return;

    const mode = parent.childSelect === "multi" ? "multi" : "single";

    if (mode === "single") {
        parent.children.forEach(c => {
            if (isSelectable(c)) state.SELECTIONS.delete(c.id);
        });

        state.SELECTIONS.add(node.id);

        // Apply defaults to newly revealed children
        parent.children.forEach(c => {
            if (state.SELECTIONS.has(c.id)) applyDefaults(c);
        });
    } else {
        state.SELECTIONS.has(node.id)
            ? state.SELECTIONS.delete(node.id)
            : state.SELECTIONS.add(node.id);
    }
}

export function applyDefaults(node) {
    if (!node || !Array.isArray(node.children)) return;

    if (node.childSelect === "single" && !DEFAULT_APPLIED.has(node.id)) {
        const selectableChildren = node.children.filter(isSelectable);
        const hasSelection = selectableChildren.some(c => state.SELECTIONS.has(c.id));

        if (!hasSelection) {
            const def = selectableChildren.find(c => c.default === true);
            if (def) {
                state.SELECTIONS.add(def.id);
                DEFAULT_APPLIED.add(node.id);
            }
        }
    }

    node.children.forEach(applyDefaults);
}

export function isNodeVisible(node) {
    if (!node?.visibleIf || !node.visibleIf.length) return true;

    return node.visibleIf.every(rule => {
        const selected = state.SELECTIONS.has(rule.targetId);
        return rule.state === "selected" ? selected : !selected;
    });
}

/**
 * A node is "active" when it is selected AND every selectable ancestor is also selected.
 * The root node is always active.
 */
export function isNodeActive(node) {
    if (node.id === "root") return true;
    if (!state.SELECTIONS.has(node.id)) return false;

    let p = findParent(node.id);
    while (p) {
        if (p.id === "root") return true;
        if (isSelectable(p) && !state.SELECTIONS.has(p.id)) return false;
        p = findParent(p.id);
    }
    return true;
}

export function findParent(childId, node = state.CFG.root) {
    if (!node.children) return null;

    for (const c of node.children) {
        if (c.id === childId) return node;
        const found = findParent(childId, c);
        if (found) return found;
    }
    return null;
}