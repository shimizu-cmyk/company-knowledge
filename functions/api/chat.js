export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if (!env.GROQ_API_KEY) {
      return jsonResponse(
        { error: "GROQ_API_KEY が設定されていません" },
        500
      );
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { error: "リクエストJSONの形式が不正です" },
        400
      );
    }

    const rawQuestion = String(body.question || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];

    if (!rawQuestion) {
      return jsonResponse(
        { error: "質問が空です" },
        400
      );
    }

    const question = normalizeQuestion(rawQuestion);

    // /json/search-index.json を取得
    const siteUrl = new URL(request.url).origin;
    const indexRes = await fetch(`${siteUrl}/json/search-index.json`, {
      headers: { "cache-control": "no-cache" }
    });

    if (!indexRes.ok) {
      return jsonResponse(
        { error: "search-index.json を読み込めませんでした" },
        500
      );
    }

    let indexJson;
    try {
      indexJson = await indexRes.json();
    } catch {
      return jsonResponse(
        { error: "search-index.json の形式が不正です" },
        500
      );
    }

    const docs = Array.isArray(indexJson)
      ? indexJson
      : Array.isArray(indexJson.records)
        ? indexJson.records
        : [];

    const matchedDocs = findRelevantDocs(question, docs, 5);

    const contextText = matchedDocs.length
      ? matchedDocs
          .map((doc, i) => {
            return [
              `【資料${i + 1}】`,
              `タイトル: ${doc.title || "無題"}`,
              `カテゴリ: ${doc.category || doc.type || ""}`,
              `URL: ${doc.url || ""}`,
              `場所: ${doc.location || ""}`,
              `本文: ${truncate(doc.text || doc.content || "", 1800)}`
            ].join("\n");
          })
          .join("\n\n")
      : "関連資料は見つかりませんでした。質問文から推測できる範囲でのみ回答し、断定は避け、『資料上では確認できません』と明記してください。";

    const messages = [
      {
        role: "system",
        content:
          "あなたは社内ナレッジAIです。必ず日本語で、簡潔で分かりやすく回答してください。資料にないことは断定せず、『資料上では確認できません』と明記してください。必要に応じて箇条書きで回答してください。"
      }
    ];

    for (const item of history.slice(-10)) {
      if (!item || !item.role || !item.content) continue;
      if (item.role !== "user" && item.role !== "assistant") continue;
      messages.push({
        role: item.role,
        content: String(item.content)
      });
    }

    messages.push({
      role: "user",
      content: [
        "以下の社内資料を参考に質問へ回答してください。",
        "",
        "【社内資料】",
        contextText,
        "",
        "【質問】",
        rawQuestion
      ].join("\n")
    });

    const groqPayload = {
      model: "llama-3.1-8b-instant",
      temperature: 0.2,
      messages
    };

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(groqPayload)
    });

    const rawText = await groqRes.text();

    let groqData = {};
    try {
      groqData = rawText ? JSON.parse(rawText) : {};
    } catch {
      return jsonResponse(
        {
          error: "Groqの応答JSONが不正です",
          detail: rawText.slice(0, 500)
        },
        502
      );
    }

    if (!groqRes.ok) {
      return jsonResponse(
        {
          error: "Groq APIエラー",
          detail: groqData
        },
        502
      );
    }

    const answer =
      groqData?.choices?.[0]?.message?.content?.trim() ||
      "回答を取得できませんでした。";

    return jsonResponse(
      {
        answer,
        references: matchedDocs.map((doc) => ({
          title: doc.title || "無題",
          url: doc.url || "#",
          category: doc.category || doc.type || "",
          score: doc._score || 0
        }))
      },
      200
    );
  } catch (error) {
    return jsonResponse(
      {
        error: "サーバーエラー",
        detail: String(error)
      },
      500
    );
  }
}

function normalizeQuestion(text) {
  let q = String(text || "").trim();

  const rules = [
    [/酒気帯びチェック/g, "アルコールチェック"],
    [/酒気帯び/g, "アルコール"],
    [/飲酒チェック/g, "アルコールチェック"],
    [/飲酒運転/g, "アルコール"],
    [/ルール/g, "規定"]
  ];

  for (const [pattern, replacement] of rules) {
    q = q.replace(pattern, replacement);
  }

  return q;
}

function truncate(text, max = 1800) {
  const s = String(text || "");
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function normalize(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/\s+/g, "")
    .replace(/　/g, "")
    .trim();
}

function tokenize(text) {
  return normalize(text)
    .replace(/[。、，,．.!！?？:：/／\\|()（）[\]{}"'`]/g, " ")
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean);
}

function findRelevantDocs(question, docs, limit = 5) {
  const q = normalize(question);
  const qTokens = tokenize(question);

  const scored = docs.map((doc) => {
    const title = normalize(doc.title || "");
    const category = normalize(doc.category || doc.type || "");
    const location = normalize(doc.location || "");
    const text = normalize(doc.text || doc.content || "");
    const combined = `${title} ${category} ${location} ${text}`;

    let score = 0;

    if (title.includes(q)) score += 100;
    if (category.includes(q)) score += 30;
    if (location.includes(q)) score += 20;
    if (text.includes(q)) score += 15;

    for (const token of qTokens) {
      if (token.length <= 1) continue;
      if (title.includes(token)) score += 12;
      if (category.includes(token)) score += 6;
      if (location.includes(token)) score += 5;
      if (text.includes(token)) score += 3;
    }

    if (combined.includes("アルコール") && (q.includes("アルコール") || q.includes("酒気"))) {
      score += 15;
    }
    if (combined.includes("点呼") && (q.includes("点呼") || q.includes("チェック"))) {
      score += 10;
    }
    if (combined.includes("安全") && q.includes("安全")) {
      score += 8;
    }

    return {
      ...doc,
      _score: score
    };
  });

  return scored
    .filter((d) => d._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
