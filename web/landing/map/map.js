/* Карта архивного ветра.
   Ссылка на архив: /landing/dashboard?station=kr1&date=YYYY-MM-DD&metric=wind_speed
   Дата в ссылке - выбранный на карте день, даже если ветра в нём нет.
   Числа берутся из wind.json (meteo.engine.daily_statistics). */

const COMPASS = ["север", "северо-восток", "восток", "юго-восток", "юг", "юго-запад", "запад", "северо-запад"];
const PIN = `<svg viewBox="0 0 36 44" aria-hidden="true"><path class="pin-body" d="M18 42 C18 42 5 25 5 16 A13 13 0 1 1 31 16 C31 25 18 42 18 42 Z"/><circle class="pin-well" cx="18" cy="15" r="4.2"/><path class="pin-vane" d="M18 15 V9 M14.4 11.4 H21.6"/></svg>`;

const canvas = document.getElementById("map");
const stage = document.getElementById("map-stage");
const tip = document.getElementById("map-tip");
const dateInput = document.getElementById("map-date");
const prevButton = document.getElementById("map-prev");
const nextButton = document.getElementById("map-next");
const motionButton = document.getElementById("map-motion");
const frameButton = document.getElementById("map-frame");
const nearestButton = document.getElementById("map-nearest");
const markerRoot = document.getElementById("map-markers");
const phoneRoot = document.getElementById("map-phone");

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let motion = !reduced;
let ring = [];
let stations = [];
let wind = null;
let selected = "";
let datesWithData = [];
let flowDates = [];
let scaleMax = 1;
let view = { minX: 0, minY: 0, maxX: 1, maxY: 1, pad: 28 };
let cam = { lon: 32.9, lat: 56.49, zoom: 1 };
let camera = { x: 0, y: 0, scale: 1 };
let specks = {};
let gust = 0;
let markers = {};
let markersDirty = true;
let openId = "";
let raf = 0;
let lastTick = 0;
let drag = null;

function width() { return canvas.clientWidth; }
function height() { return canvas.clientHeight; }

function fitScale() {
  const spanX = view.maxX - view.minX || 1;
  const spanY = view.maxY - view.minY || 1;
  return Math.min((width() - view.pad * 2) / spanX, (height() - view.pad * 2) / spanY);
}

function basePoint(lon, lat) {
  const fit = fitScale();
  return {
    x: view.pad + (lon - view.minX) * fit,
    y: height() - view.pad - (lat - view.minY) * fit,
  };
}

function project(lon, lat) {
  const point = basePoint(lon, lat);
  return {
    x: (point.x - width() / 2) * camera.scale + width() / 2 + camera.x,
    y: (point.y - height() / 2) * camera.scale + height() / 2 + camera.y,
  };
}

function unproject(sx, sy) {
  const fit = fitScale();
  const bx = (sx - width() / 2 - camera.x) / camera.scale + width() / 2;
  const by = (sy - height() / 2 - camera.y) / camera.scale + height() / 2;
  return [
    view.minX + (bx - view.pad) / fit,
    view.minY + (height() - view.pad - by) / fit,
  ];
}

function inside(lon, lat) {
  let cross = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const hit = (yi > lat) !== (yj > lat)
      && lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-15) + xi;
    if (hit) cross = !cross;
  }
  return cross;
}

function applyCamera() {
  if (cam.zoom <= 1.001) {
    camera.scale = 1;
    camera.x = 0;
    camera.y = 0;
    return;
  }
  camera.scale = cam.zoom;
  const point = basePoint(cam.lon, cam.lat);
  camera.x = -(point.x - width() / 2) * camera.scale;
  camera.y = -(point.y - height() / 2) * camera.scale;
}

