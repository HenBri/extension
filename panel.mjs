import { authorize, teacher, teacherCourses, courseData, indexMaterials, findAssignment, createDraft, releaseDraft } from "./classroom.mjs";
import { parseRubric, extractQuestions, diagnose, proposals, groupName, makeGuide, rankReadings, words } from "./analysis.mjs";
import { readPdf } from "./pdf.mjs";
import { loadAssessment, saveAssessment } from "./store.mjs";

const $ = id => document.getElementById(id);
const el = (tag, text = "") => Object.assign(document.createElement(tag), { textContent: text });
let account, currentCourse, state;
let roster = [], resources = [];
const objectUrls = new Map();
const blank = () => ({ phase: "upload", name: "", rubric: "", keyText: "", exams: [], groups: [], guides: [] });
const storageKey = () => [account, currentCourse];
const save = () => saveAssessment(storageKey(), state);
const studentName = id => roster.find(student => student.userId === id)?.profile.name.fullName || "Fuera de la lista actual";

function status(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}

async function run(operation) {
  if ($("controls").disabled) return;
  $("controls").disabled = true;
  try {
    await operation();
  } catch (error) {
    status(error.message, true);
  } finally {
    $("controls").disabled = false;
  }
}

function option(select, value, label) {
  select.add(new Option(label, value));
}

function button(title, action) {
  const control = el("button", title);
  control.className = "secondary";
  control.onclick = () => run(action);
  return control;
}

function labelled(text, input) {
  const label = el("label", text);
  label.append(input);
  return label;
}

function edit(node, update) {
  node.oninput = () => {
    update(node.value);
    save().catch(error => status(error.message, true));
  };
}

function clearUrls() {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
}

function pdfLink(exam, page = 1) {
  if (!objectUrls.has(exam.hash)) objectUrls.set(exam.hash, URL.createObjectURL(exam.file));
  const link = el("a", "Ver PDF · pág. " + page);
  link.href = objectUrls.get(exam.hash) + "#page=" + page;
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}

$("connect").onclick = () => run(async () => {
  await authorize();
  const [profile, courses] = await Promise.all([teacher(), teacherCourses()]);
  account = profile.id;
  const select = $("course");
  select.replaceChildren(new Option("Selecciona una clase", ""));
  for (const course of courses) option(select, course.id, course.name + (course.section ? " · " + course.section : ""));
  $("connect").hidden = true;
  $("courseLabel").hidden = false;
  status(courses.length ? "Elige la clase con la que vas a trabajar." : "Esta cuenta no imparte cursos activos.");
});

$("course").onchange = () => run(async () => {
  const id = $("course").value;
  if (!id) {
    clearUrls();
    state = null;
    currentCourse = "";
    render();
    return;
  }
  try {
    status("Importando estudiantes y material del curso…");
    const data = await courseData(id);
    const indexed = await indexMaterials(data, readPdf, status);
    const loaded = await loadAssessment([account, id]);
    clearUrls();
    currentCourse = id;
    roster = data.students;
    resources = indexed;
    state = loaded || blank();
    render();
    status("Curso listo. " + roster.length + " estudiantes y " + data.materials.length + " publicaciones de material.");
  } catch (error) {
    $("course").value = currentCourse || "";
    throw error;
  }
});

function render() {
  $("work").hidden = $("new").hidden = !state;
  if (!state) return;
  $("catalogTitle").textContent = "Material del curso (" + resources.length + " recursos)";
  $("catalog").replaceChildren(...resources.map(resource => el("li", resource.title + " — " +
    [resource.topic, resource.published ? "" : "Borrador", resource.status].filter(Boolean).join(" · "))));
  if (!resources.length) $("catalog").append(el("li", "Este curso aún no tiene materiales."));
  for (const phase of ["upload", "review", "grouping", "preview"]) $(phase).hidden = phase !== state.phase;
  if (state.phase === "upload") renderUploads();
  if (state.phase === "review") renderReview();
  if (state.phase === "grouping") renderGroups();
  if (state.phase === "preview") renderGuides();
  $("new").disabled = state.guides.some(guide => guide.delivery === "pending");
}

