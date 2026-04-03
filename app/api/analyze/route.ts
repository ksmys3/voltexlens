import { NextRequest, NextResponse } from "next/server";
import vision from "@google-cloud/vision";
import {
  extractDifficulty,
  extractSongTitleCandidates,
  findBestMatch,
} from "@/lib/matcher";

// ローカル: ADC(gcloud auth)を使用
// Vercel: 環境変数 GOOGLE_CREDENTIALS に JSON キーを設定
let credentials: Record<string, unknown> | undefined;
if (process.env.GOOGLE_CREDENTIALS) {
  try {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  } catch {
    console.error("GOOGLE_CREDENTIALS の JSON パースに失敗しました");
  }
}

const client = new vision.ImageAnnotatorClient(
  credentials ? { credentials } : undefined,
);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("image") as File | null;
    const version = formData.get("version") as string | null;

    if (!file || !version) {
      return NextResponse.json(
        { error: "image と version が必要です" },
        { status: 400 },
      );
    }

    if (version !== "sdvx6" && version !== "sdvx7") {
      return NextResponse.json(
        { error: "version は sdvx6 または sdvx7 を指定してください" },
        { status: 400 },
      );
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "画像サイズが大きすぎます（上限10MB）" },
        { status: 413 },
      );
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "画像ファイルを送信してください" },
        { status: 400 },
      );
    }

    // 画像をバッファに変換
    const buffer = Buffer.from(await file.arrayBuffer());

    // Google Cloud Vision API でテキスト検出
    const [result] = await client.textDetection({ image: { content: buffer } });
    const detections = result.textAnnotations;

    if (!detections || detections.length === 0) {
      return NextResponse.json(
        { error: "画像からテキストを検出できませんでした" },
        { status: 422 },
      );
    }

    const fullText = detections[0].description ?? "";
    const annotations = detections.slice(1).map((d) => ({
      text: d.description ?? "",
    }));

    // 難易度抽出
    const diffName = extractDifficulty(annotations);

    // 曲名候補抽出
    const candidates = extractSongTitleCandidates(fullText, version);

    // ファジーマッチング
    const matches = findBestMatch(candidates, diffName);
    const topMatch = matches[0] ?? null;

    const formatMatch = (m: (typeof matches)[number]) => ({
      title: m.song.title,
      artist: m.song.artist,
      subtitle: m.song.subtitle,
      difficulty: m.diff.name,
      level: m.diff.level,
      detailedLevel: m.diff.detailedLevel ?? null,
      score: m.score,
      url: m.url,
    });

    return NextResponse.json({
      diffName,
      candidates,
      match: topMatch ? formatMatch(topMatch) : null,
      alternatives: matches.slice(1, 5).map(formatMatch),
    });
  } catch (err) {
    console.error("Analyze error:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `サーバーエラー: ${detail}` },
      { status: 500 },
    );
  }
}
