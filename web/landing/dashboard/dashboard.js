let data = null;
const get = id => document.getElementById(id);
const dayMs = 86400000;
const palette = {
  ink: "#e4eef3", muted: "#93a6b2", line: "rgba(210, 226, 232, 0.16)",
  teal: "#7dcec6", coral: "#e08b84", blue: "#7eaae0", gold: "#e3c36a",
  lilac: "#c9a0e0", soil5: "#e0b07a", soil10: "#7dcec6", soil20: "#7eaae0"
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
const state = { station: "ame60", metric: "t_air", from: 0, to: 0, focus: null, focusChart: "chart", view: "series", trendMonth: 1, lines: [] };
const format = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const formatFull = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 });
const monthName = new Intl.DateTimeFormat("ru-RU", { month: "short", year: "numeric", timeZone: "UTC" });
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const on = id => get(id).checked;
const unit = () => metrics[state.metric][1];
const text = value => value === null || value === undefined || !Number.isFinite(value) ? "—" : `${formatFull.format(value)} ${unit()}`;
let months = [];
let shown = [];

function yearsWord(count) {
  const tail = count % 100, last = count % 10;
  if (tail > 10 && tail < 20) return "лет";
  if (last === 1) return "год";
  if (last > 1 && last < 5) return "года";
  return "лет";
}

function stationData() { return data.stations[state.station]; }
function seriesData() { return stationData().series[state.metric]; }
function dayIndex(dateStr) {
  const start = Date.parse(stationData().start);
  return Math.round((Date.parse(dateStr) - start) / dayMs);
}
function dateAt(index) { return new Date(Date.parse(stationData().start) + index * dayMs); }
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

function inWindow(item) { return item.end >= state.from && item.start <= state.to; }

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

function bindMenu() {
  const select = get("metric");
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
  sync();
}

function setStation(id) {
  state.station = id;
  const keys = (stationData().parameters || []).filter(key => metrics[key]);
  if (!keys.includes(state.metric)) state.metric = "t_air";
  const select = get("metric");
  select.replaceChildren(...keys.map(key => new Option(metrics[key][0], key)));
  select.value = state.metric;
  bindMenu();
  state.from = 0;
  state.to = seriesData().days.length - 1;
  const start = get("range-start"), end = get("range-end");
  start.min = 0; end.min = 0; start.max = state.to; end.max = state.to;
  renderStations();
  update();
}

