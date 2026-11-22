const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === "/dashboard" || pathname === "/dashboard/") {
    res.writeHead(302, { Location: "/landing/dashboard" });
    res.end();
    return;
  }
  let rel = pathname;
  if (rel === "/") rel = "/index.html";
  if (rel === "/landing" || rel === "/landing/") rel = "/landing/index.html";
  if (rel === "/landing/dashboard" || rel === "/landing/dashboard/") rel = "/landing/dashboard/index.html";
  if (rel === "/landing/map" || rel === "/landing/map/") rel = "/landing/map/index.html";
  const file = path.normalize(path.join(root, rel));
  if (!inside(file, root)) {
    res.writeHead(403);
    res.end();
    return;
  }
  send(res, file);
});

server.listen(8501, "0.0.0.0", () => {
  console.log("web listening on 8501");
});
