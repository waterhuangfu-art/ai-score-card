const REPO = 'waterhuangfu-art/ai-score-card';
const BASE_LABEL = 'opc-self-card';
const ISSUE_PREFIX = '[OPC自评]';

const ipTimes = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const recent = (ipTimes.get(ip) || []).filter((time) => now - time < windowMs);
  if (recent.length >= 5) return true;
  recent.push(now);
  ipTimes.set(ip, recent);
  return false;
}

function stageOf(total) {
  if (total <= 9) return '观望期';
  if (total <= 14) return '准备期';
  if (total <= 19) return '启动期';
  return '加速期';
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

async function ensureLabel(token, name, color) {
  const response = await fetch(`https://api.github.com/repos/${REPO}/labels`, {
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: '提交太频繁，请稍后再试' });
  }

  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: '请求格式错误' });
  }

  const dimensions = [
    { key: 'experience', label: '行业经验深度' },
    { key: 'delivery', label: '可复制的交付能力' },
    { key: 'tools', label: '工具 / AI 使用能力' },
    { key: 'brand', label: '个人品牌 / 流量' },
    { key: 'finance', label: '财务准备度' }
  ];

  const rawScores = payload?.scores || {};
  const rawReasons = payload?.reasons || {};

  const scores = {};
  const reasons = {};
  for (const dim of dimensions) {
    scores[dim.key] = normalizeScore(rawScores[dim.key]);
    reasons[dim.key] = cleanText(rawReasons[dim.key], 180);
  }

  if (Object.values(scores).some((score) => !score)) {
    return res.status(400).json({ error: '请先完成全部五个维度的评分' });
  }

  const total = Object.values(scores).reduce((sum, score) => sum + score, 0);
  const stage = stageOf(total);
  const name = cleanText(payload?.name, 24);
  const session = cleanText(payload?.session, 40);
  const breakthroughs = Array.isArray(payload?.breakthroughs)
    ? payload.breakthroughs.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 6)
    : [];

  if (!name) {
    return res.status(400).json({ error: '姓名不能为空' });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({ error: '服务器未配置，请联系管理员' });
  }

  const issueTitle = `${ISSUE_PREFIX} ${name} · ${total}分 · ${stage}`;
  const scoreRows = dimensions.map((dim) => (
    `| ${dim.label} | ${scores[dim.key]} | ${reasons[dim.key] || '（未填写）'} |`
  )).join('\n');
  const breakthroughSection = breakthroughs.length
    ? breakthroughs.map((item) => `- ${item}`).join('\n')
    : '（未填写）';

  const issueBody = `## 基本信息
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
*提交时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}*`;

  const labels = [BASE_LABEL, stage];
  if (session) labels.push(session);

  try {
    const labelColors = {
      [BASE_LABEL]: '0ea5e9',
      '观望期': 'f59e0b',
      '准备期': '3b82f6',
      '启动期': '10b981',
      '加速期': '8b5cf6'
    };

    await ensureLabel(token, BASE_LABEL, labelColors[BASE_LABEL]);
    await ensureLabel(token, stage, labelColors[stage] || '94a3b8');
    if (session) {
      await ensureLabel(token, session, '2563eb');
    }

    const issueResponse = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({
        title: issueTitle,
        body: issueBody,
        labels
      })
    });

    const issue = await issueResponse.json();
    if (!issueResponse.ok) {
      throw new Error(issue.message || '创建 Issue 失败');
    }

    return res.status(200).json({
      success: true,
      issueNumber: issue.number,
      total,
      stage
    });
  } catch (err) {
    console.error('GitHub API error:', err.message);
    return res.status(500).json({ error: '提交失败，请重试' });
  }
}
