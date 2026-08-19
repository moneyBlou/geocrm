import { initGoogleAuth, requestAccessToken, getAccessToken, hasAccessToken, clearAccessToken } from "./google-auth.js";
import { readValues, batchUpdateRanges, updateRow, appendRow } from "./sheets.js";
import {
  HEADERS, validateHeaders, parseSheet, toRowValues, matchesSearch,
  dateToInput, dateToSheet, dateHuman, moneyHuman, makeHistoryEntry, appendHistory
} from "./data.js";
import { loadYandexMaps, CRMMap } from "./map.js";

const cfg = window.GEOCRM_CONFIG || {};

const state = {
  objects: [],
  filtered: [],
  selected: null,
  currentView: "map",
  map: null,
  mapReady: false,
  busy: false
};

const $ = id => document.getElementById(id);
const ui = {
  connect: $("connectGoogleBtn"),
  disconnect: $("disconnectGoogleBtn"),
  refresh: $("refreshBtn"),
  add: $("addObjectBtn"),
  search: $("searchInput"),
  status: $("statusFilter"),
  priceMin: $("priceMin"),
  priceMax: $("priceMax"),
  priority: $("priorityFilter"),
  due: $("dueFilter"),
  reset: $("resetFiltersBtn"),
  geocode: $("geocodeBtn"),
  geocodeInfo: $("geocodeInfo"),
  resultCount: $("resultCount"),
  todayBadge: $("todayBadge"),
  statTotal: $("statTotal"),
  statOverdue: $("statOverdue"),
  statToday: $("statToday"),
  statInteresting: $("statInteresting"),
  drawer: $("drawer"),
  todaySummary: $("todaySummary"),
  todayLists: $("todayLists"),
  tableBody: $("objectsTableBody"),
  configBanner: $("configBanner"),
  toast: $("toast"),
  backdrop: $("modalBackdrop"),
  objectModal: $("objectModal"),
  contactModal: $("contactModal")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_) {
    return "";
  }
}

function toast(message, type = "") {
  ui.toast.textContent = message;
  ui.toast.className = `toast ${type}`.trim();
  ui.toast.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ui.toast.classList.add("hidden"), 4500);
}

function setBusy(flag) {
  state.busy = flag;
  ui.connect.disabled = flag;
  ui.refresh.disabled = flag;
  ui.add.disabled = flag || !hasAccessToken();
  if (flag) ui.geocode.disabled = true;
  else renderGeocodeState();
}

function missingConfig() {
  const missing = [];
  if (!cfg.googleClientId || String(cfg.googleClientId).includes("PASTE_")) missing.push("Google OAuth Client ID");
  if (!cfg.spreadsheetId || String(cfg.spreadsheetId).includes("PASTE_")) missing.push("Google Sheet ID");
  if (!cfg.yandexMapsApiKey || String(cfg.yandexMapsApiKey).includes("PASTE_")) missing.push("Yandex Maps API key");
  return missing;
}

function renderConfigState() {
  const missing = missingConfig();
  if (!missing.length) {
    ui.configBanner.classList.add("hidden");
    return;
  }
  ui.configBanner.innerHTML = `<strong>До запуска осталось заполнить config.js:</strong> ${escapeHtml(missing.join(", "))}.`;
  ui.configBanner.classList.remove("hidden");
}

