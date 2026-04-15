const REPO = 'waterhuangfu-art/ai-score-card';
const BASE_LABEL = 'ai-score-card';
const ISSUE_PREFIX = '[评分]';

const ipTimes = new Map();

const dimensions = [
  { key: 'frequency', label: '使用频率' },
  { key: 'coverage', label: '场景覆盖' },
  { key: 'depth', label: '应用深度' },
  { key: 'result', label: '结果产出' },
  { key: 'system', label: '系统化程度' }
];

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
  if (total <= 9) return '尝鲜期';
  if (total <= 14) return '工具期';
  if (total <= 19) return '系统期';
  return '杠杆期';
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

  const scores = {};
  dimensions.forEach((dim) => {
    scores[dim.key] = normalizeScore(payload?.scores?.[dim.key]);
  });

  if (Object.values(scores).some((score) => !score)) {
    return res.status(400).json({ error: '请先完成全部五个维度的评分' });
  }

  const name = cleanText(payload?.name, 24);
  if (!name) {
    return res.status(400).json({ error: '姓名不能为空' });
  }

  const total = Object.values(scores).reduce((sum, score) => sum + score, 0);
  const stage = cleanText(payload?.stage, 20) || stageOf(total);
  const session = cleanText(payload?.session, 40);
  const breakthrough = cleanText(payload?.breakthrough, 180);
  const action = {
    scene: cleanText(payload?.action?.scene, 180),
    copy: cleanText(payload?.action?.copy, 180),
    firstStep: cleanText(payload?.action?.firstStep, 180),
    metric: cleanText(payload?.action?.metric, 180),
    obstacle: cleanText(payload?.action?.obstacle, 180)
  };

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({ error: '服务器未配置，请联系管理员' });
  }

  const issueTitle = `${ISSUE_PREFIX} ${name} · ${total}分 · ${stage}`;
  const labels = [BASE_LABEL, stage];
  if (session) labels.push(session);

  const issueBody = `## 基本信息
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
*提交时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}*`;

  try {
    const labelColors = {
      [BASE_LABEL]: '0ea5e9',
      '尝鲜期': 'f59e0b',
      '工具期': '3b82f6',
      '系统期': '10b981',
      '杠杆期': '8b5cf6'
    };

    await ensureLabel(token, BASE_LABEL, labelColors[BASE_LABEL]);
    await ensureLabel(token, stage, labelColors[stage] || '94a3b8');
    if (session) await ensureLabel(token, session, '2563eb');

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
