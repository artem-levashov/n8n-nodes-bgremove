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
const toBuffer = (v) => {
    if (Buffer.isBuffer(v))
        return v;
    if (v && typeof v === 'object') {
        if (ArrayBuffer.isView(v))
            return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
        const d = v.data;
        if (d && (Array.isArray(d) || ArrayBuffer.isView(d)))
            return Buffer.from(d);
    }
    if (typeof v === 'string')
        return Buffer.from(v, 'binary');
    return Buffer.from([]);
};
async function callTB(input, ext, engine, dbg) {
    var _a;
    const mod = await Promise.resolve().then(() => __importStar(require('transparent-background')));
    const tb = (_a = mod.transparentBackground) !== null && _a !== void 0 ? _a : mod.default;
    dbg.exportKeys = Object.keys(mod);
    dbg.funcType = typeof tb;
    dbg.engine = engine || 'auto';
    if (typeof tb !== 'function')
        throw new Error('transparent-background export not found');
    const opts = { fast: true };
    if (engine)
        opts.engine = engine;
    // try signature #1
    try {
        const r = await tb(input, ext, opts);
        const b = toBuffer(r);
        if (b.length)
            return b;
        dbg.s1 = 'empty';
    }
    catch (e) {
        dbg.s1err = (e === null || e === void 0 ? void 0 : e.message) || String(e);
    }
    // try signature #2
    try {
        const r = await tb(input, { format: ext, ...opts });
        const b = toBuffer(r);
        if (b.length)
            return b;
        dbg.s2 = 'empty';
    }
    catch (e) {
        dbg.s2err = (e === null || e === void 0 ? void 0 : e.message) || String(e);
    }
    throw new Error('No output from transparent-background');
}
class RemoveBg {
    constructor() {
        this.description = {
            displayName: 'Remove Background (Minimal)',
            name: 'removeBgMinimal',
            icon: 'file:assets/icon.svg',
            group: ['transform'],
            version: 3,
            description: 'Remove image background with transparent-background (WASM). No extra options.',
            defaults: { name: 'Remove Background (Minimal)' },
            inputs: ['main'],
            outputs: ['main'],
            properties: [
                { displayName: 'Binary Property', name: 'binaryPropertyName', type: 'string', default: 'data' },
                { displayName: 'Output Format', name: 'outputFormat', type: 'options',
                    options: [{ name: 'PNG', value: 'png' }, { name: 'JPEG', value: 'jpeg' }, { name: 'WEBP', value: 'webp' }],
                    default: 'png' },
                { displayName: 'New Binary Property', name: 'newBinaryPropertyName', type: 'string', default: 'bg_removed' },
            ],
        };
    }
    async execute() {
        const items = this.getInputData();
        const out = [];
        // ensure temp is writable
        process.env.TMPDIR = process.env.TMPDIR || '/tmp';
        process.env.TEMP = process.env.TEMP || '/tmp';
        for (let i = 0; i < items.length; i++) {
            const dbg = { step: 'start' };
            try {
                const binKey = this.getNodeParameter('binaryPropertyName', i, 'data');
                const newKey = this.getNodeParameter('newBinaryPropertyName', i, 'bg_removed');
                const format = this.getNodeParameter('outputFormat', i, 'png');
                const item = items[i];
                if (!item.binary || !item.binary[binKey])
                    throw new Error(`No binary property '${binKey}'.`);
                const input = await this.helpers.getBinaryDataBuffer(i, binKey);
                dbg.inputBytes = input.length;
                const ext = (format === 'jpeg') ? 'jpg' : format;
                let output = null;
                // Try wasm first, then "auto" (no engine) to let lib pick fallback.
                try {
                    output = await callTB(input, ext, 'wasm', dbg);
                }
                catch (e) {
                    dbg.wasmFail = (e === null || e === void 0 ? void 0 : e.message) || String(e);
                }
                if (!output || output.length === 0) {
                    try {
                        output = await callTB(input, ext, undefined, dbg);
                    }
                    catch (e) {
                        dbg.autoFail = (e === null || e === void 0 ? void 0 : e.message) || String(e);
                    }
                }
                if (!output || output.length === 0)
                    throw new Error('No output files');
                const src = item.binary[binKey];
                const base = (src.fileName || 'image').replace(/\.[^.]+$/, '');
                const outExt = (format === 'jpeg') ? 'jpg' : format;
                const mime = (format === 'jpeg') ? 'image/jpeg' : `image/${format}`;
                const newItem = { json: { ...item.json }, binary: item.binary || {} };
                newItem.binary[newKey] = await this.helpers.prepareBinaryData(output, `${base}.${outExt}`);
                newItem.binary[newKey].mimeType = mime;
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
