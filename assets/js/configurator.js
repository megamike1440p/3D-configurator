(function () {

    /**
     * CurrentLuxury Configurator Runtime
     *
     * Responsibilities:
     * - Render UI from choice tree (in layers)
     * - Track selections
     * - Evaluate visibility rules
     * - Apply effects to model-viewer
     * - Support model swapping without user awareness
     *
     * Key behavior changes:
     * - ROOT renders a group of top-level choices (so Leather/Velvet are clickable)
     * - Nodes can be "selectable" or "category-only" (selectable:false)
     * - Texture application correctly awaits model-viewer createTexture()
     */

    // -----------------------------
    // Utilities
    // -----------------------------
    function $(sel, root = document) { return root.querySelector(sel); }
    function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

    function safeJSON(str) { try { return JSON.parse(str); } catch { return null; } }

    const CONFIG_DEBUG = true;

    function dbg(...args) {
        if (CONFIG_DEBUG) console.log(...args);
    }

    function dumpMat(name) {
        const m = MATERIAL_CACHE[name];
        if (!m || !m.pbrMetallicRoughness) {
            dbg("dumpMat: material missing or no PBR", name, m);
            return;
        }
        const pbr = m.pbrMetallicRoughness;

        dbg("dumpMat:", name, {
            alphaMode: m.alphaMode,
            baseColorFactor: pbr.baseColorFactor,
            hasBaseColorTex: !!pbr.baseColorTexture,
            baseColorTex: pbr.baseColorTexture,
            emissiveFactor: m.emissiveFactor
        });
    }

    function hexToRGBA(hex) {
        if (!hex) return [1, 1, 1, 1];
        const h = hex.replace("#", "");
        const bigint = parseInt(h, 16);
        if (h.length === 6) {
            return [
                ((bigint >> 16) & 255) / 255,
                ((bigint >> 8) & 255) / 255,
                (bigint & 255) / 255,
                1
            ];
        }
        return [1, 1, 1, 1];
    }

    function isSelectable(node) {
        // default true unless explicitly false
        return node?.selectable !== false;
    }

    // -----------------------------
    // Runtime State
    // -----------------------------
    let CFG;
    let MV;
    let CURRENT_MODEL_ID = null;

    // One-viewer multi-model warm loading
    const MODEL_SRC_BY_ID = new Map(); // modelId -> src
    const ORIGINAL_MATERIALS_BY_MODEL = new Map(); // modelId -> { name -> {baseColor, texture, emissive} }
    let IS_MODEL_SWAPPING = false;
    let PENDING_MODEL_ID = null;

    let MATERIAL_CACHE = {};      // name -> material
    let ORIGINAL_MATERIALS = {};  // name -> { baseColor, texture, emissive }
    let SELECTIONS = new Set();   // selected node ids

    let PRICE_DELTA = 0;
    let MATERIAL_EPOCH = 0;

    // Texture caching (avoid re-downloading on every click)
    const TEXTURE_PROMISES = new Map(); // url -> Promise(texture)
    // -----------------------------
    // Debug exposure
    // -----------------------------
    window.CONFIG = window.CONFIG || {};
    window.CONFIG.dumpMat = dumpMat;
    window.CONFIGC.listMats = () => Object.keys(MATERIAL_CACHE);
    window.CONFIG.mv = () => MV;
    // -----------------------------
    // Init
    // -----------------------------
    document.addEventListener("DOMContentLoaded", () => {
        const root = document.querySelector('[data-configurator="1"]') || document.querySelector("[data-configurator]");
        if (!root) return;

        CFG = safeJSON(root.getAttribute("data-config") || root.dataset.config);

        // Bootstrap brand-new configurators (empty config JSON)
        if (!CFG || !CFG.root) {
            CFG = {
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

        const fallbackModel = root.getAttribute("data-model") || root.dataset.model;

        MV = document.createElement("model-viewer");
        MV.src = CFG.models?.[0]?.src || fallbackModel || "";
        MV.setAttribute("camera-controls", "");
        MV.setAttribute("environment-image", "neutral");

        root.innerHTML = `
      <div class="hm-configurator">
        <div class="hm-viewer"></div>
        <div class="hm-side">
          <div class="price-bar">
            <div class="price-value">$${Number(CFG.basePrice || 0).toFixed(2)}</div>
          </div>
          <div class="ui"></div>
        </div>
      </div>
    `;

        $(".hm-viewer", root).appendChild(MV);

        // Record model sources
        (CFG.models || []).forEach(m => {
            if (!m || !m.id) return;
            MODEL_SRC_BY_ID.set(m.id, String(m.src || ""));
        });

        // Loading overlay
        const viewerWrap = $(".hm-viewer", root);

        const overlay = document.createElement("div");
        overlay.className = "loading";
        overlay.innerHTML = `
          <div class="loading-inner">
            <strong>Loading models…</strong><br>
            <span>Preparing instant swaps</span>
          </div>
        `;
        viewerWrap.appendChild(overlay);

        MV.style.visibility = "hidden";

        // Load a model src and resolve on load/error/timeout
        const warmLoadOne = (src, timeoutMs = 25000) => new Promise((resolve) => {
            if (!src) return resolve();

            let finished = false;
            const finish = async () => {
                if (finished) return;
                finished = true;
                try {
                    if (MV.updateComplete) await MV.updateComplete;
                } catch { /* ignore */ }
                resolve();
            };

            const timer = setTimeout(() => {
                MV.removeEventListener('error', onError);
                finish();
            }, timeoutMs);

            const onError = () => {
                clearTimeout(timer);
                finish();
            };

            MV.addEventListener('load', () => {
                clearTimeout(timer);
                MV.removeEventListener('error', onError);
                finish();
            }, { once: true });

            MV.addEventListener('error', onError, { once: true });

            MV.src = src;
        });

        (async () => {
            const models = (CFG.models || []).filter(m => m && m.id && m.src);
            const first = models.length ? models[0] : null;

            if (first && first.src) {
                // Warm-load: first -> all -> first
                await warmLoadOne(first.src);
                captureOriginalMaterials();
                ORIGINAL_MATERIALS_BY_MODEL.set(first.id, snapshotOriginalMaterials());

                for (const m of models) {
                    if (m.id === first.id) continue;
                    await warmLoadOne(m.src);
                    captureOriginalMaterials();
                    ORIGINAL_MATERIALS_BY_MODEL.set(m.id, snapshotOriginalMaterials());
                }

                // Back to first
                await warmLoadOne(first.src);
                CURRENT_MODEL_ID = first.id;
                captureOriginalMaterials();
                ORIGINAL_MATERIALS_BY_MODEL.set(first.id, snapshotOriginalMaterials());
            }

            // Show UI
            MV.style.visibility = "visible";
            overlay.remove();

            applyDefaults(CFG.root);
            renderUI();
            updateAll();
        })();

    });


    // -----------------------------
    // Camera helpers (keeps swaps seamless even if model-viewer resets camera on load)
    // -----------------------------
    function getCameraState() {
        try {
            if (!MV) return null;
            if (typeof MV.getCameraOrbit === 'function' && typeof MV.getCameraTarget === 'function' && typeof MV.getFieldOfView === 'function') {
                return {
                    orbit: MV.getCameraOrbit(),
                    target: MV.getCameraTarget(),
                    fov: MV.getFieldOfView()
                };
            }
        } catch { /* ignore */ }
        return null;
    }

    function setCameraState(state) {
        try {
            if (!MV || !state) return;
            if (typeof MV.setCameraOrbit === 'function' && state.orbit) MV.setCameraOrbit(state.orbit);
            if (typeof MV.setCameraTarget === 'function' && state.target) MV.setCameraTarget(state.target);
            if (typeof MV.setFieldOfView === 'function' && state.fov) MV.setFieldOfView(state.fov);
        } catch { /* ignore */ }
    }

    // -----------------------------
    // Material Management
    // -----------------------------
    function captureOriginalMaterials() {
        MATERIAL_CACHE = {};
        ORIGINAL_MATERIALS = {};

        if (!MV?.model?.materials) return;

        MV.model.materials.forEach(mat => {
            MATERIAL_CACHE[mat.name] = mat;

            const pbr = mat.pbrMetallicRoughness;
            const texInfo = pbr?.baseColorTexture || null;

            ORIGINAL_MATERIALS[mat.name] = {
                baseColor: pbr?.baseColorFactor ? [...pbr.baseColorFactor] : [1, 1, 1, 1],
                texture: texInfo && texInfo.texture ? texInfo.texture : null,
                emissive: mat.emissiveFactor ? [...mat.emissiveFactor] : [0, 0, 0]
            };
        });
    }


    function snapshotOriginalMaterials() {
        const out = {};
        for (const [name, o] of Object.entries(ORIGINAL_MATERIALS || {})) {
            out[name] = {
                baseColor: Array.isArray(o.baseColor) ? [...o.baseColor] : [1, 1, 1, 1],
                emissive: Array.isArray(o.emissive) ? [...o.emissive] : [0, 0, 0],
                texture: o.texture || null
            };
        }
        return out;
    }


    function resetMaterials() {
        const stored = (CURRENT_MODEL_ID && ORIGINAL_MATERIALS_BY_MODEL.get(CURRENT_MODEL_ID)) || ORIGINAL_MATERIALS;
        Object.entries(stored).forEach(([name, orig]) => {
            const mat = MATERIAL_CACHE[name];
            const pbr = mat?.pbrMetallicRoughness;
            if (!mat || !pbr) return;

            pbr.setBaseColorFactor(orig.baseColor || [1, 1, 1, 1]);

            if (pbr.baseColorTexture && typeof pbr.baseColorTexture.setTexture === "function") {
                pbr.baseColorTexture.setTexture(orig.texture || null);
            }

            mat.setEmissiveFactor(orig.emissive || [0, 0, 0]);
            mat.setAlphaMode("OPAQUE");
            mat.needsUpdate = true;
        });
    }


    // -----------------------------
    // UI Rendering
    // -----------------------------
    function renderUI() {
        const uiRoot = document.querySelector(".ui");
        if (!uiRoot) return;
        uiRoot.innerHTML = "";

        // Render root as a proper group (so top-level choices become buttons)
        renderGroupForNode(CFG.root, uiRoot, { isRoot: true });
    }

    /**
     * Renders a “group” (layer) for a node’s children.
     * - Buttons represent the node’s selectable children
     * - Category-only children (selectable:false) do NOT render a button,
     *   but can still render their own child groups based on visibility.
     */
    function renderGroupForNode(node, container, { isRoot = false } = {}) {
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
            if (!isNodeVisible(child)) return;
            if (!isSelectable(child)) return; // category-only nodes don't render a button

            const btn = document.createElement("div");
            btn.className = "hm-option";
            const hasThumb = !!(child.thumbUrl || child.thumbnailUrl || child.thumb || child.thumbnail);
            const thumbUrl = child.thumbUrl || child.thumbnailUrl || (child.thumb && child.thumb.url) || (child.thumbnail && child.thumbnail.url) || "";
            if (hasThumb) btn.classList.add("has-thumb");
            btn.innerHTML = hasThumb
                ? `
                        <div class="hm-option-thumb">
                            <img class="hm-option-thumb-img" src="${thumbUrl}" alt="" loading="lazy" />
                        </div>
                        <div class="hm-option-label">${child.label || child.id}</div>
                    `
                : `
                        <div class="hm-option-label">${child.label || child.id}</div>
                    `;
            btn.dataset.id = child.id;

            btn.addEventListener("click", () => {
                toggleSelection(child, node);
                updateAll();
            });

            opts.appendChild(btn);
        });

        // Only append options row if it has content (root might have only category-only nodes)
        if (opts.childElementCount) {
            group.appendChild(opts);
        }

        container.appendChild(group);

        // Now render deeper layers.
        // IMPORTANT: We render a child "layer group" when:
        // - the child is visible AND has children AND
        //   - child.selectable === false => it's category-only, so show its children based on its childReveal:
        //       - if childReveal === "always" => show
        //       - if childReveal === "whenSelected" => since it's not selectable, treat as "always"
        //   - child.selectable !== false => show when (child.childReveal === "always") OR (child is selected)
        children.forEach(child => {
            if (!isNodeVisible(child)) return;
            if (!child.children || !child.children.length) return;

            const revealMode = child.childReveal === "always" ? "always" : "whenSelected";

            if (!isSelectable(child)) {
                // category-only: can't be selected, so "whenSelected" doesn't make sense -> treat as always
                renderGroupForNode(child, container, { isRoot: false });
                return;
            }

            if (revealMode === "always" || SELECTIONS.has(child.id)) {
                renderGroupForNode(child, container, { isRoot: false });
            }
        });
    }

    // -----------------------------
    // Selection Logic
    // -----------------------------
    function toggleSelection(node, parent) {
        if (!parent) return;
        if (!isSelectable(node)) return;

        const mode = parent.childSelect === "multi" ? "multi" : "single";

        if (mode === "single") {
            parent.children.forEach(c => {
                if (isSelectable(c)) SELECTIONS.delete(c.id);
            });

            SELECTIONS.add(node.id);

            // 🔥 Apply defaults to newly revealed children
            parent.children.forEach(c => {
                if (SELECTIONS.has(c.id)) applyDefaults(c);
            });
        }
        else {
            SELECTIONS.has(node.id) ? SELECTIONS.delete(node.id) : SELECTIONS.add(node.id);
        }
    }
    const DEFAULT_APPLIED = new Set();

    function applyDefaults(node) {
        if (!node || !Array.isArray(node.children)) return;

        if (node.childSelect === "single" && !DEFAULT_APPLIED.has(node.id)) {
            const selectableChildren = node.children.filter(isSelectable);
            const hasSelection = selectableChildren.some(c => SELECTIONS.has(c.id));

            if (!hasSelection) {
                const def = selectableChildren.find(c => c.default === true);
                if (def) {
                    SELECTIONS.add(def.id);
                    DEFAULT_APPLIED.add(node.id);
                }
            }
        }

        node.children.forEach(applyDefaults);
    }


    function isNodeVisible(node) {
        if (!node?.visibleIf || !node.visibleIf.length) return true;

        return node.visibleIf.every(rule => {
            const selected = SELECTIONS.has(rule.targetId);
            return rule.state === "selected" ? selected : !selected;
        });
    }

    // -----------------------------
    // Effects Engine
    // -----------------------------


    function computeDesiredModelId() {
        let desired = null;
        (function walk(node) {
            if (!node) return;
            if (isNodeActive(node)) {
                for (const eff of (node.effects || [])) {
                    if (eff && eff.type === "model" && eff.modelId) desired = eff.modelId;
                }
            }
            for (const c of (node.children || [])) walk(c);
        })(CFG.root);
        return desired;
    }

    function beginModelSwap(modelId) {
        // Guard: if we are already swapping, let the load handler call updateAll()
        if (IS_MODEL_SWAPPING) return;
        swapModelById(modelId);
    }
    function updateAll() {
        // Decide desired model first (avoid swapping mid-pass)
        const desiredModelId = computeDesiredModelId();
        if (desiredModelId && desiredModelId !== CURRENT_MODEL_ID) {
            beginModelSwap(desiredModelId);
            return;
        }

        MATERIAL_EPOCH++;
        const epoch = MATERIAL_EPOCH;

        resetMaterials();
        PRICE_DELTA = 0;

        // syncState[group] = { url, color, mode }
        const syncState = {};

        // -----------------------------
        // PASS 1: Collect SOURCES
        //   A “source” is a selected texture effect that has a URL.
        //   IMPORTANT: effects can inherit a sync group from ancestors.
        // -----------------------------
        walkWithCtx(CFG.root, { texSyncGroup: "" }, (node, ctx) => {
            if (!isNodeActive(node)) return;


            (node.effects || []).forEach(eff => {
                if (eff.type !== "texture") return;

                const group = eff.syncGroup || ctx.texSyncGroup;
                if (!group) return;

                // Only publish if this effect actually has an image URL
                if (eff.url) {
                    syncState[group] = {
                        url: eff.url,
                        color: eff.color,
                        mode: eff.mode
                    };
                }
            });
        });

        // -----------------------------
        // PASS 2: Apply effects
        //   For “sink” effects (syncGroup but no url),
        //   pull from syncState[group].
        //   Also: do NOT mutate CFG.effects in-place.
        // -----------------------------
        walkWithCtx(CFG.root, { texSyncGroup: "" }, (node, ctx) => {
            if (!isNodeActive(node)) return;


            const effects = (node.effects || []).map(e0 => {
                // clone so we never mutate the config JSON
                const e = { ...e0 };

                if (e.type === "texture") {
                    const group = e.syncGroup || ctx.texSyncGroup;

                    if (e.type === "texture") {
                        const group = e.syncGroup || ctx.texSyncGroup;

                        if (group && syncState[group]) {
                            const src = syncState[group];

                            // "Sink" = has syncGroup but no url
                            const isSink = !e.url;

                            // Always inherit URL for sinks
                            if (isSink) {
                                e.url = src.url;
                            }

                            // Inherit mode if missing (both sink + source)
                            if (!e.mode) {
                                e.mode = src.mode;
                            }

                            // ✅ Color syncing rule:
                            // If this is a sink, ALWAYS inherit color from the group
                            // (so arms->wood gets the chosen color from wood-finish->light)
                            if (isSink) {
                                e.color = src.color;
                            }
                        }
                    }

                }

                return e;
            });

            applyEffects(effects, epoch);
        });

        updatePrice();
        updateUIStates();
        renderUI();
        updateUIStates();
    }


    function walkWithCtx(node, ctx, fn) {
        // Inherit the nearest texture syncGroup found on ANY ancestor node
        // (even if that ancestor node is not selectable / never “selected”).
        let nextCtx = { ...(ctx || {}) };

        const texSyncHere = (node.effects || []).find(e => e.type === "texture" && e.syncGroup)?.syncGroup;
        if (texSyncHere) nextCtx.texSyncGroup = texSyncHere;

        fn(node, nextCtx);
        (node.children || []).forEach(c => walkWithCtx(c, nextCtx, fn));
    }

    function applyEffects(effects, epoch) {
        if (!effects?.length) return;
        dbg("applyEffects", effects);

        effects.forEach(eff => {
            dbg("effect", eff);
            switch (eff.type) {
                case "price":
                    PRICE_DELTA += Number(eff.delta || 0);
                    break;

                case "model":
                    // Model selection is handled up-front in updateAll() to avoid mid-pass swaps.
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

    // -----------------------------
    // Effect Implementations
    // -----------------------------
    function hideMaterial(name) {
        const mat = MATERIAL_CACHE[name];
        const pbr = mat?.pbrMetallicRoughness;
        if (!mat || !pbr) return;

        const c = [...pbr.baseColorFactor];
        c[3] = 0;

        mat.setAlphaMode("BLEND");
        pbr.setBaseColorFactor(c);
        mat.needsUpdate = true;
    }


    function showMaterial(name) {
        const mat = MATERIAL_CACHE[name];
        const pbr = mat?.pbrMetallicRoughness;
        if (!mat || !pbr) return;

        const c = [...pbr.baseColorFactor];
        c[3] = 1;

        mat.setAlphaMode("OPAQUE");
        pbr.setBaseColorFactor(c);
        mat.needsUpdate = true;
    }


    function applyTextureEffect(eff, epoch) {
        let materialNames = [];

        if (Array.isArray(eff.materials) && eff.materials.length) {
            materialNames = eff.materials;
        } else if (eff.material) {
            materialNames = [eff.material];
        } else {
            // 🔥 fallback: apply to ALL materials
            materialNames = Object.keys(MATERIAL_CACHE);
        }


        if (!eff.url) return;

        getTexture(eff.url).then(texture => {
            if (!texture) return;
            if (epoch !== MATERIAL_EPOCH) return;

            materialNames.forEach(name => {
                const mat = MATERIAL_CACHE[name];
                const pbr = mat?.pbrMetallicRoughness;
                if (!mat || !pbr) return;

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
    }

    function getTexture(url) {
        if (!url) return Promise.resolve(null);
        if (TEXTURE_PROMISES.has(url)) return TEXTURE_PROMISES.get(url);

        const p = MV.createTexture(url);
        TEXTURE_PROMISES.set(url, p);
        return p;
    }


    function applyColor(name, hex) {
        const mat = MATERIAL_CACHE[name];
        const pbr = mat?.pbrMetallicRoughness;
        if (!mat || !pbr || !hex) return;

        if (pbr.baseColorTexture && typeof pbr.baseColorTexture.setTexture === "function") {
            pbr.baseColorTexture.setTexture(null);
        }

        pbr.setBaseColorFactor(hexToRGBA(hex));
        mat.needsUpdate = true;
    }

    function swapModelById(modelId) {
        if (!modelId) return;
        if (IS_MODEL_SWAPPING && PENDING_MODEL_ID === modelId) return;
        if (modelId === CURRENT_MODEL_ID) return;

        const src = MODEL_SRC_BY_ID.get(modelId) || (CFG.models || []).find(m => m.id === modelId)?.src || "";
        if (!src) {
            dbg("swapModelById: missing src for", modelId);
            return;
        }

        IS_MODEL_SWAPPING = true;
        PENDING_MODEL_ID = modelId;

        const cam = getCameraState();

        MV.addEventListener("load", () => {
            // On load, restore camera and refresh material caches
            setCameraState(cam);

            CURRENT_MODEL_ID = modelId;
            captureOriginalMaterials();
            ORIGINAL_MATERIALS_BY_MODEL.set(modelId, snapshotOriginalMaterials());

            IS_MODEL_SWAPPING = false;
            PENDING_MODEL_ID = null;

            // Re-apply selections/effects on the newly loaded model
            updateAll();
        }, { once: true });

        MV.src = src;
    }

    function swapModel(model) {
        if (!model) return;
        swapModelById(model.id);
    }

    // -----------------------------
    // UI Sync
    // -----------------------------
    function updateUIStates() {
        // 1. Apply defaults for newly reachable groups
        applyDefaults(CFG.root);

        // 2. Reflect state into the UI
        $all(".hm-option").forEach(el => {
            el.classList.toggle("active", SELECTIONS.has(el.dataset.id));
        });
    }


    function updatePrice() {
        const base = Number(CFG.basePrice || 0);
        const total = base + PRICE_DELTA;
        const el = $(".price-value");
        if (el) el.textContent = `$${total.toFixed(2)}`;
    }
    function isNodeActive(node) {
        // root is always active
        if (node.id === "root") return true;

        if (!SELECTIONS.has(node.id)) return false;

        let p = findParent(node.id);
        while (p) {
            // 🔥 stop at root — it never blocks
            if (p.id === "root") return true;

            // selectable parents must be selected
            if (isSelectable(p) && !SELECTIONS.has(p.id)) return false;

            p = findParent(p.id);
        }
        return true;
    }

    function findParent(childId, node = CFG.root) {
        if (!node.children) return null;

        for (const c of node.children) {
            if (c.id === childId) return node;
            const found = findParent(childId, c);
            if (found) return found;
        }
        return null;
    }

})();
