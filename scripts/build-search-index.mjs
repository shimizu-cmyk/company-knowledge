import fs from "fs";
import path from "path";
import * as pdfParse from "pdf-parse";

const ROOT_DIR = process.cwd();
const PDF_DIR = path.join(ROOT_DIR, "pdf");
const OUTPUT_DIR = path.join(ROOT_DIR, "search");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "search-index.json");

function normalizeText(text) {
  return (text || "")
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAllPdfFiles(dir) {
  let results = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results = results.concat(getAllPdfFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      results.push(fullPath);
    }
  }

  return results;
}

function getCategoryFromPdfPath(filePath) {
  const relativePath = path.relative(PDF_DIR, filePath);
  const parts = relativePath.split(path.sep);

  if (parts.length >= 2) {
    return parts[0];
  }

  return "uncategorized";
}

function buildPdfUrl(filePath) {
  const relativePath = path.relative(ROOT_DIR, filePath).split(path.sep).join("/");
  return `/${relativePath}`;
}

function buildViewerUrl(filePath) {
  const pdfUrl = buildPdfUrl(filePath);
  return `/pdfjs-legacy/web/viewer.html?file=${encodeURIComponent(pdfUrl)}`;
}

function buildTitle(filePath) {
  return path.basename(filePath, ".pdf");
}

async function extractPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parser = pdfParse.default || pdfParse;
  const data = await parser(buffer);
  return normalizeText(data.text);
}

async function main() {
  console.log("検索インデックス生成開始...");

  if (!fs.existsSync(PDF_DIR)) {
    console.log("pdfフォルダが見つかりませんでした。");
    return;
  }

  const pdfFiles = getAllPdfFiles(PDF_DIR);

  if (pdfFiles.length === 0) {
    console.log("PDFが見つかりませんでした。");
    return;
  }

  const index = [];
  let count = 0;

  for (const filePath of pdfFiles) {
    try {
      console.log(`解析中: ${path.relative(ROOT_DIR, filePath)}`);

      const text = await extractPdfText(filePath);
      const title = buildTitle(filePath);
      const category = getCategoryFromPdfPath(filePath);
      const pdfUrl = buildPdfUrl(filePath);
      const viewerUrl = buildViewerUrl(filePath);
      const relativePath = path.relative(ROOT_DIR, filePath).split(path.sep).join("/");

      index.push({
        id: `pdf-${count + 1}`,
        type: "pdf",
        title,
        category,
        path: relativePath,
        pdfUrl,
        viewerUrl,
        content: text,
      });

      count++;
    } catch (error) {
      console.error(`PDF解析失敗: ${filePath}`);
      console.error(error.message);
    }
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(index, null, 2), "utf-8");

  console.log(`完了: ${count}件のPDFをインデックス化しました。`);
  console.log(`出力先: ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error("検索インデックス生成中にエラーが発生しました。");
  console.error(error);
  process.exit(1);
});
