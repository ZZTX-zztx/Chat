<<<<<<< HEAD
# Chat KV Worker - Cloudflare Worker + KV 聊天后端

## 部署步骤

### 1. 安装依赖
```bash
cd backend
npm install
```

### 2. 登录 Cloudflare
```bash
npx wrangler login
```

### 3. 创建 KV Namespace
```bash
npx wrangler kv:namespace create CHAT_KV
```

将输出中的 `id` 复制到 `wrangler.toml` 的 `kv_namespaces` 中。

### 4. 配置（可选）
编辑 `wrangler.toml`:
- `ROOM_ID`: 默认聊天室 ID
- `MAX_MESSAGES`: 单个房间最大保存消息数（超过自动清理旧消息）
- `API_KEY`: 可选，设置后所有请求需在 Header 携带 `x-api-key: <your-key>`

### 5. 本地调试
```bash
npm run dev
```
启动后访问 `http://localhost:8787/health` 验证健康状态。

### 6. 部署到 Cloudflare
```bash
npm run deploy
```

部署成功后会获得类似 `https://chat-kv-worker.your-subdomain.workers.dev` 的地址，将此地址填入 Android 应用的 `BASE_URL` 配置。

## API 文档

### 健康检查
```
GET /health
```

### 获取消息列表
```
GET /api/messages?room=default-room&limit=100&since=<timestamp>
```

### 发送消息
```
POST /api/messages
Content-Type: application/json
x-api-key: <your-key> (如果配置了 API_KEY)

{
  "sender": "用户名",
  "content": "消息内容",
  "roomId": "default-room" (可选)
}
```

### 删除消息
```
DELETE /api/messages/{messageId}
```
=======
# Chat KV Worker - Cloudflare Worker + KV 聊天后端

## 部署步骤

### 1. 安装依赖
```bash
cd backend
npm install
```

### 2. 登录 Cloudflare
```bash
npx wrangler login
```

### 3. 创建 KV Namespace
```bash
npx wrangler kv:namespace create CHAT_KV
```

将输出中的 `id` 复制到 `wrangler.toml` 的 `kv_namespaces` 中。

### 4. 配置（可选）
编辑 `wrangler.toml`:
- `ROOM_ID`: 默认聊天室 ID
- `MAX_MESSAGES`: 单个房间最大保存消息数（超过自动清理旧消息）
- `API_KEY`: 可选，设置后所有请求需在 Header 携带 `x-api-key: <your-key>`

### 5. 本地调试
```bash
npm run dev
```
启动后访问 `http://localhost:8787/health` 验证健康状态。

### 6. 部署到 Cloudflare
```bash
npm run deploy
```

部署成功后会获得类似 `https://chat-kv-worker.your-subdomain.workers.dev` 的地址，将此地址填入 Android 应用的 `BASE_URL` 配置。

## API 文档

### 健康检查
```
GET /health
```

### 获取消息列表
```
GET /api/messages?room=default-room&limit=100&since=<timestamp>
```

### 发送消息
```
POST /api/messages
Content-Type: application/json
x-api-key: <your-key> (如果配置了 API_KEY)

{
  "sender": "用户名",
  "content": "消息内容",
  "roomId": "default-room" (可选)
}
```

### 删除消息
```
DELETE /api/messages/{messageId}
```
>>>>>>> 32a88550df533920ad83140f53de09a8489b391c
