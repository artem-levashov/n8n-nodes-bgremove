import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';

/** ---------- helpers ---------- */
function toBuffer(v: any): Buffer {
    if (Buffer.isBuffer(v)) return v;
    if (v && typeof v === 'object') {
        if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
        if (v instanceof ArrayBuffer) return Buffer.from(v);
        if ((v as any).data && Array.isArray((v as any).data)) return Buffer.from((v as any).data);
    }
    if (typeof v === 'string') return Buffer.from(v, 'binary');
    return Buffer.from(v || []);
}

function pickFn(mod: any): ((buf: Buffer, fmt: string, opts?: any) => any) | null {
    if (!mod) return null;
    if (typeof mod.transparentBackground === 'function') return mod.transparentBackground;
    if (mod.default) {
        if (typeof mod.default.transparentBackground === 'function') return mod.default.transparentBackground;
        if (typeof mod.default === 'function') return mod.default;
    }
    if (typeof mod === 'function') return mod;
    return null;
}

async function tryOnce(
    tb: any,
    inputBuffer: Buffer,
    format: 'png' | 'jpeg' | 'webp',
    opts?: any,
): Promise<Buffer> {
    const fn = pickFn(tb);
    if (!fn) throw new Error('transparent-background entry function not found');
    const res = await fn(inputBuffer, format, opts || {});
    const out = toBuffer(res);
    if (!out || !out.length) throw new Error('transparentBackground returned empty output');
    return out;
}

/** ---------- chroma-key fallback (для ровных фонов) ---------- */
type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return { r: 0, g: 0, b: 0 };
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function distSq(a: RGB, b: RGB): number {
    const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
    return dr * dr + dg * dg + db * db;
}

async function chromaKeyAuto(input: Buffer, tolerance = 28, feather = 12): Promise<Buffer> {
    // jimp import (ESM/CJS совместимо)
    const Jimp = (await import('jimp')).default || require('jimp');
    const img = await Jimp.read(input);
    const { width: w, height: h, data } = img.bitmap as any; // RGBA

    // усредняем цвет по углам (3% стороны, min 2px)
    const sample = (x0: number, y0: number, x1: number, y1: number): RGB => {
        let r = 0, g = 0, b = 0, c = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const idx = (w * y + x) * 4;
            r += data[idx]; g += data[idx + 1]; b += data[idx + 2]; c++;
        }
        return { r: Math.round(r / c), g: Math.round(g / c), b: Math.round(b / c) };
    };
    const pad = Math.max(2, Math.floor(Math.min(w, h) * 0.03));
    const c1 = sample(0, 0, pad, pad);
    const c2 = sample(w - pad, 0, w, pad);
    const c3 = sample(0, h - pad, pad, h);
    const c4 = sample(w - pad, h - pad, w, h);
    const key: RGB = {
        r: Math.round((c1.r + c2.r + c3.r + c4.r) / 4),
        g: Math.round((c1.g + c2.g + c3.g + c4.g) / 4),
        b: Math.round((c1.b + c2.b + c3.b + c4.b) / 4),
    };

    const t2 = tolerance * tolerance;
    const f2 = (tolerance + Math.max(1, feather)) ** 2;

    for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        const px = { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
        const d2 = distSq(px, key);
        if (d2 <= t2) data[idx + 3] = 0;
        else if (d2 <= f2) {
            const t = (d2 - t2) / (f2 - t2); // 0..1
            data[idx + 3] = Math.round(data[idx + 3] * t);
        }
    }
    return await img.getBufferAsync(Jimp.MIME_PNG);
}

async function chromaKeyColor(input: Buffer, colorHex: string, tolerance = 28, feather = 12): Promise<Buffer> {
    const key = hexToRgb(colorHex);
    const Jimp = (await import('jimp')).default || require('jimp');
    const img = await Jimp.read(input);
    const { width: w, height: h, data } = img.bitmap as any;

    const t2 = tolerance * tolerance;
    const f2 = (tolerance + Math.max(1, feather)) ** 2;

    for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        const px = { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
        const d2 = distSq(px, key);
        if (d2 <= t2) data[idx + 3] = 0;
        else if (d2 <= f2) {
            const t = (d2 - t2) / (f2 - t2);
            data[idx + 3] = Math.round(data[idx + 3] * t);
        }
    }
    return await img.getBufferAsync(Jimp.MIME_PNG);
}

