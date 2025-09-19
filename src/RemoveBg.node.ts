
import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';

const toBuffer = (v: any): Buffer => {
  if (Buffer.isBuffer(v)) return v;
  if (v && typeof v === 'object') {
    if (ArrayBuffer.isView(v)) return Buffer.from((v as any).buffer, (v as any).byteOffset, (v as any).byteLength);
    const d = (v as any).data;
    if (d && (Array.isArray(d) || ArrayBuffer.isView(d))) return Buffer.from(d as any);
  }
  if (typeof v === 'string') return Buffer.from(v, 'binary');
  return Buffer.from([]);
};

async function runTransparentBackground(input: Buffer, ext: 'png'|'jpg'|'webp', dbg: any): Promise<Buffer> {
  // Dynamic ESM import to support pure-ESM package
  const mod: any = await import('transparent-background');
  const tb: any = mod.transparentBackground ?? mod.default;
  dbg.exportKeys = Object.keys(mod);
  dbg.funcType = typeof tb;

  if (typeof tb !== 'function') throw new Error('transparent-background export not found');

  // Try the README signature first: (input, ext, opts)
  const opts = { engine: 'wasm', fast: true };
  try {
    const r = await tb(input, ext, opts as any);
    const out = toBuffer(r);
    if (out.length) return out;
    dbg.sig1Empty = true;
  } catch (e:any) {
    dbg.sig1Error = e?.message || String(e);
  }

  // Fallback signature: (input, { format, ... })
  try {
    const r = await tb(input, { format: ext, ...opts } as any);
    const out = toBuffer(r);
    if (out.length) return out;
    dbg.sig2Empty = true;
  } catch (e:any) {
    dbg.sig2Error = e?.message || String(e);
  }

  throw new Error('No output from transparent-background');
}

export class RemoveBg implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Remove Background (Minimal)',
    name: 'removeBgMinimal',
    icon: 'file:assets/icon.svg',
    group: ['transform'],
    version: 2,
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

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const dbg: any = { step: 'start' };
      try {
        const binKey = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
        const newKey = this.getNodeParameter('newBinaryPropertyName', i, 'bg_removed') as string;
        const format = this.getNodeParameter('outputFormat', i, 'png') as 'png'|'jpeg'|'webp';

        const item = items[i];
        if (!item.binary || !item.binary[binKey]) throw new Error(`No binary property '${binKey}'.`);
        const input = await this.helpers.getBinaryDataBuffer(i, binKey);
        dbg.inputBytes = input.length;

        const ext = (format === 'jpeg') ? 'jpg' : (format as any);
        const output = await runTransparentBackground(input, ext, dbg);

        const src = item.binary[binKey]!;
        const base = (src.fileName || 'image').replace(/\.[^.]+$/, '');
        const outExt = (format === 'jpeg') ? 'jpg' : format;
        const mime = (format === 'jpeg') ? 'image/jpeg' : `image/${format}`;

        const newItem: INodeExecutionData = { json: { ...item.json }, binary: item.binary || {} };
        newItem.binary![newKey] = await this.helpers.prepareBinaryData(output, `${base}.${outExt}`);
        (newItem.binary![newKey] as any).mimeType = mime;
        (newItem.json as any)._bgremove = { ok: true, ...dbg };
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
