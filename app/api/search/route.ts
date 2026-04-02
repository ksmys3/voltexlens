import { NextRequest, NextResponse } from "next/server";
import { searchSongs } from "@/lib/matcher";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const matches = searchSongs(q);
  return NextResponse.json({
    results: matches.map((m) => ({
      title: m.song.title,
      artist: m.song.artist,
      difficulty: m.diff.name,
      level: m.diff.level,
      detailedLevel: m.diff.detailedLevel ?? null,
      score: m.score,
      url: m.url,
    })),
  });
}
