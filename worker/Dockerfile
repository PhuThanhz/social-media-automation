FROM node:20-bookworm-slim
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

RUN npx playwright install --with-deps chromium

COPY . .

EXPOSE 3001
CMD ["node", "server.js"]
