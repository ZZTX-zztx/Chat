const ALLOWED_ORIGINS = ["*"];
const MAX_CONTENT_LENGTH = 4000;
const DEFAULT_LIMIT = 100;

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

    const apiKey = env.API_KEY || "";
    if (apiKey) {
      const provided = request.headers.get("x-api-key") || request.headers.get("Authorization")?.replace("Bearer ", "");
      if (provided !== apiKey) {
        return jsonResponse(401, { ok: false, error: "Unauthorized" }, origin);
      }
    }

    const roomId = (url.searchParams.get("room") || env.ROOM_ID || "default").trim().slice(0, 64);
    const safeRoomId = roomId.replace(/[^a-zA-Z0-9_-]/g, "-");
    const prefix = `msg:${safeRoomId}:`;

    try {
      if (path === "/health" || path === "/") {
        if (request.method === "GET") {
          return jsonResponse(200, {
            ok: true,
            service: "chat-kv-worker",
            room: safeRoomId,
            kv_bound: !!env.CHAT_KV,
          }, origin);
        }
      }

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
  const cursor = url.searchParams.get("cursor");

  const kv = env.CHAT_KV;
  const listOpts = { prefix, limit: limit + 50 };
  if (cursor) listOpts.cursor = cursor;

  const list = await kv.list(listOpts);
  const keys = list.keys || [];

  const sortedKeys = keys
    .map((k) => k.name)
    .sort();

  const sliceKeys = sortedKeys.slice(-limit);
  if (sliceKeys.length === 0) {
    return jsonResponse(200, {
      ok: true,
      room: safeRoomId,
      messages: [],
      count: 0,
      totalKeys: keys.length,
      cursor: list.cursor,
      list_complete: list.list_complete,
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

  return jsonResponse(200, {
    ok: true,
    room: safeRoomId,
    messages: filtered,
    count: filtered.length,
    totalKeys: keys.length,
    cursor: list.cursor,
    list_complete: list.list_complete,
  }, origin);
}

async function getMany(kv, keys) {
  const promises = keys.map((k) => kv.get(k, { type: "text" }));
  return Promise.all(promises);
}

async function sendMessage(request, env, ctx, prefix, safeRoomId, origin) {
  let body;
  try {
    body = await request.json();
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
  const key = `${prefix}${timestamp.toString().padStart(16, "0")}_${id.slice(0, 8)}`;

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

  if (env.MAX_MESSAGES) {
    ctx.waitUntil((async () => {
      const max = parseInt(env.MAX_MESSAGES, 10);
      const list = await env.CHAT_KV.list({ prefix, limit: max + 200 });
      const keys = list.keys.map((k) => k.name).sort();
      if (keys.length > max) {
        const toDelete = keys.slice(0, keys.length - max);
        const batchSize = 100;
        for (let i = 0; i < toDelete.length; i += batchSize) {
          const batch = toDelete.slice(i, i + batchSize);
          await env.CHAT_KV.delete(batch);
        }
      }
    })());
  }

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

  const list = await env.CHAT_KV.list({ prefix });
  const found = list.keys.find((k) => k.name.endsWith(`_${id.slice(0, 8)}`) || k.name.includes(id));
  if (!found) {
    return jsonResponse(404, { ok: false, error: "Message not found" }, origin);
  }

  const raw = await env.CHAT_KV.get(found.name, { type: "text" });
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

  await env.CHAT_KV.delete(found.name);
  return jsonResponse(200, { ok: true, deletedId: id }, origin);
}
