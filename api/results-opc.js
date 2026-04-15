const REPO = 'waterhuangfu-art/ai-score-card';
const BASE_LABEL = 'opc-self-card';
const ISSUE_PREFIX = '[OPC自评]';

const dimensions = [
  { key: 'experience', label: '行业经验深度', short: '经' },
  { key: 'delivery', label: '可复制的交付能力', short: '交' },
  { key: 'tools', label: '工具 / AI 使用能力', short: '工' },
  { key: 'brand', label: '个人品牌 / 流量', short: '品' },
  { key: 'finance', label: '财务准备度', short: '财' }
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getTableValue(body, label) {
  const re = new RegExp(`\\|\\s*${escapeRegExp(label)}\\s*\\|\\s*(.+?)\\s*\\|`);
  const match = body.match(re);
  return match ? match[1].replace(/\*\*/g, '').trim() : '';
}

function getSectionList(body, title) {
  const re = new RegExp(`##\\s+${escapeRegExp(title)}\\n([\\s\\S]*?)(?:\\n##\\s+|$)`);
  const match = body.match(re);
  if (!match) return [];
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

function parseIssue(issue) {
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
    breakthroughs: getSectionList(body, '最想突破'),
    createdAt: issue.created_at
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({ error: '服务器未配置 GITHUB_TOKEN' });
  }

  const session = String(req.query?.session || '').trim();
  const labels = [BASE_LABEL];
  if (session) labels.push(session);

  try {
    const githubRes = await fetch(
      `https://api.github.com/repos/${REPO}/issues?state=open&per_page=100&labels=${encodeURIComponent(labels.join(','))}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }
    );

    const issues = await githubRes.json();
    if (!githubRes.ok) {
      throw new Error(issues.message || `GitHub API 返回 ${githubRes.status}`);
    }

    const records = issues
      .filter((issue) => issue.title && issue.title.startsWith(ISSUE_PREFIX))
      .map(parseIssue)
      .sort((a, b) => (b.total - a.total) || (new Date(b.createdAt) - new Date(a.createdAt)));

    const totals = records.map((item) => item.total);
    const averages = {};
    for (const dim of dimensions) {
      averages[dim.key] = records.length
        ? Number((records.reduce((sum, item) => sum + (item[dim.key] || 0), 0) / records.length).toFixed(1))
        : 0;
    }

    const stageCounts = {};
    records.forEach((item) => {
      stageCounts[item.stage] = (stageCounts[item.stage] || 0) + 1;
    });

    return res.status(200).json({
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
    });
  } catch (err) {
    console.error('results api error:', err.message);
    return res.status(500).json({ error: err.message || '获取后台数据失败' });
  }
}
