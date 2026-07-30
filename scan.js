const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const cropCanvas = document.getElementById("cropCanvas");
const startBtn = document.getElementById("startBtn");
const captureBtn = document.getElementById("captureBtn");
const camMsg = document.getElementById("camMsg");
const reviewCard = document.getElementById("reviewCard");
const ocrResult = document.getElementById("ocrResult");
const addBtn = document.getElementById("addBtn");
const retakeBtn = document.getElementById("retakeBtn");
const listCount = document.getElementById("listCount");
const plateListEl = document.getElementById("plateList");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");
const sendMsg = document.getElementById("sendMsg");

const CHAR_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ0123456789";
const STORAGE_KEY = "scanList";
const CONFIDENCE_WARN_THRESHOLD = 60; // tesseract confidence 0-100, kalibrera vid behov
const BURST_FRAMES = 3;
const BURST_DELAY_MS = 150;

let worker = null;
let plates = loadList();
renderList();

function setCamMsg(text, type) {
  camMsg.textContent = text;
  camMsg.className = "msg" + (type ? " " + type : "");
}

function setSendMsg(text, type) {
  sendMsg.textContent = text;
  sendMsg.className = "msg" + (type ? " " + type : "");
}

function loadList() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveList() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plates));
}

function renderList() {
  listCount.textContent = plates.length;
  sendBtn.disabled = plates.length === 0;
  plateListEl.innerHTML = "";
  plates.forEach((p, i) => {
    const li = document.createElement("li");

    const input = document.createElement("input");
    input.type = "text";
    input.value = p.regnr;
    input.maxLength = 10;
    input.addEventListener("change", () => {
      plates[i].regnr = input.value.trim().toUpperCase();
      saveList();
    });

    const ts = document.createElement("span");
    ts.className = "ts";
    ts.textContent = new Date(p.ts).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    del.textContent = "×";
    del.addEventListener("click", () => {
      plates.splice(i, 1);
      saveList();
      renderList();
    });

    li.append(input, ts, del);
    plateListEl.append(li);
  });
}

startBtn.addEventListener("click", async () => {
  setCamMsg("Startar kamera...", "");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    startBtn.hidden = true;
    captureBtn.hidden = false;
    setCamMsg("Rikta regnumret i rutan, tryck Fota", "");
  } catch (err) {
    setCamMsg("Kunde inte starta kamera: " + err.message, "err");
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showCropPreview(sourceCanvas) {
  cropCanvas.width = sourceCanvas.width;
  cropCanvas.height = sourceCanvas.height;
  cropCanvas.getContext("2d").drawImage(sourceCanvas, 0, 0);
}

captureBtn.addEventListener("click", async () => {
  captureBtn.disabled = true;
  setCamMsg("Läser (flera bilder)...", "");
  try {
    // fotar flera bilder i följd och behåller den med högst confidence - motverkar enstaka skakiga/suddiga bilder
    const shots = [];
    for (let i = 0; i < BURST_FRAMES; i++) {
      const cropped = cropToGuide();
      const { text, confidence } = await recognize(cropped);
      shots.push({ text, confidence: confidence || 0, canvas: cropped });
      if (i < BURST_FRAMES - 1) await sleep(BURST_DELAY_MS);
    }
    const best = shots.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    showCropPreview(best.canvas);
    ocrResult.value = correctPlateChars(cleanText(best.text));
    reviewCard.hidden = false;
    ocrResult.focus();
    ocrResult.select();
    if (best.confidence < CONFIDENCE_WARN_THRESHOLD) {
      setCamMsg("", "");
    } else {
      setCamMsg("", "");
    }
  } catch (err) {
    setCamMsg("Kunde inte läsa av: " + err.message, "err");
  } finally {
    captureBtn.disabled = false;
  }
});

function cropToGuide() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  canvas.width = vw;
  canvas.height = vh;
  canvas.getContext("2d").drawImage(video, 0, 0, vw, vh);

  const containerW = video.clientWidth;
  const containerH = video.clientHeight;

  // video visas med object-fit:cover i kvadratisk ram - måste räkna tillbaka till videons faktiska pixlar
  const coverScale = Math.max(containerW / vw, containerH / vh);
  const offsetX = (vw * coverScale - containerW) / 2;
  const offsetY = (vh * coverScale - containerH) / 2;

  const guideWidthPx = 0.78 * containerW;
  const guideHeightPx = guideWidthPx / 4.7;
  const guideLeftPx = (containerW - guideWidthPx) / 2;
  const guideTopPx = (containerH - guideHeightPx) / 2;

  let cropX = (guideLeftPx + offsetX) / coverScale;
  const cropY = (guideTopPx + offsetY) / coverScale;
  let cropW = guideWidthPx / coverScale;
  const cropH = guideHeightPx / coverScale;

  // klipp bort blått landskodsfält (ger falsk bokstav)
  const blueBandRatio = 0.09;
  const blueBandPx = cropW * blueBandRatio;
  cropX += blueBandPx;
  cropW -= blueBandPx;

  const upscale = 3.5;
  // eget canvas per bild (inte det synliga #cropCanvas) - burst-fotografering kör flera bilder innan en visas
  const work = document.createElement("canvas");
  work.width = cropW * upscale;
  work.height = cropH * upscale;
  const ctx = work.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, work.width, work.height);

  toGrayscale(ctx, work.width, work.height);
  sharpen(ctx, work.width, work.height);
  otsuBinarize(ctx, work.width, work.height);
  return work;
}

function toGrayscale(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(imgData, 0, 0);
}