function frameStations() {
  if (!stations.length || width() < 20) return;
  const lons = stations.map((site) => site.lon);
  const lats = stations.map((site) => site.lat);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  let lon = (minLon + maxLon) / 2;
  let lat = (minLat + maxLat) / 2;
  if (!inside(lon, lat)) {
    lon = stations.find((site) => site.id === "kr1")?.lon ?? lon;
    lat = stations.find((site) => site.id === "kr1")?.lat ?? lat;
  }
  const spanLon = Math.max(0.035, (maxLon - minLon) * 2.4);
  const spanLat = Math.max(0.028, (maxLat - minLat) * 2.8);
  const fit = fitScale();
  const zoom = Math.min((width() - 160) / (spanLon * fit), (height() - 160) / (spanLat * fit));
  cam.lon = lon;
  cam.lat = lat;
  cam.zoom = Math.max(1, Math.min(14, zoom));
  markersDirty = true;
}

function shiftView(dx, dy) {
  if (!dx && !dy) return;
  applyCamera();
  const [lon1, lat1] = unproject(width() / 2, height() / 2);
  const [lon2, lat2] = unproject(width() / 2 - dx, height() / 2 - dy);
  cam.lon += lon2 - lon1;
  cam.lat += lat2 - lat1;
}

function ringScreenBounds() {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  ring.forEach((point) => {
    const spot = project(point[0], point[1]);
    minX = Math.min(minX, spot.x);
    maxX = Math.max(maxX, spot.x);
    minY = Math.min(minY, spot.y);
    maxY = Math.max(maxY, spot.y);
  });
  return { minX, maxX, minY, maxY };
}

function keepViewInside() {
  if (!ring.length || width() < 40 || height() < 40) return;
  applyCamera();
  if (cam.zoom <= 1.001) return;
  const box = ringScreenBounds();
  const spanX = box.maxX - box.minX;
  const spanY = box.maxY - box.minY;
  let dx = 0;
  let dy = 0;
  if (spanX <= width()) dx = (width() - spanX) / 2 - box.minX;
  else if (box.minX > 0) dx = -box.minX;
  else if (box.maxX < width()) dx = width() - box.maxX;
  if (spanY <= height()) dy = (height() - spanY) / 2 - box.minY;
  else if (box.minY > 0) dy = -box.minY;
  else if (box.maxY < height()) dy = height() - box.maxY;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
  shiftView(dx, dy);
}

function panBy(dx, dy) {
  if (cam.zoom <= 1.001 || (!dx && !dy)) return;
  shiftView(dx, dy);
  keepViewInside();
  markersDirty = true;
}

function zoomBy(factor, sx, sy) {
  const next = Math.max(1, Math.min(14, cam.zoom * factor));
  if (Math.abs(next - cam.zoom) < 0.0001) return;
  if (next <= 1.001) {
    cam.zoom = 1;
    markersDirty = true;
    return;
  }
  applyCamera();
  const px = sx == null ? width() / 2 : sx;
  const py = sy == null ? height() / 2 : sy;
  const [lon, lat] = unproject(px, py);
  cam.zoom = next;
  applyCamera();
  const spot = project(lon, lat);
  shiftView(px - spot.x, py - spot.y);
  keepViewInside();
  markersDirty = true;
}

function lowerBound(list, iso) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < iso) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function stepDate(iso, dir) {
  const index = lowerBound(datesWithData, iso);
  if (dir < 0) {
    const prev = index - 1;
    return prev >= 0 ? datesWithData[prev] : null;
  }
  const next = datesWithData[index] === iso ? index + 1 : index;
  return next < datesWithData.length ? datesWithData[next] : null;
}

function closestFlow(iso) {
  if (!flowDates.length) return null;
  const index = lowerBound(flowDates, iso);
  const choices = [];
  if (index < flowDates.length) choices.push(flowDates[index]);
  if (index > 0) choices.push(flowDates[index - 1]);
  let best = null;
  let bestDist = Infinity;
  const origin = dayNumber(iso);
  choices.forEach((item) => {
    const dist = Math.abs(dayNumber(item) - origin);
    if (dist < bestDist || (dist === bestDist && best && item > best)) {
      best = item;
      bestDist = dist;
    }
  });
  return best;
}

