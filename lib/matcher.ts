/**
 * OCRテキストから曲名・難易度を抽出し、song-mapとファジーマッチングする
 */

import { distance } from "fastest-levenshtein";
import fs from "node:fs";
import path from "node:path";

// === 型定義 ===

interface Difficulty {
  suffix: string;
  name: string;
  level: number;
  detailedLevel?: string;
}

interface Song {
  songId: string;
  version: string;
  title: string;
  artist: string | null;
  subtitle: string | null;
  fullTitle: string;
  difficulties: Difficulty[];
}

export interface MatchResult {
  song: Song;
  diff: Difficulty;
  score: number;
  ocrTitle: string;
  url: string;
}

export interface AnalyzeResult {
  ocrCandidates: string[];
  diffName: string | null;
  matches: MatchResult[];
}

// === 正規化 ===

function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[《》<>＜＞]/g, "")
    .replace(/[Ø]/gi, "o")
    .replace(/[×x]/g, "x")
    .replace(/\s+/g, " ")
    .trim();
}

// === データ読み込み ===

interface SongIndexed extends Song {
  normTitle: string;
  normFullTitle: string;
  normArtist: string;
}

const songMapPath = path.join(process.cwd(), "data", "song-map.json");
const songMap: SongIndexed[] = (JSON.parse(fs.readFileSync(songMapPath, "utf-8")) as Song[]).map((s) => ({
  ...s,
  normTitle: normalize(s.title),
  normFullTitle: normalize(s.fullTitle),
  normArtist: normalize(s.artist ?? ""),
}));

// === 定数 ===

const DIFF_NAMES = [
  "NOV", "ADV", "EXH", "MXM", "INF", "GRV", "HVN", "VVD", "XCD", "ULT",
];

const NOISE_PATTERNS = [
  /^(DEST|BEST|MAX|CRITICAL|ERROR|NEAR|EARLY|LATE|SCORE|CHIP|LONG|CHAIN|BPM)$/i,
  /^S-CRITICAL/i,
  /^(EX SCORE|BEST SCORE|Y BEST)/i,
  /^(MAXIMUM CHAIN|MAXXIVE RATE)/i,
  /^(QUICK RETRY)/i,
  /^(EFFECTIVE RATE|EXCESSIVE RATE)/i,
  /^(VOL\s*(FORCE|PORCE|FORE))/i,
  /^(BLASTER\s*(GAUGE|GALINE|GAUSE|BALISE|BAUE))/i,
  /^(VARIANT\s*POW)/i,
  /^(PREMIUM\s*PASS)/i,
  /^(CHALLENGE|TSUMAMI|PASELI)$/i,
  /^(BONUS)$/i,
  /^(ステージ|リトライ|START|もう一度|スキップ|キャラクター)/,
  /^(よろしく|MOYAFES|CREDIT|散步|controlled|GIGO|FUJIMON|FUGENE)/i,
  /^\d{7,}/,
  /^\d+%$/,
  /^\d+\s*bl[aec]/,
  /^(店舗|のスコア|に更新|全国スコア)/,
  /^(PERFECT|COMPLETE|CRASH|ULTIMATE CHAIN|EXCESSIVE COMPLETE|FAILED|SAVED)$/i,
];

const GRADE_KEYWORDS = [
  "PERFECT", "ULTIMATE CHAIN", "COMPLETE", "CRASH",
  "EXCESSIVE COMPLETE", "FAILED", "SAVED",
];

const GRADE_REGEX = /^(PERFECT|COMPLETE|CRASH|ULTIMATE CHAIN|EXCESSIVE COMPLETE|FAILED|SAVED)$/i;
const DIFF_LINE_REGEX = new RegExp(`^(${DIFF_NAMES.join("|")})\\s+\\d+`, "i");
const DIFF_ONLY_REGEX = new RegExp(`^(${DIFF_NAMES.join("|")})$`, "i");

// === ヘルパー ===

function isNoiseLine(line: string): boolean {
  if (line.length === 0) return true;
  const cleaned = line.replace(/^[▼▲►■●○◆◇→\-~\s]+/, "");
  return NOISE_PATTERNS.some((p) => p.test(line) || p.test(cleaned));
}

