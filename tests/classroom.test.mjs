import test from "node:test";
import assert from "node:assert/strict";
import { courseData, indexMaterials, createDraft, releaseDraft, findAssignment } from "../classroom.mjs";

const session = {};
globalThis.chrome = {
  runtime: { getManifest: () => ({ oauth2: { client_id: "prueba.apps.googleusercontent.com", scopes: ["scope"] } }) },
  identity: {
    getRedirectURL: () => "https://ext.chromiumapp.org/",
    launchWebAuthFlow: async () => "https://ext.chromiumapp.org/#access_token=test&expires_in=3600"
  },
  storage: { session: {
    get: async key => ({ [key]: session[key] }),
    set: async items => Object.assign(session, items),
    remove: async key => delete session[key]
  } }
};
test("importa todas las páginas de material y continúa tras un adjunto sin acceso", async () => {
  globalThis.fetch = async url => {
    url = new URL(url);
    if (url.pathname.endsWith("/students")) return Response.json({ students: [] });
    if (url.pathname.endsWith("/topics")) return Response.json({ topic: [{ topicId: "t", name: "Unidad" }] });
    if (url.pathname.startsWith("/drive")) return Response.json({}, { status: 403 });
    assert.deepEqual(url.searchParams.getAll("courseWorkMaterialStates"), ["PUBLISHED", "DRAFT"]);
    return Response.json(url.searchParams.has("pageToken") ? { courseWorkMaterial: [{ title: "Segundo", state: "DRAFT" }] } :
      { nextPageToken: "next", courseWorkMaterial: [{ title: "Primero", topicId: "t", state: "PUBLISHED",
        materials: [{ driveFile: { driveFile: { id: "f" } } }] }] });
  };
  const resources = await indexMaterials(await courseData("curso"), null, () => {});
  assert.equal(resources.length, 2);
  assert.match(resources[0].status, /403/);
  assert.equal(resources[0].topic, "Unidad");
  assert.equal(resources[1].published, false);
});

test("publica solo a los destinatarios y reanuda sobre la misma tarea", async () => {
  let remote, posts = 0, patches = 0;
  globalThis.fetch = async (url, options) => {
    if (options.method === "POST") {
      posts++;
      remote = { ...JSON.parse(options.body), id: "task", associatedWithDeveloper: true };
      return Response.json(remote);
    }
    if (options.method === "PATCH") {
      patches++;
      remote.state = "PUBLISHED";
      throw TypeError("Respuesta perdida");
    }
    if (new URL(url).pathname.endsWith("/task")) return Response.json(remote);
    return Response.json({ courseWork: [remote] });
  };
  await assert.rejects(() => createDraft("c", "Guía", "Texto", []));
  await createDraft("c", "Guía", "Texto\n[Guía id]", ["s1", "s3"]);
  assert.equal(remote.state, "DRAFT");
  assert.equal(remote.assigneeMode, "INDIVIDUAL_STUDENTS");
  assert.deepEqual(remote.individualStudentsOptions.studentIds, ["s1", "s3"]);
  assert.equal((await findAssignment("c", "[Guía id]")).id, "task");
  await assert.rejects(() => releaseDraft("c", "task", ["otro"]), /destinatarios/);
  await assert.rejects(() => releaseDraft("c", "task", ["s1", "s3"]), /Respuesta perdida/);
  assert.equal((await releaseDraft("c", "task", ["s1", "s3"])).state, "PUBLISHED");
  assert.deepEqual([posts, patches], [1, 1]);
});