function dayNumber(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

function outside(site, iso) {
  return iso < site.period[0] || iso > site.period[1];
}

function recordFor(site, iso) {
  if (outside(site, iso)) return null;
  return site.days[iso] || null;
}

function stationHref(id, iso) {
  return `/landing/dashboard?station=${id}&date=${iso}&metric=wind_speed`;
}

function formatSpeed(value) {
  return Number(value).toFixed(2).replace(".", ",");
}

function compass(deg) {
  const turn = ((deg % 360) + 360) % 360;
  return COMPASS[Math.round(turn / 45) % 8];
}

function flowVector(rec) {
  if (!rec || rec.flow !== "vector" || rec.dir == null) return null;
  const bearing = ((rec.dir + 180) % 360) * Math.PI / 180;
  return { x: Math.sin(bearing), y: -Math.cos(bearing) };
}

function zoneRadius() {
  return Math.max(32, Math.min(64, 26 + cam.zoom * 3.2));
}

function speedColor(speed) {
  const t = Math.max(0, Math.min(1, speed / scaleMax));
  const from = [214, 236, 176];
  const to = [255, 252, 220];
  const rgb = from.map((channel, index) => Math.round(channel + (to[index] - channel) * t));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function cardLines(site) {
  const lines = [site.name, selected];
  if (outside(site, selected)) {
    lines.push("Вне срока станции");
    lines.push(`Срок с ${site.period[0]} по ${site.period[1]}`);
    return lines;
  }
  const rec = recordFor(site, selected);
  if (!rec) {
    lines.push("Нет наблюдений за эти сутки");
    return lines;
  }
  if (rec.flow === "calm") {
    lines.push("0 м/с, штиль");
  } else if (rec.speed == null) {
    lines.push(rec.reason || "Скорости нет");
  } else if (rec.flow === "vector" && rec.dir != null) {
    lines.push(`${formatSpeed(rec.speed)} м/с, от ${Math.round(rec.dir)}°, ${compass(rec.dir)}`);
  } else {
    lines.push(`${formatSpeed(rec.speed)} м/с`);
    if (rec.reason) lines.push(rec.reason);
  }
  lines.push("Метка схематичная: координат в архиве нет");
  return lines;
}

function showTip(site) {
  const anchor = markers[site.id] && markers[site.id].hit;
  if (!anchor) return;
  openId = site.id;
  tip.replaceChildren();
  cardLines(site).forEach((line) => {
    const row = document.createElement("p");
    row.textContent = line;
    tip.append(row);
  });
  const link = document.createElement("a");
  link.className = "goto";
  link.href = stationHref(site.id, selected);
  link.textContent = "Перейти";
  tip.append(link);
  tip.hidden = false;
  const stageBox = stage.getBoundingClientRect();
  const box = anchor.getBoundingClientRect();
  let left = box.right - stageBox.left + 8;
  let top = box.top - stageBox.top;
  if (left + 240 > stageBox.width) left = Math.max(8, box.left - stageBox.left - 248);
  if (top + 150 > stageBox.height) top = Math.max(8, stageBox.height - 158);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
  Object.keys(markers).forEach((id) => {
    markers[id].hit.classList.toggle("is-open", id === site.id);
  });
}

function hideTip() {
  openId = "";
  tip.hidden = true;
  Object.keys(markers).forEach((id) => markers[id].hit.classList.remove("is-open"));
}

function statusClass(site) {
  if (outside(site, selected)) return "is-dim";
  const rec = recordFor(site, selected);
  if (!rec || rec.flow === "none") return "is-dim";
  if (rec.flow === "calm") return "is-calm";
  return "is-on";
}

function labelSpeed(site) {
  if (outside(site, selected)) return "";
  const rec = recordFor(site, selected);
  if (!rec) return "";
  if (rec.flow === "calm") return "Штиль";
  if (rec.speed == null) return "";
  return `${formatSpeed(rec.speed)} м/с`;
}

function ariaText(site) {
  return cardLines(site).join(". ");
}

function syncMotionButton() {
  motionButton.textContent = motion ? "Пауза" : "Движение";
  motionButton.setAttribute("aria-pressed", motion ? "true" : "false");
}

function updateChrome() {
  dateInput.value = selected;
  const prev = stepDate(selected, -1);
  const next = stepDate(selected, 1);
  prevButton.disabled = !prev;
  nextButton.disabled = !next;
  stations.forEach((site) => {
    const href = stationHref(site.id, selected);
    const node = markers[site.id];
    if (node) {
      node.hit.setAttribute("aria-label", ariaText(site));
      const mode = statusClass(site);
      node.hit.className = `mark ${mode}${openId === site.id ? " is-open" : ""}`;
    }
    const phone = phoneRoot.querySelector(`[data-station="${site.id}"]`);
    if (phone) {
      phone.href = href;
      const extra = labelSpeed(site);
      phone.textContent = extra ? `${site.name}: ${extra}` : site.name;
    }
  });
  const near = closestFlow(selected);
  const hasFlow = flowDates.includes(selected);
  if (!near || hasFlow) {
    nearestButton.hidden = true;
  } else {
    nearestButton.hidden = false;
    nearestButton.textContent = `Ближайший день с потоком: ${near}`;
    nearestButton.dataset.date = near;
  }
  markersDirty = true;
}

function setDate(iso) {
  if (!iso || iso < wind.archive_start || iso > wind.archive_end) return;
  selected = iso;
  updateChrome();
  resetSpecks();
  paintAll();
}

function resetSpecks() {
  stations.forEach((site) => {
    const rec = recordFor(site, selected);
    if (!motion || document.hidden || !rec || rec.flow !== "vector") {
      specks[site.id] = [];
      return;
    }
    const radius = zoneRadius();
    specks[site.id] = Array.from({ length: 8 }, (_, index) => ({
      along: ((index % 4) - 1.5) * radius * 0.42,
      across: ((index % 3) - 1) * radius * 0.22,
      span: 0.75 + (index % 3) * 0.12,
      bulk: 2.2,
    }));
  });
}

function updateSpecks(dt) {
  gust = (gust + dt * 0.42) % 1;
  const radius = zoneRadius();
  stations.forEach((site) => {
    const rec = recordFor(site, selected);
    const list = specks[site.id];
    if (!rec || rec.flow !== "vector" || !list || !list.length) return;
    const t = Math.max(0, Math.min(1, rec.speed / scaleMax));
    const step = (18 + 70 * t) * dt;
    list.forEach((speck) => {
      speck.along += step * speck.span;
      const limit = radius * radius - speck.across * speck.across * 0.8;
      if (speck.along * speck.along > Math.max(0, limit)) {
        speck.along = -Math.sqrt(Math.max(0, limit));
      }
    });
  });
}

function paintStreak(ctx, x, y, ux, uy, len, half) {
  const px = -uy * half;
  const py = ux * half;
  ctx.beginPath();
  ctx.moveTo(x + ux * 4, y + uy * 4);
  ctx.lineTo(x - ux * len + px, y - uy * len + py);
  ctx.lineTo(x - ux * len - px, y - uy * len - py);
  ctx.closePath();
  ctx.fill();
}

function drawGustFronts(ctx, origin, vector, radius, speedT) {
  const angle = Math.atan2(vector.y, vector.x);
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.rotate(angle);
  ctx.strokeStyle = speedColor(speedT * scaleMax);
  ctx.lineWidth = 1.6;
  for (let wave = 0; wave < 2; wave += 1) {
    const shift = motion ? (gust * (0.7 + speedT * 0.5) + wave / 2) % 1 : 0.28 + wave * 0.34;
    const x = (shift - 0.42) * radius * 2.05;
    const bow = 8 + shift * radius * 0.34;
    ctx.globalAlpha = Math.max(0, 0.15 + (1 - Math.abs(shift - 0.55) * 1.5) * (0.45 + speedT * 0.4));
    ctx.beginPath();
    ctx.arc(x, 0, bow, -1.05, 1.05);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawFlows(ctx) {
  const radius = zoneRadius();
  stations.forEach((site) => {
    const rec = recordFor(site, selected);
    const vector = flowVector(rec);
    if (!vector) return;
    const origin = project(site.lon, site.lat);
    const t = Math.max(0.18, Math.min(1, rec.speed / scaleMax));
    ctx.fillStyle = speedColor(rec.speed);
    ctx.globalAlpha = 0.07;
    ctx.beginPath();
    ctx.ellipse(origin.x, origin.y, radius * 0.95, radius * 0.62, Math.atan2(vector.y, vector.x), 0, Math.PI * 2);
    ctx.fill();
    drawGustFronts(ctx, origin, vector, radius, t);
    ctx.fillStyle = speedColor(rec.speed);
    const streaks = motion ? (specks[site.id] || []) : Array.from({ length: 6 }, (_, index) => ({
      along: (index - 2.5) * radius * 0.22,
      across: ((index % 2) - 0.5) * radius * 0.28,
      span: 0.9,
      bulk: 2.4,
    }));
    streaks.forEach((speck) => {
      const x = origin.x + vector.x * speck.along - vector.y * speck.across;
      const y = origin.y + vector.y * speck.along + vector.x * speck.across;
      if ((x - origin.x) ** 2 + (y - origin.y) ** 2 > radius * radius) return;
      const len = (12 + 26 * t) * (speck.span || 1);
      ctx.globalAlpha = 0.78;
      paintStreak(ctx, x, y, vector.x, vector.y, len, speck.bulk || 2.6);
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(x + vector.x * 3, y + vector.y * 3, 1.7, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  });
}

function traceRing(ctx) {
  ctx.beginPath();
  ring.forEach((point, index) => {
    const spot = project(point[0], point[1]);
    if (index) ctx.lineTo(spot.x, spot.y);
    else ctx.moveTo(spot.x, spot.y);
  });
  ctx.closePath();
}

const FACETS = [
  ["#10261e", "#163028", "#1c3a2c"],
  ["#1a4a34", "#226044", "#2c6a4a"],
  ["#3c784c", "#4a8858", "#5a9864"],
  ["#12383a", "#1a4848", "#245656"],
  ["#2a5438", "#346444", "#3e744e"],
];
let landCanvas = null;
let landKey = "";
let mesh = null;

function unitRand(n) {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function circumcircle(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-14) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
}

function delaunay(points) {
  const vs = points.map((point) => ({ x: point[0], y: point[1] }));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  vs.forEach((point) => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  });
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const base = vs.length;
  vs.push(
    { x: midX - span * 6, y: midY - span * 4 },
    { x: midX, y: midY + span * 10 },
    { x: midX + span * 6, y: midY - span * 4 }
  );
  const tris = [{ i: base, j: base + 1, k: base + 2 }];
  function insideCircle(tri, point) {
    const center = circumcircle(vs[tri.i], vs[tri.j], vs[tri.k]);
    if (!center) return false;
    const reach = (vs[tri.i].x - center.x) ** 2 + (vs[tri.i].y - center.y) ** 2;
    return (point.x - center.x) ** 2 + (point.y - center.y) ** 2 <= reach * 1.000001;
  }
  for (let index = 0; index < base; index += 1) {
    const point = vs[index];
    const cavity = [];
    const keep = [];
    tris.forEach((tri) => (insideCircle(tri, point) ? cavity : keep).push(tri));
    const edges = [];
    cavity.forEach((tri) => {
      [[tri.i, tri.j], [tri.j, tri.k], [tri.k, tri.i]].forEach((edge) => {
        const twin = edges.findIndex((item) => (item[0] === edge[1] && item[1] === edge[0]));
        if (twin >= 0) edges.splice(twin, 1);
        else edges.push(edge);
      });
    });
    tris.length = 0;
    keep.forEach((tri) => tris.push(tri));
    edges.forEach((edge) => tris.push({ i: edge[0], j: edge[1], k: index }));
  }
  return tris
    .filter((tri) => tri.i < base && tri.j < base && tri.k < base)
    .map((tri) => [points[tri.i], points[tri.j], points[tri.k]]);
}

function buildMesh() {
  const step = 0.017;
  const points = [];
  ring.forEach((point, index) => {
    if (index % 3 === 0) points.push(point);
  });
  let row = 0;
  for (let lat = view.minY - step; lat <= view.maxY + step; lat += step * 0.82) {
    const slide = (row % 2) * step * 0.5;
    let col = 0;
    for (let lon = view.minX - step; lon <= view.maxX + step; lon += step) {
      const jx = (unitRand(row * 80 + col) - 0.5) * step * 0.7;
      const jy = (unitRand(row * 80 + col + 19) - 0.5) * step * 0.7;
      const point = [lon + slide + jx, lat + jy];
      if (inside(point[0], point[1])) points.push(point);
      col += 1;
    }
    row += 1;
  }
  return delaunay(points).filter((tri) => {
    const lon = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
    const lat = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
    return inside(lon, lat);
  });
}

function facetFill(lon, lat) {
  const hill = Math.sin(lon * 36.4 + 0.6) * 0.55 + Math.cos(lat * 48.2) * 0.45;
  const band = Math.max(0, Math.min(FACETS.length - 1, Math.floor(((hill + 1) / 2) * FACETS.length)));
  const family = FACETS[band];
  const pick = Math.abs(Math.sin(lon * 97 + lat * 63));
  return family[Math.floor(pick * family.length) % family.length];
}

function drawTerrain(ctx) {
  if (!mesh) mesh = buildMesh();
  const key = `${Math.round(width())}x${Math.round(height())}|${cam.zoom.toFixed(3)}|${cam.lon.toFixed(4)}|${cam.lat.toFixed(4)}`;
  if (!landCanvas || landKey !== key) {
    landKey = key;
    if (!landCanvas) landCanvas = document.createElement("canvas");
    landCanvas.width = Math.max(2, Math.round(width()));
    landCanvas.height = Math.max(2, Math.round(height()));
    const paper = landCanvas.getContext("2d");
    paper.lineJoin = "round";
    mesh.forEach((tri) => {
      const spots = tri.map((point) => project(point[0], point[1]));
      const lon = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
      const lat = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      paper.beginPath();
      spots.forEach((spot, index) => (index ? paper.lineTo(spot.x, spot.y) : paper.moveTo(spot.x, spot.y)));
      paper.closePath();
      paper.fillStyle = facetFill(lon, lat);
      paper.fill();
      paper.strokeStyle = "rgba(8, 18, 14, 0.45)";
      paper.lineWidth = 0.8;
      paper.stroke();
    });
  }
  ctx.drawImage(landCanvas, 0, 0, width(), height());
}

function paintCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const w = width();
  const h = height();
  if (w < 2 || h < 2) return;
  applyCamera();
  const bw = Math.round(w * ratio);
  const bh = Math.round(h * ratio);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#07080c";
  ctx.fillRect(0, 0, w, h);
  if (!ring.length) return;
  traceRing(ctx);
  ctx.save();
  ctx.clip();
  drawTerrain(ctx);
  drawFlows(ctx);
  ctx.restore();
  traceRing(ctx);
  ctx.strokeStyle = "#d7e7c8";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function placeMarkers() {
  stations.forEach((site) => {
    const node = markers[site.id];
    if (!node) return;
    const spot = project(site.lon, site.lat);
    node.hit.style.left = `${spot.x}px`;
    node.hit.style.top = `${spot.y}px`;
  });
  markersDirty = false;
  if (openId) {
    const site = stations.find((item) => item.id === openId);
    if (site) showTip(site);
  }
}

function paintAll() {
  keepViewInside();
  paintCanvas();
  placeMarkers();
}

function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function frame(now) {
  if (!motion || document.hidden) {
    raf = 0;
    return;
  }
  const dt = Math.min(0.05, (now - lastTick) / 1000 || 0.016);
  lastTick = now;
  updateSpecks(dt);
  paintCanvas();
  raf = requestAnimationFrame(frame);
}

function startLoop() {
  if (raf || !motion || document.hidden) return;
  lastTick = performance.now();
  raf = requestAnimationFrame(frame);
}

function bindMarker(site) {
  const hit = document.createElement("button");
  hit.type = "button";
  hit.className = "mark";
  hit.innerHTML = PIN;
  markerRoot.append(hit);
  markers[site.id] = { hit };
  hit.addEventListener("click", (event) => {
    event.stopPropagation();
    if (openId === site.id) hideTip();
    else showTip(site);
  });
  const item = document.createElement("li");
  const phone = document.createElement("a");
  phone.dataset.station = site.id;
  item.append(phone);
  phoneRoot.append(item);
}

function bindControls() {
  prevButton.addEventListener("click", () => setDate(stepDate(selected, -1)));
  nextButton.addEventListener("click", () => setDate(stepDate(selected, 1)));
  frameButton.addEventListener("click", () => {
    frameStations();
    paintAll();
  });
  motionButton.addEventListener("click", () => {
    motion = !motion;
    syncMotionButton();
    if (motion && !document.hidden) {
      resetSpecks();
      startLoop();
    } else {
      stopLoop();
      stations.forEach((site) => { specks[site.id] = []; });
      paintAll();
    }
  });
  nearestButton.addEventListener("click", () => {
    if (nearestButton.dataset.date) setDate(nearestButton.dataset.date);
  });
  dateInput.addEventListener("change", () => {
    const value = dateInput.value;
    if (value) setDate(value);
  });
  canvas.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    panBy(event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX;
    drag.y = event.clientY;
    paintAll();
  });
  canvas.addEventListener("pointerup", () => {
    drag = null;
    canvas.style.cursor = "grab";
  });
  canvas.addEventListener("pointercancel", () => {
    drag = null;
    canvas.style.cursor = "grab";
  });
  canvas.addEventListener("wheel", (event) => {
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 80 : 1;
    const delta = event.deltaY * unit;
    if (!delta) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomBy(Math.exp(-delta * 0.0016), event.clientX - rect.left, event.clientY - rect.top);
    paintAll();
  }, { passive: false });
  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".mark") || event.target.closest(".tip")) return;
    hideTip();
  });
  window.addEventListener("resize", () => {
    markersDirty = true;
    paintAll();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopLoop();
      return;
    }
    if (motion) {
      resetSpecks();
      startLoop();
    } else {
      paintAll();
    }
  });
  if (typeof ResizeObserver !== "undefined") {
    const watcher = new ResizeObserver(() => {
      markersDirty = true;
      paintAll();
    });
    watcher.observe(stage);
  }
}

