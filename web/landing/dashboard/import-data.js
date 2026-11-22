/* Local-only data parsing. Imported text is data; it is never executed. */
(function (global) {
  "use strict";
  const DAY = 86400000;
  const MAX_ROWS = 50000;
  const MAX_DAYS = 20000;
  const UNITS = Object.freeze({ t_air: "°C", rh: "%", wind_speed: "м/с", wind_gust: "м/с", wind_dir: "°", soil_05: "°C", soil_10: "°C", soil_20: "°C", pressure_hpa: "гПа" });
  const KEYS = Object.keys(UNITS);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const fail = message => { throw new Error(message); };

  function nameOf(value, fallback) {
    return (typeof value === "string" ? value : fallback).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100) || "Новые данные";
  }
  function dateOf(value, where) {
    if (typeof value !== "string") fail(`${where}: укажите дату в формате ГГГГ-ММ-ДД.`);
    let text = value.trim();
    const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
    if (ru) text = `${ru[3]}-${ru[2]}-${ru[1]}`;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match || Number(match[1]) < 1000) fail(`${where}: дата «${text.slice(0, 40)}» должна иметь формат ГГГГ-ММ-ДД.`);
    const stamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== text) fail(`${where}: такой календарной даты не существует.`);
    return text;
  }
  const stampOf = date => Date.parse(`${date}T00:00:00Z`);
  const isoOf = stamp => new Date(stamp).toISOString().slice(0, 10);
  function numberOf(value, where) {
    if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
    if (typeof value === "string") {
      const text = value.trim();
      if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(text)) fail(`${where}: ожидается число или пустое значение.`);
      value = Number(text.replace(",", "."));
    }
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e12) fail(`${where}: число должно быть конечным и не превышать 10¹² по модулю.`);
    return value;
  }
  function countOf(value, fallback, where) {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value < 0 || value > 1e9) fail(`${where}: количество должно быть целым неотрицательным числом.`);
    return value;
  }
  function emptyDay(d) {
    return { d, v: null, min: null, max: null, median: null, n: 0, cov: 0, threshold: 1, valid: false, station_valid: false };
  }
  function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  function dailyValue(values, key) {
    if (key !== "wind_dir") return values.reduce((sum, value) => sum + value / values.length, 0);
    const east = values.reduce((sum, value) => sum + Math.sin(value * Math.PI / 180), 0);
    const north = values.reduce((sum, value) => sum + Math.cos(value * Math.PI / 180), 0);
    return Math.hypot(east, north) < 1e-10 ? null : (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
  }
  function assemble(name, maps, boundaries, windDays, defaultMapped, inputCount) {
    const parameters = KEYS.filter(key => maps.has(key) && [...maps.get(key).values()].some(day => day.valid && Number.isFinite(day.v)));
    if (!parameters.length) fail("В файле нет пригодных числовых данных. Используйте value или известные показатели, например t_air и rh.");
    const start = boundaries.start;
    const end = boundaries.end;
    const span = Math.round((stampOf(end) - stampOf(start)) / DAY) + 1;
    if (span < 1 || span > MAX_DAYS) fail(`Период должен занимать не больше ${MAX_DAYS.toLocaleString("ru-RU")} дней.`);
    const series = {};
    parameters.forEach(key => {
      const source = maps.get(key);
      const days = [];
      for (let index = 0; index < span; index += 1) {
        const d = isoOf(stampOf(start) + index * DAY);
        days.push(source.get(d) || emptyDay(d));
      }
      series[key] = { unit: UNITS[key], days };
    });
    return {
      name,
      note: `${start} - ${end}, импорт${defaultMapped ? ", value → температура воздуха" : `, параметров: ${parameters.length}`}`,
      station: { label: name, start, end, parameters, series, wind_days: windDays || {}, imported: true, import_rows: inputCount }
    };
  }

  function fromRows(rows, name) {
    if (!Array.isArray(rows) || !rows.length) fail("Список данных пуст. Нужен массив строк с датой и значением.");
    if (rows.length > MAX_ROWS) fail(`В одном наборе допускается не больше ${MAX_ROWS.toLocaleString("ru-RU")} строк.`);
    const groups = new Map();
    let start = "9999-12-31", end = "1000-01-01", defaultMapped = false;
    rows.forEach((row, index) => {
      const where = `Строка ${index + 1}`;
      if (!object(row)) fail(`${where}: ожидается объект с полями date и value.`);
      const d = dateOf(own(row, "date") ? row.date : row.d, where);
      start = d < start ? d : start;
      end = d > end ? d : end;
      const keys = KEYS.filter(key => own(row, key));
      const generic = !keys.length && (own(row, "value") || own(row, "v"));
      if (!keys.length && !generic) fail(`${where}: нет value или известных показателей (t_air, rh, wind_speed и другие).`);
      if (generic) { keys.push("t_air"); defaultMapped = true; }
      keys.forEach(key => {
        const value = numberOf(generic ? (own(row, "value") ? row.value : row.v) : row[key], `${where}, ${key}`);
        if (key === "wind_dir" && value !== null && (value < 0 || value > 360)) fail(`${where}: направление ветра должно быть от 0 до 360°.`);
        if (!groups.has(key)) groups.set(key, new Map());
        const days = groups.get(key);
        if (!days.has(d)) days.set(d, []);
        if (value !== null) days.get(d).push(value);
      });
    });
    if ((stampOf(end) - stampOf(start)) / DAY + 1 > MAX_DAYS) fail(`Период должен занимать не больше ${MAX_DAYS.toLocaleString("ru-RU")} дней.`);
    const maps = new Map();
    groups.forEach((dates, key) => {
      const days = new Map();
      dates.forEach((values, d) => {
        if (!values.length) { days.set(d, emptyDay(d)); return; }
        const v = dailyValue(values, key);
        let min = Infinity, max = -Infinity;
        values.forEach(value => { min = Math.min(min, value); max = Math.max(max, value); });
        days.set(d, { d, v, min: v === null || key === "wind_dir" ? null : min, max: v === null || key === "wind_dir" ? null : max, median: v === null || key === "wind_dir" ? null : median(values), n: values.length, cov: values.length, threshold: 1, valid: v !== null, station_valid: v !== null });
      });
      maps.set(key, days);
    });
    return assemble(name, maps, { start, end }, {}, defaultMapped, rows.length);
  }

  function nativeStation(raw, name) {
    if (!object(raw) || !object(raw.series)) fail("В архиве stations у каждой станции должен быть объект series.");
    const keys = KEYS.filter(key => own(raw.series, key));
    if (!keys.length) fail("В архиве станции нет известных показателей.");
    const maps = new Map();
    let first = "9999-12-31", last = "1000-01-01", inputCount = 0;
    keys.forEach(key => {
      const part = raw.series[key];
      if (!object(part) || !Array.isArray(part.days) || part.days.length > MAX_ROWS) fail(`Показатель ${key}: нужен массив days длиной не больше ${MAX_ROWS}.`);
      if (part.unit !== undefined && part.unit !== UNITS[key]) fail(`Показатель ${key}: единицы должны быть «${UNITS[key]}».`);
      inputCount = Math.max(inputCount, part.days.length);
      const days = new Map();
      part.days.forEach((entry, index) => {
        const where = `${key}, строка ${index + 1}`;
        if (!object(entry)) fail(`${where}: ожидается объект наблюдения.`);
        const d = dateOf(entry.d, where);
        if (days.has(d)) fail(`${where}: дата ${d} повторяется в одном ряду архива.`);
        first = d < first ? d : first;
        last = d > last ? d : last;
        let v = numberOf(entry.v, where);
        if (key === "wind_dir" && v !== null && (v < 0 || v > 360)) fail(`${where}: направление ветра должно быть от 0 до 360°.`);
        if (entry.valid !== undefined && typeof entry.valid !== "boolean") fail(`${where}: valid должен быть true или false.`);
        const valid = v !== null && entry.valid !== false;
        if (!valid) v = null;
        const min = valid ? numberOf(entry.min, `${where}, min`) ?? v : null;
        const max = valid ? numberOf(entry.max, `${where}, max`) ?? v : null;
        if (valid && (min > v || max < v || min > max)) fail(`${where}: минимум, среднее и максимум расположены в неверном порядке.`);
        const middle = valid ? numberOf(entry.median, `${where}, median`) : null;
        if (middle !== null && (middle < min || middle > max)) fail(`${where}: медиана должна лежать между минимумом и максимумом.`);
        days.set(d, { d, v, min, max, median: middle, n: countOf(entry.n, valid ? 1 : 0, where), cov: countOf(entry.cov, valid ? 1 : 0, where), threshold: countOf(entry.threshold, 1, where), valid, station_valid: valid && entry.station_valid !== false });
      });
      maps.set(key, days);
    });
    if (first > last) fail("В архиве станции нет строк наблюдений.");
    const start = raw.start === undefined ? first : dateOf(raw.start, "Начало архива");
    const end = raw.end === undefined ? last : dateOf(raw.end, "Конец архива");
    if (start > first || end < last || start > end) fail("Даты наблюдений выходят за начало или конец архива станции.");
    const windDays = {};
    if (raw.wind_days !== undefined) {
      if (!object(raw.wind_days) || Object.keys(raw.wind_days).length > MAX_DAYS) fail("wind_days должен содержать не больше 20 000 дат.");
      Object.entries(raw.wind_days).forEach(([date, bins]) => {
        const d = dateOf(date, "Роза ветров");
        if (d < start || d > end || !Array.isArray(bins) || bins.length !== 81 || bins.some(value => !Number.isInteger(value) || value < 0 || value > 1e9)) fail("Роза ветров: каждой дате в периоде должен соответствовать массив из 81 неотрицательного целого числа.");
        windDays[d] = bins.slice();
      });
    }
    return assemble(nameOf(raw.label, name), maps, { start, end }, windDays, false, inputCount);
  }

  function csvRows(text) {
    let quoted = false;
    const counts = { ";": 0, ",": 0, "\t": 0 };
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '"') quoted = !quoted;
      if (!quoted && (char === "\n" || char === "\r")) break;
      if (!quoted && own(counts, char)) counts[char] += 1;
    }
    const delimiter = counts[";"] ? ";" : counts["\t"] ? "\t" : ",";
    const rows = [];
    let row = [], cell = "", inQuote = false, afterQuote = false;
    const pushCell = () => { if (row.length >= 64 || cell.length > 4096) fail("CSV: слишком много столбцов или слишком длинное поле."); row.push(cell.trim()); cell = ""; afterQuote = false; };
    const pushRow = () => { pushCell(); if (row.some(value => value !== "")) rows.push(row); row = []; if (rows.length > MAX_ROWS + 1) fail(`CSV: допускается не больше ${MAX_ROWS} строк данных.`); };
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (inQuote) {
        if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
        else if (char === '"') { inQuote = false; afterQuote = true; }
        else cell += char;
      } else if (char === delimiter) pushCell();
      else if (char === "\n" || char === "\r") { pushRow(); if (char === "\r" && text[index + 1] === "\n") index += 1; }
      else if (char === '"' && !cell.trim() && !afterQuote) { cell = ""; inQuote = true; }
      else if (afterQuote && !/\s/.test(char)) fail("CSV: после закрывающей кавычки должен идти разделитель.");
      else cell += char;
      if (cell.length > 4096) fail("CSV: поле длиннее 4096 символов.");
    }
    if (inQuote) fail("CSV: не закрыта кавычка.");
    if (cell || row.length) pushRow();
    if (!rows.length) fail("CSV-файл пуст.");
    const aliases = { date: "date", d: "date", "дата": "date", value: "value", v: "value", "значение": "value" };
    const first = rows[0].map(value => value.toLowerCase());
    const header = first.some(value => own(aliases, value) || KEYS.includes(value));
    let columns;
    if (header) {
      columns = first.map(value => own(aliases, value) ? aliases[value] : KEYS.includes(value) ? value : null);
      const relevant = columns.filter(Boolean);
      if (new Set(relevant).size !== relevant.length) fail("CSV: названия столбцов повторяются.");
      if (!columns.includes("date") || !columns.some(value => value === "value" || KEYS.includes(value))) fail("CSV: нужны столбец date и value либо показатели t_air, rh и другие.");
      rows.shift();
    } else columns = ["date", "value"];
    return rows.map((cells, index) => {
      if (cells.length !== columns.length) fail(`CSV, строка ${index + (header ? 2 : 1)}: неверное число столбцов. Для десятичной запятой используйте разделитель «;».`);
      const result = {};
      columns.forEach((key, cellIndex) => { if (key) result[key] = cells[cellIndex]; });
      return result;
    });
  }

  function parse(text, format, fileName) {
    if (typeof text !== "string" || !text.trim()) fail("Файл пуст.");
    if (text.length > 20 * 1024 * 1024) fail("Файл должен быть не больше 20 МБ.");
    text = text.replace(/^\uFEFF/, "").trim();
    const name = nameOf(String(fileName || "Новые данные").split(/[\\/]/).pop().replace(/\.(csv|json)$/i, ""), "Новые данные");
    let kind = String(format || "").toLowerCase();
    if (!kind || kind === "auto") kind = /^[\[{]/.test(text) || /\.json$/i.test(fileName || "") ? "json" : "csv";
    let imported;
    if (kind === "csv") imported = [fromRows(csvRows(text), name)];
    else if (kind === "json") {
      let payload;
      try { payload = JSON.parse(text); } catch (_) { fail("JSON не прочитан: проверьте запятые, кавычки и скобки."); }
      if (object(payload) && own(payload, "stations")) {
        if (!object(payload.stations)) fail("JSON: stations должен быть объектом станций.");
        const entries = Object.entries(payload.stations);
        if (!entries.length || entries.length > 20) fail("В JSON-архиве должно быть от 1 до 20 станций.");
        imported = entries.map(([id, raw]) => nativeStation(raw, `${name}: ${nameOf(id, "станция")}`));
        if (imported.reduce((sum, item) => sum + item.station.import_rows, 0) > MAX_ROWS) fail("Суммарно архив может содержать не больше 50 000 строк дат по всем станциям.");
      } else if (Array.isArray(payload)) imported = [fromRows(payload, name)];
      else if (object(payload) && Array.isArray(payload.rows)) imported = [fromRows(payload.rows, nameOf(payload.name, name))];
      else fail("JSON: нужен массив [{date, value}], объект {name, rows} или архив {stations}.");
    } else fail("Выберите формат CSV или JSON.");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    return { stations: imported.map((item, index) => ({ id: `import-${(hash >>> 0).toString(36)}-${index + 1}`, ...item })) };
  }

  global.MeteoImport = Object.freeze({ parse });
})(window);
