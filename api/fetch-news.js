const RSS_PROXY = 'https://api.rss2json.com/v1/api.json?api_key=imhim1n33ckhnsd1nwogi9jtpqyxjmnlsfztiiml&rss_url=';

const FEEDS = [
  { name: 'Reuters',       url: 'https://feeds.reuters.com/reuters/topNews',          emoji: '📰' },
  { name: 'BBC News',      url: 'https://feeds.bbci.co.uk/news/world/rss.xml',        emoji: '🌐' },
  { name: 'The Guardian',  url: 'https://www.theguardian.com/world/rss',              emoji: '📋' },
  { name: 'Positive News', url: 'https://www.positive.news/feed/',                    emoji: '🌟' },
  { name: 'Good News Net', url: 'https://www.goodnewsnetwork.org/feed/',              emoji: '☀️' },
  { name: 'NHK World',     url: 'https://www3.nhk.or.jp/rss/news/cat0.xml',           emoji: '🗾' },
  { name: 'Guardian Env',  url: 'https://www.theguardian.com/environment/rss',        emoji: '🌿' },
  { name: 'Guardian Sci',  url: 'https://www.theguardian.com/science/rss',            emoji: '🔬' },
];

async function fetchRSS(feed) {
  try {
    const res = await fetch(RSS_PROXY + encodeURIComponent(feed.url) + '&count=12');
    const data = await res.json();
    if (data.status === 'error') return [];
    return (data.items || []).map(i => ({
      source: feed.name,
      emoji: feed.emoji,
      title: i.title || '',
      desc: (i.description || '').replace(/<[^>]+>/g, '').slice(0, 200),
      link: i.link || '#',
      pub: i.pubDate || '',
    }));
  } catch (e) {
    console.warn(`Failed: ${feed.name}`, e.message);
    return [];
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // 1. RSS全フィード取得
    const results = await Promise.allSettled(FEEDS.map(fetchRSS));
    let raw = [];
    results.forEach(r => { if (r.status === 'fulfilled') raw = raw.concat(r.value); });

    if (!raw.length) {
      return res.status(500).json({ error: 'No RSS articles fetched' });
    }

    // 2. 上位30件をClaudeでスコアリング
    const sample = raw.slice(0, 30);
    const list = sample.map((a, i) => `${i + 1}. [${a.source}] ${a.title} — ${a.desc.slice(0, 80)}`).join('\n');

    const prompt = `You are the editorial AI for "Hikari News", a bilingual positive-news digest.

Score each headline for positivity (0–100). Hopeful, constructive, solution-focused stories score high. Conflict, disaster, crime, controversy score low.

Articles:
${list}

Return ONLY valid JSON (no markdown, no preamble):
{"scored":[{"index":0,"positivityScore":85,"category":"environment","emoji":"🌿","titleJa":"日本語タイトル（15〜25文字）","summaryJa":"前向きな要約（35〜55文字）"}]}

category: environment, science, society, innovation, health, other
Only include articles with positivityScore >= 55.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    if (claudeData.error) throw new Error(claudeData.error.message);

    const txt = claudeData.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
    const { scored = [] } = JSON.parse(txt);

    // 3. マージ＆ソート
    const articles = scored
      .filter(s => s.positivityScore >= 55 && sample[s.index])
      .map(s => ({
        ...sample[s.index],
        positivityScore: s.positivityScore,
        category: s.category || 'other',
        emoji: s.emoji || '✨',
        titleJa: s.titleJa || sample[s.index].title,
        summaryJa: s.summaryJa || '',
        titleEn: sample[s.index].title,
        summaryEn: sample[s.index].desc,
      }))
      .sort((a, b) => b.positivityScore - a.positivityScore);

    return res.status(200).json({ articles });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
