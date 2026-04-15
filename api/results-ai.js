const REPO = 'waterhuangfu-art/ai-score-card';
const ISSUE_PREFIX = '[评分]';

const dimensions = [
  { key: 'frequency', label: '使用频率', short: '频' },
  { key: 'coverage', label: '场景覆盖', short: '覆' },
  { key: 'depth', label: '应用深度', short: '深' },
  { key: 'result', label: '结果产出', short: '果' },
  { key: 'system', label: '系统化程度', short: '系' }
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getTableValue(body, label) {
  const re = new RegExp(`\\|\\s*${escapeRegExp(label)}\\s*\\|\\s*(.+?)\\s*\\|`);
  const match = body.match(re);
  return match ? match[1].replace(/\*\*/g, '').trim() : '';
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
    frequency: parseInt(getTableValue(body, '使用频率'), 10) || 0,
    coverage: parseInt(getTableValue(body, '场景覆盖'), 10) || 0,
    depth: parseInt(getTableValue(body, '应用深度'), 10) || 0,
    result: parseInt(getTableValue(body, '结果产出'), 10) || 0,
    system: parseInt(getTableValue(body, '系统化程度'), 10) || 0,
    breakthrough: getTableValue(body, '最想突破'),
    firstStep: getTableValue(body, '72h第一步'),
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

  try {
    const githubRes = await fetch(
      `https://api.github.com/repos/${REPO}/issues?state=open&per_page=100`,
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
      .filter((record) => !session || record.session === session)
      .sort((a, b) => (b.total - a.total) || (new Date(b.createdAt) - new Date(a.createdAt)));

    const totals = records.map((item) => item.total);
    const averages = {};
    dimensions.forEach((dim) => {
      averages[dim.key] = records.length
        ? Number((records.reduce((sum, item) => sum + (item[dim.key] || 0), 0) / records.length).toFixed(1))
        : 0;
    });

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
