let data = null;
const get = id => document.getElementById(id);
const dayMs = 86400000;
const palette = {
  ink: "#E6EFEB", muted: "#A4B4AD", line: "#364842",
  accent: "#89D8AE", warm: "#E6B86E", coral: "#F08E82", blue: "#88BDE9",
  soil5: "#E6B86E", soil10: "#89D8AE", soil20: "#88BDE9",
  speeds: ["#4B906C", "#71AF87", "#A3D1A2", "#E2C778", "#D99B79"]
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
const state = { station: "ame60", metric: "t_air", from: 0, to: 0, focus: null, focusChart: "chart", view: "series", step: "month", impute: false, trendMonth: 1, lines: [], clipNote: "", modules: [{ id: "mod-1", kind: "chart", layout: "overlay", picked: { t_air: ["mean"] } }] };
const PARAMS = {
  t_air: ["Температура воздуха", "°C", "#89D8AE"],
  rh: ["Относительная влажность", "%", "#78CBD2"],
  wind_speed: ["Скорость ветра", "м/с", "#91B9F0"],
  wind_gust: ["Порывы ветра", "м/с", "#E5B674"],
  wind_dir: ["Направление ветра", "°", "#BEA0E6"],
  soil_05: ["Температура почвы, 5 см", "°C", "#C2CD81"],
  soil_10: ["Температура почвы, 10 см", "°C", "#79C899"],
  soil_20: ["Температура почвы, 20 см", "°C", "#D3B18A"],
  pressure_hpa: ["Атмосферное давление", "гПа", "#E3A0BC"]
};
const LINE_STYLE = {
  mean: { name: "Среднее", dash: [], width: 2.1, alpha: 1 },
  median: { name: "Медиана", dash: [7, 4], width: 1.35, alpha: 0.96 },
  min: { name: "Минимум", dash: [2, 5], width: 1.35, alpha: 0.65 },
  max: { name: "Максимум", dash: [6, 3, 2, 3], width: 1.35, alpha: 0.8 },
  trend: { name: "Тренд среднего", dash: [12, 6], width: 1.35, alpha: 0.76 }
};
const anomalyCache = {};
const format = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatFull = format;
const monthName = new Intl.DateTimeFormat("ru-RU", { month: "short", year: "numeric", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const axisDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const on = id => { const node = get(id); return !!(node && node.checked); };
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

function anomalySet(metric) {
  const key = `${state.station}:${metric}`;
  if (anomalyCache[key]) return anomalyCache[key];
  const days = (stationData().series[metric] || {}).days || [];
  const byMonth = {};
  days.forEach((entry, index) => {
    if (!entry.valid || entry.v == null) return;
    const month = entry.d.slice(5, 7);
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push({ index, v: entry.v });
  });
  const bad = new Set();
  Object.keys(byMonth).forEach(month => {
    const values = byMonth[month].map(item => item.v).sort((a, b) => a - b);
    if (values.length < 8) return;
    const at = p => values[Math.min(values.length - 1, Math.round((values.length - 1) * p))];
    const q1 = at(0.25);
    const q3 = at(0.75);
    const iqr = q3 - q1;
    const low = q1 - 1.5 * iqr;
    const high = q3 + 1.5 * iqr;
    byMonth[month].forEach(item => {
      if (item.v < low || item.v > high) bad.add(item.index);
    });
  });
  anomalyCache[key] = bad;
  return bad;
}

function cleanNumber(entry, index, metric, field) {
  if (!entry || !entry.valid || entry.v == null) return null;
  if (anomalySet(metric).has(index)) return null;
  const value = entry[field];
  return value == null ? null : value;
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
    const bad = anomalySet(state.metric);
    const good = items.filter(item => item.v !== null && !bad.has(dayIndex(item.d)));
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

// Fit the complete daily archive before selecting a visible period. Neither
// measurements nor anomalies are replaced, and predictions never train the fit.
function reconstructDaily(days, excludedIndices, metric) {
  const excluded = excludedIndices || new Set();
  const measured = days.map((entry, index) => entry && entry.valid && Number.isFinite(entry.v) && !excluded.has(index) ? entry.v : null);
  const values = measured.slice();
  const mask = days.map(() => false);
  if (metric === "wind_dir") return { values, mask };
  const bins = new Map();
  days.forEach((entry, index) => {
    if (!Number.isFinite(measured[index])) return;
    const key = entry.d.slice(5, 7);
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(measured[index]);
  });
  const climate = new Map([...bins].map(([key, samples]) => [key, average(samples)]));
  const stamp = index => Date.parse(`${days[index].d}T00:00:00Z`);
  let start = 0;
  while (start < days.length) {
    if (excluded.has(start) || Number.isFinite(measured[start])) { start += 1; continue; }
    let end = start;
    while (end < days.length && !excluded.has(end) && !Number.isFinite(measured[end])) end += 1;
    const left = start - 1, right = end;
    const length = Math.round((stamp(end - 1) - stamp(start)) / dayMs) + 1;
    const bridge = length > 0 && length <= 14 && left >= 0 && right < days.length && Number.isFinite(measured[left]) && Number.isFinite(measured[right]);
    for (let index = start; index < end; index += 1) {
      const base = climate.get(days[index].d.slice(5, 7));
      let value = Number.isFinite(base) ? base : null;
      if (bridge) {
        const blend = (stamp(index) - stamp(left)) / (stamp(right) - stamp(left));
        const linear = measured[left] + (measured[right] - measured[left]) * blend;
        value = Number.isFinite(base) ? (base + linear) / 2 : linear;
      }
      if (Number.isFinite(value)) { values[index] = value; mask[index] = true; }
    }
    start = end;
  }
  return { values, mask };
}

const reconstructionCache = new WeakMap();
function reconstructionFor(metric) {
  const days = (stationData().series[metric] || {}).days || [];
  const excluded = anomalySet(metric);
  let cached = reconstructionCache.get(days);
  if (!cached) { cached = new Map(); reconstructionCache.set(days, cached); }
  const previous = cached.get(metric);
  if (previous && previous.excluded === excluded) return previous.result;
  const filled = reconstructDaily(days, excluded, metric);
  const result = Object.freeze({ values: Object.freeze(filled.values), mask: Object.freeze(filled.mask) });
  cached.set(metric, { excluded, result });
  return result;
}

function imputeValues(items) {
  if (state.step !== "day" || state.metric === "wind_dir") return { values: items.map(item => item.value), mask: items.map(() => false) };
  const filled = reconstructionFor(state.metric);
  const indices = items.map((item, index) => Number.isInteger(item.start) ? item.start : state.from + index);
  return { values: indices.map(index => filled.values[index] ?? null), mask: indices.map(index => !!filled.mask[index]) };
}

// Only intervals touching a predicted point get the golden stroke. This also
// draws a one-day gap between its measured anchors without recoloring the rest.
function paintReconstruction(ctx, x, y, filled) {
  if (!filled) return;
  const { values, mask } = filled;
  ctx.save();
  ctx.strokeStyle = "#E7C98A";
  ctx.fillStyle = "#E7C98A";
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1.8;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  let open = false;
  for (let index = 1; index < values.length; index += 1) {
    if (!(mask[index - 1] || mask[index]) || !Number.isFinite(values[index - 1]) || !Number.isFinite(values[index])) { open = false; continue; }
    if (!open) ctx.moveTo(x(index - 1), y(values[index - 1]));
    ctx.lineTo(x(index), y(values[index]));
    open = true;
  }
  ctx.stroke();
  mask.forEach((predicted, index) => {
    if (!predicted || !Number.isFinite(values[index])) return;
    if (Number.isFinite(values[index - 1]) || Number.isFinite(values[index + 1])) return;
    ctx.beginPath();
    ctx.arc(x(index), y(values[index]), 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function paintGuides(ctx, x, y, items) {
  if (!items.length) return;
  if (on("opt-median")) {
    const nums = items.map(item => item.value).filter(value => Number.isFinite(value)).sort((a, b) => a - b);
    if (nums.length) {
      const mid = nums.length % 2 ? nums[(nums.length - 1) / 2] : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2;
      ctx.save();
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x(0), y(mid));
      ctx.lineTo(x(Math.max(0, items.length - 1)), y(mid));
      ctx.stroke();
      ctx.restore();
    }
  }
  if (state.impute && state.step === "day" && state.metric !== "wind_dir") {
    const filled = imputeValues(items);
    ctx.strokeStyle = palette.warm;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let open = false;
    filled.mask.forEach((flag, point) => {
      if (!flag || !Number.isFinite(filled.values[point])) { open = false; return; }
      if (!open) { ctx.moveTo(x(point), y(filled.values[point])); open = true; }
      else ctx.lineTo(x(point), y(filled.values[point]));
    });
    ctx.stroke();
  }
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function renderStations() {
  get("stations").innerHTML = stations.map(([id, name, note]) =>
    `<button type="button" role="radio" data-station="${id}" aria-checked="${id === state.station}" tabindex="${id === state.station ? 0 : -1}"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(note)}</span></button>`
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
  Object.keys(anomalyCache).forEach(key => delete anomalyCache[key]);
  const previous = options.keep ? { start: iso(state.from), end: iso(state.to) } : null;
  state.station = id;
  const keys = (stationData().parameters || []).filter(key => metrics[key]);
  if (options.metric && keys.includes(options.metric)) state.metric = options.metric;
  else if (options.metric && !keys.includes(options.metric)) {
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
      a = arch.start;
      b = arch.end;
    } else {
      if (a < arch.start) a = arch.start;
      if (b > arch.end) b = arch.end;
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
  ["date-start", "date-end"].forEach(id => { const field = get(id); if (field) field.removeAttribute("aria-invalid"); });
}

function applyDatesFromFields() {
  const result = validateRange(get("date-start").value, get("date-end").value);
  get("date-start-error").textContent = result.errors.start;
  get("date-end-error").textContent = result.errors.end;
  get("date-start").setAttribute("aria-invalid", String(!!result.errors.start));
  get("date-end").setAttribute("aria-invalid", String(!!result.errors.end));
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
  const values = shown.filter(item => {
    if (item.value === null) return false;
    if (state.view === "series" && state.step === "day" && anomalySet(state.metric).has(item.start)) return false;
    return true;
  });
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
  const note = get("side-note");
  if (note) note.textContent = april
    ? "Апрель 2024 у Кр1 не входит в месячное давление: 2/30 пригодных суток, 28 неполных подряд."
    : "";
}

function context(canvas) {
  const width = canvas.clientWidth || 1;
  const height = canvas.clientHeight || 1;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

function scale(items, extra) {
  const values = items.flatMap(extra).filter(value => Number.isFinite(value));
  if (!values.length) return { low: 0, high: 1 };
  // Avoid spreading full archives into Math.min/max: several parameters with
  // min/max/trend can exceed the JavaScript argument limit.
  let low = Infinity, high = -Infinity;
  values.forEach(value => { low = Math.min(low, value); high = Math.max(high, value); });
  if (low === high) { low -= 1; high += 1; }
  const pad = (high - low) * 0.08;
  return { low: low - pad, high: high + pad };
}

function drawSeries(canvas, items, options) {
  const { ctx, width, height } = context(canvas);
  const pad = { left: 48, right: 12, top: 16, bottom: 28 };
  const plotWidth = Math.max(1, width - pad.left - pad.right);
  const plotHeight = Math.max(1, height - pad.top - pad.bottom);
  const { low, high } = options.scale;
  const gridLow = options.gridLow ?? low;
  const gridHigh = options.gridHigh ?? high;
  const x = index => pad.left + (items.length <= 1 ? plotWidth / 2 : index / (items.length - 1) * plotWidth);
  const y = value => pad.top + (1 - (value - low) / (high - low)) * plotHeight;
  ctx.clearRect(0, 0, width, height);
  ctx.font = "13px 'Roboto Mono', monospace";
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
    ctx.strokeStyle = palette.muted;
    ctx.beginPath();
    ctx.moveTo(pad.left, y(0));
    ctx.lineTo(width - pad.right, y(0));
    ctx.stroke();
  }
  // пользовательские горизонтальные линии
  state.lines.forEach(line => {
    if (line.value === null || line.value === undefined) return;
    if (!Number.isFinite(Number(line.value)) || Number(line.value) < low || Number(line.value) > high) return;
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
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, plotWidth, plotHeight);
  ctx.clip();
  options.draw(ctx, x, y, plotHeight, pad);
  ctx.restore();
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
function downloadExcel() {
  const rows = (state.view === "series" && state.step === "day" ? shown : monthShown);
  const head = ["Период", "Значение", "Покрытие", "Статус"];
  const body = rows.map(item => {
    const coverage = item.entry ? `${item.entry.cov}/${item.entry.threshold}` : (item.coverage || "");
    const status = Number.isFinite(item.value) ? "в расчёте" : "нет пригодного значения";
    const value = Number.isFinite(item.value) ? String(item.value).replace(".", ",") : "";
    return [item.label || item.key || "", value, coverage, status];
  });
  const table = [head, ...body].map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("");
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"></head><body><table>${table}</table></body></html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `arhiv-${state.station}-${state.metric}.xls`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function printCharts() {
  const images = [...document.querySelectorAll(".module canvas")]
    .filter(canvas => canvas.width > 2)
    .map(canvas => {
      const image = document.createElement("canvas");
      image.width = canvas.width; image.height = canvas.height;
      const ctx = image.getContext("2d");
      ctx.fillStyle = "#1d282a"; ctx.fillRect(0, 0, image.width, image.height);
      ctx.drawImage(canvas, 0, 0);
      return `<img src="${image.toDataURL("image/png")}" alt="График наблюдений" style="display:block;width:100%;margin-bottom:20px">`;
    });
  const roses = [...document.querySelectorAll(".module .rose-svg")].map(svg => {
    const copy = svg.cloneNode(true);
    copy.querySelectorAll("text").forEach(node => node.setAttribute("fill", palette.ink));
    copy.setAttribute("style", "background:#1d282a;max-width:600px;display:block;margin:20px auto");
    return copy.outerHTML;
  });
  const page = window.open("", "charts");
  if (!page) return;
  page.document.write(`<!doctype html><title>Графики</title><body style="background:#131c1e;color:#e6efeb">${images.join("")}${roses.join("")}<script>addEventListener("load",()=>print())<\/script></body>`);
  page.document.close();
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
      paintGuides(ctx, x, y, shown);
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

function overlayModel(picked) {
  const choice = picked || {};
  const keys = Object.keys(choice).filter(key => stationData().series[key]);
  return keys.flatMap(key => {
    const chosen = choice[key] || [];
    const days = stationData().series[key].days || [];
    const bad = anomalySet(key);
    const rows = [];
    if (state.step === "day") {
      for (let index = state.from; index <= state.to && index < days.length; index += 1) {
        const entry = days[index];
        const anomaly = !!(entry && entry.valid && entry.v != null && bad.has(index));
        const clean = entry && entry.valid && entry.v != null && !anomaly;
        rows.push({
          x: index,
          label: entry ? entry.d : "",
          mean: clean ? entry.v : null,
          median: null,
          min: clean && entry.min != null ? entry.min : null,
          max: clean && entry.max != null ? entry.max : null,
          red: anomaly ? entry.v : null
        });
      }
    } else {
      const months = [];
      let cursor = state.from;
      while (cursor <= state.to && cursor < days.length) {
        const date = dateAt(cursor);
        const monthEnd = dayIndex(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10));
        const end = Math.min(monthEnd, state.to, days.length - 1);
        const clean = [];
        const reds = [];
        for (let index = cursor; index <= end; index += 1) {
          const entry = days[index];
          if (!entry || entry.v == null || !entry.valid) continue;
          if (bad.has(index)) reds.push(entry.v);
          else clean.push(entry);
        }
        const values = clean.map(entry => entry.v).sort((a, b) => a - b);
        const mid = values.length ? (values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2) : null;
        rows.push({
          x: (cursor + end) / 2,
          label: monthName.format(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))),
          mean: values.length ? average(values) : null,
          median: mid,
          min: clean.length ? Math.min(...clean.map(entry => entry.min != null ? entry.min : entry.v)) : null,
          max: clean.length ? Math.max(...clean.map(entry => entry.max != null ? entry.max : entry.v)) : null,
          reds
        });
        cursor = end + 1;
      }
    }
    const meanPoints = rows.map(row => row.mean);
    let trend = null;
    if (chosen.includes("trend")) {
      const good = rows.map((row, index) => ({ index, v: row.mean })).filter(point => point.v != null);
      if (good.length >= 3) {
        const xs = good.map(point => point.index);
        const ys = good.map(point => point.v);
        const meanX = average(xs);
        const meanY = average(ys);
        const den = xs.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
        const slope = den ? xs.reduce((sum, value, index) => sum + (value - meanX) * (ys[index] - meanY), 0) / den : 0;
        trend = rows.map((row, index) => row.mean == null ? null : meanY + (index - meanX) * slope);
      }
    }
    const reconstruction = state.impute && state.step === "day" && key !== "wind_dir" && chosen.includes("mean") ? reconstructionFor(key) : null;
    return chosen.filter(stat => stat !== "trend" || trend).map(stat => {
      const line = { key, stat, rows, values: stat === "trend" ? trend : rows.map(row => row[stat]) };
      if (stat === "mean" && reconstruction) {
        line.imputed = { values: rows.map(row => reconstruction.values[row.x] ?? null), mask: rows.map(row => !!reconstruction.mask[row.x]) };
      }
      return line;
    });
  });
}

function drawOverlay(canvas, legend, picked) {
  const lines = overlayModel(picked);
  if (!canvas) return;
  if (!lines.length) {
    const { ctx, width, height } = context(canvas);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = palette.muted;
    ctx.font = "15px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Выберите параметр в списке модуля", width / 2, height / 2);
    if (legend) legend.innerHTML = "";
    return;
  }
  if (legend) {
    legend.innerHTML = lines.map(line => `<span style="--series:${PARAMS[line.key][2]}"><i data-stat="${line.stat}"></i>${PARAMS[line.key][0]}, ${LINE_STYLE[line.stat].name}</span>`).join("");
    if (state.impute) {
      const eligible = lines.filter(line => line.key !== "wind_dir");
      if (!eligible.length) legend.innerHTML += `<span class="impute-note">Направление ветра не интерполируется</span>`;
      else if (state.step !== "day") legend.innerHTML += `<span class="impute-note">интерполяция только для шага Дни</span>`;
      else if (eligible.some(line => line.stat === "mean")) legend.innerHTML += `<span class="imputed-legend"><i></i>пропуски восстановлены, это не измерение</span>`;
      else legend.innerHTML += `<span class="impute-note">Для интерполяции включите Среднее</span>`;
    }
  }
  const byUnit = new Map();
  lines.forEach(line => {
    const unit = PARAMS[line.key][1];
    // Anomaly markers are measurements too: include them in the same scale as
    // the line so they remain visible rather than escaping into axis labels.
    const values = [...line.values];
    if (line.imputed) values.push(...line.imputed.values);
    if (line.stat === "mean") {
      line.rows.forEach(row => values.push(...(row.red != null ? [row.red] : (row.reds || []))));
    }
    if (!byUnit.has(unit)) byUnit.set(unit, []);
    values.forEach(value => { if (Number.isFinite(value)) byUnit.get(unit).push(value); });
  });
  const units = [...byUnit.keys()];
  const scales = new Map();
  units.forEach(unit => {
    const { low: min, high: max } = scale(byUnit.get(unit), value => [value]);
    const ticks = [0, 1, 2, 3, 4].map(step => min + (max - min) * step / 4);
    scales.set(unit, { min, max, ticks });
  });
  const { ctx, width, height } = context(canvas);
  const normalized = units.length > 2;
  const dual = units.length === 2;
  ctx.font = "13px 'Roboto Mono', monospace";
  const axisWidth = unit => Math.max(44, ...scales.get(unit).ticks.map(tick => ctx.measureText(format.format(tick)).width)) + 14;
  const pad = { left: normalized ? 58 : axisWidth(units[0]), right: dual ? axisWidth(units[1]) : 18, top: 28, bottom: 36 };
  const plotW = Math.max(1, width - pad.left - pad.right);
  const plotH = Math.max(1, height - pad.top - pad.bottom);
  const xs = lines[0].rows.map(row => row.x);
  const xOf = index => pad.left + (xs.length <= 1 ? plotW / 2 : index / (xs.length - 1) * plotW);
  const axis = { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
  const yRaw = (shown, rule) => pad.top + (1 - (shown - rule.min) / (rule.max - rule.min)) * plotH;
  const yOf = (value, scale) => normalized
    ? yRaw((value - scale.min) / (scale.max - scale.min) * 100, axis)
    : yRaw(value, scale);
  ctx.clearRect(0, 0, width, height);
  ctx.font = "13px 'Roboto Mono', monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = palette.muted;
  const left = normalized ? axis : scales.get(units[0]);
  left.ticks.forEach(tick => {
    const y = yRaw(tick, left);
    ctx.strokeStyle = palette.line;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(format.format(tick), pad.left - 6, y);
  });
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(normalized ? "Шкала 0-100" : units[0], pad.left, 6);
  if (dual) {
    ctx.textAlign = "right";
    ctx.fillText(units[1], width - pad.right, 6);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    scales.get(units[1]).ticks.forEach(tick => ctx.fillText(format.format(tick), width - pad.right + 6, yRaw(tick, scales.get(units[1]))));
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, plotW, plotH);
  ctx.clip();
  lines.forEach(line => {
    const style = LINE_STYLE[line.stat];
    const scale = scales.get(PARAMS[line.key][1]);
    ctx.save();
    ctx.strokeStyle = PARAMS[line.key][2];
    ctx.fillStyle = PARAMS[line.key][2];
    ctx.globalAlpha = style.alpha;
    ctx.lineWidth = style.width;
    ctx.setLineDash(style.dash);
    if (line.key === "wind_dir") {
      line.values.forEach((value, index) => {
        if (!Number.isFinite(value)) return;
        ctx.beginPath();
        ctx.arc(xOf(index), yOf(value, scale), 2.2, 0, Math.PI * 2);
        ctx.fill();
      });
    } else {
      ctx.beginPath();
      let open = false;
      line.values.forEach((value, index) => {
        if (!Number.isFinite(value)) { open = false; return; }
        const x = xOf(index);
        const y = yOf(value, scale);
        if (!open) { ctx.moveTo(x, y); open = true; }
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      // Keep a one-day selection and isolated observations visible.
      ctx.setLineDash([]);
      line.values.forEach((value, index) => {
        if (!Number.isFinite(value)) return;
        if (Number.isFinite(line.values[index - 1]) || Number.isFinite(line.values[index + 1])) return;
        ctx.beginPath();
        ctx.arc(xOf(index), yOf(value, scale), 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.restore();
  });
  lines.forEach(line => {
    if (!line.imputed) return;
    const rule = scales.get(PARAMS[line.key][1]);
    paintReconstruction(ctx, xOf, value => yOf(value, rule), line.imputed);
  });
  ctx.fillStyle = "rgba(232,154,148,0.55)";
  ctx.globalAlpha = 1;
  lines.filter(line => line.stat === "mean").forEach(line => {
    const scale = scales.get(PARAMS[line.key][1]);
    line.rows.forEach((row, index) => {
      const marks = row.red != null ? [row.red] : (row.reds || []);
      marks.forEach(value => {
        if (!Number.isFinite(value)) return;
        ctx.beginPath();
        ctx.arc(xOf(index), yOf(value, scale), 3.4, 0, Math.PI * 2);
        ctx.fill();
      });
    });
  });
  ctx.restore();
  ctx.fillStyle = palette.muted;
  ctx.font = "12px 'Roboto Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const tickCount = Math.min(width < 540 ? 4 : 6, xs.length);
  let previousRight = -Infinity;
  for (let step = 0; step < tickCount; step += 1) {
    const index = Math.round(step * (xs.length - 1) / Math.max(1, tickCount - 1));
    const label = lines[0].rows[index].label || "";
    const half = ctx.measureText(label).width / 2;
    const center = Math.max(pad.left + half, Math.min(width - pad.right - half, xOf(index)));
    if (center - half < previousRight + 8) continue;
    ctx.fillText(label, center, height - 4);
    previousRight = center + half;
  }
  canvas._rows = lines[0].rows;
  canvas._lines = lines;
  canvas._frame = { x: xOf, width, height, pad, plotWidth: plotW, plotHeight: plotH };
}

function renderPickers() {
  const menu = get("param-menu");
  const settings = get("series-settings");
  if (!menu || !settings || !data) return;
  const available = (stationData().parameters || []).filter(key => PARAMS[key] && stationData().series[key]);
  Object.keys(state.picked).forEach(key => { if (!available.includes(key)) delete state.picked[key]; });
  if (!Object.keys(state.picked).length && available.includes("t_air")) state.picked.t_air = ["mean"];
  menu.innerHTML = available.map(key => {
    const pressed = !!state.picked[key];
    return `<button class="parameter" type="button" data-param="${key}" style="--series:${PARAMS[key][2]}" aria-pressed="${pressed}"><span class="select-mark"></span><span>${PARAMS[key][0]}</span><span class="unit">${PARAMS[key][1]}</span></button>`;
  }).join("");
  settings.innerHTML = Object.keys(state.picked).filter(key => available.includes(key)).map(key => {
    const stats = key === "wind_dir" ? ["mean"] : Object.keys(LINE_STYLE);
    const buttons = stats.map(stat => {
      const pressed = (state.picked[key] || []).includes(stat);
      return `<button type="button" class="stat-toggle" data-key="${key}" data-stat="${stat}" aria-pressed="${pressed}" style="--series:${PARAMS[key][2]}"><i></i>${LINE_STYLE[stat].name}</button>`;
    }).join("");
    return `<div class="series-row" style="--series:${PARAMS[key][2]}"><div class="series-label"><i class="series-dot"></i>${PARAMS[key][0]}</div>${buttons}</div>`;
  }).join("");
  const first = Object.keys(state.picked)[0];
  if (first) {
    state.metric = first;
    const select = get("metric");
    if (select && [...select.options].some(option => option.value === first)) select.value = first;
  }
}

function drawMain() {
  get("trend-month-field").hidden = state.view !== "trend";
  hidePlotEmpty("chart");
  if (state.view === "series") return drawOverlay();
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
      paintGuides(ctx, x, y, shown);
    }
  });
  get("chart")._frame = frame;
  const bits = ["месячное среднее"];
  if (band) bits.push("полоса 10-90% по суточным значениям месяца");
  if (on("opt-ma")) bits.push("скользящее среднее");
  if (on("opt-median")) bits.push("медиана");
  if (state.impute && state.step === "day" && state.metric !== "wind_dir") bits.push("пропуски восстановлены, это не измерение");
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
function drawRose(root) {
  const svg = root ? root.querySelector(".rose-svg") : get("rose");
  if (!svg) return;
  const frame = svg.closest(".rose-frame");
  const legend = root ? root.querySelector(".rose-legend") : get("rose-legend");
  const table = root ? root.querySelector(".rose-table") : get("rose-table");
  const empty = root ? root.querySelector(".rose-empty") : get("rose-empty");
  const note = root ? root.querySelector(".rose-note") : get("rose-note");
  if (!legend || !table || !empty) return;
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
    if (note) note.textContent = "";
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
  if (note) note.textContent = calmOnly
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
  const parts = [`<g fill="none" stroke="${palette.line}" stroke-width="1">`];
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
  const days = seriesData().days || [];
  const bad = anomalySet(state.metric);
  const series = days.map((row, index) => row.valid && Number.isFinite(row.v) && !bad.has(index) ? row.v : null);
  const filled = state.impute && state.step === "day" && state.metric !== "wind_dir" ? reconstructionFor(state.metric) : null;
  const canvas = get("overview");
  const box = canvas.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return;
  const { ctx, width, height } = context(canvas);
  ctx.clearRect(0, 0, width, height);
  const anomalies = days.map((row, index) => row.valid && Number.isFinite(row.v) && bad.has(index) ? row.v : null);
  const values = series.concat(filled ? filled.values : [], anomalies).filter(Number.isFinite);
  if (values.length && state.metric !== "wind_dir") {
    const { low, high } = scale(values, value => [value]);
    const x = index => index / Math.max(1, series.length - 1) * width;
    const y = value => height - 8 - (value - low) / (high - low || 1) * Math.max(1, height - 16);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let open = false;
    series.forEach((value, index) => {
      if (!Number.isFinite(value)) { open = false; return; }
      if (!open) { ctx.moveTo(x(index), y(value)); open = true; }
      else ctx.lineTo(x(index), y(value));
    });
    ctx.stroke();
    if (filled) paintReconstruction(ctx, x, y, filled);
    ctx.fillStyle = "rgba(232,154,148,0.55)";
    anomalies.forEach((value, index) => {
      if (!Number.isFinite(value)) return;
      ctx.beginPath();
      ctx.arc(x(index), y(value), 1.8, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }
}

function placeSelection() {
  const width = get("brush").clientWidth || 1;
  const box = selectionBox(width);
  const sel = get("selection");
  sel.style.left = `${box.left}px`;
  sel.style.width = `${Math.max(0, box.right - box.left)}px`;
  const grain = state.view === "series" && state.step === "day" ? ", сутки" : "";
  const label = get("window-label");
  if (label) label.textContent = `${longDate.format(dateAt(state.from))} - ${longDate.format(dateAt(state.to))}${grain}`;
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

let moduleDrag = "";
let moduleRefitTries = 0;

function availableParams() {
  return (stationData().parameters || []).filter(key => PARAMS[key] && stationData().series[key]);
}

function defaultPicked() {
  const available = availableParams();
  const key = available.includes(state.metric) ? state.metric : available[0];
  return key ? { [key]: ["mean"] } : {};
}

function pruneModules() {
  const available = availableParams();
  state.modules.forEach(module => {
    if (module.kind !== "chart" || !module.picked) return;
    Object.keys(module.picked).forEach(key => {
      if (!available.includes(key)) delete module.picked[key];
    });
  });
  const first = state.modules.find(module => module.kind === "chart" && module.picked && Object.keys(module.picked).length);
  if (first) state.metric = Object.keys(first.picked)[0];
}

function moduleMenu(module) {
  return availableParams().map(key => {
    const on = !!(module.picked && module.picked[key]);
    const stats = key === "wind_dir" ? ["mean"] : Object.keys(LINE_STYLE);
    const lines = on ? `<div class="line-row">${stats.map(stat => {
      const pressed = (module.picked[key] || []).includes(stat);
      return `<button type="button" class="stat-toggle" data-key="${key}" data-stat="${stat}" aria-pressed="${pressed}" style="--series:${PARAMS[key][2]}"><i></i>${LINE_STYLE[stat].name}</button>`;
    }).join("")}</div>` : "";
    return `<div class="param-line" style="--series:${PARAMS[key][2]}"><button class="parameter" type="button" data-param="${key}" aria-pressed="${on}"><span class="select-mark"></span><span>${PARAMS[key][0]}</span><span class="unit">${PARAMS[key][1]}</span></button>${lines}</div>`;
  }).join("");
}

function bindPlotTip(canvas) {
  const box = canvas.parentElement && canvas.parentElement.querySelector(".tip");
  if (!box) return;
  canvas.addEventListener("pointermove", event => {
    const frame = canvas._frame;
    const rows = canvas._rows || [];
    const lines = canvas._lines || [];
    if (!frame || !rows.length) { box.hidden = true; return; }
    const local = event.clientX - canvas.getBoundingClientRect().left;
    let nearest = 0;
    let best = Infinity;
    rows.forEach((_, index) => {
      const distance = Math.abs(frame.x(index) - local);
      if (distance < best) { best = distance; nearest = index; }
    });
    const row = rows[nearest];
    const bits = [row.label || ""].concat(lines.map(line => {
      const value = line.values[nearest];
      const estimated = line.imputed && line.imputed.mask[nearest];
      const shown = estimated
        ? `${format.format(line.imputed.values[nearest])} ${PARAMS[line.key][1]}, восстановлено, не измерение`
        : value == null ? "нет" : `${format.format(value)} ${PARAMS[line.key][1]}`;
      return `${PARAMS[line.key][0]}, ${LINE_STYLE[line.stat].name}: ${shown}`;
    }));
    box.hidden = false;
    lines.filter(line => line.stat === "mean").forEach(line => {
      const source = line.rows[nearest];
      const outliers = source ? (source.red != null ? [source.red] : (source.reds || [])) : [];
      if (outliers.length) bits.push(`${PARAMS[line.key][0]}, выбросы: ${outliers.filter(Number.isFinite).map(value => format.format(value)).join("; ")} ${PARAMS[line.key][1]}`);
    });
    box.textContent = bits.join("\n");
    const canvasRect = canvas.getBoundingClientRect();
    const workRect = document.querySelector(".work").getBoundingClientRect();
    const visibleTop = Math.max(8, workRect.top - canvasRect.top + 8);
    const visibleBottom = Math.min(canvas.clientHeight - 8, workRect.bottom - canvasRect.top - 8);
    const room = visibleBottom - visibleTop;
    if (room < 40) { box.hidden = true; return; }
    box.style.maxHeight = `${room}px`;
    box.style.left = `${Math.max(8, Math.min(canvas.clientWidth - box.offsetWidth - 8, frame.x(nearest) + 8))}px`;
    box.style.top = `${Math.max(visibleTop, Math.min(visibleBottom - box.offsetHeight, event.clientY - canvasRect.top + 12))}px`;
  });
  canvas.addEventListener("pointerleave", event => { if (!box.contains(event.relatedTarget)) box.hidden = true; });
  box.addEventListener("pointerleave", event => { if (event.relatedTarget !== canvas) box.hidden = true; });
}

function paintChart(module, node) {
  const host = node.querySelector(".module-plots");
  const legend = node.querySelector(".module-legend");
  const keys = Object.keys(module.picked || {}).filter(key => (module.picked[key] || []).length && PARAMS[key]);
  if (module.layout === "split") {
    host.classList.add("split");
    host.innerHTML = keys.length ? keys.map(key => `<div class="plot-card"><h3>${PARAMS[key][0]}</h3><p class="legend module-legend"></p><div class="plot"><canvas data-key="${key}"></canvas><div class="tip" hidden></div></div></div>`).join("") : `<p class="empty-module">Включите параметр в списке.</p>`;
    if (legend) legend.innerHTML = "";
    keys.forEach(key => {
      const canvas = host.querySelector(`[data-key="${key}"]`);
      const cardLegend = canvas.closest(".plot-card").querySelector(".module-legend");
      drawOverlay(canvas, cardLegend, { [key]: module.picked[key] });
      bindPlotTip(canvas);
    });
  } else {
    host.classList.remove("split");
    host.innerHTML = `<div class="plot plot-tall"><canvas></canvas><div class="tip" hidden></div></div>`;
    const canvas = host.querySelector("canvas");
    drawOverlay(canvas, legend, module.picked);
    bindPlotTip(canvas);
  }
}

function paintRose(node) {
  const host = node.querySelector(".module-plots");
  if (!host.querySelector(".rose-svg")) {
    host.innerHTML = `<div class="rose-layout"><div class="rose-frame"><svg class="rose-svg" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid meet"></svg></div><p class="rose-note"></p><ul class="rose-legend"></ul><p class="rose-empty" hidden></p><details class="rose-numbers"><summary>Числа по секторам</summary><div class="table-scroll"><table class="rose-table"></table></div></details></div>`;
  }
  drawRose(host);
}

function moveModule(fromId, toId) {
  if (!fromId || fromId === toId) return;
  const from = state.modules.findIndex(module => module.id === fromId);
  const to = state.modules.findIndex(module => module.id === toId);
  if (from < 0 || to < 0) return;
  const [item] = state.modules.splice(from, 1);
  state.modules.splice(to, 0, item);
  update();
}

function focusModule(id) {
  requestAnimationFrame(() => {
    const node = get("modules").querySelector(`[data-module="${id}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: "instant", block: "nearest" });
    node.querySelector(".drag").focus({ preventScroll: true });
  });
}

function closeParameterMenus(except = null) {
  document.querySelectorAll(".mod-menu.open").forEach(menu => {
    if (menu === except) return;
    menu.classList.remove("open");
    menu.previousElementSibling.setAttribute("aria-expanded", "false");
  });
}

function placeParameterMenu(menu) {
  if (!menu || !menu.classList.contains("open")) return;
  // The mobile panel is bounded by the pinned header and timeline in CSS.
  if (window.innerWidth <= 760) { menu.removeAttribute("style"); return; }
  const button = menu.previousElementSibling.getBoundingClientRect();
  const topLimit = document.querySelector(".app-header").getBoundingClientRect().bottom + 12;
  const bottomLimit = document.querySelector(".timeline").getBoundingClientRect().top - 12;
  const width = Math.min(660, window.innerWidth - 48);
  menu.style.width = `${width}px`;
  const left = Math.max(24, Math.min(window.innerWidth - width - 24, button.right - width));
  const below = bottomLimit - button.bottom - 8;
  const above = button.top - 8 - topLimit;
  const wanted = Math.min(460, menu.scrollHeight);
  let top, space;
  if (below >= Math.min(wanted, 240)) { top = Math.max(topLimit, button.bottom + 8); space = bottomLimit - top; }
  else if (above >= Math.min(wanted, 240)) { space = Math.min(wanted, above); top = button.top - 8 - space; }
  else { top = topLimit; space = bottomLimit - topLimit; }
  Object.assign(menu.style, { left: `${left}px`, right: "auto", top: `${top}px`, bottom: "auto", maxHeight: `${Math.max(80, space)}px` });
}

function buildModule(module) {
  const article = document.createElement("article");
  article.className = "panel module";
  article.dataset.module = module.id;
  article.setAttribute("aria-labelledby", `${module.id}-title`);
  const dragControl = `<div class="drag-group"><button type="button" class="drag" draggable="true" title="Перетащить модуль. Для перемещения с клавиатуры: Alt и клавиши вверх или вниз." aria-label="Переместить модуль" aria-expanded="false" aria-controls="${module.id}-move"><svg viewBox="0 0 14 18" aria-hidden="true"><circle cx="4" cy="4" r="1.4"/><circle cx="10" cy="4" r="1.4"/><circle cx="4" cy="9" r="1.4"/><circle cx="10" cy="9" r="1.4"/><circle cx="4" cy="14" r="1.4"/><circle cx="10" cy="14" r="1.4"/></svg><span>Перетащить</span></button><div class="move-controls" id="${module.id}-move" hidden><button type="button" data-move="-1">Выше</button><button type="button" data-move="1">Ниже</button></div></div>`;
  const remove = `<button type="button" class="remove-module" data-remove aria-label="Удалить модуль" title="Удалить модуль">×</button>`;
  if (module.kind === "rose") {
    article.innerHTML = `<header class="module-head">${dragControl}<h2 id="${module.id}-title">Роза ветров</h2>${remove}</header><div class="module-plots"></div>`;
  } else {
    const title = module.layout === "split" ? "Отдельные графики" : "Совмещённый график";
    article.innerHTML = `<header class="module-head">${dragControl}<h2 id="${module.id}-title">${title}</h2><div class="layout-switch" role="group" aria-label="Расположение графиков"><button type="button" data-layout="overlay">Вместе</button><button type="button" data-layout="split">Раздельно</button></div><div class="mod-drop"><button type="button" class="mod-toggle" aria-expanded="false" aria-controls="${module.id}-params">Параметры (0)</button><div class="mod-menu" id="${module.id}-params" aria-label="Параметры графика"></div></div>${remove}</header><div class="module-legend legend"></div><div class="module-plots"></div><p class="chart-help"><span class="outlier-key" aria-hidden="true"></span>Выбросы учтены в масштабе.</p>`;
  }
  const drag = article.querySelector(".drag");
  const moveControls = article.querySelector(".move-controls");
  const moveBy = delta => {
    const index = state.modules.findIndex(item => item.id === module.id);
    const destination = state.modules[index + delta];
    if (!destination) return;
    moveModule(module.id, destination.id);
    get("module-status").textContent = `Модуль перемещён. Позиция ${index + delta + 1} из ${state.modules.length}.`;
    focusModule(module.id);
  };
  drag.addEventListener("click", () => {
    moveControls.hidden = !moveControls.hidden;
    drag.setAttribute("aria-expanded", String(!moveControls.hidden));
  });
  drag.addEventListener("keydown", event => {
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      moveBy(event.key === "ArrowUp" ? -1 : 1);
    }
    if (event.key === "Escape") { moveControls.hidden = true; drag.setAttribute("aria-expanded", "false"); }
  });
  moveControls.querySelectorAll("[data-move]").forEach(button => button.addEventListener("click", () => moveBy(Number(button.dataset.move))));
  drag.addEventListener("dragstart", event => {
    moduleDrag = module.id;
    closeParameterMenus();
    moveControls.hidden = true;
    drag.setAttribute("aria-expanded", "false");
    article.classList.add("is-dragging");
    event.dataTransfer.setData("text/plain", module.id);
    event.dataTransfer.effectAllowed = "move";
  });
  drag.addEventListener("dragend", () => {
    moduleDrag = "";
    article.classList.remove("is-dragging");
    document.querySelectorAll(".drop-target").forEach(node => node.classList.remove("drop-target"));
  });
  article.addEventListener("dragover", event => {
    if (!moduleDrag || moduleDrag === module.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    article.classList.add("drop-target");
  });
  article.addEventListener("dragleave", event => {
    if (event.relatedTarget && article.contains(event.relatedTarget)) return;
    article.classList.remove("drop-target");
  });
  article.addEventListener("drop", event => {
    if (!moduleDrag) return;
    event.preventDefault();
    const moving = moduleDrag;
    moduleDrag = "";
    article.classList.remove("drop-target");
    moveModule(moving, module.id);
    focusModule(moving);
  });
  article.querySelector("[data-remove]").addEventListener("click", () => {
    const index = state.modules.findIndex(item => item.id === module.id);
    state.modules = state.modules.filter(item => item.id !== module.id);
    if (!state.modules.length) state.modules.push({ id: `mod-${Date.now()}`, kind: "chart", layout: "overlay", picked: defaultPicked() });
    update();
    focusModule(state.modules[Math.min(index, state.modules.length - 1)].id);
  });
  article.querySelectorAll("[data-layout]").forEach(button => button.addEventListener("click", () => {
    module.layout = button.dataset.layout;
    update();
  }));
  const toggle = article.querySelector(".mod-toggle");
  const menu = article.querySelector(".mod-menu");
  if (toggle && menu) {
    toggle.addEventListener("click", event => {
      event.stopPropagation();
      closeParameterMenus(menu);
      const opening = !menu.classList.contains("open");
      menu.classList.toggle("open", opening);
      toggle.setAttribute("aria-expanded", String(opening));
      if (opening) placeParameterMenu(menu);
    });
    menu.addEventListener("keydown", event => {
      if (event.key === "Escape") { closeParameterMenus(); toggle.focus(); event.stopPropagation(); }
    });
    menu.addEventListener("click", event => {
      event.stopPropagation();
      if (event.target.closest("[data-close-menu]")) { closeParameterMenus(); toggle.focus(); return; }
      const stat = event.target.closest("[data-stat]");
      const param = event.target.closest("[data-param]");
      if (stat) {
        const key = stat.dataset.key;
        const list = module.picked[key] || [];
        const name = stat.dataset.stat;
        module.picked[key] = list.includes(name) ? list.filter(item => item !== name) : list.concat(name);
        if (!module.picked[key].length) delete module.picked[key];
        update();
        (menu.querySelector(`[data-key="${key}"][data-stat="${name}"]`) || menu.querySelector(`[data-param="${key}"]`)).focus({ preventScroll: true });
        return;
      }
      if (param) {
        const key = param.dataset.param;
        if (module.picked[key]) delete module.picked[key];
        else module.picked[key] = ["mean"];
        update();
        menu.querySelector(`[data-param="${key}"]`).focus({ preventScroll: true });
      }
    });
  }
  return article;
}

function paintModules() {
  const root = get("modules");
  if (!root || !data) return;
  pruneModules();
  const stamp = state.modules.map(module => `${module.id}:${module.kind}`).join("|");
  if (root.dataset.stamp !== stamp) {
    root.dataset.stamp = stamp;
    root.replaceChildren(...state.modules.map(buildModule));
  }
  state.modules.forEach(module => {
    const node = root.querySelector(`[data-module="${module.id}"]`);
    if (!node) return;
    const title = node.querySelector("h2");
    if (module.kind === "chart" && title) title.textContent = module.layout === "split" ? "Отдельные графики" : "Совмещённый график";
    node.querySelectorAll("[data-layout]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.layout === module.layout));
    });
    const position = state.modules.indexOf(module);
    node.querySelectorAll("[data-move]").forEach(button => {
      button.disabled = Number(button.dataset.move) < 0 ? position === 0 : position === state.modules.length - 1;
    });
    const menu = node.querySelector(".mod-menu");
    const menuOpen = menu && menu.classList.contains("open");
    if (menu) {
      menu.innerHTML = `<div class="params-heading"><strong>Параметры графика</strong><button type="button" data-close-menu aria-label="Закрыть параметры">×</button></div>${moduleMenu(module)}`;
      if (menuOpen) { menu.classList.add("open"); placeParameterMenu(menu); }
    }
    const toggle = node.querySelector(".mod-toggle");
    if (toggle && module.kind === "chart") {
      const count = Object.keys(module.picked || {}).length;
      toggle.textContent = `Параметры (${count})`;
    }
    if (module.kind === "rose") paintRose(node);
    else {
      paintChart(module, node);
      const help = node.querySelector(".chart-help");
      if (help) {
        const units = new Set(Object.keys(module.picked || {}).map(key => PARAMS[key][1]));
        help.innerHTML = `<span class="outlier-key" aria-hidden="true"></span>Выбросы учтены в масштабе.${module.layout !== "split" && units.size > 2 ? " Разные единицы: шкала 0-100. Исходные значения в подсказках." : ""}`;
      }
    }
  });
  const blank = [...root.querySelectorAll("canvas")].some(canvas => canvas.clientWidth < 2);
  if (blank && moduleRefitTries < 3) {
    moduleRefitTries += 1;
    requestAnimationFrame(() => update());
  } else if (!blank) moduleRefitTries = 0;
}

function update() {
  if (!data) return;
  pruneModules();
  months = buildMonths();
  monthShown = months.filter(inWindow);
  shown = state.view === "series" && state.step === "day" ? dailyPoints() : monthShown;
  document.querySelectorAll("[data-step]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.step === state.step));
  });
  get("toggle-impute").setAttribute("aria-pressed", String(state.impute));
  const note = get("range-note");
  if (note) note.textContent = "";
  syncMenus();
  syncDateFields();
  get("range-start").value = state.from;
  get("range-end").value = state.to;
  get("range-start").setAttribute("aria-valuetext", longDate.format(dateAt(state.from)));
  get("range-end").setAttribute("aria-valuetext", longDate.format(dateAt(state.to)));
  const summary = get("summary-context");
  if (summary) summary.textContent = `Сводка: ${metrics[state.metric][0].toLowerCase()}, ${state.step === "day" ? "дневные значения" : "месячные значения"}`;
  document.querySelectorAll("[data-window]").forEach(button => {
    const span = button.dataset.window;
    const selected = state.to === lastIndex() && (span === "all" ? state.from === 0 : state.from > 0 && state.from === Math.max(0, lastIndex() - Number(span) + 1));
    button.setAttribute("aria-pressed", String(selected));
  });
  renderStats();
  paintModules();
  drawTimeline();
  renderTable();
}

function applyPreset(name) {
  const pick = metric => {
    state.metric = metric;
    state.modules = [{ id: `mod-${Date.now()}`, kind: "chart", layout: "overlay", picked: { [metric]: ["mean"] } }];
  };
  if (name === "ame") {
    state.view = "series";
    pick("t_air");
    setStation("ame60");
    return;
  }
  if (name === "pair") {
    pick("t_air");
    setStation("kr1");
    state.view = "series";
    state.from = clampIndex(dayIndex("2025-01-01"));
    state.to = clampIndex(dayIndex("2025-12-31"));
    if (state.from > state.to) { const swap = state.from; state.from = state.to; state.to = swap; }
    update();
    return;
  }
  if (name === "pressure") {
    pick("pressure_hpa");
    setStation("kr1");
    state.view = "series";
    state.from = clampIndex(dayIndex("2024-01-01"));
    state.to = clampIndex(dayIndex("2024-12-31"));
    if (state.from > state.to) { const swap = state.from; state.from = state.to; state.to = swap; }
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

const extraBlocks = [];

function importFeedback(message, error = false) {
  const panel = get("import-feedback");
  panel.hidden = false;
  panel.classList.toggle("is-error", error);
  get("import-message").textContent = message;
  get("import-message").setAttribute("role", error ? "alert" : "status");
  panel.scrollIntoView({ block: "start" });
}

function importDataFile(file) {
  if (!file) return;
  const format = /\.json$/i.test(file.name) ? "json" : /\.csv$/i.test(file.name) ? "csv" : "";
  if (!format) { importFeedback("Выберите файл CSV или JSON.", true); return; }
  if (file.size > 20 * 1024 * 1024) { importFeedback("Файл слишком большой. Максимальный размер: 20 МБ.", true); return; }
  const button = get("menu-import");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  const reader = new FileReader();
  const finish = () => { button.disabled = false; button.removeAttribute("aria-busy"); get("import-file").value = ""; };
  reader.onerror = () => { finish(); importFeedback("Не удалось прочитать файл. Попробуйте выбрать его ещё раз.", true); };
  reader.onload = () => {
    try {
      const parsed = window.MeteoImport.parse(String(reader.result), format, file.name);
      const added = parsed.stations.map(descriptor => {
        let id = descriptor.id;
        let suffix = 1;
        while (data.stations[id]) id = `${descriptor.id}-${suffix++}`;
        data.stations[id] = descriptor.station;
        stations.push([id, descriptor.name, descriptor.note]);
        return { ...descriptor, id };
      });
      const first = added[0];
      const metric = first.station.parameters[0];
      const compatible = state.modules.some(module => module.kind === "chart" && Object.keys(module.picked || {}).some(key => first.station.parameters.includes(key)));
      if (!compatible) state.modules.push({ id: `mod-${Date.now()}`, kind: "chart", layout: "overlay", picked: { [metric]: ["mean"] } });
      state.step = "day";
      setStation(first.id, { metric });
      importFeedback(`Загружено: ${first.name}. ${added.length > 1 ? `Добавлено станций: ${added.length}. ` : ""}Период: ${first.station.start} - ${first.station.end}. Данные доступны в модулях, шаг: дни. Импорт хранится в этой вкладке.${first.note.includes("value") ? " Поле value/v принято за температуру воздуха (°C)." : ""}`);
    } catch (error) {
      importFeedback(`Импорт не выполнен. ${error.message || "Проверьте формат файла."}`, true);
    } finally { finish(); }
  };
  reader.readAsText(file, "UTF-8");
}

function addChartBlock(rows, title) {
  const id = `extra-${Date.now()}`;
  const block = { id, metric: state.metric, median: false, impute: false, rows: rows || null, title: title || "" };
  extraBlocks.push(block);
  const section = document.createElement("section");
  section.className = "panel mini-block";
  const keys = (stationData().parameters || []).filter(key => metrics[key]);
  section.innerHTML = `
    <div class="panel-head">
      <strong>${block.title || "График"}</strong>
      <select data-metric ${block.rows ? "hidden" : ""}>${keys.map(key => `<option value="${key}">${metrics[key][0]}</option>`).join("")}</select>
      <label><input type="checkbox" data-flag="median"> Медиана</label>
      <label><input type="checkbox" data-flag="impute"> Пропуски</label>
      <button type="button" data-remove>Убрать</button>
    </div>
    <div class="plot plot-short"><canvas id="${id}"></canvas></div>`;
  const select = section.querySelector("[data-metric]");
  if (select) select.value = block.metric;
  if (select) select.addEventListener("change", () => { block.metric = select.value; update(); });
  section.querySelectorAll("[data-flag]").forEach(input => input.addEventListener("change", () => {
    block[input.dataset.flag] = input.checked;
    update();
  }));
  section.querySelector("[data-remove]").addEventListener("click", () => {
    const index = extraBlocks.indexOf(block);
    if (index >= 0) extraBlocks.splice(index, 1);
    section.remove();
  });
  get("extra-blocks").append(section);
  update();
}

function drawExtraBlocks() {
  extraBlocks.forEach(block => {
    const canvas = get(block.id);
    if (!canvas) return;
    let items = block.rows;
    if (!items) {
      const saved = state.metric;
      state.metric = block.metric;
      items = state.step === "day" ? dailyPoints() : buildMonths().filter(inWindow);
      state.metric = saved;
    }
    const savedMetric = state.metric;
    const median = get("opt-median");
    const impute = get("opt-impute");
    const medianWas = median && median.checked;
    const imputeWas = impute && impute.checked;
    state.metric = block.metric;
    if (median) median.checked = !!block.median;
    if (impute) impute.checked = !!block.impute;
    drawSeries(canvas, items, {
      scale: scale(items, item => [item.value]),
      draw(ctx, x, y) {
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        let open = false;
        items.forEach((item, index) => {
          if (!Number.isFinite(item.value)) { open = false; return; }
          if (!open) { ctx.moveTo(x(index), y(item.value)); open = true; }
          else ctx.lineTo(x(index), y(item.value));
        });
        ctx.stroke();
        paintGuides(ctx, x, y, items);
      }
    });
    state.metric = savedMetric;
    if (median) median.checked = medianWas;
    if (impute) impute.checked = imputeWas;
  });
}

function bootControls() {
  get("toggle-impute").addEventListener("click", () => {
    state.impute = !state.impute;
    update();
  });
  get("stations").addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = stations.findIndex(item => item[0] === state.station);
    const next = event.key === "Home" ? 0 : event.key === "End" ? stations.length - 1 : (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + stations.length) % stations.length;
    setStation(stations[next][0], { keep: true });
    get("stations").querySelector('[aria-checked="true"]').focus();
  });
  get("stations").addEventListener("click", event => {
    const button = event.target.closest("[data-station]");
    if (button && button.dataset.station !== state.station) setStation(button.dataset.station, { keep: true });
  });
  get("metric").addEventListener("change", () => { state.metric = get("metric").value; update(); });
  ["opt-ma", "opt-band", "opt-anomaly", "opt-rose", "opt-soil", "opt-median", "opt-impute"].forEach(id => {
    const node = get(id);
    if (node) node.addEventListener("change", update);
  });
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
    update();
  }));
  const tablePanel = get("table-panel");
  if (tablePanel) tablePanel.addEventListener("toggle", renderTable);
  const brush = get("brush");
  const brushLocal = clientX => {
    const rect = brush.getBoundingClientRect();
    const scale = rect.width / (brush.clientWidth || rect.width || 1);
    return (clientX - rect.left) / scale;
  };
  const brushCursor = clientX => {
    const width = brush.clientWidth;
    if (width < 2) return;
    const box = selectionBox(width);
    const mode = pointerZone(brushLocal(clientX), box.left, box.right);
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
    const width = brush.clientWidth;
    if (width < 2) return;
    const box = selectionBox(width);
    const mode = pointerZone(brushLocal(event.clientX), box.left, box.right);
    if (!mode) return;
    brush.classList.toggle("is-resize", mode === "start" || mode === "end");
    brush.classList.toggle("is-move", mode === "move");
    brushDrag = {
      mode,
      pointer: event.pointerId,
      originX: event.clientX,
      originFrom: state.from,
      originTo: state.to,
      width: brush.clientWidth,
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
  const viewSelect = get("view");
  if (viewSelect) viewSelect.addEventListener("change", () => { state.view = viewSelect.value; update(); });
  const trendMonth = get("trend-month");
  if (trendMonth) trendMonth.addEventListener("change", () => { state.trendMonth = Number(trendMonth.value); update(); });
  get("excel").addEventListener("click", downloadExcel);
  get("pdf").addEventListener("click", printCharts);
  get("menu-import").addEventListener("click", () => get("import-file").click());
  get("import-dismiss").addEventListener("click", () => { get("import-feedback").hidden = true; });
  get("import-file").addEventListener("change", event => importDataFile(event.target.files && event.target.files[0]));
  const addChart = get("add-chart");
  const addRose = get("add-rose");
  if (addChart) addChart.addEventListener("click", () => {
    state.modules.push({ id: `mod-${Date.now()}`, kind: "chart", layout: "overlay", picked: defaultPicked() });
    update();
    focusModule(state.modules[state.modules.length - 1].id);
  });
  if (addRose) addRose.addEventListener("click", () => {
    state.modules.push({ id: `mod-${Date.now()}`, kind: "rose" });
    update();
    focusModule(state.modules[state.modules.length - 1].id);
  });
  document.addEventListener("click", () => closeParameterMenus());
  window.addEventListener("scroll", () => closeParameterMenus(), { passive: true });
  document.querySelector(".work").addEventListener("scroll", () => closeParameterMenus(), { passive: true });
  const closeHeaderMenus = () => {
    document.querySelectorAll(".brow-drop").forEach(menu => { menu.hidden = true; });
    document.querySelectorAll(".brow-link[aria-expanded]").forEach(button => button.setAttribute("aria-expanded", "false"));
  };
  document.querySelectorAll(".brow-link[aria-controls]").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    const menu = get(button.getAttribute("aria-controls"));
    const opening = menu.hidden;
    closeHeaderMenus();
    menu.hidden = !opening;
    button.setAttribute("aria-expanded", String(opening));
    closeParameterMenus();
  }));
  document.addEventListener("click", () => closeHeaderMenus());
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const toggle = document.querySelector('.brow-link[aria-expanded="true"], .mod-toggle[aria-expanded="true"]');
    closeHeaderMenus();
    closeParameterMenus();
    if (toggle) toggle.focus();
  });
  document.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
  document.querySelectorAll("[data-window]").forEach(button => button.addEventListener("click", () => {
    const last = lastIndex();
    const span = button.dataset.window;
    editingDates = false;
    if (span === "all") {
      state.from = 0;
      state.to = last;
    } else {
      const count = Number(span);
      state.to = last;
      state.from = Math.max(0, last - count + 1);
    }
    update();
  }));
  document.addEventListener("click", event => {
    if (event.target.closest && event.target.closest(".menu")) return;
    document.querySelectorAll(".menu-list").forEach(node => { node.hidden = true; });
  });
  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => update());
  });
  if (typeof ResizeObserver !== "undefined") {
    const dockObserver = new ResizeObserver(entries => {
      entries.forEach(entry => {
        const property = entry.target.classList.contains("timeline") ? "--timeline-height" : "--header-height";
        document.documentElement.style.setProperty(property, `${Math.ceil(entry.target.getBoundingClientRect().height)}px`);
      });
    });
    dockObserver.observe(document.querySelector(".timeline"));
    dockObserver.observe(document.querySelector(".app-header"));
  }
  if (document.fonts) document.fonts.ready.then(() => update());
}

function fitStage() {
  const stage = document.getElementById("stage");
  if (!stage) return;
  const scale = Math.min(window.innerWidth / 1440, window.innerHeight / 900);
  stage.style.width = "1440px";
  stage.style.height = "900px";
  stage.style.position = "absolute";
  stage.style.transformOrigin = "top left";
  stage.style.transform = `scale(${scale})`;
  stage.style.left = `${Math.max(0, (window.innerWidth - 1440 * scale) / 2)}px`;
  stage.style.top = `${Math.max(0, (window.innerHeight - 900 * scale) / 2)}px`;
}

fetch("/landing/dashboard/series.json").then(response => response.json()).then(payload => {
  data = payload;
  bootControls();
  if (get("view")) bindMenu(get("view"));
  if (get("trend-month")) bindMenu(get("trend-month"));
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