function startOfDay(date = new Date()) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function sameDay(a,b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function overdue(item) { return item.nextContact && startOfDay(item.nextContact) < startOfDay(new Date()); }
function dueToday(item) { return item.nextContact && sameDay(item.nextContact, new Date()); }
function tomorrowDate() { const d = startOfDay(new Date()); d.setDate(d.getDate()+1); return d; }

function statusClass(status) {
  switch (String(status || "").toUpperCase()) {
    case "НЕ ДОЗВОНИЛСЯ": return "status-noanswer";
    case "ПЕРЕЗВОНИТЬ": return "status-callback";
    case "ПЕРСПЕКТИВНЫЙ": return "status-interesting";
    case "В РАБОТЕ": return "status-work";
    case "НЕИНТЕРЕСЕН":
    case "АРХИВ": return "status-dead";
    default: return "status-new";
  }
}

function priorityClass(priority) {
  switch (String(priority || "").toUpperCase()) {
    case "СРОЧНЫЙ": return "priority-urgent";
    case "ВЫСОКИЙ": return "priority-high";
    default: return "priority-normal";
  }
}

function renderHistory(history) {
  const text = String(history || "").trim();
  if (!text) return `<div class="empty-row">История пока пустая.</div>`;
  return text.split(/\n\s*[-─]{3,}\s*\n/g).map(chunk => chunk.trim()).filter(Boolean).slice(0,20).map(chunk => {
    const lines = chunk.split("\n");
    const head = lines.shift() || "";
    const body = lines.join("\n").trim();
    return `<div class="history-item"><small>${escapeHtml(head)}</small><p>${escapeHtml(body || "—")}</p></div>`;
  }).join("");
}

async function ensureMap() {
  if (state.mapReady) return;
  if (!cfg.yandexMapsApiKey || String(cfg.yandexMapsApiKey).includes("PASTE_")) throw new Error("В config.js не указан Yandex Maps API key.");
  await loadYandexMaps(cfg.yandexMapsApiKey);
  state.map = new CRMMap({
    containerId: "map",
    center: Array.isArray(cfg.mapCenter) ? cfg.mapCenter : [55.7558,37.6173],
    zoom: Number(cfg.mapZoom || 10),
    onSelect: selectObject
  });
  state.map.init();
  state.mapReady = true;
}

async function normalizeMissingSystemFields() {
  const token = getAccessToken();
  if (!token) return false;
  const data = [];
  let changed = false;

  for (const item of state.objects) {
    if (!item.id) {
      data.push({ range: `${cfg.sheetName}!M${item.rowNumber}`, values: [[crypto.randomUUID()]] });
      changed = true;
    }
    if (!item.status) {
      data.push({ range: `${cfg.sheetName}!H${item.rowNumber}`, values: [["НОВЫЙ"]] });
      changed = true;
    }
    if (!item.priority) {
      data.push({ range: `${cfg.sheetName}!J${item.rowNumber}`, values: [["ОБЫЧНЫЙ"]] });
      changed = true;
    }
  }

  if (data.length) await batchUpdateRanges({ spreadsheetId: cfg.spreadsheetId, token, data });
  return changed;
}

async function loadObjects({ fit = true, preserveId = "" } = {}) {
  const token = getAccessToken();
  if (!token) throw new Error("Google Sheets не подключён.");

  setBusy(true);
  try {
    let values = await readValues({ spreadsheetId: cfg.spreadsheetId, sheetName: cfg.sheetName, token });
    const check = validateHeaders(values);
    if (!check.ok) {
      if (check.missing.length) throw new Error(`В таблице не хватает колонок: ${check.missing.join(", ")}`);
      if (check.orderMismatch) throw new Error("Колонки A:O стоят не в ожидаемом порядке. Сверь их с README.md.");
    }

    state.objects = parseSheet(values);

    const changed = await normalizeMissingSystemFields();
    if (changed) {
      values = await readValues({ spreadsheetId: cfg.spreadsheetId, sheetName: cfg.sheetName, token });
      state.objects = parseSheet(values);
    }

    await ensureMap();
    applyFilters({ fit });

    ui.connect.classList.add("hidden");
    ui.disconnect.classList.remove("hidden");
    ui.add.disabled = false;

    if (preserveId) {
      const object = state.objects.find(o => o.id === preserveId);
      if (object) selectObject(object);
    }

    toast(`Загружено объектов: ${state.objects.length}`, "success");
  } finally {
    setBusy(false);
  }
}

function applyFilters({ fit = false } = {}) {
  const query = ui.search.value.trim();
  const status = ui.status.value;
  const priority = ui.priority.value;
  const min = Number(ui.priceMin.value || 0) * 1_000_000;
  const max = Number(ui.priceMax.value || 0) * 1_000_000;
  const due = ui.due.value;

  state.filtered = state.objects.filter(item => {
    if (!matchesSearch(item, query)) return false;
    if (status && item.status !== status) return false;
    if (priority && item.priority !== priority) return false;
    if (min && (!item.price || item.price < min)) return false;
    if (max && (!item.price || item.price > max)) return false;
    if (due === "overdue" && !overdue(item)) return false;
    if (due === "today" && !dueToday(item)) return false;
    if (due === "tomorrow" && !(item.nextContact && sameDay(item.nextContact, tomorrowDate()))) return false;
    if (due === "none" && item.nextContact) return false;
    return true;
  });

  renderAll({ fit });
}

function renderAll({ fit = false } = {}) {
  ui.resultCount.textContent = `${state.filtered.length} объектов`;
  ui.statTotal.textContent = state.filtered.length;
  ui.statOverdue.textContent = state.objects.filter(overdue).length;
  ui.statToday.textContent = state.objects.filter(dueToday).length;
  ui.statInteresting.textContent = state.objects.filter(x => x.status === "ПЕРСПЕКТИВНЫЙ").length;
  ui.todayBadge.textContent = state.objects.filter(x => overdue(x) || dueToday(x)).length;

  if (state.mapReady) state.map.render(state.filtered, { fit });
  renderToday();
  renderObjectsTable();
  renderGeocodeState();
}

function renderGeocodeState() {
  const missing = state.objects.filter(x => x.address && (!Number.isFinite(x.lat) || !Number.isFinite(x.lng)));
  ui.geocode.disabled = state.busy || !hasAccessToken() || missing.length === 0;
  ui.geocodeInfo.textContent = missing.length
    ? `Без координат: ${missing.length}. За один запуск обработаем до ${Number(cfg.geocodeBatchSize || 20)}.`
    : "У всех объектов есть координаты.";
}

function selectObject(item) {
  state.selected = item;
  renderDrawer(item);
}

function renderDrawer(item) {
  const tel = String(item.phone || "").replace(/[^\d+]/g,"");
  const objectUrl = safeUrl(item.url);
  ui.drawer.innerHTML = `
    <div class="drawer-head">
      <div>
        <h2>${escapeHtml(item.address || "Без адреса")}</h2>
        <div class="price">${moneyHuman(item.price)}</div>
      </div>
      <span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span>
    </div>

    <section class="drawer-section">
      <h3>Контакт</h3>
      <div class="contact-row">
        <div class="contact-name">${escapeHtml(item.name || "Не указан")}</div>
        ${item.phone ? `<a class="phone-link" href="tel:${escapeHtml(tel)}">${escapeHtml(item.phone)}</a>` : `<span>—</span>`}
      </div>
    </section>

    <section class="drawer-section">
      <h3>Ситуация</h3>
      <p>${escapeHtml(item.situation || "Нет заметки")}</p>
    </section>

    <section class="drawer-section">
      <h3>О чем договорились</h3>
      <p>${escapeHtml(item.agreement || "Не указано")}</p>
    </section>

    <section class="drawer-section">
      <div class="drawer-meta">
        <div class="meta"><span>Последний контакт</span><strong>${dateHuman(item.lastContact)}</strong></div>
        <div class="meta"><span>Следующий контакт</span><strong>${dateHuman(item.nextContact)}</strong></div>
        <div class="meta"><span>Приоритет</span><strong><span class="priority-pill ${priorityClass(item.priority)}">${escapeHtml(item.priority)}</span></strong></div>
        <div class="meta"><span>ID</span><strong>${escapeHtml((item.id || "—").slice(0,12))}</strong></div>
      </div>
    </section>

    <section class="drawer-section">
      <div class="drawer-actions">
        <button id="drawerCallBtn" class="btn btn-primary span-2">Зафиксировать звонок</button>
        <button id="drawerEditBtn" class="btn btn-secondary">Редактировать</button>
        ${item.phone ? `<a class="btn btn-secondary object-link" href="tel:${escapeHtml(tel)}">Позвонить</a>` : `<button class="btn btn-secondary" disabled>Нет телефона</button>`}
        ${objectUrl ? `<a class="btn btn-secondary object-link span-2" href="${escapeHtml(objectUrl)}" target="_blank" rel="noopener noreferrer">Открыть объявление ↗</a>` : ""}
      </div>
    </section>

    <section class="drawer-section">
      <h3>История</h3>
      <div class="history">${renderHistory(item.history)}</div>
    </section>
  `;

  $("drawerEditBtn")?.addEventListener("click", () => openObjectModal(item));
  $("drawerCallBtn")?.addEventListener("click", () => openContactModal(item));
}

function renderToday() {
  const today = startOfDay(new Date());
  const tomorrow = tomorrowDate();
  const overdueItems = state.objects.filter(overdue).sort((a,b) => a.nextContact - b.nextContact);
  const todayItems = state.objects.filter(x => x.nextContact && sameDay(x.nextContact,today));
  const tomorrowItems = state.objects.filter(x => x.nextContact && sameDay(x.nextContact,tomorrow));
  const noneItems = state.objects.filter(x => !x.nextContact && !["АРХИВ","НЕИНТЕРЕСЕН"].includes(x.status));

  ui.todaySummary.innerHTML = [
    ["Просрочено", overdueItems.length],
    ["Сегодня", todayItems.length],
    ["Завтра", tomorrowItems.length],
    ["Без даты", noneItems.length]
  ].map(([label,value]) => `<div class="summary-card"><span>${label}</span><strong>${value}</strong></div>`).join("");

  ui.todayLists.innerHTML = [
    todaySection("Просрочено", overdueItems, "Сначала разобраться с ними"),
    todaySection("Сегодня", todayItems, "Рабочий список"),
    todaySection("Завтра", tomorrowItems, "Можно подготовиться"),
    todaySection("Без следующего контакта", noneItems.slice(0,50), "Проверь, не потерялись ли")
  ].join("");

  ui.todayLists.querySelectorAll("[data-object]").forEach(btn => {
    btn.addEventListener("click", () => {
      const item = state.objects.find(x => x.id === btn.dataset.object);
      if (!item) return;
      selectObject(item);
      switchView("map");
      state.map?.focus(item);
    });
  });
}

function todaySection(title, items, subtitle) {
  const content = items.length ? items.map(item => `
    <div class="today-row">
      <div class="today-date">${dateHuman(item.nextContact)}</div>
      <div class="today-object"><strong>${escapeHtml(item.address || "Без адреса")}</strong><span>${escapeHtml(item.name || "Контакт не указан")} · ${escapeHtml(item.status)}</span></div>
      <div class="today-price">${moneyHuman(item.price)}</div>
      <div class="today-action">${escapeHtml(item.agreement || "Связаться с контактом")}</div>
      <button class="btn btn-secondary" data-object="${escapeHtml(item.id)}">Открыть</button>
    </div>`).join("") : `<div class="empty-row">Пусто. Такое тоже иногда случается.</div>`;

  return `<section class="today-section"><div class="today-section-head"><h2>${title}</h2><span>${subtitle} · ${items.length}</span></div>${content}</section>`;
}

function renderObjectsTable() {
  const sorted = [...state.filtered].sort((a,b) => String(a.address).localeCompare(String(b.address),"ru"));
  ui.tableBody.innerHTML = sorted.length ? sorted.map(item => `
    <tr data-object="${escapeHtml(item.id)}">
      <td><strong>${escapeHtml(item.address || "—")}</strong></td>
      <td>${moneyHuman(item.price)}</td>
      <td>${escapeHtml(item.name || "—")}<br><small>${escapeHtml(item.phone || "")}</small></td>
      <td><span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
      <td>${dateHuman(item.nextContact)}</td>
      <td><span class="priority-pill ${priorityClass(item.priority)}">${escapeHtml(item.priority)}</span></td>
    </tr>`).join("") : `<tr><td colspan="6" class="empty-row">Ничего не найдено.</td></tr>`;

  ui.tableBody.querySelectorAll("[data-object]").forEach(row => {
    row.addEventListener("click", () => {
      const item = state.objects.find(x => x.id === row.dataset.object);
      if (!item) return;
      selectObject(item);
      switchView("map");
      state.map?.focus(item);
    });
  });
}

function openModal(modal) {
  ui.backdrop.classList.remove("hidden");
  modal.classList.remove("hidden");
}

function closeModals() {
  ui.backdrop.classList.add("hidden");
  ui.objectModal.classList.add("hidden");
  ui.contactModal.classList.add("hidden");
}

function openObjectModal(item = null) {
  $("objectModalTitle").textContent = item ? "Редактировать объект" : "Добавить объект";
  $("objectModalEyebrow").textContent = item ? "Карточка объекта" : "Новый объект";
  $("objectFormId").value = item?.id || "";
  $("formAddress").value = item?.address || "";
  $("formName").value = item?.name || "";
  $("formPhone").value = item?.phone || "";
  $("formSituation").value = item?.situation || "";
  $("formAgreement").value = item?.agreement || "";
  $("formPrice").value = Number.isFinite(item?.price) ? item.price : "";
  $("formLastContact").value = dateToInput(item?.lastContact);
  $("formStatus").value = item?.status || "НОВЫЙ";
  $("formNextContact").value = dateToInput(item?.nextContact);
  $("formPriority").value = item?.priority || "ОБЫЧНЫЙ";
  $("formUrl").value = item?.url || "";
  openModal(ui.objectModal);
}

function openContactModal(item) {
  $("contactObjectId").value = item.id;
  $("contactNote").value = "";
  $("contactSituation").value = item.situation || "";
  $("contactAgreement").value = item.agreement || "";
  $("contactStatus").value = item.status || "НОВЫЙ";
  $("contactNextDate").value = dateToInput(item.nextContact);
  openModal(ui.contactModal);
}

async function geocodeObjectIfNeeded(object, force = false) {
  if (!force && Number.isFinite(object.lat) && Number.isFinite(object.lng)) return object;
  await ensureMap();
  const result = await state.map.geocode(object.address);
  if (!result) return { ...object, lat: null, lng: null };
  return { ...object, lat: result.lat, lng: result.lng };
}

async function saveObjectFromForm(event) {
  event.preventDefault();
  const token = getAccessToken();
  if (!token) return toast("Сначала подключи Google Sheets.", "error");

  const id = $("objectFormId").value;
  const existing = id ? state.objects.find(x => x.id === id) : null;
  const address = $("formAddress").value.trim();
  if (!address) return;

  let object = {
    rowNumber: existing?.rowNumber,
    address,
    name: $("formName").value.trim(),
    phone: $("formPhone").value.trim(),
    situation: $("formSituation").value.trim(),
    agreement: $("formAgreement").value.trim(),
    price: $("formPrice").value ? Number($("formPrice").value) : null,
    lastContact: $("formLastContact").value ? new Date(`${$("formLastContact").value}T12:00:00`) : null,
    status: $("formStatus").value,
    nextContact: $("formNextContact").value ? new Date(`${$("formNextContact").value}T12:00:00`) : null,
    priority: $("formPriority").value,
    url: $("formUrl").value.trim(),
    history: existing?.history || "",
    id: existing?.id || crypto.randomUUID(),
    lat: existing?.lat ?? null,
    lng: existing?.lng ?? null
  };

  const addressChanged = existing && existing.address !== object.address;
  if (!existing || addressChanged) {
    object.lat = null;
    object.lng = null;
    try { object = await geocodeObjectIfNeeded(object, true); } catch (e) { console.warn(e); }
  }

  setBusy(true);
  try {
    if (existing) {
      const entry = makeHistoryEntry({
        note: "Карточка объекта отредактирована",
        previousStatus: existing.status,
        nextStatus: object.status,
        nextContact: object.nextContact
      });
      object.history = appendHistory(existing.history, entry);
      await updateRow({ spreadsheetId: cfg.spreadsheetId, sheetName: cfg.sheetName, token, rowNumber: existing.rowNumber, values: toRowValues(object) });
      toast("Объект обновлён.", "success");
    } else {
      await appendRow({ spreadsheetId: cfg.spreadsheetId, sheetName: cfg.sheetName, token, values: toRowValues(object) });
      toast("Объект добавлен.", "success");
    }
    closeModals();
    await loadObjects({ fit: !existing, preserveId: object.id });
  } catch (error) {
    toast(`Не удалось сохранить: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

async function saveContact(event) {
  event.preventDefault();
  const token = getAccessToken();
  if (!token) return toast("Сначала подключи Google Sheets.", "error");

  const id = $("contactObjectId").value;
  const existing = state.objects.find(x => x.id === id);
  if (!existing) return toast("Объект не найден.", "error");

  const note = $("contactNote").value.trim();
  const nextStatus = $("contactStatus").value;
  const nextContact = $("contactNextDate").value ? new Date(`${$("contactNextDate").value}T12:00:00`) : null;
  const entry = makeHistoryEntry({ note, previousStatus: existing.status, nextStatus, nextContact });

  const updated = {
    ...existing,
    situation: $("contactSituation").value.trim(),
    agreement: $("contactAgreement").value.trim(),
    lastContact: new Date(),
    status: nextStatus,
    nextContact,
    history: appendHistory(existing.history, entry)
  };

  setBusy(true);
  try {
    await updateRow({ spreadsheetId: cfg.spreadsheetId, sheetName: cfg.sheetName, token, rowNumber: existing.rowNumber, values: toRowValues(updated) });
    closeModals();
    toast("Звонок записан в историю.", "success");
    await loadObjects({ fit: false, preserveId: id });
  } catch (error) {
    toast(`Не удалось записать звонок: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

async function geocodeMissing() {
  const token = getAccessToken();
  if (!token) return toast("Сначала подключи Google Sheets.", "error");
  const limit = Number(cfg.geocodeBatchSize || 20);
  const targets = state.objects.filter(x => x.address && (!Number.isFinite(x.lat) || !Number.isFinite(x.lng))).slice(0,limit);
  if (!targets.length) return toast("Координаты уже заполнены.");

  setBusy(true);
  let ok = 0, failed = 0;
  const data = [];
  try {
    await ensureMap();
    for (let i=0; i<targets.length; i++) {
      const item = targets[i];
      ui.geocodeInfo.textContent = `Геокодирование ${i+1}/${targets.length}: ${item.address}`;
      try {
        const result = await state.map.geocode(item.address);
        if (!result) { failed++; continue; }
        data.push({ range: `${cfg.sheetName}!N${item.rowNumber}:O${item.rowNumber}`, values: [[result.lat,result.lng]] });
        ok++;
      } catch (_) { failed++; }
      await new Promise(r => setTimeout(r,180));
    }

    if (data.length) await batchUpdateRanges({ spreadsheetId: cfg.spreadsheetId, token, data });
    await loadObjects({ fit: true });
    toast(`Координаты: ${ok} успешно, ${failed} ошибок.`, ok ? "success" : "error");
  } catch (error) {
    toast(`Геокодирование: ${error.message}`, "error");
  } finally {
    setBusy(false);
    renderGeocodeState();
  }
}

function resetFilters() {
  ui.search.value = "";
  ui.status.value = "";
  ui.priceMin.value = "";
  ui.priceMax.value = "";
  ui.priority.value = "";
  ui.due.value = "";
  applyFilters({ fit: true });
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll(".view").forEach(node => node.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(node => node.classList.remove("active"));
  $(`${view}View`)?.classList.add("active");
  document.querySelector(`.tab[data-view="${view}"]`)?.classList.add("active");
  if (view === "map") setTimeout(() => state.map?.fitViewport(), 60);
}

async function connectGoogle() {
  const missing = missingConfig();
  if (missing.length) return toast(`Сначала заполни config.js: ${missing.join(", ")}`, "error");

  setBusy(true);
  try {
    if (!hasAccessToken()) await requestAccessToken();
    await loadObjects({ fit: true });
  } catch (error) {
    toast(`Подключение Google: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

function disconnectGoogle() {
  clearAccessToken();
  state.objects = [];
  state.filtered = [];
  state.selected = null;
  ui.connect.classList.remove("hidden");
  ui.disconnect.classList.add("hidden");
  ui.add.disabled = true;
  ui.drawer.innerHTML = `<div class="drawer-empty"><div class="drawer-empty-icon">⌖</div><strong>Google отключён</strong><span>Подключи таблицу снова для работы.</span></div>`;
  renderAll();
}

function bindEvents() {
  ui.connect.addEventListener("click", connectGoogle);
  ui.disconnect.addEventListener("click", disconnectGoogle);
  ui.refresh.addEventListener("click", () => hasAccessToken() ? loadObjects({ fit:false, preserveId: state.selected?.id || "" }).catch(e => toast(e.message,"error")) : toast("Сначала подключи Google.","error"));
  ui.add.addEventListener("click", () => openObjectModal());
  ui.reset.addEventListener("click", resetFilters);
  ui.geocode.addEventListener("click", geocodeMissing);

  [ui.search,ui.priceMin,ui.priceMax].forEach(node => node.addEventListener("input", () => applyFilters()));
  [ui.status,ui.priority,ui.due].forEach(node => node.addEventListener("change", () => applyFilters()));

  document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));
  document.querySelectorAll("[data-go]").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.go)));
  document.querySelectorAll("[data-close-modal]").forEach(btn => btn.addEventListener("click", closeModals));
  ui.backdrop.addEventListener("click", closeModals);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModals(); });

  $("objectForm").addEventListener("submit", saveObjectFromForm);
  $("contactForm").addEventListener("submit", saveContact);
}

async function init() {
  renderConfigState();
  bindEvents();
  renderAll();

  if (cfg.googleClientId && !String(cfg.googleClientId).includes("PASTE_")) {
    try { await initGoogleAuth(cfg.googleClientId); }
    catch (error) { toast(error.message, "error"); }
  }
}

init();
