const database = new Promise((resolve, reject) => {
  const opening = indexedDB.open("classroom-examenes", 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore("evaluaciones");
  opening.onsuccess = () => resolve(opening.result);
  opening.onerror = () => reject(opening.error);
});

export async function loadAssessment(key) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const reading = db.transaction("evaluaciones").objectStore("evaluaciones").get(key);
    reading.onsuccess = () => resolve(reading.result);
    reading.onerror = () => reject(reading.error);
  });
}

export async function saveAssessment(key, assessment) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("evaluaciones", "readwrite", { durability: "strict" });
    tx.objectStore("evaluaciones").put(assessment, key);
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error || Error("No se pudo guardar la evaluación en este navegador."));
  });
}
