let data = null;
const get = id => document.getElementById(id);
const dayMs = 86400000;
const palette = {
  ink: "#e4eef3",
  muted: "#93a6b2",
  line: "rgba(210, 226, 232, 0.16)",
  teal: "#7dcec6",
  coral: "#e08b84",
  blue: "#7eaae0",
  gold: "#e3c36a",
  lilac: "#c9a0e0",
  soil5: "#e0b07a",
  soil10: "#7dcec6",
  soil20: "#7eaae0"
};
const clusterColor = [palette.blue, palette.gold, palette.lilac];
const metrics = {
  t_air: ["Температура воздуха", "°C"],
  rh: ["Относительная влажность", "%"],
  wind_speed: ["Скорость ветра", "м/с"],
  wind_gust: ["Порывы ветра", "м/с"],
  wind_dir: ["Направление ветра", "°"],
  soil_05: ["Температура почвы, 5 см", "°C"],
  soil_10: ["Температура почвы, 10 см", "°C"],
  soil_20: ["Температура почвы, 20 см", "°C"],
  pressure_hpa: ["Атмосферное давление", "гПа"]
};
const stations = [
  ["ame60", "АМЕ-60", "1992-2021"],
  ["kr1", "Сокол М1, Кр1", "поляна, 2022-2025"],
  ["kr2", "Сокол М1, Кр2", "поле, 2022-2025"]
];
const state = { station: "ame60", metric: "t_air", from: 0, to: 0, focus: null, focusChart: "chart", view: "series", trendMonth: 1 };
const format = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const monthName = new Intl.DateTimeFormat("ru-RU", { month: "short", year: "numeric", timeZone: "UTC" });
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const on = id => get(id).checked;
const source = () => data[state.station];
const at = index => new Date(Date.parse(source().start) + index * dayMs);
const unit = () => metrics[state.metric][1];
const text = value => value === null || !Number.isFinite(value) ? "—" : `${format.format(value)} ${unit()}`;
let months = [];
let shown = [];

function yearsWord(count) {
  const tail = count % 100;
  const last = count % 10;
  if (tail > 10 && tail < 20) return "лет";
  if (last === 1) return "год";
  if (last > 1 && last < 5) return "года";
  return "лет";
}

function circle(values) {
  const east = average(values.map(value => Math.sin(value * Math.PI / 180)));
  const north = average(values.map(value => Math.cos(value * Math.PI / 180)));
  if (Math.hypot(east, north) < 0.1) return null;
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
}

function kmeans(values) {
  const ready = values.filter(value => Number.isFinite(value));
  if (ready.length < 3) return values.map(() => 0);
  const sorted = [...ready].sort((a, b) => a - b);
  let centers = [0.2, 0.5, 0.8].map(part => sorted[Math.round((sorted.length - 1) * part)]);
  let labels = values.map(() => 0);
  for (let step = 0; step < 30; step += 1) {
    let moved = false;
    values.forEach((value, index) => {
      let best = 0;
      let distance = Infinity;
      centers.forEach((center, cluster) => {
        const next = Math.abs(value - center);
        if (next < distance) {
          distance = next;
          best = cluster;
        }
      });
      if (labels[index] !== best) moved = true;
      labels[index] = best;
    });
    centers = centers.map((center, cluster) => {
      const group = values.filter((_, index) => labels[index] === cluster);
      return group.length ? average(group) : center;
    });
    if (!moved) break;
  }
  const order = centers.map((center, cluster) => [center, cluster]).sort((a, b) => a[0] - b[0]);
  const rank = new Map(order.map((pair, index) => [pair[1], index]));
  return labels.map(cluster => rank.get(cluster));
}

