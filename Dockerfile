FROM node:18-slim

# FFmpeg انسٽال ڪريو
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies ڪاپي ۽ انسٽال ڪريو
COPY package*.json ./
RUN npm install

# باقائي ڪوڊ ڪاپي ڪريو
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
