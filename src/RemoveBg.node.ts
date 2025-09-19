
import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { existsSync } from 'fs';
import { dirname, join } from 'path';

const isBuffer = (v: unknown): v is Buffer => Buffer.isBuffer(v);
const hasData  = (v: unknown): v is Buffer => isBuffer(v) && v.length > 0;

function toBuffer(v: any): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (v && typeof v === 'object') {
    if (ArrayBuffer.isView(v)) return Buffer.from((v as any).buffer, (v as any).byteOffset, (v as any).byteLength);
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
  if (typeof mod.remove === 'function') return mod.remove;
  if ((mod as any).default) {
    const d = (mod as any).default;
    if (key && typeof d[key] === 'function') return d[key];
    if (typeof d.transparentBackground === 'function') return d.transparentBackground;
    if (typeof d.remove === 'function') return d.remove;
    if (typeof d === 'function') return d;
  }
  if (typeof mod === 'function') return mod;
  return null;
}
async function tbOnce(tb: any, input: Buffer, format: 'png'|'jpeg'|'webp', opts?: any) {
  const fn = pickFn(tb, 'transparentBackground');
  if (!fn) throw new Error('transparent-background entry not found');
  const res = await fn(input, format, opts || {});
  const out = toBuffer(res);
  if (!hasData(out)) throw new Error('transparent-background empty');
  return out;
}
async function rembgOnce(mod: any, input: Buffer) {
  const fn = pickFn(mod, 'remove');
  if (!fn) throw new Error('rembg-node remove() not found');
  const res = await fn(input);
  const out = toBuffer(res);
  if (!hasData(out)) throw new Error('rembg-node empty');
  return out;
}
function canLoadRembg(): boolean {
  try {
    const pkg = require.resolve('rembg-node/package.json');
    const dir = dirname(pkg);
    return existsSync(join(dir, 'dist', 'index.js'));
  } catch { return false; }
}

/** chroma key helpers omitted here for brevity — but include in full build **/
type RGB = { r:number; g:number; b:number };
function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r:0, g:0, b:0 };
  const n = parseInt(m[1], 16);
  return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
}
function distSq(a: RGB, b: RGB): number { const dr=a.r-b.r, dg=a.g-b.g, db=a.b-b.b; return dr*dr+dg*dg+db*db; }
async function chromaKeyAuto(buf: Buffer, tolerance=28, feather=12): Promise<Buffer> {
  const Jimp = (await import('jimp')).default || require('jimp');
  const img = await Jimp.read(buf);
  const { width:w, height:h, data } = img.bitmap as any;
  const sample = (x0:number,y0:number,x1:number,y1:number): RGB => {
    let r=0,g=0,b=0,c=0; for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++){ const idx=(w*y+x)*4; r+=data[idx]; g+=data[idx+1]; b+=data[idx+2]; c++; }
    return { r:Math.round(r/c), g:Math.round(g/c), b:Math.round(b/c) };
  };
  const pad=Math.max(2, Math.floor(Math.min(w,h)*0.03));
  const c1=sample(0,0,pad,pad), c2=sample(w-pad,0,w,pad), c3=sample(0,h-pad,pad,h), c4=sample(w-pad,h-pad,w,h);
  const key: RGB = { r:Math.round((c1.r+c2.r+c3.r+c4.r)/4), g:Math.round((c1.g+c2.g+c3.g+c4.g)/4), b:Math.round((c1.b+c2.b+c3.b+c4.b)/4) };
  const t2=tolerance*tolerance, f2=(tolerance+Math.max(1,feather))**2;
  for(let i=0;i<w*h;i++){ const idx=i*4; const px={r:data[idx],g:data[idx+1],b:data[idx+2]}; const d2=distSq(px,key);
    if(d2<=t2) data[idx+3]=0; else if(d2<=f2){ const t=(d2-t2)/(f2-t2); data[idx+3]=Math.round(data[idx+3]*t); } }
  return await img.getBufferAsync(Jimp.MIME_PNG);
}
async function chromaKeyColor(buf: Buffer, colorHex:string, tolerance=28, feather=12): Promise<Buffer> {
  const key=hexToRgb(colorHex);
  const Jimp = (await import('jimp')).default || require('jimp');
  const img = await Jimp.read(buf);
  const { width:w, height:h, data } = img.bitmap as any;
  const t2=tolerance*tolerance, f2=(tolerance+Math.max(1,feather))**2;
  for(let i=0;i<w*h;i++){ const idx=i*4; const px={r:data[idx],g:data[idx+1],b:data[idx+2]}; const d2=distSq(px,key);
    if(d2<=t2) data[idx+3]=0; else if(d2<=f2){ const t=(d2-t2)/(f2-t2); data[idx+3]=Math.round(data[idx+3]*t); } }
  return await img.getBufferAsync(Jimp.MIME_PNG);
}

