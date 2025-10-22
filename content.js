// FastCopy/SpeedCopy - Content Script (PT-BR)
// Responsável por interagir com o DOM da página Angular (FG Cloud).

let __speedcopy_alreadyStarted = false; // mutex simples p/ evitar fluxo duplicado

/** Helpers gerais **/

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(selectorOrFn, { timeout = 20000, interval = 200 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        let el = null;
        if (typeof selectorOrFn === "string") {
            el = document.querySelector(selectorOrFn);
        } else {
            try {
                el = selectorOrFn();
            } catch { }
        }
        if (el) return el;
        await sleep(interval);
    }
    throw new Error(`Elemento não encontrado dentro do timeout: ${selectorOrFn}`);
}

/** Visibilidade robusta (funciona com position:fixed, display/visibility etc.) */
function isVisible(el) {
    if (!el) return false;
    const rects = el.getClientRects?.();
    if (!rects || rects.length === 0) return false;
    const cs = window.getComputedStyle(el);
    if (!cs) return true;
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect?.();
    if (r && (r.width <= 0 || r.height <= 0)) return false;
    return true;
}

async function clickElement(el) {
    el.scrollIntoView({ block: "center", inline: "center" });
    el.click();
    await sleep(300);
}

async function clickElementHard(el) {
    el.scrollIntoView({ block: "center", inline: "center" });
    const evOpts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent("pointerdown", evOpts));
    el.dispatchEvent(new MouseEvent("mousedown", evOpts));
    el.dispatchEvent(new MouseEvent("mouseup", evOpts));
    el.dispatchEvent(new MouseEvent("click", evOpts));
    await sleep(300);
}

function textIncludes(el, txt) {
    return (el?.textContent || "").trim().toLowerCase().includes(txt.toLowerCase());
}

async function typeInInput(el, value) {
    el.focus();
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(50);
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(300);
}

/** Dia+Mês sem zeros à esquerda (ex.: 29/9 -> "299") **/
function todayDM() {
    const dt = new Date();
    const d = String(dt.getDate());
    const m = String(dt.getMonth() + 1);
    return `${d}${m}`;
}

/** ag-Grid: primeira linha útil **/
function findFirstGridRow() {
    const sels = [
        ".ag-center-cols-container .ag-row",
        ".ag-body-viewport .ag-row",
        ".ag-floating-top .ag-row",
    ];
    for (const sel of sels) {
        const row = document.querySelector(sel);
        if (row) return row;
    }
    return null;
}

/** Rodapé "Showing ..." **/
function findResultsValueEl() {
    const specific = document.querySelector('div.d-table-cell.align-middle.w-25.text-right span');
    if (specific && /showing/i.test(specific.textContent || "")) return specific;

    const spans = [...document.querySelectorAll("span")];
    return spans.find((s) => /showing/i.test(s.textContent || ""));
}

async function waitUntilNotShowingZero({ timeout = 20000, interval = 200 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const el = findResultsValueEl();
        if (el && !/showing\s*0/i.test(el.textContent || "")) return el;
        await sleep(interval);
    }
    throw new Error('Ainda exibindo "Showing 0" após o timeout.');
}

/** Procura raízes de modais visíveis para escopo de busca de botões **/
function getVisibleDialogRoots() {
    const cands = [
        '[role="dialog"]',
        '.mat-dialog-container',
        '.modal-dialog',
        '.modal',
        '.modal-content',
        'app-copy-project',
        'app-copyproject',
        'app-copy-project-modal',
    ];
    const found = cands.flatMap((sel) => Array.from(document.querySelectorAll(sel))).filter(isVisible);
    return found.length ? found : [document];
}

/** Selecionador ROBUSTO para o botão "Create" do 1º modal */
function findCreateButton() {
    const roots = getVisibleDialogRoots();

    // 1) Preferência: id + role conforme screenshot
    for (const root of roots) {
        const btn = root.querySelector('button#dlg_button_1[role="new"]');
        if (btn && isVisible(btn) && !btn.disabled && textIncludes(btn, "Create")) return btn;
    }

    // 2) Qualquer botão com role="new" e texto Create
    for (const root of roots) {
        const btns = [...root.querySelectorAll('button[role="new"]')];
        const hit = btns.find((b) => isVisible(b) && !b.disabled && textIncludes(b, "Create"));
        if (hit) return hit;
    }

    // 3) Span "Create" -> sobe para o botão
    for (const root of roots) {
        const spans = [...root.querySelectorAll("span")].filter((s) => textIncludes(s, "Create"));
        for (const s of spans) {
            const b = s.closest("button");
            if (b && isVisible(b) && !b.disabled) return b;
        }
    }

    // 4) Fallback global
    const any = [...document.querySelectorAll("button, .btn, .mat-button")].find(
        (b) => isVisible(b) && !b.disabled && textIncludes(b, "Create"),
    );
    return any || null;
}

