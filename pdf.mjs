import { getDocument, GlobalWorkerOptions, OPS } from "./vendor/pdf.mjs";
import Tesseract from "./vendor/tesseract.mjs";

const asset = name => new URL("./vendor/" + name, import.meta.url).href;
GlobalWorkerOptions.workerSrc = asset("pdf.worker.mjs");
const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]);

export async function readPdf(bytes, progress = () => {}) {
  const pdf = await getDocument({
    data: bytes, isEvalSupported: false, cMapUrl: asset("cmaps/"), cMapPacked: true,
    standardFontDataUrl: asset("standard_fonts/"), wasmUrl: asset("wasm/"), iccUrl: asset("iccs/")
  }).promise;
  const pages = [];
  let worker;
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      progress("Leyendo página " + number + " de " + pdf.numPages + "…");
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.filter(item => "str" in item)
        .map(item => item.str + (item.hasEOL ? "\n" : " ")).join("").trim();
      const hasImage = (await page.getOperatorList()).fnArray.some(op => imageOps.has(op));
      if (text && !hasImage) {
        pages.push({ number, text, method: "Texto" });
      } else {
        progress("Reconociendo página " + number + " de " + pdf.numPages + " en español…");
        worker ??= await Tesseract.createWorker("spa", 1, {
          workerPath: asset("ocr-worker.js"), corePath: asset("tesseract-core-lstm.wasm.js"),
          langPath: asset(""), workerBlobURL: false
        });
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2.5, 2800 / Math.max(base.width, base.height)) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        const { data } = await worker.recognize(canvas);
        pages.push({ number, text: data.text.trim() || text, method: "OCR", confidence: data.confidence });
        canvas.width = canvas.height = 0;
      }
      page.cleanup();
    }
    return pages;
  } finally {
    try { await worker?.terminate(); } finally { await pdf.destroy(); }
  }
}
