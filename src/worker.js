const ALLOWED_ORIGINS = ["*"];
const MAX_CONTENT_LENGTH = 15_000_000;
const MAX_REQUEST_BODY_BYTES = 18 * 1024 * 1024;
const DEFAULT_LIMIT = 100;
const TOKEN_EXPIRE_SECONDS = 86400;
const PBKDF2_ITERATIONS = 100000;

function corsHeaders(origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Cache-Control": "no-store",
  };
  return headers;
}

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function generateSalt() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  const saltBytes = encoder.encode(salt);
  
  const key = await crypto.subtle.importKey(
    "raw",
    passwordBytes,
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function validateToken(kv, token) {
  if (!token) return null;
  const key = `token:${token}`;
  const raw = await kv.get(key, { type: "text" });
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data.expiresAt < Date.now()) {
      await kv.delete(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function jsonResponse(status, data, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(origin),
  });
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    if (request.method === "GET" && (path === "/health" || path === "/")) {
      const roomId = (url.searchParams.get("room") || env.ROOM_ID || "default").trim().slice(0, 64);
      return jsonResponse(200, {
        ok: true,
        service: "chat-kv-worker",
        room: roomId.replace(/[^a-zA-Z0-9_-]/g, "-"),
        kv_bound: !!env.CHAT_KV,
      }, origin);
    }

    if (request.method === "GET" && path === "/api/app-version") {
      return jsonResponse(200, {
        ok: true,
        versionCode: parseInt(env.APP_VERSION_CODE || "1", 10) || 1,
        versionName: env.APP_VERSION_NAME || "1.0.0",
        downloadUrl: env.APP_DOWNLOAD_URL || "",
        changelog: env.APP_CHANGELOG || "",
        forceUpdate: (env.APP_FORCE_UPDATE || "false").toString().toLowerCase() === "true",
        minSdkVersion: parseInt(env.APP_MIN_SDK || "24", 10) || 24,
      }, origin);
    }

    if (request.method === "GET" && path === "/api/win-version") {
      return jsonResponse(200, {
        ok: true,
        versionCode: parseInt(env.WIN_VERSION_CODE || "1", 10) || 1,
        versionName: env.WIN_VERSION_NAME || "1.0.0",
        downloadUrl: env.WIN_DOWNLOAD_URL || "",
        changelog: env.WIN_CHANGELOG || "",
        forceUpdate: (env.WIN_FORCE_UPDATE || "false").toString().toLowerCase() === "true",
      }, origin);
    }

    if (request.method === "POST" && path === "/api/register") {
      return await handleRegister(request, env, origin);
    }

    if (request.method === "POST" && path === "/api/login") {
      return await handleLogin(request, env, origin);
    }

    let currentUser = null;
    const token = request.headers.get("Authorization")?.replace("Bearer ", "");
    if (token) {
      const tokenData = await validateToken(env.CHAT_KV, token);
      if (tokenData) {
        currentUser = tokenData.username;
      }
    }

    const apiKey = env.API_KEY || "";
    if (apiKey) {
      const provided = request.headers.get("x-api-key") || request.headers.get("Authorization")?.replace("Bearer ", "");
      if (provided !== apiKey && !currentUser) {
        return jsonResponse(401, { ok: false, error: "Unauthorized" }, origin);
      }
    }

    const roomId = (url.searchParams.get("room") || env.ROOM_ID || "default").trim().slice(0, 64);
    const safeRoomId = roomId.replace(/[^a-zA-Z0-9_-]/g, "-");
    const prefix = `msg:${safeRoomId}:`;

    try {
      if (path === "/api/messages" || path === "/messages") {
        if (request.method === "GET") {
          return await getMessages(request, env, ctx, prefix, safeRoomId, origin);
        }
        if (request.method === "POST") {
          return await sendMessage(request, env, ctx, prefix, safeRoomId, origin);
        }
      }

      if (path.startsWith("/api/messages/")) {
        const id = path.split("/api/messages/")[1];
        if (request.method === "DELETE") {
          return await deleteMessage(request, env, ctx, prefix, id, origin);
        }
      }

      return jsonResponse(404, { ok: false, error: "Not Found" }, origin);
    } catch (err) {
      console.error(err);
      return jsonResponse(500, { ok: false, error: err.message || "Internal Server Error" }, origin);
    }
  },
};