/** Helper: obtém o input do floating-filter (coluna 3) — reconsulta após trocar de aba */
async function getFloatingFilterInput() {
    const floatingBodyCol3 = await waitFor(() => {
        const candidates = [
            ...document.querySelectorAll('div[ref="eFloatingFilterBody"][role="columnheader"][aria-colindex]'),
        ];
        return candidates.find((div) => (div.getAttribute("aria-colindex") || "").trim() === "3");
    });
    let filterInput = floatingBodyCol3.querySelector('input[ref="eFloatingFilterText"].ag-floating-filter-input');
    if (!filterInput) {
        filterInput = await waitFor(
            'div[ref="eFloatingFilterBody"][aria-colindex="3"] input[ref="eFloatingFilterText"]',
        );
    }
    return filterInput;
}

/** ========== NOVO: helpers per tab Template ========== **/

function isTabActive(el) {
    if (!el) return false;
    const cls = el.className || "";
    return (
        el.getAttribute?.("aria-selected") === "true" ||
        el.getAttribute?.("aria-current") === "page" ||
        /(^|\s)active(\s|$)/i.test(cls) ||
        /mat-tab-label-active|selected|is-active/i.test(cls)
    );
}

async function activateTemplateTab() {
    // Clica na tab "Template" e espera ela realmente ficar ativa
    const clickTarget = await waitFor(() => {
        const tabs = [...document.querySelectorAll("a, button, .mat-tab-label, .nav-link")];
        return tabs.find((a) => textIncludes(a, "Template"));
    });
    await clickElement(clickTarget);

    // Espera o "estado ativo" ficar verdadeiro
    await waitFor(() => {
        const tabs = [...document.querySelectorAll("a, button, .mat-tab-label, .nav-link")];
        const tpl = tabs.find((a) => textIncludes(a, "Template"));
        return tpl && isTabActive(tpl) ? tpl : null;
    }, { timeout: 10000, interval: 150 });
}

/** Recupera o input da coluna 3 garantindo que o container esteja visível (evita handle "stale") */
async function getFloatingFilterInputFresh() {
    const input = await waitFor(() => {
        const containers = [...document.querySelectorAll('div[ref="eFloatingFilterBody"][role="columnheader"][aria-colindex="3"]')]
            .filter(isVisible);
        const inp = containers[0]?.querySelector('input[ref="eFloatingFilterText"]');
        return inp && isVisible(inp) ? inp : null;
    }, { timeout: 10000, interval: 150 });
    return input;
}

/** ===== Controle seguro do painel de filtro ===== **/

function isFilterPanelOpen() {
    const el = document.querySelector('div[ref="eFloatingFilterBody"]');
    return !!(el && isVisible(el));
}

async function findFilterButton() {
    return await waitFor(() => {
        const all = [...document.querySelectorAll('img[title="Filter Results"]')];
        return all.find((img) => (img.getAttribute("src") || "").includes("toolbar-filter.png"));
    });
}

async function ensureFilterOpen() {
    if (isFilterPanelOpen()) return;
    const filterImg = await findFilterButton();
    await clickElement(filterImg);
    await sleep(300);
}

/** Limpa imediatamente o valor do floating filter, se existir (não espera DOM novo) */
function clearFloatingFilterIfAny() {
    const input = document.querySelector('div[ref="eFloatingFilterBody"] input[ref="eFloatingFilterText"]');
    if (input) {
        input.focus();
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }
}

/** ===== Toast (popup) sem permissões) ===== **/

