export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,x-api-key",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    function jsonResponse(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    function uuid() {
      return crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    async function hashPassword(pass, salt) {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", enc.encode(pass), { name: "PBKDF2" }, false, ["deriveKey"]);
      const derived = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" }, key, { name: "HMAC", hash: "SHA-256" }, true, ["sign"]);
      const raw = await crypto.subtle.exportKey("raw", derived);
      return Array.from(new Uint8Array(raw)).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    async function validateToken(auth) {
      if (!auth || !auth.startsWith("Bearer ")) return null;
      const token = auth.slice(7);
      const userRaw = await env.CHAT_KV.get(`token:${token}`);
      if (!userRaw) return null;
      const data = JSON.parse(userRaw);
      if (Date.now() > data.expire) {
        await env.CHAT_KV.delete(`token:${token}`);
        return null;
      }
      return data.username;
    }

    async function authCheck(req) {
      const auth = req.headers.get("Authorization");
      const apiKey = req.headers.get("x-api-key");
      if (apiKey && apiKey === env.API_KEY) return "api";
      const user = await validateToken(auth);
      return user;
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // 健康检测
    if (path === "/" || path === "/health") {
      return jsonResponse({ ok: true, service: "chat-worker" });
    }

    // 版本接口
    if (path === "/api/app-version") {
      return jsonResponse({ version: env.APP_VERSION, url: env.APP_DL, force: env.APP_FORCE === "1" });
    }
    if (path === "/api/win-version") {
      return jsonResponse({ version: env.WIN_VERSION, url: env.WIN_DL, force: env.WIN_FORCE === "1" });
    }

    // 注册
    if (path === "/api/register" && request.method === "POST") {
      const body = await request.json();
      const { username, password } = body;
      if (!username || !password || username.length > 32 || password.length < 4) return jsonResponse({ error: "参数非法" }, 400);
      const exist = await env.CHAT_KV.get(`user:${username}`);
      if (exist) return jsonResponse({ error: "用户名已存在" }, 400);
      const salt = uuid().slice(0,16);
      const pwHash = await hashPassword(password, salt);
      await env.CHAT_KV.put(`user:${username}`, JSON.stringify({ salt, hash: pwHash }));
      const token = uuid();
      const expire = Date.now() + 86400_000;
      await env.CHAT_KV.put(`token:${token}`, JSON.stringify({ username, expire }));
      return jsonResponse({ token, username });
    }

    // 登录
    if (path === "/api/login" && request.method === "POST") {
      const body = await request.json();
      const { username, password } = body;
      const userRaw = await env.CHAT_KV.get(`user:${username}`);
      if (!userRaw) return jsonResponse({ error: "账号不存在" },400);
      const { salt, hash } = JSON.parse(userRaw);
      const calc = await hashPassword(password, salt);
      if (calc !== hash) return jsonResponse({ error: "密码错误" },400);
      const token = uuid();
      const expire = Date.now() + 86400_000;
      await env.CHAT_KV.put(`token:${token}`, JSON.stringify({ username, expire }));
      return jsonResponse({ token, username });
    }

    // 获取消息 【核心修复点：移除kv.list降级！】
    if (path === "/api/messages" && request.method === "GET") {
      const user = await authCheck(request);
      if (!user) return jsonResponse({ error: "未登录" },401);
      const roomId = url.searchParams.get("room") || "default";
      const limit = parseInt(url.searchParams.get("limit")) || 50;
      const since = parseInt(url.searchParams.get("since")) || 0;

      const indexRaw = await env.CHAT_KV.get(`msg:${roomId}:index`);
      let msgIds = [];
      if (indexRaw) {
        try {
          msgIds = JSON.parse(indexRaw);
        }catch(e){
          msgIds = [];
        }
      }
      // 无索引时：不再调用KV.list！直接返回空列表
      if(msgIds.length === 0){
        return jsonResponse({ list: [] });
      }

      // 按时间筛选、分页
      const messages = [];
      for(const mid of msgIds.slice(-limit)){
        const raw = await env.CHAT_KV.get(`msg:${roomId}:${mid}`);
        if(!raw) continue;
        const m = JSON.parse(raw);
        if(m.time >= since) messages.push(m);
      }
      messages.sort((a,b)=>a.time - b.time);
      return jsonResponse({ list: messages });
    }

    // 发送消息
    if(path === "/api/messages" && request.method === "POST"){
      const user = await authCheck(request);
      if (!user) return jsonResponse({ error: "未登录" },401);
      const body = await request.json();
      const { room="default", content } = body;
      if(!content || content.length > 1000) return jsonResponse({error:"内容非法"},400);

      const msgId = uuid();
      const msgData = {
        id: msgId,
        room,
        sender: user,
        content,
        time: Date.now()
      };
      await env.CHAT_KV.put(`msg:${room}:${msgId}`, JSON.stringify(msgData));

      // 更新索引
      const indexKey = `msg:${room}:index`;
      let indexRaw = await env.CHAT_KV.get(indexKey);
      let ids = indexRaw ? JSON.parse(indexRaw) : [];
      ids.push(msgId);
      // 限制最大消息数量，防止索引无限膨胀
      const MAX_MSG = 200;
      if(ids.length > MAX_MSG){
        const removeIds = ids.slice(0, ids.length - MAX_MSG);
        for(const rid of removeIds){
          await env.CHAT_KV.delete(`msg:${room}:${rid}`);
        }
        ids = ids.slice(-MAX_MSG);
      }
      await env.CHAT_KV.put(indexKey, JSON.stringify(ids));
      return jsonResponse(msgData);
    }

    // 撤回消息
    if(path.match(/^\/api\/messages\/(.+)$/) && request.method === "DELETE"){
      const user = await authCheck(request);
      if (!user) return jsonResponse({ error: "未登录" },401);
      const msgId = path.split("/").pop();
      const room = url.searchParams.get("room") || "default";
      const msgRaw = await env.CHAT_KV.get(`msg:${room}:${msgId}`);
      if(!msgRaw) return jsonResponse({error:"消息不存在"},404);
      const msg = JSON.parse(msgRaw);
      if(msg.sender !== user) return jsonResponse({error:"无权撤回"},403);
      if(Date.now() - msg.time > 30*1000) return jsonResponse({error:"超出撤回时限"},400);

      await env.CHAT_KV.delete(`msg:${room}:${msgId}`);
      // 更新索引
      const indexKey = `msg:${room}:index`;
      const indexRaw = await env.CHAT_KV.get(indexKey);
      if(indexRaw){
        let ids = JSON.parse(indexRaw);
        ids = ids.filter(i=>i!==msgId);
        await env.CHAT_KV.put(indexKey, JSON.stringify(ids));
      }
      return jsonResponse({ok:true});
    }

    // 群聊接口（如果你不需要群聊，可以直接删掉这一段）
    if(path === "/api/groups" && request.method === "GET"){
      const user = await authCheck(request);
      if (!user) return jsonResponse({ error: "未登录" },401);
      const indexRaw = await env.CHAT_KV.get("groups:index");
      const groupIds = indexRaw ? JSON.parse(indexRaw) : [];
      const groups = [];
      for(const gid of groupIds){
        const graw = await env.CHAT_KV.get(`group:${gid}`);
        if(graw) groups.push(JSON.parse(graw));
      }
      return jsonResponse(groups);
    }
    if(path === "/api/groups" && request.method === "POST"){
      const user = await authCheck(request);
      if (!user) return jsonResponse({ error: "未登录" },401);
      const body = await request.json();
      const {name} = body;
      if(!name) return jsonResponse({error:"群名不能为空"},400);
      const gid = uuid();
      const groupData = {id:gid,name,creator:user,time:Date.now()};
      await env.CHAT_KV.put(`group:${gid}`, JSON.stringify(groupData));
      let indexRaw = await env.CHAT_KV.get("groups:index");
      let ids = indexRaw ? JSON.parse(indexRaw) : [];
      ids.push(gid);
      await env.CHAT_KV.put("groups:index", JSON.stringify(ids));
      return jsonResponse(groupData);
    }

    return jsonResponse({error:"接口不存在"},404);
  }
};