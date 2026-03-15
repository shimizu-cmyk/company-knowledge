export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const body = await request.json().catch(() => ({}));
    const question = String(body?.question || "").trim();
    const sources = Array.isArray(body?.sources) ? body.sources : [];

    if (!question) {
      return json(
        { error: "質問が空です" },
        400
      );
    }

    const apiKey = env.GROQ_API_KEY;
    if (!apiKey) {
      return json(
        { error: "GROQ_API_KEY が未設定です" },
        500
      );
    }

    const trimmedSources = sources.slice(0, 5).map((s, i) => {
      const title = String(s?.title || `資料${i + 1}`);
      const page = s?.page ?? "";
      const location = String(s?.location || "");
      const url = String(s?.url || "");
      const text = cleanText(String(s?.text || "")).slice(0, 2200);

      return {
        index: i + 1,
        title,
        page,
        location,
        url,
        text
      };
    });

    const sourceText = trimmedSources.map((s) => {
      return [
        `【資料${s.index}】`,
        `title: ${s.title}`,
        `page: ${s.page || ""}`,
        `location: ${s.location || ""}`,
        `url: ${s.url || ""}`,
        `text: ${s.text || ""}`
      ].join("\n");
    }).join("\n\n");

    const systemPrompt = `
あなたは社内ナレッジAIです。
与えられた資料だけを根拠に、日本語で簡潔かつ分かりやすく回答してください。

ルール:
- 資料に書いてある内容を優先する
- 資料にないことを断定しない
- 不明な場合は「資料内では確認できません」と述べる
- 回答は自然な日本語にする
- 最後に citations を必ず付ける
- citations は、使った資料番号とページ番号を配列で返す
- 必ず JSON のみ返す
- JSON 形式は次の通り:
{
  "answer": "回答文",
  "citations": [
    { "index": 1, "page": 3 },
    { "index": 2, "page": 5 }
  ]
}
`.trim();

    const userPrompt = `
質問:
${question}

参考資料:
${sourceText}
`.trim();

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    const groqText = await groqRes.text();

    if (!groqRes.ok) {
      return json(
        {
          error: "Groq APIエラー",
          detail: safeText(groqText, 1200)
        },
        500
      );
    }

    let groqJson;
    try {
      groqJson = JSON.parse(groqText);
    } catch {
      return json(
        {
          error: "Groq APIの応答JSON解析に失敗しました",
          detail: safeText(groqText, 1200)
        },
        500
      );
    }

    const content = groqJson?.choices?.[0]?.message?.content;
    if (!content) {
      return json(
        {
          error: "Groq APIの応答本文が空です",
          detail: groqJson
        },
        500
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = extractJson(content);
    }

    if (!parsed || typeof parsed !== "object") {
      return json(
        {
          error: "AI回答のJSON解析に失敗しました",
          detail: safeText(content, 1200)
        },
        500
      );
    }

    const answer = String(parsed.answer || "回答を取得できませんでした。").trim();
    const citations = normalizeCitations(parsed.citations, trimmedSources);

    return json({
      answer,
      citations
    });
  } catch (error) {
    return json(
      {
        error: "サーバー内部エラー",
        detail: error?.message || String(error)
      },
      500
    );
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

function cleanText(text) {
  return String(text || "")
    .replace(/\u0000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeText(text, max = 1000) {
  const s = String(text || "");
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeCitations(citations, sources) {
  if (!Array.isArray(citations)) return [];

  const maxIndex = sources.length;

  const normalized = citations
    .map((c) => {
      const index = Number(c?.index);
      if (!Number.isFinite(index) || index < 1 || index > maxIndex) {
        return null;
      }

      const src = sources[index - 1];
      const page = c?.page ?? src?.page ?? "";

      return {
        index,
        page
      };
    })
    .filter(Boolean);

  const seen = new Set();
  return normalized.filter((c) => {
    const key = `${c.index}-${c.page}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