function ensureToastStyles() {
    if (document.getElementById("speedcopy-toast-style")) return;
    const style = document.createElement("style");
    style.id = "speedcopy-toast-style";
    style.textContent = `
      @keyframes sc-fadein { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes sc-fadeout { from { opacity: 1; } to { opacity: 0; } }
      .sc-toast {
        position: fixed;
        right: 16px;
        bottom: 16px;
        max-width: min(560px, 92vw);
        background: rgba(20, 20, 20, 0.96);
        color: #fff;
        font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji", sans-serif;
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        padding: 12px 14px;
        z-index: 2147483647;
        display: grid;
        grid-template-columns: auto 1fr auto;
        grid-template-rows: auto auto;
        grid-column-gap: 12px;
        grid-row-gap: 8px;
        animation: sc-fadein 180ms ease-out forwards;
      }
      .sc-toast.sc-dismissing { animation: sc-fadeout 280ms ease-in forwards; }

      .sc-icon { width: 18px; height: 18px; margin-top: 2px; opacity: 0.9; grid-row: 1 / span 2; }
      .sc-icon::before { content: "✔"; display: inline-block; width: 18px; height: 18px; }

      .sc-body { grid-column: 2; }
      .sc-title { font-weight: 700; margin: 0 0 2px 0; font-size: 14px; }
      .sc-sub { margin: 0; opacity: 0.85; font-size: 13px; }

      .sc-actions { grid-column: 3; display: flex; align-items: center; gap: 8px; }
      .sc-btn {
        appearance: none; border: none; border-radius: 8px; padding: 6px 10px;
        font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
        background: #2f7d32; color: #fff; white-space: nowrap;
      }
      .sc-btn:hover { filter: brightness(0.95); }
      .sc-btn.secondary { background: #3b3b3b; }

      .sc-copy-icon {
        width: 14px; height: 14px; display: inline-block; vertical-align: middle;
        background-size: 14px 14px; background-repeat: no-repeat; background-position: center center;
      }

      .sc-close {
        grid-column: 3;
        justify-self: end;
        align-self: start;
        background: transparent;
        border: none;
        color: #fff;
        font-size: 16px;
        line-height: 1;
        opacity: 0.9;
        cursor: pointer;
        padding: 2px 6px;
      }
      .sc-close:hover { opacity: 1; }
    `;
    document.documentElement.appendChild(style);
}

function removeExistingToast() {
    const existing = document.querySelector(".sc-toast");
    if (!existing) return;
    existing.classList.add("sc-dismissing");
    setTimeout(() => existing.remove(), 280);
}

/**
 * Mostra um toast com botão "Copiar nome" e botão de fechar (X).
 * Permanece 5s e NÃO cancela por interação (hover/focus).
 * @param {string} projName
 * @param {"Active"|"Template"} targetType
 */
function showCreationToast(projName, targetType) {
    ensureToastStyles();
    removeExistingToast();

    const toast = document.createElement("div");
    toast.className = "sc-toast";

    const icon = document.createElement("div");
    icon.className = "sc-icon";

    const body = document.createElement("div");
    body.className = "sc-body";

    const title = document.createElement("p");
    title.className = "sc-title";
    title.textContent = `Projeto "${projName}" criado.`;

    const sub = document.createElement("p");
    sub.className = "sc-sub";
    sub.textContent = `Lembre-se: o projeto é do tipo ${targetType}.`;

    const sub2 = document.createElement("p");
    sub2.className = "sc-sub";
    sub2.textContent = "Aguarde a conclusão da cópia.";

    const actions = document.createElement("div");
    actions.className = "sc-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "sc-btn secondary";
    copyBtn.title = "Copiar nome do projeto";
    const copyIconUrl = chrome.runtime.getURL("icons/copy_icon.png");
    const copyIcon = document.createElement("span");
    copyIcon.className = "sc-copy-icon";
    copyIcon.style.backgroundImage = `url("${copyIconUrl}")`;
    const copyLabel = document.createElement("span");
    copyLabel.textContent = "Copiar nome";
    copyBtn.appendChild(copyIcon);
    copyBtn.appendChild(copyLabel);
    copyBtn.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(projName);
            const original = copyLabel.textContent;
            copyLabel.textContent = "Copiado!";
            setTimeout(() => (copyLabel.textContent = original), 900);
        } catch {
            const ta = document.createElement("textarea");
            ta.value = projName;
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            try { document.execCommand("copy"); } catch { }
            document.body.removeChild(ta);
            const original = copyLabel.textContent;
            copyLabel.textContent = "Copiado!";
            setTimeout(() => (copyLabel.textContent = original), 900);
        }
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "sc-close";
    closeBtn.setAttribute("aria-label", "Fechar");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => {
        toast.classList.add("sc-dismissing");
        setTimeout(() => toast.remove(), 200);
    });

    body.appendChild(title);
    body.appendChild(sub);
    body.appendChild(sub2);
    actions.appendChild(copyBtn);

    toast.appendChild(icon);
    toast.appendChild(body);
    toast.appendChild(actions);
    toast.appendChild(closeBtn);

    document.documentElement.appendChild(toast);

    setTimeout(() => {
        if (!toast.isConnected) return;
        toast.classList.add("sc-dismissing");
        setTimeout(() => toast.remove(), 280);
    }, 5000);
}

