import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = __dirname;
const PDF_DIR = path.join(ROOT_DIR, "pdf");
const OUTPUT_DIR = path.join(ROOT_DIR, "json");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "search-index.json");

const VIEWER_BASE = "/pdfjs-legacy/web/viewer.html?file=";

async function main() {
  console.log("検索インデックス生成開始...");

  const pdfFiles = await walkPdfFiles(PDF_DIR);

  if (pdfFiles.length === 0) {
    console.log("PDFが見つかりませんでした。");
    await ensureDir(OUTPUT_DIR);
    await fs.writeFile(
      OUTPUT_FILE,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          total: 0,
          records: []
        },
        null,
        2
      ),
      "utf-8"
    );
    return;
  }

  const records = [];
  let idCounter = 1;

  for (const absPath of pdfFiles) {
    const relativePath = toPosix(path.relative(ROOT_DIR, absPath));
    const fileName = path.basename(absPath);
    const title = fileName.replace(/\.pdf$/i, "");

    console.log(`処理中: ${relativePath}`);

    try {
      const pages = await extractPdfPages(absPath);

      for (const page of pages) {
        const cleanedText = cleanPageText(page.text);

        if (!shouldKeepPage(cleanedText)) {
          continue;
        }

        records.push({
          type: "pdf",
          title,
          file: fileName,
          path: relativePath,
          location: `P${page.pageNumber}`,
          page: page.pageNumber,
          sheet: null,
          row: null,
          text: cleanedText,
          url: buildViewerUrl(relativePath, page.pageNumber),
          id: idCounter++
        });
      }
    } catch (error) {
      console.error(`PDF処理失敗: ${relativePath}`);
      console.error(String(error));
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    total: records.length,
    records
  };

  await ensureDir(OUTPUT_DIR);
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf-8");

  console.log(`完了: ${records.length}件`);
  console.log(`出力先: ${OUTPUT_FILE}`);
}

async function walkPdfFiles(dir) {
  const result = [];
  let entries = [];

  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = await walkPdfFiles(fullPath);
      result.push(...nested);
      continue;
    }

    if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
      result.push(fullPath);
    }
  }

  return result.sort((a, b) => a.localeCompare(b, "ja"));
}

async function extractPdfPages(filePath) {
  const data = await fs.readFile(filePath);

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(data),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true
  });

  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const text = textContent.items
      .map(item => ("str" in item ? item.str : ""))
      .join(" ");

    pages.push({
      pageNumber,
      text
    });
  }

  return pages;
}

function cleanPageText(text) {
  return String(text || "")
    .replace(/\u0000/g, " ")
    .replace(/[\u0001-\u0008\u000B-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .replace(/　/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function shouldKeepPage(text) {
  if (!text) return false;

  const compact = text.replace(/\s+/g, "");
  if (compact.length < 12) return false;

  const japaneseMatches = text.match(/[ぁ-んァ-ン一-龠]/g) || [];
  const latinMatches = text.match(/[A-Za-z]/g) || [];
  const digitMatches = text.match(/[0-9０-９]/g) || [];
  const symbolMatches = text.match(/[^ぁ-んァ-ン一-龠A-Za-z0-9０-９\s]/g) || [];

  const meaningfulCount =
    japaneseMatches.length + latinMatches.length + digitMatches.length;

  if (meaningfulCount < 8) return false;

  const symbolRatio = symbolMatches.length / Math.max(text.length, 1);
  if (symbolRatio > 0.35) return false;

  const japaneseRatio = japaneseMatches.length / Math.max(text.length, 1);
  const latinRatio = latinMatches.length / Math.max(text.length, 1);

  // 文字化け対策
  const mojibakeHits = countMojibakePatterns(text);
  if (mojibakeHits >= 8) return false;

  // 中身が薄いページ対策
  const lowValuePatterns = [
    /^p\s*o\s*i\s*n\s*t\s*!?$/i,
    /^point!?$/i,
    /^copyright\.?$/i,
    /^copyright/i
  ];

  const simplified = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (lowValuePatterns.some(re => re.test(simplified))) return false;

  // 日本語も英字もほぼ無く、記号っぽいページを落とす
  if (japaneseRatio < 0.02 && latinRatio < 0.05 && meaningfulCount < 25) {
    return false;
  }

  // point! だけ延々並ぶようなページを落とす
  const pointCount = (simplified.match(/point!?/g) || []).length;
  if (pointCount >= 3 && meaningfulCount < 35) {
    return false;
  }

  return true;
}

function countMojibakePatterns(text) {
  const suspiciousChars = [
    "ÿ", "¯", "×", "Û", "ß", "", "¼", "²", "ý", "ü", "ó", "÷", "þ", "", ""
  ];

  let count = 0;
  for (const ch of suspiciousChars) {
    count += (text.split(ch).length - 1);
  }
  return count;
}

function buildViewerUrl(relativePath, pageNumber) {
  const filePath = "/" + toPosix(relativePath);
  return `${VIEWER_BASE}${encodeURIComponent(filePath)}#page=${pageNumber}`;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

main().catch(error => {
  console.error("検索インデックス生成失敗");
  console.error(error);
  process.exit(1);
});
