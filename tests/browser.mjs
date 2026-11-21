import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

// Generate one-page exams in memory, including a scanned page with no text layer.
function samplePdf(answer, jpeg) {
  const content = jpeg ? "q 360 0 0 80 20 650 cm /Scan Do Q" : "BT /F 18 Tf 20 700 Td (" + answer + ") Tj ET";
  const resource = jpeg ? "/XObject << /Scan 4 0 R >>" : "/Font << /F 4 0 R >>";
  const image = jpeg && Buffer.from(jpeg, "base64").toString("latin1");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << " + resource + " >> /Contents 5 0 R >>",
    jpeg ? "<< /Type /XObject /Subtype /Image /Width 720 /Height 160 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + image.length + " >>\nstream\n" + image + "\nendstream" :
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, obj] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += (index + 1) + " 0 obj\n" + obj + "\nendobj\n";
  }
  const start = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) pdf += String(offset).padStart(10, "0") + " 00000 n \n";
  return Buffer.from(pdf + "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + start + "\n%%EOF\n", "latin1");
}

const context = await chromium.launchPersistentContext("", {
  channel: "chromium", executablePath: process.env.CLASSROOM_TEST_CHROME, headless: true,
  args: ["--disable-extensions-except=" + resolve("."), "--load-extension=" + resolve(".")],
  ignoreDefaultArgs: ["--disable-extensions"]
});
try {
  const page = context.pages()[0];
  page.setDefaultTimeout(45000);
  page.on("pageerror", error => console.error(error));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15000 });
  const id = new URL(worker.url()).hostname;
  const assignments = [];
  const name = fullName => ({ name: { fullName } });
  await context.route("https://classroom.googleapis.com/**", async route => {
    const { pathname } = new URL(route.request().url());
    let result;
    if (pathname.endsWith("/userProfiles/me")) result = { id: "docente" };
    if (pathname.endsWith("/courses")) result = { courses: [{ id: "c", name: "Matemática" }] };
    if (pathname.endsWith("/students")) result = { students: [{ userId: "a", profile: name("Ana Ruiz") }, { userId: "b", profile: name("Luis Ruiz") }] };
    if (pathname.endsWith("/topics")) result = {};
    if (pathname.endsWith("/courseWorkMaterials")) result = { courseWorkMaterial: [{ title: "Fracciones", description: "Cómo hallar el denominador común", state: "PUBLISHED" }] };
    if (pathname.endsWith("/courseWork") && route.request().method() === "POST") {
      result = { ...route.request().postDataJSON(), id: "w" + assignments.length };
      assignments.push(result);
    }
    if (/\/courseWork\/w\d+$/.test(pathname)) {
      result = assignments.find(task => pathname.endsWith("/" + task.id));
      if (route.request().method() === "PATCH") result.state = "PUBLISHED";
    }
    assert.ok(result, pathname);
    await route.fulfill({ json: result });
  });
  await context.addInitScript(() => {
    if (!globalThis.chrome?.runtime?.getManifest) return;
    const manifest = chrome.runtime.getManifest();
    chrome.runtime.getManifest = () => ({ ...manifest, oauth2: { ...manifest.oauth2, client_id: "prueba" } });
    chrome.identity.launchWebAuthFlow = async () => "https://" + chrome.runtime.id + ".chromiumapp.org/#access_token=simulado&expires_in=3600";
  });
  await page.goto("chrome-extension://" + id + "/panel.html");
  async function openCourse() {
    await page.locator("#connect").click();
    await page.locator("#course").selectOption("c");
    await page.locator("#work").waitFor({ state: "visible" });
  }
  await openCourse();
  await page.locator("#examName").fill("Unidad 2");
  await page.locator("#rubric").fill("1 | Fracciones | 5/6 | Denominador común | 2/5 | Calcula 1/3 + 1/4.\n2 | Fracciones | 1/2 | Simplificar | 6/12");
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 160;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 720, 160);
    ctx.fillStyle = "black";
    ctx.font = "48px Arial";
    ctx.fillText("Pregunta 2: 6/12", 30, 95);
    return canvas.toDataURL("image/jpeg").split(",")[1];
  });
  await page.locator("#files").setInputFiles([
    { name: "Ana Ruiz.pdf", mimeType: "application/pdf", buffer: samplePdf("1. 2/5") },
    { name: "Luis Ruiz.pdf", mimeType: "application/pdf", buffer: samplePdf("", jpeg) }
  ]);
  await page.locator("#uploads select").nth(1).waitFor({ state: "visible" });
  await page.locator("#analyze").click();
  const entries = page.locator("#results details");
  await entries.nth(0).locator("summary").click();
  assert.equal(await entries.nth(0).locator("select").first().inputValue(), "error");
  await entries.nth(1).locator("summary").click();
  assert.equal(await entries.nth(1).locator("select").last().inputValue(), "pendiente");
  assert.match(await entries.nth(1).locator("pre").last().innerText(), /6\s*\/\s*12/);
  await entries.nth(1).locator("select").last().selectOption("error");
  await page.locator("#groups").click();
  await page.locator("#guides").click();
  assert.match(await page.locator("#drafts textarea").first().inputValue(), /Fracciones \(descripción\)/);
  await page.reload();
  await openCourse();
  for (const index of [0, 1]) {
    await page.getByRole("button", { name: "Publicar para este grupo" }).first().click();
    await page.getByText("Tarea publicada en Classroom").nth(index).waitFor();
  }
  assert.equal(assignments.length, 2);
  assert.ok(assignments.every(task => task.state === "PUBLISHED"));
  assert.deepEqual(assignments.map(task => task.individualStudentsOptions.studentIds), [["a"], ["b"]]);
  console.log("Flujo verificado en Chrome con PDF digital, escaneo, OCR, revisión, recarga y publicación simulada.");
} finally {
  await context.close();
}
