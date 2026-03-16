import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

const ROOT = process.cwd();
const PDF_DIR = path.join(ROOT, "pdf", "documents");
const OUTPUT_DIR = path.join(ROOT, "search");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "search-index.json");

function getAllPdfFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of list) {
    const full = path.join(dir, item.name);

    if (item.isDirectory()) {
      results = results.concat(getAllPdfFiles(full));
    } else if (item.name.toLowerCase().endsWith(".pdf")) {
      results.push(full);
    }
  }

  return results;
}

function cleanText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return cleanText(result.text);
  } finally {
    await parser.destroy();
  }
}

function buildCategory(relativePath) {
  const parts = relativePath.split("/");
  if (parts.length >= 3) {
    return parts[1];
  }
  return "documents";
}

async function main() {
  console.log("検索データ作成開始");

  if (!fs.existsSync(PDF_DIR)) {
    console.log("PDFフォルダが見つかりません:", PDF_DIR);
    return;
  }

  const pdfFiles = getAllPdfFiles(PDF_DIR);
  console.log("PDF数:", pdfFiles.length);

  const records = [];
  let id = 1;

  for (const file of pdfFiles) {
    try {
      console.log("解析中:", file);

      const text = await extractPdfText(file);
      const relative = path.relative(ROOT, file).replace(/\\/g, "/");
      const category = buildCategory(relative);

      records.push({
        id: `pdf-${id++}`,
        type: "pdf",
        title: path.basename(file, ".pdf"),
        category,
        path: relative,
        pdfUrl: "/" + relative,
        viewerUrl: "/" + relative,
        content: text
      });
    } catch (e) {
      console.log("解析失敗:", file);
      console.log("理由:", e.message);
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    total: records.length,
    records
  };

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf8");

  console.log("完了");
  console.log("出力先:", OUTPUT_FILE);
  console.log("総件数:", records.length);
}

main().catch((err) => {
  console.error("エラー:", err);
  process.exit(1);
});