async function phase(value, message) {
  state.phase = value;
  await save();
  render();
  status(message);
}

$("new").onclick = () => run(async () => {
  if (!confirm("¿Empezar otra evaluación y borrar de este navegador los PDF y borradores de la evaluación actual? Las tareas publicadas seguirán en Classroom.")) return;
  clearUrls();
  state = blank();
  await phase("upload", "Nueva evaluación lista.");
});

function renderUploads() {
  $("examName").value = state.name;
  edit($("examName"), value => state.name = value);
  $("rubric").value = state.rubric;
  edit($("rubric"), value => state.rubric = value);
  $("keyPreview").hidden = !state.keyText;
  $("keyText").textContent = state.keyText;
  const list = $("uploads");
  list.replaceChildren();
  for (const exam of state.exams) {
    const row = el("div");
    row.className = "entry";
    const name = el("div", exam.file.name);
    name.append(el("br"), pdfLink(exam));
    const select = el("select");
    option(select, "", "Selecciona un estudiante");
    for (const student of roster) option(select, student.userId, student.profile.name.fullName);
    select.value = exam.student;
    select.onchange = () => run(async () => {
      exam.student = select.value;
      await save();
      renderUploads();
    });
    row.append(name, labelled("Estudiante", select), button("Quitar", async () => {
      state.exams = state.exams.filter(item => item !== exam);
      URL.revokeObjectURL(objectUrls.get(exam.hash));
      objectUrls.delete(exam.hash);
      await save();
      renderUploads();
    }));
    list.append(row);
  }
  const missing = roster.filter(student => !state.exams.some(exam => exam.student === student.userId));
  $("missing").textContent = missing.length ? "Sin examen (" + missing.length + "): " +
    missing.map(student => student.profile.name.fullName).join(", ") : "Todos los estudiantes tienen examen.";
}

$("keyFile").onchange = () => run(async () => {
  const [file] = $("keyFile").files;
  $("keyFile").value = "";
  if (!file) return;
  const pages = await readPdf(new Uint8Array(await file.arrayBuffer()), status);
  const raw = pages.map(page => page.text).join("\n");
  const lines = raw.split("\n").map(line => line.trim()).filter(line => /^\d+\s*\|/.test(line));
  if (!lines.length) {
    for (const [id, block] of extractQuestions(pages)) {
      const answer = block.lines.join(" ").split(/respuesta\s*:/iu).at(-1).trim();
      lines.push([id, "", answer.replace(/\|/g, " "), ""].join(" | "));
    }
  }
  state.keyText = raw || "No se encontró texto legible. Introduce la pauta manualmente.";
  if (lines.length && (!state.rubric || confirm("¿Reemplazar la pauta por la propuesta del solucionario?"))) {
    state.rubric = lines.join("\n");
  }
  await save();
  renderUploads();
  $("keyPreview").open = true;
  status("Solucionario importado. Verifica las respuestas y completa el tema y la dificultad de cada pregunta.");
});

$("files").onchange = () => run(async () => {
  const files = [...$("files").files];
  $("files").value = "";
  const issues = [];
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        byte => byte.toString(16).padStart(2, "0")).join("");
      if (state.exams.some(exam => exam.hash === hash)) throw Error("PDF duplicado");
      const pages = await readPdf(bytes, message => status(file.name + " · " + message));
      const fileName = " " + words(file.name) + " ";
      const candidates = roster.filter(student => fileName.includes(" " + words(student.profile.name.fullName) + " "));
      const student = candidates.length === 1 ? candidates[0].userId : "";
      state.exams.push({ hash, file, pages, student, rows: [] });
    } catch (error) {
      issues.push(file.name + " — " + error.message);
    }
  }
  await save();
  renderUploads();
  status(issues.length ? issues.join(" · ") : "Archivos leídos. Verifica las asociaciones antes de analizar.", !!issues.length);
});

