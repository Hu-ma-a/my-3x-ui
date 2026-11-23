# ============================================================
# 3x-ui 独立用户门户 —— 生产镜像
#
# 门户是零 npm 依赖 + 零构建的 Node.js 应用：没有 npm install，
# 也没有前端构建阶段，镜像里只有 Node 运行时 + 源码。
#
# 构建上下文必须是 portal/ 目录（.dockerignore 也在这个目录）：
#   docker build -t 3x-ui-portal:1.0.0 portal/
# ============================================================

FROM node:24-alpine

# 运行期默认值；部署时用 -e / --env-file 覆盖。
# 容器内必须监听 0.0.0.0，否则宿主机端口映射进不来。
# PORTAL_DATA_DIR=/data：门户的「数据目录」（自动生成的 .secret 等）也落在数据卷里，
# 否则会尝试写 /app/data 而 node 用户没有权限；PORTAL_DB_PATH 显式指向数据卷。
ENV NODE_ENV=production \
    PORTAL_HOST=0.0.0.0 \
    PORTAL_PORT=8090 \
    PORTAL_DATA_DIR=/data \
    PORTAL_DB_PATH=/data/portal.db

WORKDIR /app

# 只复制运行所需文件（data/test/docs/deploy 已由 .dockerignore 排除）。
# 零依赖：不需要 package-lock.json，也不需要 npm install。
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts

# SQLite 数据目录：挂载数据卷后仍归 node 用户所有并可写
RUN mkdir -p /data && chown node:node /data

# 非 root 运行（node 镜像内置 uid/gid 1000 的 node 用户）
USER node

VOLUME ["/data"]
EXPOSE 8090

# 健康检查命中门户自己的 /api/health（见 docs/api-contract.md §3）。
# 注意：若修改 PORTAL_PORT，需同步修改这里的端口，或用 --health-cmd 覆盖。
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8090/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# package.json 的 start 脚本同样是 node --no-warnings server.js
CMD ["node", "--no-warnings", "server.js"]
