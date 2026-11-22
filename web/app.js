const stations = {
  ame: {
    title: "АМЕ-60",
    from: "1992-07-01",
    to: "2021-12-31",
    params: [
      ["t_air", "Температура воздуха, C"],
      ["rh", "Влажность, %"],
      ["wind_speed", "Скорость ветра, м/с"],
      ["wind_gust", "Порывы, м/с"],
      ["wind_dir", "Направление ветра, градусы"],
      ["soil_05", "Почва 5 см, C"],
      ["soil_10", "Почва 10 см, C"],
      ["soil_20", "Почва 20 см, C"]
    ],
    margin: [
      "Сутки входят в расчёт от 72 сроков из 96.",
      "Месяц входит, если неполных суток не больше 10 и нет пяти подряд.",
      "С 4 января 1999 по 17 августа 2003 записей нет.",
      "Направление за 1998 не измерялось. За 2021 оно недостоверно, розу не строим.",
      "Среднее за выбранный период пишем вместе с числом лет. Это не климатическая норма.",
      "С Соколом этот ряд не соединяется."
    ]
  },
  kr1: {
    title: "Сокол М1, поляна",
    from: "2022-01-01",
    to: "2025-12-31",
    params: [
      ["t_air", "Температура воздуха, C"],
      ["rh", "Влажность, %"],
      ["wind_speed", "Скорость ветра, м/с"],
      ["wind_gust", "Порывы, м/с"],
      ["wind_dir", "Направление ветра, градусы"],
      ["pressure_hpa", "Давление, гПа"]
    ],
    margin: [
      "Сутки входят, если есть наблюдения не меньше чем за 18 разных часов из 24.",
      "Несколько записей одного часа дают один час для полноты и все годные значения в среднее суток.",
      "В 2023 наблюдения есть по 26 апреля.",
      "Почвы на этой станции нет.",
      "С АМЕ-60 и с полем этот ряд не склеивается."
    ]
  },
  kr2: {
    title: "Сокол М1, поле",
    from: "2022-01-01",
    to: "2025-12-31",
    params: [
      ["t_air", "Температура воздуха, C"],
      ["rh", "Влажность, %"],
      ["wind_speed", "Скорость ветра, м/с"],
      ["wind_gust", "Порывы, м/с"],
      ["wind_dir", "Направление ветра, градусы"],
      ["pressure_hpa", "Давление, гПа"]
    ],
    margin: [
      "Сутки входят, если есть наблюдения не меньше чем за 18 разных часов из 24.",
      "В 2023 примерно 25 суток, месяцы без данных не заполняем.",
      "Давление в 2022-2023 часто вне диапазона и помечено флагом. Остальные параметры строки остаются.",
      "С поляной и с АМЕ-60 этот ряд не склеивается."
    ]
  }
};

const stationSelect = document.getElementById("station");
const parameterSelect = document.getElementById("parameter");
const fromInput = document.getElementById("from");
const toInput = document.getElementById("to");
const readingTitle = document.getElementById("reading-title");
const refusal = document.getElementById("refusal");
const emptyNote = document.getElementById("empty-note");
const daybook = document.getElementById("daybook");
const margin = document.getElementById("margin");

function fillStations() {
  stationSelect.replaceChildren(...Object.entries(stations).map(([id, station]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = station.title;
    return option;
  }));
}

function fillParameters() {
  const station = stations[stationSelect.value];
  const previous = parameterSelect.value;
  parameterSelect.replaceChildren(...station.params.map(([id, label]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    return option;
  }));
  if (station.params.some(([id]) => id === previous)) parameterSelect.value = previous;
  fromInput.min = station.from;
  fromInput.max = station.to;
  toInput.min = station.from;
  toInput.max = station.to;
  if (!fromInput.value || fromInput.value < station.from || fromInput.value > station.to) {
    fromInput.value = station.from;
  }
  if (!toInput.value || toInput.value < station.from || toInput.value > station.to) {
    toInput.value = station.to;
  }
}

function writeMargin() {
  const station = stations[stationSelect.value];
  margin.replaceChildren();
  const kicker = document.createElement("p");
  kicker.className = "where";
  kicker.textContent = "Как считать";
  margin.append(kicker);
  station.margin.forEach((line) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    margin.append(paragraph);
  });
}