function buildMonths() {
  const rows = source().series[state.metric] || [];
  const start = Date.parse(source().start);
  const groups = new Map();
  rows.forEach((row, index) => {
    const date = new Date(start + index * dayMs);
    const key = date.toISOString().slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ index, row, date });
  });
  const built = [];
  groups.forEach(items => {
    const first = items[0].date;
    const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const partial = first.getUTCDate() !== 1 || items.length !== days;
    const good = items.filter(item => item.row[0] !== null);
    let streak = 0;
    let longest = 0;
    items.forEach(item => {
      streak = item.row[0] === null ? streak + 1 : 0;
      longest = Math.max(longest, streak);
    });
    const usable = !partial && good.length > 0 && days - good.length <= 10 && longest < 5;
    const numbers = good.map(item => item.row[0]).sort((a, b) => a - b);
    const pick = part => numbers.length ? numbers[Math.min(numbers.length - 1, Math.round((numbers.length - 1) * part))] : null;
    let value = null;
    if (usable) value = state.metric === "wind_dir" ? circle(numbers) : average(numbers);
    built.push({
      key: first.toISOString().slice(0, 7),
      year: first.getUTCFullYear(),
      month: first.getUTCMonth() + 1,
      start: items[0].index,
      end: items[items.length - 1].index,
      label: monthName.format(first),
      value,
      q10: usable && state.metric !== "wind_dir" ? pick(0.1) : null,
      q90: usable && state.metric !== "wind_dir" ? pick(0.9) : null,
      anomaly: null,
      cluster: null
    });
  });
  const byMonth = new Map();
  built.forEach(item => {
    if (item.value === null || state.metric === "wind_dir") return;
    if (!byMonth.has(item.month)) byMonth.set(item.month, []);
    byMonth.get(item.month).push(item.value);
  });
  built.forEach(item => {
    const base = byMonth.get(item.month);
    if (item.value !== null && base && base.length >= 2) item.anomaly = item.value - average(base);
  });
  const sample = built.filter(item => item.value !== null);
  const labels = kmeans(sample.map(item => item.value));
  sample.forEach((item, index) => { item.cluster = labels[index]; });
  return built;
}

function inWindow(item) {
  return item.end >= state.from && item.start <= state.to;
}

function slopeTenYears(items) {
  const years = new Map();
  items.forEach(item => {
    if (item.value === null || state.metric === "wind_dir") return;
    if (!years.has(item.year)) years.set(item.year, []);
    years.get(item.year).push(item.value);
  });
  const points = [...years].filter(([, values]) => values.length >= 6).map(([year, values]) => [year, average(values)]);
  if (points.length < 3) return null;
  const meanX = average(points.map(point => point[0]));
  const meanY = average(points.map(point => point[1]));
  const spread = points.reduce((sum, point) => sum + (point[0] - meanX) ** 2, 0);
  if (!spread) return null;
  const slope = points.reduce((sum, point) => sum + (point[0] - meanX) * (point[1] - meanY), 0) / spread;
  return { perTen: slope * 10, years: points.length };
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
  const keys = Object.keys(source().series).filter(key => metrics[key]);
  if (!keys.includes(state.metric)) state.metric = "t_air";
  const select = get("metric");
  select.replaceChildren(...keys.map(key => new Option(metrics[key][0], key)));
  select.value = state.metric;
  bindMenu();
  state.from = 0;
  state.to = source().size - 1;
  get("range-start").min = 0;
  get("range-end").min = 0;
  get("range-start").max = state.to;
  get("range-end").max = state.to;
  renderStations();
  update();
}

