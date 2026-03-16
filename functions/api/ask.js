export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const question = String(body?.question || "").trim();
    const references = Array.isArray(body?.references) ? body.references : [];

    if (!question) {
      return jsonResponse({ error: "question is required" }, 400);
    }

    const apiKey = context.env.GROQ_API_KEY;
    if (!apiKey) {
      return jsonResponse({ error: "GROQ_API_KEY is not set" }, 500);
    }

    const contextText = references
      .map((ref, index) => {
        return [
          `【資料${index + 1}】`,
          `タイトル: ${ref.title || ""}`,
          `カテゴリ: ${ref.category || ""}`,
          `内容: ${String(ref.content || "").slice(0, 6000)}`,
          `URL: ${ref.viewerUrl || ref.pdfUrl || ""}`
        ].join("\n");
      })
      .join("\n\n");

    const systemPrompt = `
あなたは社内ナレッジAIです。
回答は必ず日本語で行ってください。
推測で断定しないでください。
与えられた社内資料だけをもとに、分かる範囲で簡潔かつ実務的に回答してください。
資料に根拠が薄い場合は、その旨を明記してください。
最後に「参考資料」として使った資料タイトルを短く列挙してください。
`.trim();

    const userPrompt = `
【質問】
${question}

【社内資料】
${contextText}
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
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!groqRes.ok) {
      const text = await groqRes.text();
      return jsonResponse({ error: `Groq API error: ${text}` }, 500);
    }

    const groqData = await groqRes.json();
    const answer =
      groqData?.choices?.[0]?.message?.content ||
      "回答を生成できませんでした。";

    return jsonResponse({ answer }, 200);
  } catch (error) {
    return jsonResponse({ error: error.message || "Unknown error" }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
