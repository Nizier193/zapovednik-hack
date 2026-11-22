let data = null;
const get = id => document.getElementById(id);
const dayMs = 86400000;
const palette = {
  ink: "#F1F6E8", muted: "#ACC0B0", line: "#3B5547",
  accent: "#BCED91", warm: "#E4C98A", coral: "#E0A090", blue: "#8FB4A4",
  soil5: "#E4C98A", soil10: "#BCED91", soil20: "#7EAA98",
  speeds: ["#3E6B52", "#6E9A74", "#BCED91", "#E4C98A", "#E0A878"]
};
const metrics = {
  t_air: ["Температура воздуха", "°C"], rh: ["Относительная влажность", "%"],
  wind_speed: ["Скорость ветра", "м/с"], wind_gust: ["Порывы ветра", "м/с"],
  wind_dir: ["Направление ветра", "°"], soil_05: ["Температура почвы, 5 см", "°C"],
  soil_10: ["Температура почвы, 10 см", "°C"], soil_20: ["Температура почвы, 20 см", "°C"],
  pressure_hpa: ["Атмосферное давление", "гПа"]
};
const stations = [
  ["ame60", "АМЕ-60", "1992-2021"],
  ["kr1", "Сокол М1, Кр1", "поляна, 2022-2025"],
  ["kr2", "Сокол М1, Кр2", "поле, 2022-2025"]
];
const sectorNames = ["С", "ССВ", "СВ", "ВСВ", "В", "ВЮВ", "ЮВ", "ЮЮВ", "Ю", "ЮЮЗ", "ЮЗ", "ЗЮЗ", "З", "ЗСЗ", "СЗ", "ССЗ"];
const speedBins = ["0 < v < 2", "2 ≤ v < 5", "5 ≤ v < 10", "10 ≤ v < 15", "v ≥ 15"];
const state = { station: "ame60", metric: "t_air", from: 0, to: 0, focus: null, focusChart: "chart", view: "series", step: "month", trendMonth: 1, lines: [], clipNote: "" };
const format = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const formatFull = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 });
const monthName = new Intl.DateTimeFormat("ru-RU", { month: "short", year: "numeric", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const axisDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const on = id => get(id).checked;
const unit = () => metrics[state.metric][1];
const text = value => value === null || value === undefined || !Number.isFinite(value) ? "нет" : `${formatFull.format(value)} ${unit()}`;
let months = [];
let monthShown = [];
let shown = [];
let editingDates = false;
let brushDrag = null;

function yearsWord(count) {
  const tail = count % 100, last = count % 10;
  if (tail > 10 && tail < 20) return "лет";
  if (last === 1) return "год";
  if (last > 1 && last < 5) return "года";
  return "лет";
}

function stationData() { return data.stations[state.station]; }
function seriesData() { return stationData().series[state.metric]; }
function utcDay(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function dayIndex(dateStr) {
  return Math.round((utcDay(dateStr) - utcDay(stationData().start)) / dayMs);
}
function dateAt(index) { return new Date(utcDay(stationData().start) + index * dayMs); }
function iso(index) { return dateAt(index).toISOString().slice(0, 10); }
function lastIndex() { return Math.max(0, (seriesData().days || []).length - 1); }
function clampIndex(index) {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(lastIndex(), index));
}
function circle(values) {
  const east = average(values.map(v => Math.sin(v * Math.PI / 180)));
  const north = average(values.map(v => Math.cos(v * Math.PI / 180)));
  if (Math.hypot(east, north) < 1e-10) return null;
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
}

// ---- месячные агрегаты (покрытие, частичный месяц, аномалия с явной базой) ----
function buildMonths() {
  const days = seriesData().days || [];
  const groups = new Map();
  days.forEach(entry => {
    const key = entry.d.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  const built = [];
  groups.forEach(items => {
    const first = items[0].d;
    const y = +first.slice(0, 4), m = +first.slice(5, 7);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const partial = +first.slice(8, 10) !== 1 || items.length !== daysInMonth;
    const good = items.filter(item => item.v !== null);
    let streak = 0, longest = 0;
    items.forEach(item => { streak = item.v === null ? streak + 1 : 0; longest = Math.max(longest, streak); });
    const usable = !partial && good.length > 0 && daysInMonth - good.length <= 10 && longest < 5;
    const numbers = good.map(item => item.v).sort((a, b) => a - b);
    const pick = p => numbers.length ? numbers[Math.min(numbers.length - 1, Math.round((numbers.length - 1) * p))] : null;
    let value = null;
    if (usable) value = state.metric === "wind_dir" ? circle(numbers) : average(numbers);
    built.push({
      key: first.slice(0, 7), year: y, month: m,
      start: dayIndex(items[0].d), end: dayIndex(items[items.length - 1].d),
      label: monthName.format(new Date(Date.UTC(y, m - 1, 1))),
      value, q10: usable && state.metric !== "wind_dir" ? pick(0.1) : null,
      q90: usable && state.metric !== "wind_dir" ? pick(0.9) : null,
      anomaly: null, coverage: `${good.length}/${daysInMonth}`, partial, usable
    });
  });
  // Аномалия: месяц минус среднее этого же календарного месяца по всем годам станции (явная база).
  const byMonth = new Map();
  built.forEach(item => {
    if (item.value === null || state.metric === "wind_dir") return;
    if (!byMonth.has(item.month)) byMonth.set(item.month, []);
    byMonth.get(item.month).push({ year: item.year, value: item.value });
  });
  built.forEach(item => {
    const base = byMonth.get(item.month);
    if (item.value !== null && base && base.length >= 2) item.anomaly = item.value - average(base.map(b => b.value));
  });
  return built;
}

function inWindow(item) { return item.start >= state.from && item.end <= state.to; }

// ---- линейный тренд одного календарного месяца по годам (не смешивает сезоны) ----
function monthTrend(items, month) {
  const selected = items.filter(item => item.month === month && !item.partial && item.value !== null);
  const years = selected.map(item => item.year);
  const values = selected.map(item => item.value);
  if (selected.length < 5) return { slope: null, years, n: selected.length };
  const meanX = average(years), meanY = average(values);
  const spread = years.reduce((s, x) => s + (x - meanX) ** 2, 0);
  const slope = spread ? years.reduce((s, x, i) => s + (x - meanX) * (values[i] - meanY), 0) / spread : null;
  return { slope, years, n: selected.length, meanX, meanY };
}

function movingAverage(items) {
  const result = items.map(() => null);
  for (let index = 0; index < items.length; index += 1) {
    const slice = items.slice(Math.max(0, index - 11), index + 1).filter(item => item.value !== null);
    const span = items[index].start - items[Math.max(0, index - 11)].start;
    if (slice.length >= 8 && span < 400) result[index] = average(slice.map(item => item.value));
  }
  return result;
}

function renderStations() {
  get("stations").innerHTML = stations.map(([id, name, note]) =>
    `<button type="button" role="radio" data-station="${id}" aria-pressed="${id === state.station}"><strong>${name}</strong><span>${note}</span></button>`
  ).join("");
}

function statIcon(kind) {
  const paths = {
    mean: '<path d="M10 13V6a2 2 0 1 1 4 0v7"/><path d="M9 14a3 3 0 1 0 6 0"/><path d="M12 4v7"/>',
    low: '<path d="M12 3v18M5 8l7 6 7-6M6 16l6-4 6 4"/>',
    high: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.5 5.5l1.5 1.5M17 17l1.5 1.5M18.5 5.5L17 7M7 17l-1.5 1.5"/>',
    trend: '<path d="M4 16l5-5 3 3 7-7"/><path d="M14 7h6v6"/>',
    years: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[kind]}</svg>`;
}

function bindMenu(select) {
  let wrap = select.nextElementSibling;
  if (!wrap || !wrap.classList.contains("menu")) {
    wrap = document.createElement("div");
    wrap.className = "menu";
    select.after(wrap);
    select.classList.add("menu-native");
  }
  wrap.replaceChildren();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-btn";
  const list = document.createElement("ul");
  list.className = "menu-list";
  list.hidden = true;
  const sync = () => { button.textContent = select.selectedOptions[0] ? select.selectedOptions[0].textContent : ""; };
  [...select.options].forEach(option => {
    const item = document.createElement("li");
    const press = document.createElement("button");
    press.type = "button";
    press.textContent = option.textContent;
    if (option.value === select.value) press.setAttribute("aria-current", "true");
    press.addEventListener("click", () => {
      select.value = option.value;
      sync();
      list.hidden = true;
      select.dispatchEvent(new Event("change"));
    });
    item.append(press);
    list.append(item);
  });
  button.addEventListener("click", event => {
    event.stopPropagation();
    const opening = list.hidden;
    document.querySelectorAll(".menu-list").forEach(node => { node.hidden = true; });
    list.hidden = !opening;
  });
  wrap.append(button, list);
  select._syncMenu = sync;
  sync();
}

function syncMenus() {
  document.querySelectorAll("select").forEach(select => {
    if (typeof select._syncMenu === "function") select._syncMenu();
  });
}

function setStation(id, options = {}) {
  const previous = options.keep ? { start: iso(state.from), end: iso(state.to) } : null;
  state.station = id;
  const keys = (stationData().parameters || []).filter(key => metrics[key]);
  if (options.metric && keys.includes(options.metric)) state.metric = options.metric;
  else if (options.metric && !keys.includes(options.metric)) {
    state.clipNote = "Показатель из адреса на этой станции не измеряется.";
    if (!keys.includes(state.metric)) state.metric = keys.includes("t_air") ? "t_air" : keys[0];
  } else if (!keys.includes(state.metric)) state.metric = keys.includes("t_air") ? "t_air" : keys[0];
  const select = get("metric");
  select.replaceChildren(...keys.map(key => new Option(metrics[key][0], key)));
  select.value = state.metric;
  bindMenu(select);
  const max = lastIndex();
  const start = get("range-start"), end = get("range-end");
  start.min = 0; end.min = 0; start.max = max; end.max = max;
  const arch = stationData();
  get("archive-start").textContent = longDate.format(dateAt(0));
  get("archive-end").textContent = longDate.format(dateAt(max));
  if (!options.metric) state.clipNote = "";
  if (previous) {
    let a = previous.start;
    let b = previous.end;
    if (b < arch.start || a > arch.end) {
      state.clipNote = `Период ${previous.start} - ${previous.end} вне архива станции (${arch.start} - ${arch.end}). Показан весь архив.`;
      a = arch.start;
      b = arch.end;
    } else {
      const notes = [];
      if (a < arch.start) { notes.push(`Начало обрезано до ${arch.start}: раньше архива этой станции суток нет.`); a = arch.start; }
      if (b > arch.end) { notes.push(`Конец обрезан до ${arch.end}: позже архива этой станции суток нет.`); b = arch.end; }
      if (notes.length) state.clipNote = notes.join(" ");
    }
    state.from = clampIndex(dayIndex(a));
    state.to = clampIndex(dayIndex(b));
    if (state.from > state.to) { const swap = state.from; state.from = state.to; state.to = swap; }
  } else {
    state.from = 0;
    state.to = max;
  }
  editingDates = false;
  renderStations();
  update();
}

function parseDay(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return value;
}

function validateRange(rawStart, rawEnd) {
  const arch = stationData();
  const errors = { start: "", end: "" };
  const a = parseDay(rawStart);
  const b = parseDay(rawEnd);
  if (!rawStart) errors.start = "Укажите дату начала.";
  else if (!a) errors.start = "Дата начала не распознана.";
  else if (a < arch.start) errors.start = `Дата начала раньше архива станции (${arch.start}).`;
  else if (a > arch.end) errors.start = `Дата начала позже архива станции (${arch.end}).`;
  if (!rawEnd) errors.end = "Укажите дату конца.";
  else if (!b) errors.end = "Дата конца не распознана.";
  else if (b < arch.start) errors.end = `Дата конца раньше архива станции (${arch.start}).`;
  else if (b > arch.end) errors.end = `Дата конца позже архива станции (${arch.end}).`;
  if (!errors.start && !errors.end && a > b) {
    errors.start = "Дата начала позже даты конца.";
    errors.end = "Дата конца раньше даты начала.";
  }
  return { ok: !errors.start && !errors.end, errors, start: a, end: b };
}

function clearDateErrors() {
  const start = get("date-start-error");
  const end = get("date-end-error");
  if (start) start.textContent = "";
  if (end) end.textContent = "";
}

function applyDatesFromFields() {
  const result = validateRange(get("date-start").value, get("date-end").value);
  get("date-start-error").textContent = result.errors.start;
  get("date-end-error").textContent = result.errors.end;
  if (!result.ok) return;
  editingDates = false;
  state.clipNote = "";
  state.from = clampIndex(dayIndex(result.start));
  state.to = clampIndex(dayIndex(result.end));
  if (state.from > state.to) {
    const swap = state.from;
    state.from = state.to;
    state.to = swap;
  }
  update();
}

function applyQueryRange(rawStart, rawEnd, asDay) {
  const result = validateRange(rawStart, rawEnd);
  if (!result.ok) {
    editingDates = true;
    get("date-start").value = rawStart || "";
    get("date-end").value = rawEnd || "";
    get("date-start-error").textContent = result.errors.start;
    get("date-end-error").textContent = result.errors.end;
    return;
  }
  if (asDay) state.step = "day";
  editingDates = false;
  state.from = dayIndex(result.start);
  state.to = dayIndex(result.end);
  update();
}

function windDirectionBlock(startIso, endIso) {
  if (state.station !== "ame60") return "";
  if (startIso >= "1998-01-01" && endIso <= "1998-12-31") return "В 1998 году у АМЕ-60 нет столбца направления ветра.";
  if (startIso >= "2021-01-01" && endIso <= "2021-12-31") return "В 2021 году направление ветра АМЕ-60 недостоверно.";
  return "";
}

function dayStatusText(entry, dateStr) {
  const arch = stationData();
  if (!dateStr || dateStr < arch.start || dateStr > arch.end) return `Дата вне периода станции (${arch.start} - ${arch.end}).`;
  if (state.metric === "wind_dir") {
    const block = windDirectionBlock(dateStr, dateStr);
    if (block) return block;
  }
  if (!entry) return "Нет наблюдений за эти сутки.";
  if (entry.valid && entry.v !== null) return "";
  if (entry.cov > 0 && entry.cov < entry.threshold) return `Сутки неполные: ${entry.cov} из ${entry.threshold} сроков.`;
  if (entry.n > 0) return `Сутки неполные: ${entry.n} сроков из ${entry.threshold}.`;
  return "Нет наблюдений за эти сутки.";
}

function unusableReason(entries) {
  const start = iso(state.from);
  const end = iso(state.to);
  if (state.metric === "wind_dir") {
    const block = windDirectionBlock(start, end);
    if (block) return block;
  }
  if (!entries.length) return "В выбранном периоде нет пригодных суток.";
  const reasons = new Set(entries.map(entry => dayStatusText(entry, entry.d)).filter(Boolean));
  if (reasons.size === 1) return [...reasons][0];
  return "В выбранном периоде нет пригодных суток.";
}

function dailyPoints() {
  const days = seriesData().days || [];
  const out = [];
  for (let index = state.from; index <= state.to && index < days.length; index += 1) {
    const entry = days[index];
    out.push({
      key: entry.d,
      year: Number(entry.d.slice(0, 4)),
      month: Number(entry.d.slice(5, 7)),
      start: index,
      end: index,
      label: axisDate.format(dateAt(index)),
      value: entry.valid ? entry.v : null,
      q10: null,
      q90: null,
      anomaly: null,
      partial: false,
      usable: !!entry.valid,
      entry
    });
  }
  return out;
}

function showPlotEmpty(id, message) {
  const canvas = get(id);
  if (canvas && canvas.getContext) {
    const box = canvas.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) {
      const { ctx, width, height } = context(canvas);
      ctx.clearRect(0, 0, width, height);
    }
    canvas._frame = null;
    canvas._rows = [];
  }
  const note = get(`${id}-empty`);
  if (note) { note.hidden = false; note.textContent = message; }
}

function hidePlotEmpty(id) {
  const note = get(`${id}-empty`);
  if (note) note.hidden = true;
}

function renderStats() {
  const values = shown.filter(item => item.value !== null);
  const years = new Set(values.map(item => item.year));
  const mean = values.length && state.metric !== "wind_dir" ? average(values.map(item => item.value)) : null;
  const low = values.length && state.metric !== "wind_dir" ? Math.min(...values.map(item => item.value)) : null;
  const high = values.length && state.metric !== "wind_dir" ? Math.max(...values.map(item => item.value)) : null;
  const trend = state.view === "series" && state.metric !== "wind_dir" ? monthTrend(monthShown, state.trendMonth) : { slope: null };
  const cards = [
    ["mean", "Средняя", text(state.metric === "wind_dir" ? null : mean)],
    ["low", "Мин.", text(low)],
    ["high", "Макс.", text(high)],
    ["trend", "Тренд мес.", trend.slope !== null && trend.slope !== undefined ? `${trend.slope > 0 ? "+" : ""}${format.format(trend.slope)} ${unit()}/год` : "нет"],
    ["years", "Лет в расчёте", years.size ? `${years.size} ${yearsWord(years.size)}` : "0"]
  ];
  get("stats").innerHTML = cards.map(([kind, label, value]) =>
    `<article class="stat">${statIcon(kind)}<div><p>${label}</p><strong>${value}</strong></div></article>`
  ).join("");
  const april = state.station === "kr1" && state.metric === "pressure_hpa" && monthShown.some(item => item.key === "2024-04" && item.value === null);
  get("side-note").textContent = april
    ? "Апрель 2024 у Кр1 не входит в месячное давление: 2/30 пригодных суток, 28 неполных подряд."
    : "Отклонение от среднего того же месяца по всем годам станции. Не норма ВМО. Ряды не соединяются.";
}

function context(canvas) {
  const box = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(box.width * ratio));
  canvas.height = Math.max(1, Math.round(box.height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width: box.width, height: box.height };
}

function scale(items, extra) {
  const values = items.flatMap(extra).filter(value => Number.isFinite(value));
  if (!values.length) return { low: 0, high: 1 };
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (low === high) { low -= 1; high += 1; }
  const pad = (high - low) * 0.08;
  return { low: low - pad, high: high + pad };
}

function drawSeries(canvas, items, options) {
  const { ctx, width, height } = context(canvas);
  const pad = { left: 48, right: 12, top: 16, bottom: 28 };
  const plotWidth = Math.max(1, width - pad.left - pad.right);
  const plotHeight = height - pad.top - pad.bottom;
  const { low, high } = options.scale;
  const gridLow = options.gridLow ?? low;
  const gridHigh = options.gridHigh ?? high;
  const x = index => pad.left + (items.length <= 1 ? plotWidth / 2 : index / (items.length - 1) * plotWidth);
  const y = value => pad.top + (1 - (value - low) / (high - low)) * plotHeight;
  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px 'Roboto Mono', monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = palette.muted;
  ctx.strokeStyle = palette.line;
  for (let tick = 0; tick < 5; tick += 1) {
    const value = gridLow + (gridHigh - gridLow) * tick / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y(value));
    ctx.lineTo(width - pad.right, y(value));
    ctx.stroke();
    ctx.fillText(format.format(value), pad.left - 8, y(value));
  }
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const step = Math.max(1, Math.ceil(items.length / 8));
  items.forEach((item, index) => {
    if (index % step && index !== items.length - 1) return;
    const caption = state.view === "series" && state.step === "day" ? (item.label || "") : String(item.year ?? item.label ?? "");
    ctx.fillText(caption, x(index), height - 8);
  });
  if (options.zero && low < 0 && high > 0) {
    ctx.strokeStyle = "rgba(241, 246, 232, 0.35)";
    ctx.beginPath();
    ctx.moveTo(pad.left, y(0));
    ctx.lineTo(width - pad.right, y(0));
    ctx.stroke();
  }
  // пользовательские горизонтальные линии
  state.lines.forEach(line => {
    if (line.value === null || line.value === undefined) return;
    ctx.strokeStyle = line.color || palette.warm;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, y(Number(line.value)));
    ctx.lineTo(width - pad.right, y(Number(line.value)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = palette.muted;
    ctx.textAlign = "right";
    ctx.fillText(line.label || "", pad.left - 8, y(Number(line.value)) - 4);
  });
  options.draw(ctx, x, y, plotHeight, pad);
  canvas._rows = items;
  return { x, y, pad, width, height, plotHeight };
}

function runs(items, read) {
  const groups = [];
  let current = [];
  items.forEach((item, index) => {
    if (read(item) === null || !Number.isFinite(read(item))) {
      if (current.length) groups.push(current);
      current = [];
    } else current.push(index);
  });
  if (current.length) groups.push(current);
  return groups;
}

function plotItems(canvas, items, read, title, legend) {
  const view = scale(items, item => [read(item)]);
  const frame = drawSeries(canvas, items, {
    scale: view,
    draw(ctx, x, y) {
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      let open = false;
      items.forEach((item, index) => {
        const value = read(item);
        if (value === null || !Number.isFinite(value)) { open = false; return; }
        if (!open) { ctx.moveTo(x(index), y(value)); open = true; }
        else ctx.lineTo(x(index), y(value));
      });
      ctx.stroke();
    }
  });
  canvas._frame = frame;
  get("main-title").textContent = title;
  get("main-legend").textContent = legend;
}

// ---- годовой ход ----
function drawAnnual() {
  const buckets = Array.from({ length: 12 }, (_, month) => ({ month: month + 1, label: ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"][month], values: [], years: new Set() }));
  shown.forEach(item => { if (item.value !== null) { buckets[item.month - 1].values.push(item.value); buckets[item.month - 1].years.add(item.year); } });
  const items = buckets.map(bucket => ({ ...bucket, year: bucket.label, value: bucket.values.length ? average(bucket.values) : null, years: bucket.years.size }));
  plotItems(get("chart"), items, item => item.value, "Годовой ход", "среднее полных месяцев одного номера, с числом лет");
  get("chart")._read = item => `${item.label}\n${text(item.value)}\n${item.years} ${yearsWord(item.years)}`;
}

// ---- тренд одного месяца ----
function drawMonthTrend() {
  const month = state.trendMonth;
  const names = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
  const items = months.filter(item => item.month === month && item.end >= state.from && item.start <= state.to);
  const trend = monthTrend(items, month);
  plotItems(get("chart"), items, item => item.value, `Тренд, ${names[month - 1]}`, trend.slope === null ? `для линии нужно ${5} пригодных лет, найдено ${trend.n}` : "линейная оценка по годам одного месяца, не прогноз");
  if (trend.slope !== null) {
    const frame = get("chart")._frame;
    const ys = items.filter(i => i.value !== null).map(i => i.value);
    const xs = items.filter(i => i.value !== null).map(i => i.year);
    if (xs.length && frame) {
      frame.ctx.strokeStyle = palette.warm;
      frame.ctx.setLineDash([5, 4]);
      frame.ctx.beginPath();
      const line = year => trend.meanY + trend.slope * (year - trend.meanX);
      frame.ctx.moveTo(frame.x(items.findIndex(i => i.year === xs[0])), frame.y(line(xs[0])));
      const last = items.findIndex(i => i.year === xs[xs.length - 1]);
      frame.ctx.lineTo(frame.x(last), frame.y(line(xs[xs.length - 1])));
      frame.ctx.stroke();
      frame.ctx.setLineDash([]);
    }
  }
  get("chart")._read = item => `${item.year}\n${text(item.value)}`;
}

// ---- сравнение Кр1 и Кр2 по общим пригодным суткам ----
function drawCompare() {
  const kr1 = data.stations.kr1.series.t_air.days;
  const kr2 = data.stations.kr2.series.t_air.days;
  const kr1ByDate = new Map(kr1.map(d => [d.d, d.v]));
  const kr2ByDate = new Map(kr2.map(d => [d.d, d.v]));
  const groups = new Map();
  kr1.forEach(d => {
    const key = d.d.slice(0, 7);
    if (d.d < "2022-01" || d.d > "2025-12") return;
    if (!groups.has(key)) groups.set(key, { key, label: monthName.format(new Date(Date.UTC(+d.d.slice(0,4), +d.d.slice(5,7)-1, 1))), a: [], b: [] });
    const a = kr1ByDate.get(d.d), b = kr2ByDate.get(d.d);
    if (a !== null && a !== undefined && b !== null && b !== undefined) { groups.get(key).a.push(a); groups.get(key).b.push(b); }
  });
  const rangeStart = iso(state.from);
  const rangeEnd = iso(state.to);
  const items = [...groups.values()].filter(g => {
    const [y, m] = g.key.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${g.key}-01` >= rangeStart && `${g.key}-${String(lastDay).padStart(2, "0")}` <= rangeEnd;
  }).map(g => ({
    ...g, kr1: g.a.length ? average(g.a) : null, kr2: g.b.length ? average(g.b) : null,
    value: g.a.length ? average(g.a) : null, diff: g.a.length ? average(g.a) - average(g.b) : null, shared: g.a.length
  }));
  const view = scale(items, item => [item.kr1, item.kr2]);
  const frame = drawSeries(get("chart"), items, {
    scale: view,
    draw(ctx, x, y) {
      [["kr1", palette.accent], ["kr2", palette.warm]].forEach(([key, color]) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        let open = false;
        items.forEach((item, index) => {
          if (item[key] === null) { open = false; return; }
          if (!open) { ctx.moveTo(x(index), y(item[key])); open = true; }
          else ctx.lineTo(x(index), y(item[key]));
        });
        ctx.stroke();
      });
    }
  });
  get("chart")._frame = frame;
  get("main-title").textContent = "Кр1 и Кр2, температура";
  get("main-legend").textContent = "разность по общим пригодным суткам обеих точек";
  const temp = value => value === null || !Number.isFinite(value) ? "нет" : `${formatFull.format(value)} °C`;
  get("chart")._read = item => `${item.label}\nКр1 ${temp(item.kr1)}\nКр2 ${temp(item.kr2)}\nразность ${temp(item.diff)}\nобщих суток ${item.shared}`;
}

// ---- декады ----
function drawDekad() {
  const days = seriesData().days || [];
  const groups = new Map();
  for (let index = state.from; index <= state.to && index < days.length; index += 1) {
    const entry = days[index];
    const d = entry.d, day = +d.slice(8, 10);
    const part = day <= 10 ? 1 : day <= 20 ? 2 : 3;
    const key = `${d.slice(0, 7)}-${part}`;
    if (!groups.has(key)) groups.set(key, { key, label: `${["I","II","III"][part - 1]} ${d.slice(0, 7)}`, year: +d.slice(0, 4), values: [] });
    if (entry.v !== null) groups.get(key).values.push(entry.v);
  }
  const items = [...groups.values()].map(item => ({ ...item, value: item.values.length ? average(item.values) : null }));
  plotItems(get("chart"), items, item => item.value, "Декады", "среднее пригодных суток декады, пропуски пустые");
  get("chart")._read = item => `${item.label}\n${text(item.value)}\nсуток ${item.values.length}`;
}

// ---- выгрузка Excel (настоящий .xlsx с бэкенда) ----
async function downloadExcel() {
  const start = dateAt(state.from).toISOString().slice(0, 10);
  const end = dateAt(state.to).toISOString().slice(0, 10);
  const level = state.view === "dekad" ? "dekad" : state.view === "annual" ? "month" : "day";
  const body = { station: state.station, parameter: state.metric, start, end, level };
  try {
    const response = await fetch("/api/export.xlsx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error("http " + response.status);
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `arhiv-${state.station}-${state.metric}.xlsx`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    get("side-note").textContent = "Выгрузка .xlsx требует запущенный расчётный сервер (python -m meteo.serve).";
  }
}

function drawDaily() {
  get("main-title").textContent = metrics[state.metric][0];
  if (!shown.some(item => Number.isFinite(item.value))) {
    showPlotEmpty("chart", unusableReason(shown.map(item => item.entry).filter(Boolean)));
    get("main-legend").textContent = "Сутки без пригодного значения остаются в периоде и не рисуются.";
    get("chart")._read = null;
    return;
  }
  const frame = drawSeries(get("chart"), shown, {
    scale: scale(shown, item => [item.value]),
    draw(ctx, x, y) {
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      let open = false;
      shown.forEach((item, index) => {
        if (!Number.isFinite(item.value)) { open = false; return; }
        if (!open) { ctx.moveTo(x(index), y(item.value)); open = true; }
        else ctx.lineTo(x(index), y(item.value));
      });
      ctx.stroke();
      ctx.fillStyle = palette.accent;
      shown.forEach((item, index) => {
        if (!Number.isFinite(item.value)) return;
        const prev = index > 0 && Number.isFinite(shown[index - 1].value);
        const next = index + 1 < shown.length && Number.isFinite(shown[index + 1].value);
        if (prev || next) return;
        ctx.beginPath();
        ctx.arc(x(index), y(item.value), 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });
  get("chart")._frame = frame;
  get("main-legend").textContent = "Среднее пригодных сроков каждых суток. Пропуски оставлены пустыми.";
  get("chart")._read = item => {
    const status = Number.isFinite(item.value) ? text(item.value) : dayStatusText(item.entry, item.entry.d);
    const cov = item.entry ? `покрытие ${item.entry.cov}/${item.entry.threshold}` : "";
    return `${item.entry ? item.entry.d : item.label}\n${status}\n${cov}`;
  };
}

function drawMain() {
  get("trend-month-field").hidden = state.view !== "trend";
  hidePlotEmpty("chart");
  if (state.view === "annual") return drawAnnual();
  if (state.view === "trend") return drawMonthTrend();
  if (state.view === "compare") return drawCompare();
  if (state.view === "dekad") return drawDekad();
  if (state.step === "day") return drawDaily();
  if (!shown.some(item => Number.isFinite(item.value))) {
    const days = (seriesData().days || []).slice(state.from, state.to + 1);
    let reason = "В периоде нет полного месяца с пригодным значением.";
    const block = state.metric === "wind_dir" ? windDirectionBlock(iso(state.from), iso(state.to)) : "";
    if (block) reason = block;
    else if (days.length === 1) {
      const one = dayStatusText(days[0], days[0].d);
      reason = one || `${days[0].d}: ${text(days[0].v)}. Для шага «Месяцы» нужен полный календарный месяц.`;
    }
    showPlotEmpty("chart", reason);
    get("main-title").textContent = metrics[state.metric][0];
    get("main-legend").textContent = "Месяц попадает в график, только если период накрывает его целиком.";
    return;
  }
  const band = on("opt-band") && state.metric !== "wind_dir";
  const smooth = movingAverage(shown);
  const view = scale(shown, item => [item.value, band ? item.q10 : null, band ? item.q90 : null, on("opt-ma") ? smooth[shown.indexOf(item)] : null]);
  const frame = drawSeries(get("chart"), shown, {
    scale: view,
    draw(ctx, x, y) {
      if (band) {
        runs(shown, item => item.q90).forEach(run => {
          ctx.beginPath();
          run.forEach((index, order) => order ? ctx.lineTo(x(index), y(shown[index].q90)) : ctx.moveTo(x(index), y(shown[index].q90)));
          for (let cursor = run.length - 1; cursor >= 0; cursor -= 1) ctx.lineTo(x(run[cursor]), y(shown[run[cursor]].q10));
          ctx.closePath();
          ctx.fillStyle = "rgba(188, 237, 145, 0.22)";
          ctx.fill();
        });
      }
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = palette.accent;
      runs(shown, item => item.value).forEach(run => {
        ctx.beginPath();
        run.forEach((index, order) => order ? ctx.lineTo(x(index), y(shown[index].value)) : ctx.moveTo(x(index), y(shown[index].value)));
        ctx.stroke();
      });
      if (on("opt-ma")) {
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = palette.warm;
        ctx.beginPath();
        let open = false;
        smooth.forEach((value, index) => {
          if (value === null) { open = false; return; }
          if (!open) { ctx.moveTo(x(index), y(value)); open = true; }
          else ctx.lineTo(x(index), y(value));
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  });
  get("chart")._frame = frame;
  const bits = ["месячное среднее"];
  if (band) bits.push("полоса 10-90% по суточным значениям месяца");
  if (on("opt-ma")) bits.push("скользящее среднее");
  get("main-legend").textContent = bits.join(", ");
  get("main-title").textContent = metrics[state.metric][0];
}

// ---- отклонения от среднего того же месяца (без кластеров, явная база) ----
function drawAnomaly() {
  const panel = get("anomaly-panel");
  const show = on("opt-anomaly") && state.metric !== "wind_dir";
  panel.hidden = !on("opt-anomaly");
  if (!show) {
    hidePlotEmpty("anomaly");
    get("anomaly-caption").textContent = "Для направления круговое среднее не раскладывается на отклонения вверх и вниз.";
    return;
  }
  get("anomaly-caption").textContent = "Столбец: месяц минус среднее этого же календарного месяца по всем годам станции. База: среднее за выбранный период, не норма ВМО.";
  if (!monthShown.length) {
    showPlotEmpty("anomaly", "В периоде нет полного месяца.");
    get("anomaly-legend").textContent = "";
    return;
  }
  hidePlotEmpty("anomaly");
  get("anomaly-legend").innerHTML = [
    [palette.coral, "отклонение +"],
    [palette.blue, "отклонение -"]
  ].map(([color, name]) => `<span class="key"><i style="background:${color}"></i>${name}</span>`).join("");
  const anomalies = monthShown.map(item => item.anomaly).filter(value => Number.isFinite(value));
  const span = anomalies.length ? Math.max(Math.abs(Math.min(...anomalies)), Math.abs(Math.max(...anomalies)), 1) : 1;
  const frame = drawSeries(get("anomaly"), monthShown, {
    scale: { low: -span * 1.15, high: span * 2.15 },
    gridLow: -span, gridHigh: span, zero: true,
    draw(ctx, x, y, plotHeight, pad) {
      const width = Math.max(2, Math.abs(x(Math.min(1, monthShown.length - 1)) - x(0)) * 0.62);
      monthShown.forEach((item, index) => {
        if (item.anomaly === null) return;
        ctx.fillStyle = item.anomaly >= 0 ? palette.coral : palette.blue;
        const top = y(item.anomaly), base = y(0);
        ctx.fillRect(x(index) - width / 2, Math.min(top, base), width, Math.abs(base - top));
      });
    }
  });
  get("anomaly")._frame = frame;
}

function collectWind() {
  const windDays = stationData().wind_days || {};
  const bins = new Array(81).fill(0);
  const start = iso(state.from);
  const end = iso(state.to);
  let any = false;
  for (const [day, arr] of Object.entries(windDays)) {
    if (day < start || day > end) continue;
    any = true;
    for (let i = 0; i < 81; i += 1) bins[i] += arr[i] || 0;
  }
  return { bins, any };
}

function roseExclusionNote() {
  if (state.station !== "ame60") return "";
  const start = iso(state.from);
  const end = iso(state.to);
  const bits = [];
  if (start <= "1998-12-31" && end >= "1998-01-01") bits.push("1998 не входит: нет столбца направления");
  if (start <= "2021-12-31" && end >= "2021-01-01") bits.push("2021 не входит: направление недостоверно");
  return bits.join(". ");
}

function polar(cx, cy, radius, angle) {
  return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
}

function sectorPath(cx, cy, r0, r1, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a1);
  if (r0 < 1) return `M ${cx} ${cy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r1.toFixed(2)} ${r1.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
  const [x2, y2] = polar(cx, cy, r0, a1);
  const [x3, y3] = polar(cx, cy, r0, a0);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r1.toFixed(2)} ${r1.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${r0.toFixed(2)} ${r0.toFixed(2)} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
}

// ---- роза ветров: те же корзины, рисунок из SVG, чтобы круг не растягивался ----
function drawRose() {
  const panel = get("rose-panel");
  panel.hidden = !on("opt-rose");
  if (panel.hidden) return;
  const svg = get("rose");
  const frame = svg.closest(".rose-frame");
  const legend = get("rose-legend");
  const table = get("rose-table");
  const empty = get("rose-empty");
  const block = windDirectionBlock(iso(state.from), iso(state.to));
  const { bins, any } = collectWind();
  const calm = bins[0];
  const directional = bins.slice(1).reduce((sum, value) => sum + value, 0);
  const total = calm + directional;
  const paintLegend = () => {
    legend.innerHTML = speedBins.map((label, index) =>
      `<li><i style="background:${palette.speeds[index]}"></i><span>${label}</span></li>`
    ).join("") + `<li><i class="calm-swatch"></i><span>штиль, 0 м/с</span></li>`;
  };
  const paintTable = () => {
    const head = `<thead><tr><th>Сектор</th>${speedBins.map(label => `<th>${label}</th>`).join("")}<th>Итого</th></tr></thead>`;
    const body = sectorNames.map((name, sector) => {
      const counts = [0, 1, 2, 3, 4].map(bin => bins[1 + sector * 5 + bin]);
      const sum = counts.reduce((acc, value) => acc + value, 0);
      return `<tr><td>${name}</td>${counts.map(value => `<td>${value}</td>`).join("")}<td>${sum}</td></tr>`;
    }).join("");
    table.innerHTML = `${head}<tbody>${body}<tr><td>штиль</td><td colspan="5">0 м/с</td><td>${calm}</td></tr></tbody>`;
  };
  if (block || !any || !total) {
    svg.textContent = "";
    legend.innerHTML = "";
    table.innerHTML = "";
    if (frame) frame.hidden = true;
    get("rose-note").textContent = "";
    empty.hidden = false;
    empty.textContent = block || "В этом окне нет пригодных срочных данных ветра.";
    return;
  }
  if (frame) frame.hidden = false;
  empty.hidden = true;
  paintLegend();
  paintTable();
  const excluded = roseExclusionNote();
  const calmOnly = directional === 0;
  get("rose-note").textContent = calmOnly
    ? `Только штиль: ${calm}. Ненулевых направлений нет. Штиль считается при 0 м/с.${excluded ? " " + excluded + "." : ""}`
    : `Пригодных срочных наблюдений: ${total}. Штиль: ${calm} (${format.format(100 * calm / total)}%). Знаменатель включает штиль.${excluded ? " " + excluded + "." : ""}`;
  const cx = 200;
  const cy = 200;
  const radius = 132;
  const sectorTotals = Array.from({ length: 16 }, (_, sector) => {
    let count = 0;
    for (let bin = 0; bin < 5; bin += 1) count += bins[1 + sector * 5 + bin];
    return count;
  });
  const max = Math.max(...sectorTotals, 1);
  const parts = [`<g fill="none" stroke="#3B5547" stroke-width="1">`];
  for (let ring = 1; ring <= 3; ring += 1) {
    const r = radius * ring / 3;
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}"></circle>`);
  }
  parts.push(`<path d="M ${cx} ${cy - radius} V ${cy + radius} M ${cx - radius} ${cy} H ${cx + radius}"></path></g>`);
  if (!calmOnly) {
    for (let ring = 1; ring <= 3; ring += 1) {
      const r = radius * ring / 3;
      const value = Math.round(max * ring / 3);
      parts.push(`<text class="tick" x="${cx + 8}" y="${(cy - r + 4).toFixed(1)}" font-size="11" text-anchor="start">${value}</text>`);
    }
    for (let sector = 0; sector < 16; sector += 1) {
      const angle = (sector + 0.5) * Math.PI / 8 - Math.PI / 2;
      let acc = 0;
      for (let bin = 0; bin < 5; bin += 1) {
        const count = bins[1 + sector * 5 + bin];
        if (!count) continue;
        const r0 = radius * acc / max;
        acc += count;
        const r1 = radius * acc / max;
        parts.push(`<path d="${sectorPath(cx, cy, r0, r1, angle - 0.16, angle + 0.16)}" fill="${palette.speeds[bin]}"></path>`);
      }
    }
  } else {
    parts.push(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="14">штиль</text>`);
  }
  [["С", cx, cy - radius - 18], ["В", cx + radius + 18, cy + 5], ["Ю", cx, cy + radius + 24], ["З", cx - radius - 18, cy + 5]]
    .forEach(([label, x, y]) => parts.push(`<text x="${x}" y="${y}" text-anchor="middle" font-size="14">${label}</text>`));
  svg.innerHTML = parts.join("");
}

// ---- почва: три слоя ----
function drawSoil() {
  const panel = get("soil-panel");
  const available = state.station === "ame60";
  panel.hidden = !on("opt-soil");
  if (panel.hidden) return;
  if (!available) {
    get("soil-legend").textContent = "Почва измерялась только на АМЕ-60.";
    const { ctx, width, height } = context(get("soil"));
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = palette.muted; ctx.font = "16px Inter, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("На Соколе датчиков почвы в архиве нет", width / 2, height / 2);
    return;
  }
  get("soil-legend").textContent = "5 см, 10 см, 20 см";
  const layers = ["soil_05", "soil_10", "soil_20"].map(metric => {
    const saved = state.metric;
    state.metric = metric;
    const result = buildMonths().filter(inWindow);
    state.metric = saved;
    return result;
  });
  const view = scale(layers[0], (_, index) => layers.flatMap(layer => [layer[index] ? layer[index].value : null]));
  drawSeries(get("soil"), layers[0], {
    scale: view,
    draw(ctx, x, y) {
      [palette.soil5, palette.soil10, palette.soil20].forEach((color, layer) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        let open = false;
        layers[layer].forEach((item, index) => {
          if (item.value === null) { open = false; return; }
          if (!open) { ctx.moveTo(x(index), y(item.value)); open = true; }
          else ctx.lineTo(x(index), y(item.value));
        });
        ctx.stroke();
      });
    }
  });
}

function selectionBox(width) {
  const last = Math.max(1, lastIndex());
  let left = state.from / last * width;
  let right = state.to / last * width;
  if (right - left < 18) {
    const mid = (left + right) / 2;
    left = Math.max(0, mid - 9);
    right = Math.min(width, left + 18);
  }
  return { left, right, last };
}

function pointerZone(x, left, right) {
  if (right - left < 36) {
    const mid = (left + right) / 2;
    if (x < mid - 8) return "start";
    if (x > mid + 8) return "end";
    return "move";
  }
  if (x >= left - 8 && x <= left + 16) return "start";
  if (x >= right - 16 && x <= right + 8) return "end";
  if (x > left && x < right) return "move";
  return "";
}

function paintOverview() {
  const series = (seriesData().days || []).map(row => row.v);
  const canvas = get("overview");
  const box = canvas.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return;
  const { ctx, width, height } = context(canvas);
  ctx.clearRect(0, 0, width, height);
  const values = series.filter(value => value !== null && state.metric !== "wind_dir");
  if (values.length && state.metric !== "wind_dir") {
    const low = Math.min(...values), high = Math.max(...values);
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let open = false;
    series.forEach((value, index) => {
      if (value === null) { open = false; return; }
      const x = index / Math.max(1, series.length - 1) * width;
      const y = height - 8 - (value - low) / (high - low || 1) * (height - 16);
      if (!open) { ctx.moveTo(x, y); open = true; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

function placeSelection() {
  const width = get("brush").clientWidth || 1;
  const box = selectionBox(width);
  const sel = get("selection");
  sel.style.left = `${box.left}px`;
  sel.style.width = `${Math.max(0, box.right - box.left)}px`;
  const grain = state.view === "series" && state.step === "day" ? ", сутки" : "";
  get("window-label").textContent = `${longDate.format(dateAt(state.from))} - ${longDate.format(dateAt(state.to))}${grain}`;
}

function drawTimeline() {
  if (!brushDrag) paintOverview();
  placeSelection();
}

function tip(canvas, event, id, read) {
  const frame = canvas._frame;
  const rows = canvas._rows || [];
  const box = get(id);
  if (!frame || !rows.length) { box.hidden = true; return; }
  const local = event.clientX - canvas.getBoundingClientRect().left;
  let nearest = 0, best = Infinity;
  rows.forEach((_, index) => {
    const distance = Math.abs(frame.x(index) - local);
    if (distance < best) { best = distance; nearest = index; }
  });
  state.focus = nearest;
  const item = rows[nearest];
  box.hidden = false;
  box.textContent = read(item);
  box.style.left = `${Math.max(8, Math.min(frame.width - 180, frame.x(nearest) + 8))}px`;
}

function renderTable() {
  const panel = get("table-panel");
  const body = get("records");
  if (!panel || !body || !panel.open) return;
  const rows = (state.view === "series" && state.step === "day" ? shown : monthShown);
  const visible = rows.slice(0, 500);
  body.innerHTML = visible.map(item => {
    const coverage = item.entry ? `${item.entry.cov}/${item.entry.threshold}` : (item.coverage || "");
    const status = Number.isFinite(item.value) ? "в расчёте" : (item.entry ? dayStatusText(item.entry, item.entry.d) : (item.partial ? "месяц неполный" : "нет пригодных суток"));
    return `<tr><td>${item.label || item.key || ""}</td><td>${text(item.value)}</td><td>${coverage}</td><td>${status}</td></tr>`;
  }).join("") || `<tr><td colspan="4">В периоде нет строк.</td></tr>`;
  if (rows.length > visible.length) body.insertAdjacentHTML("beforeend", `<tr><td colspan="4">Показаны первые 500 строк периода.</td></tr>`);
}

function syncDateFields() {
  if (editingDates) return;
  clearDateErrors();
  const start = get("date-start");
  const end = get("date-end");
  const a = iso(state.from);
  const b = iso(state.to);
  if (start.value !== a) start.value = a;
  if (end.value !== b) end.value = b;
}

function update() {
  months = buildMonths();
  monthShown = months.filter(inWindow);
  shown = state.view === "series" && state.step === "day" ? dailyPoints() : monthShown;
  document.querySelectorAll("[data-step]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.step === state.step));
  });
  const note = get("range-note");
  if (note) {
    const span = `${longDate.format(dateAt(state.from))} - ${longDate.format(dateAt(state.to))}`;
    const grain = state.view === "series" ? (state.step === "day" ? "шаг: сутки" : "шаг: месяцы") : "";
    note.textContent = state.clipNote || (grain ? `${span}, ${grain}` : span);
  }
  syncMenus();
  syncDateFields();
  get("range-start").value = state.from;
  get("range-end").value = state.to;
  get("range-start").setAttribute("aria-valuetext", longDate.format(dateAt(state.from)));
  get("range-end").setAttribute("aria-valuetext", longDate.format(dateAt(state.to)));
  renderStats();
  drawMain();
  drawAnomaly();
  drawRose();
  drawSoil();
  drawTimeline();
  renderTable();
}

function applyPreset(name) {
  if (name === "ame") { state.view = "series"; state.metric = "t_air"; get("view").value = "series"; setStation("ame60"); }
  if (name === "pair") {
    state.metric = "t_air"; setStation("kr1"); state.view = "compare"; get("view").value = "compare";
    state.from = Math.max(0, dayIndex("2025-01-01")); state.to = Math.min(state.to, dayIndex("2025-12-31"));
    update();
  }
  if (name === "pressure") {
    state.metric = "pressure_hpa"; setStation("kr1"); state.view = "series"; get("view").value = "series";
    state.from = Math.max(0, dayIndex("2024-01-01")); state.to = Math.min(state.to, dayIndex("2024-12-31"));
    update();
  }
}

function applyTemplate(name) {
  if (name === "pair") return applyPreset("pair");
  if (name === "pressure") return applyPreset("pressure");
  if (name === "soil") {
    state.metric = "t_air"; setStation("ame60"); state.view = "series"; get("view").value = "series";
    get("opt-soil").checked = true;
    update();
    return;
  }
  if (name === "wind") {
    state.metric = "wind_speed"; setStation("ame60"); state.view = "series"; get("view").value = "series";
    get("opt-rose").checked = true;
    update();
    return;
  }
  if (name === "temprh") {
    state.metric = "t_air"; setStation("kr1"); state.view = "series"; get("view").value = "series";
    get("side-note").textContent = "Влажность: отдельный показатель. Выберите «Относительная влажность» в меню.";
    update();
  }
}

function bootControls() {
  get("stations").addEventListener("click", event => {
    const button = event.target.closest("[data-station]");
    if (button && button.dataset.station !== state.station) setStation(button.dataset.station, { keep: true });
  });
  get("metric").addEventListener("change", () => { state.metric = get("metric").value; update(); });
  ["opt-ma", "opt-band", "opt-anomaly", "opt-rose", "opt-soil"].forEach(id => get(id).addEventListener("change", update));
  get("range-start").addEventListener("input", () => {
    editingDates = false;
    state.clipNote = "";
    state.from = Math.min(Number(get("range-start").value), state.to);
    update();
  });
  get("range-end").addEventListener("input", () => {
    editingDates = false;
    state.clipNote = "";
    state.to = Math.max(Number(get("range-end").value), state.from);
    update();
  });
  ["date-start", "date-end"].forEach(id => {
    const field = get(id);
    field.addEventListener("focus", () => { editingDates = true; });
    field.addEventListener("change", applyDatesFromFields);
    field.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      applyDatesFromFields();
    });
  });
  get("apply-range").addEventListener("click", event => {
    event.preventDefault();
    applyDatesFromFields();
  });
  document.querySelectorAll("[data-step]").forEach(button => button.addEventListener("click", () => {
    state.step = button.dataset.step;
    state.view = "series";
    get("view").value = "series";
    update();
  }));
  get("table-panel").addEventListener("toggle", renderTable);
  const brush = get("brush");
  const brushCursor = clientX => {
    const rect = brush.getBoundingClientRect();
    if (rect.width < 2) return;
    const box = selectionBox(rect.width);
    const mode = pointerZone(clientX - rect.left, box.left, box.right);
    brush.classList.toggle("is-resize", mode === "start" || mode === "end");
    brush.classList.toggle("is-move", mode === "move");
  };
  brush.addEventListener("pointermove", event => {
    if (brushDrag) return;
    brushCursor(event.clientX);
  });
  brush.addEventListener("pointerleave", () => {
    if (brushDrag) return;
    brush.classList.remove("is-resize", "is-move");
  });
  brush.addEventListener("pointerdown", event => {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = brush.getBoundingClientRect();
    if (rect.width < 2) return;
    const box = selectionBox(rect.width);
    const mode = pointerZone(event.clientX - rect.left, box.left, box.right);
    if (!mode) return;
    brush.classList.toggle("is-resize", mode === "start" || mode === "end");
    brush.classList.toggle("is-move", mode === "move");
    brushDrag = {
      mode,
      pointer: event.pointerId,
      originX: event.clientX,
      originFrom: state.from,
      originTo: state.to,
      width: rect.width,
      last: box.last
    };
    editingDates = false;
    brush.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  brush.addEventListener("pointermove", event => {
    if (!brushDrag || event.pointerId !== brushDrag.pointer) return;
    const delta = Math.round((event.clientX - brushDrag.originX) / brushDrag.width * brushDrag.last);
    const last = brushDrag.last;
    if (brushDrag.mode === "start") {
      state.from = Math.max(0, Math.min(brushDrag.originTo, brushDrag.originFrom + delta));
      state.to = brushDrag.originTo;
    } else if (brushDrag.mode === "end") {
      state.to = Math.min(last, Math.max(brushDrag.originFrom, brushDrag.originTo + delta));
      state.from = brushDrag.originFrom;
    } else {
      const dur = brushDrag.originTo - brushDrag.originFrom;
      let from = brushDrag.originFrom + delta;
      let to = from + dur;
      if (from < 0) { from = 0; to = dur; }
      if (to > last) { to = last; from = Math.max(0, last - dur); }
      state.from = from;
      state.to = to;
    }
    state.clipNote = "";
    update();
  });
  const endBrush = event => {
    if (!brushDrag || (event && event.pointerId !== brushDrag.pointer)) return;
    brushDrag = null;
    if (event && Number.isFinite(event.clientX)) brushCursor(event.clientX);
    update();
  };
  brush.addEventListener("pointerup", endBrush);
  brush.addEventListener("pointercancel", endBrush);
  get("view").addEventListener("change", () => { state.view = get("view").value; update(); });
  get("trend-month").addEventListener("change", () => { state.trendMonth = Number(get("trend-month").value); update(); });
  get("excel").addEventListener("click", downloadExcel);
  document.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
  document.querySelectorAll("[data-template]").forEach(button => button.addEventListener("click", () => applyTemplate(button.dataset.template)));
  // горизонтальные линии
  get("line-value").addEventListener("change", () => {
    const value = parseFloat(get("line-value").value);
    state.lines = value === value ? [{ value, label: get("line-label").value || String(value), color: palette.warm }] : [];
    update();
  });
  // журнал исключений
  let exclusions = null;
  let exclusionFilter = "";
  const stationTitle = { ame60: "АМЕ-60", kr1: "Кр1, поляна", kr2: "Кр2, поле" };
  function paintExceptions() {
    const summary = get("exceptions-summary");
    const body = get("exceptions-rows");
    const counts = {};
    exclusions.rows.forEach(row => {
      const key = `${row.station}|${row.reason}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    summary.innerHTML = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([key, count]) => {
      const [station, why] = key.split("|");
      const pressed = exclusionFilter === key;
      return `<button type="button" data-filter="${key}" aria-pressed="${pressed}">${stationTitle[station] || station}: ${why}. ${count}</button>`;
    }).join("");
    const rows = exclusions.rows.filter(row => !exclusionFilter || `${row.station}|${row.reason}` === exclusionFilter).slice(0, 200);
    body.innerHTML = rows.map(row => `<tr><td>${stationTitle[row.station] || row.station}</td><td>${row.when || ""}</td><td>${row.parameter || ""}</td><td>${row.value ?? ""}</td><td>${row.reason}</td><td>${row.file}:${row.line}</td></tr>`).join("")
      || `<tr><td colspan="6">Для этой причины только счётчик, без отдельных строк в выборке.</td></tr>`;
  }
  get("exceptions").addEventListener("click", () => {
    const open = () => { get("exceptions-panel").hidden = false; paintExceptions(); };
    if (exclusions) { open(); return; }
    fetch("/landing/dashboard/exceptions.json").then(response => response.json()).then(payload => {
      exclusions = payload;
      open();
    }).catch(() => { get("side-note").textContent = "Журнал исключений не открылся."; });
  });
  get("exceptions-close").addEventListener("click", () => { get("exceptions-panel").hidden = true; });
  get("exceptions-summary").addEventListener("click", event => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    exclusionFilter = exclusionFilter === button.dataset.filter ? "" : button.dataset.filter;
    paintExceptions();
  });
  get("chart").addEventListener("pointermove", event => tip(get("chart"), event, "chart-tip", item =>
    get("chart")._read ? get("chart")._read(item) : `${item.label}\n${text(item.value)}`));
  get("anomaly").addEventListener("pointermove", event => tip(get("anomaly"), event, "anomaly-tip", item =>
    `${item.label}\nмесяц ${text(item.value)}\nотклонение ${item.anomaly === null ? "нет" : text(item.anomaly)}`));
  ["chart", "anomaly"].forEach(id => get(id).addEventListener("pointerleave", () => { get(`${id === "chart" ? "chart" : "anomaly"}-tip`).hidden = true; }));
  document.addEventListener("click", event => {
    if (event.target.closest && event.target.closest(".menu")) return;
    document.querySelectorAll(".menu-list").forEach(node => { node.hidden = true; });
  });
  const observer = new ResizeObserver(() => update());
  observer.observe(get("chart"));
  observer.observe(get("brush"));
}

fetch("/landing/dashboard/series.json").then(response => response.json()).then(payload => {
  data = payload;
  bootControls();
  bindMenu(get("view"));
  bindMenu(get("trend-month"));
  const query = new URLSearchParams(location.search);
  const asked = query.get("station");
  const station = ["ame60", "kr1", "kr2"].includes(asked) ? asked : "ame60";
  setStation(station, { metric: query.get("metric") || "" });
  const qStart = query.get("start");
  const qEnd = query.get("end");
  const date = query.get("date");
  if (qStart && qEnd) applyQueryRange(qStart, qEnd, false);
  else if (date) applyQueryRange(date, date, true);
}).catch(() => { get("stats").textContent = "Архив не открылся."; });
