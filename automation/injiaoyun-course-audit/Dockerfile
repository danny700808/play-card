FROM mcr.microsoft.com/playwright:v1.61.0-noble
WORKDIR /app
COPY package.json index.js ./
RUN npm install --omit=dev
CMD ["node", "index.js"]