function refusalText() {
  const stationId = stationSelect.value;
  const parameter = parameterSelect.value;
  const fromYear = Number(fromInput.value.slice(0, 4));
  const toYear = Number(toInput.value.slice(0, 4));
  if (fromInput.value > toInput.value) return "Конец периода раньше начала.";
  if (stationId === "ame" && parameter === "wind_dir" && fromYear <= 1998 && toYear >= 1998 && fromYear === toYear) {
    return "В 1998 направление ветра не измерялось. Розу и среднее направления не строим.";
  }
  if (stationId === "ame" && parameter === "wind_dir" && fromYear <= 2021 && toYear >= 2021 && fromYear === toYear) {
    return "В 2021 направление ветра недостоверно целиком. Розу не строим. Остальные параметры этого года остаются.";
  }
  if (stationId !== "ame" && parameter.startsWith("soil_")) {
    return "Почва есть только у АМЕ-60.";
  }
  return "";
}

function showReading() {
  const station = stations[stationSelect.value];
  const parameterLabel = parameterSelect.selectedOptions[0].textContent;
  readingTitle.textContent = station.title + ", " + parameterLabel;
  const reason = refusalText();
  refusal.hidden = reason === "";
  refusal.textContent = reason;
  daybook.hidden = reason !== "";
  emptyNote.textContent = "Файлы этой станции на сервис ещё не положены. Когда CSV будет на диске, сюда лягут валидные сутки. Подставленных температур нет.";
}

document.getElementById("instrument").addEventListener("submit", (event) => {
  event.preventDefault();
  showReading();
});

stationSelect.addEventListener("change", () => {
  fillParameters();
  writeMargin();
  showReading();
});

parameterSelect.addEventListener("change", showReading);
fromInput.addEventListener("change", showReading);
toInput.addEventListener("change", showReading);

document.querySelectorAll("[data-sheet]").forEach((button) => {
  button.addEventListener("click", () => {
    const name = button.dataset.sheet;
    document.querySelectorAll("[data-sheet]").forEach((item) => {
      item.setAttribute("aria-pressed", item === button ? "true" : "false");
    });
    document.querySelectorAll(".sheet").forEach((sheet) => {
      sheet.hidden = sheet.id !== name;
    });
  });
});

const pressureStation = document.getElementById("pressure-station");
const pressureYear = document.getElementById("pressure-year");
const pressureNote = document.getElementById("pressure-note");

function showPressureNote() {
  const place = pressureStation.selectedOptions[0].textContent;
  const year = pressureYear.value;
  if (pressureStation.value === "kr1" && year === "2024") {
    pressureNote.textContent = place + ", " + year + ". Апрель в месячное давление не входит. 1362 значения вне 940-1050 гПа. По годным часам 334 суток и 11 месяцев. Температура этого апреля считается отдельно.";
    return;
  }
  if (pressureStation.value === "kr2" && (year === "2022" || year === "2023")) {
    pressureNote.textContent = place + ", " + year + ". Давление часто вне диапазона и помечено флагом. Точное число флагов кейс не даёт, подставлять его нельзя.";
    return;
  }
  pressureNote.textContent = place + ", " + year + ". Таблица давления появится из файла. Пока на диске пусто.";
}

pressureStation.addEventListener("change", showPressureNote);
pressureYear.addEventListener("change", showPressureNote);

document.getElementById("upload-file").addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  const report = document.getElementById("upload-report");
  const uploadName = document.getElementById("upload-name");
  const place = document.getElementById("upload-station").selectedOptions[0].textContent;
  if (!file) {
    uploadName.textContent = "не выбран";
    report.textContent = "Файл ещё не выбран.";
    return;
  }
  uploadName.textContent = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    const firstLine = String(reader.result).split(/\r?\n/)[0] || "";
    const columns = firstLine.split(",").map((item) => item.trim());
    if (!columns.includes("datetime")) {
      report.textContent = "В шапке нет колонки datetime. Файл в ряд " + place + " не кладём.";
      return;
    }
    report.textContent = "Шапка подходит для " + place + ": " + columns.join(", ") + ". На диск сервис этот файл пока не пишет.";
  };
  reader.readAsText(file.slice(0, 4000));
});

fillStations();
fillParameters();
writeMargin();
showReading();
showPressureNote();
