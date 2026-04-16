const REPO = 'waterhuangfu-art/ai-score-card';
const BASE_LABEL = 'opc-self-card';
const ISSUE_PREFIX = '[OPC自评]';

const DIMENSIONS = [
  { key: 'experience', label: '行业经验深度' },
  { key: 'delivery', label: '可复制的交付能力' },
  { key: 'tools', label: '工具 / AI 使用能力' },
  { key: 'brand', label: '个人品牌 / 流量' },
  { key: 'finance', label: '财务准备度' }
];

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

function parseRequestBody(req) {
  const body = req.body;
  if (!body) return {};
  if (typeof body === 'string') return JSON.parse(body);
  return body;
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

function buildIssueBody(payload) {
  const scores = {};
  const reasons = {};

  for (const dim of DIMENSIONS) {
    scores[dim.key] = normalizeScore(payload?.scores?.[dim.key]);
    reasons[dim.key] = cleanText(payload?.reasons?.[dim.key], 180);
  }

  if (Object.values(scores).some((score) => !score)) {
    throw new Error('请先完成全部五个维度的评分');
  }

  const name = cleanText(payload?.name, 24);
  if (!name) {
    throw new Error('姓名不能为空');
  }

  const session = cleanText(payload?.session, 40);
  const total = Object.values(scores).reduce((sum, score) => sum + score, 0);
  const stage = stageOf(total);
  const breakthroughs = Array.isArray(payload?.breakthroughs)
    ? payload.breakthroughs.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 10)
    : [];

  const scoreRows = DIMENSIONS.map((dim) => (
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

  const labels = [BASE_LABEL, stage];
  if (session) labels.push(session);

  return {
    name,
    session,
    total,
    stage,
    body,
    labels
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let payload;
  try {
    payload = parseRequestBody(req);
  } catch {
    return res.status(400).json({ success: false, error: '请求格式错误' });
  }

  const issueNumber = Number(payload?.issueNumber);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    return res.status(400).json({ success: false, error: 'issueNumber 无效' });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({ success: false, error: '服务器未配置，请联系管理员' });
  }

  try {
    if (payload?.action === 'delete') {
      const response = await fetch(`https://api.github.com/repos/${REPO}/issues/${issueNumber}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({ state: 'closed' })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || '删除失败');
      }

      return res.status(200).json({ success: true, issueNumber, deleted: true });
    }

    if (payload?.action !== 'update') {
      return res.status(400).json({ success: false, error: '不支持的操作' });
    }

    const next = buildIssueBody(payload);

    const labelColors = {
      [BASE_LABEL]: '0ea5e9',
      '观望期': 'f59e0b',
      '准备期': '3b82f6',
      '启动期': '10b981',
      '加速期': '8b5cf6'
    };

    await ensureLabel(token, BASE_LABEL, labelColors[BASE_LABEL]);
    await ensureLabel(token, next.stage, labelColors[next.stage] || '94a3b8');
    if (next.session) {
      await ensureLabel(token, next.session, '2563eb');
    }

    const response = await fetch(`https://api.github.com/repos/${REPO}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({
        title: `${ISSUE_PREFIX} ${next.name} · ${next.total}分 · ${next.stage}`,
        body: next.body,
        labels: next.labels,
        state: 'open'
      })
    });

    const issue = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(issue.message || '更新失败');
    }

    return res.status(200).json({
      success: true,
      issueNumber,
      total: next.total,
      stage: next.stage
    });
  } catch (err) {
    console.error('manage opc error:', err.message);
    return res.status(500).json({ success: false, error: err.message || '操作失败' });
  }
}
