// Screen capture preload — CommonJS, runs in the hidden capture window's isolated world. It has the
// Web APIs (navigator.mediaDevices, canvas) and ipcRenderer. For every display it opens a desktop
// stream at native resolution (capped at 2,560 px wide), grabs a frame about 3 times a second and
// sends it to the main process as a JPEG. Main keeps the last ~2 s in a ring and writes to disk only
// the frames a step needs. No video is recorded. Channel names mirror electron/video/recorder.ts.
const { ipcRenderer } = require("electron");

/** @type {{ displayId: number, stream: MediaStream, video: HTMLVideoElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, hash: HTMLCanvasElement, hashCtx: CanvasRenderingContext2D, lastHash: string, lastSentAt: number, encoding: boolean }[]} */
let captures = [];
/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;
let running = false;
let jpegQuality = 0.9;
let refreshMs = 1000;

function epochNow() {
  return performance.timeOrigin + performance.now();
}

function dhash(cap) {
  cap.hashCtx.drawImage(cap.video, 0, 0, 9, 8);
  const px = cap.hashCtx.getImageData(0, 0, 9, 8).data;
  let bits = "";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const l = (row * 9 + col) * 4;
      const r = l + 4;
      const ll = px[l] * 0.299 + px[l + 1] * 0.587 + px[l + 2] * 0.114;
      const rl = px[r] * 0.299 + px[r + 1] * 0.587 + px[r + 2] * 0.114;
      bits += ll < rl ? "1" : "0";
    }
  }
  return bits;
}

function hamming(a, b) {
  if (!a || !b) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

function toJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("JPEG encoding returned no data."))),
      "image/jpeg",
      jpegQuality,
    );
  });
}

/** Grab one frame of a display. `force` skips the unchanged-frame shortcut. */
async function grab(cap, force) {
  const video = cap.video;
  if (cap.encoding || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return;
  const epoch = Math.round(epochNow());
  // Unchanged screen: tell main to re-stamp the previous frame instead of encoding again. A
  // refresh is forced every second so tiny changes (a typed character) never go stale for long.
  const hash = dhash(cap);
  if (!force && cap.lastHash && hamming(hash, cap.lastHash) <= 2 && epoch - cap.lastSentAt < refreshMs) {
    ipcRenderer.send("video:same", { displayId: cap.displayId, epoch });
    return;
  }
  cap.encoding = true;
  try {
    if (cap.canvas.width !== video.videoWidth || cap.canvas.height !== video.videoHeight) {
      cap.canvas.width = video.videoWidth;
      cap.canvas.height = video.videoHeight;
    }
    cap.ctx.drawImage(video, 0, 0);
    const blob = await toJpeg(cap.canvas);
    const data = new Uint8Array(await blob.arrayBuffer());
    ipcRenderer.send("video:shot", {
      displayId: cap.displayId,
      epoch,
      width: cap.canvas.width,
      height: cap.canvas.height,
      data,
    });
    cap.lastHash = hash;
    cap.lastSentAt = epoch;
  } finally {
    cap.encoding = false;
  }
}

function tick(force) {
  if (!running) return;
  for (const cap of captures) {
    grab(cap, force).catch((err) => {
      ipcRenderer.send("video:error", err instanceof Error ? err.message : String(err));
    });
  }
}

async function openDisplay(source, opts) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: source.sourceId,
        maxFrameRate: opts.captureFps,
        maxWidth: opts.maxWidth,
        maxHeight: opts.maxHeight,
      },
    },
  });
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  const canvas = document.createElement("canvas");
  const hash = document.createElement("canvas");
  hash.width = 9;
  hash.height = 8;
  return {
    displayId: source.displayId,
    stream,
    video,
    canvas,
    ctx: canvas.getContext("2d", { alpha: false }),
    hash,
    hashCtx: hash.getContext("2d", { alpha: false, willReadFrequently: true }),
    lastHash: "",
    lastSentAt: 0,
    encoding: false,
  };
}

function cleanup() {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
  for (const cap of captures) {
    try {
      cap.video.pause();
      cap.video.srcObject = null;
      for (const t of cap.stream.getTracks()) t.stop();
    } catch {
      // ignore
    }
  }
  captures = [];
}

ipcRenderer.on("video:start", async (_event, opts) => {
  try {
    jpegQuality = opts.jpegQuality;
    refreshMs = opts.refreshMs;
    const opened = [];
    for (const source of opts.sources) {
      try {
        opened.push(await openDisplay(source, opts));
      } catch (err) {
        ipcRenderer.send(
          "video:display-error",
          source.displayId,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    if (opened.length === 0) throw new Error("No display could be captured.");
    captures = opened;
    running = true;
    timer = setInterval(() => tick(false), Math.round(1000 / opts.fps));
    ipcRenderer.send("video:started", Math.round(epochNow()), captures.map((c) => c.displayId));
    tick(true);
  } catch (err) {
    cleanup();
    ipcRenderer.send("video:error", err instanceof Error ? err.message : String(err));
  }
});

// A forced frame for every display right now (used for freeze and the final frame).
ipcRenderer.on("video:snapshot", () => tick(true));

ipcRenderer.on("video:stop", () => {
  cleanup();
  ipcRenderer.send("video:stopped", Math.round(epochNow()));
});
