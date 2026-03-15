export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const body = await request.json();
    const question = body.question || "";
    const sources = Array.isArray(body.sources) ? body.sources : [];

    if (!env.GROQ_API_KEY) {
      return jsonResponse(
        { error: "GROQ_API_KEY が未設定です" },
        500
      );
    }

    if (!question.trim()) {
      return jsonResponse(
        { error: "質問が空です" },
        400
      );
    }

    const sourceText = sources.map((s, i) => {
      return [
        `資料番号: ${i + 1}`,
        `タイトル: ${s.title || ""}`,
        `ページ: ${s.page || ""}`,
        `場所: ${s.location || ""}`,
        `URL: ${s.url || ""}`,
        `本文: ${String(s.text || "").slice(0, 1200)}`
      ].join("\n");
    }).join("\n\n--------------------\n\n");

    const systemPrompt = `
あなたは社内ナレッジAIです。
必ず日本語で回答してください。
以下のルールを厳守してください。

ルール:
- 回答は簡潔でわかりやすくする
- まず結論を書く
- 必要ならそのあとに箇条書きで補足する
- 与えられた資料に書かれていないことは断定しない
- 不明な場合は「資料上では確認できません」と書く
- 回答の根拠になった資料番号とページ番号を citations に入れる
- citations は必ず配列にする
- citations の各要素は {"index": 資料番号, "page": ページ番号} の形にする
- 根拠がない場合は citations を空配列にする
- 出力は必ずJSONのみ
- JSON形式は以下:
{
  "answer": "回答本文",
  "citations": [
    { "index": 1, "page": 3 },
    { "index": 2, "page": 1 }
  ]
}
`.trim();

    const userPrompt = `
ユーザー質問:
${question}

参考資料:
${sourceText}
`.trim();

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    const groqData = await groqRes.json();

    if (!groqRes.ok) {
      return jsonResponse(
        { error: groqData?.error?.message || "Groq APIエラー" },
        500
      );
    }

    const content = groqData?.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return jsonResponse(
        { error: "AI応答JSONの解析に失敗しました" },
        500
      );
    }

    return jsonResponse({
      answer: parsed.answer || "回答を取得できませんでした。",
      citations: Array.isArray(parsed.citations) ? parsed.citations : []
    });

  } catch (error) {
    return jsonResponse(
      { error: error.message || "サーバーエラー" },
      500
    );
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8"
    }
  });
}
