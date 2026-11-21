(() => {
  if (document.getElementById("classroom-notas-extension")) return;

  const container = document.createElement("div");
  container.id = "classroom-notas-extension";
  document.body.appendChild(container);
  const shadow = container.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host { font-family: Arial, sans-serif; color: #202124; }
      button { cursor: pointer; font: inherit; }
      #toggle {
        position: fixed; right: 22px; bottom: 22px; z-index: 2147483646;
        padding: 12px 16px; border: none; border-radius: 28px;
        background: #d21919ff; color: white; font-weight: 600;
        box-shadow: 0 3px 12px rgba(0,0,0,.2);
      }
      #panel {
        position: fixed; right: 22px; bottom: 78px; z-index: 2147483646;
        box-sizing: border-box; width: min(340px, calc(100vw - 44px));
        padding: 18px; background: white; border-radius: 14px;
        box-shadow: 0 8px 30px rgba(0,0,0,.25);
      }
      #panel[hidden] { display: none; }
      h2 { font-size: 18px; margin: 0 0 10px; }
      textarea {
        width: 100%; min-height: 140px; resize: vertical; box-sizing: border-box;
        padding: 10px; border: 1px solid #dadce0; border-radius: 8px;
        font: 14px/1.5 Arial, sans-serif;
      }
      #save { margin-top: 10px; border: 0; padding: 9px 14px;
        border-radius: 8px; background: #d21919ff; color: white; }
      #status { margin-left: 10px; font-size: 12px; color: #5f6368; }
      #exams { display: block; margin-top: 16px; padding: 8px 0; border: 0; background: white; color: #155b51; font-weight: bold; }
    </style>
    <button id="toggle" type="button" aria-expanded="false">📝 Mis notas</button>
    <section id="panel" hidden aria-label="Notas de Classroom">
      <h2>Notas personales</h2>
      <textarea id="note" placeholder="Escribe tus notas sobre esta clase..."></textarea>
      <div><button id="save" type="button">Guardar</button><span id="status"></span></div>
      <button id="exams" type="button">Analizar exámenes ↗</button>
    </section>
  `;

  const toggle = shadow.getElementById("toggle");
  const panel = shadow.getElementById("panel");
  const note = shadow.getElementById("note");
  const status = shadow.getElementById("status");
  shadow.getElementById("exams").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "openTeacherPanel" });
  });
  let activeKey = "classroom-note-general";

  function noteKey() {
    const courseId = location.pathname.match(/^\/c\/([^/]+)/)?.[1];
    return `classroom-note-${courseId ?? "general"}`;
  }

  toggle.addEventListener("click", async () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) {
      activeKey = noteKey();
      const saved = await chrome.storage.local.get(activeKey);
      note.value = saved[activeKey] ?? "";
      status.textContent = "";
    }
  });

  note.addEventListener("input", () => {
    status.textContent = "Sin guardar";
  });

  shadow.getElementById("save").addEventListener("click", async () => {
    await chrome.storage.local.set({ [activeKey]: note.value });
    status.textContent = "Guardado ✓";
  });
})();
