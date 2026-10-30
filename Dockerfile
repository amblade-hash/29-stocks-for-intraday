FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY config ./config
ENV DATA_DIR=/app/data
VOLUME /app/data
CMD ["node", "--env-file-if-exists=.env", "src/index.js"]
