import type {
  DrawLineTarget,
  ExamPart,
  ExamProfile,
  NormalizedCropBox,
  PartType,
  StudentResult,
  SystemBranding
} from '../types';

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
async function getPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjsLib, workerMod] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      ]);
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
}

export function computeCambridgeShields(correctCount: number, totalQuestions: number): number {
  if (!totalQuestions || totalQuestions <= 0) return 1;
  const ratio = correctCount / totalQuestions;
  if (ratio >= 0.85) return 5;
  if (ratio >= 0.7) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.3) return 2;
  return 1;
}

export function checkHybridAnswerMatch(
  studentRaw: string,
  correctRaw: string,
  partType?: PartType
): boolean {
  const s = (studentRaw || '').trim().toLowerCase().replace(/[.,!?;:'"()]/g, '');
  const c = (correctRaw || '').trim().toLowerCase().replace(/[.,!?;:'"()]/g, '');
  if (!s || s === '[bỏ trống]' || s === '[tô 2 ô]') return false;

  if (partType === 'yes_no') {
    const normS = ['y', 'yes', 'true', 't'].includes(s) ? 'yes' : ['n', 'no', 'false', 'f'].includes(s) ? 'no' : s;
    const normC = ['y', 'yes', 'true', 't'].includes(c) ? 'yes' : ['n', 'no', 'false', 'f'].includes(c) ? 'no' : c;
    return normS === normC;
  }

  if (partType === 'tick_cross') {
    const normS = ['✓', 'v', 'tick', 'true', 'yes'].includes(s) ? '✓' : ['✗', 'x', 'cross', 'false', 'no'].includes(s) ? '✗' : s;
    const normC = ['✓', 'v', 'tick', 'true', 'yes'].includes(c) ? '✓' : ['✗', 'x', 'cross', 'false', 'no'].includes(c) ? '✗' : c;
    return normS === normC;
  }

  const acceptableList = c.split('/').map(x => x.trim()).filter(Boolean);
  return acceptableList.includes(s);
}

export function compressImageFile(
  fileOrDataUrl: File | string,
  maxWidth = 1400,
  quality = 0.85
): Promise<{ dataUrl: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const processImg = (src: string) => {
      const img = new Image();
      img.onload = () => {
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas unavailable'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({
          dataUrl,
          base64: dataUrl.split(',')[1] || ''
        });
      };
      img.onerror = () => reject(new Error('Không thể đọc ảnh đã chọn.'));
      img.src = src;
    };

    if (typeof fileOrDataUrl === 'string') {
      processImg(fileOrDataUrl);
    } else {
      const reader = new FileReader();
      reader.onload = e => processImg(String(e.target?.result || ''));
      reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh.'));
      reader.readAsDataURL(fileOrDataUrl);
    }
  });
}

export async function renderPdfToPageImages(
  file: File,
  maxPages = 100,
  scale = 1.45
): Promise<Array<{ pageNum: number; dataUrl: string; base64: string }>> {
  const [pdfjsLib, arrayBuffer] = await Promise.all([getPdfJs(), file.arrayBuffer()]);
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const limit = Math.min(pdf.numPages, maxPages);
  const pages: Array<{ pageNum: number; dataUrl: string; base64: string }> = [];

  for (let pageNum = 1; pageNum <= limit; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
    pages.push({
      pageNum,
      dataUrl,
      base64: dataUrl.split(',')[1] || ''
    });
  }
  return pages;
}

export async function fileToBase64Images(file: File, maxPages = 10): Promise<string[]> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pages = await renderPdfToPageImages(file, maxPages, 1.55);
    return pages.map(p => p.base64);
  }
  const compressed = await compressImageFile(file, 1400, 0.86);
  return [compressed.base64];
}

export async function compressThumbnailFile(file: File, maxDim = 320, quality = 0.82): Promise<string> {
  const compressed = await compressImageFile(file, maxDim, quality);
  return compressed.dataUrl;
}

