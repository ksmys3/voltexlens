import { NextRequest, NextResponse } from "next/server";
import { searchSongs } from "@/lib/matcher";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim().slice(0, 100);
  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const matches = searchSongs(q);
  return NextResponse.json({
    results: matches.map((m) => ({
      title: m.song.title,
      artist: m.song.artist,
      score: m.score,
      difficulties: m.song.difficulties
        .filter((d) => d.level != null)
        .map((d) => ({
          name: d.name,
          suffix: d.suffix,
          level: d.level,
          detailedLevel: d.detailedLevel ?? null,
          url: `https://sdvx.in/${m.song.version}/${m.song.songId}${d.suffix}.htm`,
        })),
    })),
  });
}
