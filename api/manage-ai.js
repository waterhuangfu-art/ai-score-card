const REPO = 'waterhuangfu-art/ai-score-card';
const BASE_LABEL = 'ai-score-card';
const ISSUE_PREFIX = '[评分]';

const DIMENSIONS = [
  { key: 'frequency', label: '使用频率' },
  { key: 'coverage', label: '场景覆盖' },
  { key: 'depth', label: '应用深度' },
  { key: 'result', label: '结果产出' },
  { key: 'system', label: '系统化程度' }
];

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
  DIMENSIONS.forEach((dim) => {
    scores[dim.key] = normalizeScore(payload?.scores?.[dim.key]);
  });

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
  const breakthrough = cleanText(payload?.breakthrough, 180);
  const plan = payload?.actionPlan || {};
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

  const labels = [BASE_LABEL, stage];
  if (session) labels.push(session);

  return {
    name,
    session,
    total,
    stage,
    breakthrough,
    action,
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
      '尝鲜期': 'f59e0b',
      '工具期': '3b82f6',
      '系统期': '10b981',
      '杠杆期': '8b5cf6'
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
    console.error('manage ai error:', err.message);
    return res.status(500).json({ success: false, error: err.message || '操作失败' });
  }
}
