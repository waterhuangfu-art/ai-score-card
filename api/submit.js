// POST /api/submit — saves scoring record to Vercel KV (Upstash REST)

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kv(method, ...args) {
  const res = await fetch(`${KV_URL}/${method}/${args.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  return res.json();
}

// Simple rate limit (in-memory, resets on cold start — fine for ~10 participants)
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

  const { name, scores, total } = payload || {};
  if (!name?.trim()) return res.status(400).json({ error: '姓名不能为空' });
  if (typeof total !== 'number' || total < 0 || total > 25)
    return res.status(400).json({ error: '评分数据不合法' });

  if (!KV_URL || !KV_TOKEN) {
    console.error('Missing KV env vars');
    return res.status(500).json({ error: '服务器未配置存储，请联系管理员' });
  }

  const record = {
    id: Date.now(),
    submittedAt: new Date().toISOString(),
    ...payload,
  };

  // Push JSON record into a Redis list keyed by session
  const listKey = `submissions:${payload.session || 'default'}`;
  await kv('rpush', listKey, JSON.stringify(record));

  return res.status(200).json({ success: true });
}
