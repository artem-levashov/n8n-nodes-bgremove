import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';

/** type guards */
const isBuffer = (v: unknown): v is Buffer => Buffer.isBuffer(v);
const hasData = (v: unknown): v is Buffer => isBuffer(v) && v.length > 0;

/** utils */
function toBuffer(v: any): Buffer {
    if (Buffer.isBuffer(v)) return v;
    if (v && typeof v === 'object') {
        if (ArrayBuffer.isView(v))
            return Buffer.from((v as any).buffer, (v as any).byteOffset, (v as any).byteLength);
        if (v instanceof ArrayBuffer) return Buffer.from(v as ArrayBuffer);
        if ((v as any).data && Array.isArray((v as any).data)) return Buffer.from((v as any).data);
    }
    if (typeof v === 'string') return Buffer.from(v, 'binary');
    return Buffer.from(v || []);
}

function pickFn(mod: any, key?: string): any {
    if (!mod) return null;
    if (key && typeof mod[key] === 'function') return mod[key];
    if (typeof mod.transparentBackground === 'function') return mod.transparentBackground;
    if ((mod as any).default) {
        const d = (mod as any).default;
        if (key && typeof d[key] === 'function') return d[key];
        if (typeof d.transparentBackground === 'function') return d.transparentBackground;
        if (typeof d === 'function') return d;
    }
    if (typeof mod === 'function') return mod;
    return null;
}

/** call transparent-background once */
async function tbOnce(
    tb: any,
    input: Buffer,
    format: 'png' | 'jpeg' | 'webp',
    opts?: any,
) {
    const fn = pickFn(tb, 'transparentBackground');
    if (!fn) throw new Error('transparent-background entry not found');
    const res = await fn(input, format, opts || {});
    const out = toBuffer(res);
    if (!hasData(out)) throw new Error('transparent-background returned empty output');
    return out;
}

/** chroma key */
type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
    const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
    if (!m) return { r: 0, g: 0, b: 0 };
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function distSq(a: RGB, b: RGB): number {
    const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
    return dr * dr + dg * dg + db * db;
}

async function chromaKeyAuto(buf: Buffer, tolerance = 28, feather = 12): Promise<Buffer> {
    const Jimp = (await import('jimp')).default || require('jimp');
    const img = await Jimp.read(buf);
    const { width: w, height: h, data } = img.bitmap as any;

    const sample = (x0: number, y0: number, x1: number, y1: number): RGB => {
        let r = 0, g = 0, b = 0, c = 0;
        for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
                const idx = (w * y + x) * 4;
                r += data[idx]; g += data[idx + 1]; b += data[idx + 2]; c++;
            }
        return { r: Math.round(r / c), g: Math.round(g / c), b: Math.round(b / c) };
    };

    const pad = Math.max(2, Math.floor(Math.min(w, h) * 0.03));
    const c1 = sample(0, 0, pad, pad),
        c2 = sample(w - pad, 0, w, pad),
        c3 = sample(0, h - pad, pad, h),
        c4 = sample(w - pad, h - pad, w, h);

    const key: RGB = {
        r: Math.round((c1.r + c2.r + c3.r + c4.r) / 4),
        g: Math.round((c1.g + c2.g + c3.g + c4.g) / 4),
        b: Math.round((c1.b + c2.b + c3.b + c4.b) / 4),
    };

    const t2 = tolerance * tolerance, f2 = (tolerance + Math.max(1, feather)) ** 2;

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

