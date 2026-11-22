const sites = [
  { id: "ame60", name: "АМЕ-60", place: "урочище, отдельная площадка", lon: 32.88, lat: 56.5 },
  { id: "kr1", name: "Сокол М1, Кр1", place: "поляна", lon: 32.9, lat: 56.48 },
  { id: "kr2", name: "Сокол М1, Кр2", place: "поле", lon: 32.905, lat: 56.475 }
];

const canvas = document.getElementById("map");
const card = document.getElementById("card");
let ring = [];
let wind = {};
let view = { minX: 0, minY: 0, maxX: 1, maxY: 1, pad: 36 };
let camera = { x: 0, y: 0, scale: 1 };
let drag = null;

function fitScale() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const spanX = view.maxX - view.minX || 1;
  const spanY = view.maxY - view.minY || 1;
  return Math.min((width - view.pad * 2) / spanX, (height - view.pad * 2) / spanY);
}

function basePoint(lon, lat) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const fit = fitScale();
  return {
    x: view.pad + (lon - view.minX) * fit,
    y: height - view.pad - (lat - view.minY) * fit
  };
}

function project(lon, lat) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const point = basePoint(lon, lat);
  return {
    x: (point.x - width / 2) * camera.scale + width / 2 + camera.x,
    y: (point.y - height / 2) * camera.scale + height / 2 + camera.y
  };
}

function clampCamera() {
  if (!ring.length) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const points = ring.map(point => basePoint(point[0], point[1]));
  const minX = Math.min(...points.map(point => point.x));
  const maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y));
  const maxY = Math.max(...points.map(point => point.y));
  const slackX = Math.max(0, ((maxX - minX) * camera.scale - width) / 2);
  const slackY = Math.max(0, ((maxY - minY) * camera.scale - height) / 2);
  camera.x = Math.max(-slackX, Math.min(slackX, camera.x));
  camera.y = Math.max(-slackY, Math.min(slackY, camera.y));
}

function footprint(site) {
  const steps = 18;
  const points = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    points.push(project(site.lon + Math.cos(angle) * 0.012, site.lat + Math.sin(angle) * 0.008));
  }
  return points;
}

function drawArrow(ctx, x, y, degrees) {
  const bearing = ((degrees + 180) % 360) * Math.PI / 180;
  const length = 54;
  const tipX = x + Math.sin(bearing) * length;
  const tipY = y - Math.cos(bearing) * length;
  ctx.strokeStyle = "#f4e7a8";
  ctx.fillStyle = "#f4e7a8";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  const head = 0.55;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - Math.sin(bearing - 0.45) * length * head, tipY + Math.cos(bearing - 0.45) * length * head);
  ctx.lineTo(tipX - Math.sin(bearing + 0.45) * length * head, tipY + Math.cos(bearing + 0.45) * length * head);
  ctx.closePath();
  ctx.fill();
}

