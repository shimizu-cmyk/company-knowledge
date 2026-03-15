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

    const question = String(body.question || "").trim();

    if (!question) {
      return jsonResponse(
        { error: "質問が空です" },
        400
      );
    }

    const indexUrl = new URL("/json/search-index.json", request.url);
    const indexRes = await fetch(indexUrl.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!indexRes.ok) {
      return jsonResponse(
        {
          error: "search-index.json の読み込みに失敗しました",
          detail: `status: ${indexRes.status}`
        },
        500
      );
    }

    const rawText = await indexRes.text();

    let parsed;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      return jsonResponse(
        {
          error: "search-index.json のJSON解析に失敗しました",
          detail: rawText.slice(0, 500)
        },
        500
      );
    }

    const searchIndex = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.records)
        ? parsed.records
        : null;

    if (!searchIndex) {
      return jsonResponse(
        { error: "search-index.json の形式が不正です" },
        500
      );
    }

    const groqPayload = {
      model: "llama-3.1-8b-instant",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "あなたは社内ナレッジAIです。日本語で、簡潔で分かりやすく回答してください。資料にないことは断定せず、『資料上では確認できません』と明記してください。"
        },
        {
          role: "user",
          content: question
        }
      ]
    };

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(groqPayload)
    });

    const groqRawText = await groqRes.text();

    let groqData = {};
    try {
      groqData = groqRawText ? JSON.parse(groqRawText) : {};
    } catch {
      return jsonResponse(
        {
          error: "Groqの応答JSONが不正です",
          detail: groqRawText.slice(0, 500)
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

    return jsonResponse({ answer }, 200);
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
