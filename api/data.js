// GET /api/data?token=xxx&session=yyyymmdd — returns all records for admin view

const KV_URL          = process.env.KV_REST_API_URL;
const KV_READ_TOKEN   = process.env.KV_REST_API_READ_ONLY_TOKEN;
const ADMIN_TOKEN     = process.env.ADMIN_TOKEN;

async function kvGet(key) {
  const res = await fetch(`${KV_URL}/lrange/${encodeURIComponent(key)}/0/-1`, {
    headers: { Authorization: `Bearer ${KV_READ_TOKEN}` },
  });
  const data = await res.json();
  return data.result || [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') return res.status(405).end();

  // Simple token auth
  const token = req.query.token;
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: '无权限' });
  }

  if (!KV_URL || !KV_READ_TOKEN) {
    return res.status(500).json({ error: '服务器未配置存储' });
  }

  const session = req.query.session || 'default';
  const listKey = `submissions:${session}`;

  try {
    const raw = await kvGet(listKey);
    const records = raw.map(r => {
      try { return JSON.parse(r); } catch { return null; }
    }).filter(Boolean);

    // Sort newest first
    records.sort((a, b) => b.id - a.id);

    return res.status(200).json({ success: true, session, count: records.length, records });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
