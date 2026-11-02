// Tell Excalidraw to load its fonts from this server, not from esm.sh on the internet. It must run
// before any app code (Excalidraw reads it when its code first loads), so it's a plain script in
// index.html — and a file rather than inline, so the Content-Security-Policy allows it.
window.EXCALIDRAW_ASSET_PATH = '/excalidraw/';
