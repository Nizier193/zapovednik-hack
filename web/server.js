const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const weatherBackend = new URL(process.env.METEO_BACKEND_URL || 'http://backend:8080');
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

function send(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    const type = types[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

function inside(file, base) {
  const rel = path.relative(base, file);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function proxyWeather(req, res) {
  const headers = { ...req.headers, host: weatherBackend.host };
  const upstream = http.request(weatherBackend, {
    method: req.method,
    path: req.url,
    headers,
  }, response => {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
  });
  upstream.on('error', () => {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ detail: 'Сервис метеоархива недоступен.' }));
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/api/weather/')) { proxyWeather(req, res); return; }
  if (pathname === "/dashboard" || pathname === "/dashboard/") {
    res.writeHead(302, { Location: "/archive" });
    res.end();
    return;
  }
  let rel = pathname;
  if (rel === "/") rel = "/index.html";
  if (rel === "/landing" || rel === "/landing/") rel = "/landing/index.html";
  if (rel === "/landing/dashboard" || rel === "/landing/dashboard/") rel = "/landing/dashboard/index.html";
  if (rel === "/archive" || rel === "/archive/") rel = "/archive/index.html";
  const file = path.normalize(path.join(root, rel));
  if (!inside(file, root)) {
    res.writeHead(403);
    res.end();
    return;
  }
  send(res, file);
});

const port = Number(process.env.WEB_PORT || 8501);
server.listen(port, process.env.WEB_HOST || '0.0.0.0', () => {
  console.log(`web listening on ${port}`);
});
