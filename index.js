export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/register' && request.method === 'POST') {
      return await registerUser(request, env);
    }

    if (path === '/api/login' && request.method === 'POST') {
      return await loginUser(request, env);
    }

    if (path === '/api/messages' && request.method === 'GET') {
      return await getMessages(request, env);
    }

    if (path === '/api/messages' && request.method === 'POST') {
      return await sendMessage(request, env);
    }

    if (path === '/api/anonymous/messages' && request.method === 'GET') {
      return await getAnonymousMessages(request, env);
    }

    if (path === '/api/anonymous/messages' && request.method === 'POST') {
      return await sendAnonymousMessage(request, env);
    }

    if (path === '/api/ws') {
      return await handleWebSocket(request, env);
    }

    return new Response('Not Found', { status: 404 });
  }
};

async function registerUser(request, env) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return new Response(JSON.stringify({ error: 'Username and password required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const existingUser = await env.Chat.get(`user:${username}`);
    if (existingUser) {
      return new Response(JSON.stringify({ error: 'Username already exists' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const userId = crypto.randomUUID();
    const userData = {
      id: userId,
      username,
      password: await hashPassword(password),
      createdAt: new Date().toISOString()
    };

    await env.Chat.put(`user:${username}`, JSON.stringify(userData));
    await env.Chat.put(`userid:${userId}`, JSON.stringify(userData));

    return new Response(JSON.stringify({ success: true, userId }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function loginUser(request, env) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return new Response(JSON.stringify({ error: 'Username and password required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const userData = await env.Chat.get(`user:${username}`);
    if (!userData) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const user = JSON.parse(userData);
    const passwordValid = await verifyPassword(password, user.password);

    if (!passwordValid) {
      return new Response(JSON.stringify({ error: 'Invalid password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const token = crypto.randomUUID();
    await env.Chat.put(`token:${token}`, JSON.stringify({ userId: user.id, username: user.username }), { expirationTtl: 86400 });

    return new Response(JSON.stringify({ success: true, token, userId: user.id, username: user.username }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function getMessages(request, env) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return new Response(JSON.stringify({ error: 'Token required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const tokenData = await env.Chat.get(`token:${token}`);
    if (!tokenData) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const messagesList = await env.Chat.list({ prefix: 'msg:' });
    const messages = [];

    for (const key of messagesList.keys) {
      const msgData = await env.Chat.get(key.name);
      if (msgData) {
        messages.push(JSON.parse(msgData));
      }
    }

    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return new Response(JSON.stringify({ messages }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function sendMessage(request, env) {
  try {
    const body = await request.json();
    const { token, text } = body;

    if (!token || !text) {
      return new Response(JSON.stringify({ error: 'Token and text required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const tokenData = await env.Chat.get(`token:${token}`);
    if (!tokenData) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { userId, username } = JSON.parse(tokenData);
    const messageId = crypto.randomUUID();
    const message = {
      id: messageId,
      userId,
      username,
      text,
      timestamp: new Date().toISOString()
    };

    await env.Chat.put(`msg:${messageId}`, JSON.stringify(message));

    return new Response(JSON.stringify({ success: true, message }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleWebSocket(request, env) {
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }

  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  server.accept();

  server.addEventListener('message', async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('Received:', data);
    } catch (error) {
      console.error('Error:', error);
    }
  });

  server.addEventListener('close', () => {
    console.log('WebSocket closed');
  });

  server.addEventListener('error', (error) => {
    console.error('WebSocket error:', error);
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, hash) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return computedHash === hash;
}

async function getAnonymousMessages(request, env) {
  try {
    const messagesList = await env.Chat.list({ prefix: 'anonymous_msg:' });
    const messages = [];

    for (const key of messagesList.keys) {
      const msgData = await env.Chat.get(key.name);
      if (msgData) {
        messages.push(JSON.parse(msgData));
      }
    }

    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return new Response(JSON.stringify({ messages }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function sendAnonymousMessage(request, env) {
  try {
    const body = await request.json();
    const { username, text } = body;

    if (!username || !text) {
      return new Response(JSON.stringify({ error: 'Username and text required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const messageId = crypto.randomUUID();
    const message = {
      id: messageId,
      userId: 'anonymous_' + crypto.randomUUID(),
      username,
      text,
      timestamp: new Date().toISOString()
    };

    await env.Chat.put(`anonymous_msg:${messageId}`, JSON.stringify(message));

    return new Response(JSON.stringify({ success: true, message }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
