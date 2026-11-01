// Serve Excalidraw's fonts from Synapse itself (instead of a public CDN), so drawings work
// offline and nothing is fetched from third parties. Runs before every build.
import fs from 'fs';
import path from 'path';
const src = path.resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts');
const dest = path.resolve('public/excalidraw/fonts');
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log('Copied Excalidraw fonts to public/excalidraw/fonts');