/** Passo-a-passo principal **/
async function runFastCopyFlow(settings, counterToday) {
    // 1) Garantir que estamos na tela /main/projects

    // 2) **SEMPRE** abrir o filtro ANTES de trocar de aba
    await ensureFilterOpen();

    if (settings.projeto_base_type === "Template") {
        // 2.a) (IMPORTANTÍSSIMO) Limpa qualquer valor atual do filtro **antes** do switch,
        // para evitar que pareça "inserido" antes da troca.
        clearFloatingFilterIfAny();

        // 2.b) Trocar para a aba Template **e esperar estado ativo**
        await activateTemplateTab();

        // 2.c) Esperar pelos dados (sem "Showing 0")
        await waitUntilNotShowingZero();

        // 2.d) (SANEAMENTO) Limpa novamente após o switch para garantir estado limpo
        clearFloatingFilterIfAny();

        // 2.e) **SÓ AGORA** obter o input fresco e inserir o nome do projeto
        const filterInput = await getFloatingFilterInputFresh();
        await typeInInput(filterInput, settings.projeto_base);
    } else {
        // Caminho Active normal
        await waitUntilNotShowingZero();
        const filterInput = await getFloatingFilterInput();
        await typeInInput(filterInput, settings.projeto_base);

        const tabs = [...document.querySelectorAll("a, button")];
        const activeTab = tabs.find((a) => textIncludes(a, "Active"));
        if (activeTab) await clickElement(activeTab);
        await sleep(500);
    }

    // Tempo para aplicar filtro
    await sleep(700);

    // 5) Primeira linha
    const firstRow = await waitFor(() => findFirstGridRow());
    await clickElement(firstRow);

    // 6) Actions — torna a detecção mais resiliente (mouseover + múltiplos seletores)
    try {
        firstRow.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    } catch { }
    await sleep(200);

    const actionsSelectors = [
        '[data-type="actions-menu"]',
        'p[data-type="actions-menu"]',
        'button[title*="Action" i]',
        '[aria-label*="Action" i]'
    ].join(", ");

    const actionsBtn = await waitFor(() => {
        // 1) Dentro da linha
        const inRow = firstRow.querySelector(actionsSelectors);
        if (inRow && isVisible(inRow)) return inRow;

        // 2) Texto "Actions" dentro da linha
        const textInRow = [...firstRow.querySelectorAll("p, span, button")]
            .find((el) => isVisible(el) && textIncludes(el, "Actions"));
        if (textInRow) return textInRow;

        // 3) Global (último recurso)
        const global = document.querySelector(actionsSelectors);
        if (global && isVisible(global)) return global;

        const textGlobal = [...document.querySelectorAll("p, span, button")]
            .find((el) => isVisible(el) && textIncludes(el, "Actions"));
        return textGlobal || null;
    }, { timeout: 12000, interval: 200 });
    await clickElement(actionsBtn);

    // 7) Copy
    const copyItem = await waitFor(() => {
        const ps = [...document.querySelectorAll('p[id^="action_menuitem_"]')];
        return ps.find((p) => textIncludes(p, "Copy"));
    });
    await clickElement(copyItem);

    // 8) Modal → Nome
    const nameInput = await waitFor('input#name[formcontrolname="name"]');

    // Nome: "Copy {YourID} {n} {DM}"
    const userId = (settings.user_id || "").trim();
    let n = Number(counterToday);
    if (!Number.isFinite(n) || n < 1) n = 1;
    const dm = todayDM();
    const parts = ["Copy"];
    if (userId) parts.push(userId);
    parts.push(String(n));
    parts.push(dm);
    const finalName = parts.join(" ");
    console.debug("[SpeedCopy][content] finalName:", finalName, { counterToday, dm, userId });
    await typeInInput(nameInput, finalName);

    // === NOVO: regras específicas para Active → Active
    const isActiveBase = settings.projeto_base_type === "Active";
    const isActiveToActive = settings.type_exportation === "Active-Active";
    const isActiveToTemplate = settings.type_exportation === "Active-Template";
    const isTemplateBase = settings.projeto_base_type === "Template";
    const isTemplateToActive = settings.type_exportation === "Template-Active";
    const isTemplateToTemplate = settings.type_exportation === "Template-Template";
    const isEntireProject = settings.tipo_copia === "entire_entire";
    const isEntireExclude = settings.tipo_copia === "entire_exclude";
    const isClearData = settings.tipo_copia === "clear_data";
    // 1) Não selecionar rádio export quando for Active-Active (já vem por padrão)
    const skipRadioSelection = isActiveBase && isActiveToActive; // per Active→Active non tocchiamo i radio
    // 2) Opções de cópia no modal
    const skipCopyOptions_EntireProject = isActiveBase && isActiveToActive && isEntireProject; // não clica nada
    const onlyExcludeOnNewProject_EntireExclude = isActiveBase && isActiveToActive && isEntireExclude; // clica só Exclude
    const onlyClearData_ClearData = isActiveBase && isActiveToActive && isClearData; // clica só Clear Data

    // 9) Exportação: rádio (Template/Active)
    // A PEDIDO: **NÃO** selecionar o radio quando for Active-Active (já vem por padrão)
    if (!skipRadioSelection) {
        const wantTemplate =
            settings.type_exportation === "Active-Template" ||
            settings.type_exportation === "Template-Template";

        const radioContainers = [...document.querySelectorAll(".mat-radio-button, .mat-radio-label")];
        const templateRadio = radioContainers.find((el) => textIncludes(el, "Template"));
        const activeRadio = radioContainers.find(
            (el) => !textIncludes(el, "Template") && el.matches(".mat-radio-button, .mat-radio-label"),
        );

        if (wantTemplate && templateRadio) {
            await clickElement(templateRadio.querySelector("input[type=radio]") || templateRadio);
        } else if (!wantTemplate && activeRadio) {
            await clickElement(activeRadio.querySelector("input[type=radio]") || activeRadio);
        } else {
            const radios = [...document.querySelectorAll('input[type="radio"][name="save_as"]')];
            const rTemplate = radios.find((r) => r.id.includes("-1-")) || radios[0];
            const rActive = radios.find((r) => r.id.includes("-2-")) || radios[1] || radios[0];
            await clickElement(wantTemplate ? rTemplate : rActive);
        }
        await sleep(300);
    } else {
        // pulamos a seleção de rádio
        await sleep(300);
    }

    // 10) Tipo de Cópia
    // Regras solicitadas:
    // - Active→Active + Entire Project: não clica nada
    // - Active→Active + Entire (Exclude): clica SOMENTE "Exclude On The New Project"
    // - Active→Template: somente "Clear Data" é permitido
    async function clickClearData() {
        const label = [...document.querySelectorAll("label")].find((l) => textIncludes(l, "Clear Data"));
        if (label) await clickElement(label);
    }
    async function clickExcludeOnNewProject() {
        const label = [...document.querySelectorAll("label")].find((l) => textIncludes(l, "Exclude On The New Project"));
        if (label) await clickElement(label);
    }
    async function clickPhaseTaskStructure() {
        const span = [...document.querySelectorAll("span.fs-16, span.option, span")].find(
            (s) => textIncludes(s, "Phase") && textIncludes(s, "Task"),
        );
        if (span) await clickElement(span);
    }

    if (skipCopyOptions_EntireProject) {
        // não clicar nada
    } else if (onlyExcludeOnNewProject_EntireExclude) {
        await clickExcludeOnNewProject();
    } else if (onlyClearData_ClearData) {
        await clickClearData();
    } else if (isActiveToTemplate) {
        // Active → Template: forçamos apenas Clear Data
        await clickClearData();
    } else if (isTemplateBase && isTemplateToActive && isEntireProject) {
        // Template → Active + Entire Project: não clicar Clear/Exclude
        // prossegue direto para Create
    } else if (isTemplateBase && isTemplateToActive && isEntireExclude) {
        // Template → Active + Entire (Exclude): clicar SOMENTE "Exclude On The New Project"
        await clickExcludeOnNewProject();
    } else if (isTemplateBase && isTemplateToActive && isClearData) {
        // Template → Active + Clear Data: clicar explicitamente em "Clear Data"
        await clickClearData();
    } else if (isTemplateBase && isTemplateToTemplate && isClearData) {
        // Template → Template + Clear Data: clicar explicitamente em "Clear Data"
        await clickClearData();
    } else {
        // comportamento anterior
        switch (settings.tipo_copia) {
            case "entire_entire":
                await clickClearData();
                await clickExcludeOnNewProject();
                break;
            case "entire_exclude":
                await clickClearData();
                break;
            case "phase_task_structure":
                await clickPhaseTaskStructure();
                break;
            case "clear_data":
                // Não fazer nada de propósito.
                break;
            default:
                break;
        }
    }
    await sleep(400);

    // 11) CREATE — usa seletor robusto
    const createBtn = await waitFor(() => findCreateButton(), { timeout: 15000, interval: 200 });
    await clickElementHard(createBtn);

    // 11.b) Esperar modal de confirmação
    await waitFor(
        () => {
            const ps = [...document.querySelectorAll("app-confirm-copy p, .modal-body p, p")];
            return ps.find((p) => textIncludes(p, "This copy may take some time to finish."));
        },
        { timeout: 15000, interval: 200 },
    );

    // 11.c) Botão "Copy" no modal de confirmação
    const confirmCopyBtn = await waitFor(
        () => {
            const byId = document.querySelector('button#dlg_button_1[role="ok"]');
            if (byId && textIncludes(byId, "Copy")) return byId;

            const s = [...document.querySelectorAll("span")].find((sp) => textIncludes(sp, "Copy"));
            const b = s?.closest("button");
            if (b) return b;

            return (
                [...document.querySelectorAll("button, .btn, .mat-button")].find((btn) => textIncludes(btn, "Copy")) ||
                null
            );
        },
        { timeout: 10000, interval: 200 },
    );

    await clickElementHard(confirmCopyBtn);

    // 11.d) Espera o modal sumir
    await waitFor(() => !document.querySelector("app-confirm-copy"), { timeout: 10000, interval: 200 });

    // ===== TOASTER NO FINAL DO PROCESSO (sem esperar a imagem) =====
    const targetType = (settings.type_exportation === "Active-Template" || settings.type_exportation === "Template-Template")
        ? "Template"
        : "Active";
    showCreationToast(finalName, targetType);

    console.log("[SpeedCopy] Fluxo concluído com nome:", finalName);
}

