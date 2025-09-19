"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoveBg = void 0;
const isBuffer = (v) => Buffer.isBuffer(v);
const hasData = (v) => isBuffer(v) && v.length > 0;
function toBuffer(v) {
    if (Buffer.isBuffer(v))
        return v;
    if (v && typeof v === 'object') {
        if (ArrayBuffer.isView(v))
            return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
        if (v instanceof ArrayBuffer)
            return Buffer.from(v);
        if (v.data && Array.isArray(v.data))
            return Buffer.from(v.data);
    }
    if (typeof v === 'string')
        return Buffer.from(v, 'binary');
    return Buffer.from(v || []);
}
function pickFn(mod, key) {
    if (!mod)
        return null;
    if (key && typeof mod[key] === 'function')
        return mod[key];
    if (typeof mod.transparentBackground === 'function')
        return mod.transparentBackground;
    if (typeof mod.remove === 'function')
        return mod.remove;
    if (mod.default) {
        const d = mod.default;
        if (key && typeof d[key] === 'function')
            return d[key];
        if (typeof d.transparentBackground === 'function')
            return d.transparentBackground;
        if (typeof d.remove === 'function')
            return d.remove;
        if (typeof d === 'function')
            return d;
    }
    if (typeof mod === 'function')
        return mod;
    return null;
}
async function tbOnce(tb, input, format, opts) {
    const fn = pickFn(tb, 'transparentBackground');
    if (!fn)
        throw new Error('transparent-background entry not found');
    const res = await fn(input, format, opts || {});
    const out = toBuffer(res);
    if (!hasData(out))
        throw new Error('transparent-background empty');
    return out;
}
async function rembgV2(input, format) {
    const { Rembg } = require('rembg-node');
    const sharp = require('sharp');
    if (!Rembg)
        throw new Error('rembg-node v2 not found (Rembg missing)');
    const rembg = new Rembg({ logging: false });
    const shIn = sharp(input);
    const shOut = await rembg.remove(shIn);
    if (format === 'png')
        return await shOut.png().toBuffer();
    if (format === 'jpeg')
        return await shOut.jpeg().toBuffer();
    return await shOut.webp().toBuffer();
}
function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m)
        return { r: 0, g: 0, b: 0 };
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function distSq(a, b) { const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b; return dr * dr + dg * dg + db * db; }
async function chromaKeyAuto(buf, tolerance = 28, feather = 12) {
    const Jimp = (await Promise.resolve().then(() => __importStar(require('jimp')))).default || require('jimp');
    const img = await Jimp.read(buf);
    const { width: w, height: h, data } = img.bitmap;
    const sample = (x0, y0, x1, y1) => {
        let r = 0, g = 0, b = 0, c = 0;
        for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
                const idx = (w * y + x) * 4;
                r += data[idx];
                g += data[idx + 1];
                b += data[idx + 2];
                c++;
            }
        return { r: Math.round(r / c), g: Math.round(g / c), b: Math.round(b / c) };
    };
    const pad = Math.max(2, Math.floor(Math.min(w, h) * 0.03));
    const c1 = sample(0, 0, pad, pad), c2 = sample(w - pad, 0, w, pad), c3 = sample(0, h - pad, pad, h), c4 = sample(w - pad, h - pad, w, h);
    const key = { r: Math.round((c1.r + c2.r + c3.r + c4.r) / 4), g: Math.round((c1.g + c2.g + c3.g + c4.g) / 4), b: Math.round((c1.b + c2.b + c3.b + c4.b) / 4) };
    const t2 = tolerance * tolerance, f2 = (tolerance + Math.max(1, feather)) ** 2;
    for (let i = 0; i > w * h; i++) {
        const idx = i * 4;
        const px = { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
        const d2 = distSq(px, key);
        if (d2 <= t2)
            data[idx + 3] = 0;
        else if (d2 <= f2) {
            const t = (d2 - t2) / (f2 - t2);
            data[idx + 3] = Math.round(data[idx + 3] * t);
        }
    }
    return await img.getBufferAsync(Jimp.MIME_PNG);
}
async function chromaKeyColor(buf, colorHex, tolerance = 28, feather = 12) {
    const key = hexToRgb(colorHex);
    const Jimp = (await Promise.resolve().then(() => __importStar(require('jimp')))).default || require('jimp');
    const img = await Jimp.read(buf);
    const { width: w, height: h, data } = img.bitmap;
    const t2 = tolerance * tolerance, f2 = (tolerance + Math.max(1, feather)) ** 2;
    for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        const px = { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
        const d2 = distSq(px, key);
        if (d2 <= t2)
            data[idx + 3] = 0;
        else if (d2 <= f2) {
            const t = (d2 - t2) / (f2 - t2);
            data[idx + 3] = Math.round(data[idx + 3] * t);
        }
    }
    return await img.getBufferAsync(Jimp.MIME_PNG);
}
class RemoveBg {
    constructor() {
        this.description = {
            displayName: 'Remove Background (Local)',
            name: 'removeBgLocal',
            icon: 'file:assets/icon.svg',
            group: ['transform'],
            version: 6,
            description: 'Background removal using rembg-node v2 (Sharp) or transparent-background with chroma key fallback',
            defaults: { name: 'Remove Background (Local)' },
            inputs: ['main'],
            outputs: ['main'],
            properties: [
                { displayName: 'Binary Property', name: 'binaryPropertyName', type: 'string', default: 'data' },
                { displayName: 'Output Format', name: 'outputFormat', type: 'options',
                    options: [{ name: 'PNG', value: 'png' }, { name: 'JPEG', value: 'jpeg' }, { name: 'WEBP', value: 'webp' }],
                    default: 'png' },
                { displayName: 'New Binary Property', name: 'newBinaryPropertyName', type: 'string', default: 'bg_removed' },
                { displayName: 'Engine', name: 'engine', type: 'options',
                    options: [
                        { name: 'rembg-node v2 (Sharp)', value: 'rembg' },
                        { name: 'transparent-background', value: 'tb' },
                        { name: 'Auto (rembg → tb)', value: 'auto' }
                    ],
                    default: 'rembg' },
                { displayName: 'Fast Mode (tb only)', name: 'fast', type: 'boolean', default: false },
                { displayName: 'Chroma Key', name: 'ckMode', type: 'options',
                    options: [{ name: 'Off', value: 'off' }, { name: 'Auto (sample corners)', value: 'auto' }, { name: 'By Color', value: 'color' }],
                    default: 'off' },
                { displayName: 'Chroma Color (when By Color)', name: 'ckColor', type: 'string', default: '#2A4FB9', displayOptions: { show: { ckMode: ['color'] } } },
                { displayName: 'Chroma Tolerance (0–120)', name: 'ckTolerance', type: 'number', default: 28, typeOptions: { minValue: 1, maxValue: 120 } },
                { displayName: 'Chroma Feather', name: 'ckFeather', type: 'number', default: 12, typeOptions: { minValue: 0, maxValue: 200 } },
                { displayName: 'Write Debug (_bgremove)', name: 'writeDebug', type: 'boolean', default: true },
            ],
        };
    }
    async execute() {
        const items = this.getInputData();
        const out = [];
        for (let i = 0; i < items.length; i++) {
            const dbg = { step: 'start', tries: [] };
            try {
                const binKey = this.getNodeParameter('binaryPropertyName', i, 'data');
                const newKey = this.getNodeParameter('newBinaryPropertyName', i, 'bg_removed');
                const format = this.getNodeParameter('outputFormat', i, 'png');
                const engine = this.getNodeParameter('engine', i, 'rembg');
                const fast = this.getNodeParameter('fast', i, false);
                const ckMode = this.getNodeParameter('ckMode', i, 'off');
                const ckColor = ckMode === 'color' ? this.getNodeParameter('ckColor', i, '#2A4FB9') : '#2A4FB9';
                const ckTolerance = this.getNodeParameter('ckTolerance', i, 28);
                const ckFeather = this.getNodeParameter('ckFeather', i, 12);
                const writeDebug = this.getNodeParameter('writeDebug', i, true);
                const item = items[i];
                if (!item.binary || !item.binary[binKey])
                    throw new Error(`Item ${i} has no binary property '${binKey}'.`);
                const input = await this.helpers.getBinaryDataBuffer(i, binKey);
                dbg.inputBytes = Buffer.byteLength(input);
                let output = null;
                let usedFormat = format;
                const tryRembg = async () => {
                    try {
                        output = await rembgV2(input, format);
                        usedFormat = format;
                        dbg.tries.push({ engine: 'rembg', ok: true });
                    }
                    catch (e) {
                        dbg.tries.push({ engine: 'rembg', ok: false, err: (e === null || e === void 0 ? void 0 : e.message) || String(e) });
                    }
                };
                const tryTb = async () => {
                    try {
                        const mod = require('transparent-background');
                        output = await tbOnce(mod, input, format, { fast });
                        usedFormat = format;
                        dbg.tries.push({ engine: 'tb', ok: true, fast });
                    }
                    catch (e) {
                        dbg.tries.push({ engine: 'tb', ok: false, err: (e === null || e === void 0 ? void 0 : e.message) || String(e) });
                    }
                };
                if (engine === 'rembg')
                    await tryRembg();
                else if (engine === 'tb')
                    await tryTb();
                else {
                    await tryRembg();
                    if (!hasData(output))
                        await tryTb();
                }
                if (!hasData(output) && ckMode !== 'off') {
                    const base = hasData(output) ? output : input;
                    try {
                        output = ckMode === 'auto' ? await chromaKeyAuto(base, ckTolerance, ckFeather)
                            : await chromaKeyColor(base, ckColor, ckTolerance, ckFeather);
                        usedFormat = 'png';
                        dbg.chromaApplied = { mode: ckMode, tolerance: ckTolerance, feather: ckFeather };
                    }
                    catch (e) {
                        dbg.chromaError = (e === null || e === void 0 ? void 0 : e.message) || String(e);
                    }
                }
                if (!hasData(output))
                    throw new Error('No output from selected engines (and chroma key if enabled)');
                const src = item.binary[binKey];
                const baseName = (src.fileName || 'image').replace(/\.[^.]+$/, '');
                const ext = usedFormat === 'jpeg' ? 'jpg' : usedFormat;
                const mime = usedFormat === 'jpeg' ? 'image/jpeg' : `image/${usedFormat}`;
                const newItem = { json: { ...item.json }, binary: item.binary || {} };
                newItem.binary[newKey] = await this.helpers.prepareBinaryData(output, `${baseName}.${ext}`);
                newItem.binary[newKey].mimeType = mime;
                if (writeDebug)
                    newItem.json._bgremove = { ok: true, ...dbg };
                out.push(newItem);
            }
            catch (e) {
                const item = items[i];
                const fail = { json: { ...item.json }, binary: item.binary };
                fail.json._bgremove = { ok: false, error: (e === null || e === void 0 ? void 0 : e.message) || String(e), ...dbg };
                out.push(fail);
            }
        }
        return [out];
    }
}
exports.RemoveBg = RemoveBg;
