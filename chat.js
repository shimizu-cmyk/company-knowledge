let searchData = null;

async function loadSearchIndex() {
  const res = await fetch("/search/search-index.json");
  const data = await res.json();
  searchData = data.records || [];
}

function normalize(text) {
  return text
    .replace(/[ァ-ン]/g, s =>
      String.fromCharCode(s.charCodeAt(0) - 0x60)
    )
    .toLowerCase();
}

async function searchDocs() {

  if (!searchData) {
    await loadSearchIndex();
  }

  const input = document.getElementById("search-input");
  const query = normalize(input.value);

  const results = [];

  searchData.forEach(item => {

    const text = normalize((item.title || "") + " " + (item.content || ""));

    if (text.includes(query)) {
      results.push(item);
    }

  });

  renderResults(results);

}

function renderResults(results) {

  const container = document.getElementById("search-results");

  if (!results.length) {
    container.innerHTML = "該当する資料が見つかりませんでした。";
    return;
  }

  container.innerHTML = results.map(item => {

    const link = item.viewerUrl || item.pdfUrl || item.path;

    return `
      <div class="result">
        <a href="${link}" target="_blank">
          📄 ${item.title}
        </a>
        <div class="category">${item.category || ""}</div>
      </div>
    `;

  }).join("");

}

async function askAI(question){

  if (!searchData) {
    await loadSearchIndex();
  }

  question = normalize(question);

  let context = "";

  searchData.forEach(item => {

    const text = normalize((item.title || "") + " " + (item.content || ""));

    if(text.includes(question)){
      context += item.title + "\n";
      context += item.content + "\n\n";
    }

  });

  if(context === ""){
    document.getElementById("ai-result").innerHTML =
    "該当する資料が見つかりませんでした。";
    return;
  }

  const response = await fetch("/functions/ai",{
    method:"POST",
    headers:{
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      question:question,
      context:context
    })
  });

  const result = await response.json();

  document.getElementById("ai-result").innerHTML =
  result.answer || "回答を取得できませんでした。";

}