function renderStats() {
  const values = shown.filter(item => item.value !== null);
  const years = new Set(values.map(item => item.year));
  const mean = values.length && state.metric !== "wind_dir" ? average(values.map(item => item.value)) : null;
  const low = values.length && state.metric !== "wind_dir" ? Math.min(...values.map(item => item.value)) : null;
  const high = values.length && state.metric !== "wind_dir" ? Math.max(...values.map(item => item.value)) : null;
  const trend = state.view === "series" && state.metric !== "wind_dir" ? monthTrend(shown, state.trendMonth) : { slope: null };
  const cards = [
    ["mean", "Средняя", text(state.metric === "wind_dir" ? null : mean)],
    ["low", "Мин.", text(low)],
    ["high", "Макс.", text(high)],
    ["trend", "Тренд мес.", trend.slope !== null && trend.slope !== undefined ? `${trend.slope > 0 ? "+" : ""}${format.format(trend.slope)} ${unit()}/год` : "—"],
    ["years", "Лет в расчёте", years.size ? `${years.size} ${yearsWord(years.size)}` : "0"]
  ];
  get("stats").innerHTML = cards.map(([kind, label, value]) =>
    `<article class="stat">${statIcon(kind)}<div><p>${label}</p><strong>${value}</strong></div></article>`
  ).join("");
  const april = state.station === "kr1" && state.metric === "pressure_hpa" && shown.some(item => item.key === "2024-04" && item.value === null);
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
  ctx.font = "12px Inter, sans-serif";
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
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const step = Math.max(1, Math.ceil(items.length / 8));
  items.forEach((item, index) => {
    if (index % step && index !== items.length - 1) return;
    ctx.fillText(String(item.year ?? item.label ?? ""), x(index), height - 8);
  });
  if (options.zero && low < 0 && high > 0) {
    ctx.strokeStyle = "rgba(228, 238, 243, 0.35)";
    ctx.beginPath();
    ctx.moveTo(pad.left, y(0));
    ctx.lineTo(width - pad.right, y(0));
    ctx.stroke();
  }
  // пользовательские горизонтальные линии
  state.lines.forEach(line => {
    if (line.value === null || line.value === undefined) return;
    ctx.strokeStyle = line.color || palette.gold;
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
      ctx.strokeStyle = palette.teal;
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
      frame.ctx.strokeStyle = palette.gold;
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
  const items = [...groups.values()].map(g => ({
    ...g, kr1: g.a.length ? average(g.a) : null, kr2: g.b.length ? average(g.b) : null,
    value: g.a.length ? average(g.a) : null, diff: g.a.length ? average(g.a) - average(g.b) : null, shared: g.a.length
  }));
  const view = scale(items, item => [item.kr1, item.kr2]);
  const frame = drawSeries(get("chart"), items, {
    scale: view,
    draw(ctx, x, y) {
      [["kr1", palette.teal], ["kr2", palette.gold]].forEach(([key, color]) => {
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
  const temp = value => value === null || !Number.isFinite(value) ? "—" : `${formatFull.format(value)} °C`;
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

function drawMain() {
  get("trend-month-field").hidden = state.view !== "trend";
  if (state.view === "annual") return drawAnnual();
  if (state.view === "trend") return drawMonthTrend();
  if (state.view === "compare") return drawCompare();
  if (state.view === "dekad") return drawDekad();
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
          ctx.fillStyle = "rgba(125, 206, 198, 0.18)";
          ctx.fill();
        });
      }
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = palette.teal;
      runs(shown, item => item.value).forEach(run => {
        ctx.beginPath();
        run.forEach((index, order) => order ? ctx.lineTo(x(index), y(shown[index].value)) : ctx.moveTo(x(index), y(shown[index].value)));
        ctx.stroke();
      });
      if (on("opt-ma")) {
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = palette.gold;
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
    get("anomaly-caption").textContent = "Для направления круговое среднее не раскладывается на отклонения вверх и вниз.";
    return;
  }
  get("anomaly-caption").textContent = "Столбец: месяц минус среднее этого же календарного месяца по всем годам станции. База — среднее за выбранный период, не норма ВМО.";
  get("anomaly-legend").innerHTML = [
    [palette.coral, "отклонение +"],
    [palette.blue, "отклонение -"]
  ].map(([color, name]) => `<span class="key"><i style="background:${color}"></i>${name}</span>`).join("");
  const anomalies = shown.map(item => item.anomaly).filter(value => Number.isFinite(value));
  const span = anomalies.length ? Math.max(Math.abs(Math.min(...anomalies)), Math.abs(Math.max(...anomalies)), 1) : 1;
  const frame = drawSeries(get("anomaly"), shown, {
    scale: { low: -span * 1.15, high: span * 2.15 },
    gridLow: -span, gridHigh: span, zero: true,
    draw(ctx, x, y, plotHeight, pad) {
      const width = Math.max(2, Math.abs(x(Math.min(1, shown.length - 1)) - x(0)) * 0.62);
      shown.forEach((item, index) => {
        if (item.anomaly === null) return;
        ctx.fillStyle = item.anomaly >= 0 ? palette.coral : palette.blue;
        const top = y(item.anomaly), base = y(0);
        ctx.fillRect(x(index) - width / 2, Math.min(top, base), width, Math.abs(base - top));
      });
    }
  });
  get("anomaly")._frame = frame;
}

// ---- роза ветров из срочных наблюдений (16 секторов + штиль + корзины скорости) ----
function drawRose() {
  const panel = get("rose-panel");
  panel.hidden = !on("opt-rose");
  if (panel.hidden) return;
  const windDays = stationData().wind_days || {};
  const bins = new Array(81).fill(0);
  const start = dateAt(state.from).toISOString().slice(0, 10);
  const end = dateAt(state.to).toISOString().slice(0, 10);
  let any = false;
  for (const [d, arr] of Object.entries(windDays)) {
    if (d < start || d > end) continue;
    any = true;
    for (let i = 0; i < 81; i += 1) bins[i] += arr[i];
  }
  const calm = bins[0];
  const directional = bins.slice(1).reduce((s, v) => s + v, 0);
  const total = calm + directional;
  const unavailable = state.station === "ame60" && state.from <= dayIndex("1998-12-31") && state.to >= dayIndex("1998-01-01");
  const unavailable21 = state.station === "ame60" && state.from <= dayIndex("2021-12-31") && state.to >= dayIndex("2021-01-01");
  if (!any && !total) {
    get("rose-note").textContent = unavailable || unavailable21
      ? `Роза не строится: ${unavailable ? "в 1998 направление не измерялось" : ""}${unavailable && unavailable21 ? "; " : ""}${unavailable21 ? "в 2021 направление недостоверно" : ""}.`
      : "В этом окне нет пригодных срочных данных ветра.";
    const { ctx, width, height } = context(get("rose"));
    ctx.clearRect(0, 0, width, height);
    return;
  }
  get("rose-note").textContent = `Пригодных срочных наблюдений: ${total}. Штиль: ${calm} (${format.format(100 * calm / total)}%). Знаменатель включает штиль.`;
  const { ctx, width, height } = context(get("rose"));
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2, cy = height / 2 + 6;
  const radius = Math.min(width, height) * 0.36;
  const max = Math.max(...bins.slice(1), 1);
  ctx.strokeStyle = palette.line;
  ctx.fillStyle = palette.muted;
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "center";
  for (let ring = 1; ring <= 3; ring += 1) {
    ctx.beginPath(); ctx.arc(cx, cy, radius * ring / 3, 0, Math.PI * 2); ctx.stroke();
  }
  for (let sector = 0; sector < 16; sector += 1) {
    let count = 0;
    for (let b = 0; b < 5; b += 1) count += bins[1 + sector * 5 + b];
    const angle = (sector + 0.5) * Math.PI / 8 - Math.PI / 2;
    ctx.fillStyle = "rgba(125, 206, 198, 0.75)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius * count / max, angle - 0.16, angle + 0.16);
    ctx.closePath();
    ctx.fill();
  }
  [["С", 0, -radius - 14], ["В", radius + 14, 4], ["Ю", 0, radius + 18], ["З", -radius - 14, 4]].forEach(([label, dx, dy]) => {
    ctx.fillStyle = palette.ink;
    ctx.fillText(label, cx + dx, cy + dy);
  });
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

function drawTimeline() {
  const series = (seriesData().days || []).map(row => row.v);
  const { ctx, width, height } = context(get("overview"));
  ctx.clearRect(0, 0, width, height);
  const values = series.filter(value => value !== null && state.metric !== "wind_dir");
  if (values.length && state.metric !== "wind_dir") {
    const low = Math.min(...values), high = Math.max(...values);
    ctx.strokeStyle = palette.teal;
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
  const span = Math.max(1, seriesData().days.length - 1);
  const left = state.from / span * width;
  const right = state.to / span * width;
  get("selection").style.left = `${left}px`;
  get("selection").style.width = `${Math.max(2, right - left)}px`;
  get("window-label").textContent = `${monthName.format(dateAt(state.from))} — ${monthName.format(dateAt(state.to))}`;
}

function tip(canvas, event, id, read) {
  const frame = canvas._frame;
  const box = get(id);
  if (!frame || !shown.length) { box.hidden = true; return; }
  const local = event.clientX - canvas.getBoundingClientRect().left;
  let nearest = 0, best = Infinity;
  shown.forEach((_, index) => {
    const distance = Math.abs(frame.x(index) - local);
    if (distance < best) { best = distance; nearest = index; }
  });
  state.focus = nearest;
  const item = shown[nearest];
  box.hidden = false;
  box.textContent = read(item);
  box.style.left = `${Math.max(8, Math.min(frame.width - 180, frame.x(nearest) + 8))}px`;
}

function update() {
  months = buildMonths();
  shown = months.filter(inWindow);
  get("range-start").value = state.from;
  get("range-end").value = state.to;
  renderStats();
  drawMain();
  drawAnomaly();
  drawRose();
  drawSoil();
  drawTimeline();
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
    get("side-note").textContent = "Влажность — отдельный показатель (выберите «Относительная влажность» в меню).";
    update();
  }
}

function bootControls() {
  get("stations").addEventListener("click", event => {
    const button = event.target.closest("[data-station]");
    if (button) setStation(button.dataset.station);
  });
  get("metric").addEventListener("change", () => { state.metric = get("metric").value; update(); });
  ["opt-ma", "opt-band", "opt-anomaly", "opt-rose", "opt-soil"].forEach(id => get(id).addEventListener("change", update));
  get("range-start").addEventListener("input", () => { state.from = Math.min(Number(get("range-start").value), state.to); update(); });
  get("range-end").addEventListener("input", () => { state.to = Math.max(Number(get("range-end").value), state.from); update(); });
  get("view").addEventListener("change", () => { state.view = get("view").value; update(); });
  get("trend-month").addEventListener("change", () => { state.trendMonth = Number(get("trend-month").value); update(); });
  get("excel").addEventListener("click", downloadExcel);
  document.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
  document.querySelectorAll("[data-template]").forEach(button => button.addEventListener("click", () => applyTemplate(button.dataset.template)));
  // горизонтальные линии
  get("line-value").addEventListener("change", () => {
    const value = parseFloat(get("line-value").value);
    state.lines = value === value ? [{ value, label: get("line-label").value || String(value), color: palette.gold }] : [];
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
    `${item.label}\nмесяц ${text(item.value)}\nотклонение ${item.anomaly === null ? "—" : text(item.anomaly)}`));
  ["chart", "anomaly"].forEach(id => get(id).addEventListener("pointerleave", () => { get(`${id === "chart" ? "chart" : "anomaly"}-tip`).hidden = true; }));
  document.addEventListener("click", event => {
    if (event.target.closest && event.target.closest(".menu")) return;
    document.querySelectorAll(".menu-list").forEach(node => { node.hidden = true; });
  });
  new ResizeObserver(update).observe(get("chart"));
}

fetch("/landing/dashboard/series.json").then(response => response.json()).then(payload => {
  data = payload;
  bootControls();
  const asked = new URLSearchParams(location.search).get("station");
  setStation(["ame60", "kr1", "kr2"].includes(asked) ? asked : "ame60");
}).catch(() => { get("stats").textContent = "Архив не открылся."; });
