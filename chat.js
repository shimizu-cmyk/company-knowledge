const SEARCH_INDEX_URL = "/search/search-index.json";
const ASK_API_URL = "/api/ask";

const hero = document.getElementById("hero");
const backRow = document.getElementById("backRow");
const backBtn = document.getElementById("backBtn");
const conversation = document.getElementById("conversation");
const emptyNote = document.getElementById("emptyNote");
const queryInput = document.getElementById("queryInput");
const searchBtn = document.getElementById("searchBtn");
const askBtn = document.getElementById("askBtn");
const statusEl = document.getElementById("status");

let searchData = null;
let records = [];

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ァ-ン]/g, s => String.fromCharCode(s.charCodeAt(0) - 0x60))
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(text) {
  statusEl.textContent = text || "";
}

function enterCompactMode() {
  hero.classList.add("compact");
  backRow.classList.add("show");
}

function resetToTop() {
  conversation.innerHTML = "";
  conversation.appendChild(emptyNote);
  emptyNote.style.display = "block";
  hero.classList.remove("compact");
  backRow.classList.remove("show");
  setStatus("");
  queryInput.value = "";
  queryInput.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function addUserMessage(text) {
  emptyNote.style.display = "none";
  enterCompactMode();

  const wrap = document.createElement("div");
  wrap.className = "message user";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  wrap.appendChild(bubble);
  conversation.appendChild(wrap);
  conversation.scrollTop = conversation.scrollHeight;
}

function addAssistantMessage(title, body, refs = []) {
  emptyNote.style.display = "none";
  enterCompactMode();

  const wrap = document.createElement("div");
  wrap.className = "message assistant";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const titleEl = document.createElement("div");
  titleEl.className = "bubble-title";
  titleEl.textContent = title;

  const bodyEl = document.createElement("div");
  bodyEl.textContent = body;

  bubble.appendChild(titleEl);
  bubble.appendChild(bodyEl);

  if (refs.length > 0) {
    const refsWrap = document.createElement("div");
    refsWrap.className = "refs";

    const toggle = document.createElement("button");
    toggle.className = "refs-toggle";
    toggle.textContent = `参考資料 ${refs.length}件を表示`;

    const list = document.createElement("div");
    list.className = "refs-list";

    toggle.addEventListener("click", () => {
      const open = list.classList.toggle("show");
      toggle.textContent = open
        ? `参考資料 ${refs.length}件を閉じる`
        : `参考資料 ${refs.length}件を表示`;
    });

    refs.forEach((ref) => {
      const item = document.createElement("div");
      item.className = "ref-item";

      const title = document.createElement("div");
      title.className = "ref-title";
      title.textContent = ref.title || "資料";

      const meta = document.createElement("div");
      meta.className = "ref-meta";
      meta.textContent = `カテゴリ: ${ref.category || "documents"}`;

      const snippet = document.createElement("div");
      snippet.className = "ref-snippet";
      snippet.textContent = ref.snippet || "";

      const link = document.createElement("a");
      link.className = "ref-link";
      link.href = ref.viewerUrl || ref.pdfUrl || "#";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "資料を開く";

      item.appendChild(title);
      item.appendChild(meta);
      item.appendChild(snippet);
      item.appendChild(link);
      list.appendChild(item);
    });

    refsWrap.appendChild(toggle);
    refsWrap.appendChild(list);
    bubble.appendChild(refsWrap);
  }

  wrap.appendChild(bubble);
  conversation.appendChild(wrap);
  conversation.scrollTop = conversation.scrollHeight;
}

function makeSnippet(content, query) {
  const raw = String(content || "");
  if (!raw) return "";

  const normalizedContent = normalizeText(raw);
  const normalizedQuery = normalizeText(query);

  const hitIndex = normalizedContent.indexOf(normalizedQuery);

  if (hitIndex === -1) {
    return raw.slice(0, 140) + (raw.length > 140 ? "..." : "");
  }

  const start = Math.max(0, hitIndex - 60);
  const end = Math.min(raw.length, hitIndex + query.length + 80);
  const head = start > 0 ? "..." : "";
  const tail = end < raw.length ? "..." : "";

  return head + raw.slice(start, end) + tail;
}

function scoreRecord(record, query) {
  const q = normalizeText(query);
  const title = normalizeText(record.title || "");
  const content = normalizeText(record.content || "");
  const category = normalizeText(record.category || "");

  let score = 0;

  if (!q) return 0;
  if (title.includes(q)) score += 120;
  if (category.includes(q)) score += 20;
  if (content.includes(q)) score += 40;

  const words = q.split(" ").filter(Boolean);
  words.forEach((word) => {
    if (title.includes(word)) score += 30;
    if (content.includes(word)) score += 10;
  });

  return score;
}

async function loadSearchIndex() {
  setStatus("検索データを読み込み中...");

  const res = await fetch(SEARCH_INDEX_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`search-index.json の読み込みに失敗しました (${res.status})`);
  }

  const data = await res.json();

  if (!data || !Array.isArray(data.records)) {
    throw new Error("search-index.json の形式が不正です");
  }

  searchData = data;
  records = data.records;
  setStatus(`検索データ読込完了: ${records.length}件`);
}