// Otsu-tröskling till ren svart/vit - tåligare mot glans/skugga än enkel min/max-stretch
function otsuBinarize(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) hist[d[i] | 0]++;

  const total = w * h;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];

  let sumB = 0, weightB = 0, maxVariance = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    weightB += hist[t];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += t * hist[t];
    const meanB = sumB / weightB;
    const meanF = (sumAll - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] >= threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
}

// skärpning motverkar kameraoskärpa
function sharpen(ctx, w, h) {
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  const src = ctx.getImageData(0, 0, w, h);
  const srcD = src.data;
  const out = ctx.createImageData(w, h);
  const outD = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let k = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const sx = Math.min(w - 1, Math.max(0, x + kx));
          const sy = Math.min(h - 1, Math.max(0, y + ky));
          sum += srcD[(sy * w + sx) * 4] * kernel[k++];
        }
      }
      const v = Math.min(255, Math.max(0, sum));
      const idx = (y * w + x) * 4;
      outD[idx] = outD[idx + 1] = outD[idx + 2] = v;
      outD[idx + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

async function getWorker() {
  if (!worker) {
    worker = await Tesseract.createWorker("eng");
    await worker.setParameters({
      tessedit_char_whitelist: CHAR_WHITELIST,
      tessedit_pageseg_mode: "13", // rå textrad, hoppar layoutheuristik - beskärningen är redan tight
      tessedit_ocr_engine_mode: "1", // ren LSTM, träffsäkrare än legacy+LSTM; ordnivå-fallback nedan täcker confidence=0
    });
  }
  return worker;
}

async function recognize(canvasEl) {
  const w = await getWorker();
  const { data } = await w.recognize(canvasEl);
  let confidence = data.confidence;
  if (!confidence && data.words?.length) {
    // top-level confidence kan bli 0 med whitelist, räkna snitt på ordnivå istället
    confidence = data.words.reduce((sum, wd) => sum + wd.confidence, 0) / data.words.length;
  }
  return { text: data.text, confidence };
}

function cleanText(text) {
  return text.toUpperCase().replace(/[^A-ZÅÄÖ0-9]/g, "");
}

// sv regnr: 3 bokstäver + 3 tecken, rättar OCR-förväxling per position
const DIGIT_TO_LETTER = { 0: "O", 1: "I", 5: "S", 8: "B" };
const LETTER_TO_DIGIT = { O: "0", I: "1", S: "5", B: "8" };

function isLetterChar(c) {
  return /[A-ZÅÄÖ]/.test(c);
}

function isDigitChar(c) {
  return /[0-9]/.test(c);
}

// hur väl 6 tecken matchar LLL-DD-(L/D) - används för att välja bästa fönster ur en 7-teckenavläsning
function patternScore(chars) {
  let score = 1; // sista positionen kan vara bokstav eller siffra, räknas alltid
  if (isLetterChar(chars[0])) score++;
  if (isLetterChar(chars[1])) score++;
  if (isLetterChar(chars[2])) score++;
  if (isDigitChar(chars[3])) score++;
  if (isDigitChar(chars[4])) score++;
  return score;
}

function applyConfusableFix(text) {
  const chars = text.split("");
  for (let i = 0; i < 3; i++) {
    if (DIGIT_TO_LETTER[chars[i]]) chars[i] = DIGIT_TO_LETTER[chars[i]];
  }
  for (let i = 3; i < 5; i++) {
    if (LETTER_TO_DIGIT[chars[i]]) chars[i] = LETTER_TO_DIGIT[chars[i]];
  }
  // sista tecknet kan vara bokstav (nytt format), rör ej
  return chars.join("");
}

function correctPlateChars(text) {
  if (text.length === 6) return applyConfusableFix(text);

  if (text.length === 7) {
    // troligen ett extra skräptecken (glans/brusrand) - prova ta bort ett i taget, behåll bästa passform
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < text.length; i++) {
      const candidate = text.slice(0, i) + text.slice(i + 1);
      const score = patternScore(candidate.split(""));
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best && bestScore >= 5) return applyConfusableFix(best);
    return text;
  }

  // t.ex. 5 tecken (troligen ett tecken tappat) - okänt vilket tecken som saknas, gissa inte, lämna orört
  return text;
}

retakeBtn.addEventListener("click", () => {
  reviewCard.hidden = true;
  setCamMsg("Rikta regnumret i rutan, tryck Fota", "");
});

addBtn.addEventListener("click", () => {
  const regnr = ocrResult.value.trim().toUpperCase();
  if (!regnr) return;
  plates.push({ regnr, ts: Date.now() });
  saveList();
  renderList();
  reviewCard.hidden = true;
  ocrResult.value = "";
  setCamMsg("Tillagd! Rikta nästa regnummer, tryck Fota", "ok");
});

clearBtn.addEventListener("click", () => {
  if (plates.length === 0) return;
  if (!confirm("Rensa hela listan (" + plates.length + " st)?")) return;
  plates = [];
  saveList();
  renderList();
});

sendBtn.addEventListener("click", async () => {
  if (plates.length === 0) return;

  sendBtn.disabled = true;
  setSendMsg("Skickar...", "");
  try {
    const payload = {
      action: "scan_batch",
      plates: plates.map((p) => ({ regnr: p.regnr, ts: new Date(p.ts).toISOString() })),
    };
    const res = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || "Okänt fel");
    setSendMsg("Skickat! " + plates.length + " regnummer sparade.", "ok");
    plates = [];
    saveList();
    renderList();
  } catch (err) {
    setSendMsg("Kunde inte skicka: " + err.message, "err");
    sendBtn.disabled = plates.length === 0;
  }
});
