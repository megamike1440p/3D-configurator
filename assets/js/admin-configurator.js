(function ($) {
    /**
     * CurrentLuxury Configurator — Admin Builder (Choice Tree + Friendly Effects UI)
     *
     * Requires:
     * - jQuery
     * - wp.media (ensure wp_enqueue_media() in admin)
     * - model-viewer scanner file populates: window.CLC_MATERIALS.list (File 2)
     *
     * Writes:
     * - JSON into #clc_config_json
     */

    // -----------------------------
    // State
    // -----------------------------
    let CFG = null;
    let SELECTED_NODE_ID = null;
    let ADMIN_VIEWER = null;
    let ADMIN_MODEL_READY = false;
    let LAST_PREVIEW_NODE_ID = null;
    let PREVIEW_TOUCHED = new Set();
    let PREVIEW_ORIG = new Map(); // matName -> { baseColorFactor, baseColorTexture, alphaMode }
    const PREVIEW_TEXTURE_PROMISES = new Map(); // url -> Promise(texture)
    let PREVIEW_MATERIAL_EPOCH = 0;
    // -----------------------------
    // Utilities
    // -----------------------------
    function safeParseJSON(str) {
        if (!str) return null;
        try { return JSON.parse(str); } catch (e) { return null; }
    }

    function escapeHtml(s) {
        return String(s ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function uid(prefix) {
        return (prefix || "node") + "_" + Math.random().toString(36).slice(2, 9);
    }

    function getBasePrice() {
        const v = Number($("#clc_base_price").val() || 0);
        return Number.isFinite(v) ? v : 0;
    }

    function getMaterialsList() {
        const list = window.CLC_MATERIALS && Array.isArray(window.CLC_MATERIALS.list)
            ? window.CLC_MATERIALS.list
            : [];
        return list.slice();
    }
    function setupModelPicker() {
        // Legacy single-GLB field removed from the flow.
        // Models are managed via CFG.models in the Models editor.
        // Kept as a no-op for backward compatibility.
    }


    function ensureConfig(raw) {
        const basePrice = getBasePrice();

        // If it looks like ours, keep it
        if (raw && typeof raw === "object" && raw.schema === "clc-configurator" && raw.root) {
            raw.basePrice = Number(raw.basePrice ?? basePrice);
            raw.models = Array.isArray(raw.models) ? raw.models : [];
            raw.root = normalizeNode(raw.root, true);
            // Ensure at least one model exists
            if (!raw.models.length) raw.models.push({ id: "default", label: "Default Model", src: "" });
            return raw;
        }

        // New clean config
        return {
            schema: "clc-configurator",
            basePrice: Number(basePrice),
            models: [
                { id: "default", label: "Default Model", src: "" }
            ],
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

    function normalizeNode(node, isRoot = false) {
        const n = (node && typeof node === "object") ? node : {};
        const id = String(n.id || (isRoot ? "root" : uid("choice")));
        const label = String(n.label || (isRoot ? "Configuration" : "New Choice"));
        const thumbId = n.thumbId != null ? Number(n.thumbId) : null;
        const thumbUrl = n.thumbUrl ? String(n.thumbUrl) : "";

        // ✅ FIX: define selectable
        const selectable = n.selectable !== false;
        const isDefault = n.default === true;

        const childSelect = (n.childSelect === "multi") ? "multi" : "single";
        const childReveal = (n.childReveal === "always") ? "always" : "whenSelected";

        const visibleIf = Array.isArray(n.visibleIf)
            ? n.visibleIf
                .filter(r => r && typeof r === "object" && r.targetId)
                .map(r => ({
                    targetId: String(r.targetId),
                    state: (r.state === "unselected") ? "unselected" : "selected"
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

        return {
            id,
            label,
            thumbId,
            thumbUrl,
            selectable,
            default: isDefault,
            childSelect,
            childReveal,
            visibleIf,
            effects,
            children
        };
    }

    function syncHiddenJSON() {
        CFG.basePrice = getBasePrice();
        const json = JSON.stringify(CFG);
        const $ta = $('#clc_config_json');
        $ta.val(json);
        // Notify other admin helpers (material scanner, etc.) using the SAME config the builder just wrote.
        $(document).trigger('clc:config-updated', [CFG]);
        // Also trigger native events for any listeners bound to the textarea.
        $ta.trigger('input');
    }

    function walk(node, fn, parentId) {
        fn(node, parentId);
        (node.children || []).forEach(ch => walk(ch, fn, node.id));
    }

    function listAllNodes() {
        const out = [];
        walk(CFG.root, (n, parentId) => out.push({ id: n.id, label: n.label, parentId }), null);
        return out;
    }
    /**
     * Find any node by id by walking CFG.root (admin-side helper).
     * (We do this so model swaps can re-run the preview after load.)
     */
    function findNodeByIdDeep(id) {
        if (!CFG?.root || !id) return null;

        let found = null;
        (function walk(n) {
            if (!n || found) return;
            if (n.id === id) { found = n; return; }
            (n.children || []).forEach(walk);
        })(CFG.root);

        return found;
    }
    /**
     * Runtime-style texture getter:
     * - cached
     * - uses ADMIN_VIEWER.createTexture(url)
     */
    function getPreviewTexture(url) {
        if (!url || !ADMIN_VIEWER) return Promise.resolve(null);
        if (PREVIEW_TEXTURE_PROMISES.has(url)) return PREVIEW_TEXTURE_PROMISES.get(url);

        const p = ADMIN_VIEWER.createTexture(url);
        PREVIEW_TEXTURE_PROMISES.set(url, p);
        return p;
    }
    function findNodeById(id) {
        let found = null;
        walk(CFG.root, (n) => { if (n.id === id) found = n; }, null);
        return found;
    }

    function findParentOf(childId) {
        let parent = null;
        walk(CFG.root, (n) => {
            if ((n.children || []).some(ch => ch.id === childId)) parent = n;
        }, null);
        return parent;
    }

    function removeNodeById(id) {
        if (id === "root") return false;
        const parent = findParentOf(id);
        if (!parent) return false;
        parent.children = (parent.children || []).filter(ch => ch.id !== id);
        return true;
    }

    function moveNode(id, direction) {
        if (id === "root") return;
        const parent = findParentOf(id);
        if (!parent) return;
        const kids = parent.children || [];
        const idx = kids.findIndex(k => k.id === id);
        if (idx < 0) return;
        const newIdx = direction === "up" ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= kids.length) return;
        const tmp = kids[idx];
        kids[idx] = kids[newIdx];
        kids[newIdx] = tmp;
    }

    function cleanupDanglingReferences(deletedId) {
        walk(CFG.root, (n) => {
            n.visibleIf = (n.visibleIf || []).filter(r => r.targetId !== deletedId);
        }, null);
    }

    function normalizeModelId(raw) {
        let id = String(raw || "").trim().toLowerCase();
        id = id.replace(/[^a-z0-9_-]/g, "");
        return id || uid("model");
    }

    // -----------------------------
    // Default effect objects
    // -----------------------------
    function createDefaultEffect(type) {
        switch (type) {
            case "price":
                return { type: "price", delta: 0 };
            case "model":
                return { type: "model", modelId: (CFG.models?.[0]?.id || "default") };
            case "showMaterial":
                return { type: "showMaterial", material: "" };
            case "hideMaterial":
                return { type: "hideMaterial", material: "" };
            case "colorize":
                // Not "tint RGBA" — this is a simple marketing-friendly color choice.
                // Runtime can decide how to apply: baseColorFactor with grayscale textures, etc.
                return { type: "colorize", material: "", color: "#ffffff" };
            case "texture":
                return {
                    type: "texture",
                    materials: [],      // ✅ important
                    imageId: null,
                    url: "",
                    mode: "final",
                    color: "#ffffff",
                    syncGroup: ""
                };


        }
    }

    // -----------------------------
    // WP Media Picker helper
    // -----------------------------
    function pickMediaImage(onPick) {
        if (!window.wp || !wp.media) {
            alert("Media picker not available. Make sure wp_enqueue_media() is called in admin.");
            return;
        }

        const frame = wp.media({
            title: "Select or Upload Image",
            button: { text: "Use this image" },
            multiple: false,
            library: { type: "image" }
        });

        frame.on("select", function () {
            const att = frame.state().get("selection").first().toJSON();
            // att.id, att.url, att.sizes may exist
            onPick(att);
        });

        frame.open();
    }

    // -----------------------------
    // UI Rendering
    // -----------------------------
    function render() {
        captureExpandedNodes();
        const $root = $("#clc-builder-root");
        if (!$root.length) return;

        $root.empty();

        const $wrap = $(`
      <div class="clc-tree-editor">
        <div class="clc-tree-left">
          <div class="clc-tree-topbar">
            <div class="clc-tree-title">
              <strong>Configurator Builder</strong>
              <div class="clc-tree-subtitle">Build layers, rules, and choices without technical fields.</div>
            </div>
            <div class="clc-tree-actions">
              <button type="button" class="button clc-add-top">+ Add Top Choice</button>
              <button type="button" class="button clc-expand-all">Expand All</button>
              <button type="button" class="button clc-collapse-all">Collapse All</button>
            </div>
          </div>

          <div class="clc-tree-list"></div>

          <div class="clc-tree-footer">
            <small><em>Tip:</em> A “choice” can also act as a category by adding children beneath it.</small>
          </div>
        </div>

        <div class="clc-tree-right">
          <div class="clc-details"></div>
        </div>
      </div>
    `);

        // Minimal style injection (we'll refine CSS later, but this is already far friendlier than “boxes everywhere”)
        const $style = $(`
      <style>
        .clc-tree-editor { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .clc-tree-left, .clc-tree-right { border: 1px solid #ddd; background: #fff; padding: 12px; border-radius: 10px; }
        .clc-tree-topbar { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 10px; }
        .clc-tree-subtitle { font-size: 12px; color: #666; margin-top: 2px; }
        .clc-tree-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
        .clc-node { border: 1px solid #eee; background: #fafafa; border-radius: 10px; padding: 10px; margin: 8px 0; }
        .clc-node-header { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
        .clc-node-left { display: flex; gap: 10px; align-items: center; }
        .clc-node-toggle { width: 28px; height: 28px; border-radius: 8px; border: 1px solid #ddd; background: #fff; cursor: pointer; }
        .clc-node-label { cursor: pointer; font-weight: 700; }
        .clc-node-id { font-size: 11px; color: #777; }
        .clc-node-controls { display: flex; gap: 6px; align-items: center; }
        .clc-node-children { margin-left: 18px; margin-top: 8px; display: none; }
        .clc-node.expanded > .clc-node-children { display: block; }
        .clc-node.selected { outline: 2px solid #2271b1; background: #f0f7ff; }
        .clc-details h3 { margin-top: 0; }
        .clc-section { border-top: 1px solid #eee; padding-top: 12px; margin-top: 12px; }
        .clc-field { margin: 10px 0; }
        .clc-field label { display: block; font-weight: 700; margin-bottom: 4px; }
        .clc-field input[type="text"], .clc-field input[type="number"], .clc-field select { width: 100%; }
        .clc-pill-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .clc-pill { border: 1px solid #ddd; border-radius: 999px; padding: 5px 10px; background: #fff; display: inline-flex; gap: 8px; align-items: center; }
        .clc-pill code { font-size: 11px; }
        .clc-pill button { border: none; background: transparent; color: #b32d2e; cursor: pointer; font-weight: 700; }
        .clc-effect-card { border: 1px solid #e6e6e6; background: #fff; border-radius: 10px; padding: 10px; margin: 8px 0; }
        .clc-effect-head { display:flex; align-items:center; gap:10px; }
        .clc-effect-type { font-weight: 800; }
        .clc-effect-actions { margin-left: auto; display:flex; gap:8px; }
        .clc-effect-body { margin-top: 10px; display:grid; gap:10px; }
        .clc-inline { display:grid; grid-template-columns: 140px 1fr; gap: 10px; align-items:center; }
        .clc-muted { color:#666; font-size: 12px; }
        .clc-img-preview { max-width: 140px; border: 1px solid #ddd; border-radius: 8px; }
        .clc-row { display:flex; gap: 8px; flex-wrap: wrap; }
      </style>
    `);

        $root.append($style, $wrap);

        renderTree($wrap.find(".clc-tree-list"));

        if (!SELECTED_NODE_ID) SELECTED_NODE_ID = "root";
        renderDetails($wrap.find(".clc-details"));

        // Wire actions
        $wrap.find(".clc-add-top").on("click", function () {
            const n = normalizeNode({ id: uid("choice"), label: "New Choice", children: [] });
            CFG.root.children.push(n);
            SELECTED_NODE_ID = n.id;
            syncHiddenJSON();
            render();
        });

        $wrap.find(".clc-expand-all").on("click", function () {
            $wrap.find(".clc-node").addClass("expanded");
            $wrap.find(".clc-node-toggle").each(function () {
                const $n = $(this).closest(".clc-node");
                if ($n.find(".clc-node-children").children().length) $(this).text("▾");
            });
        });

        $wrap.find(".clc-collapse-all").on("click", function () {
            $wrap.find(".clc-node").removeClass("expanded");
            $wrap.find(".clc-node-toggle").each(function () {
                const $n = $(this).closest(".clc-node");
                if ($n.find(".clc-node-children").children().length) $(this).text("▸");
            });
        });
        restoreExpandedNodes();
        // Apply admin preview AFTER the DOM exists
        const selected = findNodeById(SELECTED_NODE_ID);
        updatePreviewForSelection(selected);
    }

    function renderTree($container) {
        $container.empty();
        $container.append(renderNode(CFG.root, 0));
    }

    function renderNode(node, depth) {
        const hasKids = (node.children || []).length > 0;

        const $node = $(`
      <div class="clc-node" data-node-id="${escapeHtml(node.id)}">
        <div class="clc-node-header">
          <div class="clc-node-left">
            <button type="button" class="clc-node-toggle" title="${hasKids ? "Expand/collapse" : "No children"}">
              ${hasKids ? "▸" : "•"}
            </button>
            <div>
              <div class="clc-node-label">
  ${escapeHtml(node.label)}
  ${node.selectable === false ? `<span class="clc-muted"> (category)</span>` : ""}
</div>

              <div class="clc-node-id"><code>${escapeHtml(node.id)}</code></div>
            </div>
          </div>

          <div class="clc-node-controls">
            <button type="button" class="button clc-add-child">+ Child</button>
            ${node.id !== "root" ? `
              <button type="button" class="button" data-move="up">↑</button>
              <button type="button" class="button" data-move="down">↓</button>
              <button type="button" class="button-link-delete clc-delete">Delete</button>
            ` : ""}
          </div>
        </div>

        <div class="clc-node-children"></div>
      </div>
    `);

        $node.css("margin-left", depth * 10 + "px");

        if (node.id === SELECTED_NODE_ID) $node.addClass("selected");

        // Expand/collapse
        $node.find(".clc-node-toggle").on("click", function (e) {
            e.stopPropagation();
            if (!hasKids) return;
            $node.toggleClass("expanded");
            $(this).text($node.hasClass("expanded") ? "▾" : "▸");
        });

        // Select node
        $node.find(".clc-node-label, .clc-node-id").on("click", function (e) {
            e.stopPropagation();
            SELECTED_NODE_ID = node.id;
            render();
        });


        // Add child
        $node.find(".clc-add-child").on("click", function (e) {
            e.stopPropagation();
            const child = normalizeNode({ id: uid("choice"), label: "New Choice", children: [] });
            node.children = node.children || [];
            node.children.push(child);
            SELECTED_NODE_ID = child.id;
            syncHiddenJSON();
            render();
        });

        // Move
        $node.find('[data-move="up"]').on("click", function (e) {
            e.stopPropagation();
            moveNode(node.id, "up");
            syncHiddenJSON();
            render();
        });

        $node.find('[data-move="down"]').on("click", function (e) {
            e.stopPropagation();
            moveNode(node.id, "down");
            syncHiddenJSON();
            render();
        });

        // Delete
        $node.find(".clc-delete").on("click", function (e) {
            e.stopPropagation();
            if (!confirm("Delete this choice and all of its children?")) return;

            const wasSelected = (SELECTED_NODE_ID === node.id);
            const ok = removeNodeById(node.id);
            if (!ok) return;

            if (wasSelected) {
                const parent = findParentOf(node.id);
                SELECTED_NODE_ID = parent ? parent.id : "root";
            }

            cleanupDanglingReferences(node.id);
            syncHiddenJSON();
            render();
        });

        // Children
        const $kidsWrap = $node.find(".clc-node-children");
        if (hasKids) {
            if (node.id === "root") {
                $node.addClass("expanded");
                $node.find(".clc-node-toggle").text("▾");
            }
            node.children.forEach(ch => $kidsWrap.append(renderNode(ch, depth + 1)));
        }

        return $node;
    }

    // -----------------------------
    // Details Pane
    // -----------------------------
    function renderDetails($container) {
        $container.empty();

        const node = findNodeById(SELECTED_NODE_ID) || CFG.root;
        const allNodes = listAllNodes().filter(n => n.id !== node.id);

        const materials = getMaterialsList();

        const $details = $(`
<div>
  <h3>
    Selected: ${escapeHtml(node.label)}
    <small style="color:#777;"><code>${escapeHtml(node.id)}</code></small>
  </h3>

  ${node.id === "root" ? `
    <div class="clc-section">
      <h3 style="margin:0 0 8px 0;">Models</h3>
      <div class="clc-muted">
        Used for model swaps (e.g., base/back changes). Customers won’t know you’re swapping.
      </div>
      <div class="clc-models"></div>

      <div class="clc-row" style="margin-top:10px;">
        <button type="button" class="button clc-model-add">+ Add Model</button>
      </div>
    </div>
  ` : ``}

  ${node.id !== "root" ? `
    <div class="clc-section">
      <h3 style="margin:0 0 8px 0;">Choice</h3>

      <!-- Label -->
      <div class="clc-field">
        <label>Label</label>
        <input type="text"
               class="clc-detail-label"
               value="${escapeHtml(node.label)}" />
        <div class="clc-muted">What the customer sees.</div>
      </div>
      <!-- Thumbnail (optional) -->
      <div class="clc-field">
        <label>Thumbnail (optional)</label>
        <div class="clc-row clc-thumb-row">
          <button type="button" class="button clc-thumb-pick">Choose image</button>
          <button type="button" class="button clc-thumb-clear" ${node.thumbUrl ? "" : "disabled"}>Clear</button>
        </div>
        <div class="clc-thumb-preview-wrap" ${node.thumbUrl ? "" : "hidden"}>
          <img class="clc-thumb-preview" src="${escapeHtml(node.thumbUrl || "")}" alt="" />
        </div>
        <div class="clc-muted">Optional. If set, the runtime can render this choice with a thumbnail.</div>
      </div>


      <!-- Node type -->
      <div class="clc-field">
        <label>Node type</label>
        <select class="clc-detail-selectable">
          <option value="choice">Choice (customer can select)</option>
          <option value="category">Category only (used to group choices)</option>
        </select>
        <div class="clc-muted">
          Categories are not selectable by customers. They only reveal their children.
        </div>
      </div>

      <!-- Children behavior -->
      <div class="clc-field">
        <label>Children behavior</label>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div>
            <select class="clc-detail-childSelect">
              <option value="single"${node.childSelect === "single" ? " selected" : ""}>
                Single-select (choose one)
              </option>
              <option value="multi"${node.childSelect === "multi" ? " selected" : ""}>
                Multi-select (choose many)
              </option>
            </select>
            <div class="clc-muted">
              How customers pick among this choice’s children.
            </div>
          </div>

          <div>
            <select class="clc-detail-childReveal">
              <option value="whenSelected"${node.childReveal === "whenSelected" ? " selected" : ""}>
                Reveal children only when selected
              </option>
              <option value="always"${node.childReveal === "always" ? " selected" : ""}>
                Children always visible
              </option>
            </select>
            <div class="clc-muted">
              Whether child layers show immediately.
            </div>
          </div>
        </div>
      </div>
    </div>
  ` : ``}
${node.id !== "root" ? `
  <div class="clc-field">
    <label style="display:flex; align-items:center; gap:6px;">
      <input type="checkbox" class="clc-detail-default"
             ${node.default ? "checked" : ""}>
      Default choice
    </label>
    <div class="clc-muted">
      This option will be auto-selected when available.
    </div>
  </div>
` : ""}

  <div class="clc-section">
    <h3 style="margin:0 0 8px 0;">Visibility rules</h3>
    <div class="clc-visibleIf-list"></div>

    <div class="clc-row" style="margin-top:8px;">
      <select class="clc-visibleIf-target">
        <option value="">Show only when…</option>
        ${allNodes
                .map(n =>
                    `<option value="${escapeHtml(n.id)}">
              ${escapeHtml(n.label)} (${escapeHtml(n.id)})
            </option>`
                ).join("")}
      </select>

      <select class="clc-visibleIf-state">
        <option value="selected">is selected</option>
        <option value="unselected">is NOT selected</option>
      </select>

      <button type="button" class="button clc-visibleIf-add">+ Add</button>
    </div>

    <div class="clc-muted">
      Example: show “Arms” only when “Chair Type” is selected.
    </div>
  </div>

  ${node.id !== "root" ? `
    <div class="clc-section">
      <h3 style="margin:0 0 8px 0;">Effects</h3>
      <div class="clc-muted">
        Effects happen when this choice is selected.
      </div>

      <div class="clc-effects-list"></div>

      <div class="clc-row" style="margin-top:8px;">
        <select class="clc-effect-type">
          <option value="texture">Apply Texture</option>
          <option value="colorize">Apply Color</option>
          <option value="model">Swap Model</option>
          <option value="price">Add Price</option>
          <option value="showMaterial">Show Material</option>
          <option value="hideMaterial">Hide Material</option>
        </select>

        <button type="button" class="button clc-effect-add">
          + Add Effect
        </button>

        <button type="button"
                class="button clc-effect-refresh-materials"
                title="After scanning materials, click this if dropdowns were already open">
          Refresh Materials
        </button>
      </div>

      ${materials.length ? "" : `
        <div class="clc-muted" style="margin-top:8px;">
          <strong>Heads up:</strong>
          You haven’t scanned materials yet.
        </div>
      `}
    </div>
  ` : ``}
</div>
`);

        // Root models editor
        if (node.id === "root") {
            renderModelsEditor($details.find(".clc-models"));

            $details.find(".clc-model-add").on("click", function () {
                const id = normalizeModelId(prompt("Model ID (simple, no spaces):", "back_tall") || "");
                if (!id) return;
                if (CFG.models.some(m => m.id === id)) {
                    alert("That model ID already exists.");
                    return;
                }
                CFG.models.push({ id, label: "New Model", src: "" });
                syncHiddenJSON();
                render();
            });
        }

        // Choice label

        $details.find(".clc-detail-label").on("input", function () {

            node.label = $(this).val();

            syncHiddenJSON();

            // Update the tree label in-place (no full render, so focus stays)
            const $treeNode = $(`.clc-node[data-node-id="${CSS.escape(node.id)}"]`);
            if ($treeNode.length) {
                const suffix = (node.selectable === false) ? " (category)" : "";

                $treeNode.find(".clc-node-label").first().text(node.label + suffix);

            }


            // Optional: update the header text without re-rendering
            // If your "Selected:" label is part of this same template, you can skip this.
        });

        // Thumbnail (optional)

        const $thumbWrap = $details.find(".clc-thumb-preview-wrap");
        const $thumbImg = $details.find(".clc-thumb-preview");
        const $thumbClear = $details.find(".clc-thumb-clear");

        function refreshThumbUI() {
            const hasThumb = !!(node.thumbUrl && String(node.thumbUrl).trim());
            $thumbWrap.prop("hidden", !hasThumb);
            $thumbImg.attr("src", hasThumb ? node.thumbUrl : "");
            $thumbClear.prop("disabled", !hasThumb);
        }

        refreshThumbUI();

        $details.find(".clc-thumb-pick").on("click", function () {
            pickMediaImage((att) => {
                if (!att) return;
                node.thumbId = att.id != null ? Number(att.id) : null;
                node.thumbUrl = att.url ? String(att.url) : "";
                syncHiddenJSON();
                refreshThumbUI();
            });
        });

        $thumbClear.on("click", function () {
            node.thumbId = null;
            node.thumbUrl = "";
            syncHiddenJSON();
            refreshThumbUI();
        });




        $details.find(".clc-detail-selectable")
            .val(node.selectable === false ? "category" : "choice")
            .on("change", function () {
                const v = $(this).val();
                node.selectable = (v !== "category");

                // UX sanity defaults
                if (!node.selectable) {
                    node.childReveal = "always";
                }

                syncHiddenJSON();
                render();
            });

        // Child behaviors
        $details.find(".clc-detail-childSelect").on("change", function () {
            node.childSelect = $(this).val() === "multi" ? "multi" : "single";
            syncHiddenJSON();
        });

        $details.find(".clc-detail-childReveal").on("change", function () {
            node.childReveal = $(this).val() === "always" ? "always" : "whenSelected";
            syncHiddenJSON();
        });

        // Visibility rules
        renderVisibleIfList($details.find(".clc-visibleIf-list"), node, allNodes);

        $details.find(".clc-visibleIf-add").on("click", function () {
            const targetId = String($details.find(".clc-visibleIf-target").val() || "");
            if (!targetId) return;

            const state = String($details.find(".clc-visibleIf-state").val() || "selected");
            node.visibleIf = node.visibleIf || [];

            const exists = node.visibleIf.some(r => r.targetId === targetId && r.state === state);
            if (exists) return;

            node.visibleIf.push({ targetId, state: (state === "unselected" ? "unselected" : "selected") });
            syncHiddenJSON();
            renderDetails($container);
        });

        // Effects
        renderEffectsList($details.find(".clc-effects-list"), node);

        $details.find(".clc-effect-add").on("click", function () {
            const type = String($details.find(".clc-effect-type").val() || "texture");
            node.effects = node.effects || [];
            node.effects.push(createDefaultEffect(type));
            syncHiddenJSON();
            renderDetails($container);
        });

        $details.find(".clc-effect-refresh-materials").on("click", function () {
            // Just re-render details to rebuild all material dropdowns from the newest scan result
            renderDetails($container);
        });

        //default selection
        $details.find(".clc-detail-default")
            .prop("checked", node.default === true)
            .on("change", function () {
                const checked = $(this).is(":checked");

                const parent = findParentOf(node.id);
                if (checked && parent?.children) {
                    parent.children.forEach(c => delete c.default);
                }


                node.default = checked || undefined;

                syncHiddenJSON();
                render();
            });


        $container.append($details);
    }

    function renderModelsEditor($container) {
        $container.empty();

        const models = Array.isArray(CFG.models) ? CFG.models : (CFG.models = []);
        if (!models.length) {
            $container.append(`<div class="clc-muted"><em>No models added yet.</em></div>`);
            return;
        }

        models.forEach((m, idx) => {
            const $row = $(`
        <div class="clc-effect-card">
          <div class="clc-effect-head">
            <div class="clc-effect-type">Model</div>
            <div class="clc-muted"><code>${escapeHtml(m.id)}</code></div>
            <div class="clc-effect-actions">
              ${m.id === "default" ? "" : `<button type="button" class="button-link-delete clc-model-remove">Remove</button>`}
            </div>
          </div>

          <div class="clc-effect-body">
            <div class="clc-inline">
              <div><strong>Label</strong></div>
              <div><input type="text" class="clc-model-label" value="${escapeHtml(m.label || "")}"></div>
            </div>
            <div class="clc-inline">
              <div><strong>GLB URL</strong></div>
              <div style="display:flex; gap:8px; align-items:center;"><input type="text" class="clc-model-src" value="${escapeHtml(m.src || "")}" style="flex:1;"><button type="button" class="button clc-choose-model">Choose GLB</button></div>
            </div>
            <div class="clc-muted">Use Swap Model effects to switch between these.</div>
          </div>
        </div>
      `);

            $row.find(".clc-model-label").on("input", function () {
                m.label = $(this).val();
                syncHiddenJSON();
            });

            $row.find(".clc-model-src").on("input", function () {
                m.src = $(this).val();
                syncHiddenJSON();
            });

            $row.find('.clc-choose-model').on('click', function () {
                const frame = wp.media({
                    title: 'Select GLB Model',
                    button: { text: 'Use this model' },
                    multiple: false
                });

                frame.on('select', function () {
                    const att = frame.state().get('selection').first().toJSON();
                    if (att && att.url) {
                        $row.find('.clc-model-src').val(att.url).trigger('input');
                    }
                });

                frame.open();
            });


            $row.find(".clc-model-remove").on("click", function () {
                if (!confirm("Remove this model?")) return;
                models.splice(idx, 1);

                // Clean up model effects that reference a removed model
                const remaining = new Set(models.map(mm => mm.id));
                walk(CFG.root, (n) => {
                    n.effects = (n.effects || []).map(e => {
                        if (e.type === "model" && e.modelId && !remaining.has(e.modelId)) {
                            return { ...e, modelId: models[0]?.id || "default" };
                        }
                        return e;
                    });
                }, null);

                syncHiddenJSON();
                render();
            });

            $container.append($row);
        });
    }

    function renderVisibleIfList($container, node, allNodes) {
        $container.empty();
        const rules = Array.isArray(node.visibleIf) ? node.visibleIf : (node.visibleIf = []);
        if (!rules.length) {
            $container.append(`<div class="clc-muted"><em>No rules. This choice can appear whenever its parent reveals it.</em></div>`);
            return;
        }

        const lookup = new Map(allNodes.map(n => [n.id, n.label]));
        const $rowWrap = $('<div class="clc-pill-row"></div>');

        rules.forEach((r, idx) => {
            const label = lookup.get(r.targetId) || r.targetId;
            const pill = $(`
        <span class="clc-pill">
          <span>${escapeHtml(label)}</span>
          <code>${escapeHtml(r.state)}</code>
          <button type="button" title="Remove">✕</button>
        </span>
      `);

            pill.find("button").on("click", function () {
                rules.splice(idx, 1);
                syncHiddenJSON();
                renderVisibleIfList($container, node, allNodes);
            });

            $rowWrap.append(pill);
        });

        $container.append($rowWrap);
    }

    // -----------------------------
    // Friendly Effects UI
    // -----------------------------
    function renderEffectsList($container, node) {
        $container.empty();

        const effects = Array.isArray(node.effects) ? node.effects : (node.effects = []);
        if (!effects.length) {
            $container.append(`<div class="clc-muted"><em>No effects yet. This can just be a category that reveals children.</em></div>`);
            return;
        }

        effects.forEach((eff, idx) => {
            const $card = $(`
        <div class="clc-effect-card" data-effect-index="${idx}">
          <div class="clc-effect-head">
            <div class="clc-effect-type">${escapeHtml(effectTitle(eff.type))}</div>
            <div class="clc-muted">${escapeHtml(effectSubtitle(eff))}</div>
            <div class="clc-effect-actions">
              <button type="button" class="button-link-delete clc-effect-remove">Remove</button>
            </div>
          </div>
          <div class="clc-effect-body"></div>
        </div>
      `);

            $card.find(".clc-effect-remove").on("click", function () {
                effects.splice(idx, 1);
                syncHiddenJSON();
                renderEffectsList($container, node);
            });

            // Body UI per effect type
            const $body = $card.find(".clc-effect-body");
            renderEffectEditor($body, node, eff, () => {
                syncHiddenJSON();
                // Refresh title/subtitle without re-rendering everything
                $card.find(".clc-effect-type").text(effectTitle(eff.type));
                $card.find(".clc-muted").first().text(effectSubtitle(eff));
            });

            $container.append($card);
        });
    }

    function effectTitle(type) {
        switch (type) {
            case "texture": return "Texture";
            case "colorize": return "Color";
            case "model": return "Swap Model";
            case "price": return "Price";
            case "showMaterial": return "Show Material";
            case "hideMaterial": return "Hide Material";
            default: return "Effect";
        }
    }

    function effectSubtitle(eff) {
        if (!eff || typeof eff !== "object") return "";
        switch (eff.type) {
            case "texture":
                return eff.material
                    ? `Material: ${eff.material} • ${eff.mode === "recolorable" ? "Recolorable" : "Final"}`
                    : `Choose a material`;
            case "colorize":
                return eff.material ? `Material: ${eff.material} • ${eff.color || ""}` : `Choose a material`;
            case "model":
                return eff.modelId ? `→ ${eff.modelId}` : `Choose a model`;
            case "price":
                return `Δ $${Number(eff.delta || 0).toFixed(2)}`;
            case "showMaterial":
                return eff.material ? eff.material : "Choose a material";
            case "hideMaterial":
                return eff.material ? eff.material : "Choose a material";
            default:
                return "Edit details";
        }
    }

    function renderEffectEditor($body, node, eff, onChange) {
        const materials = getMaterialsList();
        const models = Array.isArray(CFG.models) ? CFG.models : [];

        // Common helper: material dropdown
        function materialSelectHtml(current) {
            const opts = materials.length
                ? materials.map(m => `<option value="${escapeHtml(m)}"${m === current ? " selected" : ""}>${escapeHtml(m)}</option>`).join("")
                : `<option value="">(Scan materials first)</option>`;
            return `<select class="clc-eff-material">${opts}</select>`;
        }
        // TEXTURE
        if (eff.type === "texture") {
            $body.html(`
<div class="clc-inline">
  <div><strong>Target Materials</strong></div>
  <div>
    ${materials.map(m => `
      <label style="display:block">
        <input type="checkbox"
               class="clc-eff-material-multi"
               value="${escapeHtml(m)}"
               ${eff.materials?.includes(m) ? "checked" : ""}>
        ${escapeHtml(m)}
      </label>
    `).join("")}
  </div>
</div>

<div class="clc-inline">
  <div><strong>Sync group</strong></div>
  <input type="text"
         class="clc-eff-sync-group"
         placeholder="e.g. wood_finish"
         value="${escapeHtml(eff.syncGroup || "")}">
</div>


<div class="clc-inline">
  <div><strong>Texture Type</strong></div>
  <div>
    <select class="clc-eff-texture-mode">
      <option value="final"${eff.mode === "final" ? " selected" : ""}>
        Final (already colored)
      </option>
      <option value="recolorable"${eff.mode === "recolorable" ? " selected" : ""}>
        Recolorable (grayscale)
      </option>
    </select>
  </div>
</div>

${eff.mode === "recolorable" ? `
<div class="clc-inline">
  <div><strong>Color</strong></div>
  <div class="clc-row">
    <input type="color" class="clc-eff-tex-color" value="${escapeHtml(eff.color || "#ffffff")}">
    <input type="text"
           class="clc-eff-tex-color-text"
           value="${escapeHtml(eff.color || "#ffffff")}"
           style="max-width:160px;">
    <span class="clc-muted">Applies tint over grayscale texture.</span>
  </div>
</div>
` : ``}

<div class="clc-inline">
  <div><strong>Image</strong></div>
  <div class="clc-row">
    <button type="button" class="button clc-eff-pick-img">
      ${eff.imageId ? "Change Image" : "Choose Image"}
    </button>
    <button type="button" class="button clc-eff-clear-img"${eff.imageId ? "" : " disabled"}>
      Clear
    </button>
    <span class="clc-muted">
      ${eff.imageId ? ("Media ID: " + eff.imageId) : "No image selected yet"}
    </span>
  </div>
</div>
`);


            // material
            $body.find(".clc-eff-material").on("change", function () {
                eff.material = $(this).val() || "";
                onChange();
            });

            // image picker
            $body.find(".clc-eff-pick-img").on("click", function () {
                pickMediaImage((att) => {
                    eff.imageId = att.id;
                    eff.url = att.url || "";
                    onChange();
                    renderEffectEditor($body, node, eff, onChange);
                });
            });

            $body.find(".clc-eff-clear-img").on("click", function () {
                eff.imageId = null;
                eff.url = "";
                onChange();
                renderEffectEditor($body, node, eff, onChange);
            });
            // mode
            $body.find(".clc-eff-texture-mode").on("change", function () {
                eff.mode = $(this).val() === "recolorable" ? "recolorable" : "final";

                // Ensure color exists when switching to recolorable
                if (eff.mode === "recolorable" && !eff.color) eff.color = "#ffffff";

                onChange();
                renderEffectEditor($body, node, eff, onChange); // refresh UI to show/hide wheel
            });

            // color (only present in recolorable mode)
            $body.find(".clc-eff-tex-color").on("input", function () {
                eff.color = $(this).val();
                $body.find(".clc-eff-tex-color-text").val(eff.color);
                onChange();
            });

            $body.find(".clc-eff-tex-color-text").on("input", function () {
                eff.color = $(this).val();
                onChange();
            });

            // ✅ materials (multi)
            $body.find(".clc-eff-material-multi").on("change", function () {
                eff.materials = $body.find(".clc-eff-material-multi:checked")
                    .map((_, el) => el.value)
                    .get();
                onChange();
            });

            // ✅ sync group
            $body.find(".clc-eff-sync-group").on("input", function () {
                eff.syncGroup = $(this).val() || "";
                onChange();
            });

            return;
        }

        // COLOR
        if (eff.type === "colorize") {
            $body.html(`
        <div class="clc-inline">
          <div><strong>Target Material</strong></div>
          <div>${materialSelectHtml(eff.material || "")}</div>
        </div>

        <div class="clc-inline">
          <div><strong>Color</strong></div>
          <div class="clc-row">
            <input type="color" class="clc-eff-color" value="${escapeHtml(eff.color || "#ffffff")}">
            <input type="text" class="clc-eff-color-text" value="${escapeHtml(eff.color || "#ffffff")}" style="max-width:160px;">
          </div>
        </div>

        <div class="clc-muted">
          Use this with neutral/grayscale textures to produce “Red Leather”, “Black Leather”, etc.
          (Runtime decides best application method.)
        </div>
      `);

            $body.find(".clc-eff-material").on("change", function () {
                eff.material = $(this).val() || "";
                onChange();
            });
            $body.find(".clc-eff-material-multi").on("change", function () {
                eff.materials = $body.find(".clc-eff-material-multi:checked")
                    .map((_, el) => el.value)
                    .get();

                onChange();
            });

            $body.find(".clc-eff-sync-group").on("input", function () {
                eff.syncGroup = $(this).val().trim() || undefined;
                onChange();
            });

            $body.find(".clc-eff-color").on("input", function () {
                eff.color = $(this).val();
                $body.find(".clc-eff-color-text").val(eff.color);
                onChange();
            });

            $body.find(".clc-eff-color-text").on("input", function () {
                eff.color = $(this).val();
                onChange();
            });

            return;
        }

        // MODEL SWAP
        if (eff.type === "model") {
            const modelOpts = models.length
                ? models.map(m => `<option value="${escapeHtml(m.id)}"${m.id === eff.modelId ? " selected" : ""}>${escapeHtml(m.label || m.id)} (${escapeHtml(m.id)})</option>`).join("")
                : `<option value="">(No models defined)</option>`;

            $body.html(`
        <div class="clc-inline">
          <div><strong>Swap To</strong></div>
          <div>
            <select class="clc-eff-model">${modelOpts}</select>
          </div>
        </div>

        <div class="clc-muted">
          Swap the GLB behind the scenes (base, back, size variants, etc).
        </div>
      `);

            $body.find(".clc-eff-model").on("change", function () {
                eff.modelId = $(this).val() || "";
                onChange();
            });

            return;
        }

        // PRICE
        if (eff.type === "price") {
            $body.html(`
        <div class="clc-inline">
          <div><strong>Price Change</strong></div>
          <div class="clc-row">
            <span>$</span>
            <input type="number" step="0.01" class="clc-eff-delta" value="${escapeHtml(eff.delta ?? 0)}" style="max-width:160px;">
            <span class="clc-muted">(positive or negative)</span>
          </div>
        </div>
      `);

            $body.find(".clc-eff-delta").on("input", function () {
                eff.delta = parseFloat($(this).val()) || 0;
                onChange();
            });

            return;
        }

        // SHOW/HIDE MATERIAL
        if (eff.type === "showMaterial" || eff.type === "hideMaterial") {
            $body.html(`
        <div class="clc-inline">
          <div><strong>Target Material</strong></div>
          <div>${materialSelectHtml(eff.material || "")}</div>
        </div>

        <div class="clc-muted">
          ${eff.type === "hideMaterial"
                    ? "Hide this material when selected."
                    : "Show this material when selected."}
        </div>
      `);

            $body.find(".clc-eff-material").on("change", function () {
                eff.material = $(this).val() || "";
                onChange();
            });

            return;
        }

        // Fallback
        $body.html(`<div class="clc-muted">Unknown effect type.</div>`);
    }

    // -----------------------------
    // Init
    // -----------------------------
    $(document).ready(function () {
        // Hide legacy single-GLB URL field if present (models are handled via the Models editor).
        const $legacy = $('#clc_model_url');
        if ($legacy.length) {
            $legacy.hide();
            $legacy.next('button').hide();
            $legacy.closest('tr').hide();
            $legacy.closest('p').hide();
            $legacy.closest('.clc-field').hide();
        }

        setupModelPicker();
        const root = $("#clc-builder-root");
        if (!root.length) return;

        const rawStr = $("#clc_config_json").val();
        const raw = safeParseJSON(rawStr);
        CFG = ensureConfig(raw);

        CFG.root = normalizeNode(CFG.root, true);
        SELECTED_NODE_ID = "root";

        // keep base price synced
        $("#clc_base_price").on("input", function () {
            CFG.basePrice = getBasePrice();
            syncHiddenJSON();
        });

        // Initial sync

        syncHiddenJSON();
        ADMIN_VIEWER = document.querySelector("model-viewer");

        if (ADMIN_VIEWER) {
            ADMIN_VIEWER.addEventListener("load", () => {
                ADMIN_MODEL_READY = true;
            });
        }

        render();
    });
    let EXPANDED_NODE_IDS = new Set();
    function captureExpandedNodes() {
        EXPANDED_NODE_IDS.clear();
        $(".clc-node.expanded").each(function () {
            const id = $(this).data("node-id");
            if (id) EXPANDED_NODE_IDS.add(id);
        });
    }
    function restoreExpandedNodes() {
        EXPANDED_NODE_IDS.forEach(id => {
            const $node = $(`.clc-node[data-node-id="${CSS.escape(id)}"]`);
            if ($node.length) {
                $node.addClass("expanded");
                $node.find(".clc-node-toggle").text("▾");
            }
        });
    }
    /**
     * Reset only what preview touched (baseColorFactor, texture, alphaMode).
     * (Your existing resetPreview was not restoring textures at all :contentReference[oaicite:4]{index=4})
     */
    function resetPreview() {
        if (!ADMIN_VIEWER || !ADMIN_MODEL_READY) return;

        PREVIEW_TOUCHED.forEach(name => {
            const mat = ADMIN_VIEWER.model?.materials?.find(m => m.name === name);
            const orig = PREVIEW_ORIG.get(name);
            const pbr = mat?.pbrMetallicRoughness;

            if (!mat || !pbr || !orig) return;

            // restore original factor
            pbr.setBaseColorFactor(orig.baseColorFactor || [1, 1, 1, 1]);

            // restore original texture (runtime-style)
            if (pbr.baseColorTexture?.setTexture) {
                pbr.baseColorTexture.setTexture(orig.texture || null);
            }

            // restore alpha mode
            mat.setAlphaMode(orig.alphaMode || "OPAQUE");
            mat.needsUpdate = true;
        });

        PREVIEW_TOUCHED.clear();
        PREVIEW_ORIG.clear();

        // revert model swap only if we actually swapped
        if (CFG.models?.length && ADMIN_VIEWER.src !== CFG.models[0].src) {
            ADMIN_MODEL_READY = false;

            ADMIN_VIEWER.addEventListener("load", () => {
                ADMIN_MODEL_READY = true;

                // after reverting, re-apply last preview selection if any
                if (LAST_PREVIEW_NODE_ID) {
                    const n = findNodeByIdDeep(LAST_PREVIEW_NODE_ID);
                    if (n) updatePreviewForSelection(n);
                }
            }, { once: true });

            ADMIN_VIEWER.src = CFG.models[0].src;
        }
    }

    function applyPreviewEffects(node, epoch) {
        if (!ADMIN_VIEWER || !ADMIN_MODEL_READY) return;
        if (!node?.effects?.length) return;

        node.effects.forEach(eff => {
            switch (eff.type) {

                case "model": {
                    if (!eff.modelId) break;

                    const m = (CFG.models || []).find(x => x.id === eff.modelId);
                    if (!m?.src) break;

                    if (ADMIN_VIEWER.src !== m.src) {
                        // swap model and re-run preview after load
                        ADMIN_MODEL_READY = false;

                        ADMIN_VIEWER.addEventListener("load", () => {
                            ADMIN_MODEL_READY = true;

                            // re-run the current preview selection on the new model
                            if (LAST_PREVIEW_NODE_ID) {
                                const n = findNodeByIdDeep(LAST_PREVIEW_NODE_ID);
                                if (n) updatePreviewForSelection(n);
                            }
                        }, { once: true });

                        ADMIN_VIEWER.src = m.src;
                    }
                    break;
                }

                case "colorize": {
                    const mat = ADMIN_VIEWER.model?.materials?.find(m => m.name === eff.material);
                    const pbr = mat?.pbrMetallicRoughness;
                    if (!mat || !pbr) break;

                    markTouched(mat);

                    // runtime clears texture on colorize :contentReference[oaicite:7]{index=7}
                    if (pbr.baseColorTexture?.setTexture) {
                        pbr.baseColorTexture.setTexture(null);
                    }

                    pbr.setBaseColorFactor(hexToRGBA(eff.color || "#ffffff"));
                    mat.needsUpdate = true;
                    break;
                }

                case "texture": {
                    if (!eff.url) break;

                    // runtime allows materials[] OR material OR fallback all materials :contentReference[oaicite:8]{index=8}
                    let materialNames = [];
                    if (Array.isArray(eff.materials) && eff.materials.length) {
                        materialNames = eff.materials;
                    } else if (eff.material) {
                        materialNames = [eff.material];
                    } else {
                        materialNames = (ADMIN_VIEWER.model?.materials || []).map(m => m.name);
                    }

                    getPreviewTexture(eff.url).then(texture => {
                        if (!texture) return;
                        if (epoch !== PREVIEW_MATERIAL_EPOCH) return; // ignore stale async

                        materialNames.forEach(name => {
                            const mat = ADMIN_VIEWER.model?.materials?.find(m => m.name === name);
                            const pbr = mat?.pbrMetallicRoughness;
                            if (!mat || !pbr) return;

                            markTouched(mat);

                            // ✅ runtime-style texture application :contentReference[oaicite:9]{index=9}
                            if (pbr.baseColorTexture?.setTexture) {
                                pbr.baseColorTexture.setTexture(texture);
                            }

                            if (eff.mode === "recolorable") {
                                pbr.setBaseColorFactor(hexToRGBA(eff.color || "#ffffff"));
                            } else {
                                pbr.setBaseColorFactor([1, 1, 1, 1]);
                            }

                            mat.setAlphaMode("OPAQUE");
                            mat.needsUpdate = true;
                        });
                    });

                    break;
                }

                case "hideMaterial": {
                    const mat = ADMIN_VIEWER.model?.materials?.find(m => m.name === eff.material);
                    const pbr = mat?.pbrMetallicRoughness;
                    if (!mat || !pbr) break;

                    markTouched(mat);

                    const c = [...(pbr.baseColorFactor || [1, 1, 1, 1])];
                    c[3] = 0;

                    mat.setAlphaMode("BLEND");
                    pbr.setBaseColorFactor(c);
                    mat.needsUpdate = true;
                    break;
                }

                case "showMaterial": {
                    const mat = ADMIN_VIEWER.model?.materials?.find(m => m.name === eff.material);
                    const pbr = mat?.pbrMetallicRoughness;
                    if (!mat || !pbr) break;

                    markTouched(mat);

                    const c = [...(pbr.baseColorFactor || [1, 1, 1, 1])];
                    c[3] = 1;

                    mat.setAlphaMode("OPAQUE");
                    pbr.setBaseColorFactor(c);
                    mat.needsUpdate = true;
                    break;
                }
            }
        });
    }

    function hexToRGBA(hex) {
        const c = hex.replace("#", "");
        const bigint = parseInt(c, 16);
        return [
            ((bigint >> 16) & 255) / 255,
            ((bigint >> 8) & 255) / 255,
            (bigint & 255) / 255,
            1
        ];
    }
    function updatePreviewForSelection(node) {
        // be a little defensive: admin currently uses document.querySelector("model-viewer") :contentReference[oaicite:10]{index=10}
        // If the page ever has >1 model-viewer, this helps.
        if (!ADMIN_VIEWER) {
            ADMIN_VIEWER =
                document.getElementById("clc-admin-model-viewer") ||
                document.querySelector("model-viewer");
        }

        if (!ADMIN_VIEWER || !ADMIN_MODEL_READY) return;

        if (!node || node.id === "root") {
            LAST_PREVIEW_NODE_ID = null;
            return;
        }

        if (node.id === LAST_PREVIEW_NODE_ID) return;

        LAST_PREVIEW_NODE_ID = node.id;

        PREVIEW_MATERIAL_EPOCH++;
        const epoch = PREVIEW_MATERIAL_EPOCH;

        resetPreview();

        const chain = getNodeAncestry(node);
        chain.forEach(n => applyPreviewEffects(n, epoch));
    }

    function getNodeAncestry(node) {
        const chain = [];
        let cur = node;

        while (cur && cur.id !== "root") {
            chain.unshift(cur);
            cur = findParentOf(cur.id);
        }

        return chain;
    }
    function markTouched(mat) {
        if (!mat) return;
        if (PREVIEW_TOUCHED.has(mat.name)) return;

        const pbr = mat.pbrMetallicRoughness;
        const origTex = pbr?.baseColorTexture?.texture ?? null;

        PREVIEW_ORIG.set(mat.name, {
            baseColorFactor: [...(pbr?.baseColorFactor || [1, 1, 1, 1])],
            texture: origTex,
            alphaMode: mat.alphaMode || "OPAQUE"
        });

        PREVIEW_TOUCHED.add(mat.name);
    }

})(jQuery);