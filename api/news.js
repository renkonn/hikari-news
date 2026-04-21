/**
 * Hikari News — api/news.js
 * Vercel Serverless Function
 *
 * 取得元:
 *   - BBC News    → rss2json.com 経由 (CORS回避)
 *   - Reuters     → rss2json.com 経由
 *   - The Guardian → 公式 Content API
 *
 * 環境変数 (Vercel Dashboard > Settings > Environment Variables):
 *   ANTHROPIC_API_KEY  : Anthropic API キー (必須)
 *   GUARDIAN_API_KEY   : Guardian API キー (任意。未設定時は "test" キーで動作)
 */

const RSS2JSON_BASE = "https://api.rss2json.com/v1/api.json";

const CATEGORY_KEYWORDS = {
  environment: ["climate","environment","nature","wildlife","ocean","forest","renewable","solar","wind","carbon","ecosystem","biodiversity","coral","pollution","plastic"],
  science:     ["research","study","health","medical","vaccine","treatment","discovery","science","brain","gene","therapy","cancer","disease","surgery","trial","biology","astronomy","space"],
  society:     ["community","education","children","school","volunteer","social","equality","poverty","rights","charity","culture","arts","music","sport","olympic","literacy","women","youth"],
  innovation:  ["technology","ai","robot","startup","innovation","digital","engineering","breakthrough","invention","electric","autonomous","quantum","battery","software"],
};

function guessCategory(text) {
  const lower = (text || "").toLowerCase();
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    if (kws.some(k => lower.includes(k))) return cat;
  }
  return "society";
}

const EMOJI_MAP = { environment:"🌿", science:"🔬", society:"🤝", innovation:"💡" };

function timeAgo(dateStr) {
  if (!dateStr) return "本日 / Today";
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor(diff / 60_000);
  if (h >= 24) return `${Math.floor(h/24)}日前 / ${Math.floor(h/24)}d ago`;
  if (h >= 1)  return `${h}時間前 / ${h}h ago`;
  if (m >= 1)  return `${m}分前 / ${m}min ago`;
  return "たった今 / Just now";
}

async function fetchRSS(source, rssUrl) {
  try {
    const url = `${RSS2JSON_BASE}?rss_url=${encodeURIComponent(rssUrl)}&count=15`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== "ok") throw new Error(data.message);
    return (data.items || []).map(item => ({
      source,
      title:       item.title || "",
      description: (item.description || "").replace(/<[^>]+>/g,"").slice(0,200),
      link:        item.link || "#",
      pubDate:     item.pubDate || "",
      category:    guessCategory((item.title||"") + " " + (item.description||"")),
    }));
  } catch(e) {
    console.error(`[hikari] rss error (${source}):`, e.message);
    return [];
  }
}

async function fetchGuardian(apiKey) {
  try {
    const sections = "environment|science|technology|society|education|sport|culture";
    const url = `https://content.guardianapis.com/search?api-key=${apiKey}&section=${encodeURIComponent(sections)}&show-fields=trailText&page-size=20&order-by=newest`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Guardian API HTTP ${res.status}`);
    const data = await res.json();
    return (data.response?.results || []).map(item => ({
      source:      "The Guardian",
      title:       item.webTitle || "",
      description: (item.fields?.trailText || "").replace(/<[^>]+>/g,"").slice(0,200),
      link:        item.webUrl || "#",
      pubDate:     item.webPublicationDate || "",
      category:    guessCategory(item.webTitle + " " + item.sectionName),
    }));
  } catch(e) {
    console.error("[hikari] guardian error:", e.message);
    return [];
  }
}

async function scoreArticles(articles, apiKey) {
  if (!articles.length) return [];
  const batch = articles.slice(0, 20);
  const list  = batch.map((a,i) => `[${i}] ${a.title}`).join("\n");

  const prompt = `You are the editorial AI for "Hikari News", a bilingual positive-news digest.

Score each headline for POSITIVITY (hopeful, constructive, uplifting, solution-focused).
Also produce bilingual content.

Headlines:
${list}

Return ONLY valid JSON, no markdown fences:
{"scores":[{"index":0,"positivityScore":87,"titleJa":"日本語タイトル（20〜30文字）","summaryJa":"日本語1文要約（50〜70文字、前向きトーン）","summaryEn":"English one-sentence summary (15–25 words, optimistic)."}]}

Scoring: 90-100=breakthrough, 80-89=clear progress, 70-79=hopeful, 60-69=neutral, 0-59=negative/crisis.
Include all ${batch.length} headlines. Be strict — most news is not truly positive.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{ "Content-Type":"application/json", "x-api-key":apiKey, "anthropic-version":"2023-06-01" },
    body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1500, messages:[{role:"user",content:prompt}] }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data  = await res.json();
  const raw   = data.content.map(b=>b.text||"").join("");
  const clean = raw.replace(/```json|```/g,"").trim();
  return JSON.parse(clean).scores || [];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
  if (req.method==="OPTIONS") return res.status(200).end();

  const minScore    = parseInt(req.query.minScore||"80",10);
  const categoryReq = req.query.category||"all";
  const anthropicKey= process.env.ANTHROPIC_API_KEY;
  const guardianKey = process.env.GUARDIAN_API_KEY || "test";

  if (!anthropicKey) return res.status(500).json({error:"ANTHROPIC_API_KEY is not configured."});

  try {
    const [bbc, reuters, guardian] = await Promise.all([
      fetchRSS("BBC News","https://feeds.bbci.co.uk/news/world/rss.xml"),
      fetchRSS("Reuters", "https://feeds.reuters.com/reuters/topNews"),
      fetchGuardian(guardianKey),
    ]);

    let all = [...bbc, ...reuters, ...guardian];
    if (categoryReq !== "all") all = all.filter(a=>a.category===categoryReq);
    if (!all.length) return res.status(200).json({articles:[],total:0,filtered:0});

    const scores = await scoreArticles(all, anthropicKey);

    const result = scores
      .filter(s=>s.positivityScore>=minScore)
      .map(s=>{
        const a = all[s.index]||{};
        return {
          id:`${a.source}-${s.index}`, source:a.source||"",
          category:a.category||"society", emoji:EMOJI_MAP[a.category]||"✦",
          positivityScore:s.positivityScore, timeAgo:timeAgo(a.pubDate),
          titleJa:s.titleJa||a.title, titleEn:a.title,
          summaryJa:s.summaryJa||"", summaryEn:s.summaryEn||a.description,
          url:a.link||"#",
        };
      })
      .sort((a,b)=>b.positivityScore-a.positivityScore);

    return res.status(200).json({articles:result, total:all.length, filtered:result.length, fetchedAt:new Date().toISOString()});
  } catch(e) {
    console.error("[hikari] error:",e);
    return res.status(500).json({error:e.message});
  }
}