/** ---------- Node ---------- */
export class RemoveBg implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Remove Background (Local)',
        name: 'removeBgLocal',
        icon: 'file:assets/icon.svg', // n8n ищет относительно dist/, мы копируем assets → dist/assets
        group: ['transform'],
        version: 3,
        description:
            'Remove image background using the transparent-background npm package, with optional chroma key fallback',
        defaults: { name: 'Remove Background (Local)' },
        inputs: ['main'],
        outputs: ['main'],
        properties: [
            { displayName: 'Binary Property', name: 'binaryPropertyName', type: 'string', default: 'data' },
            { displayName: 'Output Format', name: 'outputFormat', type: 'options',
                options: [{ name: 'PNG', value: 'png' }, { name: 'JPEG', value: 'jpeg' }, { name: 'WEBP', value: 'webp' }],
                default: 'png' },
            { displayName: 'New Binary Property', name: 'newBinaryPropertyName', type: 'string', default: 'bg_removed' },
            { displayName: 'Fast Mode', name: 'fast', type: 'boolean', default: false },
            { displayName: 'Engine Preference', name: 'enginePref', type: 'options',
                options: [{ name: 'Auto', value: 'auto' }, { name: 'WASM', value: 'wasm' }, { name: 'ONNX Runtime', value: 'onnx' }],
                default: 'auto',
                description: 'Hint for the library engine; ignored if not supported by the installed version.' },
            { displayName: 'Write Debug (_bgremove)', name: 'writeDebug', type: 'boolean', default: true },

            // Chroma key (fallback / post-process)
            { displayName: 'Chroma Key', name: 'ckMode', type: 'options',
                options: [
                    { name: 'Off', value: 'off' },
                    { name: 'Auto (sample corners)', value: 'auto' },
                    { name: 'By Color', value: 'color' }
                ],
                default: 'off',
                description: 'Optional fallback to remove near-uniform background by color similarity' },
            { displayName: 'Chroma Color (when By Color)', name: 'ckColor', type: 'string',
                default: '#2A4FB9', displayOptions: { show: { ckMode: ['color'] } } },
            { displayName: 'Chroma Tolerance (0-120)', name: 'ckTolerance', type: 'number',
                default: 28, typeOptions: { minValue: 1, maxValue: 120 } },
            { displayName: 'Chroma Feather (soft edge)', name: 'ckFeather', type: 'number',
                default: 12, typeOptions: { minValue: 0, maxValue: 200 } },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const out: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            const dbg: any = { step: 'start', tries: [] as Array<any> };
            try {
                const binKey = this.getNodeParameter('binaryPropertyName', i) as string;
                const newKey = this.getNodeParameter('newBinaryPropertyName', i) as string;
                const format = this.getNodeParameter('outputFormat', i) as 'png' | 'jpeg' | 'webp';
                const fast = this.getNodeParameter('fast', i) as boolean;
                const enginePref = this.getNodeParameter('enginePref', i) as 'auto' | 'wasm' | 'onnx';
                const writeDebug = this.getNodeParameter('writeDebug', i) as boolean;

                const ckMode = this.getNodeParameter('ckMode', i) as 'off' | 'auto' | 'color';
                const ckColor = this.getNodeParameter('ckColor', i) as string;
                const ckTolerance = this.getNodeParameter('ckTolerance', i) as number;
                const ckFeather = this.getNodeParameter('ckFeather', i) as number;

                const item = items[i];
                if (!item.binary || !item.binary[binKey]) throw new Error(`Item ${i} has no binary property '${binKey}'.`);

                const inputBuffer = (await this.helpers.getBinaryDataBuffer(i, binKey)) as Buffer;
                dbg.inputBytes = Buffer.byteLength(inputBuffer);

                // 1) transparent-background with retries
                let tb: any;
                try { tb = require('transparent-background'); dbg.moduleLoaded = true; dbg.moduleKeys = Object.keys(tb || {}); }
                catch { throw new Error('transparent-background is not installed in this package'); }

                const optSets: Array<{ fast: boolean; engine?: 'wasm'|'onnx'; __forcePng?: boolean }> = [];
                const base = { fast: !!fast, engine: enginePref !== 'auto' ? (enginePref as 'wasm'|'onnx') : undefined };
                optSets.push(base);
                optSets.push({ fast: !base.fast, engine: base.engine });
                if (enginePref !== 'wasm') optSets.push({ fast: false, engine: 'wasm' });
                if (enginePref !== 'onnx') optSets.push({ fast: false, engine: 'onnx' });
                if (format !== 'png') optSets.push({ fast: base.fast, engine: base.engine, __forcePng: true });

                let output: Buffer | null = null;
                let usedFormat = format;

                for (const opts of optSets) {
                    const attempt: any = { opts: { ...opts } };
                    try {
                        const f = opts.__forcePng ? 'png' : format;
                        const res = await tryOnce(tb, inputBuffer, f, { fast: opts.fast, engine: opts.engine });
                        output = res; usedFormat = f; attempt.ok = true; dbg.tries.push(attempt); break;
                    } catch (e: any) { attempt.err = e?.message || String(e); dbg.tries.push(attempt); }
                }

                // 2) Optional chroma key (fallback or post-process)
                if (ckMode !== 'off') {
                    const baseForCk = output?.length ? output : inputBuffer;
                    try {
                        if (ckMode === 'auto') {
                            output = await chromaKeyAuto(baseForCk, ckTolerance, ckFeather);
                        } else {
                            output = await chromaKeyColor(baseForCk, ckColor, ckTolerance, ckFeather);
                        }
                        usedFormat = 'png';
                        dbg.chromaApplied = { mode: ckMode, tolerance: ckTolerance, feather: ckFeather };
                    } catch (e: any) {
                        dbg.chromaError = e?.message || String(e);
                    }
                }

                if (!output || !output.length) throw new Error('No output after segmentation/chroma-key');

                // write binary
                const srcInfo = items[i].binary![binKey]!;
                const baseName = (srcInfo.fileName || 'image').replace(/\.[^.]+$/, '');
                const ext = usedFormat === 'jpeg' ? 'jpg' : usedFormat;
                const mime = usedFormat === 'jpeg' ? 'image/jpeg' : `image/${usedFormat}`;

                const newItem: INodeExecutionData = { json: { ...item.json }, binary: item.binary || {} };
                newItem.binary![newKey] = await this.helpers.prepareBinaryData(output, `${baseName}.${ext}`);
                newItem.binary![newKey].mimeType = mime;

                if (writeDebug) (newItem.json as any)._bgremove = { ok: true, inputBytes: dbg.inputBytes, tries: dbg.tries, chroma: dbg.chromaApplied, chromaError: dbg.chromaError };
                out.push(newItem);
            } catch (e: any) {
                const item = items[i];
                const fail: INodeExecutionData = { json: { ...item.json }, binary: item.binary };
                (fail.json as any)._bgremove = { ok: false, error: e?.message || String(e) };
                out.push(fail);
            }
        }

        return [out];
    }
}