function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function cropNormalizedBoxFromBase64(
  base64Jpeg: string,
  crop: NormalizedCropBox,
  maxDim = 260,
  quality = 0.8
): Promise<string> {
  if (!base64Jpeg || !crop) return '';
  const rawY1 = Number(crop.ymin);
  const rawX1 = Number(crop.xmin);
  const rawY2 = Number(crop.ymax);
  const rawX2 = Number(crop.xmax);
  if (
    !Number.isFinite(rawY1) ||
    !Number.isFinite(rawX1) ||
    !Number.isFinite(rawY2) ||
    !Number.isFinite(rawX2)
  ) {
    return '';
  }
  const ymin = Math.min(rawY1, rawY2);
  const ymax = Math.max(rawY1, rawY2);
  const xmin = Math.min(rawX1, rawX2);
  const xmax = Math.max(rawX1, rawX2);
  if (ymax <= ymin + 10 || xmax <= xmin + 10) {
    return '';
  }

  const src = base64Jpeg.startsWith('data:') ? base64Jpeg : `data:image/jpeg;base64,${base64Jpeg}`;
  const img = await loadImageElement(src);
  if (!img || !img.naturalWidth || !img.naturalHeight) return '';

  const pad = 12; // ~1.2% margin on 0-1000 scale so edges aren't clipped
  const y1 = Math.max(0, Math.min(1000, ymin - pad)) / 1000;
  const x1 = Math.max(0, Math.min(1000, xmin - pad)) / 1000;
  const y2 = Math.max(0, Math.min(1000, ymax + pad)) / 1000;
  const x2 = Math.max(0, Math.min(1000, xmax + pad)) / 1000;

  const sx = Math.round(x1 * img.naturalWidth);
  const sy = Math.round(y1 * img.naturalHeight);
  const sw = Math.max(12, Math.round((x2 - x1) * img.naturalWidth));
  const sh = Math.max(12, Math.round((y2 - y1) * img.naturalHeight));

  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const outW = Math.max(16, Math.round(sw * scale));
  const outH = Math.max(16, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function applyAiImageCropsToParts(
  rawParts: any[],
  blankExamImages: string[],
  answerKeyImages: string[]
): Promise<ExamPart[]> {
  const validTypes: PartType[] = [
    'draw_lines',
    'listen_colour',
    'tick_cross',
    'mcq_abc',
    'text_blank',
    'yes_no',
    'matching_ag'
  ];

  const pickSourceBase64 = (crop?: NormalizedCropBox): string => {
    if (!crop || typeof crop.pageIndex !== 'number') return '';
    const idx = Math.max(0, Math.floor(crop.pageIndex));
    const preferKey = String(crop.source || '').toLowerCase().includes('key');
    const primary = preferKey ? answerKeyImages : blankExamImages;
    const fallback = preferKey ? blankExamImages : answerKeyImages;
    if (primary[idx]) return primary[idx];
    if (fallback[idx]) return fallback[idx];
    if (primary.length > 0) return primary[Math.min(idx, primary.length - 1)];
    if (fallback.length > 0) return fallback[Math.min(idx, fallback.length - 1)];
    return '';
  };

  const results: ExamPart[] = [];

  for (let pIdx = 0; pIdx < (rawParts || []).length; pIdx++) {
    const p = rawParts[pIdx];
    const validType: PartType = validTypes.includes(p.type) ? p.type : 'mcq_abc';
    const defaultOpts =
      validType === 'listen_colour'
        ? Array.isArray(p.options) && p.options.length > 0
          ? p.options.map((o: string) => String(o).toUpperCase())
          : ['RED', 'GREEN', 'BLUE', 'YELLOW']
        : validType === 'yes_no'
          ? ['YES', 'NO']
          : validType === 'tick_cross'
            ? ['✓', '✗']
            : validType === 'matching_ag'
              ? ['A', 'B', 'C', 'D', 'E', 'F', 'G']
              : validType === 'mcq_abc'
                ? Array.isArray(p.options) && p.options.length > 0
                  ? p.options
                  : ['A', 'B', 'C']
                : [];

    let sceneImageDataUrl = '';
    if (p.sceneCrop) {
      const srcB64 = pickSourceBase64(p.sceneCrop);
      if (srcB64) {
        sceneImageDataUrl = await cropNormalizedBoxFromBase64(srcB64, p.sceneCrop, 640, 0.8);
      }
    }

    const targets = [];
    for (let tIdx = 0; tIdx < (p.targets || []).length; tIdx++) {
      const tg = p.targets[tIdx];
      let imageDataUrl = '';
      if (tg?.imageCrop) {
        const srcB64 = pickSourceBase64(tg.imageCrop);
        if (srcB64) {
          imageDataUrl = await cropNormalizedBoxFromBase64(srcB64, tg.imageCrop, 340, 0.85);
        }
      }
      targets.push({
        code: String(tg?.code || String.fromCharCode(65 + tIdx)),
        label: String(tg?.label || ''),
        ...(imageDataUrl ? { imageDataUrl } : {})
      });
    }

    const items = [];
    for (let iIdx = 0; iIdx < (p.items || []).length; iIdx++) {
      const it = p.items[iIdx];
      let imageDataUrl = '';
      if (it?.imageCrop) {
        const srcB64 = pickSourceBase64(it.imageCrop);
        if (srcB64) {
          imageDataUrl = await cropNormalizedBoxFromBase64(srcB64, it.imageCrop, 220, 0.8);
        }
      }
      items.push({
        q: Number(it?.q) || iIdx + 1,
        prompt: validType === 'listen_colour' ? '' : String(it?.prompt || ''),
        ans: validType === 'listen_colour' ? String(it?.ans || '').trim().toUpperCase() : String(it?.ans || '').trim(),
        targetDesc: String(it?.targetDesc || ''),
        ...(imageDataUrl ? { imageDataUrl } : {})
      });
    }

    results.push({
      id: `part-${Date.now()}-${pIdx}`,
      title: String(p.title || `Part ${pIdx + 1}`),
      skill: String(p.skill || '').toLowerCase().includes('listen') ? 'Listening' : 'Reading & Writing',
      type: validType,
      note: String(p.note || ''),
      ...(sceneImageDataUrl ? { sceneImageDataUrl } : {}),
      options: defaultOpts.map((o: unknown) => String(o)),
      targets,
      items
    });
  }

  return results;
}

const COLOUR_SWATCH_MAP: Record<string, string> = {
  RED: '#ef4444',
  GREEN: '#22c55e',
  BLUE: '#3b82f6',
  YELLOW: '#eab308',
  ORANGE: '#f97316',
  PINK: '#ec4899',
  PURPLE: '#a855f7',
  BROWN: '#92400e',
  BLACK: '#0f172a',
  WHITE: '#ffffff',
  GREY: '#94a3b8',
  GRAY: '#94a3b8'
};

function drawImageContained(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const imgRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
  const boxRatio = w / Math.max(1, h);
  let drawW = w;
  let drawH = h;
  if (imgRatio > boxRatio) {
    drawH = w / imgRatio;
  } else {
    drawW = h * imgRatio;
  }
  const dx = x + (w - drawW) / 2;
  const dy = y + (h - drawH) / 2;
  ctx.drawImage(img, dx, dy, drawW, drawH);
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

export async function renderAnswerSheetToCanvas(
  profile: ExamProfile,
  paperSize: 'A4' | 'A5' = 'A4',
  fillDemoAnswers = false,
  branding?: SystemBranding | null
): Promise<HTMLCanvasElement> {
  const isA5 = paperSize === 'A5';
  // True A4 (210x297mm) & A5 (148x210mm) logical units rendered at 2x (300 DPI print sharpness!)
  const dpiScale = 2;
  const W = isA5 ? 874 : 1240;
  const H = isA5 ? 1240 : 1754;

  const canvas = document.createElement('canvas');
  canvas.width = W * dpiScale;
  canvas.height = H * dpiScale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpiScale, dpiScale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const FONT_FAMILY = "'Inter', 'Segoe UI', Arial, sans-serif";
  const margin = isA5 ? 28 : 38;
  const markerInset = isA5 ? 12 : 16;
  const markerSize = isA5 ? 18 : 22;

  // Preload all embedded images from parts/targets/items
  const parts = profile.parts || [];
  const imageCache = new Map<string, HTMLImageElement>();
  const urlsToLoad = new Set<string>();
  parts.forEach(part => {
    if (part.sceneImageDataUrl) urlsToLoad.add(part.sceneImageDataUrl);
    (part.targets || []).forEach(tg => {
      if (tg.imageDataUrl) urlsToLoad.add(tg.imageDataUrl);
    });
    (part.items || []).forEach(it => {
      if (it.imageDataUrl) urlsToLoad.add(it.imageDataUrl);
    });
  });

  await Promise.all(
    Array.from(urlsToLoad).map(async url => {
      const img = await loadImageElement(url);
      if (img) imageCache.set(url, img);
    })
  );

  // Page background & 4 corner OMR alignment markers
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#000000';
  ctx.fillRect(markerInset, markerInset, markerSize, markerSize);
  ctx.fillRect(W - markerInset - markerSize, markerInset, markerSize, markerSize);
  ctx.fillRect(markerInset, H - markerInset - markerSize, markerSize, markerSize);
  ctx.fillRect(W - markerInset - markerSize, H - markerInset - markerSize, markerSize, markerSize);

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = isA5 ? 2.2 : 2.6;
  ctx.strokeRect(margin, margin, W - margin * 2, H - margin * 2);

  const totalQ = parts.reduce((sum, p) => sum + (p.items?.length || 0), 0);
  const contentPadX = isA5 ? 10 : 12;
  const contentLeft = margin + contentPadX;
  const innerW = W - contentLeft * 2;

  // Crisp High-Contrast Sheet Header
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.font = `700 ${isA5 ? 18.5 : 24}px ${FONT_FAMILY}`;
  ctx.fillText(
    truncateText(
      ctx,
      branding?.sheetHeaderTitle || 'CAMBRIDGE ENGLISH ANSWER SHEET (1-PAGE SUMMARY)',
      innerW
    ),
    W / 2,
    margin + (isA5 ? 27 : 35)
  );

  const schoolSubtitle = profile.schoolName?.trim() ? `${profile.schoolName.trim()} · ` : '';
  const classSubtitle = profile.classLabel?.trim() ? ` (${profile.classLabel.trim()})` : '';
  ctx.font = `600 ${isA5 ? 12.5 : 15.5}px ${FONT_FAMILY}`;
  ctx.fillStyle = '#1e293b';
  ctx.fillText(
    truncateText(
      ctx,
      `${schoolSubtitle}${profile.gradeName}${classSubtitle} · ${profile.examTitle} · Total: ${totalQ} Questions`,
      innerW
    ),
    W / 2,
    margin + (isA5 ? 46 : 58)
  );

  // Full-Width Identity Header Box (Name · Class · School · SBD)
  const infoTop = margin + (isA5 ? 55 : 68);
  const infoBoxH = isA5 ? 54 : 66;

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(contentLeft, infoTop, innerW, infoBoxH);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.6;
  ctx.strokeRect(contentLeft, infoTop, innerW, infoBoxH);

  const midY = infoTop + infoBoxH / 2;
  const splitX = contentLeft + innerW * 0.64;
  ctx.beginPath();
  ctx.moveTo(contentLeft, midY);
  ctx.lineTo(contentLeft + innerW, midY);
  ctx.moveTo(splitX, infoTop);
  ctx.lineTo(splitX, infoTop + infoBoxH);
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = '#64748b';
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#000000';
  ctx.font = `700 ${isA5 ? 13 : 16}px ${FONT_FAMILY}`;

  const row1Y = infoTop + infoBoxH * 0.34;
  const row2Y = midY + infoBoxH * 0.34;
  const col1X = contentLeft + 10;
  const col2X = splitX + 10;

  const printedSchool = profile.schoolName?.trim() || '';
  const printedClass = profile.classLabel?.trim() || '';

  ctx.fillText(fillDemoAnswers ? 'Full Name: Tran Bao An' : 'Full Name / Họ tên:', col1X, row1Y);
  ctx.fillText(
    fillDemoAnswers
      ? `Class: ${printedClass || `${profile.gradeName} - 2A1`}`
      : printedClass
        ? `Class / Lớp: ${printedClass}`
        : 'Class / Lớp:',
    col2X,
    row1Y
  );
  ctx.fillText(
    fillDemoAnswers
      ? `School: ${printedSchool || 'TH Nguyễn Bỉnh Khiêm'}`
      : printedSchool
        ? `School / Trường: ${printedSchool}`
        : 'School / Trường:',
    col1X,
    row2Y
  );
  ctx.fillText(fillDemoAnswers ? 'Code / SBD: 018' : 'Code / SBD:', col2X, row2Y);

  const bodyTop = infoTop + infoBoxH + (isA5 ? 10 : 12);
  const footerReserve = isA5 ? 24 : 28;
  const bodyBottom = H - margin - footerReserve;
  const availBodyH = bodyBottom - bodyTop;

  // Responsive Full-Width Body Renderer (NEVER shrinks width — adapts vertical rhythm & columns to fit 100% width cleanly!)
  const renderBodyParts = (density: number, dryRun: boolean): number => {
    const d = Math.max(0.42, Math.min(1.0, density));
    const fontScale = Math.max(0.8, 0.86 + 0.14 * d); // Keep fonts bold, large & crisp even on dense exams!
    let y = bodyTop;

    parts.forEach((part, pIdx) => {
      const headerH = Math.round((isA5 ? 24 : 30) * (0.85 + 0.15 * d));
      if (!dryRun) {
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(contentLeft, y, innerW, headerH);
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(contentLeft, y, innerW, headerH);

        ctx.fillStyle = '#000000';
        ctx.font = `700 ${((isA5 ? 12.5 : 15.5) * fontScale).toFixed(1)}px ${FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.fillText(
          truncateText(ctx, part.title, innerW - (isA5 ? 120 : 160)),
          contentLeft + 10,
          y + headerH * 0.68
        );

        ctx.textAlign = 'right';
        ctx.font = `700 ${((isA5 ? 10.5 : 13) * fontScale).toFixed(1)}px ${FONT_FAMILY}`;
        ctx.fillStyle = '#334155';
        ctx.fillText(part.skill.toUpperCase(), contentLeft + innerW - 10, y + headerH * 0.68);
        ctx.textAlign = 'left';
      }

      y += headerH + Math.round((isA5 ? 6 : 8) * d);
      const items = part.items || [];
      const sceneImg = part.sceneImageDataUrl ? imageCache.get(part.sceneImageDataUrl) : undefined;

      // ------------------------------------------------------------------
      // 1. DRAW LINES — Full-Width Horizontal Top-to-Bottom Picture Cards
      // ------------------------------------------------------------------
      if (part.type === 'draw_lines') {
        const cueH = Math.round((isA5 ? 15 : 18) * d);
        if (!dryRun) {
          ctx.fillStyle = '#334155';
          ctx.font = `italic ${((isA5 ? 10.5 : 12.5) * fontScale).toFixed(1)}px ${FONT_FAMILY}`;
          ctx.fillText(
            'Draw lines from names to matching pictures (Nối tên với hình tương ứng)',
            contentLeft + 4,
            y + cueH * 0.72
          );
        }
        y += cueH + Math.round(4 * d);

        const targets: DrawLineTarget[] =
          part.targets && part.targets.length > 0
            ? part.targets
            : items.map((it, idx) => ({
                code: String.fromCharCode(65 + idx),
                label: it.targetDesc || `Picture ${String.fromCharCode(65 + idx)}`
              }));

        const nameBoxH = Math.round((isA5 ? 24 : 30) * (0.86 + 0.14 * d));
        const nameTopY = y;
        const topDotY = nameTopY + nameBoxH + Math.round((isA5 ? 10 : 12) * d);
        const lineGap = Math.round((isA5 ? 38 : 54) * d);
        const bottomDotY = topDotY + lineGap;
        const cardTopY = bottomDotY + Math.round((isA5 ? 10 : 12) * d);

        const itemCount = Math.max(1, items.length);
        const itemGap = isA5 ? 10 : 16;
        const maxNameBoxW = isA5 ? 175 : 230;
        const nameBoxW = Math.min(maxNameBoxW, Math.floor((innerW - itemGap * (itemCount - 1)) / itemCount));
        const itemSlotW = innerW / itemCount;
        const itemCentersX: number[] = [];

        items.forEach((it, idx) => {
          const cx = contentLeft + itemSlotW * (idx + 0.5);
          itemCentersX.push(cx);
          if (!dryRun) {
            const bx = cx - nameBoxW / 2;
            ctx.fillStyle = '#f8fafc';
            ctx.strokeStyle = '#64748b';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.roundRect(bx, nameTopY, nameBoxW, nameBoxH, 7);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#000000';
            ctx.font = `700 ${((isA5 ? 13 : 16.5) * fontScale).toFixed(1)}px ${FONT_FAMILY}`;
            ctx.textAlign = 'center';
            ctx.fillText(
              truncateText(ctx, `Q${it.q}. ${it.prompt || `Name ${it.q}`}`, nameBoxW - 12),
              cx,
              nameTopY + nameBoxH * 0.68
            );
            ctx.textAlign = 'left';

            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.arc(cx, topDotY, isA5 ? 5 : 6, 0, Math.PI * 2);
            ctx.fill();
          }
        });

        const targetCount = Math.max(1, targets.length);
        const cardGap = isA5 ? 8 : 12;
        const cardW = Math.floor((innerW - cardGap * (targetCount - 1)) / targetCount);
        // Scale picture card height proportionally to cardW & density so images stay large and crisp!
        const idealCardH = Math.min(isA5 ? 92 : 126, Math.round(cardW * 0.68));
        const cardH = Math.round(idealCardH * (0.74 + 0.26 * d));
        const targetCentersX: number[] = [];

        targets.forEach((tg, idx) => {
          const cardX = contentLeft + idx * (cardW + cardGap);
          const cx = cardX + cardW / 2;
          targetCentersX.push(cx);

          if (!dryRun) {
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.arc(cx, bottomDotY, isA5 ? 5 : 6, 0, Math.PI * 2);
            ctx.fill();

            const tgImg = tg.imageDataUrl ? imageCache.get(tg.imageDataUrl) : undefined;
            if (tgImg) {
              ctx.fillStyle = '#ffffff';
              ctx.strokeStyle = '#1e293b';
              ctx.lineWidth = 1.6;
              ctx.beginPath();
              ctx.roundRect(cardX, cardTopY, cardW, cardH, 8);
              ctx.fill();
              ctx.stroke();
              drawImageContained(ctx, tgImg, cardX + 4, cardTopY + 4, cardW - 8, cardH - 8);
            } else {
              ctx.save();
              ctx.fillStyle = '#f8fafc';
              ctx.strokeStyle = '#94a3b8';
              ctx.lineWidth = 1.4;
              ctx.setLineDash([5, 4]);
              ctx.beginPath();
              ctx.roundRect(cardX, cardTopY, cardW, cardH, 8);
              ctx.fill();
              ctx.stroke();
              ctx.restore();

              const iconW = 22;
              const iconH = 16;
              const iconX = cx - iconW / 2;
              const iconY = cardTopY + cardH / 2 - 14;
              ctx.strokeStyle = '#94a3b8';
              ctx.lineWidth = 1.2;
              ctx.strokeRect(iconX, iconY, iconW, iconH);
              ctx.beginPath();
              ctx.moveTo(iconX + 3, iconY + iconH - 3);
              ctx.lineTo(iconX + 8, iconY + 8);
              ctx.lineTo(iconX + 13, iconY + 12);
              ctx.lineTo(iconX + 17, iconY + 6);
              ctx.lineTo(iconX + iconW - 3, iconY + iconH - 3);
              ctx.stroke();

              ctx.fillStyle = '#475569';
              ctx.font = `600 ${isA5 ? 10 : 12}px ${FONT_FAMILY}`;
              ctx.textAlign = 'center';
              ctx.fillText(`Khung hình ${tg.code}`, cx, cardTopY + cardH / 2 + 16);
              ctx.textAlign = 'left';
            }

            // Crisp Target Letter Badge (A..F)
            const badgeR = isA5 ? 10.5 : 13;
            const badgeX = cardX + badgeR + 4;
            const badgeY = cardTopY + badgeR + 4;
            ctx.fillStyle = '#0f172a';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.font = `700 ${isA5 ? 11 : 13.5}px ${FONT_FAMILY}`;
            ctx.textAlign = 'center';
            ctx.fillText(tg.code, badgeX, badgeY + (isA5 ? 3.8 : 4.6));
            ctx.textAlign = 'left';
          }
        });

        if (!dryRun && fillDemoAnswers) {
          items.forEach((it, idx) => {
            const tIdx = targets.findIndex(t => t.code === it.ans);
            if (tIdx >= 0 && itemCentersX[idx] !== undefined && targetCentersX[tIdx] !== undefined) {
              ctx.strokeStyle = '#1d4ed8';
              ctx.lineWidth = 2.6;
              ctx.beginPath();
              ctx.moveTo(itemCentersX[idx], topDotY);
              ctx.lineTo(targetCentersX[tIdx], bottomDotY);
              ctx.stroke();
            }
          });
        }

        y = cardTopY + cardH + Math.round((isA5 ? 8 : 12) * d);
        return;
      }

      // ------------------------------------------------------------------
      // 2. NON-DRAW_LINES PARTS — Full-Width Grid + Optional Side-by-Side Scene
      // ------------------------------------------------------------------
      const useSideScene = Boolean(sceneImg);
      const sceneGap = isA5 ? 12 : 16;
      const sceneColW = useSideScene ? Math.round(innerW * (isA5 ? 0.3 : 0.28)) : 0;
      const qAreaLeft = contentLeft + (useSideScene ? sceneColW + sceneGap : 0);
      const qAreaW = innerW - (useSideScene ? sceneColW + sceneGap : 0);
      const qStartY = y;

      if (part.type === 'text_blank') {
        // Avoid repeating tiny duplicate thumbnails when a large shared sceneImg is already shown on the left
        const distinctItemImgs = items.filter(
          it => Boolean(it.imageDataUrl && imageCache.has(it.imageDataUrl) && (!useSideScene || it.imageDataUrl !== part.sceneImageDataUrl))
        );
        const showItemThumbs = !useSideScene && distinctItemImgs.length > 0;
        const thumbW = Math.round((isA5 ? 46 : 62) * (0.82 + 0.18 * d));
        const thumbH = Math.round((isA5 ? 34 : 46) * (0.82 + 0.18 * d));

        const hasLongPrompts = items.some(it => (it.prompt || '').length > 22);
        const cols = useSideScene && (isA5 || hasLongPrompts) ? 1 : 2;
        const colGap = isA5 ? 14 : 22;
        const colW = (qAreaW - colGap * (cols - 1)) / cols;
        const rowStep = showItemThumbs
          ? thumbH + Math.round((isA5 ? 8 : 11) * d)
          : Math.round((isA5 ? 27 : 34) * (0.8 + 0.2 * d));

        const numRows = Math.ceil(items.length / cols);

        items.forEach((item, idx) => {
          const row = Math.floor(idx / cols);
          const col = idx % cols;
          const x = qAreaLeft + col * (colW + colGap);
          const rowTopY = qStartY + row * rowStep;
          const textY = rowTopY + (showItemThumbs ? thumbH / 2 + 5 : rowStep * 0.65);

          if (!dryRun) {
            ctx.fillStyle = '#000000';
            ctx.font = `700 ${((isA5 ? 13 : 16) * fontScale).toFixed(1)}px ${FONT_FAMILY}`;
            const qLabel = `Q${item.q}:`;
            ctx.fillText(qLabel, x, textY);
            let offset = ctx.measureText(qLabel).width + (isA5 ? 8 : 10);

            const itImg = showItemThumbs && item.imageDataUrl ? imageCache.get(item.imageDataUrl) : undefined;
            if (itImg) {
              const ix = x + offset;
              ctx.fillStyle = '#ffffff';
              ctx.strokeStyle = '#94a3b8';
              ctx.lineWidth = 1.2;
              ctx.beginPath();
              ctx.roundRect(ix, rowTopY, thumbW, thumbH, 5);
              ctx.fill();
              ctx.stroke();
              drawImageContained(ctx, itImg, ix + 2, rowTopY + 2, thumbW - 4, thumbH - 4);
              offset += thumbW + 10;
            }

            if (item.prompt) {
              ctx.fillStyle = '#1e293b';
              ctx.font = `500 ${((isA5 ? 11.5 : 14) * fontScale).toFixed(1)}px ${FONT_FAMILY}`;
              const minLineW = isA5 ? 95 : 140;
              const maxPromptW = Math.max(60, colW - offset - minLineW - 10);
              const pText = truncateText(ctx, item.prompt, maxPromptW);
              ctx.fillText(pText, x + offset, textY);
              offset += Math.min(maxPromptW, ctx.measureText(pText).width) + 10;
            }

            const lineStart = x + offset;
            const lineEnd = x + colW - 4;
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(lineStart, textY + 4);
            ctx.lineTo(lineEnd, textY + 4);
            ctx.stroke();

            if (fillDemoAnswers) {
              const demoVal = idx === 2 && pIdx === 1 ? 'wrong' : item.ans;
              ctx.fillStyle = '#1d4ed8';
              ctx.font = `italic 700 ${((isA5 ? 14 : 17.5) * fontScale).toFixed(1)}px ${FONT_FAMILY}`;
              ctx.fillText(demoVal, lineStart + 8, textY - 1);
            }
          }
        });

        const qBlockH = Math.max(1, numRows) * rowStep;
        const minSceneH = useSideScene ? Math.round((isA5 ? 88 : 116) * (0.8 + 0.2 * d)) : 0;
        const partContentH = Math.max(qBlockH, minSceneH);

        if (!dryRun && useSideScene && sceneImg) {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.roundRect(contentLeft, qStartY, sceneColW, partContentH - 4, 8);
          ctx.fill();
          ctx.stroke();
          drawImageContained(ctx, sceneImg, contentLeft + 5, qStartY + 5, sceneColW - 10, partContentH - 14);
        }

        y = qStartY + partContentH + Math.round((isA5 ? 7 : 10) * d);
        return;
      }

      // ------------------------------------------------------------------
      // 3. OPTION PARTS (mcq_abc, tick_cross, yes_no, listen_colour, matching_ag)
      // ------------------------------------------------------------------
      const opts =
        part.options && part.options.length > 0
          ? part.options
          : part.type === 'listen_colour'
            ? ['RED', 'GREEN', 'BLUE', 'YELLOW']
            : part.type === 'yes_no'
              ? ['YES', 'NO']
              : part.type === 'tick_cross'
                ? ['✓', '✗']
                : part.type === 'matching_ag'
                  ? ['A', 'B', 'C', 'D', 'E', 'F', 'G']
                  : ['A', 'B', 'C'];

      const hasAnyItemImg = items.some(
        it => Boolean(it.imageDataUrl && imageCache.has(it.imageDataUrl) && (!useSideScene || it.imageDataUrl !== part.sceneImageDataUrl))
      );
      const isColour = part.type === 'listen_colour';
      const isPill = part.type === 'yes_no' || isColour;

      const thumbW = Math.round((isA5 ? 46 : 62) * (0.82 + 0.18 * d));
      const thumbH = Math.round((isA5 ? 36 : 48) * (0.82 + 0.18 * d));

      // Compute optimal columns to fill 100% of qAreaW without dead whitespace!
      const qLabelW = isA5 ? 42 : 52;
      const imgReserve = hasAnyItemImg ? thumbW + 14 : 0;
      const basePillW = isColour ? (isA5 ? 82 : 104) : isA5 ? 52 : 64;
      const baseBubbleStep = isA5 ? 38 : 48;
      const optGroupMinW = isPill
        ? opts.length * (basePillW + (isA5 ? 8 : 10))
        : opts.length * baseBubbleStep;
      const minCellW = qLabelW + imgReserve + optGroupMinW + 10;

      let cols = Math.max(1, Math.floor((qAreaW + 12) / minCellW));
      if (part.type === 'matching_ag' || opts.length > 5) {
        cols = Math.min(cols, isA5 ? 1 : 2);
      } else if (isColour) {
        cols = Math.min(cols, isA5 ? 1 : 2);
      } else {
        cols = Math.min(cols, items.length, isA5 ? 2 : 4);
      }
      cols = Math.max(1, cols);

      const colGap = isA5 ? 12 : 18;
      const colW = (qAreaW - colGap * (cols - 1)) / cols;
      const rowStep = hasAnyItemImg
        ? thumbH + Math.round((isA5 ? 8 : 10) * d)
        : Math.round((isA5 ? 30 : 38) * (0.82 + 0.18 * d));

      const numRows = Math.ceil(items.length / cols);

      items.forEach((item, idx) => {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        const x = qAreaLeft + col * (colW + colGap);
        const rowTopY = qStartY + row * rowStep;
        const centerY = rowTopY + (hasAnyItemImg ? thumbH / 2 : rowStep / 2);

        if (!dryRun) {
          ctx.fillStyle = '#000000';
          ctx.font = `700 ${((isA5 ? 13 : 16) * fontScale).toFixed(1)}px ${FONT_FAMILY}`;
          ctx.fillText(`Q${item.q}:`, x, centerY + 5);

          let optStartX = x + qLabelW;
          const itImg =
            hasAnyItemImg && item.imageDataUrl && (!useSideScene || item.imageDataUrl !== part.sceneImageDataUrl)
              ? imageCache.get(item.imageDataUrl)
              : undefined;
          if (itImg) {
            const ix = x + (isA5 ? 38 : 48);
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(ix, rowTopY, thumbW, thumbH, 5);
            ctx.fill();
            ctx.stroke();
            drawImageContained(ctx, itImg, ix + 2, rowTopY + 2, thumbW - 4, thumbH - 4);
            optStartX = ix + thumbW + (isA5 ? 12 : 16);
          }

          const availOptW = Math.max(80, x + colW - optStartX - 4);
          const pillH = Math.round((isA5 ? 23 : 28) * (0.86 + 0.14 * d));
          const bubbleR = Math.round((isA5 ? 12 : 15) * (0.86 + 0.14 * d));

          if (isPill) {
            const pGap = isA5 ? 7 : 10;
            const maxPillW = isColour ? (isA5 ? 118 : 138) : isA5 ? 68 : 82;
            const pillW = Math.min(
              maxPillW,
              Math.floor((availOptW - pGap * (opts.length - 1)) / opts.length)
            );

            opts.forEach((opt, oIdx) => {
              const rx = optStartX + oIdx * (pillW + pGap);
              const ry = centerY - pillH / 2;
              const isSelected = fillDemoAnswers && opt.toUpperCase() === (item.ans || '').toUpperCase();

              ctx.beginPath();
              ctx.roundRect(rx, ry, pillW, pillH, pillH / 2);
              if (isSelected) {
                ctx.fillStyle = '#0f172a';
                ctx.fill();
              } else {
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.strokeStyle = '#0f172a';
                ctx.lineWidth = 1.7;
                ctx.stroke();
              }

              const swatchHex = isColour ? COLOUR_SWATCH_MAP[opt.toUpperCase()] : undefined;
              if (swatchHex) {
                const dotR = isA5 ? 5.5 : 7;
                const dotX = rx + dotR + 6;
                ctx.beginPath();
                ctx.arc(dotX, centerY, dotR, 0, Math.PI * 2);
                ctx.fillStyle = swatchHex;
                ctx.fill();
                ctx.strokeStyle = isSelected ? '#ffffff' : '#0f172a';
                ctx.lineWidth = 1.2;
                ctx.stroke();

                ctx.fillStyle = isSelected ? '#ffffff' : '#000000';
                ctx.font = `700 ${((isA5 ? 10.5 : 12.5) * fontScale).toFixed(1)}px ${FONT_FAMILY}`;
                ctx.textAlign = 'left';
                ctx.fillText(
                  truncateText(ctx, opt, pillW - (dotR * 2 + 16)),
                  dotX + dotR + 5,
                  centerY + 4.2
                );
              } else {
                ctx.fillStyle = isSelected ? '#ffffff' : '#000000';
                ctx.font = `700 ${((isA5 ? 11.5 : 13.5) * fontScale).toFixed(1)}px ${FONT_FAMILY}`;
                ctx.textAlign = 'center';
                ctx.fillText(opt, rx + pillW / 2, centerY + 4.5);
                ctx.textAlign = 'left';
              }
            });
          } else {
            const maxStepX = isA5 ? 44 : 56;
            const stepX = Math.min(
              maxStepX,
              opts.length > 1 ? Math.floor((availOptW - bubbleR * 2) / (opts.length - 1)) : maxStepX
            );

            opts.forEach((opt, oIdx) => {
              const cx = optStartX + bubbleR + oIdx * stepX;
              const isSelected = fillDemoAnswers && opt.toUpperCase() === (item.ans || '').toUpperCase();

              ctx.beginPath();
              ctx.arc(cx, centerY, bubbleR, 0, Math.PI * 2);
              if (isSelected) {
                ctx.fillStyle = '#0f172a';
                ctx.fill();
                ctx.fillStyle = '#ffffff';
              } else {
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.strokeStyle = '#0f172a';
                ctx.lineWidth = 1.7;
                ctx.stroke();
                ctx.fillStyle = '#000000';
              }
              ctx.font = `700 ${((isA5 ? 12 : 14.5) * fontScale).toFixed(1)}px ${FONT_FAMILY}`;
              ctx.textAlign = 'center';
              ctx.fillText(opt, cx, centerY + 5);
              ctx.textAlign = 'left';
            });
          }
        }
      });

      const qBlockH = Math.max(1, numRows) * rowStep;
      const minSceneH = useSideScene ? Math.round((isA5 ? 88 : 116) * (0.8 + 0.2 * d)) : 0;
      const partContentH = Math.max(qBlockH, minSceneH);

      if (!dryRun && useSideScene && sceneImg) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.roundRect(contentLeft, qStartY, sceneColW, partContentH - 4, 8);
        ctx.fill();
        ctx.stroke();
        drawImageContained(ctx, sceneImg, contentLeft + 5, qStartY + 5, sceneColW - 10, partContentH - 14);
      }

      y = qStartY + partContentH + Math.round((isA5 ? 7 : 10) * d);
    });

    return y - bodyTop;
  };

  // Solve for the largest vertical density (1.0 -> 0.42) that fits 100% full-width inside 1 page!
  let chosenDensity = 1.0;
  for (let d = 1.0; d >= 0.42; d -= 0.03) {
    const measuredH = renderBodyParts(d, true);
    chosenDensity = d;
    if (measuredH <= availBodyH) break;
  }

  renderBodyParts(chosenDensity, false);

  // Crisp Footer Note
  ctx.fillStyle = '#334155';
  ctx.font = `500 ${isA5 ? 10.5 : 12.5}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.fillText(
    truncateText(
      ctx,
      branding?.sheetFooterNote ||
        'Instructions: Draw clear lines to match; fill or circle the correct option; write words clearly on the lines.',
      innerW
    ),
    W / 2,
    H - margin - (isA5 ? 8 : 10)
  );
  ctx.textAlign = 'left';

  return canvas;
}

export async function downloadPrintablePdfSheet(
  profile: ExamProfile,
  paperSize: 'A4' | 'A5',
  branding?: SystemBranding | null
): Promise<void> {
  const [canvas, { jsPDF }] = await Promise.all([
    renderAnswerSheetToCanvas(profile, paperSize, false, branding),
    import('jspdf')
  ]);
  const imgData = canvas.toDataURL('image/jpeg', 0.96);
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: paperSize.toLowerCase() as 'a4' | 'a5'
  });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  pdf.addImage(imgData, 'JPEG', 0, 0, pageW, pageH);
  const safeName = profile.gradeName.replace(/[^a-zA-Z0-9_-]/g, '_');
  pdf.save(`AnswerSheet_${safeName}_${paperSize}.pdf`);
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildWorksheetXml(name: string, rows: Array<Record<string, unknown>>): string {
  const safeName = escapeXml(name.replace(/[\\/*?:[\]]/g, '').slice(0, 31) || 'Sheet');
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const headerCells = headers
    .map(h => `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`)
    .join('');

  const dataRows = rows
    .map(row => {
      const cells = headers
        .map(h => {
          const val = row[h];
          const isNum = typeof val === 'number' && Number.isFinite(val);
          return `<Cell><Data ss:Type="${isNum ? 'Number' : 'String'}">${escapeXml(val)}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');

  return `<Worksheet ss:Name="${safeName}"><Table>${headers.length ? `<Row>${headerCells}</Row>` : ''}${dataRows}</Table></Worksheet>`;
}

function downloadExcelWorkbookXml(sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }>, fileName: string): void {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 ${sheets.map(s => buildWorksheetXml(s.name, s.rows)).join('\n')}
</Workbook>`;

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportProfileExcel(
  profile: ExamProfile,
  results: StudentResult[],
  sessionCode: string
): void {
  const maxScore = profile.maxScore || 8;

  const detailRows = results.map((st, idx) => {
    const wrongList = (st.questions || [])
      .filter(q => !q.isCorrect)
      .map(q => `${q.questionNumber} (HS: "${q.studentAnswer}" -> Đúng: "${q.correctAnswer}")`)
      .join('; ');

    return {
      STT: idx + 1,
      Khối: profile.gradeName,
      'Bộ đề': profile.examTitle,
      'Họ và tên': st.studentName,
      Lớp: st.className,
      Trường: st.schoolName,
      Listening: st.listeningScore || '-',
      'Reading & Writing': st.rwScore || '-',
      [`Tổng điểm (Thang ${maxScore})`]: st.score,
      'Số câu đúng': `${st.correctCount}/${st.totalQuestions}`,
      'Số Khiên Cambridge': `${st.shields || computeCambridgeShields(st.correctCount, st.totalQuestions)}/5 Shields`,
      'Giáo viên chấm': st.gradedBy || 'Hệ thống',
      'Chi tiết các câu sai': wrongList || 'Đúng toàn bộ',
      'Nhận xét': st.teacherNote || ''
    };
  });

  const sum = results.reduce((acc, s) => acc + (Number(s.score) || 0), 0);
  const avgScore = results.length ? (sum / results.length).toFixed(1) : '0.0';
  const passCount = results.filter(s => (Number(s.score) || 0) >= maxScore * 0.5).length;
  const passRate = results.length ? Math.round((passCount / results.length) * 100) : 0;

  const wrongCounter: Record<string, number> = {};
  results.forEach(st => {
    (st.questions || []).forEach(q => {
      if (!q.isCorrect) wrongCounter[q.questionNumber] = (wrongCounter[q.questionNumber] || 0) + 1;
    });
  });

  const hardestQuestions = Object.entries(wrongCounter)
    .map(([qNum, count]) => ({
      questionNumber: qNum,
      wrongCount: count,
      wrongRate: Math.round((count / results.length) * 100)
    }))
    .sort((a, b) => b.wrongCount - a.wrongCount)
    .slice(0, 8);

  const statsRows = [
    { 'Chỉ số thống kê': 'Mã phòng thi', 'Giá trị': sessionCode },
    { 'Chỉ số thống kê': 'Khối / Bộ đề', 'Giá trị': `${profile.gradeName} - ${profile.examTitle}` },
    { 'Chỉ số thống kê': 'Tổng số bài đã chấm', 'Giá trị': results.length },
    { 'Chỉ số thống kê': 'Điểm trung bình', 'Giá trị': `${avgScore} / ${maxScore}` },
    { 'Chỉ số thống kê': 'Tỷ lệ đạt (>= 50%)', 'Giá trị': `${passRate}%` },
    { 'Chỉ số thống kê': '', 'Giá trị': '' },
    { 'Chỉ số thống kê': 'TOP CÂU HỎI SAI NHIỀU NHẤT', 'Giá trị': 'SỐ LƯỢT SAI (TỶ LỆ %)' },
    ...hardestQuestions.map(hq => ({
      'Chỉ số thống kê': hq.questionNumber,
      'Giá trị': `${hq.wrongCount} bài (${hq.wrongRate}%)`
    }))
  ];

  const safeFileName = `KetQua_${profile.gradeName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${sessionCode}.xls`;
  downloadExcelWorkbookXml(
    [
      { name: `BangDiem_${profile.gradeName}`, rows: detailRows },
      { name: 'ThongKeTyLeSai', rows: statsRows }
    ],
    safeFileName
  );
}

export function exportAllGradesExcel(
  profiles: ExamProfile[],
  allResults: StudentResult[],
  sessionCode: string
): void {
  const summaryRows = allResults.map((st, idx) => ({
    STT: idx + 1,
    Khối: st.gradeName,
    'Bộ đề': st.examTitle,
    'Họ và tên': st.studentName,
    Lớp: st.className,
    Trường: st.schoolName,
    Listening: st.listeningScore || '-',
    'Reading & Writing': st.rwScore || '-',
    'Tổng điểm': st.score,
    'Số câu đúng': `${st.correctCount}/${st.totalQuestions}`,
    'Số Khiên': `${st.shields || computeCambridgeShields(st.correctCount, st.totalQuestions)}/5`,
    'Giáo viên chấm': st.gradedBy || 'Hệ thống'
  }));

  const sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }> = [
    { name: 'TongHopToanTruong', rows: summaryRows }
  ];

  const usedNames = new Set(['TongHopToanTruong']);
  profiles.forEach((prof, idx) => {
    const profResults = allResults.filter(r => r.profileId === prof.id);
    if (profResults.length === 0) return;

    const rows = profResults.map((st, sIdx) => {
      const wrongList = (st.questions || [])
        .filter(q => !q.isCorrect)
        .map(q => `${q.questionNumber} (${q.studentAnswer}->${q.correctAnswer})`)
        .join('; ');
      return {
        STT: sIdx + 1,
        'Họ và tên': st.studentName,
        Lớp: st.className,
        Trường: st.schoolName,
        Listening: st.listeningScore || '-',
        'Reading & Writing': st.rwScore || '-',
        [`Điểm (Thang ${prof.maxScore || 8})`]: st.score,
        'Số câu đúng': `${st.correctCount}/${st.totalQuestions}`,
        'Số Khiên': `${st.shields || computeCambridgeShields(st.correctCount, st.totalQuestions)}/5`,
        'Giáo viên chấm': st.gradedBy || 'Hệ thống',
        'Chi tiết câu sai': wrongList || 'Đúng toàn bộ'
      };
    });

    let sheetName = prof.gradeName.replace(/[\\/*?:[\]]/g, '').slice(0, 28) || `Grade_${idx + 1}`;
    if (usedNames.has(sheetName)) sheetName = `${sheetName}_${idx + 1}`;
    usedNames.add(sheetName);
    sheets.push({ name: sheetName, rows });
  });

  downloadExcelWorkbookXml(sheets, `BangDiem_ToanTruong_${sessionCode}.xls`);
}

export function exportSchoolExcel(
  schoolName: string,
  results: StudentResult[],
  sessionCode: string
): void {
  const safeSchool = (schoolName || 'Truong').replace(/[^a-zA-Z0-9_-]/g, '_');

  const summaryRows = results.map((st, idx) => ({
    STT: idx + 1,
    'Họ và tên': st.studentName,
    Trường: st.schoolName || schoolName,
    Lớp: st.className,
    Khối: st.gradeName,
    'Bộ đề': st.examTitle,
    Listening: st.listeningScore || '-',
    'Reading & Writing': st.rwScore || '-',
    'Số câu đúng': `${st.correctCount}/${st.totalQuestions}`,
    'Số Khiên': `${st.shields || computeCambridgeShields(st.correctCount, st.totalQuestions)}/5`,
    Điểm: st.score,
    'Giáo viên chấm': st.gradedBy || 'Hệ thống'
  }));

  const sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }> = [
    { name: 'TongHopTruong', rows: summaryRows }
  ];

  // Separate sheet for every class within this school
  const byClass = new Map<string, StudentResult[]>();
  results.forEach(st => {
    const key = (st.className || st.gradeName || 'Khac').trim();
    const list = byClass.get(key) || [];
    list.push(st);
    byClass.set(key, list);
  });

  const usedNames = new Set(['TongHopTruong']);
  let cIdx = 0;
  for (const [cls, list] of byClass.entries()) {
    cIdx++;
    const rows = list.map((st, idx) => ({
      STT: idx + 1,
      'Họ và tên': st.studentName,
      Trường: st.schoolName || schoolName,
      Lớp: st.className,
      Khối: st.gradeName,
      'Số câu đúng': `${st.correctCount}/${st.totalQuestions}`,
      'Số Khiên': `${st.shields || computeCambridgeShields(st.correctCount, st.totalQuestions)}/5`,
      Điểm: st.score,
      'Chi tiết câu sai':
        (st.questions || [])
          .filter(q => !q.isCorrect)
          .map(q => `${q.questionNumber} (${q.studentAnswer}->${q.correctAnswer})`)
          .join('; ') || 'Đúng toàn bộ'
    }));
    let sheetName = `Lop_${cls}`.replace(/[\\/*?:[\]]/g, '').slice(0, 28) || `Lop_${cIdx}`;
    if (usedNames.has(sheetName)) sheetName = `${sheetName}_${cIdx}`;
    usedNames.add(sheetName);
    sheets.push({ name: sheetName, rows });
  }

  downloadExcelWorkbookXml(sheets, `BangDiem_${safeSchool}_${sessionCode}.xls`);
}

export function exportClassListExcel(
  schoolName: string,
  className: string,
  results: StudentResult[],
  sessionCode: string
): void {
  const rows = results.map((st, idx) => ({
    STT: idx + 1,
    'Họ và tên': st.studentName,
    Trường: st.schoolName || schoolName,
    Lớp: st.className || className,
    Khối: st.gradeName,
    'Bộ đề': st.examTitle,
    Listening: st.listeningScore || '-',
    'Reading & Writing': st.rwScore || '-',
    'Số câu đúng': `${st.correctCount}/${st.totalQuestions}`,
    'Số Khiên': `${st.shields || computeCambridgeShields(st.correctCount, st.totalQuestions)}/5`,
    Điểm: st.score,
    'Giáo viên chấm': st.gradedBy || 'Hệ thống'
  }));

  const safeSchool = (schoolName || 'Truong').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeClass = (className || 'Lop').replace(/[^a-zA-Z0-9_-]/g, '_');
  downloadExcelWorkbookXml(
    [{ name: `Lop_${className}`.slice(0, 28) || 'DanhSachLop', rows }],
    `DanhSach_${safeSchool}_${safeClass}_${sessionCode}.xls`
  );
}
