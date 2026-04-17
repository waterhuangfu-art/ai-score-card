const DEFAULT_REPO = 'waterhuangfu-art/ai-score-card';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const aiRateLimit = new Map();
const opcRateLimit = new Map();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders
    }
  });
}

function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...corsHeaders
    }
  });
}

function cleanText(value, maxLength = 120) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\|/g, '｜')
    .trim()
    .slice(0, maxLength);
}

function normalizeScore(value) {
  const num = Number(value);
  return Number.isInteger(num) && num >= 1 && num <= 5 ? num : 0;
}

function normalizeOrigin(value) {
  const input = String(value || '').trim();
  if (!input) return '';

  try {
    return new URL(input).origin;
  } catch {
    return '';
  }
}

function getClientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function isRateLimited(store, ip) {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const recent = (store.get(ip) || []).filter((time) => now - time < windowMs);
  if (recent.length >= 5) return true;
  recent.push(now);
  store.set(ip, recent);
  return false;
}

async function parseBody(request) {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return await request.json();
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await request.formData();
    const payload = formData.get('payload');
    if (typeof payload === 'string') {
      const parsed = JSON.parse(payload);
      const origin = formData.get('origin');
      if (origin && !parsed.origin) parsed.origin = origin;
      return parsed;
    }

    return Object.fromEntries(formData.entries());
  }

  const raw = await request.text();
  if (!raw.trim()) return {};
  if (raw.trim().startsWith('{')) {
    return JSON.parse(raw);
  }

  const params = new URLSearchParams(raw);
  const payload = params.get('payload');
  if (payload) {
    const parsed = JSON.parse(payload);
    const origin = params.get('origin');
    if (origin && !parsed.origin) parsed.origin = origin;
    return parsed;
  }

  return Object.fromEntries(params.entries());
}

function wantsIframeResponse(url) {
  return String(url.searchParams.get('mode') || '').toLowerCase() === 'iframe';
}

function getRequestOrigin(request, payload) {
  return (
    normalizeOrigin(payload?.origin) ||
    normalizeOrigin(request.headers.get('origin')) ||
    normalizeOrigin(request.headers.get('referer'))
  );
}

function iframeResponse(request, payload, messageType, status, data) {
  const targetOrigin = getRequestOrigin(request, payload) || '*';
  const message = { ...data, origin: payload?.origin, type: messageType };

  return html(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><title>提交结果</title></head>
<body>
<script>
  window.parent && window.parent.postMessage(${JSON.stringify(message)}, ${JSON.stringify(targetOrigin)});
</script>
</body>
</html>`, status);
}

function respond(request, url, payload, messageType, status, data) {
  if (wantsIframeResponse(url)) {
    return iframeResponse(request, payload, messageType, status, data);
  }
  return json(data, status);
}

async function ensureLabel(token, repo, name, color) {
  const response = await fetch(`https://api.github.com/repos/${repo}/labels`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({ name, color })
  });

  if (response.ok || response.status === 422) return;

  const data = await response.json().catch(() => ({}));
  throw new Error(data.message || `创建标签失败: ${name}`);
}

async function createIssue(token, repo, title, body, labels) {
  const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({ title, body, labels })
  });

  const issue = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(issue.message || '创建记录失败');
  }

  return issue;
}

async function updateIssue(token, repo, issueNumber, payload) {
  const response = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify(payload)
  });

  const issue = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(issue.message || '更新失败');
  }

  return issue;
}

