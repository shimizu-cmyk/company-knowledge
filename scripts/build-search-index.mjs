import fs from "fs/promises";
import path from "path";
import * as XLSX from "xlsx";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const ROOT = process.cwd();

const PDF_DIR = path.join(ROOT, "pdf");
const EXCEL_DIR = path.join(ROOT, "excel");
const JSON_DIR = path.join(ROOT, "json");
const OUTPUT_FILE = path.join(JSON_DIR, "search-index.json");

async function main() {
  console.log("検索データ作成開始");

  await ensureDir(JSON_DIR);

  const records = [];
  let id = 1;

  const pdfFiles = await getFiles(PDF_DIR, [".pdf"]);
  const excelFiles = await getFiles(EXCEL_DIR, [".xlsx", ".xls"]);

  console.log(`PDF数: ${pdfFiles.length}`);
  console.log(`Excel数: ${excelFiles.length}`);

  for (const file of pdfFiles) {
    console.log(`PDF読込: ${file}`);
    const items = await readPdf(file);
    for (const item of items) {
      item.id = id++;
      records.push(item);
    }
  }

  for (const file of excelFiles) {
    console.log(`Excel読込: ${file}`);
    const items = await readExcel(file);
    for (const item of items) {
      item.id = id++;
      records.push(item);
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    total: records.length,
    records,
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf-8");

  console.log("完了");
  console.log(`出力先: ${OUTPUT_FILE}`);
  console.log(`総件数: ${records.length}`);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function exists(dir) {
  try {
    await fs.access(dir);
    return true;
  } catch {
    return false;
  }
}

async function getFiles(dir, exts) {
  if (!(await exists(dir))) return [];

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const childFiles = await getFiles(fullPath, exts);
      files.push(...childFiles);
      continue;
    }

    if (!entry.isFile()) continue;
    if (entry.name.startsWith("~$")) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (exts.includes(ext)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function readPdf(filePath) {
  const data = new Uint8Array(await fs.readFile(filePath));
  const pdf = await pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const records = [];

  for (let page = 1; page <= pdf.numPages; page++) {
    const p = await pdf.getPage(page);
    const textContent = await p.getTextContent();

    const text = textContent.items
      .map(item => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) continue;

    const fileName = path.basename(filePath);
    const relPath = toPosix(path.relative(ROOT, filePath));

    records.push({
      type: "pdf",
      title: removeExt(fileName),
      file: fileName,
      path: relPath,
      location: `P${page}`,
      page: page,
      sheet: null,
      row: null,
      text: text,
      url: `./pdfjs/web/viewer.html?file=${encodeURIComponent("/" + relPath)}#page=${page}`
    });
  }

  return records;
}

async function readExcel(filePath) {
  const workbook = XLSX.readFile(filePath, { raw: false });
  const records = [];
  const fileName = path.basename(filePath);
  const relPath = toPosix(path.relative(ROOT, filePath));

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false,
    });

    for (let i = 0; i < rows.length; i++) {
      const row = Array.isArray(rows[i]) ? rows[i] : [];
      const values = row
        .map(v => String(v ?? "").replace(/\s+/g, " ").trim())
        .filter(v => v);

      if (values.length === 0) continue;

      records.push({
        type: "excel",
        title: removeExt(fileName),
        file: fileName,
        path: relPath,
        location: `${sheetName} / 行${i + 1}`,
        page: null,
        sheet: sheetName,
        row: i + 1,
        text: values.join(" | "),
        url: null
      });
    }
  }

  return records;
}

function removeExt(name) {
  return name.replace(/\.[^.]+$/, "");
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

main().catch(err => {
  console.error("エラーが発生しました");
  console.error(err);
  process.exit(1);
});