async function chromaKeyColor(
    buf: Buffer,
    colorHex: string,
    tolerance = 28,
    feather = 12,
): Promise<Buffer> {
    const key = hexToRgb(colorHex);
    const Jimp = (await import('jimp')).default || require('jimp');
    const img = await Jimp.read(buf);
    const { width: w, height: h, data } = img.bitmap as any;

    const t2 = tolerance * tolerance, f2 = (tolerance + Math.max(1, feather)) ** 2;

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

/** post-processing (returns buffer + actual format) */
async function postProcess(
    buf: Buffer,
    format: 'png' | 'jpeg' | 'webp',
    opts: {
        trim: boolean;
        trimThreshold: number;
        margin: number;
        edgeFeather: number;
        bgFill: string | '';
    },
): Promise<{ buffer: Buffer; format: 'png' | 'jpeg' | 'webp' }> {
    const Jimp = (await import('jimp')).default || require('jimp');
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
        const { width: w, height: h, data } = img.bitmap as any;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const a = data[(w * y + x) * 4 + 3];
                if (a > thr) {
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
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
    if (format === 'jpeg' && !fill) fill = '#ffffff';
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
    let mime =
        want === 'png' ? Jimp.MIME_PNG
            : want === 'jpeg' ? Jimp.MIME_JPEG
                : ('image/webp' as any);

    try {
        const out = await img.getBufferAsync(mime);
        return { buffer: out, format: want };
    } catch {
        const outPng = await img.getBufferAsync(Jimp.MIME_PNG);
        return { buffer: outPng, format: 'png' };
    }
}

export class RemoveBg implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Remove Background (Local)',
        name: 'removeBgLocal',
        icon: 'file:assets/icon.svg',
        group: ['transform'],
        version: 8,
        description:
            'Background removal using transparent-background (WASM/ONNX) with chroma key and post-processing',
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

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const out: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            const dbg: any = { step: 'start', tries: [] as any[] };
            try {
                const binKey = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
                const newKey = this.getNodeParameter('newBinaryPropertyName', i, 'bg_removed') as string;
                const format = this.getNodeParameter('outputFormat', i, 'png') as 'png' | 'jpeg' | 'webp';
                const engine = this.getNodeParameter('engine', i, 'wasm') as 'auto' | 'wasm' | 'onnx';
                const fast = this.getNodeParameter('fast', i, true) as boolean;

                const ckMode = this.getNodeParameter('ckMode', i, 'off') as 'off' | 'auto' | 'color';
                const ckColor =
                    ckMode === 'color' ? (this.getNodeParameter('ckColor', i, '#2A4FB9') as string) : '#2A4FB9';
                const ckTolerance = this.getNodeParameter('ckTolerance', i, 28) as number;
                const ckFeather = this.getNodeParameter('ckFeather', i, 12) as number;

                const ppTrim = this.getNodeParameter('ppTrim', i, false) as boolean;
                const ppTrimThreshold = this.getNodeParameter('ppTrimThreshold', i, 10) as number;
                const ppMargin = this.getNodeParameter('ppMargin', i, 0) as number;
                const ppFeather = this.getNodeParameter('ppFeather', i, 0) as number;
                const ppBgFill = this.getNodeParameter('ppBgFill', i, '') as string;

                const writeDebug = this.getNodeParameter('writeDebug', i, true) as boolean;

                const item = items[i];
                if (!item.binary || !item.binary[binKey])
                    throw new Error(`Item ${i} has no binary property '${binKey}'.`);

                const input = await this.helpers.getBinaryDataBuffer(i, binKey);
                dbg.inputBytes = Buffer.byteLength(input);

                let output: Buffer | null = null;
                let usedFormat = format;

                const tryTB = async (fmt: 'png' | 'jpeg' | 'webp', eng: 'wasm' | 'onnx' | undefined) => {
                    const mod = require('transparent-background');
                    const opts: any = { fast };
                    if (eng) opts.engine = eng;
                    try {
                        const buf = await tbOnce(mod, input, fmt, opts);
                        dbg.tries.push({ engine: eng || 'auto', ok: true, fast });
                        return buf;
                    } catch (e: any) {
                        dbg.tries.push({ engine: eng || 'auto', ok: false, err: e?.message || String(e) });
                        return null;
                    }
                };

                if (engine === 'auto') {
                    output = await tryTB(format, 'onnx');
                    if (!hasData(output)) output = await tryTB(format, 'wasm');
                    if (!hasData(output)) output = await tryTB(format, undefined);
                } else {
                    output = await tryTB(format, engine);
                    if (!hasData(output) && engine === 'onnx') output = await tryTB(format, 'wasm');
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
                    } catch (e: any) {
                        dbg.chromaError = e?.message || String(e);
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

                const src = item.binary[binKey]!;
                const baseName = (src.fileName || 'image').replace(/\.[^.]+$/, '');
                const ext = usedFormat === 'jpeg' ? 'jpg' : usedFormat;
                const mime = usedFormat === 'jpeg' ? 'image/jpeg' : `image/${usedFormat}`;

                const newItem: INodeExecutionData = { json: { ...item.json }, binary: item.binary || {} };
                newItem.binary![newKey] = await this.helpers.prepareBinaryData(finalBuf, `${baseName}.${ext}`);
                (newItem.binary![newKey] as any).mimeType = mime;

                if (writeDebug) (newItem.json as any)._bgremove = { ok: true, ...dbg };
                out.push(newItem);
            } catch (e: any) {
                const item = items[i];
                const fail: INodeExecutionData = { json: { ...item.json }, binary: item.binary };
                (fail.json as any)._bgremove = { ok: false, error: e?.message || String(e), ...dbg };
                out.push(fail);
            }
        }
        return [out];
    }
}
