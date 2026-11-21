export function words(value) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// One line per question. The same format can be extracted from a teacher's answer key.
export function parseRubric(text) {
  const seen = new Set();
  const criteria = text.trim().split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    const fields = line.split("|").map(field => field.trim());
    const [id, topic, answers, focus, mistakes = "", practice = ""] = fields;
    if (!/^[1-9]\d*$/.test(id) || seen.has(id) || !topic || !answers || !focus || fields.length > 6) {
      throw Error("Revisa la línea " + (index + 1) + " de la pauta. Usa un número único, tema, respuesta y dificultad.");
    }
    const alternatives = value => value.split(";").map(item => item.trim()).filter(Boolean);
    if (!alternatives(answers).length) throw Error("Falta la respuesta de la pregunta " + id + ".");
    seen.add(id);
    return { id, topic, answers: alternatives(answers), focus, mistakes: alternatives(mistakes), practice };
  });
  if (!criteria.length) throw Error("Escribe o importa la pauta de la evaluación.");
  return criteria;
}

const questionStart = /^\s*(?:(?:pregunta|ejercicio|ítem|item|p)\s*\.?\s*(\d+)\s*[).:\-]?\s*|(\d+)\s*[):]\s*|(\d+)\.(?!\d)\s*)(.*)$/iu;

export function extractQuestions(pages) {
  const blocks = new Map();
  let current;
  for (const page of pages) {
    for (const line of page.text.split(/\r?\n/).filter(line => line.trim())) {
      const match = line.match(questionStart);
      if (match) {
        const id = match[1] || match[2] || match[3];
        current = { page: page.number, lastPage: page.number, lines: [], uncertain: blocks.has(id) };
        blocks.set(id, current);
      }
      if (current) {
        current.lines.push(match ? match[4] : line);
        current.lastPage = page.number;
        current.uncertain ||= page.method === "OCR" || page.uncertain;
      }
    }
  }
  return blocks;
}

function cleanAnswer(value) {
  return value.normalize("NFC").replace(/−/g, "-").replace(/\s+/g, " ").trim();
}

function numeric(value) {
  if (!/^[+-]?\d+(?:[.,]\d+)?(?:\/[1-9]\d*)?$/.test(value)) return NaN;
  const [top, bottom = 1] = value.replace(",", ".").split("/");
  return Number(top) / Number(bottom);
}

export function diagnose(pages, criteria) {
  const blocks = extractQuestions(pages);
  return criteria.map(rule => {
    const block = blocks.get(rule.id);
    const evidence = block?.lines.join("\n").trim() || "";
    const answer = cleanAnswer(evidence.split(/(?:respuesta(?:\s+final)?|rpta\.?)\s*[:=]/iu).at(-1));
    const expected = rule.answers.map(cleanAnswer);
    let result = "pendiente";
    if (answer && !block?.uncertain) {
      if (expected.includes(answer)) result = "correcta";
      else if (rule.mistakes.map(cleanAnswer).includes(answer)) result = "error";
      else if (Number.isFinite(numeric(answer)) && expected.every(item =>
        Number.isFinite(numeric(item)) && Math.abs(numeric(item) - numeric(answer)) > 1e-10)) result = "error";
    }
    return { id: rule.id, topic: rule.topic, focus: rule.focus, page: block?.page,
      lastPage: block?.lastPage, evidence, result };
  });
}

export function proposals(exams) {
  return exams.map(exam => {
    const counts = new Map();
    for (const row of exam.rows) {
      if (row.result !== "error") continue;
      const key = groupName(row);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    // Equal counts follow the order in the rubric.
    const topics = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
    return { student: exam.student, primary: topics[0] || "", topics };
  });
}

export function groupName(row) {
  return row.topic + " · " + row.focus;
}

const stopWords = new Set("con del las los para por que una uno unos unas como tema repaso guia estudio".split(" "));

function tokens(text) {
  return [...new Set(words(text).split(" ").filter(word => word.length > 2 && !stopWords.has(word))
    .map(word => word.replace(/s$/, "")))];
}

export function rankReadings(group, resources, students) {
  const keywords = tokens(group);
  const score = text => tokens(text).filter(word => keywords.includes(word)).length;
  return resources.filter(resource => resource.published && !resource.status?.startsWith("Revisar acceso") &&
    (!resource.students || students.every(id => resource.students.includes(id))))
    .flatMap(resource => {
      const titleScore = score(resource.title + " " + resource.topic);
      const pages = resource.pages.map(page => ({ page, score: score(page.text) }))
        .sort((a, b) => b.score - a.score);
      const best = pages[0];
      const weight = titleScore * 2 + (best?.score || 0);
      return weight ? [{ resource, page: best?.score ? best.page : null, weight }] : [];
    }).sort((a, b) => b.weight - a.weight).slice(0, 3);
}

export function makeGuide(group, students, criteria, resources) {
  const readings = rankReadings(group, resources, students);
  const rules = criteria.filter(rule => groupName(rule) === group);
  const target = rules[0]?.focus || group;
  const tasks = rules.map(rule => rule.practice || (
    "Retoma la pregunta " + rule.id + " sobre " + rule.topic + ". Resuélvela paso a paso y explica cómo compruebas el resultado."
  ));
  const references = readings.map(({ resource, page }) => resource.title +
    (page ? " (" + page.label + ")" : "") + (resource.url ? "\n" + resource.url : ""));
  return [
    "Objetivo\nPracticar " + target + " y explicar el procedimiento con un ejemplo.",
    references.length ? "Lecturas del curso\n" + references.join("\n\n") : "",
    "Práctica\n" + (tasks.length ? tasks : ["Resuelve un ejemplo de " + group + " y comprueba cada paso."])
      .map((task, index) => (index + 1) + ". " + task).join("\n"),
    "Autoevaluación\nDescribe qué paso te costó más y cómo verificarías tu respuesta en otro ejercicio de " +
      (rules[0]?.topic || group) + "."
  ].filter(Boolean).join("\n\n");
}
