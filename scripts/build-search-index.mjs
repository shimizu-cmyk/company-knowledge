import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

const ROOT = process.cwd();
const PDF_DIR = path.join(ROOT, "pdf");
const OUTPUT_DIR = path.join(ROOT, "search");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "search-index.json");

function getAllPdfFiles(dir) {
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
  return (text || "")
    .replace(/\r/g, "")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  console.log("start");

  if (!fs.existsSync(PDF_DIR)) {
    console.log("pdf folder not found");
    return;
  }

  const pdfFiles = getAllPdfFiles(PDF_DIR);
  console.log("pdf count:", pdfFiles.length);

  const records = [];
  let id = 1;

  for (const file of pdfFiles) {
    try {
      console.log("parsing:", file);

      const buffer = fs.readFileSync(file);
      const data = await pdf(buffer);
      const text = cleanText(data.text);

      const relative = path.relative(ROOT, file).replace(/\\/g, "/");
      const parts = relative.split("/");
      const category = parts.length > 2 ? parts[1] : "general";

      records.push({
        id: "pdf-" + id++,
        type: "pdf",
        title: path.basename(file, ".pdf"),
        category,
        path: relative,
        pdfUrl: "/" + relative,
        viewerUrl: "/" + relative,
        content: text
      });
    } catch (e) {
      console.log("parse failed:", file);
      console.log(e.message);
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

  console.log("done:", records.length);
  console.log("output:", OUTPUT_FILE);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
