/**
 * CLI: OCR結果の曲名を song-map.json と照合してテストする
 *
 * Usage:
 *   node --loader ts-node/esm scripts/match-song.mjs <image_path> <sdvx6|sdvx7>
 *   node --loader ts-node/esm scripts/match-song.mjs --batch
 *
 * Note: lib/matcher.ts を直接インポートするため ts-node が必要
 *       代替: npx tsx scripts/match-song.mjs --batch
 */

import vision from "@google-cloud/vision";
import fs from "node:fs";
import path from "node:path";
import {
  extractDifficulty,
  extractSongTitleCandidates,
  findBestMatch,
} from "../lib/matcher.ts";

const client = new vision.ImageAnnotatorClient();

async function detectText(imagePath) {
  const [result] = await client.textDetection(imagePath);
  const detections = result.textAnnotations;
  if (!detections || detections.length === 0) {
    return { fullText: "", annotations: [] };
  }
  return {
    fullText: detections[0].description,
    annotations: detections.slice(1).map((d) => ({
      text: d.description,
    })),
  };
}

async function processImage(imagePath, version) {
  const { fullText, annotations } = await detectText(imagePath);
  const diffName = extractDifficulty(annotations);
  const candidates = extractSongTitleCandidates(fullText, version);
  const matches = findBestMatch(candidates, diffName);

  return {
    file: path.basename(imagePath),
    version,
    ocrCandidates: candidates,
    diffName,
    matches,
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--batch") {
    const dir = "result_photo_sample";
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".jpeg") || f.endsWith(".png"))
      .filter((f) => !f.startsWith(".") && !f.includes("debug"))
      .sort();

    console.log(`\n=== ファジーマッチング一括テスト (${files.length}枚) ===\n`);

    for (const file of files) {
      const version = file.startsWith("sdvx6") ? "sdvx6" : "sdvx7";
      const result = await processImage(path.join(dir, file), version);
      const top = result.matches[0];

      console.log(`${file.slice(0, 35)}`);
      console.log(`  OCR候補: [${result.ocrCandidates.map((c) => `"${c}"`).join(", ")}] [${result.diffName}]`);
      console.log(`  MATCH:   ${top ? `${top.song.title} [${top.diff.name}] (${(top.score * 100).toFixed(1)}%) → ${top.url}` : "マッチなし"}`);
      if (top && top.score < 0.9) console.log(`  (採用OCR: "${top.ocrTitle}")`);
      console.log();
    }
  } else if (args.length >= 2) {
    const [imagePath, version] = args;
    const result = await processImage(imagePath, version);

    console.log("\n=== 結果 ===");
    console.log(`  OCR候補:   [${result.ocrCandidates.map((c) => `"${c}"`).join(", ")}]`);
    console.log(`  OCR難易度: ${result.diffName}`);
    if (result.matches.length > 0) {
      console.log("\n  マッチ候補:");
      for (const m of result.matches.slice(0, 3)) {
        console.log(`    ${(m.score * 100).toFixed(1)}% | ${m.song.title} [${m.diff.name}] → ${m.url}`);
      }
    } else {
      console.log("  マッチなし");
    }
  } else {
    console.log("Usage:");
    console.log("  npx tsx scripts/match-song.mjs <image_path> <sdvx6|sdvx7>");
    console.log("  npx tsx scripts/match-song.mjs --batch");
  }
}

main().catch(console.error);
