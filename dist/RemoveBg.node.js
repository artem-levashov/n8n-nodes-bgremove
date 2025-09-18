"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoveBg = void 0;
// We only support local JS mode (no HTTP).
// Lazily require to avoid startup cost until execution.
let transparentBackgroundMod;
class RemoveBg {
    constructor() {
        this.description = {
            displayName: 'Remove Background (Local)',
            name: 'removeBgLocal',
            icon: 'file:assets/image.svg',
            group: ['transform'],
            version: 1,
            description: 'Remove image background using the transparent-background npm package',
            defaults: {
                name: 'Remove Background (Local)',
            },
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
                    description: 'If true, uses a faster (lower quality) path when available',
                },
            ],
        };
    }
    async execute() {
        const items = this.getInputData();
        const returnData = [];
        for (let i = 0; i < items.length; i++) {
            const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i);
            const newBinaryPropertyName = this.getNodeParameter('newBinaryPropertyName', i);
            const outputFormat = this.getNodeParameter('outputFormat', i);
            const fast = this.getNodeParameter('fast', i);
            const item = items[i];
            if (!item.binary || !item.binary[binaryPropertyName]) {
                throw new Error(`Item ${i} has no binary property '${binaryPropertyName}'.`);
            }
            const inputBuffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
            if (!transparentBackgroundMod) {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                transparentBackgroundMod = require('transparent-background');
            }
            const { transparentBackground } = transparentBackgroundMod;
            const output = await transparentBackground(inputBuffer, outputFormat, { fast });
            const inputInfo = item.binary[binaryPropertyName];
            const baseName = (inputInfo.fileName || 'image').replace(/\.[^.]+$/, '');
            const outExt = outputFormat === 'jpeg' ? 'jpg' : outputFormat;
            const mime = outputFormat === 'jpeg' ? 'image/jpeg' : `image/${outputFormat}`;
            const newItem = {
                json: item.json,
                binary: item.binary,
            };
            newItem.binary[newBinaryPropertyName] = await this.helpers.prepareBinaryData(output, `${baseName}.${outExt}`);
            newItem.binary[newBinaryPropertyName].mimeType = mime;
            returnData.push(newItem);
        }
        return [returnData];
    }
}
exports.RemoveBg = RemoveBg;
