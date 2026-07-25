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
  sendBtn.disabled = plates.every((p) => p.sent);
  plateListEl.innerHTML = "";
  plates.forEach((p, i) => {
    const li = document.createElement("li");

    const sentBox = document.createElement("input");
    sentBox.type = "checkbox";
    sentBox.className = "sentBox";
    sentBox.checked = !!p.sent;
    sentBox.disabled = true;
    sentBox.title = p.sent ? "Skickad" : "Ej skickad";

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

    li.append(sentBox, input, ts, del);
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

captureBtn.addEventListener("click", async () => {
  captureBtn.disabled = true;
  setCamMsg("Läser...", "");
  try {
    const cropped = cropToGuide();
    const { text, confidence } = await recognize(cropped);
    ocrResult.value = correctPlateChars(cleanText(text));
    reviewCard.hidden = false;
    ocrResult.focus();
    ocrResult.select();
    if (confidence < 60) {
      setCamMsg("Osäker läsning (" + Math.round(confidence) + "%) - kontrollera texten!", "warn");
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

  const displayedWidth = video.clientWidth;
  const scale = vw / displayedWidth;

  const guideWidthPx = 0.78 * displayedWidth;
  const guideHeightPx = guideWidthPx / 4.7;
  const guideLeftPx = (displayedWidth - guideWidthPx) / 2;
  const guideTopPx = (video.clientHeight - guideHeightPx) / 2;

  let cropX = guideLeftPx * scale;
  const cropY = guideTopPx * scale;
  let cropW = guideWidthPx * scale;
  const cropH = guideHeightPx * scale;

  // klipp bort blått landskodsfält (ger falsk bokstav)
  const blueBandRatio = 0.09;
  const blueBandPx = cropW * blueBandRatio;
  cropX += blueBandPx;
  cropW -= blueBandPx;

  const upscale = 3.5;
  cropCanvas.width = cropW * upscale;
  cropCanvas.height = cropH * upscale;
  const ctx = cropCanvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropCanvas.width, cropCanvas.height);

  grayscaleAndStretch(ctx, cropCanvas.width, cropCanvas.height);
  sharpen(ctx, cropCanvas.width, cropCanvas.height);
  return cropCanvas;
}

function grayscaleAndStretch(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = max - min || 1;
  for (let i = 0; i < d.length; i += 4) {
    const stretched = ((d[i] - min) / range) * 255;
    d[i] = d[i + 1] = d[i + 2] = stretched;
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
      tessedit_pageseg_mode: "7", // enda textrad, inte auto-layout
    });
  }
  return worker;
}

async function recognize(canvasEl) {
  const w = await getWorker();
  const { data } = await w.recognize(canvasEl);
  return { text: data.text, confidence: data.confidence };
}

function cleanText(text) {
  return text.toUpperCase().replace(/[^A-ZÅÄÖ0-9]/g, "");
}

// sv regnr: 3 bokstäver + 3 tecken, rättar OCR-förväxling per position
const DIGIT_TO_LETTER = { 0: "O", 1: "I", 5: "S", 8: "B" };
const LETTER_TO_DIGIT = { O: "0", I: "1", S: "5", B: "8" };

function correctPlateChars(text) {
  if (text.length !== 6) return text;
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

retakeBtn.addEventListener("click", () => {
  reviewCard.hidden = true;
  setCamMsg("Rikta regnumret i rutan, tryck Fota", "");
});

addBtn.addEventListener("click", () => {
  const regnr = ocrResult.value.trim().toUpperCase();
  if (!regnr) return;
  plates.push({ regnr, ts: Date.now(), sent: false });
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
  const unsent = plates.filter((p) => !p.sent);
  if (unsent.length === 0) return;

  sendBtn.disabled = true;
  setSendMsg("Skickar...", "");
  try {
    const payload = {
      action: "scan_batch",
      plates: unsent.map((p) => ({ regnr: p.regnr, ts: new Date(p.ts).toISOString() })),
    };
    const res = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || "Okänt fel");
    unsent.forEach((p) => (p.sent = true));
    saveList();
    renderList();
    setSendMsg("Skickat! " + unsent.length + " regnummer sparade.", "ok");
  } catch (err) {
    setSendMsg("Kunde inte skicka: " + err.message, "err");
    sendBtn.disabled = plates.every((p) => p.sent);
  }
});
