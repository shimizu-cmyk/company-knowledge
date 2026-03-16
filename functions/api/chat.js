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

    const groqPayload = {
      model: "llama-3.1-8b-instant",
      temperature: 0.2,
      max_tokens: 1000,
      messages: [
        {
          role: "system",
          content: [
            "あなたは社内ナレッジAIです。",
            "必ず日本語で回答してください。",
            "以下のルールを守ってください。",
            "",
            "【会話ルール】",
            "- 挨拶や雑談には自然に返答する",
            "- 不自然に『資料上では確認できません』ばかり言わない",
            "- 普通の会話なら普通に会話する",
            "",
            "【資料質問ルール】",
            "- ユーザー質問の中に関連資料が含まれている場合は、その内容を優先して回答する",
            "- 回答は分かりやすく簡潔にする",
            "- まず結論を書く",
            "- そのあと必要なら箇条書きで補足する",
            "- 資料に書かれていないことは断定しない",
            "- 不明な場合だけ『資料上では確認できません』と書く",
            "",
            "【表現ルール】",
            "- 上から目線にしない",
            "- 日本語は自然でやわらかく",
            "- 長すぎず、短すぎず",
            "- 社内向けAIとして実用的に答える"
          ].join("\n")
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

    const rawText = await groqRes.text();

    let groqData = {};
    try {
      groqData = rawText ? JSON.parse(rawText) : {};
    } catch {
      return jsonResponse(
        {
          error: "Groqの応答JSONが不正です",
          detail: rawText.slice(0, 1000)
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
