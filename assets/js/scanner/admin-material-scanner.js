(function ($) {
    const SELECTORS = {
        configJson: '#_configurator_config_json',
        modelUrl: '#_configurator_model_url',
        materialsList: '#materials-list',
        scanButton: '#scan-materials',
        adminViewer: '#admin-model-viewer',
    };

    /**
     * CurrentLuxury — Admin Material Scanner
     *
     * Goals:
     * - Manual scan button works exactly like before (same viewer, scan, render).
     * - Auto-scan runs automatically when the builder updates config JSON, and builds a UNION of materials
     *   across all CFG.models using the SAME preview <model-viewer> (sequentially, with safe timeouts).
     * - Does not rely on the legacy #model_url field (it may be hidden).
     */

    // -----------------------------
    // Global registry (shared)
    // -----------------------------
    window.MATERIALS = window.MATERIALS || {
        list: [],
        original: new Map()
    };

    let mv = null;

    // -----------------------------
    // Utilities
    // -----------------------------
    function readCfg() {
        const raw = $(SELECTORS.configJson).val();
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    function getModelsFromConfigJSON() {
        const cfg = readCfg();
        const models = Array.isArray(cfg?.models) ? cfg.models : [];
        return models
            .map(m => ({
                id: String(m?.id || ''),
                label: String(m?.label || ''),
                src: String(m?.src || '')
            }))
            .filter(m => m.id && m.src);
    }

    function resetMaterialsVisual() {
        if (!mv || !mv.model || !mv.model.materials) return;

        mv.model.materials.forEach(mat => {
            const orig = window.MATERIALS.original.get(mat.name);
            if (!orig) return;

            if (mat.pbrMetallicRoughness && orig.pbr) {
                mat.pbrMetallicRoughness.setBaseColorFactor(orig.pbr.baseColor);
            }
            if (orig.emissive) {
                mat.setEmissiveFactor(orig.emissive);
            }
        });
    }

    function highlightMaterial(name) {
        if (!mv || !mv.model || !mv.model.materials) return;

        mv.model.materials.forEach(mat => {
            if (!mat.pbrMetallicRoughness) return;

            if (mat.name === name) {
                mat.pbrMetallicRoughness.setBaseColorFactor([0.15, 0.9, 0.25, 1]);
                mat.setEmissiveFactor([0.15, 0.9, 0.25]);
            } else {
                mat.pbrMetallicRoughness.setBaseColorFactor([0.1, 0.1, 0.1, 1]);
                mat.setEmissiveFactor([0, 0, 0]);
            }
        });
    }

    // -----------------------------
    // Material scan (core logic)
    // -----------------------------
    async function scanMaterials(viewer, { clearOriginal = true } = {}) {
        if (!viewer || !viewer.model || !viewer.model.materials) return [];

        const mats = viewer.model.materials;
        const names = new Set();

        if (clearOriginal) window.MATERIALS.original.clear();

        mats.forEach(m => {
            names.add(m.name);

            if (m.pbrMetallicRoughness) {
                // Capture original (only if not already captured)
                if (!window.MATERIALS.original.has(m.name)) {
                    window.MATERIALS.original.set(m.name, {
                        pbr: {
                            baseColor: [...m.pbrMetallicRoughness.baseColorFactor]
                        },
                        emissive: m.emissiveFactor ? [...m.emissiveFactor] : null
                    });
                }
            }
        });

        return Array.from(names).sort();
    }

    // -----------------------------
    // UI Rendering
    // -----------------------------
    function renderMaterialsUI(materials) {
        const $wrap = $(SELECTORS.materialsList);
        if (!$wrap.length) return;

        if (!materials || !materials.length) {
            $wrap.html('<em>No materials detected.</em>');
            return;
        }

        const $grid = $('<div class="material-grid"></div>');

        materials.forEach(name => {
            const safe = String(name);
            const $card = $(
                '<div class="material-card" data-mat="' + safe.replaceAll('"', '&quot;') + '">' +
                '  <div class="material-name">' + safe + '</div>' +
                '</div>'
            );

            $card.on('mouseenter', () => highlightMaterial(name));
            $card.on('mouseleave', resetMaterialsVisual);
            $grid.append($card);
        });

        $wrap.empty().append(
            '<p><strong>Materials detected in model</strong></p>',
            '<p><em>Hover to highlight on the model.</em></p>',
            $grid
        );

        // expose list
        window.MATERIALS.list = materials.slice();
    }

    // -----------------------------
    // Model loading helpers
    // -----------------------------
    function waitForViewerToLoad(url, timeoutMs = 25000) {
        return new Promise((resolve, reject) => {
            if (!mv) return reject(new Error('no viewer'));

            let done = false;
            const cleanup = () => {
                clearTimeout(timer);
                mv.removeEventListener('load', onLoad);
                mv.removeEventListener('error', onError);
            };

            const finish = (ok, err) => {
                if (done) return;
                done = true;
                cleanup();
                ok ? resolve(true) : reject(err || new Error('error'));
            };

            const onLoad = async () => {
                try { await mv.updateComplete; } catch { }
                finish(true);
            };
            const onError = () => finish(false, new Error('error'));

            const timer = setTimeout(() => finish(false, new Error('timeout')), timeoutMs);

            const cur = mv.getAttribute('src') || '';
            if (mv.model && cur === url) {
                onLoad();
                return;
            }

            mv.addEventListener('load', onLoad);
            mv.addEventListener('error', onError);

            if (cur !== url) mv.setAttribute('src', url);
        });
    }

    async function scanUrlOnMainViewer(url, { clearOriginal } = {}) {
        await waitForViewerToLoad(url);
        const names = await scanMaterials(mv, { clearOriginal });
        return names;
    }

    // -----------------------------
    // Auto scan (union across all models)
    // -----------------------------
    let AUTO_SCAN_TIMER = null;
    let AUTO_SCAN_TOKEN = 0;

    function scheduleAutoScan() {
        if (AUTO_SCAN_TIMER) clearTimeout(AUTO_SCAN_TIMER);
        AUTO_SCAN_TIMER = setTimeout(autoScanAllModels, 250);
    }

    async function autoScanAllModels() {
        if (!mv) return;

        const token = ++AUTO_SCAN_TOKEN;
        const models = getModelsFromConfigJSON();
        const $wrap = $(SELECTORS.materialsList);

        if (!models.length) {
            $wrap.html('<em>No model URLs yet — add a model, then materials will auto-scan.</em>');
            return;
        }

        const prevSrc = mv.getAttribute('src') || '';
        $wrap.html('<em>Scanning ' + models.length + ' model(s)…</em>');

        const union = new Set();
        // Do NOT clear original across models; we want to preserve the first time we see each mat name.
        window.MATERIALS.original.clear();

        for (let i = 0; i < models.length; i++) {
            const m = models[i];

            if (token !== AUTO_SCAN_TOKEN) {
                $wrap.html('<em>Scan canceled.</em>');
                return;
            }

            try {
                $wrap.html('<em>Scanning ' + (i + 1) + ' / ' + models.length + '…</em>');
                const names = await scanUrlOnMainViewer(m.src, { clearOriginal: false });
                names.forEach(n => union.add(n));
            } catch (e) {
                console.warn('[Scanner] Failed to scan model', m.src, e);
            }
        }

        // Restore preview src
        if (prevSrc) {
            try { mv.setAttribute('src', prevSrc); } catch { }
        }

        const list = Array.from(union).sort();
        renderMaterialsUI(list);
    }

    // -----------------------------
    // Wiring
    // -----------------------------
    function setupScanner() {
        mv = document.querySelector(SELECTORS.adminViewer);
        if (!mv) return;

        const $scanBtn = $(SELECTORS.scanButton);
        const $modelUrlInput = $(SELECTORS.modelUrl);

        // Manual scan button
        $scanBtn.on('click', async function () {
            const cfg = readCfg();
            const models = Array.isArray(cfg?.models) ? cfg.models : [];
            const current = mv.getAttribute('src') || '';
            const fallback = models[0]?.src ? String(models[0].src) : '';
            const direct = $modelUrlInput.length ? String($modelUrlInput.val() || '') : '';

            const url = current || fallback || direct;
            if (!url) {
                alert('Please choose a GLB model first.');
                return;
            }

            $scanBtn.prop('disabled', true);
            $(SELECTORS.materialsList).html('<em>Scanning model…</em>');

            try {
                await scanUrlOnMainViewer(url, { clearOriginal: true });
                const list = window.MATERIALS.list = Array.from(new Set(window.MATERIALS.list)).sort();
                // scanUrlOnMainViewer returns names, but we also want to render from current scan
                const names = await scanMaterials(mv, { clearOriginal: false });
                renderMaterialsUI(names);
            } catch (e) {
                console.error(e);
                $(SELECTORS.materialsList).html('<em>Error loading model.</em>');
            } finally {
                $scanBtn.prop('disabled', false);
            }
        });

        // Auto-scan whenever the builder writes config JSON
        $(document).on('config-updated', scheduleAutoScan);

        // Reverse highlight (viewer → UI)
        mv.addEventListener('material-change', (e) => {
            resetMaterialsVisual();
            const n = e && e.detail && e.detail.material ? e.detail.material.name : null;
            if (!n) return;
            $('.material-card').removeClass('active');
            $('.material-card[data-mat="' + n.replaceAll('"', '&quot;') + '"]').addClass('active');
        });
    }

    $(document).ready(function () {
        setupScanner();
    });

})(jQuery);
