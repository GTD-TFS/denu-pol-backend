# Dockerfile (raíz del repo)
FROM node:20-slim

WORKDIR /app

# Copia e instala deps
COPY package*.json ./
RUN npm install --omit=dev --silent

# Copia el código
COPY . .

# Cloud Run usa PORT; por defecto 8080
ENV PORT=8080
EXPOSE 8080

# Si tu fichero principal es server.js, deja esto así:
CMD ["node", "server-denuncias.js"]
