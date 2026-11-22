FROM node:22-alpine

WORKDIR /app

COPY server.js index.html styles.css app.js ./
COPY fonts ./fonts
COPY assets ./assets
COPY landing/index.html landing/landing.css landing/landing.js landing/NOTICE.txt ./landing/
COPY landing/vendor ./landing/vendor
COPY landing/dashboard ./landing/dashboard
COPY landing/map ./landing/map

EXPOSE 8501

CMD ["node", "server.js"]
