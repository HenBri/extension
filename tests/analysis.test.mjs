import test from "node:test";
import assert from "node:assert/strict";
import { parseRubric, diagnose, proposals, makeGuide, rankReadings, groupName } from "../analysis.mjs";

const rules = parseRubric("1 | Fracciones | 5/6 | Hallar denominador común | 2/5 | Calcula 1/3 + 1/4.\n2 | Fracciones | 1/2 | Simplificar | 2/4\n3 | Biología | mitosis | División celular");
const page = (number, text, method = "Texto") => ({ number, text, method });

test("conserva evidencia y distingue dificultades con la misma calificación", () => {
  const a = diagnose([page(1, "1. Suma\nRespuesta: 2/5\n2) 1/2"), page(2, "Pregunta 3: mitosis")], rules);
  const b = diagnose([page(1, "1. 5/6\n2. 2/4\n3. mitosis")], rules);
  assert.deepEqual(a.map(row => row.result), ["error", "correcta", "correcta"]);
  assert.equal(a[2].page, 2);
  assert.match(a[0].evidence, /Respuesta: 2\/5/);
  const groups = proposals([{ student: "a", rows: a }, { student: "b", rows: b }]);
  assert.equal(groups[0].primary, groupName(rules[0]));
  assert.equal(groups[1].primary, groupName(rules[1]));
});

test("OCR, preguntas ausentes, respuestas abiertas y equivalencias pasan a revisión", () => {
  const rows = diagnose([page(1, "1) 10/12\n3. división celular")], rules);
  assert.deepEqual(rows.map(row => row.result), Array(3).fill("pendiente"));
  const scan = diagnose([page(1, "1) 2/5\n2) 0", "OCR")], rules);
  assert.equal(proposals([{ student: "a", rows: scan }])[0].primary, "");
});

test("rechaza pautas incompletas y números repetidos", () => {
  for (const text of ["", "1 | Tema | 4", "1 | T | 4 | F\n1 | T | 5 | G"]) {
    assert.throws(() => parseRubric(text));
  }
});

test("la guía cita la página pertinente y respeta el público de los materiales", () => {
  const base = { published: true, title: "Unidad 3", topic: "", url: "https://example.org/u3",
    pages: [{ label: "pág. 1", text: "Introducción" }, { label: "pág. 2", text: "Denominador común" }] };
  const resources = [base, { ...base, published: false }, { ...base, students: ["a"] }, { ...base, status: "Revisar acceso o formato" }];
  const name = groupName(rules[0]);
  assert.equal(rankReadings(name, resources, ["a", "b"]).length, 1);
  const guide = makeGuide(name, ["a", "b"], rules, resources);
  for (const value of ["pág. 2", base.url, rules[0].practice, "Autoevaluación"]) assert.ok(guide.includes(value));
  assert.ok(!guide.includes("Simplificar"));
});