$("analyze").onclick = () => run(async () => {
  if (!state.name.trim()) throw Error("Escribe el nombre de la evaluación.");
  const criteria = parseRubric(state.rubric);
  const students = state.exams.map(exam => exam.student);
  if (!students.length) throw Error("Agrega al menos un examen.");
  if (students.some(id => !roster.some(student => student.userId === id))) throw Error("Asocia cada PDF con un estudiante del curso.");
  if (new Set(students).size !== students.length) throw Error("Hay dos PDF asociados al mismo estudiante. Revisa las asociaciones.");
  for (const exam of state.exams) exam.rows = diagnose(exam.pages, criteria);
  await phase("review", "Diagnóstico listo para revisión.");
});

function renderReview() {
  const target = $("results");
  const rubric = parseRubric(state.rubric);
  target.replaceChildren();
  for (const exam of state.exams) {
    const details = el("details");
    details.append(el("summary", studentName(exam.student) + " · " + exam.file.name));
    for (const [index, row] of exam.rows.entries()) {
      const box = el("div");
      box.className = "question";
      const rule = rubric[index];
      const select = el("select");
      for (const [key, label] of [["pendiente", "Pendiente de revisión"], ["correcta", "Correcta"], ["error", "Error confirmado"]]) {
        option(select, key, label);
      }
      select.value = row.result;
      edit(select, value => row.result = value);
      const topic = el("input"), focus = el("input");
      topic.value = row.topic;
      focus.value = row.focus;
      edit(topic, value => row.topic = value);
      edit(focus, value => row.focus = value);
      const source = exam.pages.filter(page => page.number >= row.page && page.number <= row.lastPage);
      const origin = source.map(page => page.method + " · pág. " + page.number).join(", ");
      box.append(el("strong", "Pregunta " + row.id + " · " + rule.topic), el("p", "Respuesta esperada: " + rule.answers.join(" / ")),
        el("small", origin),
        el("pre", row.evidence || "No se identificó una respuesta numerada. Consulta el PDF."),
        pdfLink(exam, row.page || 1), labelled("Diagnóstico", select), labelled("Tema", topic), labelled("Dificultad", focus));
      details.append(box);
    }
    target.append(details);
  }
}

$("backUpload").onclick = () => run(() => phase("upload", "Al analizar de nuevo se recalcularán los diagnósticos."));
$("backReview").onclick = () => run(() => phase("review", "Revisa el diagnóstico antes de volver a formar grupos."));
$("backGroups").onclick = () => run(() => phase("grouping", "Al preparar las guías se generarán nuevos borradores."));
$("groups").onclick = () => run(async () => {
  if (state.exams.some(exam => exam.rows.some(row => row.result === "error" && (!row.topic.trim() || !row.focus.trim())))) {
    throw Error("Completa el tema y la dificultad de los errores confirmados.");
  }
  state.groups = proposals(state.exams);
  await phase("grouping", "Propuesta calculada a partir de los errores confirmados.");
});

function renderGroups() {
  const target = $("members");
  const options = new Set([...parseRubric(state.rubric).map(groupName), ...state.groups.flatMap(group => group.topics)]);
  const choices = el("datalist");
  choices.id = "availableGroups";
  for (const label of options) {
    const item = el("option");
    item.value = label;
    choices.append(item);
  }
  target.replaceChildren(choices);
  for (const group of state.groups) {
    const row = el("div");
    row.className = "entry";
    const name = el("div");
    name.append(el("strong", studentName(group.student)), el("br"),
      el("small", group.topics.length ? "Dificultades: " + group.topics.join(", ") : "Sin errores confirmados"));
    const input = el("input");
    input.setAttribute("list", "availableGroups");
    input.placeholder = "Sin grupo asignado";
    input.value = group.primary;
    edit(input, value => group.primary = value);
    row.append(name, labelled("Grupo principal", input));
    target.append(row);
  }
}

