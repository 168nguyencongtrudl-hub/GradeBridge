import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Camera, Upload, FileText, CheckCircle2, XCircle, Award,
  Download, Printer, Search, Plus, FolderOpen, Trash2,
  Edit3, Eye, ChevronRight, Sparkles, RefreshCw, AlertCircle,
  Cloud, CloudOff, Copy, Building2, Smartphone, Layers, Check, X,
  Lock, Shield, Users, LogOut, KeyRound, UserPlus, FileSpreadsheet, Globe, ExternalLink,
  Sliders, Image as ImageIcon, Database, UploadCloud, DownloadCloud
} from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot
} from 'firebase/firestore';

// ============================================================================
// CẤU HÌNH FIREBASE CLOUD SYNC & GEMINI API
// ============================================================================
const appId = typeof __app_id !== 'undefined' ? __app_id : 'cambridge-ai-grader';
let firebaseApp = null;
let auth = null;
let db = null;

try {
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    const parsedConfig = typeof __firebase_config === 'string'
      ? JSON.parse(__firebase_config)
      : __firebase_config;
    firebaseApp = getApps().length ? getApp() : initializeApp(parsedConfig);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
  }
} catch (err) {
  console.warn('Firebase config unavailable, running in local state mode:', err);
}

// Bộ nhớ đệm IndexedDB dung lượng lớn (tự động giữ nguyên Tài khoản GV, Đề thi, Đáp án, Logo & Điểm qua các lần F5)
const IDB_NAME = 'CambridgeGraderPersistentDB';
const IDB_STORE = 'session_snapshots';

function openPersistentDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const req = window.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(IDB_STORE)) {
        database.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveSessionCache(sessionKey, dataObj) {
  try {
    const database = await openPersistentDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(dataObj, sessionKey);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return false;
  }
}

async function loadSessionCache(sessionKey) {
  try {
    const database = await openPersistentDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(sessionKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

const apiKey = '';

async function callGeminiWithRetry(payload, maxRetries = 4) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
  let delay = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      return JSON.parse(rawText);
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  return {};
}

// ============================================================================
// DỮ LIỆU KHỞI TẠO MẪU CHO CÁC KHỐI LỚP (100% TIẾNG ANH CHUẨN CAMBRIDGE TRONG PHIẾU)
// ============================================================================
const INITIAL_EXAM_PROFILES = [
  {
    id: 'profile-khoi-2-g2ft1',
    gradeName: 'Grade 2 (G2_FT1)',
    examTitle: 'Cambridge Pre-A1 Starters - Grade 2 Final Test 1 (9 Pages)',
    examLevel: 'Cambridge Pre-A1 Starters / Grade 2',
    pagesPerStudent: 9,
    maxScore: 8,
    sourceFileName: 'G2_FT1_AnswerKey.pdf',
    updatedAt: Date.now(),
    parts: [
      {
        id: 'g2-l1',
        title: 'Listening Part 1: Listen and draw lines',
        skill: 'Listening',
        type: 'draw_lines',
        note: 'Example: Tina → The girl in a pink T-shirt holding a green lizard',
        targets: [
          { code: 'A', label: 'The boy in a blue cap pointing at the bee' },
          { code: 'B', label: 'The girl crouching and pointing at the snake' },
          { code: 'C', label: 'The boy in a red T-shirt talking to the farmer' },
          { code: 'D', label: 'The boy in a green T-shirt sitting on hay and drinking juice' },
          { code: 'E', label: 'The farmer in a straw hat standing next to the fence' }
        ],
        items: [
          { q: 1, prompt: 'Adam', ans: 'A', targetDesc: 'The boy in a blue cap pointing at the bee' },
          { q: 2, prompt: 'Bella', ans: 'B', targetDesc: 'The girl crouching and pointing at the snake' },
          { q: 3, prompt: 'Liam', ans: 'C', targetDesc: 'The boy in a red T-shirt talking to the farmer' },
          { q: 4, prompt: 'Daniel', ans: 'D', targetDesc: 'The boy in a green T-shirt sitting on hay and drinking juice' }
        ]
      },
      {
        id: 'g2-l2',
        title: 'Listening Part 2: Listen and write a name or a number',
        skill: 'Listening',
        type: 'text_blank',
        items: [
          { q: 5, prompt: 'Street name', ans: 'Sun' },
          { q: 6, prompt: 'House number', ans: '6' },
          { q: 7, prompt: "Dog's name", ans: 'Max' },
          { q: 8, prompt: "Dog's age", ans: '3' }
        ]
      },
      {
        id: 'g2-l3',
        title: 'Listening Part 3: Listen and tick (✓) the box A, B or C',
        skill: 'Listening',
        type: 'mcq_abc',
        options: ['A', 'B', 'C'],
        items: [
          { q: 9, prompt: '', ans: 'A' },
          { q: 10, prompt: '', ans: 'B' },
          { q: 11, prompt: '', ans: 'A' },
          { q: 12, prompt: '', ans: 'A' }
        ]
      },
      {
        id: 'g2-l4',
        title: 'Listening Part 4: Listen and choose the colour',
        skill: 'Listening',
        type: 'listen_colour',
        options: ['RED', 'GREEN', 'BLUE', 'YELLOW'],
        items: [
          { q: 13, prompt: '', ans: 'RED' },
          { q: 14, prompt: '', ans: 'GREEN' },
          { q: 15, prompt: '', ans: 'BLUE' },
          { q: 16, prompt: '', ans: 'YELLOW' }
        ]
      },
      {
        id: 'g2-rw1',
        title: 'Reading & Writing Part 1: Put a tick (✓) or a cross (✗)',
        skill: 'Reading & Writing',
        type: 'tick_cross',
        options: ['✓', '✗'],
        items: [
          { q: 17, prompt: '', ans: '✓' },
          { q: 18, prompt: '', ans: '✗' },
          { q: 19, prompt: '', ans: '✓' },
          { q: 20, prompt: '', ans: '✗' }
        ]
      },
      {
        id: 'g2-rw2',
        title: 'Reading & Writing Part 2: Look and read. Write YES or NO',
        skill: 'Reading & Writing',
        type: 'yes_no',
        options: ['YES', 'NO'],
        items: [
          { q: 21, prompt: '', ans: 'NO' },
          { q: 22, prompt: '', ans: 'YES' },
          { q: 23, prompt: '', ans: 'NO' },
          { q: 24, prompt: '', ans: 'NO' }
        ]
      },
      {
        id: 'g2-rw3',
        title: 'Reading & Writing Part 3: Look at the letters. Write the words',
        skill: 'Reading & Writing',
        type: 'text_blank',
        items: [
          { q: 25, prompt: '', ans: 'bookshop' },
          { q: 26, prompt: '', ans: 'child' },
          { q: 27, prompt: '', ans: 'people' },
          { q: 28, prompt: '', ans: 'farmer' }
        ]
      },
      {
        id: 'g2-rw4',
        title: 'Reading & Writing Part 4: Read the text and write the missing words',
        skill: 'Reading & Writing',
        type: 'text_blank',
        items: [
          { q: 29, prompt: '', ans: 'spelling' },
          { q: 30, prompt: '', ans: 'answering' },
          { q: 31, prompt: '', ans: 'tick' },
          { q: 32, prompt: '', ans: 'cross' }
        ]
      }
    ],
    answerKeyText: `CAMBRIDGE GRADE 2 FINAL TEST 1 (G2_FT1 - 9 PAGES)\n[Listening Part 1 - Draw lines]: 1.Adam->A  2.Bella->B  3.Liam->C  4.Daniel->D\n[Listening Part 2 - Write name/number]: 5.Sun  6.6  7.Max  8.3\n[Listening Part 3 - Multiple choice]: 9.A  10.B  11.A  12.A\n[Listening Part 4 - Colours]: 13.RED  14.GREEN  15.BLUE  16.YELLOW\n[R&W Part 1 - Tick/Cross]: 17.✓  18.✗  19.✓  20.✗\n[R&W Part 2 - Yes/No]: 21.NO  22.YES  23.NO  24.NO\n[R&W Part 3 - Spelling]: 25.bookshop  26.child  27.people  28.farmer\n[R&W Part 4 - Gap fill]: 29.spelling  30.answering  31.tick  32.cross`
  },
  {
    id: 'profile-khoi-3-starters',
    gradeName: 'Grade 3 (Starters)',
    examTitle: 'Cambridge Pre-A1 Starters - Practice Test 01',
    examLevel: 'Cambridge Pre-A1 Starters',
    pagesPerStudent: 9,
    maxScore: 10,
    sourceFileName: 'Starters_Sample_Key.pdf',
    updatedAt: Date.now() - 3600000,
    parts: [
      {
        id: 'st-p1',
        title: 'Listening Part 1: Listen and tick (✓) A, B or C',
        skill: 'Listening',
        type: 'mcq_abc',
        options: ['A', 'B', 'C'],
        items: [
          { q: 1, prompt: '', ans: 'A' },
          { q: 2, prompt: '', ans: 'C' },
          { q: 3, prompt: '', ans: 'B' },
          { q: 4, prompt: '', ans: 'A' },
          { q: 5, prompt: '', ans: 'C' }
        ]
      },
      {
        id: 'st-p2',
        title: 'Listening Part 2: Listen and write a name or a number',
        skill: 'Listening',
        type: 'text_blank',
        items: [
          { q: 6, prompt: '', ans: 'Lucy' },
          { q: 7, prompt: '', ans: '8' },
          { q: 8, prompt: '', ans: 'Green' },
          { q: 9, prompt: '', ans: '12' },
          { q: 10, prompt: '', ans: 'Tiger' }
        ]
      },
      {
        id: 'st-p3',
        title: 'Reading & Writing Part 1: Write YES or NO',
        skill: 'Reading & Writing',
        type: 'yes_no',
        options: ['YES', 'NO'],
        items: [
          { q: 11, prompt: '', ans: 'YES' },
          { q: 12, prompt: '', ans: 'NO' },
          { q: 13, prompt: '', ans: 'YES' },
          { q: 14, prompt: '', ans: 'NO' },
          { q: 15, prompt: '', ans: 'YES' }
        ]
      },
      {
        id: 'st-p4',
        title: 'Reading & Writing Part 2: Write the missing words',
        skill: 'Reading & Writing',
        type: 'text_blank',
        items: [
          { q: 16, prompt: '', ans: 'elephant' },
          { q: 17, prompt: '', ans: 'guitar' },
          { q: 18, prompt: '', ans: 'kitchen' },
          { q: 19, prompt: '', ans: 'pineapple' },
          { q: 20, prompt: '', ans: 'beach' }
        ]
      }
    ],
    answerKeyText: `CAMBRIDGE PRE-A1 STARTERS - PRACTICE TEST 01\n[Listening Part 1]: 1.A 2.C 3.B 4.A 5.C\n[Listening Part 2]: 6.Lucy 7.8 8.Green 9.12 10.Tiger\n[R&W Part 1]: 11.YES 12.NO 13.YES 14.NO 15.YES\n[R&W Part 2]: 16.elephant 17.guitar 18.kitchen 19.pineapple 20.beach`
  }
];

const DEFAULT_SYSTEM_BRANDING = {
  appName: 'Cambridge AI Grader',
  appSubtitle: 'Hệ thống chấm thi Cambridge 1 Trang (9→1) & Hàng loạt PDF Đa Giáo Viên',
  loginTitle: 'Cambridge AI Grader',
  loginSubtitle: 'Hệ thống chấm thi bảo mật • Vui lòng đăng nhập để tiếp tục',
  logoDataUrl: '',
  logoWidth: 42,
  logoHeight: 42,
  logoRadius: 14,
  titleSizePx: 18,
  tabScanLabel: '1. Chấm Camera',
  tabKeyLabel: '2. Phiếu & Đáp Án',
  tabListLabel: '3. Bảng Điểm',
  sheetHeaderTitle: 'CAMBRIDGE ENGLISH ANSWER SHEET (1-PAGE SUMMARY)',
  sheetFooterNote: 'Instructions: Draw clear lines to match; fill or circle the correct option; write words clearly on the lines.',
  // Cấu hình tùy biến & kéo thả bố cục khung Chấm Camera (Scan Card)
  scanCardTitle: 'Chụp Phiếu Trả Lời 1 Trang (9→1)',
  scanCardSubtitle: 'AI tự động nhận diện nối tranh, chọn màu, tick/cross, trắc nghiệm & chữ viết tay',
  scanDemoBtnText: 'Chạy Thử Phiếu Mẫu',
  scanCameraBtnText: 'Chụp Ảnh Phiếu Bằng Camera',
  scanGalleryBtnText: 'Chọn Nhiều Ảnh Từ Thư Viện',
  scanTitleSizePx: 18,
  scanSubtitleSizePx: 12,
  scanBtnTextSizePx: 15,
  scanBtnHeightPx: 62,
  scanBtnRadiusPx: 16,
  scanCardPaddingPx: 24,
  scanCameraWidthPct: 50,
  scanTopOrder: ['header_info', 'demo_btn'],
  scanActionOrder: ['camera_btn', 'gallery_btn'],
  scanSectionOrder: ['top_row', 'action_row']
};

// ============================================================================
// CÁC HÀM TIỆN ÍCH CHẤM ĐIỂM, NÉN ẢNH & DỰNG PHIẾU IN
// ============================================================================
function safeText(val, fallback = '') {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return String(val);
  }
  if (Array.isArray(val)) {
    return val.map(v => safeText(v, '')).filter(Boolean).join(', ') || fallback;
  }
  if (typeof val === 'object') {
    if (val.$$typeof) return fallback;
    if (typeof val.text === 'string' || typeof val.text === 'number') return String(val.text);
    if (typeof val.label === 'string' || typeof val.label === 'number') return String(val.label);
    if (typeof val.name === 'string' || typeof val.name === 'number') return String(val.name);
    if (typeof val.value === 'string' || typeof val.value === 'number') return String(val.value);
    try {
      const seen = new WeakSet();
      return JSON.stringify(val, (k, v) => {
        if (v && typeof v === 'object') {
          if (v.$$typeof || seen.has(v)) return undefined;
          seen.add(v);
        }
        return v;
      }) || fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function computeCambridgeShields(correctCount, totalQuestions) {
  if (!totalQuestions || totalQuestions <= 0) return 1;
  const ratio = correctCount / totalQuestions;
  if (ratio >= 0.85) return 5;
  if (ratio >= 0.7) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.3) return 2;
  return 1;
}

function checkHybridAnswerMatch(studentRaw, correctRaw, partType) {
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

function compressImageFile(fileOrDataUrl, maxWidth = 1400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const processImg = (src) => {
      const img = new Image();
      img.onload = () => {
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({
          dataUrl,
          base64: dataUrl.split(',')[1]
        });
      };
      img.onerror = reject;
      img.src = src;
    };

    if (typeof fileOrDataUrl === 'string') {
      processImg(fileOrDataUrl);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => processImg(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(fileOrDataUrl);
    }
  });
}

// Dựng Canvas độ phân giải cao cho Phiếu Trả Lời 1 Trang (Hỗ trợ cả A4 và A5, tiếng Anh chuẩn Cambridge)
function renderAnswerSheetToCanvas(profile, paperSize = 'A4', fillDemoAnswers = false, branding = null) {
  const isA5 = paperSize === 'A5';
  const canvas = document.createElement('canvas');
  canvas.width = isA5 ? 1050 : 1240;
  canvas.height = isA5 ? 1485 : 1754;
  const ctx = canvas.getContext('2d');

  const W = canvas.width;
  const H = canvas.height;
  const margin = isA5 ? 48 : 56;
  const markerSize = isA5 ? 24 : 28;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // 4 dấu định vị góc đen (Corner Markers) cho Camera AI
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(24, 24, markerSize, markerSize);
  ctx.fillRect(W - 24 - markerSize, 24, markerSize, markerSize);
  ctx.fillRect(24, H - 24 - markerSize, markerSize, markerSize);
  ctx.fillRect(W - 24 - markerSize, H - 24 - markerSize, markerSize, markerSize);

  // Khung viền chính
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3;
  ctx.strokeRect(margin, margin, W - margin * 2, H - margin * 2);

  const parts = profile.parts || [];
  const totalQ = parts.reduce((sum, p) => sum + (p.items?.length || 0), 0);

  // Tiêu đề phiếu 100% tiếng Anh Cambridge (hoặc tùy chỉnh từ Admin)
  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'center';
  ctx.font = `bold ${isA5 ? 23 : 27}px sans-serif`;
  ctx.fillText(
    branding?.sheetHeaderTitle || 'CAMBRIDGE ENGLISH ANSWER SHEET (1-PAGE SUMMARY)',
    W / 2,
    margin + (isA5 ? 40 : 48)
  );

  ctx.font = `bold ${isA5 ? 15 : 18}px sans-serif`;
  ctx.fillStyle = '#334155';
  ctx.fillText(`${profile.gradeName} • ${profile.examTitle} • Total: ${totalQ} Questions`, W / 2, margin + (isA5 ? 66 : 78));

  // Khung thông tin thí sinh
  const infoTop = margin + (isA5 ? 86 : 102);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0f172a';
  ctx.font = `bold ${isA5 ? 16 : 19}px sans-serif`;

  const col1X = margin + 24;
  const col2X = W * 0.56;
  ctx.fillText(fillDemoAnswers ? 'Full Name: Tran Bao An' : 'Full Name: ........................................................', col1X, infoTop + 18);
  ctx.fillText(fillDemoAnswers ? `Class: ${profile.gradeName} - 2A1` : 'Class: ..............................', col2X, infoTop + 18);
  ctx.fillText(fillDemoAnswers ? 'School: Nguyen Binh Khiem Primary School' : 'School: ...........................................................', col1X, infoTop + (isA5 ? 46 : 54));
  ctx.fillText(fillDemoAnswers ? 'Candidate No.: 018' : 'Candidate No.: ...................', col2X, infoTop + (isA5 ? 46 : 54));

  const dividerY = infoTop + (isA5 ? 64 : 74);
  ctx.beginPath();
  ctx.moveTo(margin + 14, dividerY);
  ctx.lineTo(W - margin - 14, dividerY);
  ctx.lineWidth = 2.5;
  ctx.stroke();

  let cursorY = dividerY + (isA5 ? 24 : 30);
  const innerLeft = margin + 20;
  const innerW = W - (margin + 20) * 2;

  parts.forEach((part, pIdx) => {
    const headerH = isA5 ? 28 : 34;
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(innerLeft, cursorY - headerH + 8, innerW, headerH);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(innerLeft, cursorY - headerH + 8, innerW, headerH);

    ctx.fillStyle = '#0f172a';
    ctx.font = `bold ${isA5 ? 14 : 16.5}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(part.title, innerLeft + 12, cursorY - (isA5 ? 5 : 6));

    ctx.textAlign = 'right';
    ctx.font = `bold ${isA5 ? 12 : 14}px sans-serif`;
    ctx.fillStyle = '#475569';
    ctx.fillText(part.skill.toUpperCase(), innerLeft + innerW - 12, cursorY - (isA5 ? 5 : 6));
    ctx.textAlign = 'left';

    cursorY += isA5 ? 24 : 28;
    const items = part.items || [];

    if (part.type === 'draw_lines') {
      if (part.note) {
        ctx.fillStyle = '#475569';
        ctx.font = `italic ${isA5 ? 12.5 : 14.5}px sans-serif`;
        ctx.fillText(part.note, innerLeft + 12, cursorY);
        cursorY += isA5 ? 22 : 26;
      }

      const targets = part.targets && part.targets.length > 0
        ? part.targets
        : items.map((it, idx) => ({ code: String.fromCharCode(65 + idx), label: it.targetDesc || `Person ${String.fromCharCode(65 + idx)}` }));

      const rowH = isA5 ? 30 : 36;
      const startY = cursorY + 4;
      const leftDotX = innerLeft + (isA5 ? 175 : 210);
      const rightDotX = innerLeft + (isA5 ? 365 : 440);

      items.forEach((it, idx) => {
        const y = startY + idx * rowH;
        ctx.fillStyle = '#0f172a';
        ctx.font = `bold ${isA5 ? 14.5 : 17}px sans-serif`;
        ctx.fillText(`Q${it.q}. ${it.prompt || `Name ${it.q}`}`, innerLeft + 16, y + 5);

        ctx.beginPath();
        ctx.arc(leftDotX, y, 6, 0, Math.PI * 2);
        ctx.fill();
      });

      targets.forEach((tg, idx) => {
        const y = startY + idx * rowH;
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(rightDotX, y, 6, 0, Math.PI * 2);
        ctx.fill();

        // Vòng tròn mã chữ cái A/B/C/D/E
        ctx.beginPath();
        ctx.arc(rightDotX + 24, y, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(tg.code, rightDotX + 24, y + 4.5);
        ctx.textAlign = 'left';

        ctx.fillStyle = '#1e293b';
        ctx.font = `${isA5 ? 13 : 15}px sans-serif`;
        ctx.fillText(tg.label, rightDotX + 44, y + 5);
      });

      if (fillDemoAnswers) {
        items.forEach((it, idx) => {
          const tIdx = targets.findIndex(t => t.code === it.ans);
          if (tIdx >= 0) {
            ctx.strokeStyle = '#1d4ed8';
            ctx.lineWidth = 2.6;
            ctx.beginPath();
            ctx.moveTo(leftDotX, startY + idx * rowH);
            ctx.lineTo(rightDotX, startY + tIdx * rowH);
            ctx.stroke();
          }
        });
      }

      const maxRows = Math.max(items.length, targets.length);
      cursorY = startY + maxRows * rowH + (isA5 ? 6 : 10);
    } else if (part.type === 'text_blank') {
      const rowStep = isA5 ? 30 : 36;
      items.forEach((item, idx) => {
        const col = idx % 2;
        const x = col === 0 ? innerLeft + 16 : innerLeft + innerW * 0.51;
        ctx.fillStyle = '#0f172a';
        ctx.font = `bold ${isA5 ? 14 : 16.5}px sans-serif`;
        ctx.fillText(`Q${item.q}:`, x, cursorY);

        if (item.prompt) {
          ctx.fillStyle = '#475569';
          ctx.font = `${isA5 ? 12.5 : 14.5}px sans-serif`;
          ctx.fillText(`(${item.prompt})`, x + (isA5 ? 46 : 54), cursorY);
        }

        const lineStart = x + (item.prompt ? (isA5 ? 155 : 185) : (isA5 ? 52 : 62));
        const lineEnd = x + innerW * 0.45;
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(lineStart, cursorY + 4);
        ctx.lineTo(lineEnd, cursorY + 4);
        ctx.stroke();

        if (fillDemoAnswers) {
          const demoVal = idx === 2 && pIdx === 1 ? 'wrong' : item.ans;
          ctx.fillStyle = '#1d4ed8';
          ctx.font = `italic bold ${isA5 ? 16 : 19}px sans-serif`;
          ctx.fillText(demoVal, lineStart + 10, cursorY - 1);
        }

        if (col === 1 || idx === items.length - 1) {
          cursorY += rowStep;
        }
      });
    } else {
      // Các dạng tô ô có sẵn: mcq_abc, listen_colour (chọn màu có sẵn, không lộ vật thể), tick_cross, yes_no, matching_ag
      const opts = part.options && part.options.length > 0
        ? part.options
        : part.type === 'listen_colour' ? ['RED', 'GREEN', 'BLUE', 'YELLOW']
        : part.type === 'yes_no' ? ['YES', 'NO']
        : part.type === 'tick_cross' ? ['✓', '✗']
        : part.type === 'matching_ag' ? ['A', 'B', 'C', 'D', 'E', 'F', 'G']
        : ['A', 'B', 'C'];

      const isWide = opts.length > 4 || part.type === 'listen_colour';
      const rowStep = isA5 ? 32 : 38;

      items.forEach((item, idx) => {
        const col = isWide ? 0 : idx % 2;
        const x = col === 0 ? innerLeft + 16 : innerLeft + innerW * 0.51;
        ctx.fillStyle = '#0f172a';
        ctx.font = `bold ${isA5 ? 14 : 16.5}px sans-serif`;
        ctx.fillText(`Q${item.q}:`, x, cursorY);

        opts.forEach((opt, oIdx) => {
          const isPill = part.type === 'yes_no' || part.type === 'listen_colour';
          const pillW = part.type === 'listen_colour' ? (isA5 ? 74 : 88) : (isA5 ? 54 : 64);
          const pillH = isA5 ? 24 : 28;
          const stepX = isPill ? pillW + (isA5 ? 14 : 18) : (isA5 ? 46 : 56);
          const cx = x + (isA5 ? 68 : 80) + oIdx * stepX;
          const cy = cursorY - 5;

          const isSelected = fillDemoAnswers && (opt.toUpperCase() === (item.ans || '').toUpperCase());

          if (isPill) {
            const rx = cx - 10;
            const ry = cy - pillH / 2;
            ctx.beginPath();
            ctx.roundRect(rx, ry, pillW, pillH, 12);
            if (isSelected) {
              ctx.fillStyle = '#0f172a';
              ctx.fill();
              ctx.fillStyle = '#ffffff';
            } else {
              ctx.strokeStyle = '#0f172a';
              ctx.lineWidth = 1.8;
              ctx.stroke();
              ctx.fillStyle = '#0f172a';
            }
            ctx.font = `bold ${isA5 ? 11.5 : 13.5}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(opt, rx + pillW / 2, cy + 4.5);
            ctx.textAlign = 'left';
          } else {
            const r = isA5 ? 13 : 15.5;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            if (isSelected) {
              ctx.fillStyle = '#0f172a';
              ctx.fill();
              ctx.fillStyle = '#ffffff';
            } else {
              ctx.strokeStyle = '#0f172a';
              ctx.lineWidth = 1.8;
              ctx.stroke();
              ctx.fillStyle = '#0f172a';
            }
            ctx.font = `bold ${isA5 ? 12.5 : 14.5}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(opt, cx, cy + 5);
            ctx.textAlign = 'left';
          }
        });

        if (isWide || col === 1 || idx === items.length - 1) {
          cursorY += rowStep;
        }
      });
    }

    cursorY += isA5 ? 6 : 8;
  });

  // Chân trang hướng dẫn tiếng Anh (hoặc tùy chỉnh từ Admin)
  ctx.fillStyle = '#475569';
  ctx.font = `${isA5 ? 11.5 : 13.5}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(
    branding?.sheetFooterNote || 'Instructions: Draw clear lines to match; fill or circle the correct option; write words clearly on the lines.',
    W / 2,
    H - margin - 14
  );

  return canvas;
}

// ============================================================================
// COMPONENT CHÍNH: CAMBRIDGE AI GRADER (MULTI-TEACHER ONLINE CLOUD HUB)
// ============================================================================
export default function App() {
  const [libsReady, setLibsReady] = useState({ pdfjs: false, xlsx: false, jspdf: false });
  const [user, setUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState('connecting');

  // Quản lý Kho Đề & Đáp Án theo từng Khối Lớp
  const [examProfiles, setExamProfiles] = useState(INITIAL_EXAM_PROFILES);
  const [selectedProfileId, setSelectedProfileId] = useState(INITIAL_EXAM_PROFILES[0].id);

  // Ngôn ngữ giao diện ('vi' | 'en'): Mặc định 'en' cho Giáo viên, chỉ Admin mới có nút chuyển đổi
  const [uiLang, setUiLang] = useState('en');

  // Tích hợp Google Sheets Webhook (Lưu điểm miễn phí 100% vào Google Drive)
  const [googleSheetWebhookUrl, setGoogleSheetWebhookUrl] = useState('');
  const [isSheetModalOpen, setIsSheetModalOpen] = useState(false);
  const [sheetModalTab, setSheetModalTab] = useState('webhook'); // 'webhook' | 'deploy'
  const [isSyncingAllToSheet, setIsSyncingAllToSheet] = useState(false);

  // Cấu hình Giao diện & Logo Hệ thống (Admin CMS) + Sao lưu/Nạp dữ liệu
  const [systemBranding, setSystemBranding] = useState(DEFAULT_SYSTEM_BRANDING);
  const [brandingDraft, setBrandingDraft] = useState(DEFAULT_SYSTEM_BRANDING);
  const [isBrandingModalOpen, setIsBrandingModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isScanLayoutEditMode, setIsScanLayoutEditMode] = useState(false);
  const [draggedScanItem, setDraggedScanItem] = useState(null);

  // Định danh Giáo Viên & Mã Phòng Thi Chung (Multi-Teacher Cloud Room)
  const [teacherName, setTeacherName] = useState('Admin');
  const [examSessionCode, setExamSessionCode] = useState('CAMBRIDGE-2026');
  const [filterSchool, setFilterSchool] = useState('ALL');
  const [filterClass, setFilterClass] = useState('ALL');
  const [filterTeacher, setFilterTeacher] = useState('ALL');

  // Hệ thống Xác thực & Phân quyền (Admin / Giáo viên)
  const [currentUserAccount, setCurrentUserAccount] = useState(null);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [teacherAccounts, setTeacherAccounts] = useState([]);
  const [isUserMgmtOpen, setIsUserMgmtOpen] = useState(false);
  const [newAccUsername, setNewAccUsername] = useState('');
  const [newAccPassword, setNewAccPassword] = useState('');
  const [newAccFullName, setNewAccFullName] = useState('');
  const [newAccPerms, setNewAccPerms] = useState({
    canGrade: true,
    canViewExport: true,
    canPrintSheet: true,
    canManageExams: false,
    canDeleteResults: false
  });

  // Kho Dữ Liệu Bài Chấm Toàn Trường (Đồng bộ Real-time Cloud)
  const [allResults, setAllResults] = useState([]);

  // Chế độ làm việc & Tab điều hướng
  const [appMode, setAppMode] = useState('mobile_omr');
  const [omrSubTab, setOmrSubTab] = useState('scan');
  const [pdfBatchTab, setPdfBatchTab] = useState('upload');
  const [paperSize, setPaperSize] = useState('A4');

  // Trạng thái chấm Camera 1 Trang (9 -> 1)
  const [isScanningOmr, setIsScanningOmr] = useState(false);
  const [omrScanProgress, setOmrScanProgress] = useState({ current: 0, total: 0 });
  const [latestOmrResultId, setLatestOmrResultId] = useState(null);
  const [omrSearchQuery, setOmrSearchQuery] = useState('');
  const [isAnalyzingKey, setIsAnalyzingKey] = useState(false);

  // Trạng thái chấm PDF Hàng Loạt Cả Lớp
  const [pdfFileName, setPdfFileName] = useState('');
  const [pdfPageImages, setPdfPageImages] = useState([]);
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);
  const [isGradingBatch, setIsGradingBatch] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchSearchQuery, setBatchSearchQuery] = useState('');

  // Modal Tạo Đề Khối Mới / Quản Lý Kho Đề
  const [isBankModalOpen, setIsBankModalOpen] = useState(false);
  const [bankModalTab, setBankModalTab] = useState('create');
  const [newGradeName, setNewGradeName] = useState('');
  const [newExamTitle, setNewExamTitle] = useState('');
  const [newExamLevel, setNewExamLevel] = useState('Cambridge Pre-A1 Starters');
  const [newPagesPerStudent, setNewPagesPerStudent] = useState(9);
  const [newMaxScore, setNewMaxScore] = useState(10);
  const [newAnswerKeyText, setNewAnswerKeyText] = useState('');
  const [newSourceFileName, setNewSourceFileName] = useState('');
  const [newSourceImages, setNewSourceImages] = useState([]);
  const [isExtractingNewProfile, setIsExtractingNewProfile] = useState(false);

  // Modal Xem & Sửa Chi Tiết Bài Làm Học Sinh
  const [reviewStudentId, setReviewStudentId] = useState(null);
  const [reviewPageIdx, setReviewPageIdx] = useState(0);

  // Thông báo Toast
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'info') => {
    setToast({ message, type, id: Date.now() });
    setTimeout(() => {
      setToast(prev => (prev && prev.message === message ? null : prev));
    }, 4200);
  };

  // Refs nhập file
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const currentKeyUploadRef = useRef(null);
  const newProfileUploadRef = useRef(null);
  const batchPdfInputRef = useRef(null);
  const logoUploadInputRef = useRef(null);
  const restoreBackupInputRef = useRef(null);

  // ==========================================================================
  // TỰ ĐỘNG KHÔI PHỤC & ĐỒNG BỘ DỮ LIỆU BỀN VỮNG (INDEXEDDB + CLOUD FIRESTORE)
  // ==========================================================================
  const [cacheHydrated, setCacheHydrated] = useState(false);

  // 1. Khôi phục ngay lập tức dữ liệu đã lưu trên máy (Tài khoản GV, Đề thi, Đáp án, Giao diện, Điểm) khi mở app
  useEffect(() => {
    let active = true;
    const cleanSession = (examSessionCode || 'DEFAULT').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    loadSessionCache(`room_${cleanSession}`).then((cached) => {
      if (!active) return;
      if (cached && typeof cached === 'object') {
        if (Array.isArray(cached.examProfiles) && cached.examProfiles.length > 0) {
          setExamProfiles(cached.examProfiles);
          setSelectedProfileId(prev =>
            cached.examProfiles.some(p => p.id === prev) ? prev : cached.examProfiles[0].id
          );
        }
        if (Array.isArray(cached.teacherAccounts)) {
          setTeacherAccounts(cached.teacherAccounts);
        }
        if (Array.isArray(cached.allResults)) {
          setAllResults(cached.allResults);
        }
        if (cached.systemBranding && typeof cached.systemBranding === 'object') {
          setSystemBranding({ ...DEFAULT_SYSTEM_BRANDING, ...cached.systemBranding });
        }
        if (typeof cached.googleSheetWebhookUrl === 'string') {
          setGoogleSheetWebhookUrl(cached.googleSheetWebhookUrl);
        }
      }
      setCacheHydrated(true);
    });
    return () => {
      active = false;
    };
  }, [examSessionCode]);

  // 2. Tự động ghi nhớ mọi thay đổi vào IndexedDB mỗi khi Admin/GV thêm tài khoản, sửa đề hoặc chấm bài
  useEffect(() => {
    if (!cacheHydrated) return;
    const cleanSession = (examSessionCode || 'DEFAULT').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    const lightResults = allResults.map(({ pages, ...rest }) => ({
      ...rest,
      pages: (pages || []).slice(0, 1).map(p => ({
        pageNum: p.pageNum,
        dataUrl: p.dataUrl && p.dataUrl.length < 350000 ? p.dataUrl : ''
      }))
    }));
    saveSessionCache(`room_${cleanSession}`, {
      examProfiles,
      teacherAccounts,
      allResults: lightResults,
      systemBranding,
      googleSheetWebhookUrl,
      savedAt: Date.now()
    });
  }, [cacheHydrated, examSessionCode, examProfiles, teacherAccounts, allResults, systemBranding, googleSheetWebhookUrl]);

  // 3. Khởi tạo Firebase Auth & Đồng bộ Real-time Cloud Firestore
  useEffect(() => {
    if (!auth || !db) {
      setSyncStatus('offline');
      return;
    }

    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.warn('Auth fallback:', e);
        setSyncStatus('offline');
      }
    };
    initAuth();

    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) setSyncStatus('synced');
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!user || !db) return;

    const cleanSession = (examSessionCode || 'DEFAULT').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    const profilesCol = collection(db, 'artifacts', appId, 'public', 'data', `profiles_${cleanSession}`);
    const resultsCol = collection(db, 'artifacts', appId, 'public', 'data', `results_${cleanSession}`);
    const accountsCol = collection(db, 'artifacts', appId, 'public', 'data', `accounts_${cleanSession}`);
    const settingsDoc = doc(db, 'artifacts', appId, 'public', 'data', `settings_${cleanSession}`, 'google_sheets');
    const brandingDoc = doc(db, 'artifacts', appId, 'public', 'data', `settings_${cleanSession}`, 'system_branding');

    const unsubSettings = onSnapshot(
      settingsDoc,
      (snap) => {
        if (snap.exists() && snap.data()?.webhookUrl) {
          setGoogleSheetWebhookUrl(snap.data().webhookUrl);
        }
      },
      () => {}
    );

    const unsubBranding = onSnapshot(
      brandingDoc,
      (snap) => {
        if (snap.exists()) {
          setSystemBranding({ ...DEFAULT_SYSTEM_BRANDING, ...snap.data() });
        }
      },
      () => {}
    );

    const unsubProfiles = onSnapshot(
      profilesCol,
      (snap) => {
        if (!snap.empty) {
          const cloudProfs = snap.docs.map(d => d.data());
          setExamProfiles(cloudProfs);
          setSelectedProfileId(prev =>
            cloudProfs.some(p => p.id === prev) ? prev : cloudProfs[0].id
          );
        } else {
          INITIAL_EXAM_PROFILES.forEach(p => {
            setDoc(doc(db, 'artifacts', appId, 'public', 'data', `profiles_${cleanSession}`, p.id), p).catch(() => {});
          });
        }
        setSyncStatus('synced');
      },
      () => setSyncStatus('offline')
    );

    const unsubResults = onSnapshot(
      resultsCol,
      (snap) => {
        if (!snap.empty) {
          setAllResults(snap.docs.map(d => d.data()));
        }
        setSyncStatus('synced');
      },
      () => setSyncStatus('offline')
    );

    const unsubAccounts = onSnapshot(
      accountsCol,
      (snap) => {
        if (!snap.empty) {
          const cloudAccs = snap.docs.map(d => d.data());
          setTeacherAccounts(cloudAccs);
          setCurrentUserAccount(prev => {
            if (!prev || prev.role === 'admin') return prev;
            const updatedSelf = cloudAccs.find(a => a.id === prev.id);
            if (!updatedSelf || updatedSelf.active === false) return null;
            return updatedSelf;
          });
        }
      },
      () => {}
    );

    return () => {
      unsubSettings();
      unsubBranding();
      unsubProfiles();
      unsubResults();
      unsubAccounts();
    };
  }, [user, examSessionCode]);

  // Lưu & Ghi nhớ cấu hình Giao diện + Logo lên Cloud
  const persistSystemBranding = async (nextBranding) => {
    const cleanBranding = { ...DEFAULT_SYSTEM_BRANDING, ...nextBranding, updatedAt: Date.now() };
    setSystemBranding(cleanBranding);
    setBrandingDraft(cleanBranding);

    if (user && db) {
      try {
        setSyncStatus('saving');
        const cleanSession = (examSessionCode || 'DEFAULT').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', `settings_${cleanSession}`, 'system_branding'), cleanBranding);
        setSyncStatus('synced');
      } catch (e) {
        setSyncStatus('offline');
      }
    }
    showToast('Đã lưu & ghi nhớ cấu hình Giao diện / Logo cho toàn hệ thống!', 'success');
  };

  const handleLogoFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 420, 0.9);
      setBrandingDraft(prev => ({ ...prev, logoDataUrl: compressed.dataUrl }));
      showToast('Đã tải ảnh logo lên! Nhấn "Lưu & Ghi Nhớ" để áp dụng.', 'info');
    } catch (err) {
      showToast(`Lỗi tải ảnh logo: ${err.message}`, 'error');
    }
    e.target.value = '';
  };

  // Kéo thả hoán đổi vị trí các phần tử trong khung Chấm Camera (Chỉ Admin)
  const handleScanElementDrop = (groupKey, targetId) => {
    if (!draggedScanItem || draggedScanItem.group !== groupKey || draggedScanItem.id === targetId) {
      setDraggedScanItem(null);
      return;
    }
    const currentOrder = [...(systemBranding[groupKey] || DEFAULT_SYSTEM_BRANDING[groupKey])];
    const fromIdx = currentOrder.indexOf(draggedScanItem.id);
    const toIdx = currentOrder.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) {
      setDraggedScanItem(null);
      return;
    }
    currentOrder.splice(fromIdx, 1);
    currentOrder.splice(toIdx, 0, draggedScanItem.id);
    const updated = { ...systemBranding, [groupKey]: currentOrder };
    persistSystemBranding(updated);
    setDraggedScanItem(null);
  };

  // ==========================================================================
  // SAO LƯU & NẠP LẠI DỮ LIỆU TOÀN HỆ THỐNG (.JSON) — GIÁO VIÊN, ĐỀ THI, ĐIỂM, GIAO DIỆN
  // ==========================================================================
  const handleExportSystemBackup = () => {
    try {
      const backupPayload = {
        app: 'Cambridge AI Grader Backup',
        exportedAt: new Date().toISOString(),
        sessionCode: examSessionCode,
        systemBranding,
        googleSheetWebhookUrl,
        teacherAccounts,
        examProfiles,
        allResults: allResults.map(({ pages, ...rest }) => rest)
      };
      const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `SaoLuu_HeThong_${examSessionCode}_${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      showToast(
        `Đã xuất file sao lưu (${teacherAccounts.length} GV, ${examProfiles.length} bộ đề, ${allResults.length} bài điểm)!`,
        'success'
      );
    } catch (err) {
      showToast(`Lỗi xuất file sao lưu: ${err.message}`, 'error');
    }
  };

  const handleImportSystemBackup = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText);

      if (parsed.systemBranding) {
        await persistSystemBranding(parsed.systemBranding);
      }
      if (typeof parsed.googleSheetWebhookUrl === 'string' && parsed.googleSheetWebhookUrl) {
        await saveGoogleSheetWebhookUrl(parsed.googleSheetWebhookUrl);
      }
      if (Array.isArray(parsed.teacherAccounts) && parsed.teacherAccounts.length > 0) {
        const sanitizedAccounts = parsed.teacherAccounts.filter(
          acc => acc && typeof acc === 'object' && !acc.$$typeof
        );
        setTeacherAccounts(sanitizedAccounts);
        for (const acc of sanitizedAccounts) {
          await persistTeacherAccount(acc);
        }
      }
      if (Array.isArray(parsed.examProfiles) && parsed.examProfiles.length > 0) {
        const sanitizedProfiles = parsed.examProfiles.filter(
          prof => prof && typeof prof === 'object' && !prof.$$typeof
        );
        setExamProfiles(sanitizedProfiles);
        if (sanitizedProfiles[0]) setSelectedProfileId(sanitizedProfiles[0].id);
        for (const prof of sanitizedProfiles) {
          await persistProfile(prof);
        }
      }
      if (Array.isArray(parsed.allResults) && parsed.allResults.length > 0) {
        const sanitizedResults = parsed.allResults.filter(
          res => res && typeof res === 'object' && !res.$$typeof
        );
        setAllResults(sanitizedResults);
        for (const res of sanitizedResults) {
          await persistStudentResult(res, false);
        }
      }

      setIsBackupModalOpen(false);
      showToast(
        `Đã nạp & đồng bộ thành công: ${parsed.teacherAccounts?.length || 0} GV, ${parsed.examProfiles?.length || 0} đề thi, ${parsed.allResults?.length || 0} bài điểm!`,
        'success'
      );
    } catch (err) {
      showToast(`File sao lưu không hợp lệ: ${err.message}`, 'error');
    }
    e.target.value = '';
  };

  // Lưu cấu hình URL Google Sheets Webhook lên Cloud để mọi giáo viên tự động đẩy điểm về chung 1 file Sheet
  const saveGoogleSheetWebhookUrl = async (urlVal) => {
    const cleanUrl = (urlVal || '').trim();
    setGoogleSheetWebhookUrl(cleanUrl);
    if (user && db) {
      try {
        const cleanSession = (examSessionCode || 'DEFAULT').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', `settings_${cleanSession}`, 'google_sheets'), {
          webhookUrl: cleanUrl,
          updatedAt: Date.now()
        });
      } catch (e) {}
    }
    showToast(cleanUrl ? 'Đã lưu liên kết Google Sheets & đồng bộ cho toàn bộ giáo viên!' : 'Đã ngắt kết nối Google Sheets.', 'success');
  };

  // Gửi 1 bản ghi điểm học sinh sang Google Sheets qua Google Apps Script Web App
  const pushResultToGoogleSheet = async (record, webhookUrlOverride = null) => {
    const targetUrl = (webhookUrlOverride || googleSheetWebhookUrl || '').trim();
    if (!targetUrl) return false;

    const wrongList = (record.questions || [])
      .filter(q => !q.isCorrect)
      .map(q => `${q.questionNumber} (${q.studentAnswer}->${q.correctAnswer})`)
      .join('; ');

    const payload = {
      sessionCode: examSessionCode,
      timestamp: new Date(record.createdAt || Date.now()).toLocaleString('vi-VN'),
      gradeName: record.gradeName || '',
      examTitle: record.examTitle || '',
      studentName: record.studentName || '',
      className: record.className || '',
      schoolName: record.schoolName || '',
      listeningScore: record.listeningScore || '-',
      rwScore: record.rwScore || '-',
      score: record.score ?? 0,
      correctCount: `${record.correctCount}/${record.totalQuestions}`,
      shields: `${record.shields || computeCambridgeShields(record.correctCount, record.totalQuestions)}/5`,
      gradedBy: record.gradedBy || 'Hệ thống',
      wrongDetails: wrongList || 'Đúng toàn bộ'
    };

    try {
      await fetch(targetUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      return true;
    } catch (err) {
      console.warn('Google Sheet push failed:', err);
      return false;
    }
  };

  // Đồng bộ toàn bộ kết quả hiện có lên Google Sheets
  const handleSyncAllExistingToSheet = async () => {
    if (!googleSheetWebhookUrl.trim()) {
      showToast('Vui lòng dán đường dẫn Web App Google Apps Script trước!', 'warning');
      return;
    }
    if (allResults.length === 0) {
      showToast('Chưa có bài chấm nào trong kho để đồng bộ.', 'warning');
      return;
    }
    setIsSyncingAllToSheet(true);
    let sent = 0;
    for (const rec of allResults) {
      const ok = await pushResultToGoogleSheet(rec);
      if (ok) sent++;
    }
    setIsSyncingAllToSheet(false);
    showToast(`Đã gửi ${sent}/${allResults.length} bài chấm sang Google Sheets!`, 'success');
  };

  // Kiểm tra quyền hiện tại của tài khoản đang đăng nhập
  const hasPermission = (permKey) => {
    if (!currentUserAccount) return false;
    if (currentUserAccount.role === 'admin') return true;
    return Boolean(currentUserAccount.permissions?.[permKey]);
  };

  // Xử lý đăng nhập hệ thống (Không hiển thị gợi ý mật khẩu / từ khóa)
  const handleSystemLogin = (e) => {
    e.preventDefault();
    setLoginError('');
    const uname = loginUsername.trim().toLowerCase();
    const pwd = loginPassword.trim();

    if (!uname || !pwd) {
      setLoginError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
      return;
    }

    if ((uname === 'admin' || uname === 'administrator') && pwd === '0911') {
      const adminSession = {
        id: 'root-admin',
        username: 'admin',
        fullName: 'Administrator (Admin)',
        role: 'admin',
        permissions: {
          canGrade: true,
          canViewExport: true,
          canPrintSheet: true,
          canManageExams: true,
          canDeleteResults: true
        }
      };
      setCurrentUserAccount(adminSession);
      setTeacherName('Admin');
      setUiLang('vi');
      setLoginPassword('');
      showToast('Đăng nhập quyền Quản trị viên thành công.', 'success');
      return;
    }

    const matchedTeacher = teacherAccounts.find(
      acc => acc.username.trim().toLowerCase() === uname && acc.password === pwd
    );

    if (!matchedTeacher) {
      setLoginError('Invalid username or password.');
      return;
    }

    if (matchedTeacher.active === false) {
      setLoginError('This account has been locked by Administrator.');
      return;
    }

    setCurrentUserAccount(matchedTeacher);
    setTeacherName(matchedTeacher.fullName || matchedTeacher.username);
    setUiLang('en'); // Bắt buộc Tiếng Anh cho tất cả tài khoản giáo viên
    setLoginPassword('');

    // Tự động chuyển tới tab hợp lệ đầu tiên theo quyền được cấp
    if (!matchedTeacher.permissions?.canGrade) {
      if (matchedTeacher.permissions?.canViewExport) setOmrSubTab('list');
      else if (matchedTeacher.permissions?.canPrintSheet || matchedTeacher.permissions?.canManageExams) setOmrSubTab('key');
    }
    showToast(`Welcome, ${matchedTeacher.fullName || matchedTeacher.username}!`, 'success');
  };

  const handleSystemLogout = () => {
    setCurrentUserAccount(null);
    setLoginUsername('');
    setLoginPassword('');
    setLoginError('');
    setIsUserMgmtOpen(false);
    setUiLang('en');
  };

  // Quản lý tài khoản giáo viên (Admin tạo, sửa quyền, khóa/mở, xóa)
  const persistTeacherAccount = async (accObj) => {
    const updated = teacherAccounts.some(a => a.id === accObj.id)
      ? teacherAccounts.map(a => (a.id === accObj.id ? accObj : a))
      : [accObj, ...teacherAccounts];
    setTeacherAccounts(updated);

    if (user && db) {
      try {
        const cleanSession = (examSessionCode || 'DEFAULT').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', `accounts_${cleanSession}`, accObj.id), accObj);
      } catch (e) {}
    }
  };

  const handleCreateTeacherAccount = async (e) => {
    e.preventDefault();
    const u = newAccUsername.trim();
    const p = newAccPassword.trim();
    const f = newAccFullName.trim();
    if (!u || !p || !f) {
      showToast('Vui lòng nhập đầy đủ Họ tên, Tên đăng nhập và Mật khẩu!', 'warning');
      return;
    }
    if (u.toLowerCase() === 'admin' || teacherAccounts.some(a => a.username.toLowerCase() === u.toLowerCase())) {
      showToast('Tên đăng nhập này đã tồn tại!', 'error');
      return;
    }

    const created = {
      id: `teacher-${Date.now()}`,
      username: u,
      password: p,
      fullName: f,
      role: 'teacher',
      active: true,
      permissions: { ...newAccPerms },
      createdAt: Date.now()
    };

    await persistTeacherAccount(created);
    setNewAccUsername('');
    setNewAccPassword('');
    setNewAccFullName('');
    showToast(`Đã cấp tài khoản cho giáo viên "${f}"!`, 'success');
  };

  const toggleTeacherPermission = async (accId, permKey) => {
    const target = teacherAccounts.find(a => a.id === accId);
    if (!target) return;
    await persistTeacherAccount({
      ...target,
      permissions: {
        ...target.permissions,
        [permKey]: !target.permissions?.[permKey]
      }
    });
  };

  const toggleTeacherActive = async (accId) => {
    const target = teacherAccounts.find(a => a.id === accId);
    if (!target) return;
    await persistTeacherAccount({
      ...target,
      active: target.active === false
    });
  };

  const deleteTeacherAccount = async (accId) => {
    setTeacherAccounts(prev => prev.filter(a => a.id !== accId));
    if (user && db) {
      try {
        const cleanSession = (examSessionCode || 'DEFAULT').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', `accounts_${cleanSession}`, accId));
      } catch (e) {}
    }
    showToast('Đã xóa tài khoản giáo viên.', 'info');
  };

  // ==========================================================================
  // DỮ LIỆU TÍNH TOÁN THEO KHỐI ĐANG CHỌN (ĐẶT TRƯỚC TỪ ĐIỂN `t` ĐỂ TRÁNH LỖI TDZ)
  // ==========================================================================
  const currentProfile = useMemo(() => {
    return examProfiles.find(p => p.id === selectedProfileId) || examProfiles[0] || INITIAL_EXAM_PROFILES[0];
  }, [examProfiles, selectedProfileId]);

  const currentProfileResults = useMemo(() => {
    return allResults
      .filter(r => r.profileId === currentProfile.id)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [allResults, currentProfile.id]);

  const latestOmrResult = useMemo(() => {
    if (latestOmrResultId) {
      const found = currentProfileResults.find(r => r.id === latestOmrResultId);
      if (found) return found;
    }
    return currentProfileResults[0] || null;
  }, [currentProfileResults, latestOmrResultId]);

  const currentTotalQuestionsCount = useMemo(() => {
    return (currentProfile.parts || []).reduce((sum, p) => sum + (p.items?.length || 0), 0);
  }, [currentProfile]);

  const classStatistics = useMemo(() => {
    if (currentProfileResults.length === 0) {
      return { avgScore: '0.0', passRate: 0, hardestQuestions: [] };
    }
    const sum = currentProfileResults.reduce((acc, s) => acc + (Number(s.score) || 0), 0);
    const avgScore = (sum / currentProfileResults.length).toFixed(1);
    const passCount = currentProfileResults.filter(s => (Number(s.score) || 0) >= (currentProfile.maxScore || 10) * 0.5).length;
    const passRate = Math.round((passCount / currentProfileResults.length) * 100);

    const wrongCounter = {};
    currentProfileResults.forEach(st => {
      (st.questions || []).forEach(q => {
        if (!q.isCorrect) {
          wrongCounter[q.questionNumber] = (wrongCounter[q.questionNumber] || 0) + 1;
        }
      });
    });

    const hardestQuestions = Object.entries(wrongCounter)
      .map(([qNum, count]) => ({
        questionNumber: qNum,
        wrongCount: count,
        wrongRate: Math.round((count / currentProfileResults.length) * 100)
      }))
      .sort((a, b) => b.wrongCount - a.wrongCount)
      .slice(0, 6);

    return { avgScore, passRate, hardestQuestions };
  }, [currentProfileResults, currentProfile.maxScore]);

  // Từ điển giao diện song ngữ (Admin chuyển được VI/EN, Giáo viên luôn khóa ở EN)
  const isEn = currentUserAccount?.role !== 'admin' || uiLang === 'en';
  const t = useMemo(() => {
    const pagesCount = safeText(currentProfile?.pagesPerStudent, '9');
    return {
      mobileModeBtn: isEn ? 'Mobile 1-Page (9→1)' : 'Chấm ĐT 1 Trang (9→1)',
      pdfBatchModeBtn: isEn
        ? `Class PDF (${pagesCount} Pgs/Student)`
        : `PDF Cả Lớp (${pagesCount} Tr/Em)`,
      logoutBtn: isEn ? 'Logout' : 'Thoát',
      gradeLabel: isEn ? 'Grade / Exam:' : 'Khối / Bộ Đề:',
      examsCountLabel: isEn ? 'papers' : 'bài',
      createNewExamBtn: isEn ? 'New Grade Exam' : 'Tạo Đề Khối Mới',
      examBankBtn: isEn ? 'Exam Bank' : 'Kho Đề',
      graderLabel: isEn ? 'Examiner:' : 'GV chấm:',
      graderPlaceholder: isEn ? 'Enter name...' : 'Nhập tên GV...',
      roomCodeLabel: isEn ? 'Room Code:' : 'Mã phòng thi:',
      copyRoomTitle: isEn ? 'Copy room code' : 'Sao chép mã phòng',
      loggedInAs: isEn ? 'Signed in as:' : 'Đang đăng nhập:',
      tabScan: isEn && safeText(systemBranding.tabScanLabel) === DEFAULT_SYSTEM_BRANDING.tabScanLabel
        ? '1. Camera Scan'
        : safeText(systemBranding.tabScanLabel, '1. Chấm Camera'),
      tabKey: isEn && safeText(systemBranding.tabKeyLabel) === DEFAULT_SYSTEM_BRANDING.tabKeyLabel
        ? '2. Sheet & Key'
        : safeText(systemBranding.tabKeyLabel, '2. Phiếu & Đáp Án'),
      tabList: isEn && safeText(systemBranding.tabListLabel) === DEFAULT_SYSTEM_BRANDING.tabListLabel
        ? '3. Scoreboard'
        : safeText(systemBranding.tabListLabel, '3. Bảng Điểm'),
      questionsUnit: isEn ? 'Questions' : 'Câu',
      scaleUnit: isEn ? 'Scale' : 'Thang',
      ptsUnit: isEn ? 'pts' : 'đ',
      scanTitle: isEn && safeText(systemBranding.scanCardTitle) === DEFAULT_SYSTEM_BRANDING.scanCardTitle
        ? 'Scan 1-Page Answer Sheet (9→1)'
        : safeText(systemBranding.scanCardTitle, 'Chụp Phiếu Trả Lời 1 Trang (9→1)'),
      scanSubtitle: isEn && safeText(systemBranding.scanCardSubtitle) === DEFAULT_SYSTEM_BRANDING.scanCardSubtitle
        ? 'AI automatically detects line matching, colours, tick/cross, MCQ & handwriting'
        : safeText(systemBranding.scanCardSubtitle),
      demoBtn: isEn && safeText(systemBranding.scanDemoBtnText) === DEFAULT_SYSTEM_BRANDING.scanDemoBtnText
        ? 'Test Sample Sheet'
        : safeText(systemBranding.scanDemoBtnText, 'Chạy Thử Phiếu Mẫu'),
      cameraBtn: isEn && safeText(systemBranding.scanCameraBtnText) === DEFAULT_SYSTEM_BRANDING.scanCameraBtnText
        ? 'Capture Sheet with Camera'
        : safeText(systemBranding.scanCameraBtnText, 'Chụp Ảnh Phiếu Bằng Camera'),
      galleryBtn: isEn && safeText(systemBranding.scanGalleryBtnText) === DEFAULT_SYSTEM_BRANDING.scanGalleryBtnText
        ? 'Choose Photos from Gallery'
        : safeText(systemBranding.scanGalleryBtnText, 'Chọn Nhiều Ảnh Từ Thư Viện'),
      scanningText: isEn ? 'Grading' : 'Đang chấm',
      noGradePerm: isEn
        ? 'Your account does not have permission to grade papers.'
        : 'Tài khoản của bạn chưa được Admin cấp quyền chấm bài.',
      justGradedBadge: isEn ? 'Just Graded' : 'Vừa chấm xong',
      classWord: isEn ? 'Class' : 'Lớp',
      correctWord: isEn ? 'Correct' : 'Đúng',
      sheetHeaderHeading: isEn ? '1-Page Answer Sheet & Key' : 'Phiếu Thi 1 Trang & Đáp Án',
      sheetSubHeading: isEn
        ? '100% Cambridge English format • Total:'
        : '100% nội dung phiếu bằng tiếng Anh chuẩn Cambridge • Tổng:',
      paperA4: isEn ? 'A4 Size' : 'Khổ A4',
      paperA5: isEn ? 'A5 Size' : 'Khổ A5',
      downloadPdfBtn: isEn ? 'Download PDF' : 'Tải Phiếu PDF',
      printSheetBtn: isEn ? 'Print Sheet' : 'In Phiếu',
      uploadKeyTitle: isEn
        ? 'Upload Original 9-Page Exam / Answer Key PDF or Image'
        : 'Nạp File Đề / Đáp Án Gốc (9 Trang) Để AI Tự Cập Nhật',
      uploadKeyBtn: isEn ? 'Upload 9-Page PDF / Image' : 'Tải PDF / Ảnh Đề 9 Trang',
      analyzingBtn: isEn ? 'AI Analyzing...' : 'AI Đang Phân Tích...',
      reparseTextBtn: isEn ? 'AI Re-structure from Answer Text' : 'AI Cấu Trúc Lại Từ Văn Bản Đáp Án',
      scoreboardHeading: isEn ? 'Scoreboard' : 'Bảng Điểm',
      avgScoreLabel: isEn ? 'Avg Score:' : 'Điểm TB:',
      passRateLabel: isEn ? 'Pass Rate:' : 'Tỷ lệ đạt:',
      allSchoolsBtn: isEn ? 'All Schools' : 'Toàn Trường',
      searchStudentPlaceholder: isEn ? 'Search student name...' : 'Tìm tên HS...',
      allSchoolsFilter: isEn ? 'All Schools' : 'Tất cả Trường',
      allClassesFilter: isEn ? 'All Classes' : 'Tất cả Lớp',
      allExaminersFilter: isEn ? 'All Examiners' : 'Tất cả GV chấm',
      emptyResultsText: isEn
        ? 'No graded papers found for'
        : 'Chưa có bài chấm nào trong kho cho',
      correctShort: isEn ? 'correct' : 'đúng',
      batchTab1: isEn ? '1. Upload Class PDF & Settings' : '1. Tải PDF Cả Lớp & Cấu Hình',
      batchTab2: isEn ? '2. Graded Results' : '2. Bảng Điểm Đã Chấm',
      batchHeading: isEn ? 'Split Class PDF & Batch Grade' : 'Tách Trang PDF & Chấm Hàng Loạt',
      batchSub: isEn
        ? 'Automatically splits pages per student and extracts Name, Class & School'
        : 'Hệ thống tự động chia mỗi học sinh số trang cố định và trích xuất Tên, Lớp, Trường',
      pagesPerStudentLabel: isEn ? 'Pages / Student:' : 'Số trang / 1 HS:',
      chooseClassPdfBtn: isEn ? 'Select Scanned Class PDF' : 'Chọn File PDF Scan Cả Lớp',
      splittingPdfText: isEn ? 'Splitting PDF pages...' : 'Đang tách trang PDF...',
      startBatchBtn: isEn ? 'Start Auto-Grading' : 'Bắt Đầu Chấm Tự Động',
      studentsUnit: isEn ? 'Students' : 'Học Sinh',
      exportExcelBtn: isEn ? 'Export Excel (.xlsx)' : 'Xuất File Excel (.xlsx)',
      searchFullPlaceholder: isEn ? 'Search by name, class, school...' : 'Tìm học sinh theo tên, lớp, trường...',
      reviewSchool: isEn ? 'School' : 'Trường'
    };
  }, [isEn, currentProfile?.pagesPerStudent, systemBranding]);

  // ==========================================================================
  // HÀM LƯU TRỮ CLOUD & CẬP NHẬT HỒ SƠ ĐỀ
  // ==========================================================================
  const persistProfile = async (profileObj) => {
    const updated = examProfiles.some(p => p.id === profileObj.id)
      ? examProfiles.map(p => (p.id === profileObj.id ? profileObj : p))
      : [profileObj, ...examProfiles];
    setExamProfiles(updated);

    if (user && db) {
      try {
        setSyncStatus('saving');
        const cleanSession = (examSessionCode || 'DEFAULT').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', `profiles_${cleanSession}`, profileObj.id), profileObj);
        setSyncStatus('synced');
      } catch (e) {
        setSyncStatus('offline');
      }
    }
  };

  const persistStudentResult = async (resultObj, overwriteDuplicate = true) => {
    const normName = (resultObj.studentName || '').trim().toLowerCase();
    const normClass = (resultObj.className || '').trim().toLowerCase();
    const duplicate = overwriteDuplicate && normName && normName !== 'chưa rõ'
      ? allResults.find(
          r =>
            r.id !== resultObj.id &&
            r.profileId === resultObj.profileId &&
            (r.studentName || '').trim().toLowerCase() === normName &&
            (r.className || '').trim().toLowerCase() === normClass
        )
      : null;

    const finalRecord = duplicate
      ? { ...resultObj, id: duplicate.id, stt: duplicate.stt }
      : resultObj;

    const updated = allResults.some(r => r.id === finalRecord.id)
      ? allResults.map(r => (r.id === finalRecord.id ? finalRecord : r))
      : [finalRecord, ...allResults];
    setAllResults(updated);

    if (user && db) {
      try {
        setSyncStatus('saving');
        const cleanSession = (examSessionCode || 'DEFAULT').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
        const { pages, ...lightPayload } = finalRecord;
        const safePages = (pages || []).slice(0, 1).map(p => ({
          pageNum: p.pageNum,
          dataUrl: p.dataUrl && p.dataUrl.length < 450000 ? p.dataUrl : ''
        }));
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', `results_${cleanSession}`, finalRecord.id), {
          ...lightPayload,
          pages: safePages
        });
        setSyncStatus('synced');
      } catch (e) {
        setSyncStatus('offline');
      }
    }

    // Tự động đẩy dòng điểm sang Google Sheets nếu Admin đã cấu hình Webhook
    if (googleSheetWebhookUrl.trim()) {
      pushResultToGoogleSheet(finalRecord);
    }

    return { record: finalRecord, wasUpdated: Boolean(duplicate) };
  };

  const deleteStudentResult = async (resultId) => {
    setAllResults(prev => prev.filter(r => r.id !== resultId));
    if (user && db) {
      try {
        const cleanSession = (examSessionCode || 'DEFAULT').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', `results_${cleanSession}`, resultId));
      } catch (e) {}
    }
    showToast('Đã xóa bản ghi bài chấm khỏi kho lưu trữ.', 'info');
  };

  const deleteProfile = async (profileId) => {
    if (examProfiles.length <= 1) {
      showToast('Cần giữ lại ít nhất 1 bộ đề trong kho!', 'warning');
      return;
    }
    const remaining = examProfiles.filter(p => p.id !== profileId);
    setExamProfiles(remaining);
    if (selectedProfileId === profileId) {
      setSelectedProfileId(remaining[0].id);
    }
    if (user && db) {
      try {
        const cleanSession = (examSessionCode || 'DEFAULT').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', `profiles_${cleanSession}`, profileId));
      } catch (e) {}
    }
    showToast('Đã xóa bộ đề khỏi kho lưu trữ.', 'info');
  };

  const updateCurrentProfileField = (field, value) => {
    persistProfile({
      ...currentProfile,
      [field]: value,
      updatedAt: Date.now()
    });
  };

  const updateCurrentPartItemAnswer = (partIdx, itemIdx, newAns) => {
    const updatedParts = (currentProfile.parts || []).map((p, idx) => {
      if (idx !== partIdx) return p;
      return {
        ...p,
        items: p.items.map((it, i) => (i === itemIdx ? { ...it, ans: newAns } : it))
      };
    });
    persistProfile({
      ...currentProfile,
      parts: updatedParts,
      updatedAt: Date.now()
    });
  };

  // ==========================================================================
  // CHUYỂN FILE PDF / ẢNH SANG MẢNG BASE64 ĐỂ AI ĐỌC
  // ==========================================================================
  const convertFileToBase64Images = async (file, maxPages = 10) => {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      if (!window.pdfjsLib) {
        throw new Error('Thư viện đọc PDF đang tải, vui lòng thử lại sau 2 giây.');
      }
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const limit = Math.min(pdf.numPages, maxPages);
      const imgs = [];
      for (let pageNum = 1; pageNum <= limit; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        imgs.push(dataUrl.split(',')[1]);
      }
      return imgs;
    } else {
      const compressed = await compressImageFile(file, 1400, 0.86);
      return [compressed.base64];
    }
  };

  // ==========================================================================
  // AI PHÂN TÍCH ĐỀ 9 TRANG -> PHIẾU 1 TRANG (100% TIẾNG ANH CAMBRIDGE)
  // ==========================================================================
  const runAiDeconstruct9PagesToParts = async ({
    sourceImages = [],
    answerKeyText = '',
    fallbackLevel = 'Cambridge Pre-A1 Starters'
  }) => {
    const systemInstruction = `You are a Cambridge English Assessment specialist (Pre-A1 Starters, A1 Movers, A2 Flyers).
Your task is to analyze the provided exam / answer key pages and structure them into a **1-Page Summary Answer Sheet (9→1)** written **100% in natural Cambridge English** so young learners can understand and complete it on a single page:
1. Classify every Part strictly by its actual question format:
   - "draw_lines": Matching names to people in a picture (e.g., Listening Part 1: Adam, Bella, Liam, Daniel).
     * MANDATORY: Look closely at the answer key illustration, trace every line from each name to the person in the picture, and generate a "targets" array with codes ("A", "B", "C", "D", "E"...) and concise English descriptions of each person in the picture (e.g., "A": "The boy in a blue cap pointing at the bee"). For each item, set prompt = character's name (e.g., "Adam"), ans = target code ("A"), targetDesc = person's English description.
   - "listen_colour": Listening and colouring objects in a picture (e.g., Listening Part 4).
     * MANDATORY: Do NOT reveal the object names in prompts so the listening test stays secret! Set prompt = "" and extract all distinct colours in uppercase into "options" (e.g., ["RED", "GREEN", "BLUE", "YELLOW"]), with ans = uppercase colour name (e.g., "RED").
   - "tick_cross": Put a tick (✓) or a cross (✗) in the box (R&W Part 1). Normalize ans to "✓" or "✗".
   - "yes_no": Write YES or NO. Normalize ans to "YES" or "NO".
   - "mcq_abc": Multiple choice picture/option A, B, or C (or A, B, C, D).
   - "matching_ag": Matching dialogue letters (A - G).
   - "text_blank": Writing words, names, numbers, or unjumbling letters.
2. Skip Example questions (Example / 0), include only graded questions, and number q sequentially from 1 to N.
3. Set "skill" strictly to "Listening" or "Reading & Writing".
4. Write all Part titles, notes, prompts, and target descriptions in **100% English**.`;

    const parts = [
      {
        text: `Analyze this exam / answer key (${fallbackLevel}) and build the 1-Page Summary Answer Sheet structure in 100% English.\n${answerKeyText.trim() ? `Attached text:\n${answerKeyText}` : ''}`
      }
    ];

    sourceImages.forEach(b64 => {
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
    });

    const payload = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            suggestedGrade: { type: 'STRING' },
            suggestedTitle: { type: 'STRING' },
            formattedAnswerText: { type: 'STRING' },
            parts: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  title: { type: 'STRING' },
                  skill: { type: 'STRING' },
                  type: { type: 'STRING' },
                  note: { type: 'STRING' },
                  options: { type: 'ARRAY', items: { type: 'STRING' } },
                  targets: {
                    type: 'ARRAY',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        code: { type: 'STRING' },
                        label: { type: 'STRING' }
                      },
                      required: ['code', 'label']
                    }
                  },
                  items: {
                    type: 'ARRAY',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        q: { type: 'INTEGER' },
                        prompt: { type: 'STRING' },
                        ans: { type: 'STRING' },
                        targetDesc: { type: 'STRING' }
                      },
                      required: ['q', 'ans']
                    }
                  }
                },
                required: ['title', 'skill', 'type', 'items']
              }
            }
          },
          required: ['formattedAnswerText', 'parts']
        }
      }
    };

    const aiRes = await callGeminiWithRetry(payload);
    const validTypes = ['draw_lines', 'listen_colour', 'tick_cross', 'mcq_abc', 'text_blank', 'yes_no', 'matching_ag'];
    const normalizedParts = (aiRes.parts || []).map((p, idx) => {
      const validType = validTypes.includes(p.type) ? p.type : 'mcq_abc';
      const defaultOpts =
        validType === 'listen_colour' ? (p.options && p.options.length > 0 ? p.options.map(o => o.toUpperCase()) : ['RED', 'GREEN', 'BLUE', 'YELLOW']) :
        validType === 'yes_no' ? ['YES', 'NO'] :
        validType === 'tick_cross' ? ['✓', '✗'] :
        validType === 'matching_ag' ? ['A', 'B', 'C', 'D', 'E', 'F', 'G'] :
        validType === 'mcq_abc' ? (p.options && p.options.length > 0 ? p.options : ['A', 'B', 'C']) : [];

      return {
        id: `part-${Date.now()}-${idx}`,
        title: safeText(p.title, `Part ${idx + 1}`),
        skill: safeText(p.skill).toLowerCase().includes('listen') ? 'Listening' : 'Reading & Writing',
        type: validType,
        note: safeText(p.note, ''),
        options: defaultOpts.map(o => safeText(o)),
        targets: (p.targets || []).map((tg, tIdx) => ({
          code: safeText(tg?.code, String.fromCharCode(65 + tIdx)),
          label: safeText(tg?.label, '')
        })),
        items: (p.items || []).map((it, iIdx) => ({
          q: Number(it?.q) || iIdx + 1,
          prompt: validType === 'listen_colour' ? '' : safeText(it?.prompt, ''),
          ans: validType === 'listen_colour' ? safeText(it?.ans, '').trim().toUpperCase() : safeText(it?.ans, '').trim(),
          targetDesc: safeText(it?.targetDesc, '')
        }))
      };
    });

    return {
      suggestedGrade: safeText(aiRes.suggestedGrade, ''),
      suggestedTitle: safeText(aiRes.suggestedTitle, ''),
      formattedAnswerText: safeText(aiRes.formattedAnswerText, answerKeyText),
      parts: normalizedParts
    };
  };

  // Xử lý nạp file cho Bộ Đề Khối Mới trong Modal
  const handleNewProfileFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setNewSourceFileName(file.name);
      showToast(`Đang đọc file "${file.name}"...`, 'info');
      const imgs = await convertFileToBase64Images(file, 10);
      setNewSourceImages(imgs);
      showToast(`Đã nạp ${imgs.length} trang từ "${file.name}". Nhấn nút AI Bóc Tách Đề!`, 'success');
    } catch (err) {
      showToast(`Lỗi đọc file: ${err.message}`, 'error');
    }
    e.target.value = '';
  };

  const extractAnswersWithAIForNewProfile = async () => {
    if (newSourceImages.length === 0 && !newAnswerKeyText.trim()) {
      showToast('Vui lòng tải file PDF/Ảnh đề thi hoặc dán đáp án trước!', 'warning');
      return;
    }
    setIsExtractingNewProfile(true);
    try {
      const result = await runAiDeconstruct9PagesToParts({
        sourceImages: newSourceImages,
        answerKeyText: newAnswerKeyText,
        fallbackLevel: newExamLevel
      });
      if (!newGradeName.trim() && result.suggestedGrade) setNewGradeName(result.suggestedGrade);
      if (!newExamTitle.trim() && result.suggestedTitle) setNewExamTitle(result.suggestedTitle);
      setNewAnswerKeyText(result.formattedAnswerText);
      showToast(`AI đã bóc tách xong ${result.parts.length} Part chuẩn tiếng Anh Cambridge!`, 'success');
      return result.parts;
    } catch (err) {
      showToast(`Lỗi AI phân tích đề: ${err.message}`, 'error');
      return null;
    } finally {
      setIsExtractingNewProfile(false);
    }
  };

  const handleSaveNewProfile = async () => {
    if (!newGradeName.trim()) {
      showToast('Vui lòng nhập Tên Khối Lớp (VD: Grade 2, Grade 3...)', 'warning');
      return;
    }
    setIsExtractingNewProfile(true);
    try {
      let extractedParts = [];
      if (newSourceImages.length > 0 || newAnswerKeyText.trim()) {
        const res = await runAiDeconstruct9PagesToParts({
          sourceImages: newSourceImages,
          answerKeyText: newAnswerKeyText,
          fallbackLevel: newExamLevel
        });
        extractedParts = res.parts;
        if (res.formattedAnswerText) setNewAnswerKeyText(res.formattedAnswerText);
      }

      const newProfile = {
        id: `profile-${Date.now()}`,
        gradeName: newGradeName.trim(),
        examTitle: newExamTitle.trim() || `${newGradeName.trim()} - Cambridge Assessment`,
        examLevel: newExamLevel,
        pagesPerStudent: Number(newPagesPerStudent) || 9,
        maxScore: Number(newMaxScore) || 10,
        sourceFileName: newSourceFileName || 'Manual Entry',
        updatedAt: Date.now(),
        parts: extractedParts.length > 0 ? extractedParts : INITIAL_EXAM_PROFILES[1].parts,
        answerKeyText: newAnswerKeyText.trim() || 'Answer key'
      };

      await persistProfile(newProfile);
      setSelectedProfileId(newProfile.id);
      setIsBankModalOpen(false);
      setNewGradeName('');
      setNewExamTitle('');
      setNewAnswerKeyText('');
      setNewSourceFileName('');
      setNewSourceImages([]);
      showToast(`Đã tạo và lưu Cloud bộ đề "${newProfile.gradeName}"!`, 'success');
    } catch (err) {
      showToast(`Lỗi lưu bộ đề mới: ${err.message}`, 'error');
    } finally {
      setIsExtractingNewProfile(false);
    }
  };

  // Cập nhật đề cho Khối đang chọn
  const handleCurrentProfileSourceUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsAnalyzingKey(true);
    try {
      showToast(`AI đang phân tích "${file.name}" cho ${currentProfile.gradeName}...`, 'info');
      const imgs = await convertFileToBase64Images(file, 10);
      const res = await runAiDeconstruct9PagesToParts({
        sourceImages: imgs,
        answerKeyText: currentProfile.answerKeyText,
        fallbackLevel: currentProfile.examLevel
      });
      await persistProfile({
        ...currentProfile,
        sourceFileName: file.name,
        parts: res.parts.length > 0 ? res.parts : currentProfile.parts,
        answerKeyText: res.formattedAnswerText,
        updatedAt: Date.now()
      });
      showToast(`Đã cập nhật ${res.parts.length} Part chuẩn tiếng Anh cho ${currentProfile.gradeName}!`, 'success');
    } catch (err) {
      showToast(`Lỗi AI đọc file: ${err.message}`, 'error');
    } finally {
      setIsAnalyzingKey(false);
    }
    e.target.value = '';
  };

  const handleAnalyzeCurrentTextToParts = async () => {
    if (!currentProfile.answerKeyText?.trim()) {
      showToast('Vui lòng nhập hoặc dán đáp án vào khung trước!', 'warning');
      return;
    }
    setIsAnalyzingKey(true);
    try {
      const res = await runAiDeconstruct9PagesToParts({
        sourceImages: [],
        answerKeyText: currentProfile.answerKeyText,
        fallbackLevel: currentProfile.examLevel
      });
      await persistProfile({
        ...currentProfile,
        parts: res.parts.length > 0 ? res.parts : currentProfile.parts,
        answerKeyText: res.formattedAnswerText,
        updatedAt: Date.now()
      });
      showToast(`AI đã cấu trúc lại ${res.parts.length} Part cho ${currentProfile.gradeName}!`, 'success');
    } catch (err) {
      showToast(`Lỗi phân tích đáp án: ${err.message}`, 'error');
    } finally {
      setIsAnalyzingKey(false);
    }
  };

  // ==========================================================================
  // TẢI FILE PDF PHIẾU IN THI (A4 / A5) & IN TRỰC TIẾP
  // ==========================================================================
  const downloadPrintablePdfSheet = () => {
    try {
      const canvas = renderAnswerSheetToCanvas(currentProfile, paperSize, false, systemBranding);
      const imgData = canvas.toDataURL('image/jpeg', 0.96);

      if (window.jspdf?.jsPDF) {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: paperSize.toLowerCase()
        });
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        pdf.addImage(imgData, 'JPEG', 0, 0, pageW, pageH);
        const safeName = currentProfile.gradeName.replace(/[^a-zA-Z0-9_-]/g, '_');
        pdf.save(`AnswerSheet_${safeName}_${paperSize}.pdf`);
        showToast(`Đã tải xuống file PDF phiếu thi khổ ${paperSize}!`, 'success');
      } else {
        const link = document.createElement('a');
        link.href = imgData;
        link.download = `AnswerSheet_${currentProfile.gradeName}_${paperSize}.jpg`;
        link.click();
        showToast('Đang tải ảnh phiếu thi độ phân giải cao...', 'info');
      }
    } catch (err) {
      showToast(`Lỗi tạo file PDF: ${err.message}`, 'error');
    }
  };

  const printPrintableHybridSheet = () => {
    try {
      const canvas = renderAnswerSheetToCanvas(currentProfile, paperSize, false, systemBranding);
      const imgData = canvas.toDataURL('image/jpeg', 0.96);
      const printWin = window.open('', '_blank', 'width=900,height=1100');
      if (!printWin) {
        showToast('Trình duyệt đang chặn Pop-up. Hãy dùng nút "Tải Phiếu PDF" ngay bên cạnh!', 'warning');
        return;
      }
      printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Answer Sheet - ${currentProfile.gradeName} (${paperSize})</title>
          <style>
            @page { size: ${paperSize} portrait; margin: 0; }
            body { margin: 0; padding: 0; display: flex; justify-content: center; background: #fff; }
            img { width: 100%; height: auto; max-width: ${paperSize === 'A5' ? '148mm' : '210mm'}; display: block; }
          </style>
        </head>
        <body>
          <img src="${imgData}" onload="window.print();" />
        </body>
        </html>
      `);
      printWin.document.close();
    } catch (err) {
      showToast(`Lỗi mở trang in: ${err.message}`, 'error');
    }
  };

  // ==========================================================================
  // CHẤM 1 CHẠM BẰNG CAMERA ĐIỆN THOẠI (9 -> 1)
  // ==========================================================================
  const handleOmrFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await processOmrImages(files);
    e.target.value = '';
  };

  const handleRunDemoOmr = async () => {
    const demoCanvas = renderAnswerSheetToCanvas(currentProfile, paperSize, true, systemBranding);
    const demoDataUrl = demoCanvas.toDataURL('image/jpeg', 0.9);
    await processOmrImages([demoDataUrl]);
  };

  const processOmrImages = async (imageSources) => {
    if (!imageSources || imageSources.length === 0) return;
    setIsScanningOmr(true);
    setOmrScanProgress({ current: 0, total: imageSources.length });

    const partsConfig = currentProfile.parts || [];
    const flatItems = [];
    partsConfig.forEach(part => {
      (part.items || []).forEach(it => {
        flatItems.push({
          q: it.q,
          prompt: it.prompt || '',
          correctAns: it.ans,
          partTitle: part.title,
          skill: part.skill,
          partType: part.type
        });
      });
    });

    const totalQ = flatItems.length;
    const maxScore = currentProfile.maxScore || 8;

    const schemaDescription = partsConfig.map(p => {
      if (p.type === 'draw_lines') {
        const leftList = (p.items || []).map(i => `Q${i.q} (${i.prompt})`).join(', ');
        const rightList = (p.targets || []).map(t => `[${t.code}] ${t.label}`).join('; ');
        return `- ${p.title} [${p.skill}] (DRAW LINES 2-COLUMN MATCHING): Left column [${leftList}] connected by drawn lines to Right column [${rightList}]. Follow each drawn line and return the target letter A/B/C/D/E for each question.`;
      }
      const qNums = p.items.map(i => i.q).join(', ');
      const modeDesc =
        p.type === 'text_blank' ? 'Handwritten word or number on line' :
        p.type === 'listen_colour' ? `Filled/circled colour option from ${(p.options || ['RED', 'GREEN', 'BLUE', 'YELLOW']).join('/')}` :
        p.type === 'tick_cross' ? 'Filled/circled ✓ or ✗' :
        `Filled/circled option ${(p.options || []).join('/')}`;
      return `- ${p.title} [${p.skill}] (${modeDesc}): Questions ${qNums}`;
    }).join('\n');

    for (let i = 0; i < imageSources.length; i++) {
      setOmrScanProgress({ current: i + 1, total: imageSources.length });
      try {
        const compressed = await compressImageFile(imageSources[i], 1500, 0.88);

        const systemInstruction = `You are an AI Optical & Handwriting Grader for the Cambridge 1-Page Answer Sheet "${currentProfile.examTitle}" (${currentProfile.gradeName}).
The sheet has 4 black corner markers and contains these sections:
${schemaDescription}

Your tasks:
1. Extract student header info:
   - studentName: Full Name (or "Chưa rõ" if blank)
   - className: Class (or "${currentProfile.gradeName}" if blank)
   - schoolName: School (or "Chưa rõ" if blank)
2. Read the student's answer for ALL ${totalQ} questions:
   - For "draw_lines": Trace the drawn line from each left name to the right target dot and return the target code (A, B, C, D, E...). Return "" if unattempted.
   - For "mcq_abc", "listen_colour", "yes_no", "tick_cross", "matching_ag": Return the darkened/circled value (e.g., A, RED, YES, ✓). Return "" if blank.
   - For "text_blank": Transcribe the handwritten English word or number on the line. Return "" if blank.
3. Return the complete "answers" array containing ${totalQ} items.`;

        const payload = {
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [
            {
              role: 'user',
              parts: [
                { text: `Grade this 1-page Cambridge answer sheet (${totalQ} questions total).` },
                { inlineData: { mimeType: 'image/jpeg', data: compressed.base64 } }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                studentName: { type: 'STRING' },
                className: { type: 'STRING' },
                schoolName: { type: 'STRING' },
                answers: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      q: { type: 'INTEGER' },
                      studentAnswer: { type: 'STRING' }
                    },
                    required: ['q', 'studentAnswer']
                  }
                }
              },
              required: ['studentName', 'className', 'schoolName', 'answers']
            }
          }
        };

        const aiData = await callGeminiWithRetry(payload);
        const detectedMap = {};
        (aiData.answers || []).forEach(item => {
          detectedMap[item.q] = safeText(item.studentAnswer, '').trim();
        });

        const questions = flatItems.map(meta => {
          const rawStudent = detectedMap[meta.q] || '';
          const displayStudent =
            rawStudent === '' ? '[Bỏ trống]' :
            meta.partType === 'text_blank' ? rawStudent : rawStudent.toUpperCase();

          const isCorrect = checkHybridAnswerMatch(displayStudent, meta.correctAns, meta.partType);

          return {
            questionNumber: meta.prompt ? `Q${meta.q} (${meta.prompt})` : `Q${meta.q}`,
            qNum: meta.q,
            partTitle: safeText(meta.partTitle),
            skill: safeText(meta.skill),
            partType: meta.partType,
            studentAnswer: safeText(displayStudent),
            correctAnswer: safeText(meta.correctAns),
            isCorrect,
            note: ''
          };
        });

        const listeningQs = questions.filter(q => q.skill === 'Listening');
        const rwQs = questions.filter(q => q.skill !== 'Listening');
        const listeningCorrect = listeningQs.filter(q => q.isCorrect).length;
        const rwCorrect = rwQs.filter(q => q.isCorrect).length;
        const correctCount = questions.filter(q => q.isCorrect).length;
        const score = totalQ > 0 ? Number(((correctCount / totalQ) * maxScore).toFixed(2)) : 0;
        const shields = computeCambridgeShields(correctCount, totalQ);

        const newRecord = {
          id: `omr-${Date.now()}-${i}`,
          profileId: currentProfile.id,
          gradeName: safeText(currentProfile.gradeName),
          examTitle: safeText(currentProfile.examTitle),
          gradedBy: safeText(teacherName, 'Giáo viên').trim() || 'Giáo viên',
          createdAt: Date.now(),
          stt: currentProfileResults.length + i + 1,
          pageRange: '1-Page Sheet (9→1)',
          pages: [{ pageNum: 1, dataUrl: compressed.dataUrl }],
          studentName: safeText(aiData.studentName, `Student #${currentProfileResults.length + i + 1}`),
          className: safeText(aiData.className, currentProfile.gradeName),
          schoolName: safeText(aiData.schoolName, 'Chưa rõ'),
          listeningScore: `${listeningCorrect}/${listeningQs.length}`,
          rwScore: `${rwCorrect}/${rwQs.length}`,
          shields,
          sectionBreakdown: `Listening: ${listeningCorrect}/${listeningQs.length} | R&W: ${rwCorrect}/${rwQs.length} | ${shields} Shields`,
          teacherNote: `${shields}/5 Shields`,
          questions,
          correctCount,
          totalQuestions: totalQ,
          score,
          reviewed: true,
          status: 'completed'
        };

        const { record: savedRec, wasUpdated } = await persistStudentResult(newRecord, true);
        setLatestOmrResultId(savedRec.id);
        showToast(
          wasUpdated
            ? `[Updated] ${savedRec.studentName} (${savedRec.className}) — ${savedRec.score}/${maxScore}`
            : `[${currentProfile.gradeName}] Saved: ${savedRec.studentName} — ${savedRec.score}/${maxScore} (${shields} Shields)`,
          'success'
        );
      } catch (err) {
        showToast(`Lỗi chấm phiếu #${i + 1}: ${err.message}`, 'error');
      }
    }

    setIsScanningOmr(false);
  };

  // ==========================================================================
  // CHẤM FILE PDF SCAN CẢ LỚP (NHIỀU TRANG / HỌC SINH)
  // ==========================================================================
  const handleBatchPdfUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!window.pdfjsLib) {
      showToast('Thư viện đọc PDF đang tải, vui lòng thử lại sau 2 giây.', 'warning');
      return;
    }

    setIsRenderingPdf(true);
    setPdfFileName(file.name);
    setPdfPageImages([]);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages = [];

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.4 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        pages.push({
          pageNum,
          dataUrl,
          base64: dataUrl.split(',')[1]
        });
      }

      setPdfPageImages(pages);
      showToast(`Đã tách thành công ${pages.length} trang từ "${file.name}".`, 'success');
    } catch (err) {
      showToast(`Lỗi đọc file PDF: ${err.message}`, 'error');
    } finally {
      setIsRenderingPdf(false);
    }
    e.target.value = '';
  };

  const studentBatches = useMemo(() => {
    const pps = Math.max(1, Number(currentProfile.pagesPerStudent) || 9);
    const batches = [];
    for (let i = 0; i < pdfPageImages.length; i += pps) {
      const slice = pdfPageImages.slice(i, i + pps);
      batches.push({
        index: batches.length + 1,
        startPage: slice[0].pageNum,
        endPage: slice[slice.length - 1].pageNum,
        pages: slice
      });
    }
    return batches;
  }, [pdfPageImages, currentProfile.pagesPerStudent]);

  const startBatchGrading = async () => {
    if (studentBatches.length === 0) {
      showToast('Vui lòng tải file PDF bài làm của cả lớp trước!', 'warning');
      return;
    }

    setIsGradingBatch(true);
    setBatchProgress({ current: 0, total: studentBatches.length });
    const maxScore = currentProfile.maxScore || 8;

    for (let i = 0; i < studentBatches.length; i++) {
      const batch = studentBatches[i];
      setBatchProgress({ current: i + 1, total: studentBatches.length });

      try {
        const parts = [
          {
            text: `Grade this student's handwritten Cambridge exam (${batch.pages.length} pages) against the official answer key below.\n\nOFFICIAL ANSWER KEY:\n${currentProfile.answerKeyText}`
          }
        ];
        batch.pages.forEach(p => {
          parts.push({ inlineData: { mimeType: 'image/jpeg', data: p.base64 } });
        });

        const payload = {
          systemInstruction: {
            parts: [
              {
                text: `You are an expert Cambridge English examiner. Extract studentName, className, schoolName from page 1, compare every question with the Official Answer Key, and return structured grading JSON.`
              }
            ]
          },
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                studentName: { type: 'STRING' },
                className: { type: 'STRING' },
                schoolName: { type: 'STRING' },
                sectionBreakdown: { type: 'STRING' },
                teacherNote: { type: 'STRING' },
                questions: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      questionNumber: { type: 'STRING' },
                      studentAnswer: { type: 'STRING' },
                      correctAnswer: { type: 'STRING' },
                      isCorrect: { type: 'BOOLEAN' },
                      note: { type: 'STRING' }
                    },
                    required: ['questionNumber', 'studentAnswer', 'correctAnswer', 'isCorrect']
                  }
                }
              },
              required: ['studentName', 'className', 'schoolName', 'questions']
            }
          }
        };

        const aiData = await callGeminiWithRetry(payload);
        const questions = (aiData.questions || []).map((q, qIdx) => ({
          questionNumber: safeText(q.questionNumber, `Q${qIdx + 1}`),
          studentAnswer: safeText(q.studentAnswer, ''),
          correctAnswer: safeText(q.correctAnswer, ''),
          isCorrect: Boolean(q.isCorrect),
          note: safeText(q.note, '')
        }));
        const totalQ = questions.length || currentTotalQuestionsCount;
        const correctQ = questions.filter(q => q.isCorrect).length;
        const computedScore = totalQ > 0 ? Number(((correctQ / totalQ) * maxScore).toFixed(2)) : 0;
        const shields = computeCambridgeShields(correctQ, totalQ);

        const studentRecord = {
          id: `pdf-${currentProfile.id}-${batch.index}-${Date.now()}`,
          profileId: currentProfile.id,
          gradeName: safeText(currentProfile.gradeName),
          examTitle: safeText(currentProfile.examTitle),
          gradedBy: safeText(teacherName, 'Giáo viên').trim() || 'Giáo viên',
          createdAt: Date.now(),
          stt: batch.index,
          pageRange: `${batch.startPage}-${batch.endPage}`,
          pages: batch.pages.map(p => ({ pageNum: p.pageNum, dataUrl: p.dataUrl })),
          studentName: safeText(aiData.studentName, `Student #${batch.index}`),
          className: safeText(aiData.className, currentProfile.gradeName),
          schoolName: safeText(aiData.schoolName, 'Chưa rõ'),
          listeningScore: safeText(aiData.sectionBreakdown, '-'),
          rwScore: '-',
          shields,
          sectionBreakdown: safeText(aiData.sectionBreakdown, `${shields}/5 Shields`),
          teacherNote: safeText(aiData.teacherNote, ''),
          questions,
          correctCount: correctQ,
          totalQuestions: totalQ,
          score: computedScore,
          reviewed: false,
          status: 'completed'
        };

        await persistStudentResult(studentRecord, true);
      } catch (err) {
        showToast(`Lỗi chấm học sinh #${batch.index}: ${err.message}`, 'error');
      }
    }

    setIsGradingBatch(false);
    setPdfBatchTab('results');
    showToast(`Hoàn tất chấm ${studentBatches.length} bài cho ${currentProfile.gradeName}!`, 'success');
  };

  // ==========================================================================
  // CHỈNH SỬA TRỰC TIẾP ĐÁP ÁN HỌC SINH TRONG KẾT QUẢ / MODAL
  // ==========================================================================
  const updateStudentQuestionField = async (studentId, qIdx, newStudentAns, forceCorrect = null) => {
    const target = allResults.find(r => r.id === studentId);
    if (!target) return;

    const updatedQs = target.questions.map((q, idx) => {
      if (idx !== qIdx) return q;
      const updatedAns = newStudentAns !== null ? newStudentAns : q.studentAnswer;
      const isCorr = forceCorrect !== null
        ? forceCorrect
        : checkHybridAnswerMatch(updatedAns, q.correctAnswer, q.partType);
      return { ...q, studentAnswer: updatedAns, isCorrect: isCorr };
    });

    const listeningQs = updatedQs.filter(q => q.skill === 'Listening');
    const rwQs = updatedQs.filter(q => q.skill !== 'Listening');
    const listeningCorrect = listeningQs.filter(q => q.isCorrect).length;
    const rwCorrect = rwQs.filter(q => q.isCorrect).length;
    const correctCount = updatedQs.filter(q => q.isCorrect).length;
    const totalQ = updatedQs.length;
    const prof = examProfiles.find(p => p.id === target.profileId) || currentProfile;
    const maxScore = prof.maxScore || 8;
    const score = totalQ > 0 ? Number(((correctCount / totalQ) * maxScore).toFixed(2)) : 0;
    const shields = computeCambridgeShields(correctCount, totalQ);

    const updatedRecord = {
      ...target,
      questions: updatedQs,
      correctCount,
      score,
      shields,
      listeningScore: listeningQs.length > 0 ? `${listeningCorrect}/${listeningQs.length}` : target.listeningScore,
      rwScore: rwQs.length > 0 ? `${rwCorrect}/${rwQs.length}` : target.rwScore,
      sectionBreakdown: listeningQs.length > 0
        ? `Listening: ${listeningCorrect}/${listeningQs.length} | R&W: ${rwCorrect}/${rwQs.length} | ${shields} Shields`
        : `${shields}/5 Shields`,
      reviewed: true
    };

    await persistStudentResult(updatedRecord, false);
  };

  const updateStudentMetaField = async (studentId, field, value) => {
    const target = allResults.find(r => r.id === studentId);
    if (!target) return;
    await persistStudentResult({ ...target, [field]: value }, false);
  };

  const openReviewModal = (studentId) => {
    setReviewStudentId(studentId);
    setReviewPageIdx(0);
  };

  const reviewStudent = useMemo(() => {
    return allResults.find(r => r.id === reviewStudentId) || null;
  }, [allResults, reviewStudentId]);

  // ==========================================================================
  // XUẤT FILE EXCEL (.XLSX) RIÊNG TỪNG KHỐI & TỔNG HỢP TOÀN TRƯỜNG
  // ==========================================================================
  const exportCurrentProfileExcel = () => {
    if (!window.XLSX) {
      showToast('Thư viện xuất Excel đang tải, vui lòng thử lại sau 2 giây.', 'warning');
      return;
    }
    if (currentProfileResults.length === 0) {
      showToast('Chưa có dữ liệu điểm của khối này để xuất Excel.', 'warning');
      return;
    }

    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();
    const maxScore = currentProfile.maxScore || 8;

    const detailRows = currentProfileResults.map((st, idx) => {
      const wrongList = (st.questions || [])
        .filter(q => !q.isCorrect)
        .map(q => `${q.questionNumber} (HS: "${q.studentAnswer}" -> Đúng: "${q.correctAnswer}")`)
        .join('; ');

      return {
        'STT': idx + 1,
        'Khối': currentProfile.gradeName,
        'Bộ đề': currentProfile.examTitle,
        'Họ và tên': st.studentName,
        'Lớp': st.className,
        'Trường': st.schoolName,
        'Listening': st.listeningScore || '-',
        'Reading & Writing': st.rwScore || '-',
        [`Tổng điểm (Thang ${maxScore})`]: st.score,
        'Số câu đúng': `${st.correctCount}/${st.totalQuestions}`,
        'Số Khiên Cambridge': `${st.shields || computeCambridgeShields(st.correctCount, st.totalQuestions)}/5 Shields`,
        'Giáo viên chấm': st.gradedBy || 'Hệ thống',
        'Chi tiết các câu sai': wrongList || 'Đúng toàn bộ',
        'Nhận xét': st.teacherNote || ''
      };
    });

    const ws1 = XLSX.utils.json_to_sheet(detailRows);
    ws1['!cols'] = [
      { wch: 6 }, { wch: 15 }, { wch: 28 }, { wch: 24 }, { wch: 14 },
      { wch: 24 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 13 }, { wch: 16 }, { wch: 18 }, { wch: 48 }, { wch: 24 }
    ];
    XLSX.utils.book_append_sheet(wb, ws1, `Bảng Điểm ${currentProfile.gradeName}`.slice(0, 31));

    const statsRows = [
      { 'Chỉ số thống kê': 'Mã phòng thi', 'Giá trị': examSessionCode },
      { 'Chỉ số thống kê': 'Khối / Bộ đề', 'Giá trị': `${currentProfile.gradeName} - ${currentProfile.examTitle}` },
      { 'Chỉ số thống kê': 'Tổng số bài đã chấm', 'Giá trị': currentProfileResults.length },
      { 'Chỉ số thống kê': 'Điểm trung bình', 'Giá trị': `${classStatistics.avgScore} / ${maxScore}` },
      { 'Chỉ số thống kê': 'Tỷ lệ đạt (>= 50%)', 'Giá trị': `${classStatistics.passRate}%` },
      { 'Chỉ số thống kê': '', 'Giá trị': '' },
      { 'Chỉ số thống kê': 'TOP CÂU HỎI SAI NHIỀU NHẤT', 'Giá trị': 'SỐ LƯỢT SAI (TỶ LỆ %)' },
      ...classStatistics.hardestQuestions.map(hq => ({
        'Chỉ số thống kê': hq.questionNumber,
        'Giá trị': `${hq.wrongCount} bài (${hq.wrongRate}%)`
      }))
    ];
    const ws2 = XLSX.utils.json_to_sheet(statsRows);
    ws2['!cols'] = [{ wch: 36 }, { wch: 34 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Thống Kê Tỷ Lệ Sai');

    const safeFileName = `KetQua_${currentProfile.gradeName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${examSessionCode}.xlsx`;
    XLSX.writeFile(wb, safeFileName);
    showToast(`Đã xuất file Excel "${safeFileName}"!`, 'success');
  };

  const exportAllGradesExcel = () => {
    if (!window.XLSX || allResults.length === 0) return;
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();

    const summaryRows = allResults.map((st, idx) => ({
      'STT': idx + 1,
      'Khối': st.gradeName,
      'Bộ đề': st.examTitle,
      'Họ và tên': st.studentName,
      'Lớp': st.className,
      'Trường': st.schoolName,
      'Listening': st.listeningScore || '-',
      'Reading & Writing': st.rwScore || '-',
      'Tổng điểm': st.score,
      'Số câu đúng': `${st.correctCount}/${st.totalQuestions}`,
      'Số Khiên': `${st.shields || computeCambridgeShields(st.correctCount, st.totalQuestions)}/5`,
      'Giáo viên chấm': st.gradedBy || 'Hệ thống'
    }));

    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    wsSummary['!cols'] = [
      { wch: 6 }, { wch: 15 }, { wch: 28 }, { wch: 24 }, { wch: 14 },
      { wch: 24 }, { wch: 13 }, { wch: 16 }, { wch: 12 }, { wch: 13 }, { wch: 12 }, { wch: 18 }
    ];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Tổng Hợp Toàn Trường');

    const usedSheetNames = new Set(['Tổng Hợp Toàn Trường']);
    examProfiles.forEach((prof, idx) => {
      const profResults = allResults.filter(r => r.profileId === prof.id);
      if (profResults.length === 0) return;

      const rows = profResults.map((st, sIdx) => {
        const wrongList = (st.questions || [])
          .filter(q => !q.isCorrect)
          .map(q => `${q.questionNumber} (${q.studentAnswer}->${q.correctAnswer})`)
          .join('; ');
        return {
          'STT': sIdx + 1,
          'Họ và tên': st.studentName,
          'Lớp': st.className,
          'Trường': st.schoolName,
          'Listening': st.listeningScore || '-',
          'Reading & Writing': st.rwScore || '-',
          [`Điểm (Thang ${prof.maxScore || 8})`]: st.score,
          'Số câu đúng': `${st.correctCount}/${st.totalQuestions}`,
          'Số Khiên': `${st.shields || computeCambridgeShields(st.correctCount, st.totalQuestions)}/5`,
          'Giáo viên chấm': st.gradedBy || 'Hệ thống',
          'Chi tiết câu sai': wrongList || 'Đúng toàn bộ'
        };
      });

      let baseSheetName = `${prof.gradeName}`.replace(/[\\\/\?\*\[\]\:]/g, '').slice(0, 28);
      if (usedSheetNames.has(baseSheetName)) {
        baseSheetName = `${baseSheetName}_${idx + 1}`;
      }
      usedSheetNames.add(baseSheetName);

      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 14 }, { wch: 22 }, { wch: 13 }, { wch: 16 }, { wch: 16 }, { wch: 13 }, { wch: 12 }, { wch: 18 }, { wch: 48 }];
      XLSX.utils.book_append_sheet(wb, ws, baseSheetName);
    });

    XLSX.writeFile(wb, `BangDiem_ToanTruong_${examSessionCode}.xlsx`);
    showToast(`Đã xuất file Excel tổng hợp ${allResults.length} bài toàn trường!`, 'success');
  };

  // ==========================================================================
  // GIAO DIỆN NGƯỜI DÙNG (UI)
  // ==========================================================================
  if (!currentUserAccount) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
          <div className="bg-indigo-950 px-6 py-7 text-center text-white space-y-2.5">
            {typeof systemBranding.logoDataUrl === 'string' && systemBranding.logoDataUrl ? (
              <img
                src={systemBranding.logoDataUrl}
                alt="Logo"
                style={{
                  width: `${Math.min(180, Math.max(40, Number(systemBranding.logoWidth || 42) * 1.4))}px`,
                  height: `${Math.min(120, Math.max(40, Number(systemBranding.logoHeight || 42) * 1.4))}px`,
                  borderRadius: `${Number(systemBranding.logoRadius || 14)}px`
                }}
                className="mx-auto object-contain bg-white/10 p-1 shadow-lg"
              />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-indigo-600/90 border border-indigo-400/40 mx-auto flex items-center justify-center shadow-lg">
                <Lock className="w-7 h-7 text-amber-400" />
              </div>
            )}
            <h1 className="text-xl font-black tracking-tight">{safeText(systemBranding.loginTitle)}</h1>
            <p className="text-xs text-indigo-300">
              {safeText(systemBranding.loginSubtitle)}
            </p>
          </div>

          <form onSubmit={handleSystemLogin} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                Mã phòng thi
              </label>
              <input
                type="text"
                value={examSessionCode}
                onChange={(e) => setExamSessionCode(e.target.value.toUpperCase())}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-slate-50 font-mono text-sm font-bold text-indigo-900 uppercase focus:ring-2 focus:ring-indigo-500 outline-none"
                autoComplete="off"
              />
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                Tên đăng nhập
              </label>
              <input
                type="text"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                autoComplete="off"
              />
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                Mật khẩu
              </label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                autoComplete="new-password"
              />
            </div>

            {loginError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{safeText(loginError)}</span>
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-sm shadow-md flex items-center justify-center gap-2 transition-all"
            >
              <KeyRound className="w-4 h-4" />
              <span>Đăng Nhập Hệ Thống</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans pb-16">
      {/* TOAST NOTIFICATION */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 max-w-sm px-4 py-3 rounded-2xl shadow-xl border text-xs sm:text-sm font-bold flex items-center gap-2.5 transition-all ${
            toast.type === 'success'
              ? 'bg-emerald-900 text-white border-emerald-700'
              : toast.type === 'error'
                ? 'bg-rose-900 text-white border-rose-700'
                : toast.type === 'warning'
                  ? 'bg-amber-900 text-white border-amber-700'
                  : 'bg-slate-900 text-white border-slate-700'
          }`}
        >
          <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{safeText(toast.message)}</span>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: QUẢN LÝ TÀI KHOẢN GIÁO VIÊN & PHÂN QUYỀN (CHỈ ADMIN)         */}
      {/* ===================================================================== */}
      {isUserMgmtOpen && currentUserAccount.role === 'admin' && (
        <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-2xl border border-slate-200">
            <div className="px-5 py-4 bg-indigo-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="font-black text-sm sm:text-base">
                    Quản Lý Tài Khoản Giáo Viên & Phân Quyền ({teacherAccounts.length})
                  </h3>
                  <p className="text-[11px] text-indigo-300">
                    Phòng thi: <span className="font-mono font-bold text-amber-300">{examSessionCode}</span> • Tự động lưu Cloud & hỗ trợ xuất file sao lưu
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportSystemBackup}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold flex items-center gap-1"
                >
                  <DownloadCloud className="w-3.5 h-3.5" />
                  <span>Lưu File GV & Đề</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsUserMgmtOpen(false)}
                  className="p-1.5 rounded-xl hover:bg-indigo-800 text-indigo-200"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              <form onSubmit={handleCreateTeacherAccount} className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="text-xs font-black text-slate-800 uppercase flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4 text-indigo-600" />
                  <span>Tạo Tài Khoản Giáo Viên Mới</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                  <div>
                    <label className="block font-bold text-slate-600 mb-1">Họ và tên GV *</label>
                    <input
                      type="text"
                      value={newAccFullName}
                      onChange={(e) => setNewAccFullName(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-600 mb-1">Tên đăng nhập *</label>
                    <input
                      type="text"
                      value={newAccUsername}
                      onChange={(e) => setNewAccUsername(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-600 mb-1">Mật khẩu cấp *</label>
                    <input
                      type="text"
                      value={newAccPassword}
                      onChange={(e) => setNewAccPassword(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-mono font-bold"
                    />
                  </div>
                </div>

                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] font-bold text-slate-500">Tick chọn các quyền được phép sử dụng:</div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {[
                      { key: 'canGrade', label: 'Chấm bài (Camera & PDF)' },
                      { key: 'canViewExport', label: 'Xem & Xuất Excel' },
                      { key: 'canPrintSheet', label: 'Tải & In phiếu (A4/A5)' },
                      { key: 'canManageExams', label: 'Tạo / Sửa đề & Đáp án' },
                      { key: 'canDeleteResults', label: 'Xóa bài chấm' }
                    ].map(perm => (
                      <label
                        key={perm.key}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border cursor-pointer font-bold transition-all ${
                          newAccPerms[perm.key]
                            ? 'bg-indigo-50 border-indigo-400 text-indigo-900'
                            : 'bg-white border-slate-200 text-slate-500'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(newAccPerms[perm.key])}
                          onChange={(e) =>
                            setNewAccPerms(prev => ({ ...prev, [perm.key]: e.target.checked }))
                          }
                          className="accent-indigo-600"
                        />
                        <span>{perm.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow-xs"
                >
                  + Cấp Tài Khoản Giáo Viên
                </button>
              </form>

              <div className="space-y-2.5">
                <div className="text-xs font-black text-slate-800 uppercase">
                  Danh Sách Tài Khoản Giáo Viên Đã Cấp ({teacherAccounts.length})
                </div>

                {teacherAccounts.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    Chưa có tài khoản giáo viên nào được tạo trong phòng thi này.
                  </div>
                ) : (
                  teacherAccounts.map((acc, accIdx) => (
                    <div
                      key={acc.id || accIdx}
                      className={`p-3.5 rounded-2xl border space-y-2.5 ${
                        acc.active === false ? 'bg-slate-100 border-slate-300 opacity-75' : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-sm text-slate-900">{safeText(acc.fullName)}</span>
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[11px] font-bold">
                              User: {safeText(acc.username)} | Pass: {safeText(acc.password)}
                            </span>
                            {acc.active === false && (
                              <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-extrabold">
                                Đang khóa
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => toggleTeacherActive(acc.id)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                              acc.active === false
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {acc.active === false ? 'Mở khóa' : 'Tạm khóa'}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteTeacherAccount(acc.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                            title="Xóa tài khoản"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5 text-[11px]">
                        {[
                          { key: 'canGrade', label: 'Chấm bài' },
                          { key: 'canViewExport', label: 'Xem & Xuất Excel' },
                          { key: 'canPrintSheet', label: 'Tải & In phiếu' },
                          { key: 'canManageExams', label: 'Sửa đề & Đáp án' },
                          { key: 'canDeleteResults', label: 'Xóa bài' }
                        ].map(perm => (
                          <label
                            key={perm.key}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border cursor-pointer font-bold ${
                              acc.permissions?.[perm.key]
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                : 'bg-slate-50 border-slate-200 text-slate-400'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(acc.permissions?.[perm.key])}
                              onChange={() => toggleTeacherPermission(acc.id, perm.key)}
                              className="accent-emerald-600"
                            />
                            <span>{perm.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 5: CHỈNH SỬA GIAO DIỆN, LOGO & NỘI DUNG TỰ DO (CHỈ ADMIN)       */}
      {/* ===================================================================== */}
      {isBrandingModalOpen && currentUserAccount.role === 'admin' && (
        <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-2xl border border-slate-200">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Sliders className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="font-black text-sm sm:text-base">
                    Tùy Chỉnh Giao Diện, Logo & Nội Dung Hệ Thống (Admin CMS)
                  </h3>
                  <p className="text-[11px] text-slate-300">
                    Chỉnh kích thước Logo (To / Nhỏ / Dài / Ngắn) và sửa toàn bộ chữ hiển thị • Tự động ghi nhớ
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBrandingModalOpen(false)}
                className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 flex-1 text-xs">
              {/* Khung xem trước trực tiếp Header & Logo */}
              <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-2 border border-slate-700">
                <div className="text-[10px] uppercase tracking-wider font-extrabold text-amber-400">
                  Xem trước trực tiếp thanh tiêu đề & Logo:
                </div>
                <div className="flex items-center gap-3">
                  {brandingDraft.logoDataUrl ? (
                    <img
                      src={brandingDraft.logoDataUrl}
                      alt="Logo Preview"
                      style={{
                        width: `${brandingDraft.logoWidth}px`,
                        height: `${brandingDraft.logoHeight}px`,
                        borderRadius: `${brandingDraft.logoRadius}px`
                      }}
                      className="object-contain bg-white/10 shrink-0"
                    />
                  ) : (
                    <div
                      style={{
                        width: `${brandingDraft.logoWidth}px`,
                        height: `${brandingDraft.logoHeight}px`,
                        borderRadius: `${brandingDraft.logoRadius}px`
                      }}
                      className="bg-indigo-600 flex items-center justify-center shrink-0"
                    >
                      <Award className="w-6 h-6 text-amber-400" />
                    </div>
                  )}
                  <div>
                    <div
                      style={{ fontSize: `${brandingDraft.titleSizePx}px` }}
                      className="font-black leading-tight"
                    >
                      {brandingDraft.appName || 'Tên hệ thống'}
                    </div>
                    <div className="text-[11px] text-slate-300 mt-0.5">
                      {brandingDraft.appSubtitle}
                    </div>
                  </div>
                </div>
              </div>

              {/* Khu vực tải ảnh Logo & Kéo chỉnh To / Nhỏ / Dài / Ngắn */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-black text-slate-900 uppercase flex items-center gap-1.5">
                    <ImageIcon className="w-4 h-4 text-indigo-600" />
                    <span>Logo Trường / Trung Tâm & Kích Thước</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={logoUploadInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoFileUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => logoUploadInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold flex items-center gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Tải Ảnh Logo</span>
                    </button>
                    {brandingDraft.logoDataUrl && (
                      <button
                        type="button"
                        onClick={() => setBrandingDraft(prev => ({ ...prev, logoDataUrl: '' }))}
                        className="px-2.5 py-1.5 rounded-xl bg-rose-100 text-rose-700 font-bold"
                      >
                        Xóa Logo
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <div className="flex justify-between font-bold text-slate-700 mb-1">
                      <span>Chiều ngang / Dài Logo (Width):</span>
                      <span className="text-indigo-700">{brandingDraft.logoWidth} px</span>
                    </div>
                    <input
                      type="range"
                      min="28"
                      max="220"
                      value={brandingDraft.logoWidth}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, logoWidth: Number(e.target.value) }))}
                      className="w-full accent-indigo-600"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between font-bold text-slate-700 mb-1">
                      <span>Chiều cao / To Logo (Height):</span>
                      <span className="text-indigo-700">{brandingDraft.logoHeight} px</span>
                    </div>
                    <input
                      type="range"
                      min="28"
                      max="120"
                      value={brandingDraft.logoHeight}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, logoHeight: Number(e.target.value) }))}
                      className="w-full accent-indigo-600"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between font-bold text-slate-700 mb-1">
                      <span>Bo góc khung Logo (Radius):</span>
                      <span className="text-indigo-700">{brandingDraft.logoRadius} px</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="60"
                      value={brandingDraft.logoRadius}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, logoRadius: Number(e.target.value) }))}
                      className="w-full accent-indigo-600"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between font-bold text-slate-700 mb-1">
                      <span>Cỡ chữ Tiêu đề chính:</span>
                      <span className="text-indigo-700">{brandingDraft.titleSizePx} px</span>
                    </div>
                    <input
                      type="range"
                      min="14"
                      max="28"
                      value={brandingDraft.titleSizePx}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, titleSizePx: Number(e.target.value) }))}
                      className="w-full accent-indigo-600"
                    />
                  </div>
                </div>
              </div>

              {/* Chỉnh sửa chữ tự do ở tất cả các phần */}
              <div className="space-y-3">
                <div className="font-black text-slate-900 uppercase">
                  Chỉnh Sửa Chữ & Nhãn Hiển Thị Trên Toàn Ứng Dụng:
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-600 mb-1">Tên hệ thống (Header)</label>
                    <input
                      type="text"
                      value={brandingDraft.appName}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, appName: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-600 mb-1">Dòng mô tả dưới tên hệ thống</label>
                    <input
                      type="text"
                      value={brandingDraft.appSubtitle}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, appSubtitle: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-600 mb-1">Tiêu đề màn hình Đăng nhập</label>
                    <input
                      type="text"
                      value={brandingDraft.loginTitle}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, loginTitle: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-600 mb-1">Mô tả màn hình Đăng nhập</label>
                    <input
                      type="text"
                      value={brandingDraft.loginSubtitle}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, loginSubtitle: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block font-bold text-slate-600 mb-1">Nhãn Tab 1</label>
                    <input
                      type="text"
                      value={brandingDraft.tabScanLabel}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, tabScanLabel: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-600 mb-1">Nhãn Tab 2</label>
                    <input
                      type="text"
                      value={brandingDraft.tabKeyLabel}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, tabKeyLabel: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-600 mb-1">Nhãn Tab 3</label>
                    <input
                      type="text"
                      value={brandingDraft.tabListLabel}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, tabListLabel: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2.5 pt-1">
                  <div>
                    <label className="block font-bold text-slate-600 mb-1">Tiêu đề chính in trên Phiếu Thi PDF (A4/A5)</label>
                    <input
                      type="text"
                      value={brandingDraft.sheetHeaderTitle}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, sheetHeaderTitle: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-600 mb-1">Dòng hướng dẫn chân trang Phiếu Thi PDF</label>
                    <input
                      type="text"
                      value={brandingDraft.sheetFooterNote}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, sheetFooterNote: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                </div>
              </div>

              {/* Chỉnh sửa chữ & kích thước To/Nhỏ cho Khung Chấm Camera */}
              <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200 space-y-3">
                <div className="font-black text-indigo-950 uppercase">
                  Tùy Chỉnh Khung Chấm Camera (Chữ, Kích Thước Nút & Tiêu Đề):
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Tiêu đề khung chụp</label>
                    <input
                      type="text"
                      value={brandingDraft.scanCardTitle}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, scanCardTitle: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Dòng hướng dẫn nhỏ dưới tiêu đề</label>
                    <input
                      type="text"
                      value={brandingDraft.scanCardSubtitle}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, scanCardSubtitle: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Chữ nút Chạy Thử Mẫu</label>
                    <input
                      type="text"
                      value={brandingDraft.scanDemoBtnText}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, scanDemoBtnText: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Chữ nút Chụp Camera</label>
                    <input
                      type="text"
                      value={brandingDraft.scanCameraBtnText}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, scanCameraBtnText: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-bold text-slate-700 mb-1">Chữ nút Chọn Ảnh Từ Thư Viện</label>
                    <input
                      type="text"
                      value={brandingDraft.scanGalleryBtnText}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, scanGalleryBtnText: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <div className="flex justify-between font-bold text-slate-700 mb-1">
                      <span>Cỡ chữ Tiêu đề khung chụp:</span>
                      <span className="text-indigo-700">{brandingDraft.scanTitleSizePx} px</span>
                    </div>
                    <input
                      type="range"
                      min="14"
                      max="30"
                      value={brandingDraft.scanTitleSizePx}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, scanTitleSizePx: Number(e.target.value) }))}
                      className="w-full accent-indigo-600"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between font-bold text-slate-700 mb-1">
                      <span>Cỡ chữ dòng hướng dẫn nhỏ:</span>
                      <span className="text-indigo-700">{brandingDraft.scanSubtitleSizePx} px</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="18"
                      value={brandingDraft.scanSubtitleSizePx}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, scanSubtitleSizePx: Number(e.target.value) }))}
                      className="w-full accent-indigo-600"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between font-bold text-slate-700 mb-1">
                      <span>Cỡ chữ trên 2 nút bấm chính:</span>
                      <span className="text-indigo-700">{brandingDraft.scanBtnTextSizePx} px</span>
                    </div>
                    <input
                      type="range"
                      min="12"
                      max="22"
                      value={brandingDraft.scanBtnTextSizePx}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, scanBtnTextSizePx: Number(e.target.value) }))}
                      className="w-full accent-indigo-600"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between font-bold text-slate-700 mb-1">
                      <span>Độ cao / To 2 nút bấm chính:</span>
                      <span className="text-indigo-700">{brandingDraft.scanBtnHeightPx} px</span>
                    </div>
                    <input
                      type="range"
                      min="42"
                      max="110"
                      value={brandingDraft.scanBtnHeightPx}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, scanBtnHeightPx: Number(e.target.value) }))}
                      className="w-full accent-indigo-600"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between font-bold text-slate-700 mb-1">
                      <span>Tỷ lệ chiều rộng nút Camera (%):</span>
                      <span className="text-indigo-700">{brandingDraft.scanCameraWidthPct}% / {100 - brandingDraft.scanCameraWidthPct}%</span>
                    </div>
                    <input
                      type="range"
                      min="30"
                      max="70"
                      value={brandingDraft.scanCameraWidthPct}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, scanCameraWidthPct: Number(e.target.value) }))}
                      className="w-full accent-indigo-600"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between font-bold text-slate-700 mb-1">
                      <span>Độ rộng lề khung (Padding):</span>
                      <span className="text-indigo-700">{brandingDraft.scanCardPaddingPx} px</span>
                    </div>
                    <input
                      type="range"
                      min="12"
                      max="44"
                      value={brandingDraft.scanCardPaddingPx}
                      onChange={(e) => setBrandingDraft(prev => ({ ...prev, scanCardPaddingPx: Number(e.target.value) }))}
                      className="w-full accent-indigo-600"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setBrandingDraft(DEFAULT_SYSTEM_BRANDING)}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                >
                  Khôi Phục Mặc Định
                </button>
                <button
                  type="button"
                  onClick={() => {
                    persistSystemBranding(brandingDraft);
                    setIsBrandingModalOpen(false);
                  }}
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold shadow-md"
                >
                  Lưu & Ghi Nhớ Toàn Hệ Thống
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 6: SAO LƯU & NẠP DỮ LIỆU TOÀN HỆ THỐNG (.JSON)                  */}
      {/* ===================================================================== */}
      {isBackupModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
          <div className="bg-white rounded-3xl max-w-xl w-full overflow-hidden flex flex-col shadow-2xl border border-slate-200">
            <div className="px-5 py-4 bg-indigo-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="font-black text-sm sm:text-base">
                    Kho Sao Lưu & Nạp Dữ Liệu Hệ Thống
                  </h3>
                  <p className="text-[11px] text-indigo-300">
                    Lưu trữ & khôi phục trọn bộ Tài khoản Giáo viên, Đề thi, Đáp án, Giao diện và Bảng điểm
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBackupModalOpen(false)}
                className="p-1.5 rounded-xl hover:bg-indigo-800 text-indigo-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

              <div className="p-5 space-y-4 text-xs">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="font-black text-slate-900">Trạng thái dữ liệu hiện tại trong phòng "{safeText(examSessionCode)}":</div>
                <div className="grid grid-cols-3 gap-2 text-center pt-1">
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                    <div className="text-lg font-black text-indigo-600">{teacherAccounts.length}</div>
                    <div className="text-[11px] font-bold text-slate-500">Tài khoản GV</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                    <div className="text-lg font-black text-emerald-600">{examProfiles.length}</div>
                    <div className="text-[11px] font-bold text-slate-500">Bộ đề & Đáp án</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                    <div className="text-lg font-black text-amber-600">{allResults.length}</div>
                    <div className="text-[11px] font-bold text-slate-500">Bài đã chấm</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleExportSystemBackup}
                  className="p-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold flex flex-col items-center justify-center gap-2 text-center shadow-md"
                >
                  <DownloadCloud className="w-7 h-7" />
                  <span>1. Tải File Sao Lưu (.JSON)</span>
                  <span className="text-[10px] font-normal text-emerald-100">
                    Lưu danh sách GV, đề thi, logo & điểm về máy tính
                  </span>
                </button>

                <div>
                  <input
                    ref={restoreBackupInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleImportSystemBackup}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => restoreBackupInputRef.current?.click()}
                    className="w-full h-full p-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold flex flex-col items-center justify-center gap-2 text-center shadow-md"
                  >
                    <UploadCloud className="w-7 h-7 text-amber-300" />
                    <span>2. Nạp Dữ Liệu Đã Lưu (.JSON)</span>
                    <span className="text-[10px] font-normal text-indigo-100">
                      Khôi phục ngay danh sách GV, đề thi & giao diện lên Cloud
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 4: TÍCH HỢP GOOGLE SHEETS (FREE 100%) & HƯỚNG DẪN ĐƯA WEB ONLINE */}
      {/* ===================================================================== */}
      {isSheetModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-2xl border border-slate-200">
            <div className="px-5 py-4 bg-emerald-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="font-black text-sm sm:text-base">
                    Kho Lưu Trữ Google Sheets (Free 100%) & Đưa Web Lên Mạng
                  </h3>
                  <p className="text-[11px] text-emerald-300">
                    Tự động đổ điểm từ điện thoại giáo viên về Google Drive • Không giới hạn dung lượng
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSheetModalOpen(false)}
                className="p-1.5 rounded-xl hover:bg-emerald-800 text-emerald-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex border-b border-slate-200 bg-slate-50 px-5 pt-2 gap-2">
              <button
                type="button"
                onClick={() => setSheetModalTab('webhook')}
                className={`px-4 py-2 text-xs font-extrabold rounded-t-xl border-b-2 flex items-center gap-1.5 ${
                  sheetModalTab === 'webhook'
                    ? 'border-emerald-600 text-emerald-800 bg-white'
                    : 'border-transparent text-slate-500'
                }`}
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>1. Kết Nối Google Sheets (Lưu Điểm Tự Động)</span>
              </button>
              <button
                type="button"
                onClick={() => setSheetModalTab('deploy')}
                className={`px-4 py-2 text-xs font-extrabold rounded-t-xl border-b-2 flex items-center gap-1.5 ${
                  sheetModalTab === 'deploy'
                    ? 'border-indigo-600 text-indigo-800 bg-white'
                    : 'border-transparent text-slate-500'
                }`}
              >
                <Globe className="w-4 h-4" />
                <span>2. Hướng Dẫn 3 Bước Đưa Web Lên Mạng Miễn Phí</span>
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs text-slate-700">
              {sheetModalTab === 'webhook' ? (
                <>
                  <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-2.5">
                    <label className="block font-black text-emerald-950 uppercase">
                      Đường dẫn Google Apps Script Web App URL:
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="url"
                        placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                        value={googleSheetWebhookUrl}
                        onChange={(e) => setGoogleSheetWebhookUrl(e.target.value)}
                        className="flex-1 px-3.5 py-2.5 rounded-xl border border-emerald-300 bg-white font-mono text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => saveGoogleSheetWebhookUrl(googleSheetWebhookUrl)}
                        className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold shrink-0"
                      >
                        Lưu Kết Nối
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-emerald-800">
                        {googleSheetWebhookUrl
                          ? 'Đang bật: Mọi bài giáo viên chấm xong sẽ tự động ghi thêm 1 dòng vào Google Sheet của bạn.'
                          : 'Chưa kết nối: Làm theo 3 bước bên dưới để tạo link miễn phí trong 1 phút.'}
                      </span>
                      {googleSheetWebhookUrl && (
                        <button
                          type="button"
                          disabled={isSyncingAllToSheet}
                          onClick={handleSyncAllExistingToSheet}
                          className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] flex items-center gap-1"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAllToSheet ? 'animate-spin' : ''}`} />
                          <span>Đẩy Toàn Bộ {allResults.length} Bài Hiện Có Sang Sheet</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <div className="font-black text-slate-900 uppercase">
                      Cách tạo Google Sheet nhận điểm miễn phí 100% (Chỉ làm 1 lần):
                    </div>
                    <ol className="list-decimal pl-5 space-y-1.5 leading-relaxed">
                      <li>
                        Mở <strong>Google Drive</strong> của bạn → Tạo 1 file <strong>Google Trang tính (Google Sheets)</strong> mới đặt tên là <em>"Bang Diem Cambridge"</em>.
                      </li>
                      <li>
                        Trên thanh menu Google Sheet, chọn <strong>Tiện ích mở rộng (Extensions) → Apps Script</strong>. Xóa mã cũ và dán đoạn mã dưới đây vào, sau đó nhấn biểu tượng <strong>Lưu (Save)</strong>:
                      </li>
                    </ol>

                    <div className="relative bg-slate-900 text-emerald-300 p-3.5 rounded-2xl font-mono text-[11px] overflow-x-auto">
                      <button
                        type="button"
                        onClick={() => {
                          const codeStr = `function doPost(e) {\n  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();\n  if (sheet.getLastRow() === 0) {\n    sheet.appendRow(["Thời gian", "Mã phòng", "Khối", "Bộ đề", "Họ và tên", "Lớp", "Trường", "Listening", "R&W", "Tổng điểm", "Số câu đúng", "Số Khiên", "GV Chấm", "Chi tiết câu sai"]);\n  }\n  var d = JSON.parse(e.postData.contents);\n  sheet.appendRow([d.timestamp, d.sessionCode, d.gradeName, d.examTitle, d.studentName, d.className, d.schoolName, d.listeningScore, d.rwScore, d.score, d.correctCount, d.shields, d.gradedBy, d.wrongDetails]);\n  return ContentService.createTextOutput(JSON.stringify({status: "ok"})).setMimeType(ContentService.MimeType.JSON);\n}`;
                          const ta = document.createElement('textarea');
                          ta.value = codeStr;
                          document.body.appendChild(ta);
                          ta.select();
                          document.execCommand('copy');
                          document.body.removeChild(ta);
                          showToast('Đã sao chép mã Apps Script!', 'success');
                        }}
                        className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-sans font-bold flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copy Mã</span>
                      </button>
                      <pre className="leading-relaxed">{`function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Thời gian", "Mã phòng", "Khối", "Bộ đề", "Họ và tên", "Lớp", "Trường", "Listening", "R&W", "Tổng điểm", "Số câu đúng", "Số Khiên", "GV Chấm", "Chi tiết câu sai"]);
  }
  var d = JSON.parse(e.postData.contents);
  sheet.appendRow([d.timestamp, d.sessionCode, d.gradeName, d.examTitle, d.studentName, d.className, d.schoolName, d.listeningScore, d.rwScore, d.score, d.correctCount, d.shields, d.gradedBy, d.wrongDetails]);
  return ContentService.createTextOutput(JSON.stringify({status: "ok"})).setMimeType(ContentService.MimeType.JSON);
}`}</pre>
                    </div>

                    <ol start={3} className="list-decimal pl-5 space-y-1.5 leading-relaxed">
                      <li>
                        Nhấn nút <strong>Triển khai (Deploy) → Tùy chọn triển khai mới (New deployment)</strong> → Chọn loại <strong>Ứng dụng web (Web app)</strong> → Mục <em>Người có quyền truy cập (Who has access)</em> chọn <strong>Bất kỳ ai (Anyone)</strong> → Nhấn <strong>Triển khai</strong> và copy đường link dán vào ô phía trên.
                      </li>
                    </ol>
                  </div>
                </>
              ) : (
                <div className="space-y-4 leading-relaxed">
                  <div className="p-3.5 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-950 font-semibold">
                    Để các giáo viên mở link trực tiếp trên điện thoại mà <strong>không cần tài khoản Google AI Pro</strong>, bạn chỉ cần đưa mã nguồn ứng dụng này lên một trang web miễn phí trọn đời theo 3 bước sau:
                  </div>

                  <div className="p-4 rounded-2xl border border-slate-200 space-y-1.5">
                    <div className="font-black text-indigo-700 text-sm">
                      Bước 1: Tạo dự án Web miễn phí (5 phút)
                    </div>
                    <p>
                      Mở máy tính, cài <strong>Node.js</strong>, mở Terminal và chạy 3 lệnh tạo khung ứng dụng React:
                    </p>
                    <pre className="bg-slate-900 text-slate-100 p-3 rounded-xl font-mono text-[11px] overflow-x-auto">
{`npm create vite@latest cambridge-grader -- --template react
cd cambridge-grader
npm install lucide-react firebase && npm install -D tailwindcss postcss autoprefixer`}
                    </pre>
                    <p>
                      Sau đó copy toàn bộ code của ứng dụng này dán đè vào file <code>src/App.jsx</code> (và điền 1 mã Gemini API Key miễn phí từ <em>aistudio.google.com</em> vào biến <code>apiKey</code>).
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl border border-slate-200 space-y-1.5">
                    <div className="font-black text-indigo-700 text-sm">
                      Bước 2: Đưa lên mạng miễn phí trọn đời qua Vercel hoặc Netlify
                    </div>
                    <p>
                      Chạy lệnh <code>npm run build</code> để tạo thư mục <code>dist</code>. Truy cập <strong>app.netlify.com/drop</strong> (miễn phí 100%, không cần thẻ), kéo thả thư mục <code>dist</code> vào trình duyệt là bạn nhận ngay đường link dạng <code>https://chamthi-cambridge.netlify.app</code>.
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl border border-slate-200 space-y-1.5">
                    <div className="font-black text-indigo-700 text-sm">
                      Bước 3: Gửi link & tài khoản giáo viên qua Zalo
                    </div>
                    <p>
                      Gửi đường link vừa tạo kèm <strong>Tên đăng nhập + Mật khẩu</strong> bạn đã cấp trong mục <strong>Phân Quyền GV</strong> cho các giáo viên. Mọi giáo viên mở trên điện thoại chấm bài sẽ tự động đổ điểm về đúng <strong>Google Sheet</strong> của bạn theo thời gian thực!
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 1: TẠO ĐỀ KHỐI MỚI & QUẢN LÝ KHO ĐỀ (EXAM BANK)                 */}
      {/* ===================================================================== */}
      {isBankModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-2xl border border-slate-200">
            <div className="px-5 py-4 bg-indigo-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="font-black text-sm sm:text-base">
                    Kho Đề & Đáp Án Theo Khối Lớp ({examProfiles.length} bộ đề)
                  </h3>
                  <p className="text-[11px] text-indigo-300">
                    Mỗi khối lưu trữ đề, phiếu in và bảng điểm tách biệt hoàn toàn
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBankModalOpen(false)}
                className="p-1.5 rounded-xl hover:bg-indigo-800 text-indigo-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex border-b border-slate-200 bg-slate-50 px-5 pt-2 gap-2">
              <button
                type="button"
                onClick={() => setBankModalTab('create')}
                className={`px-4 py-2 text-xs font-extrabold rounded-t-xl border-b-2 ${
                  bankModalTab === 'create'
                    ? 'border-indigo-600 text-indigo-700 bg-white'
                    : 'border-transparent text-slate-500'
                }`}
              >
                + Tạo Bộ Đề Khối Mới (AI Bóc Tách 9→1)
              </button>
              <button
                type="button"
                onClick={() => setBankModalTab('list')}
                className={`px-4 py-2 text-xs font-extrabold rounded-t-xl border-b-2 ${
                  bankModalTab === 'list'
                    ? 'border-indigo-600 text-indigo-700 bg-white'
                    : 'border-transparent text-slate-500'
                }`}
              >
                Danh Sách Các Khối Đã Lưu ({examProfiles.length})
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
              {bankModalTab === 'create' ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Tên Khối Lớp *</label>
                      <input
                        type="text"
                        placeholder="VD: Grade 2, Grade 3, Grade 4..."
                        value={newGradeName}
                        onChange={(e) => setNewGradeName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Tên Đề Thi</label>
                      <input
                        type="text"
                        placeholder="VD: Final Test 1 - Cambridge Starters"
                        value={newExamTitle}
                        onChange={(e) => setNewExamTitle(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Cấp độ Cambridge</label>
                      <select
                        value={newExamLevel}
                        onChange={(e) => setNewExamLevel(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold"
                      >
                        <option value="Cambridge Pre-A1 Starters">Cambridge Pre-A1 Starters (Lớp 2-3)</option>
                        <option value="Cambridge A1 Movers">Cambridge A1 Movers (Lớp 4)</option>
                        <option value="Cambridge A2 Flyers">Cambridge A2 Flyers (Lớp 5)</option>
                        <option value="Cambridge KET / PET">Cambridge KET / PET</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Số trang/HS</label>
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={newPagesPerStudent}
                          onChange={(e) => setNewPagesPerStudent(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Thang điểm</label>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={newMaxScore}
                          onChange={(e) => setNewMaxScore(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-black text-indigo-950">Nạp File PDF / Ảnh Đáp Án Gốc (9 Trang)</div>
                        <div className="text-[11px] text-indigo-700">
                          AI tự động đọc cả hình nối tranh, chọn màu, tick/cross và tạo phiếu 1 trang tiếng Anh
                        </div>
                      </div>
                      <input
                        ref={newProfileUploadRef}
                        type="file"
                        accept=".pdf,image/*"
                        onChange={handleNewProfileFileUpload}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => newProfileUploadRef.current?.click()}
                        className="px-3.5 py-2 rounded-xl bg-white border border-indigo-300 hover:bg-indigo-100 text-indigo-800 font-extrabold flex items-center gap-1.5"
                      >
                        <Upload className="w-4 h-4" />
                        <span>{newSourceFileName ? `Đã chọn: ${newSourceFileName}` : 'Chọn File PDF / Ảnh'}</span>
                      </button>
                    </div>

                    <textarea
                      rows={4}
                      placeholder="Hoặc dán văn bản đáp án chuẩn tại đây..."
                      value={newAnswerKeyText}
                      onChange={(e) => setNewAnswerKeyText(e.target.value)}
                      className="w-full p-3 rounded-xl border border-slate-300 bg-white font-mono text-xs"
                    />

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={isExtractingNewProfile}
                        onClick={extractAnswersWithAIForNewProfile}
                        className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold flex items-center gap-1.5"
                      >
                        <Sparkles className={`w-4 h-4 ${isExtractingNewProfile ? 'animate-spin' : ''}`} />
                        <span>{isExtractingNewProfile ? 'AI Đang Bóc Tách...' : 'Xem Trước AI Bóc Tách Đề'}</span>
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isExtractingNewProfile}
                    onClick={handleSaveNewProfile}
                    className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-sm shadow-md"
                  >
                    {isExtractingNewProfile ? 'Đang xử lý & Lưu Cloud...' : 'Lưu Bộ Đề Khối Mới Vào Hệ Thống'}
                  </button>
                </>
              ) : (
                <div className="space-y-2.5">
                  {examProfiles.map((prof, pIdx) => {
                    const count = allResults.filter(r => r.profileId === prof.id).length;
                    const qCount = (prof.parts || []).reduce((s, p) => s + (p.items?.length || 0), 0);
                    return (
                      <div
                        key={prof.id || pIdx}
                        className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
                          prof.id === selectedProfileId
                            ? 'border-indigo-500 bg-indigo-50/50'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-indigo-900 text-white font-extrabold text-[11px]">
                              {safeText(prof.gradeName)}
                            </span>
                            <span className="font-bold text-slate-900">{safeText(prof.examTitle)}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-1">
                            {prof.parts?.length || 0} Part • {qCount} câu • Thang {safeText(prof.maxScore)}đ • Đã chấm: <strong>{count} bài</strong>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedProfileId(prof.id);
                              setIsBankModalOpen(false);
                            }}
                            className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white font-bold text-xs"
                          >
                            Chọn Đề Này
                          </button>
                          {hasPermission('canManageExams') && (
                            <button
                              type="button"
                              onClick={() => deleteProfile(prof.id)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: XEM SONG SONG ẢNH GỐC & SỬA CHI TIẾT BÀI LÀM HỌC SINH        */}
      {/* ===================================================================== */}
      {reviewStudent && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-5">
          <div className="bg-white rounded-3xl max-w-6xl w-full max-h-[94vh] overflow-hidden flex flex-col shadow-2xl border border-slate-200">
            <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-black text-xs">
                    {safeText(reviewStudent.score)} đ
                  </span>
                  <h3 className="font-black text-sm sm:text-base truncate">{safeText(reviewStudent.studentName)}</h3>
                </div>
                <p className="text-[11px] text-slate-300 truncate">
                  {safeText(reviewStudent.gradeName)} • Lớp: {safeText(reviewStudent.className)} • {safeText(reviewStudent.sectionBreakdown)}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setReviewStudentId(null)}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
              {/* Cột trái: Ảnh bài làm gốc */}
              <div className="p-4 bg-slate-100 flex flex-col items-center justify-center gap-3">
                {reviewStudent.pages && reviewStudent.pages.length > 0 && reviewStudent.pages[reviewPageIdx]?.dataUrl ? (
                  <>
                    <img
                      src={reviewStudent.pages[reviewPageIdx].dataUrl}
                      alt="Student Answer Sheet"
                      className="max-h-[65vh] w-auto rounded-xl shadow-md border border-slate-300 object-contain bg-white"
                    />
                    {reviewStudent.pages.length > 1 && (
                      <div className="flex items-center gap-2">
                        {reviewStudent.pages.map((pg, pIdx) => (
                          <button
                            key={pIdx}
                            type="button"
                            onClick={() => setReviewPageIdx(pIdx)}
                            className={`px-3 py-1 rounded-lg text-xs font-bold ${
                              reviewPageIdx === pIdx ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 border'
                            }`}
                          >
                            Trang {pg.pageNum}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-16 text-center text-xs text-slate-500">
                    Ảnh chụp được tối ưu lưu trữ trên thiết bị gốc; toàn bộ điểm và chi tiết từng câu được đồng bộ đầy đủ bên phải.
                  </div>
                )}
              </div>

              {/* Cột phải: Thông tin hành chính & Chi tiết từng câu hỏi */}
              <div className="p-4 sm:p-5 space-y-4 overflow-y-auto max-h-[75vh]">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                  <div>
                    <label className="block font-bold text-slate-500 mb-1">Họ và tên HS</label>
                    <input
                      type="text"
                      value={reviewStudent.studentName}
                      onChange={(e) => updateStudentMetaField(reviewStudent.id, 'studentName', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-500 mb-1">Lớp</label>
                    <input
                      type="text"
                      value={reviewStudent.className}
                      onChange={(e) => updateStudentMetaField(reviewStudent.id, 'className', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-500 mb-1">Trường</label>
                    <input
                      type="text"
                      value={reviewStudent.schoolName}
                      onChange={(e) => updateStudentMetaField(reviewStudent.id, 'schoolName', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-black text-slate-800 uppercase">
                    Chi tiết từng câu ({safeText(reviewStudent.correctCount)}/{safeText(reviewStudent.totalQuestions)} đúng)
                  </div>
                  {(reviewStudent.questions || []).map((q, qIdx) => (
                    <div
                      key={qIdx}
                      className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs ${
                        q.isCorrect ? 'bg-emerald-50/60 border-emerald-200' : 'bg-rose-50/70 border-rose-200'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900">{safeText(q.questionNumber)}</div>
                        <div className="text-[11px] text-slate-600">
                          Đáp án chuẩn: <strong className="text-emerald-700">{safeText(q.correctAnswer)}</strong>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          type="text"
                          value={safeText(q.studentAnswer)}
                          onChange={(e) => updateStudentQuestionField(reviewStudent.id, qIdx, e.target.value, null)}
                          className="w-28 px-2.5 py-1 rounded-lg border border-slate-300 bg-white font-mono font-bold text-xs text-center"
                        />
                        <button
                          type="button"
                          onClick={() => updateStudentQuestionField(reviewStudent.id, qIdx, null, !q.isCorrect)}
                          className={`px-2.5 py-1 rounded-lg font-extrabold text-[11px] ${
                            q.isCorrect ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                          }`}
                        >
                          {q.isCorrect ? 'Đúng' : 'Sai'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* THANH TIÊU ĐỀ CHÍNH (HEADER) & CHUYỂN CHẾ ĐỘ                          */}
      {/* ===================================================================== */}
      <header className="sticky top-0 z-30 shadow-md">
        <div className="bg-slate-900 text-white px-3 sm:px-6 lg:px-8 py-3">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {typeof systemBranding.logoDataUrl === 'string' && systemBranding.logoDataUrl ? (
                <img
                  src={systemBranding.logoDataUrl}
                  alt="Logo"
                  style={{
                    width: `${Number(systemBranding.logoWidth || 42)}px`,
                    height: `${Number(systemBranding.logoHeight || 42)}px`,
                    borderRadius: `${Number(systemBranding.logoRadius || 14)}px`
                  }}
                  className="object-contain bg-white/10 shrink-0"
                />
              ) : (
                <div
                  style={{
                    width: `${Number(systemBranding.logoWidth || 42)}px`,
                    height: `${Number(systemBranding.logoHeight || 42)}px`,
                    borderRadius: `${Number(systemBranding.logoRadius || 14)}px`
                  }}
                  className="bg-indigo-600 flex items-center justify-center shadow-inner shrink-0"
                >
                  <Award className="w-6 h-6 text-amber-400" />
                </div>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h1
                    style={{ fontSize: `${Number(systemBranding.titleSizePx || 18)}px` }}
                    className="font-black tracking-tight"
                  >
                    {safeText(systemBranding.appName)}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      syncStatus === 'synced'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : syncStatus === 'saving'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {syncStatus === 'synced' ? <Cloud className="w-3 h-3" /> : <CloudOff className="w-3 h-3" />}
                    <span>{syncStatus === 'synced' ? 'Cloud Sync' : syncStatus === 'saving' ? 'Đang lưu...' : 'Local'}</span>
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 hidden sm:block">
                  {safeText(systemBranding.appSubtitle)}
                </p>
              </div>
            </div>

            {/* Bộ chuyển 2 chế độ & Nút Quản trị Admin */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="bg-slate-800 p-1 rounded-xl flex items-center gap-1 border border-slate-700">
                <button
                  type="button"
                  onClick={() => setAppMode('mobile_omr')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                    appMode === 'mobile_omr'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>{t.mobileModeBtn}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAppMode('pdf_batch')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                    appMode === 'pdf_batch'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>{t.pdfBatchModeBtn}</span>
                </button>
              </div>

              {currentUserAccount.role === 'admin' && (
                <>
                  {/* Bộ chuyển đổi ngôn ngữ VI / EN (Chỉ hiển thị cho Admin) */}
                  <div className="bg-slate-800 p-1 rounded-xl flex items-center border border-slate-700 text-[11px] font-black">
                    <button
                      type="button"
                      onClick={() => setUiLang('vi')}
                      className={`px-2 py-1 rounded-lg transition-all ${
                        uiLang === 'vi' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      VI
                    </button>
                    <button
                      type="button"
                      onClick={() => setUiLang('en')}
                      className={`px-2 py-1 rounded-lg transition-all ${
                        uiLang === 'en' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      EN
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setBrandingDraft(systemBranding);
                      setIsBrandingModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-extrabold shadow-xs"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span className="hidden lg:inline">{isEn ? 'UI & Logo' : 'Sửa Giao Diện & Logo'}</span>
                    <span className="lg:hidden">{isEn ? 'UI' : 'Giao diện'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsBackupModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-extrabold shadow-xs"
                  >
                    <Database className="w-3.5 h-3.5" />
                    <span className="hidden lg:inline">{isEn ? 'Backup / Restore' : 'Lưu / Nạp Dữ Liệu'}</span>
                    <span className="lg:hidden">{isEn ? 'Backup' : 'Sao lưu'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsSheetModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-xs"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span className="hidden xl:inline">Google Sheets</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsUserMgmtOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold shadow-xs"
                  >
                    <Shield className="w-3.5 h-3.5" />
                    <span>{isEn ? `Teachers (${teacherAccounts.length})` : `Phân Quyền GV (${teacherAccounts.length})`}</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={handleSystemLogout}
                className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-rose-900/80 text-slate-300 hover:text-white border border-slate-700 text-xs font-bold"
                title={t.logoutBtn}
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t.logoutBtn}</span>
              </button>
            </div>
          </div>
        </div>

        {/* HÀNG 2: THANH CHỌN KHỐI LỚP & PHÒNG CHẤM ĐA GIÁO VIÊN */}
        <div className="bg-indigo-950 text-white px-3 sm:px-6 lg:px-8 py-2.5 border-t border-indigo-900">
          <div className="max-w-7xl mx-auto flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5 flex-1 min-w-[240px]">
                <span className="text-[11px] uppercase tracking-wider font-extrabold text-indigo-300 shrink-0 flex items-center gap-1">
                  <FolderOpen className="w-4 h-4 text-amber-400" />
                  {t.gradeLabel}
                </span>

                <select
                  value={selectedProfileId}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                  className="flex-1 max-w-md bg-indigo-900/90 hover:bg-indigo-800 text-white border border-indigo-600/80 rounded-xl px-3 py-1.5 text-xs sm:text-sm font-bold focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
                >
                  {examProfiles.map(prof => {
                    const count = allResults.filter(r => r.profileId === prof.id).length;
                    return (
                      <option key={prof.id} value={prof.id} className="bg-slate-900 text-white">
                        [{safeText(prof.gradeName)}] {safeText(prof.examTitle)} ({count} {t.examsCountLabel})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="flex items-center gap-2">
                {hasPermission('canManageExams') && (
                  <button
                    type="button"
                    onClick={() => {
                      setBankModalTab('create');
                      setIsBankModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold shadow-xs transition-all"
                  >
                    <Plus className="w-4 h-4 stroke-[2.5]" />
                    <span>{t.createNewExamBtn}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setBankModalTab('list');
                    setIsBankModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-800 hover:bg-indigo-700 text-indigo-100 border border-indigo-600 text-xs font-bold transition-all"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>{t.examBankBtn} ({examProfiles.length})</span>
                </button>
              </div>
            </div>

            {/* Dòng 2B: Định danh Giáo Viên & Mã Phòng Chấm Chung */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-indigo-900/80 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 bg-indigo-900/70 px-2.5 py-1 rounded-lg border border-indigo-700/70">
                  <span className="text-indigo-300 font-semibold">{t.graderLabel}</span>
                  <input
                    type="text"
                    value={teacherName}
                    onChange={(e) => setTeacherName(e.target.value)}
                    placeholder={t.graderPlaceholder}
                    className="bg-transparent text-white font-bold w-28 sm:w-36 focus:outline-none border-b border-indigo-500 focus:border-amber-400"
                  />
                </div>

                <div className="flex items-center gap-1.5 bg-indigo-900/70 px-2.5 py-1 rounded-lg border border-indigo-700/70">
                  <span className="text-indigo-300 font-semibold">{t.roomCodeLabel}</span>
                  <span className="text-amber-300 font-mono font-extrabold">{examSessionCode}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const text = `Cambridge AI Grader - Room: ${examSessionCode} | Exam: ${currentProfile.gradeName}`;
                      const ta = document.createElement('textarea');
                      ta.value = text;
                      document.body.appendChild(ta);
                      ta.select();
                      document.execCommand('copy');
                      document.body.removeChild(ta);
                      showToast(
                        isEn ? `Copied room code "${examSessionCode}"!` : `Đã sao chép mã phòng "${examSessionCode}"!`,
                        'success'
                      );
                    }}
                    className="p-1 rounded hover:bg-indigo-700 text-indigo-200 hover:text-white"
                    title={t.copyRoomTitle}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="text-[11px] text-indigo-300 hidden md:block">
                {t.loggedInAs} <strong>{safeText(currentUserAccount.fullName)}</strong>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ===================================================================== */}
      {/* NỘI DUNG CHÍNH: CHẾ ĐỘ 1 - CHẤM NHANH ĐIỆN THOẠI 1 TRANG (9 -> 1)     */}
      {/* ===================================================================== */}
      <main className="max-w-5xl mx-auto px-3 sm:px-6 pt-5">
        {appMode === 'mobile_omr' ? (
          <div className="space-y-4">
            {/* Thanh 3 Sub-tab tối ưu chạm trên điện thoại */}
            <div className="grid grid-cols-3 gap-2 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-xs">
              <button
                type="button"
                onClick={() => setOmrSubTab('scan')}
                className={`py-2.5 px-2 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                  omrSubTab === 'scan'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Camera className="w-4 h-4" />
                <span>{t.tabScan}</span>
              </button>

              <button
                type="button"
                onClick={() => setOmrSubTab('key')}
                className={`py-2.5 px-2 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                  omrSubTab === 'key'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span>{t.tabKey}</span>
              </button>

              <button
                type="button"
                onClick={() => setOmrSubTab('list')}
                className={`py-2.5 px-2 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                  omrSubTab === 'list'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Award className="w-4 h-4" />
                <span>{t.tabList} ({currentProfileResults.length})</span>
              </button>
            </div>

            {/* SUB-TAB A: CHẤM CAMERA 1 CHẠM (HỖ TRỢ ADMIN KÉO THẢ & CHỈNH SỬA TRỰC TIẾP) */}
            {omrSubTab === 'scan' && (
              <div className="space-y-4">
                <div
                  style={{ padding: `${systemBranding.scanCardPaddingPx || 24}px` }}
                  className={`bg-white rounded-3xl border shadow-sm space-y-4 transition-all ${
                    isScanLayoutEditMode ? 'border-purple-400 ring-2 ring-purple-200' : 'border-slate-200'
                  }`}
                >
                  {/* Thanh công cụ chỉnh sửa & kéo thả nhanh dành riêng cho Admin */}
                  {currentUserAccount.role === 'admin' && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-dashed border-slate-200">
                      <span className="text-[11px] font-bold text-slate-500">
                        {isScanLayoutEditMode
                          ? 'Đang bật chế độ Kéo Thả: Cầm vào từng khối hoặc nút bên dưới để kéo đổi vị trí, sau đó nhấn Lưu!'
                          : 'Quyền Admin: Tùy biến bố cục, kích thước & chữ khung chấm này'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setIsScanLayoutEditMode(prev => !prev)}
                          className={`px-3 py-1 rounded-xl text-[11px] font-extrabold flex items-center gap-1 transition-all ${
                            isScanLayoutEditMode
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : 'bg-purple-100 hover:bg-purple-200 text-purple-900'
                          }`}
                        >
                          <Sliders className="w-3.5 h-3.5" />
                          <span>{isScanLayoutEditMode ? 'Xong Kéo Thả' : 'Kéo Thả Bố Cục'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setBrandingDraft(systemBranding);
                            setIsBrandingModalOpen(true);
                          }}
                          className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-extrabold flex items-center gap-1"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Sửa Chữ & Cỡ To/Nhỏ</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Render các hàng theo thứ tự kéo thả của Admin */}
                  {(systemBranding.scanSectionOrder || ['top_row', 'action_row']).map((sectionId) => {
                    if (sectionId === 'top_row') {
                      return (
                        <div
                          key="top_row"
                          draggable={isScanLayoutEditMode}
                          onDragStart={() => setDraggedScanItem({ group: 'scanSectionOrder', id: 'top_row' })}
                          onDragOver={(e) => isScanLayoutEditMode && e.preventDefault()}
                          onDrop={() => handleScanElementDrop('scanSectionOrder', 'top_row')}
                          className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl ${
                            isScanLayoutEditMode ? 'p-2 border-2 border-dashed border-purple-300 bg-purple-50/30 cursor-move' : ''
                          }`}
                        >
                          {(systemBranding.scanTopOrder || ['header_info', 'demo_btn']).map((topItemId) => {
                            if (topItemId === 'header_info') {
                              return (
                                <div
                                  key="header_info"
                                  draggable={isScanLayoutEditMode}
                                  onDragStart={(e) => {
                                    e.stopPropagation();
                                    setDraggedScanItem({ group: 'scanTopOrder', id: 'header_info' });
                                  }}
                                  onDragOver={(e) => isScanLayoutEditMode && e.preventDefault()}
                                  onDrop={(e) => {
                                    e.stopPropagation();
                                    handleScanElementDrop('scanTopOrder', 'header_info');
                                  }}
                                  className={isScanLayoutEditMode ? 'p-2 rounded-xl border border-dashed border-indigo-400 bg-white cursor-grab' : ''}
                                >
                                  <span className="px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-extrabold text-[11px]">
                                    {safeText(currentProfile.gradeName)} • {currentTotalQuestionsCount} {t.questionsUnit} • {t.scaleUnit} {safeText(currentProfile.maxScore)}{t.ptsUnit}
                                  </span>
                                  <h2
                                    style={{ fontSize: `${Number(systemBranding.scanTitleSizePx || 18)}px` }}
                                    className="font-black text-slate-900 mt-1 leading-snug"
                                  >
                                    {safeText(t.scanTitle)}
                                  </h2>
                                  <p
                                    style={{ fontSize: `${Number(systemBranding.scanSubtitleSizePx || 12)}px` }}
                                    className="text-slate-500 mt-0.5"
                                  >
                                    {safeText(t.scanSubtitle)}
                                  </p>
                                </div>
                              );
                            }

                            return (
                              <div
                                key="demo_btn"
                                draggable={isScanLayoutEditMode}
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  setDraggedScanItem({ group: 'scanTopOrder', id: 'demo_btn' });
                                }}
                                onDragOver={(e) => isScanLayoutEditMode && e.preventDefault()}
                                onDrop={(e) => {
                                  e.stopPropagation();
                                  handleScanElementDrop('scanTopOrder', 'demo_btn');
                                }}
                                className={isScanLayoutEditMode ? 'p-1.5 rounded-xl border border-dashed border-amber-400 bg-white cursor-grab' : ''}
                              >
                                <button
                                  type="button"
                                  disabled={isScanningOmr || !hasPermission('canGrade')}
                                  onClick={handleRunDemoOmr}
                                  className="px-3.5 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 disabled:opacity-50 text-amber-900 text-xs font-extrabold flex items-center gap-1.5"
                                >
                                  <Sparkles className="w-4 h-4" />
                                  <span>{t.demoBtn}</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }

                    // Hàng 2: 2 Nút Hành Động Chính (Camera & Thư Viện)
                    if (!hasPermission('canGrade')) {
                      return (
                        <div key="action_row" className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
                          {t.noGradePerm}
                        </div>
                      );
                    }

                    const camPct = systemBranding.scanCameraWidthPct || 50;
                    const galPct = 100 - camPct;

                    return (
                      <div
                        key="action_row"
                        draggable={isScanLayoutEditMode}
                        onDragStart={() => setDraggedScanItem({ group: 'scanSectionOrder', id: 'action_row' })}
                        onDragOver={(e) => isScanLayoutEditMode && e.preventDefault()}
                        onDrop={() => handleScanElementDrop('scanSectionOrder', 'action_row')}
                        className={`flex flex-col sm:flex-row gap-3 rounded-2xl ${
                          isScanLayoutEditMode ? 'p-2 border-2 border-dashed border-purple-300 bg-purple-50/30 cursor-move' : ''
                        }`}
                      >
                        <input
                          ref={cameraInputRef}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={handleOmrFileSelect}
                          className="hidden"
                        />
                        <input
                          ref={galleryInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleOmrFileSelect}
                          className="hidden"
                        />

                        {(systemBranding.scanActionOrder || ['camera_btn', 'gallery_btn']).map((btnId) => {
                          if (btnId === 'camera_btn') {
                            return (
                              <div
                                key="camera_btn"
                                style={{ flex: `0 0 calc(${camPct}% - 6px)` }}
                                draggable={isScanLayoutEditMode}
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  setDraggedScanItem({ group: 'scanActionOrder', id: 'camera_btn' });
                                }}
                                onDragOver={(e) => isScanLayoutEditMode && e.preventDefault()}
                                onDrop={(e) => {
                                  e.stopPropagation();
                                  handleScanElementDrop('scanActionOrder', 'camera_btn');
                                }}
                                className={`w-full ${isScanLayoutEditMode ? 'p-1 rounded-2xl border-2 border-dashed border-indigo-400 cursor-grab' : ''}`}
                              >
                                <button
                                  type="button"
                                  disabled={isScanningOmr}
                                  onClick={() => !isScanLayoutEditMode && cameraInputRef.current?.click()}
                                  style={{
                                    minHeight: `${systemBranding.scanBtnHeightPx || 62}px`,
                                    fontSize: `${systemBranding.scanBtnTextSizePx || 15}px`,
                                    borderRadius: `${systemBranding.scanBtnRadiusPx || 16}px`
                                  }}
                                  className="w-full px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-black shadow-lg flex items-center justify-center gap-3 active:scale-[0.99] transition-all"
                                >
                                  <Camera className="w-6 h-6 shrink-0" />
                                  <span>
                                    {isScanningOmr
                                      ? `${t.scanningText} (${omrScanProgress.current}/${omrScanProgress.total})...`
                                      : t.cameraBtn}
                                  </span>
                                </button>
                              </div>
                            );
                          }

                          return (
                            <div
                              key="gallery_btn"
                              style={{ flex: `0 0 calc(${galPct}% - 6px)` }}
                              draggable={isScanLayoutEditMode}
                              onDragStart={(e) => {
                                e.stopPropagation();
                                setDraggedScanItem({ group: 'scanActionOrder', id: 'gallery_btn' });
                              }}
                              onDragOver={(e) => isScanLayoutEditMode && e.preventDefault()}
                              onDrop={(e) => {
                                e.stopPropagation();
                                handleScanElementDrop('scanActionOrder', 'gallery_btn');
                              }}
                              className={`w-full ${isScanLayoutEditMode ? 'p-1 rounded-2xl border-2 border-dashed border-slate-400 cursor-grab' : ''}`}
                            >
                              <button
                                type="button"
                                disabled={isScanningOmr}
                                onClick={() => !isScanLayoutEditMode && galleryInputRef.current?.click()}
                                style={{
                                  minHeight: `${systemBranding.scanBtnHeightPx || 62}px`,
                                  fontSize: `${systemBranding.scanBtnTextSizePx || 15}px`,
                                  borderRadius: `${systemBranding.scanBtnRadiusPx || 16}px`
                                }}
                                className="w-full px-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-extrabold shadow-md flex items-center justify-center gap-2.5 transition-all"
                              >
                                <Upload className="w-5 h-5 text-amber-400 shrink-0" />
                                <span>{t.galleryBtn}</span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* THẺ KẾT QUẢ BÀI VỪA CHẤM XONG */}
                {latestOmrResult && (
                  <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[11px] font-extrabold">
                            {t.justGradedBadge}
                          </span>
                          <span className="text-xs font-bold text-slate-500">
                            {t.graderLabel} {safeText(latestOmrResult.gradedBy)}
                          </span>
                        </div>
                        <h3 className="text-lg font-black text-slate-900 mt-1">
                          {safeText(latestOmrResult.studentName)} — {t.classWord} {safeText(latestOmrResult.className)}
                        </h3>
                        <p className="text-xs text-slate-500">
                          {safeText(latestOmrResult.schoolName)} • {safeText(latestOmrResult.sectionBreakdown)}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right bg-indigo-50 px-4 py-2 rounded-2xl border border-indigo-200">
                          <div className="text-2xl font-black text-indigo-700">
                            {safeText(latestOmrResult.score)}{' '}
                            <span className="text-xs font-bold text-indigo-400">/ {safeText(currentProfile.maxScore)}</span>
                          </div>
                          <div className="text-[11px] font-extrabold text-amber-700">
                            {safeText(latestOmrResult.shields || computeCambridgeShields(latestOmrResult.correctCount, latestOmrResult.totalQuestions))}/5 Cambridge Shields
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => openReviewModal(latestOmrResult.id)}
                          className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
                          title="Xem ảnh gốc & Sửa"
                        >
                          <Eye className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[380px] overflow-y-auto pr-1">
                      {(latestOmrResult.questions || []).map((q, qIdx) => (
                        <div
                          key={qIdx}
                          className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-2 text-xs ${
                            q.isCorrect
                              ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                              : 'bg-rose-50/80 border-rose-200 text-rose-950'
                          }`}
                        >
                          <div className="min-w-0">
                            <span className="font-extrabold">{safeText(q.questionNumber)}:</span>{' '}
                            <span className="font-mono font-bold">{safeText(q.studentAnswer)}</span>
                            {!q.isCorrect && (
                              <span className="ml-1.5 text-[11px] font-bold text-emerald-700">
                                ({t.correctWord}: {safeText(q.correctAnswer)})
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => updateStudentQuestionField(latestOmrResult.id, qIdx, null, !q.isCorrect)}
                            className={`px-2 py-0.5 rounded font-extrabold text-[10px] shrink-0 ${
                              q.isCorrect ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                            }`}
                          >
                            {q.isCorrect ? '✓' : '✗'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SUB-TAB B: PHIẾU IN THI (A4/A5 PDF) & CẤU HÌNH ĐÁP ÁN */}
            {omrSubTab === 'key' && (
              <div className="bg-white rounded-3xl border border-slate-200 p-4 sm:p-6 shadow-sm space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
                  <div>
                    <h2 className="text-base sm:text-lg font-black text-slate-900">
                      {t.sheetHeaderHeading} — {safeText(currentProfile.gradeName)}
                    </h2>
                    <p className="text-xs text-slate-500">
                      {t.sheetSubHeading} {currentTotalQuestionsCount} {t.questionsUnit.toLowerCase()}
                    </p>
                  </div>

                  {/* Chọn khổ A4 / A5 + Tải PDF + In Phiếu */}
                  {hasPermission('canPrintSheet') && (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="bg-slate-100 p-1 rounded-xl flex items-center border border-slate-200 text-xs font-extrabold">
                        <button
                          type="button"
                          onClick={() => setPaperSize('A4')}
                          className={`px-2.5 py-1 rounded-lg ${
                            paperSize === 'A4' ? 'bg-indigo-600 text-white' : 'text-slate-600'
                          }`}
                        >
                          {t.paperA4}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaperSize('A5')}
                          className={`px-2.5 py-1 rounded-lg ${
                            paperSize === 'A5' ? 'bg-indigo-600 text-white' : 'text-slate-600'
                          }`}
                        >
                          {t.paperA5}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={downloadPrintablePdfSheet}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-xs"
                      >
                        <Download className="w-4 h-4" />
                        <span>{t.downloadPdfBtn} ({paperSize})</span>
                      </button>

                      <button
                        type="button"
                        onClick={printPrintableHybridSheet}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow-xs"
                      >
                        <Printer className="w-4 h-4" />
                        <span>{t.printSheetBtn}</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Bảng chỉnh sửa nhanh đáp án từng Part */}
                <div className="space-y-3">
                  {(currentProfile.parts || []).map((part, pIdx) => (
                    <div key={part.id || pIdx} className="rounded-2xl border border-slate-200 overflow-hidden">
                      <div className="bg-slate-100 px-3.5 py-2 flex items-center justify-between text-xs font-extrabold text-slate-800">
                        <span>{safeText(part.title)}</span>
                        <span className="px-2 py-0.5 rounded bg-white border border-slate-300 text-[10px]">
                          {safeText(part.skill)}
                        </span>
                      </div>

                      {part.type === 'draw_lines' && Array.isArray(part.targets) && part.targets.length > 0 && (
                        <div className="px-3.5 py-2 bg-amber-50/70 border-b border-slate-200 text-[11px] text-slate-700 flex flex-wrap gap-2">
                          {part.targets.map((tg, tgIdx) => (
                            <span key={tg?.code || tgIdx} className="px-2 py-0.5 rounded bg-white border border-amber-200">
                              <strong>[{safeText(tg?.code)}]</strong> {safeText(tg?.label)}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 bg-white">
                        {(part.items || []).map((it, iIdx) => {
                          const rawOpts =
                            Array.isArray(part.options) && part.options.length > 0
                              ? part.options
                              : part.type === 'listen_colour'
                                ? ['RED', 'GREEN', 'BLUE', 'YELLOW']
                                : part.type === 'yes_no'
                                  ? ['YES', 'NO']
                                  : part.type === 'tick_cross'
                                    ? ['✓', '✗']
                                    : part.type === 'draw_lines'
                                      ? (Array.isArray(part.targets) && part.targets.length > 0 ? part.targets.map(t => t.code) : ['A', 'B', 'C', 'D', 'E'])
                                      : part.type === 'matching_ag'
                                        ? ['A', 'B', 'C', 'D', 'E', 'F', 'G']
                                        : ['A', 'B', 'C'];
                          const opts = rawOpts.map(o => safeText(o));

                          const isTextInput = part.type === 'text_blank';

                          return (
                            <div
                              key={iIdx}
                              className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/60"
                            >
                              <div className="min-w-0">
                                <span className="text-xs font-extrabold text-slate-800">Q{safeText(it.q)}</span>
                                {it.prompt && (
                                  <span className="ml-1.5 text-[11px] font-bold text-indigo-700">
                                    ({safeText(it.prompt)})
                                  </span>
                                )}
                              </div>

                              {isTextInput ? (
                                <input
                                  type="text"
                                  disabled={!hasPermission('canManageExams')}
                                  value={safeText(it.ans)}
                                  onChange={(e) => updateCurrentPartItemAnswer(pIdx, iIdx, e.target.value)}
                                  className="w-32 px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-mono font-bold text-indigo-700"
                                />
                              ) : (
                                <div className="flex flex-wrap items-center gap-1">
                                  {opts.map(opt => (
                                    <button
                                      key={opt}
                                      type="button"
                                      disabled={!hasPermission('canManageExams')}
                                      onClick={() => updateCurrentPartItemAnswer(pIdx, iIdx, opt)}
                                      className={`px-2 h-7 min-w-[28px] rounded-full font-extrabold text-[10px] transition-all ${
                                        safeText(it.ans).toUpperCase() === opt.toUpperCase()
                                          ? 'bg-indigo-600 text-white shadow-xs'
                                          : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100'
                                      }`}
                                    >
                                      {opt}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Nạp lại file đề 9 trang bằng AI cho khối hiện tại */}
                {hasPermission('canManageExams') && (
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-black text-slate-800 uppercase">
                        {t.uploadKeyTitle}
                      </span>
                      <input
                        ref={currentKeyUploadRef}
                        type="file"
                        accept=".pdf,image/*"
                        onChange={handleCurrentProfileSourceUpload}
                        className="hidden"
                      />
                      <button
                        type="button"
                        disabled={isAnalyzingKey}
                        onClick={() => currentKeyUploadRef.current?.click()}
                        className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold flex items-center gap-1.5"
                      >
                        <Upload className="w-4 h-4" />
                        <span>{isAnalyzingKey ? t.analyzingBtn : t.uploadKeyBtn}</span>
                      </button>
                    </div>

                    <textarea
                      rows={4}
                      value={currentProfile.answerKeyText || ''}
                      onChange={(e) => updateCurrentProfileField('answerKeyText', e.target.value)}
                      className="w-full p-3 rounded-xl border border-slate-300 bg-white font-mono text-xs"
                    />

                    <button
                      type="button"
                      disabled={isAnalyzingKey}
                      onClick={handleAnalyzeCurrentTextToParts}
                      className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold flex items-center gap-1.5"
                    >
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <span>{t.reparseTextBtn}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* SUB-TAB C: BẢNG ĐIỂM & KHO DỮ LIỆU ĐA GIÁO VIÊN */}
            {omrSubTab === 'list' && (() => {
              const uniqueSchools = Array.from(new Set(currentProfileResults.map(r => safeText(r.schoolName)).filter(Boolean)));
              const uniqueClasses = Array.from(new Set(currentProfileResults.map(r => safeText(r.className)).filter(Boolean)));
              const uniqueTeachers = Array.from(new Set(currentProfileResults.map(r => safeText(r.gradedBy)).filter(Boolean)));

              const filteredResults = currentProfileResults.filter(st => {
                const sName = safeText(st.studentName);
                const cName = safeText(st.className);
                const scName = safeText(st.schoolName);
                const gBy = safeText(st.gradedBy);
                const matchSearch =
                  sName.toLowerCase().includes(omrSearchQuery.toLowerCase()) ||
                  cName.toLowerCase().includes(omrSearchQuery.toLowerCase()) ||
                  scName.toLowerCase().includes(omrSearchQuery.toLowerCase());
                const matchSchool = filterSchool === 'ALL' || scName === filterSchool;
                const matchClass = filterClass === 'ALL' || cName === filterClass;
                const matchTeacher = filterTeacher === 'ALL' || gBy === filterTeacher;
                return matchSearch && matchSchool && matchClass && matchTeacher;
              });

              return (
                <div className="bg-white rounded-3xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-black text-slate-900">
                        {t.scoreboardHeading} {safeText(currentProfile.gradeName)} ({filteredResults.length}/{currentProfileResults.length} {t.examsCountLabel})
                      </h2>
                      <p className="text-xs text-slate-500">
                        {t.avgScoreLabel} <strong className="text-indigo-600">{classStatistics.avgScore}</strong> / {safeText(currentProfile.maxScore)} • {t.passRateLabel} <strong>{classStatistics.passRate}%</strong>
                      </p>
                    </div>

                    {hasPermission('canViewExport') && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={exportCurrentProfileExcel}
                          disabled={currentProfileResults.length === 0}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-extrabold shadow-xs"
                        >
                          <Download className="w-4 h-4" />
                          <span>Excel {currentProfile.gradeName}</span>
                        </button>
                        <button
                          type="button"
                          onClick={exportAllGradesExcel}
                          disabled={allResults.length === 0}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-extrabold"
                        >
                          <Building2 className="w-4 h-4" />
                          <span>{t.allSchoolsBtn} ({allResults.length})</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Bộ lọc đa chiều */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder={t.searchStudentPlaceholder}
                        value={omrSearchQuery}
                        onChange={(e) => setOmrSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-xs"
                      />
                    </div>
                    <select
                      value={filterSchool}
                      onChange={(e) => setFilterSchool(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold"
                    >
                      <option value="ALL">{t.allSchoolsFilter} ({uniqueSchools.length})</option>
                      {uniqueSchools.map(sc => (
                        <option key={sc} value={sc}>{sc}</option>
                      ))}
                    </select>
                    <select
                      value={filterClass}
                      onChange={(e) => setFilterClass(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold"
                    >
                      <option value="ALL">{t.allClassesFilter} ({uniqueClasses.length})</option>
                      {uniqueClasses.map(cl => (
                        <option key={cl} value={cl}>{t.classWord} {cl}</option>
                      ))}
                    </select>
                    <select
                      value={filterTeacher}
                      onChange={(e) => setFilterTeacher(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold"
                    >
                      <option value="ALL">{t.allExaminersFilter} ({uniqueTeachers.length})</option>
                      {uniqueTeachers.map(tc => (
                        <option key={tc} value={tc}>{tc}</option>
                      ))}
                    </select>
                  </div>

                  {filteredResults.length === 0 ? (
                    <div className="py-10 text-center text-xs text-slate-500">
                      {t.emptyResultsText} <strong>{safeText(currentProfile.gradeName)}</strong>.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredResults.map((st, idx) => (
                        <div
                          key={st.id || idx}
                          onClick={() => openReviewModal(st.id)}
                          className="p-3.5 rounded-2xl border border-slate-200 hover:border-indigo-300 bg-slate-50/60 hover:bg-indigo-50/30 flex items-center justify-between gap-3 cursor-pointer transition-all"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-bold text-slate-400">#{filteredResults.length - idx}</span>
                              <span className="font-black text-slate-900 truncate">{safeText(st.studentName)}</span>
                              <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                                {safeText(st.shields || computeCambridgeShields(st.correctCount, st.totalQuestions))} Shields
                              </span>
                              {st.gradedBy && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">
                                  {safeText(st.gradedBy)}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5 truncate">
                              {t.classWord}: <strong>{safeText(st.className)}</strong> • {t.reviewSchool}: {safeText(st.schoolName)} • {safeText(st.sectionBreakdown)}
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5 shrink-0">
                            <div className="text-right">
                              <div className="text-base font-black text-indigo-600">
                                {safeText(st.score)} <span className="text-xs font-normal text-slate-400">{t.ptsUnit}</span>
                              </div>
                              <div className="text-[11px] font-bold text-slate-500">
                                {safeText(st.correctCount)}/{safeText(st.totalQuestions)} {t.correctShort}
                              </div>
                            </div>
                            {hasPermission('canDeleteResults') && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteStudentResult(st.id);
                                }}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                            <ChevronRight className="w-5 h-5 text-slate-400" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ) : (
          /* ================================================================= */
          /* CHẾ ĐỘ 2: CHẤM PDF HÀNG LOẠT CẢ LỚP (NHIỀU TRANG / HỌC SINH)      */
          /* ================================================================= */
          <div className="space-y-4">
            <div className="flex gap-2 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-xs">
              <button
                type="button"
                onClick={() => setPdfBatchTab('upload')}
                className={`flex-1 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold ${
                  pdfBatchTab === 'upload' ? 'bg-indigo-600 text-white' : 'text-slate-600'
                }`}
              >
                {t.batchTab1}
              </button>
              <button
                type="button"
                onClick={() => setPdfBatchTab('results')}
                className={`flex-1 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold ${
                  pdfBatchTab === 'results' ? 'bg-indigo-600 text-white' : 'text-slate-600'
                }`}
              >
                {t.batchTab2} ({currentProfileResults.length})
              </button>
            </div>

            {pdfBatchTab === 'upload' ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base sm:text-lg font-black text-slate-900">
                      {safeText(t.batchHeading)} — {safeText(currentProfile.gradeName)}
                    </h2>
                    <p className="text-xs text-slate-500">
                      {safeText(t.batchSub)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-bold text-slate-600">{t.pagesPerStudentLabel}</span>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={currentProfile.pagesPerStudent}
                      onChange={(e) => updateCurrentProfileField('pagesPerStudent', Number(e.target.value) || 1)}
                      className="w-16 px-2.5 py-1.5 rounded-xl border border-slate-300 font-black text-center"
                    />
                  </div>
                </div>

                <div className="border-2 border-dashed border-indigo-300 rounded-2xl p-6 text-center bg-indigo-50/40 space-y-3">
                  <input
                    ref={batchPdfInputRef}
                    type="file"
                    accept=".pdf"
                    onChange={handleBatchPdfUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={isRenderingPdf || !hasPermission('canGrade')}
                    onClick={() => batchPdfInputRef.current?.click()}
                    className="px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-sm shadow-md inline-flex items-center gap-2"
                  >
                    <Upload className="w-5 h-5" />
                    <span>{isRenderingPdf ? t.splittingPdfText : t.chooseClassPdfBtn}</span>
                  </button>

                  {pdfFileName && (
                    <div className="text-xs font-bold text-indigo-900">
                      File: {pdfFileName} • {pdfPageImages.length} pages →{' '}
                      <span className="text-emerald-700 font-black">{studentBatches.length} {t.studentsUnit}</span>
                    </div>
                  )}
                </div>

                {studentBatches.length > 0 && (
                  <button
                    type="button"
                    disabled={isGradingBatch}
                    onClick={startBatchGrading}
                    className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm shadow-lg flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-5 h-5" />
                    <span>
                      {isGradingBatch
                        ? `${t.scanningText} ${batchProgress.current}/${batchProgress.total}...`
                        : `${t.startBatchBtn} (${studentBatches.length} ${t.studentsUnit})`}
                    </span>
                  </button>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-black text-base text-slate-900">
                    {t.scoreboardHeading} ({currentProfileResults.length} {t.examsCountLabel})
                  </h3>
                  {hasPermission('canViewExport') && (
                    <button
                      type="button"
                      onClick={exportCurrentProfileExcel}
                      disabled={currentProfileResults.length === 0}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center gap-1.5"
                    >
                      <Download className="w-4 h-4" />
                      <span>{t.exportExcelBtn}</span>
                    </button>
                  )}
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder={t.searchFullPlaceholder}
                    value={batchSearchQuery}
                    onChange={(e) => setBatchSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                </div>

                <div className="space-y-2">
                  {currentProfileResults
                    .filter(s => safeText(s.studentName).toLowerCase().includes(batchSearchQuery.toLowerCase()))
                    .map((st, idx) => (
                      <div
                        key={st.id || idx}
                        onClick={() => openReviewModal(st.id)}
                        className="p-3.5 rounded-2xl border border-slate-200 hover:border-indigo-300 flex items-center justify-between gap-3 cursor-pointer"
                      >
                        <div>
                          <div className="font-black text-slate-900 text-sm">
                            #{idx + 1}. {safeText(st.studentName)} — {safeText(st.className)}
                          </div>
                          <div className="text-xs text-slate-500">
                            {safeText(st.schoolName)} • {safeText(st.sectionBreakdown)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-base font-black text-indigo-600">{safeText(st.score)} đ</div>
                          <div className="text-[11px] font-bold text-slate-500">
                            {safeText(st.correctCount)}/{safeText(st.totalQuestions)} câu
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}