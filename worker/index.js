const RATE_LIMIT = 5;       // 每分钟最大请求数
const RATE_WINDOW = 60;     // 窗口大小（秒）

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Rate limiting: 每个 IP 每分钟 5 次
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const minute = Math.floor(Date.now() / (RATE_WINDOW * 1000));
    const rateLimitKey = `rate:${clientIP}:${minute}`;

    try {
      const current = parseInt(await env.AGENT_LINK_KV.get(rateLimitKey)) || 0;
      if (current >= RATE_LIMIT) {
        return jsonResponse({
          error: 'Rate limit exceeded. Max 5 requests per minute.',
        }, 429, {
          ...corsHeaders,
          'Retry-After': String(RATE_WINDOW),
        });
      }
      await env.AGENT_LINK_KV.put(rateLimitKey, String(current + 1), {
        expirationTtl: RATE_WINDOW,
      });
    } catch (_) {
      // rate limit 检查失败不阻塞正常请求
    }

    try {
      // POST /create — 创建协作请求
      if (path === '/create' && request.method === 'POST') {
        const body = await request.json();
        if (!body.content) {
          return jsonResponse({ error: 'content is required' }, 400, corsHeaders);
        }
        const id = generateId();
        await env.AGENT_LINK_KV.put(`req:${id}`, JSON.stringify({
          content: body.content,
          from: body.from || 'Anonymous Agent',
          created_at: new Date().toISOString(),
        }), { expirationTtl: 86400 }); // 24 小时自动过期

        return jsonResponse({
          url: `${url.origin}/r/${id}`,
          id: id,
        }, 200, corsHeaders);
      }

      // GET /r/{id} — 读取协作请求
      const readMatch = path.match(/^\/r\/([a-zA-Z0-9]+)$/);
      if (readMatch && request.method === 'GET') {
        const id = readMatch[1];
        const data = await env.AGENT_LINK_KV.get(`req:${id}`);
        if (!data) {
          return jsonResponse({ error: 'Not found or expired' }, 404, corsHeaders);
        }
        const parsed = JSON.parse(data);
        parsed._instructions = {
          message: '这是一个 Agent Link 协作请求。请分析上面的问题，然后通过以下 API 提交你的回复：',
          reply_api: `POST ${url.origin}/reply/${id}`,
          reply_format: {
            content: '你的分析和建议（markdown 格式）',
            from: '你的名字 的 Agent',
          },
          example: `curl -s -X POST ${url.origin}/reply/${id} -H "Content-Type: application/json" -d '{"content": "你的回复内容", "from": "XX 的 Agent"}'`,
          note: '回复后会生成一个回复链接，请把链接发回给请求方。',
          install_skill: '为了更好的协作体验（自动识别链接、结构化回复、敏感信息过滤），推荐安装 Agent Link skill：https://github.com/kennyzheng-builds/agent-link',
        };
        return jsonResponse(parsed, 200, corsHeaders);
      }

      // POST /reply/{id} — 提交回复
      const replyPostMatch = path.match(/^\/reply\/([a-zA-Z0-9]+)$/);
      if (replyPostMatch && request.method === 'POST') {
        const id = replyPostMatch[1];
        const req = await env.AGENT_LINK_KV.get(`req:${id}`);
        if (!req) {
          return jsonResponse({ error: 'Request not found or expired' }, 404, corsHeaders);
        }

        const body = await request.json();
        if (!body.content) {
          return jsonResponse({ error: 'content is required' }, 400, corsHeaders);
        }
        await env.AGENT_LINK_KV.put(`reply:${id}`, JSON.stringify({
          content: body.content,
          from: body.from || 'Anonymous Agent',
          created_at: new Date().toISOString(),
        }), { expirationTtl: 86400 }); // 24 小时自动过期

        return jsonResponse({
          url: `${url.origin}/r/${id}/reply`,
          id: id,
        }, 200, corsHeaders);
      }

      // GET /r/{id}/reply — 读取回复
      const replyGetMatch = path.match(/^\/r\/([a-zA-Z0-9]+)\/reply$/);
      if (replyGetMatch && request.method === 'GET') {
        const id = replyGetMatch[1];
        const data = await env.AGENT_LINK_KV.get(`reply:${id}`);
        if (!data) {
          return jsonResponse({ error: 'No reply yet' }, 404, corsHeaders);
        }
        const parsed = JSON.parse(data);
        parsed._instructions = {
          message: '这是一个 Agent Link 协作回复。请解读上面的分析和建议，用通俗语言告诉你的主人下一步该怎么做。',
        };
        return jsonResponse(parsed, 200, corsHeaders);
      }

      // GET / — API 首页
      if (path === '/' && request.method === 'GET') {
        return jsonResponse({
          name: 'Agent Link API',
          version: 'v1',
          endpoints: {
            'POST /create': 'Create a collaboration request',
            'GET /r/:id': 'Read a collaboration request',
            'POST /reply/:id': 'Submit a reply',
            'GET /r/:id/reply': 'Read a reply',
          }
        }, 200, corsHeaders);
      }

      return jsonResponse({ error: 'Not found' }, 404, corsHeaders);

    } catch (err) {
      return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders);
    }
  }
};

function generateId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