function draw() {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = "#10261c";
  ctx.fillRect(0, 0, width, height);
  if (!ring.length) return;
  const shape = ring.map(point => project(point[0], point[1]));
  ctx.beginPath();
  shape.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.closePath();
  ctx.save();
  ctx.clip();
  const wash = ctx.createLinearGradient(0, 0, width, height);
  wash.addColorStop(0, "#1d5a3b");
  wash.addColorStop(0.45, "#2f7a4c");
  wash.addColorStop(1, "#1a4a36");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(214, 196, 132, 0.16)";
  sites.forEach(site => {
    const spot = project(site.lon, site.lat);
    ctx.beginPath();
    ctx.ellipse(spot.x, spot.y, 70, 42, 0.4, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.strokeStyle = "rgba(232, 244, 214, 0.18)";
  ctx.lineWidth = 1;
  for (let step = 1; step < 5; step += 1) {
    const lon = view.minX + (view.maxX - view.minX) * step / 5;
    const top = project(lon, view.maxY);
    const bottom = project(lon, view.minY);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "#d5efc8";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#d5efc8";
  ctx.font = "12px \"Roboto Mono\", monospace";
  const north = project(view.minX, view.maxY);
  ctx.fillText("север", north.x + 8, north.y + 16);
  sites.forEach(site => {
    const area = footprint(site);
    ctx.beginPath();
    area.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    ctx.closePath();
    ctx.fillStyle = "rgba(188, 237, 145, 0.28)";
    ctx.strokeStyle = "#d7f5c4";
    ctx.stroke();
    ctx.fill();
    const spot = project(site.lon, site.lat);
    const sample = wind[site.id];
    ctx.fillStyle = "#f7f3df";
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, 5, 0, Math.PI * 2);
    ctx.fill();
    if (sample && sample.speed > 0) drawArrow(ctx, spot.x, spot.y, sample.dir);
    const windText = !sample ? "ветра нет" : sample.speed === 0 ? "штиль" : `${sample.speed.toFixed(1)} м/с, от ${Math.round(sample.dir)}°`;
    ctx.fillStyle = "#f4f6f1";
    ctx.font = "13px Inter, sans-serif";
    ctx.fillText(site.name, spot.x + 16, spot.y - 16);
    ctx.font = "12px \"Roboto Mono\", monospace";
    ctx.fillText(windText, spot.x + 16, spot.y + 2);
  });
  placeCard();
}

function hit(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return sites.find(site => {
    const spot = project(site.lon, site.lat);
    return Math.hypot(spot.x - x, spot.y - y) < 28;
  });
}

let chosen = null;

function placeCard() {
  if (!chosen || card.hidden) return;
  const spot = project(chosen.lon, chosen.lat);
  const width = Math.min(280, canvas.clientWidth - 24);
  const left = Math.max(8, Math.min(canvas.clientWidth - width - 8, spot.x + 18));
  const top = Math.max(8, Math.min(canvas.clientHeight - 180, spot.y - 12));
  card.style.width = `${width}px`;
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

function openCard(site) {
  const sample = wind[site.id];
  chosen = site;
  card.hidden = false;
  document.getElementById("card-place").textContent = site.place;
  document.getElementById("card-title").textContent = site.name;
  document.getElementById("card-wind").textContent = sample
    ? (sample.speed === 0
      ? `Последний пригодный день ${sample.date}: штиль.`
      : `Последний пригодный день ${sample.date}: ${sample.speed.toFixed(2)} м/с, ветер от ${Math.round(sample.dir)}°.`)
    : "Пригодного ветра в архиве нет.";
  document.getElementById("card-go").href = `/landing/dashboard?station=${site.id}`;
  placeCard();
}

canvas.addEventListener("pointerdown", event => {
  const site = hit(event);
  if (site) { openCard(site); return; }
  drag = { x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", event => {
  if (!drag) { canvas.style.cursor = hit(event) ? "pointer" : "grab"; return; }
  camera.x = drag.cx + event.clientX - drag.x;
  camera.y = drag.cy + event.clientY - drag.y;
  clampCamera();
  draw();
});
canvas.addEventListener("pointerup", () => { drag = null; });
canvas.addEventListener("wheel", event => {
  event.preventDefault();
  camera.scale = Math.min(3.2, Math.max(1, camera.scale * (event.deltaY > 0 ? 0.92 : 1.08)));
  clampCamera();
  draw();
}, { passive: false });
window.addEventListener("resize", draw);

Promise.all([
  fetch("/landing/map/reserve.json").then(response => response.json()),
  fetch("/landing/map/wind.json").then(response => response.json())
]).then(([reserve, winds]) => {
  ring = reserve.ring;
  wind = winds;
  const xs = ring.map(point => point[0]);
  const ys = ring.map(point => point[1]);
  view.minX = Math.min(...xs);
  view.maxX = Math.max(...xs);
  view.minY = Math.min(...ys);
  view.maxY = Math.max(...ys);
  draw();
});