/** Fallback bootstrap: inicia automático se encontrar perfil pendente salvo pelo popup */
(async function bootstrapPendingLaunch() {
    try {
        const { pending_profile, pending_profile_time } = await chrome.storage.local.get([
            "pending_profile",
            "pending_profile_time",
        ]);
        const fresh = typeof pending_profile_time === "number" && (Date.now() - pending_profile_time) < 5 * 60 * 1000;

        if (pending_profile && fresh && !__speedcopy_alreadyStarted) {
            __speedcopy_alreadyStarted = true;
            // consome o pending para não duplicar
            await chrome.storage.local.remove(["pending_profile", "pending_profile_time"]);

            // pede contador ao SW (com fallback para 1)
            let counterToday = 1;
            try {
                const res = await chrome.runtime.sendMessage({ type: "FASTCOPY_GET_COUNTER_NOW" });
                if (res && res.ok && Number.isFinite(res.counterToday)) counterToday = res.counterToday;
            } catch { }

            console.debug("[SpeedCopy][content] Bootstrap pendente → iniciando fluxo.");
            await runFastCopyFlow(pending_profile, counterToday);
        }
    } catch (e) {
        console.error("[SpeedCopy][content] Erro no bootstrap pendente:", e);
    }
})();

/** Listener: inicia fluxo quando o SW sinaliza */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
        if (msg?.type === "FASTCOPY_START") {
            if (__speedcopy_alreadyStarted) {
                sendResponse({ ok: false, error: "Fluxo já iniciado; ignorando duplicata." });
                return;
            }
            try {
                __speedcopy_alreadyStarted = true;
                await runFastCopyFlow(msg.payload.settings, msg.payload.counterToday);
                sendResponse({ ok: true });
            } catch (e) {
                console.error("[SpeedCopy] Erro no fluxo:", e);
                __speedcopy_alreadyStarted = false; // libera em caso de falha
                sendResponse({ ok: false, error: String(e) });
            }
            return;
        }
        sendResponse({ ok: false, error: "Mensagem desconhecida no content." });
    })();
    return true; // resposta assíncrona
});
