"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

type RenderState =
  | { status: "idle" }
  | { status: "preparing" }
  | { status: "generating"; progress: number }
  | { status: "done"; url: string; size: number }
  | { status: "error"; message: string };

const SAMPLE_LINES = [
  "??????! ?? ?? ?? ???? ???? ?? ??? ???????",
  "?? ?????? ???? ??? ?? ?????? ????? ?? ????????",
  "???? ??????? ?? ??? ???? ???? ? ?????!",
];

function generateHindiScript(topic: string): string[] {
  if (!topic.trim()) return SAMPLE_LINES;
  const base = [
    `??????! ???? ${topic.trim()} ?? ???? ??? ????? ????`,
    `${topic.trim()} ?? ????? ?? ??? ?? ???? ?????? ?? ??????`,
    `??? ?? ?????? ??? ?? ???? ?? ???? ?????`,
  ];
  return base;
}

function splitIntoLines(texts: string[]): string[] {
  return texts.flatMap((t) => (t.length > 40 ? t.match(/.{1,40}(\s|$)/g) ?? [t] : [t])).map((s) => s.trim()).filter(Boolean);
}

export default function Page() {
  const [topic, setTopic] = useState("");
  const [lines, setLines] = useState<string[]>(SAMPLE_LINES);
  const [state, setState] = useState<RenderState>({ status: "idle" });
  const [durationPerLine, setDurationPerLine] = useState(2.5);
  const [resolution, setResolution] = useState<[number, number]>([720, 1280]);
  const [uploading, setUploading] = useState(false);
  const [pageId, setPageId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const videoBlobRef = useRef<Blob | null>(null);

  const totalDuration = useMemo(() => Math.max(5, Math.round(lines.length * durationPerLine)), [lines, durationPerLine]);

  const regenerate = useCallback(() => {
    const script = generateHindiScript(topic);
    setLines(splitIntoLines(script));
  }, [topic]);

  const render = useCallback(async () => {
    try {
      setState({ status: "preparing" });
      const ffmpeg = new FFmpeg();
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist";
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
        workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, "text/javascript"),
      });

      const [h, w] = resolution; // we render portrait by default (720x1280)
      const canvas = document.createElement("canvas");
      canvas.width = w; // width
      canvas.height = h; // height
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported");

      const perLineMs = Math.round(durationPerLine * 1000);
      const framesPerSecond = 30;
      const framesPerLine = Math.max(1, Math.floor((perLineMs / 1000) * framesPerSecond));

      const allLines = lines.length ? lines : SAMPLE_LINES;
      const totalFrames = allLines.length * framesPerLine;

      // Helper: draw a single frame with background gradient and centered text
      const drawFrame = (text: string, progress0to1: number) => {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, `hsl(${Math.floor(220 + 60 * progress0to1)}, 60%, 14%)`);
        grad.addColorStop(1, `hsl(${Math.floor(260 + 60 * progress0to1)}, 60%, 8%)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // subtle vignette
        const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) / 4, w / 2, h / 2, Math.max(w, h) / 1.1);
        vignette.addColorStop(0, "rgba(0,0,0,0)");
        vignette.addColorStop(1, "rgba(0,0,0,0.5)");
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, w, h);

        // title bar
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        const barHeight = 80;
        ctx.fillRect(0, 0, w, barHeight);

        // text shadow
        ctx.shadowColor = "rgba(0,0,0,0.7)";
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;

        // caption box
        const padding = 32;
        const maxTextWidth = w - padding * 2;
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        const boxHeight = Math.min(260, h * 0.35);
        const boxY = h - boxHeight - 54;
        ctx.fillRect(24, boxY, w - 48, boxHeight);

        // text
        ctx.fillStyle = "#ffffff";
        const baseFontSize = Math.min(54, Math.floor(w / 14));
        ctx.font = `600 ${baseFontSize}px system-ui, -apple-system, Segoe UI, Roboto`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // wrap Hindi text
        const words = text.split(/\s+/);
        const linesLocal: string[] = [];
        let current = "";
        for (const word of words) {
          const test = current ? current + " " + word : word;
          const m = ctx.measureText(test);
          if (m.width > maxTextWidth) {
            if (current) linesLocal.push(current);
            current = word;
          } else {
            current = test;
          }
        }
        if (current) linesLocal.push(current);

        const lineHeight = baseFontSize * 1.35;
        const totalTextHeight = linesLocal.length * lineHeight;
        const startY = boxY + boxHeight / 2 - totalTextHeight / 2 + lineHeight / 2;
        linesLocal.forEach((ln, i) => {
          ctx.fillText(ln, w / 2, startY + i * lineHeight);
        });

        // progress ring
        const radius = 24;
        const cx = w - 28 - radius;
        const cy = 28 + radius;
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 6;
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 6;
        ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress0to1);
        ctx.stroke();
      };

      // Write frames into ffmpeg FS
      let frameIndex = 0;
      for (let li = 0; li < allLines.length; li++) {
        for (let fi = 0; fi < framesPerLine; fi++) {
          const p = (frameIndex + 1) / totalFrames;
          drawFrame(allLines[li], p);
          const dataURL = canvas.toDataURL("image/png");
          const png = await (await fetch(dataURL)).arrayBuffer();
          const filename = `frame_${String(frameIndex).padStart(4, "0")}.png`;
          await ffmpeg.writeFile(filename, new Uint8Array(png));
          frameIndex++;
          setState({ status: "generating", progress: p });
        }
      }

      // Attempt mp4 (mpeg4 codec)
      const fps = framesPerSecond;
      const inputPattern = "frame_%04d.png";
      try {
        await ffmpeg.exec([
          "-framerate",
          String(fps),
          "-i",
          inputPattern,
          "-c:v",
          "mpeg4",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          "-vf",
          "format=yuv420p",
          "output.mp4",
        ]);
      } catch (e) {
        // Fallback to MJPEG in MP4 if mpeg4 unavailable
        await ffmpeg.exec([
          "-framerate",
          String(fps),
          "-i",
          inputPattern,
          "-c:v",
          "mjpeg",
          "-q:v",
          "4",
          "-pix_fmt",
          "yuvj420p",
          "output.mp4",
        ]);
      }

      const data = await ffmpeg.readFile("output.mp4");
      const blob = new Blob([data as Uint8Array], { type: "video/mp4" });
      videoBlobRef.current = blob;
      const url = URL.createObjectURL(blob);
      setState({ status: "done", url, size: blob.size });
    } catch (err: any) {
      setState({ status: "error", message: err?.message ?? "Render failed" });
    }
  }, [durationPerLine, lines, resolution]);

  const uploadToFacebook = useCallback(async () => {
    if (!videoBlobRef.current) return;
    if (!pageId || !accessToken) return;
    setUploading(true);
    try {
      const clientForm = new FormData();
      clientForm.append("pageId", pageId);
      clientForm.append("accessToken", accessToken);
      clientForm.append("description", `AI ????? ??????: ${topic || "Short explainer"}`);
      clientForm.append("file", videoBlobRef.current, "video.mp4");
      const res = await fetch("/api/upload-facebook", { method: "POST", body: clientForm });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Upload failed");
      alert("Facebook upload initiated: " + (json?.id || "OK"));
    } catch (e: any) {
      alert("Upload error: " + (e?.message || e));
    } finally {
      setUploading(false);
    }
  }, [accessToken, pageId, topic]);

  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl md:text-3xl font-semibold">AI Hindi Video Agent</h1>
        <p className="text-slate-400 mt-1">Generate a short portrait MP4 with Hindi captions and upload to Facebook.</p>

        <section className="mt-6 grid gap-4">
          <label className="grid gap-2">
            <span className="text-sm text-slate-300">Topic</span>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="??????: ????? ?? ??? ????????"
              className="bg-slate-900 border border-slate-800 rounded px-3 py-2 outline-none focus:border-slate-600"
            />
          </label>

          <div className="flex gap-3">
            <button onClick={regenerate} className="bg-slate-100 text-slate-900 rounded px-3 py-2 text-sm font-medium hover:bg-white">Generate Script</button>
            <button onClick={() => setLines(splitIntoLines(generateHindiScript(topic)))} className="bg-slate-800 text-slate-100 rounded px-3 py-2 text-sm font-medium hover:bg-slate-700">Refresh Lines</button>
          </div>

          <div>
            <span className="text-sm text-slate-300">Script Lines</span>
            <div className="mt-2 grid gap-2">
              {lines.map((ln, i) => (
                <input
                  key={i}
                  value={ln}
                  onChange={(e) => setLines((prev) => prev.map((p, idx) => (idx === i ? e.target.value : p)))}
                  className="bg-slate-900 border border-slate-800 rounded px-3 py-2 outline-none focus:border-slate-600"
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1">
              <span className="text-sm text-slate-300">Seconds per line</span>
              <input
                type="number"
                min={1}
                max={8}
                step={0.5}
                value={durationPerLine}
                onChange={(e) => setDurationPerLine(Number(e.target.value))}
                className="bg-slate-900 border border-slate-800 rounded px-3 py-2 outline-none focus:border-slate-600"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-slate-300">Resolution</span>
              <select
                value={resolution.join("x")}
                onChange={(e) => setResolution(e.target.value.split("x").map(Number) as [number, number])}
                className="bg-slate-900 border border-slate-800 rounded px-3 py-2 outline-none focus:border-slate-600"
              >
                <option value="720x1280">720x1280 (Portrait)</option>
                <option value="1080x1920">1080x1920 (Portrait)</option>
                <option value="1280x720">1280x720 (Landscape)</option>
              </select>
            </label>
          </div>

          <div className="flex items-center justify-between mt-2 text-sm text-slate-400">
            <span>Total duration ~ {totalDuration}s</span>
            <button onClick={render} className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 rounded px-3 py-2 font-semibold">Render MP4</button>
          </div>

          {state.status === "generating" && (
            <div className="mt-2 h-2 w-full bg-slate-800 rounded">
              <div className="h-2 bg-emerald-500 rounded" style={{ width: `${Math.floor(state.progress * 100)}%` }} />
            </div>
          )}

          {state.status === "done" && (
            <div className="mt-4 grid gap-3">
              <video controls playsInline className="w-full rounded border border-slate-800" src={state.url} />
              <div className="flex gap-3">
                <a download="hindi-video.mp4" href={state.url} className="bg-slate-100 text-slate-900 rounded px-3 py-2 text-sm font-medium hover:bg-white">Download MP4 ({(state.size / 1024).toFixed(0)} KB)</a>
              </div>
              <div className="mt-2 grid gap-2">
                <h3 className="text-lg font-semibold">Upload to Facebook</h3>
                <div className="grid gap-2">
                  <input value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="Facebook Page ID" className="bg-slate-900 border border-slate-800 rounded px-3 py-2 outline-none focus:border-slate-600" />
                  <input value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="Page Access Token with pages_manage_posts, pages_read_engagement, pages_show_list, pages_manage_metadata" className="bg-slate-900 border border-slate-800 rounded px-3 py-2 outline-none focus:border-slate-600" />
                  <button disabled={uploading} onClick={uploadToFacebook} className="bg-blue-500 hover:bg-blue-400 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded px-3 py-2 text-sm font-semibold">
                    {uploading ? "Uploading..." : "Upload to Facebook"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {state.status === "error" && <p className="text-red-400">{state.message}</p>}
        </section>
      </div>
    </main>
  );
}
