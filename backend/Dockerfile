# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app
# better-sqlite3 为原生模块，Alpine(musl) 需要本地工具链编译
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
# 构建完成后裁剪开发依赖（better-sqlite3 属于生产依赖，会保留）
RUN npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# 持久化文件放在独立挂载点，由命名卷承载（不绑定到宿主任意/中文路径）
ENV DB_PATH=/data/relic-restore.db
ENV SEED_ON_BOOT=true
RUN mkdir -p /data && apk add --no-cache wget
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "dist/main.js"]