async function getMessages(request, env, ctx, prefix, safeRoomId, origin) {
  const url = new URL(request.url);
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") || DEFAULT_LIMIT, 10),
    parseInt(env.MAX_MESSAGES || DEFAULT_LIMIT, 10) || DEFAULT_LIMIT
  );
  const since = url.searchParams.get("since");

  const kv = env.CHAT_KV;
  const indexKey = `${prefix}index`;

  const indexRaw = await kv.get(indexKey, { type: "text" });
  let messageIds = [];
  if (indexRaw) {
    try {
      messageIds = JSON.parse(indexRaw);
    } catch {
      messageIds = [];
    }
  }

  if (messageIds.length === 0) {
    let list, keys, sortedKeys, sliceKeys;
    try {
      list = await kv.list({ prefix, limit: limit + 50 });
      keys = list.keys || [];
      sortedKeys = keys.map((k) => k.name).sort();
      sliceKeys = sortedKeys.slice(-limit);
    } catch (err) {
      console.error("KV list failed:", err);
      return jsonResponse(200, {
        ok: true,
        room: safeRoomId,
        messages: [],
        count: 0,
        totalKeys: 0,
        cursor: null,
        list_complete: true,
        error: "KV list temporarily unavailable, messages will be restored when new messages are sent",
      }, origin);
    }
    
    if (sliceKeys.length === 0) {
      return jsonResponse(200, {
        ok: true,
        room: safeRoomId,
        messages: [],
        count: 0,
        totalKeys: 0,
        cursor: null,
        list_complete: true,
      }, origin);
    }

    const result = await getMany(kv, sliceKeys);
    const messages = result
      .filter((m) => m)
      .map((raw) => {
        try {
          return typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const filtered = since ? messages.filter((m) => (m.timestamp || 0) > parseInt(since, 10)) : messages;

    ctx.waitUntil((async () => {
      try {
        const allList = await kv.list({ prefix, limit: 1000 });
        const allKeys = allList.keys || [];
        const ids = [];
        for (const k of allKeys) {
          if (k.name !== indexKey) {
            const raw = await kv.get(k.name, { type: "text" });
            try {
              const msg = JSON.parse(raw);
              if (msg && msg.id) {
                ids.push(msg.id);
              }
            } catch {
            }
          }
        }
        ids.sort();
        await kv.put(indexKey, JSON.stringify(ids));
      } catch (err) {
        console.error("Index building failed:", err);
      }
    })());

    return jsonResponse(200, {
      ok: true,
      room: safeRoomId,
      messages: filtered,
      count: filtered.length,
      totalKeys: messages.length,
      cursor: null,
      list_complete: true,
    }, origin);
  }

  const sliceIds = messageIds.slice(-limit);
  const keys = sliceIds.map(id => `${prefix}${id}`);
  
  const result = await getMany(kv, keys);
  const messages = result
    .filter((m) => m)
    .map((raw) => {
      try {
        return typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const filtered = since ? messages.filter((m) => (m.timestamp || 0) > parseInt(since, 10)) : messages;

  return jsonResponse(200, {
    ok: true,
    room: safeRoomId,
    messages: filtered,
    count: filtered.length,
    totalKeys: messageIds.length,
    cursor: null,
    list_complete: true,
  }, origin);
}

async function getMany(kv, keys) {
  const promises = keys.map((k) => kv.get(k, { type: "text" }));
  return Promise.all(promises);
}

async function sendMessage(request, env, ctx, prefix, safeRoomId, origin) {
  const clHeader = request.headers.get("Content-Length");
  if (clHeader) {
    const cl = parseInt(clHeader, 10);
    if (!Number.isNaN(cl) && cl > MAX_REQUEST_BODY_BYTES) {
      return new Response(
        JSON.stringify({ ok: false, error: `请求体过大，最大 ${MAX_REQUEST_BODY_BYTES} 字节` }),
        { status: 413, headers: corsHeaders(origin) }
      );
    }
  }
  const rawBuffer = await request.arrayBuffer();
  if (rawBuffer.byteLength > MAX_REQUEST_BODY_BYTES) {
    return new Response(
      JSON.stringify({ ok: false, error: `请求体过大，最大 ${MAX_REQUEST_BODY_BYTES} 字节` }),
      { status: 413, headers: corsHeaders(origin) }
    );
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8").decode(rawBuffer));
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON body" }, origin);
  }

  const sender = (body.sender || body.username || "匿名用户").toString().trim().slice(0, 40);
  const content = (body.content || body.text || "").toString().trim();

  if (!content) {
    return jsonResponse(400, { ok: false, error: "消息内容不能为空" }, origin);
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return jsonResponse(400, { ok: false, error: `消息过长，最大 ${MAX_CONTENT_LENGTH} 字符` }, origin);
  }

  const timestamp = Date.now();
  const id = uuid();
  const key = `${prefix}${id}`;

  const message = {
    id,
    roomId: safeRoomId,
    sender: sender || "匿名用户",
    content,
    timestamp,
    createdAt: new Date(timestamp).toISOString(),
  };

  await env.CHAT_KV.put(key, JSON.stringify(message), {
    metadata: { t: timestamp, s: sender.slice(0, 20), r: safeRoomId },
  });

  const indexKey = `${prefix}index`;
  const indexRaw = await env.CHAT_KV.get(indexKey, { type: "text" });
  let messageIds = [];
  if (indexRaw) {
    try {
      messageIds = JSON.parse(indexRaw);
    } catch {
      messageIds = [];
    }
  }
  messageIds.push(id);

  if (env.MAX_MESSAGES) {
    const max = parseInt(env.MAX_MESSAGES, 10);
    if (messageIds.length > max) {
      const toDeleteIds = messageIds.slice(0, messageIds.length - max);
      const toDeleteKeys = toDeleteIds.map(delId => `${prefix}${delId}`);
      await env.CHAT_KV.delete(toDeleteKeys);
      messageIds = messageIds.slice(-max);
    }
  }

  await env.CHAT_KV.put(indexKey, JSON.stringify(messageIds));

  return jsonResponse(201, { ok: true, message }, origin);
}

const RECALL_WINDOW_MS = 30 * 1000;

async function deleteMessage(request, env, ctx, prefix, id, origin) {
  if (!id) {
    return jsonResponse(400, { ok: false, error: "Missing message id" }, origin);
  }

  const url = new URL(request.url);
  const requester = (url.searchParams.get("sender") || "").toString().trim();
  if (!requester) {
    return jsonResponse(400, { ok: false, error: "Missing requester sender" }, origin);
  }

  const indexKey = `${prefix}index`;
  const indexRaw = await env.CHAT_KV.get(indexKey, { type: "text" });
  let messageIds = [];
  if (indexRaw) {
    try {
      messageIds = JSON.parse(indexRaw);
    } catch {
      messageIds = [];
    }
  }

  const foundIndex = messageIds.indexOf(id);
  if (foundIndex === -1) {
    return jsonResponse(404, { ok: false, error: "Message not found" }, origin);
  }

  const messageKey = `${prefix}${id}`;
  const raw = await env.CHAT_KV.get(messageKey, { type: "text" });
  let message = null;
  try {
    message = raw ? JSON.parse(raw) : null;
  } catch {
    message = null;
  }
  if (!message) {
    return jsonResponse(404, { ok: false, error: "Message not found" }, origin);
  }

  if (message.sender !== requester) {
    return jsonResponse(403, { ok: false, error: "仅发送者可撤回该消息" }, origin);
  }

  const ts = message.timestamp || 0;
  const now = Date.now();
  if (now - ts > RECALL_WINDOW_MS) {
    return jsonResponse(410, { ok: false, error: "超过30秒撤回时限" }, origin);
  }

  await env.CHAT_KV.delete(messageKey);
  
  messageIds.splice(foundIndex, 1);
  await env.CHAT_KV.put(indexKey, JSON.stringify(messageIds));

  return jsonResponse(200, { ok: true, deletedId: id }, origin);
}

async function handleRegister(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON body" }, origin);
  }

  const username = (body.username || "").toString().trim();
  const password = (body.password || "").toString();

  if (!username) {
    return jsonResponse(400, { ok: false, error: "用户名不能为空" }, origin);
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return jsonResponse(400, { ok: false, error: "用户名必须由3-20个字母、数字或下划线组成" }, origin);
  }
  if (!password) {
    return jsonResponse(400, { ok: false, error: "密码不能为空" }, origin);
  }
  if (password.length < 6) {
    return jsonResponse(400, { ok: false, error: "密码至少需要6位" }, origin);
  }

  const kv = env.CHAT_KV;
  const userKey = `user:${username}`;
  const existing = await kv.get(userKey, { type: "text" });

  if (existing) {
    return jsonResponse(409, { ok: false, error: "用户名已存在" }, origin);
  }

  const salt = await generateSalt();
  const hash = await hashPassword(password, salt);

  const userData = {
    username,
    passwordHash: hash,
    salt,
    createdAt: Date.now(),
  };

  await kv.put(userKey, JSON.stringify(userData));

  const token = uuid();
  const tokenKey = `token:${token}`;
  const tokenData = {
    username,
    expiresAt: Date.now() + TOKEN_EXPIRE_SECONDS * 1000,
  };
  await kv.put(tokenKey, JSON.stringify(tokenData));

  return jsonResponse(201, {
    ok: true,
    message: "注册成功",
    token,
    username,
    expiresAt: tokenData.expiresAt,
  }, origin);
}

async function handleLogin(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON body" }, origin);
  }

  const username = (body.username || "").toString().trim();
  const password = (body.password || "").toString();

  if (!username || !password) {
    return jsonResponse(400, { ok: false, error: "用户名或密码不能为空" }, origin);
  }

  const kv = env.CHAT_KV;
  const userKey = `user:${username}`;
  const raw = await kv.get(userKey, { type: "text" });

  if (!raw) {
    return jsonResponse(401, { ok: false, error: "用户名或密码错误" }, origin);
  }

  let userData;
  try {
    userData = JSON.parse(raw);
  } catch {
    return jsonResponse(500, { ok: false, error: "服务器错误" }, origin);
  }

  const hash = await hashPassword(password, userData.salt);

  if (hash !== userData.passwordHash) {
    return jsonResponse(401, { ok: false, error: "用户名或密码错误" }, origin);
  }

  const token = uuid();
  const tokenKey = `token:${token}`;
  const tokenData = {
    username,
    expiresAt: Date.now() + TOKEN_EXPIRE_SECONDS * 1000,
  };
  await kv.put(tokenKey, JSON.stringify(tokenData));

  return jsonResponse(200, {
    ok: true,
    message: "登录成功",
    token,
    username,
    expiresAt: tokenData.expiresAt,
  }, origin);
}
