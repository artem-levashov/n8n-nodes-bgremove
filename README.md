# n8n-nodes-bgremove

Local-only background remover for n8n using [`transparent-background`](https://www.npmjs.com/package/transparent-background).
No servers/sidecars. Outputs PNG/JPEG/WEBP with transparency supported for PNG.

## Install (via n8n UI)
1. Make sure your n8n is v1.30+ (Node 18+ runtime).
2. In **Settings → Community nodes → Install**, type: `n8n-nodes-bgremove` and confirm.
3. Restart n8n when prompted.

## Usage
- Drop **Remove Background (Local)** node.
- Set:
  - **Binary Property**: e.g. `data`
  - **New Binary Property**: e.g. `bg_removed`
  - **Output Format**: `png` | `jpeg` | `webp`


