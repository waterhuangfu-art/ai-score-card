// POST /api/submit — creates a GitHub Issue with scoring data

const REPO = 'waterhuangfu-art/ai-score-card';

const ipTimes = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const window = 5 * 60 * 1000;
  const times = (ipTimes.get(ip) || []).filter(t => now - t < window);
  if (times.length >= 5) return true;
  times.push(now);
  ipTimes.set(ip, times);
  return false;
}

function stageOf(total) {
  if (total <= 9)  return '尝鲜期';
  if (total <= 14) return '工具期';
  if (total <= 19) return '系统期';
  return '杠杆期';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: '提交太频繁，请稍后再试' });

  let payload;
  try { payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: '请求格式错误' }); }

  const { name, scores, total, stage, breakthrough, action, session } = payload || {};
  if (!name?.trim()) return res.status(400).json({ error: '姓名不能为空' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: '服务器未配置，请联系管理员' });

  const s = scores || {};
  const issueTitle = `[评分] ${name} · ${total}分 · ${stage || stageOf(total)}`;
  const issueBody = `## 基本信息
| 字段 | 内容 |
|------|------|
| 姓名 | ${name} |
| 场次 | ${session || '—'} |
| 总分 | **${total} / 25** |
| 阶段 | **${stage || stageOf(total)}** |

## 五维评分
| 维度 | 分数 |
|------|------|
| 使用频率 | ${s.frequency || '—'} |
| 场景覆盖 | ${s.coverage || '—'} |
| 应用深度 | ${s.depth || '—'} |
| 结果产出 | ${s.result || '—'} |
| 系统化程度 | ${s.system || '—'} |

## 最想突破
${breakthrough || '（未填写）'}

## 72小时行动计划
| 项目 | 内容 |
|------|------|
| 聚焦场景 | ${action?.scene || '（未填写）'} |
| 要复制的做法 | ${action?.copy || '（未填写）'} |
| 72h第一步 | ${action?.firstStep || '（未填写）'} |
| 验收指标 | ${action?.metric || '（未填写）'} |
| 可能阻碍→应对 | ${action?.obstacle || '（未填写）'} |

---
*提交时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}*`;

  // Labels: stage + session
  const labels = [stage || stageOf(total)];
  if (session) labels.push(session);

  try {
    // Ensure labels exist first (ignore errors)
    const stageColors = { '尝鲜期': 'FEF3C7', '工具期': 'DBEAFE', '系统期': 'D1FAE5', '杠杆期': 'EDE9FE' };
    const stageLabel = stage || stageOf(total);
    await fetch(`https://api.github.com/repos/${REPO}/labels`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ name: stageLabel, color: stageColors[stageLabel] || 'ededed' }),
    });
    if (session) {
      await fetch(`https://api.github.com/repos/${REPO}/labels`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
        body: JSON.stringify({ name: session, color: '0075ca' }),
      });
    }

    // Create issue
    const issueRes = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ title: issueTitle, body: issueBody, labels }),
    });
    const issue = await issueRes.json();
    if (!issueRes.ok) throw new Error(issue.message || '创建失败');

    return res.status(200).json({ success: true, issueNumber: issue.number });
  } catch (err) {
    console.error('GitHub API error:', err.message);
    return res.status(500).json({ error: '提交失败，请重试' });
  }
}
