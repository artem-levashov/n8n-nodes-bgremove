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
/** type guards */
const isBuffer = (v) => Buffer.isBuffer(v);
const hasData = (v) => isBuffer(v) && v.length > 0;
/** utils */
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
    if (mod.default) {
        const d = mod.default;
        if (key && typeof d[key] === 'function')
            return d[key];
        if (typeof d.transparentBackground === 'function')
            return d.transparentBackground;
        if (typeof d === 'function')
            return d;
    }
    if (typeof mod === 'function')
        return mod;
    return null;
}
/** call transparent-background once */
async function tbOnce(tb, input, format, opts) {
    const fn = pickFn(tb, 'transparentBackground');
    if (!fn)
        throw new Error('transparent-background entry not found');
    const res = await fn(input, format, opts || {});
    const out = toBuffer(res);
    if (!hasData(out))
        throw new Error('transparent-background returned empty output');
    return out;
}
function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
    if (!m)
        return { r: 0, g: 0, b: 0 };
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function distSq(a, b) {
    const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
    return dr * dr + dg * dg + db * db;
}
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
    const key = {
        r: Math.round((c1.r + c2.r + c3.r + c4.r) / 4),
        g: Math.round((c1.g + c2.g + c3.g + c4.g) / 4),
        b: Math.round((c1.b + c2.b + c3.b + c4.b) / 4),
    };
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
/** post-processing (returns buffer + actual format) */
async function postProcess(buf, format, opts) {
    const Jimp = (await Promise.resolve().then(() => __importStar(require('jimp')))).default || require('jimp');
    let img = await Jimp.read(buf);
    img.rgba(true);
    // Edge feather (cheap global blur)
    if (opts.edgeFeather && opts.edgeFeather > 0) {
        const r = Math.max(1, Math.min(100, Math.round(opts.edgeFeather)));
        img = img.blur(r);
    }
    // Trim transparent borders
    if (opts.trim) {
        const thr = Math.max(0, Math.min(255, Math.round(opts.trimThreshold || 10)));
        const { width: w, height: h, data } = img.bitmap;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const a = data[(w * y + x) * 4 + 3];
                if (a > thr) {
                    if (x < minX)
                        minX = x;
                    if (y < minY)
                        minY = y;
                    if (x > maxX)
                        maxX = x;
                    if (y > maxY)
                        maxY = y;
                }
            }
        }
        if (maxX >= minX && maxY >= minY) {
            const cw = maxX - minX + 1;
            const ch = maxY - minY + 1;
            // Jimp 0.22: crop(x, y, w, h)
            img = img.crop(minX, minY, cw, ch);
            const m = Math.max(0, Math.round(opts.margin || 0));
            if (m > 0) {
                const canvas = new Jimp({ width: cw + m * 2, height: ch + m * 2, color: 0x00000000 });
                canvas.composite(img, m, m);
                img = canvas;
            }
        }
    }
    // Background fill / flatten (for JPEG always flatten)
    let fill = (opts.bgFill || '').trim();
    if (format === 'jpeg' && !fill)
        fill = '#ffffff';
    if (fill) {
        const rgb = hexToRgb(fill);
        const bg = new Jimp({
            width: img.bitmap.width,
            height: img.bitmap.height,
            color: Jimp.rgbaToInt(rgb.r, rgb.g, rgb.b, 255),
        });
        bg.composite(img, 0, 0);
        img = bg;
    }
    // Output — без Jimp.MIME_WEBP; если WebP не поддерживается, фолбэк в PNG
    const want = format;
    let mime = want === 'png' ? Jimp.MIME_PNG
        : want === 'jpeg' ? Jimp.MIME_JPEG
            : 'image/webp';
    try {
        const out = await img.getBufferAsync(mime);
        return { buffer: out, format: want };
    }
    catch {
        const outPng = await img.getBufferAsync(Jimp.MIME_PNG);
        return { buffer: outPng, format: 'png' };
    }
}
class RemoveBg {
    constructor() {
        this.description = {
            displayName: 'Remove Background (Local)',
            name: 'removeBgLocal',
            icon: 'file:assets/icon.svg',
            group: ['transform'],
            version: 8,
            description: 'Background removal using transparent-background (WASM/ONNX) with chroma key and post-processing',
            defaults: { name: 'Remove Background (Local)' },
            inputs: ['main'],
            outputs: ['main'],
            properties: [
                { displayName: 'Binary Property', name: 'binaryPropertyName', type: 'string', default: 'data' },
                {
                    displayName: 'Output Format',
                    name: 'outputFormat',
                    type: 'options',
                    options: [
                        { name: 'PNG', value: 'png' },
                        { name: 'JPEG', value: 'jpeg' },
                        { name: 'WEBP', value: 'webp' },
                    ],
                    default: 'png',
                },
                { displayName: 'New Binary Property', name: 'newBinaryPropertyName', type: 'string', default: 'bg_removed' },
                {
                    displayName: 'Engine Preference',
                    name: 'engine',
                    type: 'options',
                    options: [
                        { name: 'Auto', value: 'auto' },
                        { name: 'WASM (portable, Alpine ok)', value: 'wasm' },
                        { name: 'ONNX Runtime (faster, needs glibc)', value: 'onnx' },
                    ],
                    default: 'wasm',
                    description: 'WASM works everywhere (incl. Alpine). ONNX may be faster but needs glibc.',
                },
                { displayName: 'Fast Mode', name: 'fast', type: 'boolean', default: true },
                {
                    displayName: 'Chroma Key',
                    name: 'ckMode',
                    type: 'options',
                    options: [
                        { name: 'Off', value: 'off' },
                        { name: 'Auto (sample corners)', value: 'auto' },
                        { name: 'By Color', value: 'color' },
                    ],
                    default: 'off',
                },
                {
                    displayName: 'Chroma Color (when By Color)',
                    name: 'ckColor',
                    type: 'string',
                    default: '#2A4FB9',
                    displayOptions: { show: { ckMode: ['color'] } },
                },
                {
                    displayName: 'Chroma Tolerance (0–120)',
                    name: 'ckTolerance',
                    type: 'number',
                    default: 28,
                    typeOptions: { minValue: 1, maxValue: 120 },
                },
                {
                    displayName: 'Chroma Feather',
                    name: 'ckFeather',
                    type: 'number',
                    default: 12,
                    typeOptions: { minValue: 0, maxValue: 200 },
                },
                // Post-processing
                { displayName: 'Trim Transparent Borders', name: 'ppTrim', type: 'boolean', default: false },
                {
                    displayName: 'Trim Alpha Threshold (0–255)',
                    name: 'ppTrimThreshold',
                    type: 'number',
                    default: 10,
                    typeOptions: { minValue: 0, maxValue: 255 },
                    displayOptions: { show: { ppTrim: [true] } },
                },
                {
                    displayName: 'Trim Margin (px)',
                    name: 'ppMargin',
                    type: 'number',
                    default: 0,
                    typeOptions: { minValue: 0, maxValue: 200 },
                    displayOptions: { show: { ppTrim: [true] } },
                },
                {
                    displayName: 'Edge Feather (blur px)',
                    name: 'ppFeather',
                    type: 'number',
                    default: 0,
                    typeOptions: { minValue: 0, maxValue: 100 },
                },
                {
                    displayName: 'Background Fill (hex, optional)',
                    name: 'ppBgFill',
                    type: 'string',
                    default: '',
                    description: 'e.g. #FFFFFF. JPEG will auto-flatten to white if left empty.',
                },
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
                const engine = this.getNodeParameter('engine', i, 'wasm');
                const fast = this.getNodeParameter('fast', i, true);
                const ckMode = this.getNodeParameter('ckMode', i, 'off');
                const ckColor = ckMode === 'color' ? this.getNodeParameter('ckColor', i, '#2A4FB9') : '#2A4FB9';
                const ckTolerance = this.getNodeParameter('ckTolerance', i, 28);
                const ckFeather = this.getNodeParameter('ckFeather', i, 12);
                const ppTrim = this.getNodeParameter('ppTrim', i, false);
                const ppTrimThreshold = this.getNodeParameter('ppTrimThreshold', i, 10);
                const ppMargin = this.getNodeParameter('ppMargin', i, 0);
                const ppFeather = this.getNodeParameter('ppFeather', i, 0);
                const ppBgFill = this.getNodeParameter('ppBgFill', i, '');
                const writeDebug = this.getNodeParameter('writeDebug', i, true);
                const item = items[i];
                if (!item.binary || !item.binary[binKey])
                    throw new Error(`Item ${i} has no binary property '${binKey}'.`);
                const input = await this.helpers.getBinaryDataBuffer(i, binKey);
                dbg.inputBytes = Buffer.byteLength(input);
                let output = null;
                let usedFormat = format;
                const tryTB = async (fmt, eng) => {
                    const mod = require('transparent-background');
                    const opts = { fast };
                    if (eng)
                        opts.engine = eng;
                    try {
                        const buf = await tbOnce(mod, input, fmt, opts);
                        dbg.tries.push({ engine: eng || 'auto', ok: true, fast });
                        return buf;
                    }
                    catch (e) {
                        dbg.tries.push({ engine: eng || 'auto', ok: false, err: (e === null || e === void 0 ? void 0 : e.message) || String(e) });
                        return null;
                    }
                };
                if (engine === 'auto') {
                    output = await tryTB(format, 'onnx');
                    if (!hasData(output))
                        output = await tryTB(format, 'wasm');
                    if (!hasData(output))
                        output = await tryTB(format, undefined);
                }
                else {
                    output = await tryTB(format, engine);
                    if (!hasData(output) && engine === 'onnx')
                        output = await tryTB(format, 'wasm');
                }
                // Chroma key fallback
                if (!hasData(output) && ckMode !== 'off') {
                    try {
                        output =
                            ckMode === 'auto'
                                ? await chromaKeyAuto(input, ckTolerance, ckFeather)
                                : await chromaKeyColor(input, ckColor, ckTolerance, ckFeather);
                        usedFormat = 'png';
                        dbg.chromaApplied = { mode: ckMode, tolerance: ckTolerance, feather: ckFeather };
                    }
                    catch (e) {
                        dbg.chromaError = (e === null || e === void 0 ? void 0 : e.message) || String(e);
                    }
                }
                if (!hasData(output))
                    throw new Error('No output from transparent-background (and chroma key if enabled)');
                // Post-process (returns buffer + possibly changed format)
                const pp = await postProcess(output, usedFormat, {
                    trim: ppTrim,
                    trimThreshold: ppTrimThreshold,
                    margin: ppMargin,
                    edgeFeather: ppFeather,
                    bgFill: ppBgFill,
                });
                usedFormat = pp.format;
                const finalBuf = pp.buffer;
                const src = item.binary[binKey];
                const baseName = (src.fileName || 'image').replace(/\.[^.]+$/, '');
                const ext = usedFormat === 'jpeg' ? 'jpg' : usedFormat;
                const mime = usedFormat === 'jpeg' ? 'image/jpeg' : `image/${usedFormat}`;
                const newItem = { json: { ...item.json }, binary: item.binary || {} };
                newItem.binary[newKey] = await this.helpers.prepareBinaryData(finalBuf, `${baseName}.${ext}`);
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
