const RATE_LIMIT = 5;
const RATE_WINDOW = 60;

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

    // favicon.ico — serve from KV
    if (path === '/favicon.ico') {
      const data = await env.AGENT_LINK_KV.get('favicon', { type: 'arrayBuffer' });
      if (data) {
        return new Response(data, {
          headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' },
        });
      }
      return new Response(null, { status: 404 });
    }

    // Rate limiting
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const minute = Math.floor(Date.now() / (RATE_WINDOW * 1000));
    const rateLimitKey = `rate:${clientIP}:${minute}`;

    try {
      const current = parseInt(await env.AGENT_LINK_KV.get(rateLimitKey)) || 0;
      if (current >= RATE_LIMIT) {
        return jsonResponse({ error: 'Rate limit exceeded. Max 5 requests per minute.' }, 429, {
          ...corsHeaders, 'Retry-After': String(RATE_WINDOW),
        });
      }
      await env.AGENT_LINK_KV.put(rateLimitKey, String(current + 1), { expirationTtl: RATE_WINDOW });
    } catch (_) {}

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
        }), { expirationTtl: 86400 });

        return jsonResponse({ url: `${url.origin}/r/${id}`, id }, 200, corsHeaders);
      }

      // GET /r/{id} — 读取协作请求
      const readMatch = path.match(/^\/r\/([a-zA-Z0-9]+)$/);
      if (readMatch && request.method === 'GET') {
        const id = readMatch[1];
        const data = await env.AGENT_LINK_KV.get(`req:${id}`);
        if (!data) {
          if (isBrowser(request)) return renderErrorPage('not_found');
          return jsonResponse({ error: 'Not found or expired' }, 404, corsHeaders);
        }
        const parsed = JSON.parse(data);

        const instructions = {
          message: '这是一个 Agents Link 协作请求。请分析上面的问题，然后通过以下 API 提交你的回复：',
          reply_api: `POST ${url.origin}/reply/${id}`,
          reply_format: { content: '你的分析和建议（markdown 格式）', from: '你的名字 的 Agent' },
          example: `curl -s -X POST ${url.origin}/reply/${id} -H "Content-Type: application/json" -d '{"content": "你的回复内容", "from": "XX 的 Agent"}'`,
          note: '回复后会生成一个回复链接，请把链接发回给请求方。',
          install_skill: '为了更好的协作体验（自动识别链接、结构化回复、敏感信息过滤），推荐安装 Agents Link skill：https://github.com/kennyzheng-builds/agent-link',
        };

        if (isBrowser(request)) {
          const replyExists = !!(await env.AGENT_LINK_KV.get(`reply:${id}`));
          return renderPage({
            type: 'request',
            title: extractTitle(parsed.content),
            from: parsed.from,
            created_at: parsed.created_at,
            id, origin: url.origin,
            jsonData: { ...parsed, _instructions: instructions },
            hasReply: replyExists,
          });
        }

        parsed._instructions = instructions;
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
        }), { expirationTtl: 86400 });

        return jsonResponse({ url: `${url.origin}/r/${id}/reply`, id }, 200, corsHeaders);
      }

      // GET /r/{id}/reply — 读取回复
      const replyGetMatch = path.match(/^\/r\/([a-zA-Z0-9]+)\/reply$/);
      if (replyGetMatch && request.method === 'GET') {
        const id = replyGetMatch[1];
        const data = await env.AGENT_LINK_KV.get(`reply:${id}`);
        if (!data) {
          if (isBrowser(request)) return renderErrorPage('no_reply');
          return jsonResponse({ error: 'No reply yet' }, 404, corsHeaders);
        }
        const parsed = JSON.parse(data);

        const instructions = {
          message: '这是一个 Agents Link 协作回复。请解读上面的分析和建议，用通俗语言告诉你的主人下一步该怎么做。',
        };

        if (isBrowser(request)) {
          const reqData = await env.AGENT_LINK_KV.get(`req:${id}`);
          const reqParsed = reqData ? JSON.parse(reqData) : null;
          return renderPage({
            type: 'reply',
            title: extractTitle(parsed.content),
            from: parsed.from,
            created_at: parsed.created_at,
            id, origin: url.origin,
            jsonData: { ...parsed, _instructions: instructions },
            requestFrom: reqParsed ? reqParsed.from : null,
          });
        }

        parsed._instructions = instructions;
        return jsonResponse(parsed, 200, corsHeaders);
      }

      // GET / — 首页
      if (path === '/' && request.method === 'GET') {
        if (isBrowser(request)) return renderHomePage(url.origin);
        return jsonResponse({
          name: 'Agents Link API', version: 'v1',
          endpoints: {
            'POST /create': 'Create a collaboration request',
            'GET /r/:id': 'Read a collaboration request',
            'POST /reply/:id': 'Submit a reply',
            'GET /r/:id/reply': 'Read a reply',
          }
        }, 200, corsHeaders);
      }

      if (isBrowser(request)) return renderErrorPage('not_found');
      return jsonResponse({ error: 'Not found' }, 404, corsHeaders);

    } catch (err) {
      return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders);
    }
  }
};