function renderStats() {
  const values = shown.filter(item => item.value !== null);
  const years = new Set(values.map(item => item.year));
  const mean = values.length && state.metric !== "wind_dir" ? average(values.map(item => item.value)) : null;
  const low = values.length && state.metric !== "wind_dir" ? Math.min(...values.map(item => item.q10)) : null;
  const high = values.length && state.metric !== "wind_dir" ? Math.max(...values.map(item => item.q90)) : null;
  const trend = slopeTenYears(shown);
  const cards = [
    ["mean", "Средняя", text(state.metric === "wind_dir" ? null : mean)],
    ["low", "Мин.", text(low)],
    ["high", "Макс.", text(high)],
    ["trend", "За 10 лет", trend ? `${trend.perTen > 0 ? "+" : ""}${format.format(trend.perTen)} ${unit()}` : "—"],
    ["years", "Лет в расчёте", years.size ? `${years.size} ${yearsWord(years.size)}` : "0"]
  ];
  get("stats").innerHTML = cards.map(([kind, label, value]) =>
    `<article class="stat">${statIcon(kind)}<div><p>${label}</p><strong>${value}</strong></div></article>`
  ).join("");
  const april = state.station === "kr1" && state.metric === "pressure_hpa" && shown.some(item => item.key === "2024-04" && item.value === null);
  get("side-note").textContent = april
    ? "Апрель 2024 у Кр1 не входит в месячное давление."
    : "Отклонение от своего месяца этой станции. Не норма ВМО. Ряды не соединяются.";
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
    ctx.fillText(String(item.year), x(index), height - 8);
  });
  if (options.zero && low < 0 && high > 0) {
    ctx.strokeStyle = "rgba(228, 238, 243, 0.35)";
    ctx.beginPath();
    ctx.moveTo(pad.left, y(0));
    ctx.lineTo(width - pad.right, y(0));
    ctx.stroke();
  }
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

