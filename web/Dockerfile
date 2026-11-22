FROM node:22-alpine

WORKDIR /app

COPY server.js index.html styles.css app.js ./
COPY fonts ./fonts
COPY assets ./assets

EXPOSE 8501

CMD ["node", "server.js"]
