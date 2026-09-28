export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, Accept',
    };

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check endpoint
      if (path === '/health' || path === '/health/') {
        return handleHealth(env, corsHeaders);
      }

      // App version endpoint
      if (path === '/api/app-version' || path === '/api/app-version/') {
        return handleAppVersion(corsHeaders);
      }

      // Messages endpoints
      if (path === '/api/messages' || path === '/api/messages/') {
        if (method === 'GET') {
          return handleGetMessages(url, env, corsHeaders);
        }
        if (method === 'POST') {
          return handleSendMessage(request, url, env, corsHeaders);
        }
      }

      // Delete message endpoint
      const deleteMatch = path.match(/^\/api\/messages\/([^\/]+)$/);
      if (deleteMatch && method === 'DELETE') {
        const messageId = deleteMatch[1];
        return handleDeleteMessage(url, messageId, env, corsHeaders);
      }

      // Login endpoint
      if (path === '/api/login' || path === '/api/login/') {
        if (method === 'POST') {
          return handleLogin(request, env, corsHeaders);
        }
      }

      // Register endpoint
      if (path === '/api/register' || path === '/api/register/') {
        if (method === 'POST') {
          return handleRegister(request, env, corsHeaders);
        }
      }

      // Notify endpoint
      if (path === '/api/notify' || path === '/api/notify/') {
        if (method === 'POST') {
          return handleNotify(request, env, corsHeaders);
        }
      }

      // Return 404 for unknown routes
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