function drawAnnual() {
  const buckets = Array.from({ length: 12 }, (_, month) => ({ month: month + 1, label: ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"][month], values: [] }));
  shown.forEach(item => { if (item.value !== null) buckets[item.month - 1].values.push(item.value); });
  const items = buckets.map(bucket => ({ ...bucket, year: bucket.label, value: bucket.values.length ? average(bucket.values) : null, years: new Set(shown.filter(item => item.month === bucket.month && item.value !== null).map(item => item.year)).size }));
  plotItems(get("chart"), items, item => item.value, "Годовой ход", "среднее полных месяцев одного номера, с числом лет");
  get("chart")._read = item => `${item.label}\n${text(item.value)}\n${item.years} ${yearsWord(item.years)}`;
}

function drawMonthTrend() {
  const month = state.trendMonth;
  const names = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
  const items = months.filter(item => item.month === month && item.end >= state.from && item.start <= state.to);
  const ready = items.filter(item => item.value !== null);
  plotItems(get("chart"), items, item => item.value, `Тренд, ${names[month - 1]}`, ready.length >= 5 ? "линейная оценка по годам одного месяца, не прогноз" : "для линии нужно 5 пригодных лет");
  if (ready.length >= 5) {
    const frame = get("chart")._frame;
    const xs = ready.map(item => item.year);
    const ys = ready.map(item => item.value);
    const meanX = average(xs);
    const meanY = average(ys);
    const spread = xs.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
    if (spread && frame) {
      const slope = xs.reduce((sum, value, index) => sum + (value - meanX) * (ys[index] - meanY), 0) / spread;
      const line = year => meanY + slope * (year - meanX);
      frame.ctx.strokeStyle = palette.gold;
      frame.ctx.setLineDash([5, 4]);
      frame.ctx.beginPath();
      frame.ctx.moveTo(frame.x(items.findIndex(item => item.year === ready[0].year)), frame.y(line(ready[0].year)));
      const last = items.findIndex(item => item.year === ready[ready.length - 1].year);
      frame.ctx.lineTo(frame.x(last), frame.y(line(ready[ready.length - 1].year)));
      frame.ctx.stroke();
      frame.ctx.setLineDash([]);
    }
  }
  get("chart")._read = item => `${item.year}\n${text(item.value)}`;
}

function drawCompare() {
  const saved = { station: state.station, metric: state.metric };
  state.metric = "t_air";
  state.station = "kr1";
  const left = buildMonths();
  state.station = "kr2";
  const right = buildMonths();
  state.station = saved.station;
  state.metric = saved.metric;
  const rightByKey = new Map(right.map(item => [item.key, item]));
  const items = left.filter(item => item.key >= "2022-01" && item.key <= "2025-12").map(item => {
    const other = rightByKey.get(item.key);
    const both = item.value !== null && other && other.value !== null;
    return { ...item, kr1: item.value, kr2: other ? other.value : null, value: both ? item.value : null, diff: both ? item.value - other.value : null };
  });
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
  get("main-legend").textContent = "поляна и поле по общим месяцам, без АМЕ-60";
  const temp = value => value === null || !Number.isFinite(value) ? "—" : `${format.format(value)} °C`;
  get("chart")._read = item => `${item.label}\nКр1 ${temp(item.kr1)}\nКр2 ${temp(item.kr2)}\nразность ${temp(item.diff)}`;
}

function drawDekad() {
  const rows = source().series[state.metric] || [];
  const start = Date.parse(source().start);
  const groups = new Map();
  for (let index = state.from; index <= state.to && index < rows.length; index += 1) {
    const date = new Date(start + index * dayMs);
    const day = date.getUTCDate();
    const part = day <= 10 ? 1 : day <= 20 ? 2 : 3;
    const key = `${date.toISOString().slice(0, 7)}-${part}`;
    if (!groups.has(key)) groups.set(key, { key, label: `${["I","II","III"][part - 1]} ${date.toISOString().slice(0, 7)}`, year: date.getUTCFullYear(), values: [] });
    if (rows[index][0] !== null) groups.get(key).values.push(rows[index][0]);
  }
  const items = [...groups.values()].map(item => ({ ...item, value: item.values.length ? average(item.values) : null }));
  plotItems(get("chart"), items, item => item.value, "Декады", "среднее пригодных суток декады, пропуски пустые");
  get("chart")._read = item => `${item.label}\n${text(item.value)}\nсуток ${item.values.length}`;
}

function downloadExcel() {
  const header = ["Период", "Значение", "Единица", "Станция", "Показатель"];
  const body = shown.map(item => [item.label, item.value === null ? "" : String(item.value), unit(), state.station, metrics[state.metric][0]]);
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Данные"><Table>
<Row>${header.map(cell => `<Cell><Data ss:Type="String">${cell}</Data></Cell>`).join("")}</Row>
${body.map(row => `<Row>${row.map(cell => `<Cell><Data ss:Type="String">${String(cell).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Data></Cell>`).join("")}</Row>`).join("")}
</Table></Worksheet></Workbook>`;
  const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `arhiv-${state.station}-${state.metric}.xls`;
  link.click();
  URL.revokeObjectURL(link.href);
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
  if (band) bits.push("полоса 10-90%");
  if (on("opt-ma")) bits.push("скользящее среднее");
  get("main-legend").textContent = bits.join(", ");
  get("main-title").textContent = metrics[state.metric][0];
}

function drawAnomaly() {
  const panel = get("anomaly-panel");
  const show = on("opt-anomaly") && state.metric !== "wind_dir";
  panel.hidden = !on("opt-anomaly");
  if (!show) {
    get("anomaly-caption").textContent = "Для направления круговое среднее не раскладывается на отклонения вверх и вниз.";
    return;
  }
  get("anomaly-caption").textContent = "Столбец: месяц минус среднее этого же месяца по годам станции. Точки сверху: три кластера по температуре месяца, нижний холоднее, верхний теплее. Пропуски, в том числе 1999-2003 у АМЕ-60, не заполняются.";
  get("anomaly-legend").innerHTML = [
    [palette.coral, "отклонение +"],
    [palette.blue, "отклонение -"],
    [clusterColor[0], "кластер 1"],
    [clusterColor[1], "кластер 2"],
    [clusterColor[2], "кластер 3"]
  ].map(([color, name]) => `<span class="key"><i style="background:${color}"></i>${name}</span>`).join("");
  const anomalies = shown.map(item => item.anomaly).filter(value => Number.isFinite(value));
  const span = anomalies.length ? Math.max(Math.abs(Math.min(...anomalies)), Math.abs(Math.max(...anomalies)), 1) : 1;
  const frame = drawSeries(get("anomaly"), shown, {
    scale: { low: -span * 1.15, high: span * 2.15 },
    gridLow: -span,
    gridHigh: span,
    zero: true,
    draw(ctx, x, y, plotHeight, pad) {
      const width = Math.max(2, Math.abs(x(Math.min(1, shown.length - 1)) - x(0)) * 0.62);
      const split = pad.top + plotHeight * 0.34;
      ctx.strokeStyle = palette.line;
      ctx.beginPath();
      ctx.moveTo(pad.left, split);
      ctx.lineTo(pad.left + (x(Math.max(0, shown.length - 1)) - pad.left), split);
      ctx.stroke();
      shown.forEach((item, index) => {
        if (item.anomaly === null) return;
        ctx.fillStyle = item.anomaly >= 0 ? palette.coral : palette.blue;
        const top = y(item.anomaly);
        const base = y(0);
        ctx.fillRect(x(index) - width / 2, Math.min(top, base), width, Math.abs(base - top));
      });
      shown.forEach((item, index) => {
        if (item.cluster === null) return;
        const lane = pad.top + 10 + (2 - item.cluster) * 11;
        ctx.fillStyle = clusterColor[item.cluster];
        ctx.beginPath();
        ctx.arc(x(index), lane, 3.1, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });
  get("anomaly")._frame = frame;
}

function drawRose() {
  const panel = get("rose-panel");
  panel.hidden = !on("opt-rose");
  if (panel.hidden) return;
  const rows = source().series.wind_dir || [];
  const bins = new Array(16).fill(0);
  for (let index = state.from; index <= state.to && index < rows.length; index += 1) {
    const value = rows[index][0];
    if (value === null) continue;
    bins[Math.min(15, Math.floor(value / 22.5))] += 1;
  }
  const total = bins.reduce((sum, value) => sum + value, 0);
  get("rose-note").textContent = total
    ? `${total} валидных суток. 1998 и 2021 у АМЕ-60 в розу не входят: направления нет или оно недостоверно.`
    : "В этом окне нет валидного направления. У АМЕ-60 роза за 1998 и 2021 не строится.";
  const { ctx, width, height } = context(get("rose"));
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2 + 6;
  const radius = Math.min(width, height) * 0.36;
  const max = Math.max(...bins, 1);
  ctx.strokeStyle = palette.line;
  ctx.fillStyle = palette.muted;
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "center";
  for (let ring = 1; ring <= 3; ring += 1) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * ring / 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  bins.forEach((count, index) => {
    const angle = (index + 0.5) * Math.PI / 8 - Math.PI / 2;
    ctx.fillStyle = "rgba(125, 206, 198, 0.75)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius * count / max, angle - 0.16, angle + 0.16);
    ctx.closePath();
    ctx.fill();
  });
  [["С", 0, -radius - 14], ["В", radius + 14, 4], ["Ю", 0, radius + 18], ["З", -radius - 14, 4]].forEach(([label, dx, dy]) => {
    ctx.fillStyle = palette.ink;
    ctx.fillText(label, cx + dx, cy + dy);
  });
}

function drawSoil() {
  const panel = get("soil-panel");
  const available = state.station === "ame60";
  panel.hidden = !on("opt-soil");
  if (panel.hidden) return;
  if (!available) {
    get("soil-legend").textContent = "Почва измерялась только на АМЕ-60.";
    const { ctx, width, height } = context(get("soil"));
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = palette.muted;
    ctx.font = "16px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("На Соколе датчиков почвы в архиве нет", width / 2, height / 2);
    return;
  }
  get("soil-legend").textContent = "5 см, 10 см, 20 см";
  const saved = state.metric;
  const layers = ["soil_05", "soil_10", "soil_20"].map(metric => {
    state.metric = metric;
    return buildMonths().filter(inWindow);
  });
  state.metric = saved;
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
  const series = (source().series[state.metric] || []).map(row => row[0]);
  const { ctx, width, height } = context(get("overview"));
  ctx.clearRect(0, 0, width, height);
  const values = series.filter(value => value !== null && state.metric !== "wind_dir");
  if (values.length && state.metric !== "wind_dir") {
    const low = Math.min(...values);
    const high = Math.max(...values);
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
  const span = Math.max(1, source().size - 1);
  const left = state.from / span * width;
  const right = state.to / span * width;
  get("selection").style.left = `${left}px`;
  get("selection").style.width = `${Math.max(2, right - left)}px`;
  get("window-label").textContent = `${monthName.format(at(state.from))} — ${monthName.format(at(state.to))}`;
}

function tip(canvas, event, id, read) {
  const frame = canvas._frame;
  const box = get(id);
  if (!frame || !shown.length) { box.hidden = true; return; }
  const local = event.clientX - canvas.getBoundingClientRect().left;
  let nearest = 0;
  let best = Infinity;
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

function bootControls() {
  get("stations").addEventListener("click", event => {
    const button = event.target.closest("[data-station]");
    if (button) setStation(button.dataset.station);
  });
  get("metric").addEventListener("change", () => {
    state.metric = get("metric").value;
    update();
  });
  ["opt-ma", "opt-band", "opt-anomaly", "opt-rose", "opt-soil"].forEach(id => get(id).addEventListener("change", update));
  get("range-start").addEventListener("input", () => {
    state.from = Math.min(Number(get("range-start").value), state.to);
    update();
  });
  get("range-end").addEventListener("input", () => {
    state.to = Math.max(Number(get("range-end").value), state.from);
    update();
  });
  get("view").addEventListener("change", () => { state.view = get("view").value; update(); });
  get("trend-month").addEventListener("change", () => { state.trendMonth = Number(get("trend-month").value); update(); });
  get("excel").addEventListener("click", downloadExcel);
  let exclusions = null;
  let exclusionFilter = "";
  const stationTitle = { ame60: "АМЕ-60", kr1: "Кр1, поляна", kr2: "Кр2, поле" };
  function paintExceptions() {
    const summary = get("exceptions-summary");
    const body = get("exceptions-rows");
    summary.innerHTML = exclusions.summary.map(item => {
      const pressed = exclusionFilter === `${item.station}|${item.why}`;
      return `<button type="button" data-filter="${item.station}|${item.why}" aria-pressed="${pressed}">${stationTitle[item.station] || item.station}: ${item.why}. ${item.count}</button>`;
    }).join("");
    const rows = exclusions.rows.filter(row => !exclusionFilter || `${row.station}|${row.why}` === exclusionFilter);
    body.innerHTML = rows.map(row => `<tr><td>${stationTitle[row.station] || row.station}</td><td>${row.when || ""}</td><td>${row.parameter}</td><td>${row.value || ""}</td><td>${row.why}</td></tr>`).join("")
      || `<tr><td colspan="5">Для этой причины в журнале только счётчик, без отдельных сроков.</td></tr>`;
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
  document.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => {
    const name = button.dataset.preset;
    if (name === "ame") { state.view = "series"; state.metric = "t_air"; get("view").value = "series"; setStation("ame60"); }
    if (name === "pair") {
      state.metric = "t_air";
      setStation("kr1");
      state.view = "compare";
      get("view").value = "compare";
      state.from = Math.max(0, Math.round((Date.parse("2025-01-01") - Date.parse(source().start)) / dayMs));
      state.to = Math.min(source().size - 1, Math.round((Date.parse("2025-12-31") - Date.parse(source().start)) / dayMs));
      update();
    }
    if (name === "pressure") {
      state.metric = "pressure_hpa";
      setStation("kr1");
      state.view = "series";
      get("view").value = "series";
      state.from = Math.max(0, Math.round((Date.parse("2024-01-01") - Date.parse(source().start)) / dayMs));
      state.to = Math.min(source().size - 1, Math.round((Date.parse("2024-12-31") - Date.parse(source().start)) / dayMs));
      update();
    }
  }));
  get("chart").addEventListener("pointermove", event => tip(get("chart"), event, "chart-tip", item =>
    get("chart")._read ? get("chart")._read(item) : `${item.label}\n${text(item.value)}`));
  get("anomaly").addEventListener("pointermove", event => tip(get("anomaly"), event, "anomaly-tip", item =>
    `${item.label}\nмесяц ${text(item.value)}\nотклонение ${item.anomaly === null ? "—" : text(item.anomaly)}\nкластер ${item.cluster === null ? "—" : item.cluster + 1}`));
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
