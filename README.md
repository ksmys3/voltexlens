# VoltexLens

SOUND VOLTEX のリザルト画面を撮影し、[sdvx.in](https://sdvx.in) の譜面ページへ直接アクセスできる Web アプリ。

## 機能

### リザルト画像認識

- カメラでリザルト画面を撮影すると、Google Cloud Vision API で OCR を実行し、楽曲名・難易度を自動認識
- SDVX EXCEED GEAR (6) / SDVX &#x2207; (7) の両バージョンに対応
- 撮影時のガイド枠表示で正確な認識をサポート

### 候補リスト表示

- ベストマッチに加え、「もしかして？」セクションで他の候補（最大4件）を表示
- 誤認識時にリストから正しい楽曲を選択してリカバリー可能

### 曲名検索

- ホーム画面の「曲名で検索」から楽曲名を直接入力して検索
- ファジーマッチングにより多少の入力ミスでもヒット
- 検索結果に全難易度を色付きピルで表示し、任意の難易度の譜面ページへ直接遷移

### 閲覧履歴

- 「譜面を表示」で sdvx.in を開いた楽曲を localStorage に自動保存（最大100件）
- ホーム画面に直近5件を常時表示、「すべて表示」で全履歴一覧へ
- 同じ楽曲は重複せず、最新のタイムスタンプに更新して最上位に移動
- 履歴からも直接 sdvx.in へ遷移可能
- ヘッダーのゴミ箱アイコンから確認付きで全履歴削除

## 技術スタック

- **フロントエンド**: Next.js (App Router) / React / TypeScript
- **OCR**: Google Cloud Vision API
- **マッチング**: Levenshtein距離によるファジーマッチング
- **楽曲データ**: song-map.json
- **デプロイ**: Vercel

## セットアップ

```bash
npm install
```

### 環境変数

| 変数名 | 説明 |
|---|---|
| `GOOGLE_CREDENTIALS` | Google Cloud Vision API のサービスアカウント JSON キー |

ローカル開発時は `gcloud auth application-default login` で ADC を使用可能。

### 開発サーバー

```bash
npm run dev
```

### デプロイ

```bash
vercel --prod
```

## プロジェクト構成

```
app/
  page.tsx              メインUI（ホーム/カメラ/結果/履歴/検索）
  page.module.css       スタイル
  api/
    analyze/route.ts    画像解析API（OCR + マッチング）
    search/route.ts     曲名検索API
lib/
  matcher.ts            OCRテキスト抽出・ファジーマッチング・検索ロジック
data/
  song-map.json         楽曲データベース
scripts/
  build-song-map.mjs    song-map.json 生成スクリプト
```