// Health check handler
async function handleHealth(env, corsHeaders) {
  const kvBound = env.Chat !== undefined;
  return new Response(JSON.stringify({
    ok: true,
    service: 'chat',
    room: 'default-room',
    kv_bound: kvBound
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// App version handler
async function handleAppVersion(corsHeaders) {
  return new Response(JSON.stringify({
    ok: true,
    version: '1.2.9',
    versionCode: 11,
    downloadUrl: '',
    updateMessage: ''
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Get messages handler
async function handleGetMessages(url, env, corsHeaders) {
  const room = url.searchParams.get('room') || 'default-room';
  const limit = parseInt(url.searchParams.get('limit')) || 200;
  const since = url.searchParams.get('since');

  const kvKey = `messages:${room}`;
  let messages = [];

  try {
    const stored = await env.Chat.get(kvKey);
    if (stored) {
      messages = JSON.parse(stored);
    }
  } catch (e) {
    messages = [];
  }

  // Filter messages since timestamp if provided
  if (since) {
    const sinceTime = parseInt(since);
    messages = messages.filter(msg => msg.timestamp > sinceTime);
  }

  // Sort by timestamp descending (newest first)
  messages.sort((a, b) => b.timestamp - a.timestamp);

  // Limit results
  const limitedMessages = messages.slice(0, limit);

  return new Response(JSON.stringify({
    ok: true,
    room: room,
    messages: limitedMessages,
    count: limitedMessages.length,
    totalKeys: messages.length,
    cursor: null,
    list_complete: limitedMessages.length >= messages.length,
    error: null
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Send message handler
async function handleSendMessage(request, url, env, corsHeaders) {
  try {
    const body = await request.json();
    const room = url.searchParams.get('room') || body.roomId || 'default-room';

    const message = {
      id: generateId(),
      roomId: room,
      sender: body.sender || 'anonymous',
      content: body.content || '',
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
      avatar: body.avatar || null
    };

    // Store message
    const kvKey = `messages:${room}`;
    let messages = [];

    try {
      const stored = await env.Chat.get(kvKey);
      if (stored) {
        messages = JSON.parse(stored);
      }
    } catch (e) {
      messages = [];
    }

    messages.push(message);

    // Keep only last 1000 messages per room
    if (messages.length > 1000) {
      messages = messages.slice(-1000);
    }

    await env.Chat.put(kvKey, JSON.stringify(messages));

    return new Response(JSON.stringify({
      ok: true,
      message: message,
      error: null
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      message: null,
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Delete message handler
async function handleDeleteMessage(url, messageId, env, corsHeaders) {
  const room = url.searchParams.get('room') || 'default-room';
  const sender = url.searchParams.get('sender') || '';

  const kvKey = `messages:${room}`;
  let messages = [];

  try {
    const stored = await env.Chat.get(kvKey);
    if (stored) {
      messages = JSON.parse(stored);
    }
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      deletedId: null,
      error: 'Failed to load messages'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Find and delete message
  const originalLength = messages.length;
  messages = messages.filter(msg => {
    if (msg.id !== messageId) return true;
    if (sender && msg.sender !== sender) return true;
    return false;
  });

  if (messages.length === originalLength) {
    return new Response(JSON.stringify({
      ok: false,
      deletedId: null,
      error: 'Message not found'
    }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  await env.Chat.put(kvKey, JSON.stringify(messages));

  return new Response(JSON.stringify({
    ok: true,
    deletedId: messageId,
    error: null
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Login handler
async function handleLogin(request, env, corsHeaders) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return new Response(JSON.stringify({
        ok: false,
        message: 'Username and password required',
        error: 'Missing credentials'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Simple login - check if user exists
    const userKey = `user:${username}`;
    const userData = await env.Chat.get(userKey);

    if (!userData) {
      return new Response(JSON.stringify({
        ok: false,
        message: 'User not found',
        error: 'Invalid credentials'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const user = JSON.parse(userData);
    if (user.password !== password) {
      return new Response(JSON.stringify({
        ok: false,
        message: 'Invalid password',
        error: 'Invalid credentials'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Generate simple token
    const token = generateToken();
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days

    // Store session
    await env.Chat.put(`session:${token}`, JSON.stringify({
      username: username,
      expiresAt: expiresAt
    }), { expirationTtl: 30 * 24 * 60 * 60 });

    return new Response(JSON.stringify({
      ok: true,
      message: 'Login successful',
      token: token,
      username: username,
      expiresAt: expiresAt,
      avatar: user.avatar || null,
      error: null
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      message: 'Login failed',
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Register handler
async function handleRegister(request, env, corsHeaders) {
  try {
    const body = await request.json();
    const { username, password, avatar } = body;

    if (!username || !password) {
      return new Response(JSON.stringify({
        ok: false,
        message: 'Username and password required',
        error: 'Missing credentials'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check if user already exists
    const userKey = `user:${username}`;
    const existingUser = await env.Chat.get(userKey);

    if (existingUser) {
      return new Response(JSON.stringify({
        ok: false,
        message: 'Username already exists',
        error: 'User exists'
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Create user
    const userData = {
      username: username,
      password: password,
      avatar: avatar || null,
      createdAt: Date.now()
    };

    await env.Chat.put(userKey, JSON.stringify(userData));

    // Generate token
    const token = generateToken();
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);

    // Store session
    await env.Chat.put(`session:${token}`, JSON.stringify({
      username: username,
      expiresAt: expiresAt
    }), { expirationTtl: 30 * 24 * 60 * 60 });

    return new Response(JSON.stringify({
      ok: true,
      message: 'Registration successful',
      token: token,
      username: username,
      expiresAt: expiresAt,
      avatar: avatar || null,
      error: null
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      message: 'Registration failed',
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Notify handler
async function handleNotify(request, env, corsHeaders) {
  try {
    const body = await request.json();
    const { sender, content, timestamp } = body;

    // Store notification
    const notification = {
      id: generateId(),
      sender: sender || 'anonymous',
      content: content || '',
      timestamp: timestamp || Date.now(),
      createdAt: new Date().toISOString()
    };

    const notifyKey = `notifications:${Date.now()}`;
    await env.Chat.put(notifyKey, JSON.stringify(notification), { expirationTtl: 3600 });

    return new Response(JSON.stringify({
      success: true,
      message: 'Notification sent'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      message: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Utility functions
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function generateToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}