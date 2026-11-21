const api = "https://classroom.googleapis.com/v1/";
const drive = "https://www.googleapis.com/drive/v3/files/";

let memory;

export async function authorize() {
  await accessToken(true);
}

async function accessToken(interactive, fresh = false) {
  const manifest = chrome.runtime.getManifest().oauth2;
  if (!manifest?.client_id || manifest.client_id.startsWith("CONFIGURAR")) {
    throw Error("Configura el ID de cliente OAuth de tipo Aplicación web en manifest.json y recarga la extensión. Encontrarás los pasos en el README.");
  }
  if (!fresh) {
    if (!(memory?.expiresAt > Date.now() + 60000)) memory = (await chrome.storage.session.get("googleAuth")).googleAuth;
    if (memory?.expiresAt > Date.now() + 60000) return memory.accessToken;
  }
  const redirect = chrome.identity.getRedirectURL();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", manifest.client_id);
  url.searchParams.set("response_type", "token");
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("scope", manifest.scopes.join(" "));
  url.searchParams.set("include_granted_scopes", "true");
  if (interactive) url.searchParams.set("prompt", "select_account");
  let redirected;
  try {
    redirected = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive });
  } catch (error) {
    const cancelled = /did not approve|cancel/i.test(error?.message || "");
    throw Error(cancelled ? "Acceso cancelado." :
      "Google rechazó el acceso. El cliente tiene que ser de tipo Aplicación web y el URI de redirección autorizado tiene que ser exactamente " + redirect);
  }
  const params = new URLSearchParams(new URL(redirected || "https://invalid/").hash.slice(1));
  const accessTokenValue = params.get("access_token");
  if (!accessTokenValue) {
    throw Error(params.get("error") === "access_denied" ? "Acceso cancelado." :
      "Google no devolvió un token. Autoriza este URI de redirección en el cliente web: " + redirect);
  }
  memory = { accessToken: accessTokenValue, expiresAt: Date.now() + Number(params.get("expires_in") || 3600) * 1000 };
  await chrome.storage.session.set({ googleAuth: memory });
  return accessTokenValue;
}

async function request(url, options = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(true, attempt > 0);
    const response = await fetch(url, { ...options, headers: {
      ...options.headers, Authorization: "Bearer " + token
    } });
    if (response.ok) return response;
    if (response.status === 401 && attempt === 0) {
      memory = null;
      await chrome.storage.session.remove("googleAuth");
      continue;
    }
    const detail = await response.json().catch(() => ({}));
    const error = Error("Google (" + response.status + "). " + (detail.error?.message || response.statusText));
    error.status = response.status;
    throw error;
  }
}

export async function listAll(path, field, params = {}) {
  const url = new URL(path, api);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const records = [];
  let page;
  do {
    page = await (await request(url)).json();
    records.push(...(page[field] || []));
    if (page.nextPageToken) url.searchParams.set("pageToken", page.nextPageToken);
  } while (page.nextPageToken);
  return records;
}

export const teacherCourses = () => listAll("courses", "courses", { teacherId: "me", courseStates: "ACTIVE" });
export const teacher = async () => (await request(api + "userProfiles/me")).json();
export const coursePath = id => "courses/" + encodeURIComponent(id) + "/";

export async function courseData(id) {
  const path = coursePath(id);
  const posts = new URL(path + "courseWorkMaterials", api);
  for (const state of ["PUBLISHED", "DRAFT"]) posts.searchParams.append("courseWorkMaterialStates", state);
  const [students, topics, materials] = await Promise.all([
    listAll(path + "students", "students"), listAll(path + "topics", "topic"),
    listAll(posts, "courseWorkMaterial")
  ]);
  return { students, topics, materials };
}

