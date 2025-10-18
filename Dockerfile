# Dockerfile para Cloud Run (Node 20)
FROM node:20-slim

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY server-denuncias.js ./

# Cloud Run pasa PORT; escuchamos en 8080 si no viene
ENV PORT=8080

CMD ["node", "server-denuncias.js"]