async function listIssues(token, repo, label) {
  const params = new URLSearchParams({
    state: 'open',
    per_page: '100'
  });

  if (label) {
    params.set('labels', label);
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/issues?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  const issues = await response.json().catch(() => ([]));
  if (!response.ok) {
    throw new Error(issues.message || '获取记录失败');
  }

  return Array.isArray(issues) ? issues : [];
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getTableValue(body, label) {
  const re = new RegExp(`\\|\\s*${escapeRegExp(label)}\\s*\\|\\s*(.+?)\\s*\\|`);
  const match = String(body || '').match(re);
  return match ? match[1].replace(/\*\*/g, '').trim() : '';
}

function getSectionList(body, title) {
  const re = new RegExp(`##\\s+${escapeRegExp(title)}\\n([\\s\\S]*?)(?:\\n##\\s+|$)`);
  const match = String(body || '').match(re);
  if (!match) return [];

  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

function getDimensionReason(body, label) {
  const re = new RegExp(`\\|\\s*${escapeRegExp(label)}\\s*\\|\\s*.+?\\|\\s*(.+?)\\s*\\|`);
  const match = String(body || '').match(re);
  return match ? match[1].replace(/\*\*/g, '').trim() : '';
}

function sortRecords(a, b) {
  return (b.total - a.total) || (new Date(b.createdAt) - new Date(a.createdAt));
}

function parseAiIssue(issue) {
  const body = issue.body || '';

  return {
    number: issue.number,
    url: issue.html_url,
    name: getTableValue(body, '姓名'),
    session: getTableValue(body, '场次'),
    total: parseInt(getTableValue(body, '总分'), 10) || 0,
    stage: getTableValue(body, '阶段'),
    frequency: parseInt(getTableValue(body, '使用频率'), 10) || 0,
    coverage: parseInt(getTableValue(body, '场景覆盖'), 10) || 0,
    depth: parseInt(getTableValue(body, '应用深度'), 10) || 0,
    result: parseInt(getTableValue(body, '结果产出'), 10) || 0,
    system: parseInt(getTableValue(body, '系统化程度'), 10) || 0,
    breakthrough: getTableValue(body, '最想突破') === '（未填写）' ? '' : getTableValue(body, '最想突破'),
    firstStep: getTableValue(body, '72h第一步') === '（未填写）' ? '' : getTableValue(body, '72h第一步'),
    actionScene: getTableValue(body, '聚焦场景') === '（未填写）' ? '' : getTableValue(body, '聚焦场景'),
    actionCopy: getTableValue(body, '要复制的做法') === '（未填写）' ? '' : getTableValue(body, '要复制的做法'),
    actionMetric: getTableValue(body, '验收指标') === '（未填写）' ? '' : getTableValue(body, '验收指标'),
    actionObstacle: getTableValue(body, '阻碍与应对') === '（未填写）' ? '' : getTableValue(body, '阻碍与应对'),
    createdAt: issue.created_at
  };
}

function parseOpcIssue(issue) {
  const body = issue.body || '';

  return {
    number: issue.number,
    url: issue.html_url,
    name: getTableValue(body, '姓名'),
    session: getTableValue(body, '场次'),
    total: parseInt(getTableValue(body, '总分'), 10) || 0,
    stage: getTableValue(body, '阶段'),
    experience: parseInt(getTableValue(body, '行业经验深度'), 10) || 0,
    delivery: parseInt(getTableValue(body, '可复制的交付能力'), 10) || 0,
    tools: parseInt(getTableValue(body, '工具 / AI 使用能力'), 10) || 0,
    brand: parseInt(getTableValue(body, '个人品牌 / 流量'), 10) || 0,
    finance: parseInt(getTableValue(body, '财务准备度'), 10) || 0,
    reasonExperience: getDimensionReason(body, '行业经验深度'),
    reasonDelivery: getDimensionReason(body, '可复制的交付能力'),
    reasonTools: getDimensionReason(body, '工具 / AI 使用能力'),
    reasonBrand: getDimensionReason(body, '个人品牌 / 流量'),
    reasonFinance: getDimensionReason(body, '财务准备度'),
    breakthroughs: getSectionList(body, '最想突破'),
    createdAt: issue.created_at
  };
}

function buildResultsPayload(records, dimensions, session) {
  const totals = records.map((item) => item.total);
  const averages = {};

  for (const dim of dimensions) {
    averages[dim.key] = records.length
      ? Number((records.reduce((sum, item) => sum + (item[dim.key] || 0), 0) / records.length).toFixed(1))
      : 0;
  }

  const stageCounts = {};
  for (const item of records) {
    stageCounts[item.stage] = (stageCounts[item.stage] || 0) + 1;
  }

  return {
    session,
    dimensions,
    count: records.length,
    stats: {
      avgTotal: records.length ? Number((totals.reduce((sum, value) => sum + value, 0) / records.length).toFixed(1)) : 0,
      maxScore: records.length ? Math.max(...totals) : 0,
      minScore: records.length ? Math.min(...totals) : 0,
      totalCount: records.length
    },
    averages,
    stageCounts,
    records
  };
}

function aiStageOf(total) {
  if (total <= 9) return '尝鲜期';
  if (total <= 14) return '工具期';
  if (total <= 19) return '系统期';
  return '杠杆期';
}

function opcStageOf(total) {
  if (total <= 9) return '观望期';
  if (total <= 14) return '准备期';
  if (total <= 19) return '启动期';
  return '加速期';
}

function buildAiBody(payload) {
  const dimensions = [
    { key: 'frequency', label: '使用频率' },
    { key: 'coverage', label: '场景覆盖' },
    { key: 'depth', label: '应用深度' },
    { key: 'result', label: '结果产出' },
    { key: 'system', label: '系统化程度' }
  ];

  const scores = {};
  for (const dim of dimensions) {
    scores[dim.key] = normalizeScore(payload?.scores?.[dim.key]);
  }

  if (Object.values(scores).some((score) => !score)) {
    throw new Error('请先完成全部五个维度的评分');
  }

  const name = cleanText(payload?.name, 24);
  if (!name) throw new Error('姓名不能为空');

  const session = cleanText(payload?.session, 40);
  const total = Object.values(scores).reduce((sum, score) => sum + score, 0);
  const stage = cleanText(payload?.stage, 20) || aiStageOf(total);
  const breakthrough = cleanText(payload?.breakthrough, 180);
  const plan = payload?.actionPlan || payload?.action || {};
  const action = {
    scene: cleanText(plan?.scene, 180),
    copy: cleanText(plan?.copy, 180),
    firstStep: cleanText(plan?.firstStep, 180),
    metric: cleanText(plan?.metric, 180),
    obstacle: cleanText(plan?.obstacle, 180)
  };

  const body = `## 基本信息
| 字段 | 内容 |
|------|------|
| 姓名 | ${name} |
| 场次 | ${session || '—'} |
| 总分 | **${total} / 25** |
| 阶段 | **${stage}** |
| 使用频率 | ${scores.frequency} |
| 场景覆盖 | ${scores.coverage} |
| 应用深度 | ${scores.depth} |
| 结果产出 | ${scores.result} |
| 系统化程度 | ${scores.system} |
| 最想突破 | ${breakthrough || '（未填写）'} |
| 72h第一步 | ${action.firstStep || '（未填写）'} |

## 72h行动计划
| 项目 | 内容 |
|------|------|
| 聚焦场景 | ${action.scene || '（未填写）'} |
| 要复制的做法 | ${action.copy || '（未填写）'} |
| 72h第一步 | ${action.firstStep || '（未填写）'} |
| 验收指标 | ${action.metric || '（未填写）'} |
| 阻碍与应对 | ${action.obstacle || '（未填写）'} |

---
*更新时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}*`;

  return {
    title: `[评分] ${name} · ${total}分 · ${stage}`,
    labels: ['ai-score-card', stage].concat(session ? [session] : []),
    body,
    total,
    stage
  };
}

function buildOpcBody(payload) {
  const dimensions = [
    { key: 'experience', label: '行业经验深度' },
    { key: 'delivery', label: '可复制的交付能力' },
    { key: 'tools', label: '工具 / AI 使用能力' },
    { key: 'brand', label: '个人品牌 / 流量' },
    { key: 'finance', label: '财务准备度' }
  ];

  const scores = {};
  const reasons = {};
  for (const dim of dimensions) {
    scores[dim.key] = normalizeScore(payload?.scores?.[dim.key]);
    reasons[dim.key] = cleanText(payload?.reasons?.[dim.key], 180);
  }

  if (Object.values(scores).some((score) => !score)) {
    throw new Error('请先完成全部五个维度的评分');
  }

  const name = cleanText(payload?.name, 24);
  if (!name) throw new Error('姓名不能为空');

  const session = cleanText(payload?.session, 40);
  const total = Object.values(scores).reduce((sum, score) => sum + score, 0);
  const stage = opcStageOf(total);
  const breakthroughs = Array.isArray(payload?.breakthroughs)
    ? payload.breakthroughs.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 10)
    : [];

  const scoreRows = dimensions.map((dim) => (
    `| ${dim.label} | ${scores[dim.key]} | ${reasons[dim.key] || '（未填写）'} |`
  )).join('\n');

  const breakthroughSection = breakthroughs.length
    ? breakthroughs.map((item) => `- ${item}`).join('\n')
    : '（未填写）';

  const body = `## 基本信息
| 字段 | 内容 |
|------|------|
| 姓名 | ${name} |
| 场次 | ${session || '—'} |
| 总分 | **${total} / 25** |
| 阶段 | **${stage}** |

## 五维评分
| 维度 | 分数 | 理由 |
|------|------|------|
${scoreRows}

## 最想突破
${breakthroughSection}

---
*更新时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}*`;

  return {
    title: `[OPC自评] ${name} · ${total}分 · ${stage}`,
    labels: ['opc-self-card', stage].concat(session ? [session] : []),
    body,
    total,
    stage
  };
}

async function handleSubmitAi(request, url, env) {
  let payload;
  try {
    payload = await parseBody(request);
  } catch {
    return respond(request, url, {}, 'ai-submit-result', 400, { success: false, error: '请求格式错误' });
  }

  const ip = getClientIp(request);
  if (isRateLimited(aiRateLimit, ip)) {
    return respond(request, url, payload, 'ai-submit-result', 429, { success: false, error: '提交太频繁，请稍后再试' });
  }

  const token = env.GITHUB_TOKEN;
  if (!token) {
    return respond(request, url, payload, 'ai-submit-result', 500, { success: false, error: '服务器未配置，请联系管理员' });
  }

  try {
    const repo = env.REPO || DEFAULT_REPO;
    const result = buildAiBody(payload);
    await ensureLabel(token, repo, 'ai-score-card', '0ea5e9');
    await ensureLabel(token, repo, result.stage, {
      '尝鲜期': 'f59e0b',
      '工具期': '3b82f6',
      '系统期': '10b981',
      '杠杆期': '8b5cf6'
    }[result.stage] || '94a3b8');
    for (const label of result.labels.slice(2)) {
      await ensureLabel(token, repo, label, '2563eb');
    }

    const issue = await createIssue(token, repo, result.title, result.body, result.labels);
    return respond(request, url, payload, 'ai-submit-result', 200, {
      success: true,
      total: result.total,
      stage: result.stage,
      issueNumber: issue.number
    });
  } catch (error) {
    return respond(request, url, payload, 'ai-submit-result', 500, {
      success: false,
      error: error.message || '提交失败'
    });
  }
}

async function handleSubmitOpc(request, url, env) {
  let payload;
  try {
    payload = await parseBody(request);
  } catch {
    return respond(request, url, {}, 'opc-submit-result', 400, { success: false, error: '请求格式错误' });
  }

  const ip = getClientIp(request);
  if (isRateLimited(opcRateLimit, ip)) {
    return respond(request, url, payload, 'opc-submit-result', 429, { success: false, error: '提交太频繁，请稍后再试' });
  }

  const token = env.GITHUB_TOKEN;
  if (!token) {
    return respond(request, url, payload, 'opc-submit-result', 500, { success: false, error: '服务器未配置，请联系管理员' });
  }

  try {
    const repo = env.REPO || DEFAULT_REPO;
    const result = buildOpcBody(payload);
    await ensureLabel(token, repo, 'opc-self-card', '0ea5e9');
    await ensureLabel(token, repo, result.stage, {
      '观望期': 'f59e0b',
      '准备期': '3b82f6',
      '启动期': '10b981',
      '加速期': '8b5cf6'
    }[result.stage] || '94a3b8');
    for (const label of result.labels.slice(2)) {
      await ensureLabel(token, repo, label, '2563eb');
    }

    const issue = await createIssue(token, repo, result.title, result.body, result.labels);
    return respond(request, url, payload, 'opc-submit-result', 200, {
      success: true,
      total: result.total,
      stage: result.stage,
      issueNumber: issue.number
    });
  } catch (error) {
    return respond(request, url, payload, 'opc-submit-result', 500, {
      success: false,
      error: error.message || '提交失败'
    });
  }
}

async function handleManage(request, builder, repoLabelColors, issuePrefix, env) {
  let payload;
  try {
    payload = await parseBody(request);
  } catch {
    return json({ success: false, error: '请求格式错误' }, 400);
  }

  const issueNumber = Number(payload?.issueNumber);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    return json({ success: false, error: 'issueNumber 无效' }, 400);
  }

  const token = env.GITHUB_TOKEN;
  if (!token) {
    return json({ success: false, error: '服务器未配置，请联系管理员' }, 500);
  }

  try {
    const repo = env.REPO || DEFAULT_REPO;

    if (payload?.action === 'delete') {
      await updateIssue(token, repo, issueNumber, { state: 'closed' });
      return json({ success: true, issueNumber, deleted: true }, 200);
    }

    if (payload?.action !== 'update') {
      return json({ success: false, error: '不支持的操作' }, 400);
    }

    const next = builder(payload);
    for (const [label, color] of Object.entries(repoLabelColors)) {
      await ensureLabel(token, repo, label, color);
    }
    for (const label of next.labels) {
      if (!repoLabelColors[label]) {
        await ensureLabel(token, repo, label, '2563eb');
      }
    }

    await updateIssue(token, repo, issueNumber, {
      title: `${issuePrefix} ${next.title.replace(/^\[[^\]]+\]\s*/, '')}`,
      body: next.body,
      labels: next.labels,
      state: 'open'
    });

    return json({
      success: true,
      issueNumber,
      total: next.total,
      stage: next.stage
    }, 200);
  } catch (error) {
    return json({ success: false, error: error.message || '操作失败' }, 500);
  }
}

async function handleResultsAi(url, env) {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    return json({ error: '服务器未配置，请联系管理员' }, 500);
  }

  const repo = env.REPO || DEFAULT_REPO;
  const session = cleanText(url.searchParams.get('session'), 40);

  try {
    const issues = await listIssues(token, repo, 'ai-score-card');
    const records = issues
      .filter((issue) => issue.title && issue.title.startsWith('[评分]'))
      .map(parseAiIssue)
      .filter((record) => !session || record.session === session)
      .sort(sortRecords);

    return json(buildResultsPayload(records, [
      { key: 'frequency', label: '使用频率', short: '频' },
      { key: 'coverage', label: '场景覆盖', short: '覆' },
      { key: 'depth', label: '应用深度', short: '深' },
      { key: 'result', label: '结果产出', short: '果' },
      { key: 'system', label: '系统化程度', short: '系' }
    ], session));
  } catch (error) {
    return json({ error: error.message || '获取后台数据失败' }, 500);
  }
}

