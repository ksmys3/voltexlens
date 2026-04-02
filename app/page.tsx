"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import styles from "./page.module.css";

type Version = "sdvx6" | "sdvx7";
type AppState = "select" | "camera" | "analyzing" | "result" | "error" | "history";

interface MatchResult {
  title: string;
  artist: string | null;
  difficulty: string;
  level: number;
  detailedLevel: string | null;
  score: number;
  url: string;
}

interface HistoryEntry {
  title: string;
  artist: string | null;
  difficulty: string;
  level: number;
  detailedLevel: string | null;
  url: string;
  timestamp: number;
}

const HISTORY_KEY = "voltexlens-history";
const HISTORY_MAX = 100;

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToHistory(entry: Omit<HistoryEntry, "timestamp">): HistoryEntry[] {
  const history = loadHistory();
  const existing = history.findIndex((h) => h.url === entry.url);
  if (existing !== -1) history.splice(existing, 1);
  const newEntry: HistoryEntry = { ...entry, timestamp: Date.now() };
  history.unshift(newEntry);
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  return history;
}

// オーバーレイ枠の定義
const OVERLAY_CONFIG: Record<Version, {
  aspectRatio: number;
  jacket: { left: number; top: number; width: number; height: number };
}> = {
  sdvx6: {
    aspectRatio: 3,
    jacket: { left: 0.04, top: 0.15, width: 0.25, height: 0.75 },
  },
  sdvx7: {
    aspectRatio: 3.5,
    jacket: { left: 0.025, top: 0.2, width: 0.21, height: 0.735 },
  },
};

const FRAME_WIDTH_VW = 90;