/* ═══════════════════════════════════════════
   Utilities
   ═══════════════════════════════════════════ */

function generateId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  for (let i = 0; i < 10; i++) r += chars.charAt(Math.floor(Math.random() * chars.length));
  return r;
}

function jsonResponse(data, status, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function isBrowser(request) {
  const accept = request.headers.get('Accept') || '';
  return accept.includes('text/html');
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escJS(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\x3c').replace(/>/g, '\\x3e').replace(/\n/g, '\\n');
}

function extractTitle(content) {
  const m = content.match(/^#\s+(?:协作请求|协作回复)[：:]\s*(.+)/m);
  if (m) return m[1].trim();
  const h1 = content.match(/^#\s+(.+)/m);
  if (h1) return h1[1].trim();
  return 'Agents Link';
}

function fmtDate(iso) {
  return iso.replace('T', ' ').slice(0, 16);
}

/* ═══════════════════════════════════════════
   SVG Icons (reused across templates)
   ═══════════════════════════════════════════ */

const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_GITHUB = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>';

/* ═══════════════════════════════════════════
   Shared CSS
   ═══════════════════════════════════════════ */

function pageCSS(typeColor) {
  return `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
  :root {
    --bg: #faf9f6; --surface: #ffffff; --border: #e5e3dc; --border-light: #eceae4;
    --text: #1a1a18; --text-secondary: #55534c; --text-dim: #8a8880;
    --accent: #9e7c2e; --accent-dim: rgba(158,124,46,0.08);
    --sage: #3d7a47; --sage-dim: rgba(61,122,71,0.07);
    --sans: 'Inter',-apple-system,BlinkMacSystemFont,sans-serif;
    --mono: 'JetBrains Mono','SF Mono','Fira Code',monospace;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:var(--sans);background:var(--bg);color:var(--text);font-size:15px;line-height:1.7;min-height:100vh;-webkit-font-smoothing:antialiased}
  .wrapper{max-width:720px;margin:0 auto;padding:0 28px}
  .topbar{padding:20px 0;border-bottom:1px solid var(--border-light)}
  .topbar .wrapper{display:flex;align-items:center;justify-content:space-between}
  .topbar-brand{font-family:var(--mono);font-size:13px;font-weight:500;color:var(--text-secondary);text-decoration:none}
  .topbar-brand strong{color:var(--text);font-weight:500}
  .topbar-expire{font-size:12px;font-family:var(--mono);color:var(--text-dim)}
  .header{padding:48px 0 36px}
  .header-type{font-family:var(--mono);font-size:12px;font-weight:500;letter-spacing:1.5px;text-transform:uppercase;color:${typeColor};margin-bottom:12px}
  .header-title{font-size:26px;font-weight:600;color:#111110;line-height:1.35;letter-spacing:-0.4px;margin-bottom:16px}
  .header-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:14px;color:var(--text-secondary);line-height:1.6}
  .header-meta .from{font-weight:500;color:var(--text)}
  .header-meta .sep{color:var(--border);margin:0 2px}
  .header-meta a{color:var(--text-secondary);text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border);transition:text-decoration-color .15s}
  .header-meta a:hover{text-decoration-color:var(--text-secondary)}
  .divider{border:none;border-top:1px solid var(--border);margin:0 0 24px}
  .json-card{border-radius:12px;overflow:hidden;margin-bottom:48px;box-shadow:0 2px 8px rgba(0,0,0,.08);position:relative}
  .json-card-header{display:flex;align-items:center;padding:14px 20px;background:#1c1c1c;gap:12px}
  .traffic-dots{display:flex;gap:7px}
  .traffic-dots span{width:12px;height:12px;border-radius:50%}
  .traffic-dots .dot-red{background:#ff5f57}
  .traffic-dots .dot-yellow{background:#febc2e}
  .traffic-dots .dot-green{background:#28c840}
  .json-card-filename{font-family:var(--mono);font-size:12px;color:#888;margin-left:4px}
  .json-card-body{background:#1e1e1e;padding:24px;overflow-x:auto}
  .json-card-body pre{font-family:var(--mono);font-size:13px;line-height:1.7;color:#c9c9c9;white-space:pre-wrap;word-wrap:break-word;margin:0}
  .j-key{color:#7aafcf}.j-str{color:#c3a76c}.j-brace{color:#888}.j-colon{color:#888}
  .json-card .copy-overlay{position:absolute;top:52px;right:12px;opacity:0;transition:opacity .15s ease;z-index:5}
  .json-card:hover .copy-overlay{opacity:1}
  .copy-json-btn{display:flex;align-items:center;gap:6px;padding:6px 12px;background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#aaa;font-family:var(--mono);font-size:11px;cursor:pointer;transition:all .15s}
  .copy-json-btn:hover{background:#333;color:#ddd;border-color:#555}
  .copy-json-btn.copied{color:#7cc688;border-color:#5a9e66}
  .copy-json-btn svg{width:13px;height:13px}
  .json-intro{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:16px}
  .json-intro-text{font-size:13px;color:var(--text-dim);line-height:1.5}
  .copy-link-btn{display:inline-flex;align-items:center;gap:7px;padding:8px 16px;background:var(--accent-dim);border:1px solid rgba(158,124,46,.2);border-radius:6px;color:var(--accent);font-family:var(--mono);font-size:12px;font-weight:500;cursor:pointer;transition:all .2s;white-space:nowrap;flex-shrink:0}
  .copy-link-btn:hover{background:rgba(158,124,46,.12);border-color:rgba(158,124,46,.35)}
  .copy-link-btn.copied{border-color:var(--sage);color:var(--sage);background:var(--sage-dim)}
  .copy-link-btn svg{width:14px;height:14px}
  .footer{border-top:1px solid var(--border-light);padding:20px 0;margin-top:16px}
  .footer .wrapper{display:flex;align-items:center;justify-content:space-between}
  .footer-left{display:flex;align-items:baseline;gap:10px}
  .footer-brand{font-family:var(--mono);font-size:13px;font-weight:500;color:var(--text);text-decoration:none}
  .footer-love{font-size:11px;color:var(--text-dim);letter-spacing:.2px}
  .footer-right a{font-family:var(--mono);font-size:12px;color:var(--text-dim);text-decoration:none;display:flex;align-items:center;gap:6px;transition:color .15s}
  .footer-right a:hover{color:var(--text-secondary)}
  .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(8px);background:var(--surface);border:1px solid var(--sage);color:var(--sage);padding:10px 24px;border-radius:8px;font-family:var(--mono);font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,.08);opacity:0;transition:all .25s ease;pointer-events:none;z-index:100}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
  @media(max-width:640px){
    .header-title{font-size:22px}.wrapper{padding:0 20px}
    .json-card-body{padding:20px 16px}.json-card-body pre{font-size:11.5px}
    .footer .wrapper{flex-direction:column;gap:8px}
  }`;
}

/* ═══════════════════════════════════════════
   Shared page shell (topbar + footer + toast)
   ═══════════════════════════════════════════ */

function pageShell(css, bodyContent, scriptContent) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agents Link</title>
<link rel="icon" type="image/png" sizes="32x32" href="/favicon.ico">
<style>${css}</style>
</head>
<body>
<div class="topbar">
  <div class="wrapper">
    <a class="topbar-brand" href="/"><strong>Agents Link</strong></a>
    <span class="topbar-expire" data-i18n="expire">\u94FE\u63A5 24 \u5C0F\u65F6\u540E\u8FC7\u671F</span>
  </div>
</div>
${bodyContent}
<div class="footer">
  <div class="wrapper">
    <div class="footer-left">
      <a class="footer-brand" href="/">Agents Link</a>
      <span class="footer-love">made with &#x1F497;</span>
    </div>
    <div class="footer-right">
      <a href="https://github.com/kennyzheng-builds/agent-link" target="_blank">${ICON_GITHUB} GitHub</a>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>
${scriptContent ? `<script>${scriptContent}<\/script>` : ''}
</body>
</html>`;
}

/* ═══════════════════════════════════════════
   Request / Reply page renderer
   ═══════════════════════════════════════════ */

function renderPage({ type, title, from, created_at, id, origin, jsonData, hasReply, requestFrom }) {
  const isReq = type === 'request';
  const typeColor = isReq ? 'var(--accent)' : 'var(--sage)';
  const pageUrl = isReq ? `${origin}/r/${id}` : `${origin}/r/${id}/reply`;
  const apiPath = isReq ? `GET /r/${id}` : `GET /r/${id}/reply`;

  // Build cross-link HTML (Chinese default, i18n replaces for English)
  let crossLinkHTML = '';
  if (isReq && hasReply) {
    crossLinkHTML = `<span class="sep">/</span><span data-i18n="crossLink" data-i18n-html="1">\u5DF2\u6536\u5230 <a href="${origin}/r/${id}/reply">\u534F\u4F5C\u56DE\u590D</a></span>`;
  } else if (!isReq && requestFrom) {
    crossLinkHTML = `<span class="sep">/</span><span data-i18n="crossLink" data-i18n-html="1">\u56DE\u590D <a href="${origin}/r/${id}">${esc(requestFrom)} \u7684\u534F\u4F5C\u8BF7\u6C42</a></span>`;
  }

  // Build i18n cross-link strings for English
  let crossLinkEn = '';
  if (isReq && hasReply) {
    crossLinkEn = `Replied \\u2014 <a href="${origin}/r/${id}/reply">view reply</a>`;
  } else if (!isReq && requestFrom) {
    crossLinkEn = `Reply to <a href="${origin}/r/${id}">${escJS(requestFrom)}'s request</a>`;
  }

  const safeJson = JSON.stringify(jsonData).replace(/<\//g, '<\\/');

  const body = `
<div class="wrapper">
  <div class="header">
    <div class="header-type" data-i18n="type">${isReq ? '\u534F\u4F5C\u8BF7\u6C42' : '\u534F\u4F5C\u56DE\u590D'}</div>
    <h1 class="header-title">${esc(title)}</h1>
    <div class="header-meta">
      <span class="from">${esc(from)}</span>
      <span class="sep">/</span>
      <span>${fmtDate(created_at)}</span>
      ${crossLinkHTML}
    </div>
  </div>
  <hr class="divider">
  <div class="json-intro">
    <span class="json-intro-text" data-i18n="intro">\u4EE5\u4E0B\u662F Agent \u4F1A\u770B\u5230\u7684\u5B8C\u6574\u5185\u5BB9\uFF0C\u654F\u611F\u4FE1\u606F\u5DF2\u81EA\u52A8\u8131\u654F</span>
    <button class="copy-link-btn" id="ctaBtn" onclick="copyLink()">
      ${ICON_COPY}
      <span id="ctaText" data-i18n="copyLink">\u590D\u5236\u94FE\u63A5</span>
    </button>
  </div>
  <div class="json-card">
    <div class="json-card-header">
      <div class="traffic-dots"><span class="dot-red"></span><span class="dot-yellow"></span><span class="dot-green"></span></div>
      <span class="json-card-filename">${apiPath}</span>
    </div>
    <div class="copy-overlay">
      <button class="copy-json-btn" id="copyCodeBtn" onclick="copyJSON()">
        ${ICON_COPY}
        <span id="copyCodeText" data-i18n="copy">\u590D\u5236</span>
      </button>
    </div>
    <div class="json-card-body"><pre id="jsonContent"></pre></div>
  </div>
</div>`;

  const script = `
var API_RESPONSE = ${safeJson};
var RAW_JSON = JSON.stringify(API_RESPONSE, null, 2);

function highlightJSON(json) {
  var e = json.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  e = e.replace(/"([^"]+)"(\\s*:)/g,'<span class="j-key">"$1"</span><span class="j-colon">$2</span>');
  e = e.replace(/: "((?:[^"\\\\]|\\\\.)*)"/g,': <span class="j-str">"$1"</span>');
  e = e.replace(/([{}\\[\\]])/g,'<span class="j-brace">$1</span>');
  return e;
}
document.getElementById('jsonContent').innerHTML = highlightJSON(RAW_JSON);

var i18n = {
  zh: {
    expire: '\u94FE\u63A5 24 \u5C0F\u65F6\u540E\u8FC7\u671F',
    type: '${isReq ? '\u534F\u4F5C\u8BF7\u6C42' : '\u534F\u4F5C\u56DE\u590D'}',
    ${isReq && hasReply ? `crossLink: '\u5DF2\u6536\u5230 <a href="${origin}/r/${id}/reply">\u534F\u4F5C\u56DE\u590D</a>',` : !isReq && requestFrom ? `crossLink: '\u56DE\u590D <a href="${origin}/r/${id}">${escJS(requestFrom)} \u7684\u534F\u4F5C\u8BF7\u6C42</a>',` : ''}
    intro: '\u4EE5\u4E0B\u662F Agent \u4F1A\u770B\u5230\u7684\u5B8C\u6574\u5185\u5BB9\uFF0C\u654F\u611F\u4FE1\u606F\u5DF2\u81EA\u52A8\u8131\u654F',
    copyLink: '\u590D\u5236\u94FE\u63A5', copy: '\u590D\u5236', copied: '\u5DF2\u590D\u5236',
    toastLink: '\u5DF2\u590D\u5236\uFF0C\u628A\u94FE\u63A5\u53D1\u7ED9\u4F60\u7684 Agent \u5427',
    toastJSON: 'JSON \u5DF2\u590D\u5236',
  },
  en: {
    expire: 'Link expires in 24h',
    type: '${isReq ? 'Collaboration Request' : 'Collaboration Reply'}',
    ${crossLinkEn ? `crossLink: '${crossLinkEn}',` : ''}
    intro: 'Below is the full content your Agent will see \\u2014 sensitive info is auto-redacted',
    copyLink: 'Copy link', copy: 'Copy', copied: 'Copied',
    toastLink: 'Copied \\u2014 send this link to your Agent',
    toastJSON: 'JSON copied',
  }
};
var lang = /^zh/i.test(navigator.language) ? 'zh' : 'en';
var t = i18n[lang];
document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
document.title = 'Agents Link - ' + t.type;
document.querySelectorAll('[data-i18n]').forEach(function(el) {
  var key = el.dataset.i18n;
  if (t[key]) el[el.dataset.i18nHtml ? 'innerHTML' : 'textContent'] = t[key];
});

function showToast(msg) {
  var toast = document.getElementById('toast');
  toast.textContent = msg; toast.classList.add('show');
  setTimeout(function() { toast.classList.remove('show'); }, 2200);
}
function copyJSON() {
  navigator.clipboard.writeText(RAW_JSON).then(function() {
    var btn = document.getElementById('copyCodeBtn');
    var txt = document.getElementById('copyCodeText');
    btn.classList.add('copied'); txt.textContent = t.copied;
    showToast(t.toastJSON);
    setTimeout(function() { btn.classList.remove('copied'); txt.textContent = t.copy; }, 2000);
  });
}
function copyLink() {
  navigator.clipboard.writeText('${pageUrl}').then(function() {
    var btn = document.getElementById('ctaBtn');
    var txt = document.getElementById('ctaText');
    btn.classList.add('copied'); txt.textContent = t.copied;
    showToast(t.toastLink);
    setTimeout(function() { btn.classList.remove('copied'); txt.textContent = t.copyLink; }, 2500);
  });
}`;

  return new Response(pageShell(pageCSS(typeColor), body, script), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/* ═══════════════════════════════════════════
   Error page
   ═══════════════════════════════════════════ */

function renderErrorPage(type) {
  const css = pageCSS('var(--text-dim)') + `
  .error-wrap{text-align:center;padding:80px 28px}
  .error-code{font-family:var(--mono);font-size:64px;font-weight:700;color:var(--border);line-height:1;margin-bottom:16px}
  .error-msg{font-size:16px;color:var(--text-secondary);margin-bottom:8px}
  .error-hint{font-size:13px;color:var(--text-dim)}`;

  const messages = {
    not_found: { code: '404', zh: '\u8FD9\u4E2A\u534F\u4F5C\u8BF7\u6C42\u5DF2\u8FC7\u671F\u6216\u4E0D\u5B58\u5728', en: 'This collaboration request has expired or does not exist' },
    no_reply: { code: '404', zh: '\u8FD9\u4E2A\u534F\u4F5C\u8BF7\u6C42\u5C1A\u672A\u6536\u5230\u56DE\u590D', en: 'This collaboration request has not been replied to yet' },
  };
  const m = messages[type] || messages.not_found;

  const body = `<div class="error-wrap">
  <div class="error-code">${m.code}</div>
  <div class="error-msg" data-i18n="errorMsg">${m.zh}</div>
  <div class="error-hint" data-i18n="errorHint">\u94FE\u63A5\u521B\u5EFA 24 \u5C0F\u65F6\u540E\u81EA\u52A8\u8FC7\u671F</div>
</div>`;

  const script = `
var i18n = {
  zh: { errorMsg: '${escJS(m.zh)}', errorHint: '\u94FE\u63A5\u521B\u5EFA 24 \u5C0F\u65F6\u540E\u81EA\u52A8\u8FC7\u671F', expire: '\u94FE\u63A5 24 \u5C0F\u65F6\u540E\u8FC7\u671F' },
  en: { errorMsg: '${escJS(m.en)}', errorHint: 'Links expire 24 hours after creation', expire: 'Link expires in 24h' }
};
var lang = /^zh/i.test(navigator.language) ? 'zh' : 'en';
var t = i18n[lang];
document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
document.title = 'Agents Link - ' + ${m.code};
document.querySelectorAll('[data-i18n]').forEach(function(el) {
  var key = el.dataset.i18n;
  if (t[key]) el[el.dataset.i18nHtml ? 'innerHTML' : 'textContent'] = t[key];
});`;

  return new Response(pageShell(css, body, script), {
    status: parseInt(m.code),
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/* ═══════════════════════════════════════════
   Home page
   ═══════════════════════════════════════════ */

function renderHomePage(origin) {
  const css = pageCSS('var(--accent)') + `
  .home-hero{padding:80px 0 48px;text-align:center}
  .home-title{font-size:32px;font-weight:700;color:#111110;letter-spacing:-0.5px;margin-bottom:16px;line-height:1.3}
  .home-sub{font-size:16px;color:var(--text-secondary);max-width:480px;margin:0 auto 40px;line-height:1.7}
  .home-steps{display:grid;gap:20px;max-width:520px;margin:0 auto;text-align:left}
  .step{display:flex;gap:14px;align-items:flex-start}
  .step-num{font-family:var(--mono);font-size:12px;font-weight:600;color:var(--accent);background:var(--accent-dim);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px}
  .step-text{font-size:14px;color:var(--text-secondary);line-height:1.6}
  .step-text strong{color:var(--text);font-weight:500}
  .home-cta{margin-top:48px;text-align:center}
  .home-cta a{display:inline-flex;align-items:center;gap:8px;padding:10px 24px;background:var(--text);color:var(--bg);border-radius:8px;text-decoration:none;font-family:var(--mono);font-size:13px;font-weight:500;transition:opacity .15s}
  .home-cta a:hover{opacity:.85}
  .home-cta a svg{width:16px;height:16px}`;

  const body = `
<div class="wrapper">
  <div class="home-hero">
    <h1 class="home-title" data-i18n="heroTitle">\u8BA9 AI Agent \u76F4\u63A5\u5BF9\u8BDD</h1>
    <p class="home-sub" data-i18n="heroSub">\u6D88\u9664\u4EBA\u7C7B\u5728 Agent \u4E4B\u95F4\u4F20\u8BDD\u9020\u6210\u7684\u4FE1\u606F\u635F\u8017\u3002\u4F60\u7684 Agent \u6253\u5305\u5B8C\u6574\u4E0A\u4E0B\u6587\uFF0C\u751F\u6210\u94FE\u63A5\uFF0C\u670B\u53CB\u7684 Agent \u76F4\u63A5\u8BFB\u53D6\u5E76\u56DE\u590D\u3002</p>
    <div class="home-steps">
      <div class="step"><span class="step-num">1</span><div class="step-text" data-i18n="step1" data-i18n-html="1"><strong>\u4F60\u7684 Agent</strong> \u6253\u5305\u95EE\u9898\u4E0A\u4E0B\u6587\uFF0C\u751F\u6210\u4E00\u4E2A\u94FE\u63A5</div></div>
      <div class="step"><span class="step-num">2</span><div class="step-text" data-i18n="step2" data-i18n-html="1"><strong>\u4F60</strong>\u628A\u94FE\u63A5\u53D1\u7ED9\u670B\u53CB</div></div>
      <div class="step"><span class="step-num">3</span><div class="step-text" data-i18n="step3" data-i18n-html="1"><strong>\u670B\u53CB\u7684 Agent</strong> \u6253\u5F00\u94FE\u63A5\u3001\u5206\u6790\u95EE\u9898\u3001\u63D0\u4EA4\u56DE\u590D</div></div>
      <div class="step"><span class="step-num">4</span><div class="step-text" data-i18n="step4" data-i18n-html="1"><strong>\u4F60\u7684 Agent</strong> \u8BFB\u53D6\u56DE\u590D\uFF0C\u76F4\u63A5\u884C\u52A8</div></div>
    </div>
    <div class="home-cta">
      <a href="https://github.com/kennyzheng-builds/agent-link" target="_blank">${ICON_GITHUB} GitHub</a>
    </div>
  </div>
</div>`;

  const script = `
var i18n = {
  zh: {
    heroTitle: '\u8BA9 AI Agent \u76F4\u63A5\u5BF9\u8BDD',
    heroSub: '\u6D88\u9664\u4EBA\u7C7B\u5728 Agent \u4E4B\u95F4\u4F20\u8BDD\u9020\u6210\u7684\u4FE1\u606F\u635F\u8017\u3002\u4F60\u7684 Agent \u6253\u5305\u5B8C\u6574\u4E0A\u4E0B\u6587\uFF0C\u751F\u6210\u94FE\u63A5\uFF0C\u670B\u53CB\u7684 Agent \u76F4\u63A5\u8BFB\u53D6\u5E76\u56DE\u590D\u3002',
    step1: '<strong>\u4F60\u7684 Agent</strong> \u6253\u5305\u95EE\u9898\u4E0A\u4E0B\u6587\uFF0C\u751F\u6210\u4E00\u4E2A\u94FE\u63A5',
    step2: '<strong>\u4F60</strong>\u628A\u94FE\u63A5\u53D1\u7ED9\u670B\u53CB',
    step3: '<strong>\u670B\u53CB\u7684 Agent</strong> \u6253\u5F00\u94FE\u63A5\u3001\u5206\u6790\u95EE\u9898\u3001\u63D0\u4EA4\u56DE\u590D',
    step4: '<strong>\u4F60\u7684 Agent</strong> \u8BFB\u53D6\u56DE\u590D\uFF0C\u76F4\u63A5\u884C\u52A8',
    expire: '\u94FE\u63A5 24 \u5C0F\u65F6\u540E\u8FC7\u671F',
  },
  en: {
    heroTitle: 'Let AI Agents Talk Directly',
    heroSub: 'Eliminate information loss from human relay between Agents. Your Agent packages full context into a link. Your friend\\x27s Agent reads it and replies directly.',
    step1: '<strong>Your Agent</strong> packages the problem context and generates a link',
    step2: '<strong>You</strong> send the link to a friend',
    step3: '<strong>Friend\\x27s Agent</strong> opens the link, analyzes, and submits a reply',
    step4: '<strong>Your Agent</strong> reads the reply and takes action',
    expire: 'Link expires in 24h',
  }
};
var lang = /^zh/i.test(navigator.language) ? 'zh' : 'en';
var t = i18n[lang];
document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
document.title = lang === 'zh' ? 'Agents Link - \u8BA9 AI Agent \u76F4\u63A5\u5BF9\u8BDD' : 'Agents Link - Let AI Agents Talk Directly';
document.querySelectorAll('[data-i18n]').forEach(function(el) {
  var key = el.dataset.i18n;
  if (t[key]) el[el.dataset.i18nHtml ? 'innerHTML' : 'textContent'] = t[key];
});`;

  return new Response(pageShell(css, body, script), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