async function handleResultsOpc(url, env) {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    return json({ error: '服务器未配置，请联系管理员' }, 500);
  }

  const repo = env.REPO || DEFAULT_REPO;
  const session = cleanText(url.searchParams.get('session'), 40);

  try {
    const issues = await listIssues(token, repo, 'opc-self-card');
    const records = issues
      .filter((issue) => issue.title && issue.title.startsWith('[OPC自评]'))
      .map(parseOpcIssue)
      .filter((record) => !session || record.session === session)
      .sort(sortRecords);

    return json(buildResultsPayload(records, [
      { key: 'experience', label: '行业经验深度', short: '经' },
      { key: 'delivery', label: '可复制的交付能力', short: '交' },
      { key: 'tools', label: '工具 / AI 使用能力', short: '工' },
      { key: 'brand', label: '个人品牌 / 流量', short: '品' },
      { key: 'finance', label: '财务准备度', short: '财' }
    ], session));
  } catch (error) {
    return json({ error: error.message || '获取后台数据失败' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    if (request.method === 'GET') {
      if (url.pathname === '/api/results-ai') {
        return handleResultsAi(url, env);
      }

      if (url.pathname === '/api/results-opc') {
        return handleResultsOpc(url, env);
      }

      return json({ error: 'Method not allowed' }, 405);
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    if (url.pathname === '/api/submit-ai') {
      return handleSubmitAi(request, url, env);
    }

    if (url.pathname === '/api/submit-opc') {
      return handleSubmitOpc(request, url, env);
    }

    if (url.pathname === '/api/manage-ai') {
      return handleManage(
        request,
        buildAiBody,
        {
          'ai-score-card': '0ea5e9',
          '尝鲜期': 'f59e0b',
          '工具期': '3b82f6',
          '系统期': '10b981',
          '杠杆期': '8b5cf6'
        },
        '[评分]',
        env
      );
    }

    if (url.pathname === '/api/manage-opc') {
      return handleManage(
        request,
        buildOpcBody,
        {
          'opc-self-card': '0ea5e9',
          '观望期': 'f59e0b',
          '准备期': '3b82f6',
          '启动期': '10b981',
          '加速期': '8b5cf6'
        },
        '[OPC自评]',
        env
      );
    }

    return json({ error: 'Not found' }, 404);
  }
};