export default function Home() {
  const [state, setState] = useState<AppState>("select");
  const [version, setVersion] = useState<Version>("sdvx7");
  const [result, setResult] = useState<MatchResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async (ver: Version) => {
    setVersion(ver);
    setState("camera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      setErrorMsg("カメラへのアクセスが拒否されました");
      setState("error");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    stopCamera();
    setState("analyzing");

    canvas.toBlob(async (blob) => {
      if (!blob) {
        setErrorMsg("画像の取得に失敗しました");
        setState("error");
        return;
      }

      const formData = new FormData();
      formData.append("image", blob, "capture.jpg");
      formData.append("version", version);

      try {
        const res = await fetch("/api/analyze", { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok) {
          setErrorMsg(data.error || "解析に失敗しました");
          setState("error");
          return;
        }

        if (data.match) {
          setResult(data.match);
          setState("result");
        } else {
          setErrorMsg("楽曲を特定できませんでした");
          setState("error");
        }
      } catch {
        setErrorMsg("通信エラーが発生しました");
        setState("error");
      }
    }, "image/jpeg", 0.9);
  }, [version, stopCamera]);

  const reset = useCallback(() => {
    stopCamera();
    setResult(null);
    setErrorMsg("");
    setState("select");
  }, [stopCamera]);

  const retake = useCallback(() => {
    setResult(null);
    setErrorMsg("");
    startCamera(version);
  }, [version, startCamera]);

  useEffect(() => {
    setHistory(loadHistory());
    return () => stopCamera();
  }, [stopCamera]);

  const handleOpenChart = useCallback((entry: Omit<HistoryEntry, "timestamp">) => {
    const updated = saveToHistory(entry);
    setHistory(updated);
  }, []);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        {state === "history" && (
          <button onClick={() => setState("select")} className={styles.backBtn} aria-label="戻る">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
        )}
        {state !== "select" && state !== "history" && (
          <button onClick={reset} className={styles.backBtn} aria-label="ホーム">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>
        )}
        <h1 className={styles.title}>VoltexLens</h1>
      </header>

      {state === "select" && (
        <div className={styles.selectView}>
          <div className={styles.selectViewButtons}>
            <p className={styles.selectLabel}>バージョンを選択してください</p>
            <button onClick={() => startCamera("sdvx7")} className={styles.versionBtn}>
              SDVX ∇
            </button>
            <button onClick={() => startCamera("sdvx6")} className={styles.versionBtn}>
              SDVX EXCEED GEAR
            </button>
          </div>
          {history.length > 0 && (
            <div className={styles.historySection}>
              <p className={styles.historySectionTitle}>最近の履歴</p>
              <ul className={styles.historyList}>
                {history.slice(0, 5).map((entry) => (
                  <HistoryRow key={entry.url} entry={entry} onOpen={handleOpenChart} />
                ))}
              </ul>
              {history.length > 5 && (
                <button onClick={() => setState("history")} className={styles.showAllBtn}>
                  すべて表示
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {state === "history" && (
        <div className={styles.historyView}>
          <ul className={styles.historyList}>
            {history.map((entry) => (
              <HistoryRow key={entry.url} entry={entry} onOpen={handleOpenChart} />
            ))}
          </ul>
          {history.length > 0 && (
            <button
              onClick={() => {
                localStorage.removeItem(HISTORY_KEY);
                setHistory([]);
                setState("select");
              }}
              className={styles.clearBtn}
            >
              履歴をすべて削除
            </button>
          )}
        </div>
      )}

      {state === "camera" && (
        <div className={styles.cameraView}>
          <video ref={videoRef} autoPlay playsInline muted className={styles.video} />
          <OverlayGuide version={version} />
          <div className={styles.captureArea}>
            <button onClick={capture} className={styles.captureBtn} aria-label="撮影">
              <div className={styles.captureBtnInner} />
            </button>
          </div>
          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>
      )}

      {state === "analyzing" && (
        <div className={styles.centerView}>
          <div className={styles.spinner} />
          <p>譜面を検索中...</p>
        </div>
      )}

      {state === "result" && result && (
        <div className={styles.resultView}>
          <div className={styles.resultInfo}>
            <p className={styles.resultDiff}>
              {result.difficulty} {result.detailedLevel ?? result.level}
            </p>
            <h2 className={styles.resultTitle}>{result.title}</h2>
            {result.artist && (
              <p className={styles.resultArtist}>{result.artist}</p>
            )}
            <p className={styles.resultScore}>
              一致度: {(result.score * 100).toFixed(0)}%
            </p>
          </div>
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.linkBtn}
            onClick={() => handleOpenChart({
              title: result.title,
              artist: result.artist,
              difficulty: result.difficulty,
              level: result.level,
              detailedLevel: result.detailedLevel,
              url: result.url,
            })}
          >
            譜面を表示 (sdvx.in)
          </a>
          <button onClick={retake} className={styles.retryBtn} aria-label="もう一度撮影">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      )}

      {state === "error" && (
        <div className={styles.centerView}>
          <p className={styles.errorMsg}>{errorMsg}</p>
          <button onClick={retake} className={styles.retryBtn}>やり直す</button>
        </div>
      )}
    </div>
  );
}

function HistoryRow({ entry, onOpen }: { entry: HistoryEntry; onOpen: (e: Omit<HistoryEntry, "timestamp">) => void }) {
  const date = new Date(entry.timestamp);
  const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;

  return (
    <li className={styles.historyRow}>
      <div className={styles.historyRowInfo}>
        <span className={styles.historyRowDiff}>
          {entry.difficulty} {entry.detailedLevel ?? entry.level}
        </span>
        <span className={styles.historyRowTitle}>{entry.title}</span>
      </div>
      <span className={styles.historyRowDate}>{dateStr}</span>
      <a
        href={entry.url}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.historyRowLink}
        onClick={() => onOpen({
          title: entry.title,
          artist: entry.artist,
          difficulty: entry.difficulty,
          level: entry.level,
          detailedLevel: entry.detailedLevel,
          url: entry.url,
        })}
        aria-label="譜面を表示"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 17L17 7" />
          <path d="M7 7h10v10" />
        </svg>
      </a>
    </li>
  );
}

function OverlayGuide({ version }: { version: Version }) {
  const config = OVERLAY_CONFIG[version];
  const jacket = config.jacket;

  return (
    <div className={styles.overlay}>
      <div
        className={styles.overlayFrame}
        style={{
          width: `${FRAME_WIDTH_VW}vw`,
          aspectRatio: `${config.aspectRatio}`,
        }}
      >
        <div
          className={styles.overlayJacket}
          style={{
            left: `${jacket.left * 100}%`,
            top: `${jacket.top * 100}%`,
            width: `${jacket.width * 100}%`,
            height: `${jacket.height * 100}%`,
          }}
        />
      </div>
      <div
        className={styles.overlayGuideText}
        style={{
          transform: `translateY(calc(-60% + ${FRAME_WIDTH_VW / config.aspectRatio / 2}vw + 16px))`,
        }}
      >
        枠にリザルト上部を合わせて撮影
      </div>
    </div>
  );
}
