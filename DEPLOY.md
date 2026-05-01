# 🚀 部署到 Cloudflare Workers

## 📋 部署步骤

### 1️⃣ 注册 Cloudflare 账号

访问：https://dash.cloudflare.com/sign-up
- 点击 "Sign up"
- 输入邮箱和密码
- 完成邮箱验证

### 2️⃣ 安装 Wrangler CLI

在命令行中运行：
```cmd
npm install -g wrangler
```

### 3️⃣ 登录 Cloudflare

```cmd
cd e:\ZZTX\Android\Example\GitHub\Chat
npx wrangler login
```

- 浏览器会打开
- 点击 "Allow" 授权

### 4️⃣ 创建 KV Namespace

```cmd
npx wrangler kv:namespace create "Chat"
```

会返回类似：
```
{ binding = "Chat", id = "3f48e77d245f41bfa2fbc1852bf7c98b" }
```

### 5️⃣ 更新 wrangler.jsonc

编辑 `wrangler.jsonc`，将返回的 id 填入：
```json
{
  "name": "chat",
  "main": "index.js",
  "compatibility_date": "2026-05-01",
  "kv_namespaces": [
    {
      "binding": "Chat",
      "id": "这里填入你的ID"
    }
  ]
}
```

### 6️⃣ 部署

```cmd
npx wrangler deploy
```

成功后会显示：
```
Published chat (0.0.0.1)
  https://chat.xxxxx.workers.dev
```

### 7️⃣ 更新应用 API 地址

在 Android Studio 中：
1. 打开 `app/src/main/java/com/zztx/myapplication/api/ApiClient.kt`
2. 将 `CLOUD_SERVER_URL` 改为部署后的地址：
   ```kotlin
   const val CLOUD_SERVER_URL = "https://你的部署地址.workers.dev"
   ```

### 8️⃣ 重新构建应用

```
Build → Rebuild Project
Run 安装到手机
```

---

## 🎉 完成！

部署成功后，您的应用就可以：
- ✅ 全球任何地方访问
- ✅ 不需要本地运行服务器
- ✅ 不需要关闭防火墙
- ✅ 数据永久保存

---

## 🔧 如果遇到问题

### 问题：wrangler login 无法打开浏览器
解决：在浏览器中手动访问显示的链接

### 问题：部署失败
解决：检查 `wrangler.jsonc` 中的 KV namespace id 是否正确

### 问题：手机上无法连接
解决：确认 Cloudflare Workers URL 是否正确，并重新构建应用

---

## 📱 应用流程

1. **启动界面** → 渐显"Hello"渐隐
2. **设置头像** → 选择头像
3. **设置昵称** → 输入昵称
4. **进入聊天** → 匿名聊天开始！
