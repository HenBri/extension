import { cp, mkdir } from "node:fs/promises";

// Only these browser distributions and language data are loaded by the extension.
await mkdir("vendor", { recursive: true });
for (const [source, target] of [
  ["pdfjs-dist/build/pdf.min.mjs", "pdf.mjs"],
  ["pdfjs-dist/build/pdf.worker.min.mjs", "pdf.worker.mjs"],
  ...["cmaps", "standard_fonts", "wasm", "iccs"].map(name => ["pdfjs-dist/" + name, name]),
  ["tesseract.js/dist/tesseract.esm.min.js", "tesseract.mjs"],
  ["tesseract.js/dist/worker.min.js", "ocr-worker.js"],
  ["tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  ["@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz", "spa.traineddata.gz"],
  ["pdfjs-dist/LICENSE", "LICENSE-pdfjs"],
  ["tesseract.js/LICENSE.md", "LICENSE-tesseract"],
  ["tesseract.js-core/LICENSE", "LICENSE-core"],
  ["tesseract.js/dist/worker.min.js.LICENSE.txt", "LICENSE-worker"],
  ["tesseract.js/dist/tesseract.min.js.LICENSE.txt", "LICENSE-browser"],
]) {
  await cp("node_modules/" + source, "vendor/" + target, { recursive: true });
}
