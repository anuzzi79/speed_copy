// SpeedCopy - Opções (PT-BR)

const $ = (sel) => document.querySelector(sel);
const form = $("#form");
const statusEl = $("#status");

async function load() {
    const defaults = {
        projeto_base: "",
        projeto_base_type: "Active",
        tipo_copia: "entire_entire",
        type_exportation: "Active-Active",
        user_id: "" // <-- NOVO: ID do usuário para compor o nome da cópia
    };
    const data = await chrome.storage.sync.get(Object.keys(defaults));
    const cfg = { ...defaults, ...data };

    $("#projeto_base").value = cfg.projeto_base;
    $("#projeto_base_type").value = cfg.projeto_base_type;
    $("#tipo_copia").value = cfg.tipo_copia;
    $("#type_exportation").value = cfg.type_exportation;
    $("#user_id").value = cfg.user_id;
}

async function save(e) {
    e.preventDefault();
    const cfg = {
        projeto_base: $("#projeto_base").value.trim(),
        projeto_base_type: $("#projeto_base_type").value,
        tipo_copia: $("#tipo_copia").value,
        type_exportation: $("#type_exportation").value,
        user_id: $("#user_id").value.trim() // <-- salva o ID
    };
    await chrome.storage.sync.set(cfg);
    statusEl.textContent = "Configurações salvas!";
    setTimeout(() => (statusEl.textContent = ""), 1500);
}

document.addEventListener("DOMContentLoaded", load);
form.addEventListener("submit", save);