function cleanLine(line: string): string {
  return line.replace(/^[-→►■~・]+\s*/, "").trim();
}

function isUsableLine(line: string): boolean {
  const cleaned = cleanLine(line);
  return cleaned.length >= 1
    && !isNoiseLine(cleaned)
    && !DIFF_LINE_REGEX.test(cleaned)
    && !DIFF_ONLY_REGEX.test(cleaned)
    && !GRADE_REGEX.test(cleaned);
}

function diffNameToSuffix(diffName: string | null): string | null {
  if (!diffName) return null;
  const map: Record<string, string> = {
    NOV: "n", ADV: "a", EXH: "e", ULT: "u",
    MXM: "m", INF: "m", GRV: "m", HVN: "m", VVD: "m", XCD: "m",
  };
  return map[diffName] || null;
}

// === 難易度抽出 ===

interface TextAnnotation {
  text: string;
}

export function extractDifficulty(annotations: TextAnnotation[]): string | null {
  let lastMatch: string | null = null;
  for (const ann of annotations) {
    const upper = ann.text.toUpperCase();
    for (const name of DIFF_NAMES) {
      if (upper === name) {
        lastMatch = name;
      }
    }
  }
  return lastMatch;
}

// === 曲名候補抽出 ===

function extractSongTitleSdvx6(lines: string[]): string[] {
  let lastGradeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const upper = lines[i].toUpperCase();
    if (GRADE_KEYWORDS.some((kw) => upper === kw || upper.startsWith(kw))) {
      lastGradeIdx = i;
    }
    if (upper.includes("ULTIMATE CHA")) {
      lastGradeIdx = i;
    }
  }

  const candidates: string[] = [];
  if (lastGradeIdx >= 0) {
    for (let i = lastGradeIdx + 1; i < Math.min(lastGradeIdx + 4, lines.length); i++) {
      const cleaned = cleanLine(lines[i]);
      if (cleaned.length > 0 && !isNoiseLine(cleaned)) {
        candidates.push(cleaned);
      }
    }
    for (let i = lastGradeIdx - 1; i >= Math.max(lastGradeIdx - 4, 0); i--) {
      const cleaned = cleanLine(lines[i]);
      if (cleaned.length > 0 && !isNoiseLine(cleaned)) {
        candidates.push(cleaned);
      }
    }
  }
  return [...new Set(candidates)];
}

function extractSongTitleCandidatesSdvx7(lines: string[]): string[] {
  const candidates: string[] = [];

  let lastDiffEnd = -1;
  let lastGradeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (DIFF_LINE_REGEX.test(lines[i])) {
      lastDiffEnd = i;
    } else if (DIFF_ONLY_REGEX.test(lines[i]) && i + 1 < lines.length && /^[\d.]+$/.test(lines[i + 1])) {
      lastDiffEnd = i + 1;
    }
    if (GRADE_REGEX.test(lines[i])) {
      lastGradeIdx = i;
    }
  }

  if (lastDiffEnd >= 0) {
    for (let j = lastDiffEnd + 1; j < Math.min(lastDiffEnd + 5, lines.length); j++) {
      if (isUsableLine(lines[j])) candidates.push(cleanLine(lines[j]));
    }
  }
  if (lastGradeIdx >= 1) {
    for (let j = lastGradeIdx - 1; j >= Math.max(lastGradeIdx - 4, 0); j--) {
      if (isUsableLine(lines[j])) candidates.push(cleanLine(lines[j]));
    }
  }
  if (lastGradeIdx >= 0) {
    for (let j = lastGradeIdx + 1; j < Math.min(lastGradeIdx + 4, lines.length); j++) {
      if (isUsableLine(lines[j])) candidates.push(cleanLine(lines[j]));
    }
  }

  return [...new Set(candidates)];
}

export function extractSongTitleCandidates(fullText: string, version: string): string[] {
  const lines = fullText.split("\n").map((l) => l.trim()).filter(Boolean);
  return version === "sdvx6"
    ? extractSongTitleSdvx6(lines)
    : extractSongTitleCandidatesSdvx7(lines);
}