export class RemoveBg implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Remove Background (Local)',
    name: 'removeBgLocal',
    icon: 'file:assets/icon.svg',
    group: ['transform'],
    version: 5,
    description: 'Background removal using rembg-node or transparent-background with chroma key fallback',
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
        options: [{ name: 'Auto (rembg-node → tb)', value: 'auto' }, { name: 'rembg-node (JS)', value: 'rembg' }, { name: 'transparent-background', value: 'tb' }],
        default: 'auto' },
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

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const dbg: any = { step: 'start', tries: [] as any[] };
      try {
        const binKey = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
        const newKey = this.getNodeParameter('newBinaryPropertyName', i, 'bg_removed') as string;
        const format = this.getNodeParameter('outputFormat', i, 'png') as 'png'|'jpeg'|'webp';
        const engine = this.getNodeParameter('engine', i, 'auto') as 'auto'|'rembg'|'tb';
        const fast = this.getNodeParameter('fast', i, false) as boolean;
        const ckMode = this.getNodeParameter('ckMode', i, 'off') as 'off'|'auto'|'color';
        const ckColor = ckMode === 'color' ? (this.getNodeParameter('ckColor', i, '#2A4FB9') as string) : '#2A4FB9';
        const ckTolerance = this.getNodeParameter('ckTolerance', i, 28) as number;
        const ckFeather = this.getNodeParameter('ckFeather', i, 12) as number;
        const writeDebug = this.getNodeParameter('writeDebug', i, true) as boolean;

        const item = items[i];
        if (!item.binary || !item.binary[binKey]) throw new Error(`Item ${i} has no binary property '${binKey}'.`);

        const input = await this.helpers.getBinaryDataBuffer(i, binKey);
        dbg.inputBytes = Buffer.byteLength(input);

        let output: Buffer | null = null;
        let usedFormat = format;

        const tryRembg = async () => {
          if (!canLoadRembg()) throw new Error('rembg-node dist missing (not built)');
          const mod = require('rembg-node');
          dbg.rembgKeys = Object.keys(mod || {});
          output = await rembgOnce(mod, input);
          usedFormat = 'png';
          dbg.tries.push({ engine: 'rembg', ok: true });
        };
        const tryTb = async (fmt: 'png'|'jpeg'|'webp') => {
          const mod = require('transparent-background');
          dbg.tbKeys = Object.keys(mod || {});
          output = await tbOnce(mod, input, fmt, { fast });
          usedFormat = fmt;
          dbg.tries.push({ engine: 'tb', format: fmt, ok: true, fast });
        };

        if (engine === 'rembg') { try { await tryRembg(); } catch (e:any) { dbg.tries.push({ engine:'rembg', ok:false, err:e?.message||String(e) }); } }
        else if (engine === 'tb') { try { await tryTb(format); } catch (e:any) { dbg.tries.push({ engine:'tb', ok:false, err:e?.message||String(e) }); } }
        else { try { await tryRembg(); } catch (e:any) { dbg.tries.push({ engine:'rembg', ok:false, err:e?.message||String(e) }); try { await tryTb(format); } catch (e2:any) { dbg.tries.push({ engine:'tb', ok:false, err:e2?.message||String(e2) }); } } }

        if (!hasData(output) && ckMode !== 'off') {
          const base = hasData(output) ? output : input;
          try {
            output = ckMode === 'auto' ? await chromaKeyAuto(base, ckTolerance, ckFeather) : await chromaKeyColor(base, ckColor, ckTolerance, ckFeather);
            usedFormat = 'png';
            dbg.chromaApplied = { mode: ckMode, tolerance: ckTolerance, feather: ckFeather };
          } catch (e:any) { dbg.chromaError = e?.message || String(e); }
        }

        if (!hasData(output)) throw new Error('No output from selected engines (and chroma key if enabled)');

        const src = item.binary[binKey]!;
        const baseName = (src.fileName || 'image').replace(/\.[^.]+$/, '');
        const ext = usedFormat === 'jpeg' ? 'jpg' : usedFormat;
        const mime = usedFormat === 'jpeg' ? 'image/jpeg' : `image/${usedFormat}`;
        const newItem: INodeExecutionData = { json: { ...item.json }, binary: item.binary || {} };
        newItem.binary![newKey] = await this.helpers.prepareBinaryData(output!, `${baseName}.${ext}`);
        (newItem.binary![newKey] as any).mimeType = mime;

        if (writeDebug) (newItem.json as any)._bgremove = { ok:true, ...dbg };
        out.push(newItem);
      } catch (e:any) {
        const item = items[i];
        const fail: INodeExecutionData = { json: { ...item.json }, binary: item.binary };
        (fail.json as any)._bgremove = { ok:false, error: e?.message || String(e), ...dbg };
        out.push(fail);
      }
    }
    return [out];
  }
}
