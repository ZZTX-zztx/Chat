# Chat Backend - Cloudflare Workers

这是Chat应用的Cloudflare Workers后端服务。

## 功能特性

- ✅ 健康检查端点
- ✅ 消息发送和接收
- ✅ 用户注册和登录
- ✅ 消息删除
- ✅ 通知系统
- ✅ CORS支持
- ✅ 使用KV存储持久化数据

## API端点

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/app-version` | 获取应用版本 |
| GET | `/api/messages?room=xxx&limit=200&since=0` | 获取消息列表 |
| POST | `/api/messages` | 发送消息 |
| DELETE | `/api/messages/{messageId}?room=xxx&sender=xxx` | 删除消息 |
| POST | `/api/login` | 用户登录 |
| POST | `/api/register` | 用户注册 |
| POST | `/api/notify` | 发送通知 |

## 部署步骤

### 1. 安装依赖

```bash
npm install -g wrangler
```

### 2. 登录Cloudflare

```bash
cd backend
npx wrangler login
```

### 3. 创建KV Namespace

```bash
npx wrangler kv:namespace create "Chat"
```

会返回类似：
```json
{ binding = "Chat", id = "your-kv-namespace-id" }
```

### 4. 更新wrangler.jsonc

将返回的ID填入 `wrangler.jsonc`：

```json
{
  "name": "chat",
  "main": "index.js",
  "compatibility_date": "2024-01-01",
  "kv_namespaces": [
    {
      "binding": "Chat",
      "id": "这里填入你的ID"
    }
  ]
}
```

### 5. 部署

```bash
npx wrangler deploy
```

成功后会显示：
```
Published chat (0.0.0.1)
  https://chat.xxxxx.workers.dev
```

### 6. 更新Android应用

将部署后的URL更新到Android应用：

1. 打开 `app/build.gradle.kts`
2. 修改 `BASE_URL` 为你的部署地址：
   ```kotlin
   buildConfigField("String", "BASE_URL", "\"https://你的部署地址.workers.dev/\"")
   ```
3. 重新构建应用

## 本地开发

```bash
cd backend
npx wrangler dev
```

这将在 `http://localhost:8787` 启动本地开发服务器。

## 数据存储

使用Cloudflare KV存储：
- `messages:{room}` - 房间消息列表（JSON数组）
- `user:{username}` - 用户数据
- `session:{token}` - 用户会话
- `notifications:{timestamp}` - 通知数据

## 注意事项

- 每个房间最多保存1000条消息
- 会话有效期30天
- 通知数据1小时后自动过期