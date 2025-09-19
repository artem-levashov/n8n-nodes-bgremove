"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoveBg = void 0;
function toBuffer(v) {
    if (Buffer.isBuffer(v))
        return v;
    if (v && typeof v === 'object') {
        if (ArrayBuffer.isView(v))
            return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
        if (v instanceof ArrayBuffer)
            return Buffer.from(v);
        // some libs return { data: number[] }
        if (v.data && Array.isArray(v.data))
            return Buffer.from(v.data);
    }
    if (typeof v === 'string')
        return Buffer.from(v, 'binary');
    return Buffer.from(v || []);
}
function pickFn(mod) {
    if (!mod)
        return null;
    if (typeof mod.transparentBackground === 'function')
        return mod.transparentBackground;
    if (mod.default) {
        if (typeof mod.default.transparentBackground === 'function')
            return mod.default.transparentBackground;
        if (typeof mod.default === 'function')
            return mod.default;
    }
    if (typeof mod === 'function')
        return mod;
    return null;
}
async function tryOnce(tb, inputBuffer, format, opts) {
    const fn = pickFn(tb);
    if (!fn)
        throw new Error('transparent-background entry function not found');
    const res = await fn(inputBuffer, format, opts || {});
    const out = toBuffer(res);
    if (!out || !out.length)
        throw new Error('transparentBackground returned empty output');
    return out;
}
class RemoveBg {
    constructor() {
        this.description = {
            displayName: 'Remove Background (Local)',
            name: 'removeBgLocal',
            icon: 'file:assets/icon.svg',
            group: ['transform'],
            version: 2,
            description: 'Remove image background using the transparent-background npm package',
            defaults: { name: 'Remove Background (Local)' },
            inputs: ['main'],
            outputs: ['main'],
            properties: [
                {
                    displayName: 'Binary Property',
                    name: 'binaryPropertyName',
                    type: 'string',
                    default: 'data',
                    description: 'Name of the binary property that contains the input image',
                },
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
                {
                    displayName: 'New Binary Property',
                    name: 'newBinaryPropertyName',
                    type: 'string',
                    default: 'bg_removed',
                },
                {
                    displayName: 'Fast Mode',
                    name: 'fast',
                    type: 'boolean',
                    default: false,
                },
                {
                    displayName: 'Engine Preference',
                    name: 'enginePref',
                    type: 'options',
                    options: [
                        { name: 'Auto', value: 'auto' },
                        { name: 'WASM', value: 'wasm' },
                        { name: 'ONNX Runtime', value: 'onnx' },
                    ],
                    default: 'auto',
                    description: 'Hint for the library engine; ignored if not supported by the installed version.',
                },
                {
                    displayName: 'Write Debug (_bgremove)',
                    name: 'writeDebug',
                    type: 'boolean',
                    default: true,
                },
            ],
        };
    }
    async execute() {
        const items = this.getInputData();
        const out = [];
        for (let i = 0; i < items.length; i++) {
            const dbg = { step: 'start', tries: [] };
            try {
                const binKey = this.getNodeParameter('binaryPropertyName', i);
                const newKey = this.getNodeParameter('newBinaryPropertyName', i);
                const format = this.getNodeParameter('outputFormat', i);
                const fast = this.getNodeParameter('fast', i);
                const enginePref = this.getNodeParameter('enginePref', i);
                const writeDebug = this.getNodeParameter('writeDebug', i);
                const item = items[i];
                if (!item.binary || !item.binary[binKey]) {
                    throw new Error(`Item ${i} has no binary property '${binKey}'.`);
                }
                const inputBuffer = (await this.helpers.getBinaryDataBuffer(i, binKey));
                dbg.inputBytes = Buffer.byteLength(inputBuffer);
                // lazy require to keep startup light
                let tb;
                try {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    tb = require('transparent-background');
                    dbg.moduleLoaded = true;
                    dbg.moduleKeys = Object.keys(tb || {});
                }
                catch {
                    throw new Error('transparent-background is not installed in this package');
                }
                // build retry plan
                const optSets = [];
                const base = { fast: !!fast, engine: enginePref !== 'auto' ? enginePref : undefined };
                optSets.push(base);
                optSets.push({ fast: !base.fast, engine: base.engine });
                if (enginePref !== 'wasm')
                    optSets.push({ fast: false, engine: 'wasm' });
                if (enginePref !== 'onnx')
                    optSets.push({ fast: false, engine: 'onnx' });
                if (format !== 'png')
                    optSets.push({ fast: base.fast, engine: base.engine, __forcePng: true });
                let output = null;
                let usedFormat = format;
                for (const opts of optSets) {
                    const attempt = { opts: { ...opts } };
                    try {
                        const f = opts.__forcePng ? 'png' : format;
                        const res = await tryOnce(tb, inputBuffer, f, { fast: opts.fast, engine: opts.engine });
                        output = res;
                        usedFormat = f;
                        attempt.ok = true;
                        dbg.tries.push(attempt);
                        break;
                    }
                    catch (e) {
                        attempt.err = (e === null || e === void 0 ? void 0 : e.message) || String(e);
                        dbg.tries.push(attempt);
                    }
                }
                if (!output || !output.length) {
                    throw new Error('transparentBackground produced no output after retries');
                }
                const srcInfo = items[i].binary[binKey];
                const baseName = (srcInfo.fileName || 'image').replace(/\.[^.]+$/, '');
                const ext = usedFormat === 'jpeg' ? 'jpg' : usedFormat;
                const mime = usedFormat === 'jpeg' ? 'image/jpeg' : `image/${usedFormat}`;
                const newItem = { json: { ...item.json }, binary: item.binary || {} };
                newItem.binary[newKey] = await this.helpers.prepareBinaryData(output, `${baseName}.${ext}`);
                newItem.binary[newKey].mimeType = mime;
                if (writeDebug) {
                    newItem.json._bgremove = { ok: true, inputBytes: dbg.inputBytes, tries: dbg.tries };
                }
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
