/**
 * Material Manager — reads from and writes to model-viewer materials.
 *
 * Responsibilities:
 * - Capture and snapshot original material state
 * - Reset materials to their original state
 * - Apply texture, color, show/hide effects to named materials
 * - Cache texture promises to avoid redundant network requests
 */
import { state } from './state.js';
import { hexToRGBA, dbg } from './utils.js';

export function dumpMat(name) {
    const m = state.MATERIAL_CACHE[name];
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

export function captureOriginalMaterials() {
    state.MATERIAL_CACHE = {};
    state.ORIGINAL_MATERIALS = {};

    if (!state.MV?.model?.materials) return;

    state.MV.model.materials.forEach(mat => {
        state.MATERIAL_CACHE[mat.name] = mat;

        const pbr = mat.pbrMetallicRoughness;
        const texInfo = pbr?.baseColorTexture || null;

        state.ORIGINAL_MATERIALS[mat.name] = {
            baseColor: pbr?.baseColorFactor ? [...pbr.baseColorFactor] : [1, 1, 1, 1],
            texture: texInfo?.texture ?? null,
            emissive: mat.emissiveFactor ? [...mat.emissiveFactor] : [0, 0, 0]
        };
    });
}

export function snapshotOriginalMaterials() {
    const out = {};
    for (const [name, o] of Object.entries(state.ORIGINAL_MATERIALS || {})) {
        out[name] = {
            baseColor: Array.isArray(o.baseColor) ? [...o.baseColor] : [1, 1, 1, 1],
            emissive: Array.isArray(o.emissive) ? [...o.emissive] : [0, 0, 0],
            texture: o.texture || null
        };
    }
    return out;
}

export function resetMaterials() {
    const stored =
        (state.CURRENT_MODEL_ID && state.ORIGINAL_MATERIALS_BY_MODEL.get(state.CURRENT_MODEL_ID))
        || state.ORIGINAL_MATERIALS;

    Object.entries(stored).forEach(([name, orig]) => {
        const mat = state.MATERIAL_CACHE[name];
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

export function hideMaterial(name) {
    const mat = state.MATERIAL_CACHE[name];
    const pbr = mat?.pbrMetallicRoughness;
    if (!mat || !pbr) return;

    const c = [...pbr.baseColorFactor];
    c[3] = 0;

    mat.setAlphaMode("BLEND");
    pbr.setBaseColorFactor(c);
    mat.needsUpdate = true;
}

export function showMaterial(name) {
    const mat = state.MATERIAL_CACHE[name];
    const pbr = mat?.pbrMetallicRoughness;
    if (!mat || !pbr) return;

    const c = [...pbr.baseColorFactor];
    c[3] = 1;

    mat.setAlphaMode("OPAQUE");
    pbr.setBaseColorFactor(c);
    mat.needsUpdate = true;
}

export function getTexture(url) {
    if (!url) return Promise.resolve(null);
    if (state.TEXTURE_PROMISES.has(url)) return state.TEXTURE_PROMISES.get(url);

    const p = state.MV.createTexture(url).catch(error => {
        state.TEXTURE_PROMISES.delete(url);
        throw error;
    });
    state.TEXTURE_PROMISES.set(url, p);
    return p;
}

export function applyTextureEffect(eff, epoch) {
    let materialNames = [];

    if (Array.isArray(eff.materials) && eff.materials.length) {
        materialNames = eff.materials;
    } else if (eff.material) {
        materialNames = [eff.material];
    } else {
        // Fallback: apply to ALL materials
        materialNames = Object.keys(state.MATERIAL_CACHE);
    }

    if (!eff.url) return;

    getTexture(eff.url).then(texture => {
        if (!texture) return;
        if (epoch !== state.MATERIAL_EPOCH) return;

        materialNames.forEach(name => {
            const mat = state.MATERIAL_CACHE[name];
            const pbr = mat?.pbrMetallicRoughness;
            if (!mat || !pbr) return;

            if (pbr.baseColorTexture?.setTexture) {
                pbr.baseColorTexture.setTexture(texture);
            }

            pbr.setBaseColorFactor(
                eff.mode === "recolorable" ? hexToRGBA(eff.color || "#ffffff") : [1, 1, 1, 1]
            );

            mat.setAlphaMode("OPAQUE");
            mat.needsUpdate = true;
        });
    });
}

export function applyColor(name, hex) {
    const mat = state.MATERIAL_CACHE[name];
    const pbr = mat?.pbrMetallicRoughness;
    if (!mat || !pbr || !hex) return;

    if (pbr.baseColorTexture && typeof pbr.baseColorTexture.setTexture === "function") {
        pbr.baseColorTexture.setTexture(null);
    }

    pbr.setBaseColorFactor(hexToRGBA(hex));
    mat.needsUpdate = true;
}
