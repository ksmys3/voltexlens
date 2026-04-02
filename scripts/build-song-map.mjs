/**
 * sdvx.in の全ソートページをスクレイピングして
 * 曲名 → { version, songId, difficulties } のマッピングテーブルを構築する
 *
 * 出力: data/song-map.json
 */

const SORT_PAGES = [
  // 五十音順
  "sort_a", "sort_k", "sort_s", "sort_t", "sort_n",
  "sort_h", "sort_m", "sort_y", "sort_r", "sort_w", "sort_ん",
  // レベル順
  "sort_01", "sort_02", "sort_03", "sort_04", "sort_05",
  "sort_06", "sort_07", "sort_08", "sort_09", "sort_10",
  "sort_11", "sort_12", "sort_13", "sort_14", "sort_15",
  "sort_16", "sort_17", "sort_18", "sort_19", "sort_20",
];

const BASE_URL = "https://sdvx.in";
const DELAY_MS = 500; // サーバー負荷軽減のためリクエスト間隔

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ソートページHTMLから楽曲エントリを抽出
 * パターン: src="/{ver}/js/{songId}sort.js"></script><script>SORT{songId}();</script><!--{曲名}-->
 */
function parseSortPage(html) {
  const entries = [];
  const regex =
    /src="\/(\d+)\/js\/(\d+)sort\.js"><\/script><script>SORT\d+\(\);<\/script><!--(.+?)-->/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    entries.push({
      version: match[1],
      songId: match[2],
      title: match[3].trim(),
    });
  }
  return entries;
}

/**
 * sort.jsのTITLE変数からサブタイトルを抽出
 * パターン: <div class=f1>メインタイトル<div class=b2>サブタイトル</div></div>
 */
function parseSubtitle(js, songId) {
  const titlePattern = new RegExp(
    `TITLE${songId}="<div class=f1>.*?<div class=b2>(.+?)</div></div>"`,
  );
  const match = js.match(titlePattern);
  return match ? match[1].trim() : null;
}

/**
 * sort.jsから難易度情報を抽出
 * TBR{id}N() → "[曲名] [NOV]" のようなタイトル関数から難易度を特定
 * LV{id}X の存在から利用可能な難易度を判定
 */
function parseSortJs(js, songId) {
  const difficulties = [];

  // 難易度サフィックスと対応する難易度名のパターン
  const suffixes = ["n", "a", "e", "m", "u"];
  for (const suffix of suffixes) {
    const upper = suffix.toUpperCase();
    // LV変数の存在チェック
    const lvPattern = new RegExp(`LV${songId}${upper}\\s*=`);
    if (lvPattern.test(js)) {
      // TBR関数からブラケット内の難易度名を取得
      const tbrPattern = new RegExp(
        `TBR${songId}${upper}\\(\\)\\{document\\.title=".*?\\[([A-Z]+)\\]"`,
      );
      const tbrMatch = js.match(tbrPattern);
      const diffName = tbrMatch ? tbrMatch[1] : suffix.toUpperCase();

      // レベル画像から数値を取得
      // e.g. n_07.png → level=7, e175.png → level=17, detailedLevel=17.5
      //      m_185.png → level=18, detailedLevel=18.5, g193.png → level=19, detailedLevel=19.3
      const lvImgPattern = new RegExp(
        `LV${songId}${upper}=.*?src=/files/lv/([a-z])_?(\\d+)\\.png`,
      );
      const lvImgMatch = js.match(lvImgPattern);
      let level = null;
      let detailedLevel = null;
      if (lvImgMatch) {
        const numStr = lvImgMatch[2];
        if (numStr.length === 3) {
          // "175" → 17.5, "186" → 18.6, "209" → 20.9
          const major = parseInt(numStr.slice(0, 2));
          const minor = parseInt(numStr.slice(2));
          level = major;
          detailedLevel = `${major}.${minor}`;
        } else {
          level = parseInt(numStr);
          // Lv17は17.0と17.5の二択。整数17の場合はdetailedLevel:"17.0"を付与して区別
          if (level === 17) {
            detailedLevel = "17.0";
          }
        }
      }

      const diff = { suffix, name: diffName, level };
      if (detailedLevel) {
        diff.detailedLevel = detailedLevel;
      }
      difficulties.push(diff);
    }
  }

  return difficulties;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

async function main() {
  console.log("=== sdvx.in 楽曲マッピングテーブル構築 ===\n");

  // Step 1: 五十音ソートページから全楽曲エントリを取得（重複なし）
  // レベルソートは同じ曲が複数難易度で出るので五十音のみ使う
  const titlePages = SORT_PAGES.filter((p) => !p.match(/sort_\d+/));
  const songMap = new Map(); // songId → entry

  console.log(`ソートページ取得中... (${titlePages.length}ページ)`);

  for (const page of titlePages) {
    const url = `${BASE_URL}/sort/${page}.htm`;
    console.log(`  ${url}`);
    try {
      const html = await fetchText(url);
      const entries = parseSortPage(html);
      for (const entry of entries) {
        if (!songMap.has(entry.songId)) {
          songMap.set(entry.songId, entry);
        }
      }
    } catch (err) {
      console.error(`  エラー: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\n楽曲数: ${songMap.size}\n`);

  // Step 2: 各楽曲のsort.jsから難易度情報を取得
  console.log("難易度情報取得中...");
  const songs = [...songMap.values()];
  let processed = 0;

  // バッチ処理（5曲ずつ並列）
  const BATCH_SIZE = 5;
  for (let i = 0; i < songs.length; i += BATCH_SIZE) {
    const batch = songs.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (song) => {
        const url = `${BASE_URL}/${song.version}/js/${song.songId}sort.js`;
        try {
          const js = await fetchText(url);
          song.difficulties = parseSortJs(js, song.songId);

          // サブタイトル取得
          song.subtitle = parseSubtitle(js, song.songId);

          // アーティスト名も取得
          const artistMatch = js.match(
            /ARTIST\d+="<div class=b2>　\/ (.+?)<\/div>"/,
          );
          if (artistMatch) {
            song.artist = artistMatch[1];
          }
        } catch (err) {
          console.error(`  エラー (${song.songId}): ${err.message}`);
          song.difficulties = [];
        }
        processed++;
        if (processed % 50 === 0) {
          console.log(`  ${processed}/${songs.length}`);
        }
      }),
    );
    await sleep(DELAY_MS);
  }

  // Step 3: JSON出力
  const output = songs.map((s) => ({
    songId: s.songId,
    version: s.version,
    title: s.title,
    artist: s.artist || null,
    subtitle: s.subtitle || null,
    difficulties: s.difficulties,
  }));

  // data ディレクトリ作成
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dataDir = path.join(import.meta.dirname, "..", "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const outputPath = path.join(dataDir, "song-map.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");

  console.log(`\n完了: ${outputPath}`);
  console.log(`楽曲数: ${output.length}`);

  // 統計
  const totalDiffs = output.reduce(
    (sum, s) => sum + s.difficulties.length,
    0,
  );
  console.log(`総難易度数: ${totalDiffs}`);
}

main().catch(console.error);