function boot(reserve, series) {
  wind = series;
  ring = reserve.ring || [];
  const xs = ring.map((point) => point[0]);
  const ys = ring.map((point) => point[1]);
  view.minX = Math.min(...xs);
  view.maxX = Math.max(...xs);
  view.minY = Math.min(...ys);
  view.maxY = Math.max(...ys);
  scaleMax = series.scale_max_ms || 1;
  datesWithData = series.dates_with_data || [];
  stations = (reserve.stations || []).map((site) => {
    const meta = series.stations[site.id] || {};
    return {
      id: site.id,
      lon: site.lon,
      lat: site.lat,
      name: meta.name || site.name,
      period: meta.period || ["0000-01-01", "0000-01-01"],
      days: meta.days || {},
    };
  });
  const flow = new Set();
  stations.forEach((site) => {
    const list = series.stations[site.id]?.vector_dates || [];
    list.forEach((iso) => flow.add(iso));
    bindMarker(site);
  });
  flowDates = Array.from(flow).sort();
  dateInput.min = series.archive_start;
  dateInput.max = series.archive_end;
  const legend = document.getElementById("map-legend");
  legend.replaceChildren();
  ["0", null, `${scaleMax} м/с`].forEach((text) => {
    const span = document.createElement("span");
    if (text == null) span.className = "ramp";
    else span.textContent = text;
    legend.append(span);
  });
  selected = series.open_date || datesWithData[datesWithData.length - 1] || series.archive_end;
  syncMotionButton();
  bindControls();
  updateChrome();
  requestAnimationFrame(() => {
    frameStations();
    applyCamera();
    resetSpecks();
    paintAll();
    if (motion) startLoop();
  });
}

Promise.all([
  fetch("/landing/map/reserve.json").then((response) => response.json()),
  fetch("/landing/map/wind.json").then((response) => response.json()),
]).then(([reserve, series]) => {
  boot(reserve, series);
}).catch(() => {
  const note = document.querySelector(".map-notes");
  if (note) {
    const row = document.createElement("p");
    row.textContent = "Не удалось прочитать архив ветра.";
    note.append(row);
  }
});