// === ファジーマッチング ===

function similarityNorm(na: string, nb: string): number {
  if (na === nb) return 1.0;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1.0;
  let score = 1 - distance(na, nb) / maxLen;
  if (na.length >= 2 && nb.length >= 2) {
    if (nb.includes(na)) {
      score = Math.max(score, 0.8 + 0.2 * (na.length / nb.length));
    } else if (na.includes(nb)) {
      score = Math.max(score, 0.8 + 0.2 * (nb.length / na.length));
    }
  }
  return score;
}

function scoreSong(normQuery: string, song: SongIndexed): number {
  const s1 = similarityNorm(normQuery, song.normFullTitle);
  if (s1 === 1.0) return 1.0;
  return Math.max(s1, similarityNorm(normQuery, song.normTitle));
}

/**
 * 候補全体をアーティスト名補助付きでsong-mapと照合する。
 *
 * 各曲に対して:
 *   1. 全候補からtitleに最も近いものを探す (titleScore)
 *   2. 全候補からartistに最も近いものを探す (artistScore)
 *   3. アーティストが高スコアならボーナス加算
 *      → 短い曲名("I", "V"等)でもアーティスト名で確定できる
 */
export function findBestMatch(
  ocrTitleCandidates: string[],
  diffName: string | null,
): MatchResult[] {
  const suffix = diffNameToSuffix(diffName);
  if (ocrTitleCandidates.length === 0) return [];

  const normCandidates = ocrTitleCandidates.map((c) => ({
    raw: c,
    norm: normalize(c),
  }));

  const allMatches: MatchResult[] = [];

  for (const song of songMap) {
    // 該当難易度があるか先にチェック
    const diff = suffix
      ? song.difficulties.find((d) => d.suffix === suffix && d.level != null)
      : [...song.difficulties].reverse().find((d) => d.level != null);
    if (!diff) continue;

    // 全候補の中からtitleに最も近いものを探す
    let bestTitleScore = 0;
    let bestTitleRaw = "";
    for (const c of normCandidates) {
      const s = scoreSong(c.norm, song);
      if (s > bestTitleScore) {
        bestTitleScore = s;
        bestTitleRaw = c.raw;
      }
    }
    if (bestTitleScore < 0.4) continue;

    // 全候補の中からartistに最も近いものを探す
    let bestArtistScore = 0;
    if (song.normArtist.length > 0) {
      for (const c of normCandidates) {
        // titleと同じ候補でもartistとマッチする可能性はあるが、
        // title候補と別の候補がartistにマッチする方が信頼度が高い
        const s = similarityNorm(c.norm, song.normArtist);
        if (s > bestArtistScore) {
          bestArtistScore = s;
        }
      }
    }

    // アーティスト一致ボーナス: artistが0.7以上でマッチすれば加算
    let combinedScore = bestTitleScore;
    if (bestArtistScore >= 0.7) {
      combinedScore += bestArtistScore * 0.3;
    }

    allMatches.push({
      song,
      diff,
      score: combinedScore,
      ocrTitle: bestTitleRaw,
      url: `https://sdvx.in/${song.version}/${song.songId}${diff.suffix}.htm`,
    });
  }

  allMatches.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const unique: MatchResult[] = [];
  for (const m of allMatches) {
    if (!seen.has(m.url)) {
      seen.add(m.url);
      unique.push(m);
    }
    if (unique.length >= 5) break;
  }
  return unique;
}

// === 手動検索 ===

export interface SearchResult {
  song: Song;
  score: number;
}

export function searchSongs(query: string): SearchResult[] {
  const normQuery = normalize(query);
  const allMatches: SearchResult[] = [];

  for (const song of songMap) {
    const score = scoreSong(normQuery, song);
    if (score < 0.3) continue;
    const hasValidDiff = song.difficulties.some((d) => d.level != null);
    if (!hasValidDiff) continue;
    allMatches.push({ song, score });
  }

  allMatches.sort((a, b) => b.score - a.score || (a.song.subtitle ? 1 : 0) - (b.song.subtitle ? 1 : 0));
  return allMatches.slice(0, 10);
}
