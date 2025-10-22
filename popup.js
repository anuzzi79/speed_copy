// SpeedCopy - Popup com Slots/Perfis (PT-BR + ícones de ação com fundo claro)
// Armazena perfis em chrome.storage.sync key "profiles": Array<Profile>

const listEl = document.getElementById("list");
const addBtn = document.getElementById("addProfile");
const testLaunchBtn = document.getElementById("testLaunch");

const modal = document.getElementById("modal");
const closeModalBtn = document.getElementById("closeModal");
const cancelEditBtn = document.getElementById("cancelEdit");
const form = document.getElementById("profileForm");

const f_id = document.getElementById("profile_id");
const f_projeto_base = document.getElementById("projeto_base");
const f_projeto_base_type = document.getElementById("projeto_base_type");
const f_type_exportation = document.getElementById("type_exportation");
const f_tipo_copia = document.getElementById("tipo_copia");
const f_user_id = document.getElementById("user_id");

/* ===== Autosize del popup dell’estensione (fallback quando usato come popup) ===== */
function autosizePopup() {
    const w = Math.max(document.body.scrollWidth, 380);
    document.documentElement.style.width = w + "px";
    document.body.style.width = w + "px";
    const h = Math.max(document.body.scrollHeight, 160);
    document.documentElement.style.height = h + "px";
    document.body.style.height = h + "px";
}

// ---------- Storage helpers ----------
async function readProfiles() {
    const { profiles } = await chrome.storage.sync.get(["profiles"]);
    return Array.isArray(profiles) ? profiles : [];
}
async function writeProfiles(arr) {
    await chrome.storage.sync.set({ profiles: arr });
}

// ---------- UI helpers ----------
function updateExportationOptions() {
    const baseType = f_projeto_base_type.value;
    const exportSelect = f_type_exportation;

    for (let option of exportSelect.options) option.disabled = false;

    if (baseType === "Template") {
        for (let option of exportSelect.options) {
            if (option.value === "Active-Active" || option.value === "Active-Template") {
                option.disabled = true;
            }
        }
        if (exportSelect.value === "Active-Active" || exportSelect.value === "Active-Template") {
            exportSelect.value = "Template-Active";
        }
    }
}

// Aggiorna le opzioni di Tipo de Cópia in base al Tipo de Exportação
function updateTipoCopiaOptions() {
    const exportType = f_type_exportation.value;
    const tipoSelect = f_tipo_copia;

    // Abilita tutto di default
    for (let opt of tipoSelect.options) opt.disabled = false;

    // Active → Template: consentire SOLO "Clear Data"
    if (exportType === "Active-Template") {
        for (let opt of tipoSelect.options) {
            if (opt.value !== "clear_data") opt.disabled = true;
        }
        // forza il valore se diverso
        if (tipoSelect.value !== "clear_data") tipoSelect.value = "clear_data";
    }
}

function openModal(prefill = null) {
    modal.classList.remove("hidden");
    document.body.classList.add("no-scroll");

    if (prefill) {
        f_id.value = prefill.id || "";
        f_projeto_base.value = prefill.projeto_base || "";
        f_projeto_base_type.value = prefill.projeto_base_type || "Active";
        f_type_exportation.value = prefill.type_exportation || "Active-Active";
        f_tipo_copia.value = prefill.tipo_copia || "entire_entire";
        f_user_id.value = prefill.user_id || "";
    } else {
        f_id.value = "";
        f_projeto_base.value = "";
        f_projeto_base_type.value = "Active";
        f_type_exportation.value = "Active-Active";
        f_tipo_copia.value = "entire_entire";
        f_user_id.value = "";
    }
    updateExportationOptions();
    updateTipoCopiaOptions();
    f_projeto_base.focus();

    requestAnimationFrame(autosizePopup);
}

function closeModal() {
    modal.classList.add("hidden");
    document.body.classList.remove("no-scroll");
    requestAnimationFrame(autosizePopup);
}

function smallMeta(profile) {
    return [
        `Base: ${profile.projeto_base_type} • Export: ${profile.type_exportation}`,
        `Cópia: ${labelTipo(profile.tipo_copia)} • ID: ${profile.user_id || "—"}`
    ].join("  |  ");
}

function labelTipo(v) {
    switch (v) {
        case "entire_entire": return "Entire Project";
        case "entire_exclude": return "Entire (Exclude)";
        case "phase_task_structure": return "Phase & Task Structure";
        case "clear_data": return "Clear Data";
        default: return v || "—";
    }
}