export async function indexMaterials({ topics, materials }, readPdf, progress) {
  const byTopic = new Map(topics.map(item => [item.topicId, item.name]));
  const result = [];
  for (const post of materials) {
    const base = {
      title: post.title, topic: byTopic.get(post.topicId) || "", published: post.state === "PUBLISHED",
      students: post.assigneeMode === "INDIVIDUAL_STUDENTS" ? post.individualStudentsOptions?.studentIds || [] : null,
      url: post.alternateLink || "", pages: [], status: ""
    };
    if (post.description || !post.materials?.length) {
      result.push({ ...base, pages: post.description ? [{ label: "descripción", text: post.description }] : [],
        status: post.description ? "Descripción disponible" : "Solo título" });
    }
    for (const attachment of post.materials || []) {
      const file = attachment.driveFile?.driveFile;
      const item = file || attachment.link || attachment.youtubeVideo || attachment.form || {};
      const resource = { ...base, title: [post.title, item.title].filter(Boolean).join(" · "),
        url: item.alternateLink || item.url || item.formUrl || base.url, status: "Solo referencia" };
      result.push(resource);
      if (!file?.id) continue;
      progress("Importando " + resource.title + "…");
      try {
        const url = drive + encodeURIComponent(file.id);
        const meta = await (await request(url + "?supportsAllDrives=true&fields=mimeType,capabilities(canDownload)")).json();
        if (meta.capabilities?.canDownload === false) throw Error("Descarga restringida");
        let response;
        if (["application/vnd.google-apps.document", "application/vnd.google-apps.presentation",
          "application/vnd.google-apps.spreadsheet", "application/vnd.google-apps.drawing"].includes(meta.mimeType)) {
          response = await request(url + "/export?mimeType=application%2Fpdf");
        } else if (meta.mimeType === "application/pdf" || meta.mimeType.startsWith("text/")) {
          response = await request(url + "?alt=media&supportsAllDrives=true");
        }
        if (!response) continue;
        if (meta.mimeType.startsWith("text/")) {
          resource.pages = [{ label: "texto", text: await response.text() }];
        } else {
          resource.pages = (await readPdf(new Uint8Array(await response.arrayBuffer()), progress))
            .map(page => ({ label: "pág. " + page.number, text: page.text }));
        }
        resource.status = resource.pages.some(page => page.text.trim()) ? "Contenido disponible" : "Sin texto legible";
      } catch (error) {
        resource.status = "Revisar acceso o formato. " + error.message;
      }
    }
  }
  return result;
}

export async function findAssignment(course, marker) {
  const url = new URL(coursePath(course) + "courseWork", api);
  for (const state of ["PUBLISHED", "DRAFT"]) url.searchParams.append("courseWorkStates", state);
  const items = await listAll(url, "courseWork", {
    fields: "nextPageToken,courseWork(id,description,state,alternateLink,associatedWithDeveloper)"
  });
  return items.find(item => item.associatedWithDeveloper && item.description?.endsWith(marker));
}

export async function createDraft(course, title, description, students) {
  if (!students.length || students.some(id => !id)) throw Error("Elige al menos un destinatario.");
  const body = { title, description, state: "DRAFT", workType: "ASSIGNMENT",
    assigneeMode: "INDIVIDUAL_STUDENTS", individualStudentsOptions: { studentIds: students } };
  return (await request(api + coursePath(course) + "courseWork", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  })).json();
}

export async function releaseDraft(course, id, students) {
  const url = api + coursePath(course) + "courseWork/" + encodeURIComponent(id);
  const existing = await (await request(url)).json();
  const recipients = new Set(existing.individualStudentsOptions?.studentIds || []);
  if (existing.assigneeMode !== "INDIVIDUAL_STUDENTS" || recipients.size !== students.length ||
      students.some(student => !recipients.has(student))) {
    throw Error("Los destinatarios de la tarea cambiaron en Classroom. Comprueba y corrige la lista antes de reanudar.");
  }
  if (existing.state === "PUBLISHED") return existing;
  return (await request(url + "?updateMask=state", { method: "PATCH",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: "PUBLISHED" })
  })).json();
}
