// pdf.js, loaded on first use (it's large). The legacy build also works on older iPad Safari.
let lib = null;

export async function pdfjs() {
  lib ||= (async () => {
    const m = await import('pdfjs-dist/legacy/build/pdf.mjs');
    m.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
    return m;
  })();
  return lib;
}

/** Open a PDF from its bytes (ArrayBuffer / Uint8Array). Scripts and eval stay off. */
export async function loadPdf(bytes) {
  const m = await pdfjs();
  return m.getDocument({ data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), isEvalSupported: false, enableXfa: false }).promise;
}

/** Draw one page into a canvas at `width` CSS pixels. Returns { canvas, ratio } (height / width). */
export async function renderPage(pdf, pageNo, width, dpr = 1) {
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: (width * dpr) / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  page.cleanup();
  return { canvas, ratio: base.height / base.width };
}