function render(profiles) {
    listEl.innerHTML = "";

    if (profiles.length > 5) listEl.classList.add("scrollable");
    else listEl.classList.remove("scrollable");

    if (!profiles.length) {
        const empty = document.createElement("div");
        empty.className = "slot";
        empty.innerHTML = `
      <p class="slot-title">Nenhum perfil criado</p>
      <div class="slot-actions"></div>
      <div class="slot-meta">Clique em (+) para adicionar um novo perfil de cópia.</div>
    `;
        listEl.appendChild(empty);
        requestAnimationFrame(autosizePopup);
        return;
    }

    profiles.forEach((p) => {
        const div = document.createElement("div");
        div.className = "slot";

        // === TÍTULO PRINCIPAL ===
        const title = document.createElement("p");
        title.className = "slot-title";
        title.textContent = p.projeto_base || "(Sem nome)";

        // >>> NOVO: clic no título executa o Launch <<<
        title.style.cursor = "pointer";
        title.title = "Clique para lançar este perfil";
        title.addEventListener("click", () => launchProfile(p));

        const actions = document.createElement("div");
        actions.className = "slot-actions";

        // Launch
        const bLaunch = document.createElement("button");
        bLaunch.className = "btn launch";
        bLaunch.title = "Launch";
        bLaunch.setAttribute("aria-label", "Launch");
        bLaunch.textContent = "L"; // semplice etichetta per evitare uso icona
        bLaunch.addEventListener("click", () => launchProfile(p));

        // Duplicar
        const bDup = document.createElement("button");
        bDup.className = "btn dup";
        bDup.title = "Duplicar";
        bDup.setAttribute("aria-label", "Duplicar");
        bDup.innerHTML = `<img src="icons/duplicate.png" alt="Duplicar" />`;
        bDup.addEventListener("click", async () => {
            const profiles = await readProfiles();
            const clone = { ...p, id: String(Date.now()) };
            clone.projeto_base = p.projeto_base;
            await writeProfiles([clone, ...profiles]);
            await reload();
        });

        // Editar → **ABRE IN UNA NUOVA TAB**
        const bEdit = document.createElement("button");
        bEdit.className = "btn edit";
        bEdit.title = "Editar";
        bEdit.setAttribute("aria-label", "Editar");
        bEdit.innerHTML = `<img src="icons/edit.png" alt="Editar" />`;
        bEdit.addEventListener("click", () => {
            const url = chrome.runtime.getURL(`popup.html#edit:${encodeURIComponent(p.id)}`);
            chrome.tabs.create({ url });
            window.close();
        });

        // Remover
        const bDel = document.createElement("button");
        bDel.className = "btn del";
        bDel.title = "Remover";
        bDel.setAttribute("aria-label", "Remover");
        bDel.innerHTML = `<img src="icons/remove.png" alt="Remover" />`;
        bDel.addEventListener("click", async () => {
            const ok = confirm(`Remover o perfil "${p.projeto_base}"?`);
            if (!ok) return;
            const profiles = await readProfiles();
            const out = profiles.filter((x) => x.id !== p.id);
            await writeProfiles(out);
            await reload();
        });

        actions.appendChild(bLaunch);
        actions.appendChild(bDup);
        actions.appendChild(bEdit);
        actions.appendChild(bDel);

        const meta = document.createElement("div");
        meta.className = "slot-meta";
        meta.textContent = smallMeta(p);

        div.appendChild(title);
        div.appendChild(actions);
        div.appendChild(meta);
        listEl.appendChild(div);
    });

    requestAnimationFrame(autosizePopup);
}

async function reload() {
    const profiles = await readProfiles();
    render(profiles);
    handleDeepLink(); // gestisce #new / #edit:ID quando la pagina è aperta in TAB
}

/* ===== Deep-link quando aperta in NUOVA TAB =====
   #new        → apre editor profilo vuoto
   #edit:<id>  → apre editor profilo con prefill del profilo <id> */
async function handleDeepLink() {
    const h = window.location.hash || "";
    if (!h) return;

    if (h === "#new") {
        openModal(null);
        return;
    }
    if (h.startsWith("#edit:")) {
        const id = decodeURIComponent(h.slice("#edit:".length));
        const arr = await readProfiles();
        const p = arr.find(x => x.id === id) || null;
        openModal(p);
    }
}

// ---------- Handlers ----------
addBtn.addEventListener("click", () => {
    // **ABRE IN UNA NUOVA TAB** l'editor vuoto
    const url = chrome.runtime.getURL("popup.html#new");
    chrome.tabs.create({ url });
    window.close();
});
// Botão TEST: abre a URL de projetos em nova aba
if (testLaunchBtn) {
    testLaunchBtn.addEventListener("click", () => {
        const url = "https://qa2.facilitygrid.net/main/projects";
        chrome.tabs.create({ url });
        window.close();
    });
}
closeModalBtn.addEventListener("click", closeModal);
cancelEditBtn.addEventListener("click", closeModal);

f_projeto_base_type.addEventListener("change", () => { updateExportationOptions(); updateTipoCopiaOptions(); });
f_type_exportation.addEventListener("change", updateTipoCopiaOptions);

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const profile = {
        id: f_id.value || String(Date.now()),
        projeto_base: f_projeto_base.value.trim(),
        projeto_base_type: f_projeto_base_type.value,
        type_exportation: f_type_exportation.value,
        tipo_copia: f_tipo_copia.value,
        user_id: f_user_id.value.trim()
    };

    if (!profile.projeto_base) {
        alert("O campo 'Nome do Projeto base' é obrigatório.");
        return;
    }

    const arr = await readProfiles();
    const idx = arr.findIndex((x) => x.id === profile.id);
    if (idx >= 0) {
        arr[idx] = profile;
    } else {
        arr.unshift(profile);
    }
    await writeProfiles(arr);
    closeModal();
    await reload();
});

async function launchProfile(profile) {
    try {
        // Fallback: salva profilo pendente per bootstrap dal content.js
        try {
            await chrome.storage.local.set({
                pending_profile: profile,
                pending_profile_time: Date.now(),
            });
        } catch {}

        await chrome.runtime.sendMessage({
            type: "LAUNCH_COPY_WITH_PROFILE",
            payload: { settings: profile }
        });
        window.close();
    } catch (e) {
        console.error("Erro ao lançar:", e);
        alert("Falha ao iniciar a cópia. Verifique o Service Worker.");
    }
}

// ---------- Boot ----------
reload();
requestAnimationFrame(autosizePopup);
window.addEventListener("resize", autosizePopup);