function searchDocs(query) {
  const scored = records
    .map((record) => ({
      ...record,
      score: scoreRecord(record, query)
    }))
    .filter((record) => record.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return scored.map((item) => ({
    title: item.title,
    category: item.category,
    pdfUrl: item.pdfUrl,
    viewerUrl: item.viewerUrl,
    snippet: makeSnippet(item.content, query),
    content: item.content
  }));
}

async function runSearch() {
  const query = queryInput.value.trim();
  if (!query) {
    setStatus("キーワードを入力してください");
    return;
  }

  try {
    if (!searchData) {
      await loadSearchIndex();
    }

    addUserMessage(query);

    const results = searchDocs(query);

    if (results.length === 0) {
      addAssistantMessage("検索結果", "該当する資料が見つかりませんでした。別の言い回しでも試してください。");
      setStatus("検索結果 0件");
      return;
    }

    const summary = `${results.length}件の候補が見つかりました。下の参考資料から確認してください。`;
    addAssistantMessage("検索結果", summary, results);
    setStatus(`検索結果 ${results.length}件`);
  } catch (error) {
    addAssistantMessage("検索エラー", error.message || "検索データの読み込みに失敗しました。");
    setStatus("検索失敗");
  }
}

async function runAskAI() {
  const query = queryInput.value.trim();
  if (!query) {
    setStatus("質問を入力してください");
    return;
  }

  try {
    if (!searchData) {
      await loadSearchIndex();
    }

    addUserMessage(query);
    setStatus("AI回答を生成中...");

    const results = searchDocs(query);
    const topRefs = results.slice(0, 5);

    if (topRefs.length === 0) {
      addAssistantMessage(
        "AI回答",
        "関連資料が見つからなかったため、社内資料ベースでは回答できませんでした。検索ワードを変えて試してください。"
      );
      setStatus("関連資料なし");
      return;
    }

    const res = await fetch(ASK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        question: query,
        references: topRefs.map((item) => ({
          title: item.title,
          category: item.category,
          content: item.content,
          viewerUrl: item.viewerUrl,
          pdfUrl: item.pdfUrl
        }))
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI APIエラー: ${res.status} ${text}`);
    }

    const data = await res.json();
    const answer = data.answer || "回答を取得できませんでした。";

    addAssistantMessage("AI回答", answer, topRefs);
    setStatus("AI回答完了");
  } catch (error) {
    addAssistantMessage(
      "AI回答エラー",
      error.message || "AI回答の生成に失敗しました。"
    );
    setStatus("AI回答失敗");
  }
}

searchBtn.addEventListener("click", runSearch);
askBtn.addEventListener("click", runAskAI);

queryInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    runSearch();
  }
});

backBtn.addEventListener("click", resetToTop);

window.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadSearchIndex();
  } catch (error) {
    console.error(error);
    setStatus("検索データを読み込めませんでした");
  }
});