$("guides").onclick = () => run(async () => {
  const groups = new Map();
  for (const { primary, student } of state.groups) {
    const name = primary.trim();
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(student);
  }
  if (!groups.size) throw Error("Asigna al menos un estudiante a un grupo para preparar una guía.");
  const rubric = parseRubric(state.rubric);
  state.guides = [...groups].map(([name, students]) => {
    const used = new Map();
    for (const exam of state.exams.filter(item => students.includes(item.student))) {
      for (const row of exam.rows.filter(row => row.result === "error" && groupName(row) === name)) {
        used.set(row.id, { ...rubric.find(rule => rule.id === row.id), topic: row.topic, focus: row.focus });
      }
    }
    const rules = used.size ? [...used.values()] : rubric;
    return { id: crypto.randomUUID(), name, students, delivery: "draft",
      text: makeGuide(name, students, rules, resources) };
  });
  await phase("preview", "Revisa el texto y los destinatarios de cada guía.");
});

function renderGuides() {
  $("backGroups").disabled = state.guides.some(guide => guide.delivery !== "draft");
  const list = $("drafts");
  list.replaceChildren();
  for (const guide of state.guides) {
    const article = el("article");
    article.append(el("h3", guide.name), el("p", "Destinatarios: " + guide.students.map(studentName).join(", ")));
    if (!rankReadings(guide.name, resources, guide.students).length) {
      article.append(el("p", "Falta una lectura del curso para este tema. Puedes añadir una referencia al editar la guía."));
    }
    const text = el("textarea");
    text.rows = 12;
    text.maxLength = 29800;
    text.value = guide.text;
    text.readOnly = guide.delivery !== "draft";
    edit(text, value => guide.text = value);
    article.append(labelled("Guía de estudio", text));
    if (guide.delivery === "sent") {
      const link = el("a", "Tarea publicada en Classroom");
      link.href = guide.link || "https://classroom.google.com";
      link.target = "_blank";
      link.rel = "noopener";
      article.append(link);
    } else {
      const label = guide.delivery === "pending" ? "Reanudar publicación" : "Publicar para este grupo";
      article.append(button(label, () => publish(guide)));
    }
    list.append(article);
  }
}

async function publish(guide) {
  const marker = "[Guía " + guide.id + "]";
  if (!guide.text.trim()) throw Error("La guía está vacía.");
  const description = guide.text.trim() + "\n\n" + marker;
  if (description.length > 30000) throw Error("Acorta el texto de la guía antes de publicar.");
  let draft;
  if (!guide.assignment && guide.delivery === "pending") draft = await findAssignment(currentCourse, marker);
  if (!guide.assignment && !draft) {
    if (guide.students.some(id => !roster.some(student => student.userId === id))) throw Error("Revisa los destinatarios que ya no pertenecen al curso.");
    guide.delivery = "pending";
    try { await save(); } catch (error) { guide.delivery = "draft"; throw error; }
    render();
    try {
      draft = await createDraft(currentCourse, "Guía de estudio · " + state.name + " · " + guide.name, description, guide.students);
    } catch (error) {
      if (error.status >= 400 && error.status < 500 && error.status !== 408) {
        guide.delivery = "draft";
        await save();
      }
      render();
      throw error;
    }
  }
  if (draft) guide.assignment = draft.id;
  // Commit the remote ID before making the task visible. Retries target this same ID.
  await save();
  const assignment = await releaseDraft(currentCourse, guide.assignment, guide.students);
  guide.delivery = "sent";
  guide.link = assignment.alternateLink;
  guide.assignment = assignment.id;
  await save();
  render();
  status("Guía publicada para " + guide.students.length + " estudiantes.");
}

$("controls").disabled = true;
navigator.locks.request("panel-docente", async () => {
  $("controls").disabled = false;
  status("Conecta tu cuenta docente para elegir una clase.");
  await new Promise(() => {});
});
status("Esperando el panel docente. Si tienes otra pestaña del panel abierta, trabaja allí o ciérrala.");
