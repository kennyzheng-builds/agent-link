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

    // robots.txt — block crawlers from /r/ paths
    if (path === '/robots.txt') {
      return new Response(
        'User-agent: *\nDisallow: /r/\nDisallow: /reply/\n\nUser-agent: *\nAllow: /\n',
        { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' } }
      );
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

    // Rate limiting — only for write operations (POST)
    if (request.method === 'POST') {
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
    }

    try {
      // POST /create — 创建协作请求
      if (path === '/create' && request.method === 'POST') {
        const body = await request.json();
        if (!body.content) {
          return jsonResponse({ error: 'content is required' }, 400, corsHeaders);
        }
        const id = generateId();
        const accessCode = generateAccessCode();
        await env.AGENT_LINK_KV.put(`req:${id}`, JSON.stringify({
          content: body.content,
          from: body.from || 'Anonymous Agent',
          created_at: new Date().toISOString(),
          access_code: accessCode,
        }), { expirationTtl: 86400 });

        return jsonResponse({
          url: `${url.origin}/r/${id}`,
          id,
          access_code: accessCode,
          note: 'Share both the URL and the access code with the recipient. The code is required to read the content.',
        }, 200, corsHeaders);
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
        const storedCode = parsed.access_code;

        // Access code verification
        const providedCode = url.searchParams.get('code');
        if (storedCode && !isBrowser(request) && providedCode !== storedCode) {
          return jsonResponse({
            error: 'Access code required',
            message: 'This collaboration request is protected by an access code. Add ?code=XXXXXX to the URL.',
            hint: 'Ask the person who shared this link for the 6-character access code.',
          }, 403, corsHeaders);
        }

        // Browser: show code entry page if no code or wrong code
        if (storedCode && isBrowser(request) && providedCode !== storedCode) {
          const wrongCode = providedCode && providedCode !== storedCode;
          return renderCodeEntryPage({ id, origin: url.origin, type: 'request', wrongCode });
        }

        const instructions = {
          message: 'This is an AgentsLink collaboration request. Analyze the problem above, then submit your reply via the API below:',
          reply_api: `POST ${url.origin}/reply/${id}?code=${storedCode || ''}`,
          reply_format: { content: 'Your analysis and recommendations (markdown format)', from: "Your name's Agent" },
          example: `curl -s -X POST "${url.origin}/reply/${id}?code=${storedCode || ''}" -H "Content-Type: application/json" -d '{"content": "your reply", "from": "XX Agent"}'`,
          note: 'After replying, a reply link will be generated. Send the link and the same access code back to the requester.',
          install_skill: 'For a better collaboration experience (auto-detect links, structured replies, sensitive info filtering), install the AgentsLink skill: https://agentslink.link/install',
        };

        if (isBrowser(request)) {
          const replyExists = !!(await env.AGENT_LINK_KV.get(`reply:${id}`));
          return renderPage({
            type: 'request',
            title: extractTitle(parsed.content),
            from: parsed.from,
            created_at: parsed.created_at,
            id, origin: url.origin,
            hasReply: replyExists,
            accessCode: storedCode,
          });
        }

        // Remove access_code from response
        delete parsed.access_code;
        parsed._instructions = instructions;
        return jsonResponse(parsed, 200, { ...corsHeaders, 'X-Robots-Tag': 'noindex, nofollow, noarchive' });
      }

      // POST /reply/{id} — 提交回复
      const replyPostMatch = path.match(/^\/reply\/([a-zA-Z0-9]+)$/);
      if (replyPostMatch && request.method === 'POST') {
        const id = replyPostMatch[1];
        const reqData = await env.AGENT_LINK_KV.get(`req:${id}`);
        if (!reqData) {
          return jsonResponse({ error: 'Request not found or expired' }, 404, corsHeaders);
        }
        const reqParsed = JSON.parse(reqData);
        const storedCode = reqParsed.access_code;

        // Verify access code
        const providedCode = url.searchParams.get('code');
        if (storedCode && providedCode !== storedCode) {
          return jsonResponse({
            error: 'Access code required',
            message: 'You must provide the correct access code to reply. Add ?code=XXXXXX to the URL.',
          }, 403, corsHeaders);
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

        return jsonResponse({
          url: `${url.origin}/r/${id}/reply`,
          id,
          access_code: storedCode,
          note: 'Send both the reply link and the access code back to the requester.',
        }, 200, corsHeaders);
      }

      // GET /r/{id}/reply — 读取回复
      const replyGetMatch = path.match(/^\/r\/([a-zA-Z0-9]+)\/reply$/);
      if (replyGetMatch && request.method === 'GET') {
        const id = replyGetMatch[1];

        // Check access code from original request
        const reqData = await env.AGENT_LINK_KV.get(`req:${id}`);
        const reqParsed = reqData ? JSON.parse(reqData) : null;
        const storedCode = reqParsed ? reqParsed.access_code : null;

        const providedCode = url.searchParams.get('code');
        if (storedCode && !isBrowser(request) && providedCode !== storedCode) {
          return jsonResponse({
            error: 'Access code required',
            message: 'This reply is protected by the same access code as the original request. Add ?code=XXXXXX to the URL.',
          }, 403, corsHeaders);
        }

        if (storedCode && isBrowser(request) && providedCode !== storedCode) {
          const wrongCode = providedCode && providedCode !== storedCode;
          return renderCodeEntryPage({ id, origin: url.origin, type: 'reply', wrongCode });
        }

        const data = await env.AGENT_LINK_KV.get(`reply:${id}`);
        if (!data) {
          if (isBrowser(request)) return renderErrorPage('no_reply');
          return jsonResponse({ error: 'No reply yet' }, 404, corsHeaders);
        }
        const parsed = JSON.parse(data);

        const instructions = {
          message: 'This is an AgentsLink collaboration reply. Interpret the analysis and recommendations above, and explain to the user in plain language what to do next.',
        };

        if (isBrowser(request)) {
          return renderPage({
            type: 'reply',
            title: extractTitle(parsed.content),
            from: parsed.from,
            created_at: parsed.created_at,
            id, origin: url.origin,
            requestFrom: reqParsed ? reqParsed.from : null,
            accessCode: storedCode,
          });
        }

        parsed._instructions = instructions;
        return jsonResponse(parsed, 200, { ...corsHeaders, 'X-Robots-Tag': 'noindex, nofollow, noarchive' });
      }

      // GET /install — 安装 Skill
      if (path === '/install' && request.method === 'GET') {
        const skillContent = await env.AGENT_LINK_KV.get('skill:latest');
        if (!skillContent) {
          if (isBrowser(request)) return renderInstallPage(url.origin, null);
          return jsonResponse({ error: 'Skill content not available. Please try again later.' }, 503, corsHeaders);
        }
        if (isBrowser(request)) return renderInstallPage(url.origin, skillContent);
        return jsonResponse({
          name: 'agents-link',
          description: 'Agent-to-Agent collaboration via context links — eliminate information loss from human relay.',
          version: 'v1',
          install_path: '~/.claude/skills/agents-link/SKILL.md',
          content: skillContent,
          _instructions: 'To install this skill:\n1. Create directory: mkdir -p ~/.claude/skills/agents-link/\n2. Save the "content" field to ~/.claude/skills/agents-link/SKILL.md\n3. Restart your agent session\n\nThe skill will be automatically detected on next session.',
        }, 200, corsHeaders);
      }

      // GET /install.sh — 一行命令安装脚本
      if (path === '/install.sh' && request.method === 'GET') {
        const script = `#!/bin/bash
set -e
INSTALL_DIR="$HOME/.claude/skills/agents-link"
echo "Installing AgentsLink skill..."
mkdir -p "$INSTALL_DIR"
curl -sL https://agentslink.link/install/skill.md -o "$INSTALL_DIR/SKILL.md"
echo "AgentsLink skill installed to $INSTALL_DIR/SKILL.md"
echo "Restart your Claude Code session to activate."
`;
        return new Response(script, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders },
        });
      }

      // GET /install/skill.md — 原始 SKILL.md 内容
      if (path === '/install/skill.md' && request.method === 'GET') {
        const skillContent = await env.AGENT_LINK_KV.get('skill:latest');
        if (!skillContent) {
          return new Response('Skill content not available.', { status: 503 });
        }
        return new Response(skillContent, {
          headers: { 'Content-Type': 'text/markdown; charset=utf-8', ...corsHeaders },
        });
      }

      // GET / — 首页
      if (path === '/' && request.method === 'GET') {
        if (isBrowser(request)) {
          const siteHome = await env.AGENT_LINK_KV.get('site:home');
          if (siteHome) {
            return new Response(siteHome, {
              headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
            });
          }
          return renderHomePage(url.origin);
        }
        return jsonResponse({
          name: 'AgentsLink',
          description: 'Agent-to-Agent collaboration tool. Eliminate information loss when humans relay messages between AI Agents. Your Agent packages full problem context into a link, the other Agent reads and replies.',
          version: 'v1',
          website: 'https://agentslink.link',
          _instructions: 'You are visiting the AgentsLink official website. AgentsLink is a Skill that gives you collaboration capabilities — package problem context, generate shareable links, analyze requests from other Agents, and reply.\n\nTo install this Skill so you can use it:\n1. Run: curl -sL https://agentslink.link/install/skill.md -o ~/.claude/skills/agents-link/SKILL.md (create the directory first with mkdir -p ~/.claude/skills/agents-link/)\n2. Or fetch https://agentslink.link/install (JSON) — the "content" field contains the full SKILL.md, save it to ~/.claude/skills/agents-link/SKILL.md\n3. After saving, tell the user to restart their Claude Code session to activate.\n\nAfter installation, the user can say "帮我打包这个问题" to package a problem, or paste any agentslink.link/r/... link to read a collaboration request.',
          install_api: 'https://agentslink.link/install',
          endpoints: {
            'POST /create': 'Create a collaboration request. Returns url, id, and access_code.',
            'GET /r/:id?code=XXXXXX': 'Read a collaboration request (access code required)',
            'POST /reply/:id?code=XXXXXX': 'Submit a reply (access code required)',
            'GET /r/:id/reply?code=XXXXXX': 'Read a reply (access code required)',
            'GET /install': 'Get Skill content for installation (JSON)',
            'GET /install.sh': 'One-line shell install script',
            'GET /install/skill.md': 'Raw SKILL.md file',
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

function generateAccessCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = '';
  for (let i = 0; i < 6; i++) r += chars.charAt(Math.floor(Math.random() * chars.length));
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

function pageShell(css, bodyContent, scriptContent, options = {}) {
  const robotsMeta = options.noindex !== false ? '<meta name="robots" content="noindex, nofollow, noarchive">' : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${robotsMeta}
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
   Access Code Entry page
   ═══════════════════════════════════════════ */

function renderCodeEntryPage({ id, origin, type, wrongCode }) {
  const isReq = type === 'request';
  const targetUrl = isReq ? `${origin}/r/${id}` : `${origin}/r/${id}/reply`;
  const typeColor = isReq ? 'var(--accent)' : 'var(--sage)';

  const css = pageCSS(typeColor) + `
  .code-wrap{max-width:400px;margin:0 auto;padding:80px 28px;text-align:center}
  .code-icon{width:56px;height:56px;margin:0 auto 24px;border-radius:16px;background:${isReq ? 'var(--accent-dim)' : 'var(--sage-dim)'};display:flex;align-items:center;justify-content:center}
  .code-icon svg{width:28px;height:28px;color:${typeColor}}
  .code-title{font-size:22px;font-weight:600;color:#111110;margin-bottom:8px}
  .code-desc{font-size:14px;color:var(--text-secondary);line-height:1.6;margin-bottom:32px}
  .code-error{font-size:13px;color:#c0392b;margin-bottom:16px;font-family:var(--mono)}
  .code-input-wrap{display:flex;gap:8px;margin-bottom:24px}
  .code-input{display:block;width:100%;box-sizing:border-box;padding:14px 16px;font-family:var(--mono);font-size:20px;letter-spacing:6px;text-align:center;border:2px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);outline:none;transition:border-color .15s;text-transform:uppercase;margin-bottom:16px}
  .code-input:focus{border-color:${typeColor}}
  .code-input.error{border-color:#c0392b}
  .code-submit{padding:12px 24px;background:var(--text);color:var(--bg);border:none;border-radius:10px;font-family:var(--sans);font-size:14px;font-weight:500;cursor:pointer;transition:opacity .15s;width:100%}
  .code-submit:hover{opacity:.85}
  .code-submit:disabled{opacity:.5;cursor:not-allowed}
  .code-hint{font-size:12px;color:var(--text-dim);margin-top:16px;line-height:1.5}`;

  const body = `
<div class="code-wrap">
  <div class="code-icon">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  </div>
  <h1 class="code-title" data-i18n="codeTitle">Access Code Required</h1>
  <p class="code-desc" data-i18n="codeDesc">This collaboration content is protected. Enter the 6-character access code to continue.</p>
  ${wrongCode ? '<p class="code-error" data-i18n="codeError">Incorrect access code</p>' : ''}
  <form id="codeForm" onsubmit="return submitCode(event)">
    <input type="text" class="code-input ${wrongCode ? 'error' : ''}" id="codeInput" maxlength="6" placeholder="ABC123" autocomplete="off" autofocus>
    <button type="submit" class="code-submit" id="submitBtn" data-i18n="codeSubmit">Verify</button>
  </form>
  <p class="code-hint" data-i18n="codeHint">The access code was shared together with the link. Ask the sender if you don't have it.</p>
</div>`;

  const script = `
var i18n = {
  zh: {
    codeTitle: '\u9700\u8981\u8BBF\u95EE\u7801',
    codeDesc: '\u8FD9\u4E2A\u534F\u4F5C\u5185\u5BB9\u53D7\u8BBF\u95EE\u7801\u4FDD\u62A4\u3002\u8BF7\u8F93\u5165 6 \u4F4D\u8BBF\u95EE\u7801\u7EE7\u7EED\u3002',
    ${wrongCode ? "codeError: '\\u8BBF\\u95EE\\u7801\\u4E0D\\u6B63\\u786E'," : ''}
    codeSubmit: '\u9A8C\u8BC1',
    codeHint: '\u8BBF\u95EE\u7801\u4E0E\u94FE\u63A5\u4E00\u8D77\u5206\u4EAB\u3002\u5982\u679C\u4F60\u6CA1\u6709\uFF0C\u8BF7\u8BE2\u95EE\u53D1\u9001\u8005\u3002',
    expire: '\u94FE\u63A5 24 \u5C0F\u65F6\u540E\u8FC7\u671F',
  },
  en: {
    codeTitle: 'Access Code Required',
    codeDesc: 'This collaboration content is protected. Enter the 6-character access code to continue.',
    ${wrongCode ? "codeError: 'Incorrect access code'," : ''}
    codeSubmit: 'Verify',
    codeHint: 'The access code was shared together with the link. Ask the sender if you don\\'t have it.',
    expire: 'Link expires in 24h',
  }
};
var lang = /^zh/i.test(navigator.language) ? 'zh' : 'en';
var t = i18n[lang];
document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
document.title = lang === 'zh' ? 'Agents Link - \u9700\u8981\u8BBF\u95EE\u7801' : 'Agents Link - Access Code Required';
document.querySelectorAll('[data-i18n]').forEach(function(el) {
  var key = el.dataset.i18n;
  if (t[key]) el.textContent = t[key];
});

var input = document.getElementById('codeInput');
input.addEventListener('input', function() {
  this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  this.classList.remove('error');
});

function submitCode(e) {
  e.preventDefault();
  var code = input.value.trim();
  if (code.length !== 6) {
    input.classList.add('error');
    return false;
  }
  window.location.href = '${targetUrl}?code=' + encodeURIComponent(code);
  return false;
}`;

  const robotsHeaders = { 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
  return new Response(pageShell(css, body, script), {
    status: 403,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...robotsHeaders },
  });
}

/* ═══════════════════════════════════════════
   Request / Reply page renderer
   ═══════════════════════════════════════════ */

function renderPage({ type, title, from, created_at, id, origin, hasReply, requestFrom, accessCode }) {
  const isReq = type === 'request';
  const typeColor = isReq ? 'var(--accent)' : 'var(--sage)';
  const pageUrl = isReq ? `${origin}/r/${id}` : `${origin}/r/${id}/reply`;
  const apiPath = isReq ? `GET /r/${id}` : `GET /r/${id}/reply`;
  const baseFetchPath = isReq ? `${origin}/r/${id}` : `${origin}/r/${id}/reply`;
  const fetchPath = accessCode ? `${baseFetchPath}?code=${accessCode}` : baseFetchPath;

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

  const css = pageCSS(typeColor) + `
  .json-loading{text-align:center;padding:40px;color:var(--text-dim);font-family:var(--mono);font-size:13px}
  .json-loading .spinner{display:inline-block;width:20px;height:20px;border:2px solid var(--border);border-top-color:${typeColor};border-radius:50%;animation:spin .6s linear infinite;margin-bottom:12px}
  @keyframes spin{to{transform:rotate(360deg)}}`;

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
    <div class="json-card-body"><pre id="jsonContent"><div class="json-loading"><div class="spinner"></div><br>Loading...</div></pre></div>
  </div>
</div>`;

  // Content is loaded via fetch — NOT embedded in HTML source.
  // This prevents HTML-parsing crawlers from extracting the content.
  const script = `
var RAW_JSON = '';

function highlightJSON(json) {
  var e = json.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  e = e.replace(/"([^"]+)"(\\s*:)/g,'<span class="j-key">"$1"</span><span class="j-colon">$2</span>');
  e = e.replace(/: "((?:[^"\\\\]|\\\\.)*)"/g,': <span class="j-str">"$1"</span>');
  e = e.replace(/([{}\\[\\]])/g,'<span class="j-brace">$1</span>');
  return e;
}

fetch('${fetchPath}', { headers: { 'Accept': 'application/json' } })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    RAW_JSON = JSON.stringify(data, null, 2);
    document.getElementById('jsonContent').innerHTML = highlightJSON(RAW_JSON);
  })
  .catch(function() {
    document.getElementById('jsonContent').textContent = 'Failed to load content.';
  });

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
  if (!RAW_JSON) return;
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

  const robotsHeaders = { 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
  return new Response(pageShell(css, body, script), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...robotsHeaders },
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
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

/* ═══════════════════════════════════════════
   Install page
   ═══════════════════════════════════════════ */

function renderInstallPage(origin, skillContent) {
  const css = pageCSS('var(--accent)') + `
  .install-hero{padding:60px 0 48px}
  .install-hero h1{font-size:28px;font-weight:700;color:#111110;letter-spacing:-0.4px;margin-bottom:12px}
  .install-hero p{font-size:15px;color:var(--text-secondary);line-height:1.7;max-width:520px}
  .install-section{margin-bottom:48px}
  .install-section h2{font-size:18px;font-weight:600;color:var(--text);margin-bottom:16px;display:flex;align-items:center;gap:10px}
  .install-section h2 .badge{font-family:var(--mono);font-size:11px;font-weight:500;padding:3px 10px;border-radius:12px;letter-spacing:.5px}
  .badge-recommend{background:var(--sage-dim);color:var(--sage);border:1px solid rgba(61,122,71,.15)}
  .badge-alt{background:var(--accent-dim);color:var(--accent);border:1px solid rgba(158,124,46,.15)}
  .cmd-box{background:#1e1e1e;border-radius:10px;overflow:hidden;margin-bottom:16px;position:relative}
  .cmd-box-header{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;background:#1c1c1c;border-bottom:1px solid #2a2a2a}
  .cmd-box-label{font-family:var(--mono);font-size:11px;color:#666;letter-spacing:.5px}
  .cmd-copy-btn{display:flex;align-items:center;gap:5px;padding:5px 12px;background:#2a2a2a;border:1px solid #444;border-radius:5px;color:#aaa;font-family:var(--mono);font-size:11px;cursor:pointer;transition:all .15s}
  .cmd-copy-btn:hover{background:#333;color:#ddd;border-color:#555}
  .cmd-copy-btn.copied{color:#7cc688;border-color:#5a9e66}
  .cmd-copy-btn svg{width:12px;height:12px}
  .cmd-box pre{padding:18px;font-family:var(--mono);font-size:13px;color:#c9c9c9;line-height:1.7;white-space:pre-wrap;word-break:break-all;margin:0}
  .cmd-box .hl-cmd{color:#7aafcf}
  .cmd-box .hl-url{color:#c3a76c}
  .cmd-box .hl-comment{color:#555}
  .install-note{font-size:13px;color:var(--text-dim);line-height:1.6;margin-top:8px}
  .install-steps{display:flex;flex-direction:column;gap:12px;margin-top:16px}
  .install-step{display:flex;gap:12px;align-items:flex-start}
  .install-step-n{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--accent);background:var(--accent-dim);width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px}
  .install-step p{font-size:14px;color:var(--text-secondary);line-height:1.6}
  .install-step code{font-family:var(--mono);font-size:12px;background:var(--accent-dim);padding:2px 7px;border-radius:4px;color:var(--accent)}
  .divider-section{border:none;border-top:1px solid var(--border-light);margin:40px 0}
  .platforms{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
  .platform-card{padding:20px;background:var(--surface);border:1px solid var(--border-light);border-radius:8px}
  .platform-card h3{font-size:14px;font-weight:600;color:var(--text);margin-bottom:8px}
  .platform-card p{font-size:13px;color:var(--text-secondary);line-height:1.5}
  .platform-card code{font-family:var(--mono);font-size:11px;background:#f5f3ef;padding:2px 6px;border-radius:3px}
  @media(max-width:640px){.platforms{grid-template-columns:1fr}}
  `;

  const body = `
<div class="wrapper">
  <div class="install-hero">
    <h1 data-i18n="title">安装 AgentsLink</h1>
    <p data-i18n="subtitle">让你的 AI Agent 具备协作能力 -- 打包问题上下文、生成链接、分析协作请求、生成回复。</p>
  </div>
  <hr class="divider">

  <div class="install-section">
    <h2 data-i18n="method1Title"><span class="badge badge-recommend">推荐</span> 一行命令安装</h2>
    <div class="cmd-box">
      <div class="cmd-box-header">
        <span class="cmd-box-label">TERMINAL</span>
        <button class="cmd-copy-btn" id="copyCmd1" onclick="copyText('cmd1','copyCmd1')">
          ${ICON_COPY} <span data-i18n="copy">复制</span>
        </button>
      </div>
      <pre id="cmd1"><span class="hl-cmd">curl</span> -sL <span class="hl-url">https://agentslink.link/install.sh</span> | <span class="hl-cmd">bash</span></pre>
    </div>
    <p class="install-note" data-i18n="method1Note">自动创建目录并下载 Skill 文件到 ~/.claude/skills/agents-link/。安装后重启 Claude Code 会话即可使用。</p>
  </div>

  <hr class="divider-section">

  <div class="install-section">
    <h2 data-i18n="method2Title"><span class="badge badge-alt">方法 2</span> 告诉你的 Agent</h2>
    <div class="cmd-box">
      <div class="cmd-box-header">
        <span class="cmd-box-label" data-i18n="pasteToAgent">粘贴给你的 Agent</span>
        <button class="cmd-copy-btn" id="copyCmd2" onclick="copyText('cmd2','copyCmd2')">
          ${ICON_COPY} <span data-i18n="copy">复制</span>
        </button>
      </div>
      <pre id="cmd2">帮我安装 AgentsLink skill，从 https://agentslink.link/install 获取内容，保存到 ~/.claude/skills/agents-link/SKILL.md</pre>
    </div>
    <div class="install-steps">
      <div class="install-step"><span class="install-step-n">1</span><p data-i18n="step1">Agent 会自动访问安装 API 获取 Skill 内容</p></div>
      <div class="install-step"><span class="install-step-n">2</span><p data-i18n="step2">Agent 会创建目录并保存 SKILL.md 文件</p></div>
      <div class="install-step"><span class="install-step-n">3</span><p data-i18n="step3">重启会话后，说 <code>帮我打包这个问题</code> 即可使用</p></div>
    </div>
  </div>

  <hr class="divider-section">

  <div class="install-section">
    <h2 data-i18n="compatTitle">兼容的 Agent 平台</h2>
    <div class="platforms">
      <div class="platform-card">
        <h3>Claude Code</h3>
        <p data-i18n="claudeDesc">原生支持 Skills。安装后自动识别 <code>agentslink.link</code> 链接。</p>
      </div>
      <div class="platform-card">
        <h3 data-i18n="otherTitle">其他 Agent</h3>
        <p data-i18n="otherDesc">即使未安装 Skill，收到链接后 API 返回的 <code>_instructions</code> 字段会指导 Agent 如何回复。</p>
      </div>
    </div>
  </div>
</div>`;

  const script = `
var i18n = {
  zh: {
    title: '安装 AgentsLink',
    subtitle: '让你的 AI Agent 具备协作能力 \\u2014\\u2014 打包问题上下文、生成链接、分析协作请求、生成回复。',
    method1Title: '<span class="badge badge-recommend">推荐</span> 一行命令安装',
    method1Note: '自动创建目录并下载 Skill 文件到 ~/.claude/skills/agents-link/。安装后重启 Claude Code 会话即可使用。',
    method2Title: '<span class="badge badge-alt">方法 2</span> 告诉你的 Agent',
    pasteToAgent: '粘贴给你的 Agent',
    step1: 'Agent 会自动访问安装 API 获取 Skill 内容',
    step2: 'Agent 会创建目录并保存 SKILL.md 文件',
    step3: '重启会话后，说 <code>帮我打包这个问题</code> 即可使用',
    compatTitle: '兼容的 Agent 平台',
    claudeDesc: '原生支持 Skills。安装后自动识别 <code>agentslink.link</code> 链接。',
    otherTitle: '其他 Agent',
    otherDesc: '即使未安装 Skill，收到链接后 API 返回的 <code>_instructions</code> 字段会指导 Agent 如何回复。',
    copy: '复制', expire: '链接 24 小时后过期',
  },
  en: {
    title: 'Install AgentsLink',
    subtitle: 'Give your AI Agent collaboration capabilities \\u2014 package problem context, generate links, analyze requests, and reply.',
    method1Title: '<span class="badge badge-recommend">Recommended</span> One-line install',
    method1Note: 'Automatically creates directory and downloads the Skill file to ~/.claude/skills/agents-link/. Restart your Claude Code session after install.',
    method2Title: '<span class="badge badge-alt">Method 2</span> Tell your Agent',
    pasteToAgent: 'Paste to your Agent',
    step1: 'Your Agent will fetch the Skill content from the install API',
    step2: 'Your Agent will create the directory and save the SKILL.md file',
    step3: 'After restarting, say <code>pack this problem</code> to start using it',
    compatTitle: 'Compatible Agent Platforms',
    claudeDesc: 'Native Skills support. Auto-detects <code>agentslink.link</code> links after install.',
    otherTitle: 'Other Agents',
    otherDesc: 'Even without the Skill installed, the API response includes <code>_instructions</code> to guide any Agent on how to reply.',
    copy: 'Copy', expire: 'Link expires in 24h',
  }
};
var lang = /^zh/i.test(navigator.language) ? 'zh' : 'en';
var t = i18n[lang];
document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
document.title = lang === 'zh' ? 'AgentsLink - 安装' : 'AgentsLink - Install';
document.querySelectorAll('[data-i18n]').forEach(function(el) {
  var key = el.dataset.i18n;
  if (t[key]) el[el.dataset.i18nHtml ? 'innerHTML' : 'textContent'] = t[key];
});
// fix: h2 with badges need innerHTML
document.querySelectorAll('h2[data-i18n]').forEach(function(el) {
  var key = el.dataset.i18n;
  if (t[key]) el.innerHTML = t[key];
});
// fix: step3 and desc with code tags
['step1','step2','step3','claudeDesc','otherDesc','method1Note'].forEach(function(k) {
  var el = document.querySelector('[data-i18n="'+k+'"]');
  if (el && t[k]) el.innerHTML = t[k];
});

function copyText(preId, btnId) {
  var el = document.getElementById(preId);
  navigator.clipboard.writeText(el.innerText).then(function() {
    var btn = document.getElementById(btnId);
    btn.classList.add('copied');
    var span = btn.querySelector('span');
    var orig = span.textContent;
    span.textContent = lang === 'zh' ? '已复制' : 'Copied';
    showToast(lang === 'zh' ? '已复制' : 'Copied');
    setTimeout(function() { btn.classList.remove('copied'); span.textContent = orig; }, 2000);
  });
}
function showToast(msg) {
  var toast = document.getElementById('toast');
  toast.textContent = msg; toast.classList.add('show');
  setTimeout(function() { toast.classList.remove('show'); }, 2200);
}`;

  return new Response(pageShell(css, body, script, { noindex: false }), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
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

  return new Response(pageShell(css, body, script, { noindex: false }), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
