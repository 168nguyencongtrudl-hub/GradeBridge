import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Eye,
  Flashlight,
  Pause,
  Play,
  RefreshCw,
  ScanLine,
  Sparkles,
  Upload,
  Volume2,
  VolumeX
} from 'lucide-react';
import { apiRequest } from '../utils/api';
import {
  checkHybridAnswerMatch,
  compressImageFile,
  computeCambridgeShields,
  renderAnswerSheetToCanvas
} from '../utils/grading';
import type { ExamProfile, StudentResult, SystemBranding, UiLang } from '../types';

type ScannerPhase = 'idle' | 'searching' | 'locking' | 'grading' | 'graded_hold' | 'retry_hint';

interface OmrScanViewProps {
  currentProfile: ExamProfile;
  currentProfileResults: StudentResult[];
  latestResult: StudentResult | null;
  branding: SystemBranding;
  paperSize: 'A4' | 'A5';
  teacherName: string;
  canGrade: boolean;
  lang: UiLang;
  onSaveResult: (
    record: StudentResult,
    overwriteDuplicate?: boolean
  ) => Promise<{ record: StudentResult; wasUpdated: boolean }>;
  onUpdateMeta: (
    studentId: string,
    field: 'studentName' | 'className' | 'schoolName',
    value: string
  ) => Promise<void>;
  onUpdateQuestion: (
    studentId: string,
    qIdx: number,
    newStudentAns: string | null,
    forceCorrect: boolean | null
  ) => Promise<void>;
  onOpenReview: (studentId: string) => void;
  onSelectLatestId: (id: string) => void;
  onNotify: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

function playSuccessChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(660, now);
    osc1.frequency.setValueAtTime(880, now + 0.08);
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 350);
  } catch {
    // AudioContext blocked or unavailable
  }
}

function analyzeFrameLuma(imageData: ImageData, width: number, height: number) {
  const data = imageData.data;
  const totalPixels = width * height;
  const luma = new Uint8Array(totalPixels);
  let lumaSum = 0;
  let brightCount = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const y = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    luma[p] = y;
    lumaSum += y;
    if (y > 130) brightCount++;
  }

  let gradSum = 0;
  let gradSamples = 0;
  for (let row = 2; row < height - 2; row += 2) {
    const rowOffset = row * width;
    for (let col = 2; col < width - 2; col += 2) {
      const idx = rowOffset + col;
      const gx = Math.abs(luma[idx + 1] - luma[idx - 1]);
      const gy = Math.abs(luma[idx + width] - luma[idx - width]);
      gradSum += gx + gy;
      gradSamples++;
    }
  }

  return {
    luma,
    meanLuma: lumaSum / Math.max(1, totalPixels),
    brightRatio: brightCount / Math.max(1, totalPixels),
    edgeEnergy: gradSum / Math.max(1, gradSamples)
  };
}

function meanAbsDiff(a: Uint8Array | null, b: Uint8Array | null): number {
  if (!a || !b || a.length !== b.length) return 999;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / a.length;
}

export function OmrScanView({
  currentProfile,
  currentProfileResults,
  latestResult,
  branding,
  paperSize,
  teacherName,
  canGrade,
  lang,
  onSaveResult,
  onUpdateMeta,
  onUpdateQuestion,
  onOpenReview,
  onSelectLatestId,
  onNotify
}: OmrScanViewProps) {
  const isEn = lang === 'en';
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Live Camera refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Computer vision & state machine refs (avoid stale closures in interval)
  const prevLumaRef = useRef<Uint8Array | null>(null);
  const gradedLumaRef = useRef<Uint8Array | null>(null);
  const steadyFramesRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const phaseRef = useRef<ScannerPhase>('idle');
  const retryUntilRef = useRef<number>(0);

  // UI states
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [scannerPhase, setScannerPhase] = useState<ScannerPhase>('idle');
  const [lockProgress, setLockProgress] = useState(0);
  const [hudMessage, setHudMessage] = useState('');
  const [lastHudResult, setLastHudResult] = useState<StudentResult | null>(null);
  const [sessionScanCount, setSessionScanCount] = useState(0);

  // Optional default School & Class fallback (scanned values on sheet ALWAYS take precedence)
  const [defaultSchool, setDefaultSchool] = useState(currentProfile.schoolName || '');
  const [defaultClass, setDefaultClass] = useState(currentProfile.classLabel || '');

  useEffect(() => {
    setDefaultSchool(currentProfile.schoolName || '');
    setDefaultClass(currentProfile.classLabel || '');
  }, [currentProfile.id, currentProfile.schoolName, currentProfile.classLabel]);

  // Batch gallery / demo progress
  const [isBatchScanning, setIsBatchScanning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });

  const setPhaseSync = useCallback((next: ScannerPhase) => {
    phaseRef.current = next;
    setScannerPhase(next);
  }, []);

  // Precompute flat schema for current exam profile
  const examSchema = useMemo(() => {
    const partsConfig = currentProfile.parts || [];
    const flatItems: Array<{
      q: number;
      prompt: string;
      correctAns: string;
      partTitle: string;
      skill: string;
      partType: ExamProfile['parts'][number]['type'];
    }> = [];

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

    const schemaDescription = partsConfig
      .map(p => {
        if (p.type === 'draw_lines') {
          const nameList = (p.items || []).map(i => `Q${i.q} (${i.prompt})`).join(', ');
          const targetList = (p.targets || []).map(t => `[${t.code}] ${t.label}`).join('; ');
          return `- ${p.title} [${p.skill}] (DRAW LINES HORIZONTAL MATCHING): Top names [${nameList}] connected downward by lines to Bottom picture boxes [${targetList}]. Return target letter A/B/C/D/E.`;
        }
        const qNums = p.items.map(i => i.q).join(', ');
        const modeDesc =
          p.type === 'text_blank'
            ? 'Handwritten word or number on line'
            : p.type === 'listen_colour'
              ? `Filled/circled colour option from ${(p.options || ['RED', 'GREEN', 'BLUE', 'YELLOW']).join('/')}`
              : p.type === 'tick_cross'
                ? 'Filled/circled ✓ or ✗'
                : `Filled/circled option ${(p.options || []).join('/')}`;
        return `- ${p.title} [${p.skill}] (${modeDesc}): Questions ${qNums}`;
      })
      .join('\n');

    return {
      flatItems,
      totalQ: flatItems.length,
      maxScore: currentProfile.maxScore || 8,
      schemaDescription
    };
  }, [currentProfile]);

  // Core AI grading routine for a single captured sheet image
  const gradeSingleSheetImage = useCallback(
    async (
      compressed: { dataUrl: string; base64: string },
      options: { isLiveScan: boolean; indexOffset?: number }
    ): Promise<{ saved: boolean; record?: StudentResult; notDetectedMsg?: string }> => {
      const { flatItems, totalQ, maxScore, schemaDescription } = examSchema;

      const aiData = await apiRequest<{
        sheetDetected?: boolean;
        detectionNote?: string;
        studentName: string;
        className: string;
        schoolName: string;
        answers: Array<{ q: number; studentAnswer: string }>;
      }>('/api/ai/grade-omr', {
        method: 'POST',
        body: JSON.stringify({
          imageBase64: compressed.base64,
          examTitle: currentProfile.examTitle,
          gradeName: currentProfile.gradeName,
          totalQ,
          schemaDescription,
          isLiveScan: options.isLiveScan
        })
      });

      if (options.isLiveScan && aiData.sheetDetected === false) {
        return {
          saved: false,
          notDetectedMsg:
            aiData.detectionNote ||
            (isEn
              ? 'Answer sheet not clearly visible — align all 4 corners inside the frame.'
              : 'Chưa thấy rõ phiếu thi — hãy căn 4 góc đen vào khớp khung.')
        };
      }

      const detectedMap: Record<number, string> = {};
      (aiData.answers || []).forEach(item => {
        detectedMap[item.q] = String(item.studentAnswer || '').trim();
      });

      const questions = flatItems.map(meta => {
        const rawStudent = detectedMap[meta.q] || '';
        const displayStudent =
          rawStudent === ''
            ? '[Bỏ trống]'
            : meta.partType === 'text_blank'
              ? rawStudent
              : rawStudent.toUpperCase();

        const isCorrect = checkHybridAnswerMatch(displayStudent, meta.correctAns, meta.partType);

        return {
          questionNumber: meta.prompt ? `Q${meta.q} (${meta.prompt})` : `Q${meta.q}`,
          qNum: meta.q,
          partTitle: meta.partTitle,
          skill: meta.skill,
          partType: meta.partType,
          studentAnswer: displayStudent,
          correctAnswer: meta.correctAns,
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

      const cleanScannedName = String(aiData.studentName || '').trim();
      const cleanScannedClass = String(aiData.className || '').trim();
      const cleanScannedSchool = String(aiData.schoolName || '').trim();

      const resolvedName =
        cleanScannedName && cleanScannedName.toLowerCase() !== 'chưa rõ'
          ? cleanScannedName
          : `${isEn ? 'Student' : 'Học sinh'} #${currentProfileResults.length + (options.indexOffset || 0) + 1}`;

      const resolvedClass =
        cleanScannedClass && cleanScannedClass.toLowerCase() !== 'chưa rõ'
          ? cleanScannedClass
          : defaultClass.trim() || currentProfile.gradeName;

      const resolvedSchool =
        cleanScannedSchool && cleanScannedSchool.toLowerCase() !== 'chưa rõ'
          ? cleanScannedSchool
          : defaultSchool.trim() || (isEn ? 'Unspecified School' : 'Chưa rõ trường');

      const newRecord: StudentResult = {
        id: `omr-${Date.now()}-${options.indexOffset || 0}`,
        profileId: currentProfile.id,
        gradeName: currentProfile.gradeName,
        examTitle: currentProfile.examTitle,
        gradedBy: teacherName.trim() || 'Giáo viên',
        createdAt: Date.now(),
        stt: currentProfileResults.length + (options.indexOffset || 0) + 1,
        pageRange: options.isLiveScan ? 'Live Auto-Scan (9->1)' : '1-Page Sheet (9->1)',
        pages: [{ pageNum: 1, dataUrl: compressed.dataUrl }],
        studentName: resolvedName,
        className: resolvedClass,
        schoolName: resolvedSchool,
        listeningScore: `${listeningCorrect}/${listeningQs.length}`,
        rwScore: `${rwCorrect}/${rwQs.length}`,
        shields,
        sectionBreakdown: `Listening ${listeningCorrect}/${listeningQs.length} · R&W ${rwCorrect}/${rwQs.length} · ${shields}/5 Shields`,
        teacherNote: `${shields}/5 Shields`,
        questions,
        correctCount,
        totalQuestions: totalQ,
        score,
        reviewed: true,
        status: 'completed'
      };

      const { record, wasUpdated } = await onSaveResult(newRecord, true);
      onSelectLatestId(record.id);
      if (soundEnabled) playSuccessChime();
      setSessionScanCount(c => c + 1);

      onNotify(
        wasUpdated
          ? `${isEn ? 'Updated' : 'Đã cập nhật'}: ${record.studentName} · ${record.schoolName} · ${record.className} — ${record.score}/${maxScore}`
          : `${isEn ? 'Saved' : 'Đã lưu'}: ${record.studentName} · ${record.schoolName} · ${record.className} — ${record.score}/${maxScore}`,
        'success'
      );

      return { saved: true, record };
    },
    [
      currentProfile,
      currentProfileResults.length,
      defaultClass,
      defaultSchool,
      examSchema,
      isEn,
      onNotify,
      onSaveResult,
      onSelectLatestId,
      soundEnabled,
      teacherName
    ]
  );

  // Compute exact source crop rectangle in video pixel coordinates matching the visible guide frame
  const getGuideCropRect = useCallback((bleedRatio = 0.03) => {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (!guide) {
      return { sx: 0, sy: 0, sw: vw, sh: vh };
    }

    const vRect = video.getBoundingClientRect();
    const gRect = guide.getBoundingClientRect();
    if (!vRect.width || !vRect.height || !gRect.width || !gRect.height) {
      return { sx: 0, sy: 0, sw: vw, sh: vh };
    }

    const vidAspect = vw / vh;
    const elemAspect = vRect.width / vRect.height;

    let scale: number;
    let offsetX = 0;
    let offsetY = 0;

    if (vidAspect > elemAspect) {
      scale = vRect.height / vh;
      offsetX = (vw * scale - vRect.width) / 2;
    } else {
      scale = vRect.width / vw;
      offsetY = (vh * scale - vRect.height) / 2;
    }

    let sx = (gRect.left - vRect.left + offsetX) / scale;
    let sy = (gRect.top - vRect.top + offsetY) / scale;
    let sw = gRect.width / scale;
    let sh = gRect.height / scale;

    if (bleedRatio > 0) {
      const padX = sw * bleedRatio;
      const padY = sh * bleedRatio;
      sx -= padX;
      sy -= padY;
      sw += padX * 2;
      sh += padY * 2;
    }

    sx = Math.max(0, Math.min(vw - 10, sx));
    sy = Math.max(0, Math.min(vh - 10, sy));
    sw = Math.max(10, Math.min(vw - sx, sw));
    sh = Math.max(10, Math.min(vh - sy, sh));

    return { sx, sy, sw, sh };
  }, []);

  // Capture high-res JPEG strictly from inside the alignment frame
  const captureFrameFromGuide = useCallback((): {
    dataUrl: string;
    base64: string;
    fingerprint: Uint8Array | null;
  } | null => {
    const video = videoRef.current;
    const crop = getGuideCropRect(0.035);
    if (!video || !crop) return null;

    if (!captureCanvasRef.current) {
      captureCanvasRef.current = document.createElement('canvas');
    }
    const maxW = 1400;
    const outScale = crop.sw > maxW ? maxW / crop.sw : 1;
    const outW = Math.round(crop.sw * outScale);
    const outH = Math.round(crop.sh * outScale);

    const cap = captureCanvasRef.current;
    cap.width = outW;
    cap.height = outH;
    const ctx = cap.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, outW, outH);

    const dataUrl = cap.toDataURL('image/jpeg', 0.87);
    const base64 = dataUrl.split(',')[1] || '';

    // Also compute compact fingerprint so we know when the sheet is swapped
    if (!analysisCanvasRef.current) {
      analysisCanvasRef.current = document.createElement('canvas');
      analysisCanvasRef.current.width = 90;
      analysisCanvasRef.current.height = 128;
    }
    const ac = analysisCanvasRef.current;
    const actx = ac.getContext('2d', { willReadFrequently: true });
    let fingerprint: Uint8Array | null = null;
    if (actx) {
      actx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, ac.width, ac.height);
      const imgData = actx.getImageData(0, 0, ac.width, ac.height);
      fingerprint = analyzeFrameLuma(imgData, ac.width, ac.height).luma;
    }

    return { dataUrl, base64, fingerprint };
  }, [getGuideCropRect]);

  // Execute live scan on current guide frame (auto or manual trigger)
  const triggerLiveFrameGrade = useCallback(
    async (manual = false) => {
      if (inFlightRef.current || !cameraActive) return;
      const captured = captureFrameFromGuide();
      if (!captured || !captured.base64) return;

      inFlightRef.current = true;
      setPhaseSync('grading');
      setLockProgress(100);
      setHudMessage(
        isEn
          ? 'Locked · Reading Name, School, Class & grading...'
          : 'Đã khóa khung · Đang đọc Tên, Trường, Lớp & chấm điểm...'
      );

      try {
        const res = await gradeSingleSheetImage(
          { dataUrl: captured.dataUrl, base64: captured.base64 },
          { isLiveScan: true }
        );

        if (!res.saved) {
          setPhaseSync('retry_hint');
          setLockProgress(0);
          steadyFramesRef.current = 0;
          retryUntilRef.current = Date.now() + 2200;
          setHudMessage(
            res.notDetectedMsg ||
              (isEn
                ? 'Hold the answer sheet clearly inside the frame.'
                : 'Chưa nhận rõ phiếu thi — vui lòng căn phiếu khớp 4 góc khung.')
          );
          if (manual) {
            onNotify(
              res.notDetectedMsg ||
                (isEn ? 'Could not read answer sheet clearly in frame.' : 'Chưa thấy rõ phiếu thi trong khung.'),
              'warning'
            );
          }
        } else if (res.record) {
          gradedLumaRef.current = captured.fingerprint;
          prevLumaRef.current = captured.fingerprint;
          steadyFramesRef.current = 0;
          setLastHudResult(res.record);
          setPhaseSync('graded_hold');
          setHudMessage(
            isEn
              ? 'Graded & saved · Slide in the next sheet to continue automatically'
              : 'Đã chấm & lưu · Đưa phiếu tiếp theo vào khung để tự động chấm tiếp'
          );
        }
      } catch (err: any) {
        setPhaseSync('retry_hint');
        setLockProgress(0);
        steadyFramesRef.current = 0;
        retryUntilRef.current = Date.now() + 2600;
        const msg = err?.message || (isEn ? 'Scan failed, retrying...' : 'Lỗi kết nối AI, đang sẵn sàng quét lại...');
        setHudMessage(msg);
        onNotify(msg, 'error');
      } finally {
        inFlightRef.current = false;
      }
    },
    [cameraActive, captureFrameFromGuide, gradeSingleSheetImage, isEn, onNotify, setPhaseSync]
  );

  // Stop live camera stream safely
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setTorchOn(false);
    setTorchSupported(false);
    setPhaseSync('idle');
    setLockProgress(0);
    setHudMessage('');
    prevLumaRef.current = null;
    gradedLumaRef.current = null;
    steadyFramesRef.current = 0;
    inFlightRef.current = false;
  }, [setPhaseSync]);

  // Start live camera stream
  const startCamera = useCallback(
    async (requestedFacing: 'environment' | 'user' = facingMode) => {
      if (!canGrade) return;
      setCameraError('');
      stopCamera();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(
          isEn
            ? 'Your browser does not support live camera access. Please upload images from gallery instead.'
            : 'Trình duyệt hiện tại không hỗ trợ mở camera trực tiếp. Bạn có thể chọn ảnh từ thư viện bên cạnh.'
        );
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: requestedFacing },
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            },
            audio: false
          });
        } catch {
          // Fallback to any available webcam if exact facingMode constraint fails (e.g., laptop webcam)
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        streamRef.current = stream;
        setFacingMode(requestedFacing);
        setCameraActive(true);
        setPhaseSync('searching');
        setLastHudResult(null);
        setHudMessage(
          isEn
            ? 'Place the answer sheet inside the frame — auto-grades when steady'
            : 'Đưa phiếu thi vào khớp 4 góc khung — tự động chấm khi giữ yên'
        );

        // Check flashlight / torch capability
        const track = stream.getVideoTracks()[0];
        if (track && typeof track.getCapabilities === 'function') {
          const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
          setTorchSupported(Boolean(caps?.torch));
        }
      } catch (err: any) {
        const denied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
        setCameraError(
          denied
            ? isEn
              ? 'Camera permission was denied. Please allow camera access in browser settings and try again.'
              : 'Trình duyệt đã chặn quyền Camera. Vui lòng cấp quyền Camera trên thanh địa chỉ rồi mở lại.'
            : isEn
              ? `Could not access camera (${err?.message || 'Unknown error'}).`
              : `Không thể mở camera (${err?.message || 'Kiểm tra thiết bị camera'}).`
        );
      }
    },
    [canGrade, facingMode, isEn, setPhaseSync, stopCamera]
  );

  // Bind stream to <video> whenever cameraActive becomes true
  useEffect(() => {
    const video = videoRef.current;
    if (cameraActive && video && streamRef.current) {
      video.srcObject = streamRef.current;
      video.play().catch(() => {});
    }
  }, [cameraActive]);

  // Clean up camera on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Toggle flashlight
  const handleToggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet]
      });
      setTorchOn(next);
    } catch {
      onNotify(isEn ? 'Flashlight not supported on this lens.' : 'Thiết bị không hỗ trợ bật đèn flash.', 'warning');
    }
  };

  // Real-time continuous frame monitor (every 260ms)
  useEffect(() => {
    if (!cameraActive || !autoScanEnabled) return;

    if (!analysisCanvasRef.current) {
      analysisCanvasRef.current = document.createElement('canvas');
      analysisCanvasRef.current.width = 90;
      analysisCanvasRef.current.height = 128;
    }

    const timer = window.setInterval(() => {
      if (inFlightRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      const crop = getGuideCropRect(0);
      if (!crop) return;

      const ac = analysisCanvasRef.current!;
      const ctx = ac.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, ac.width, ac.height);
      const imgData = ctx.getImageData(0, 0, ac.width, ac.height);
      const metrics = analyzeFrameLuma(imgData, ac.width, ac.height);
      const motion = meanAbsDiff(prevLumaRef.current, metrics.luma);
      prevLumaRef.current = metrics.luma;

      // Respect temporary retry hint cooldown
      if (phaseRef.current === 'retry_hint') {
        if (Date.now() < retryUntilRef.current) return;
        setPhaseSync('searching');
        setHudMessage(
          isEn
            ? 'Align the answer sheet inside the frame...'
            : 'Đưa phiếu thi vào khớp 4 góc khung...'
        );
      }

      // If we just graded a sheet, stay on result HUD until the teacher swaps to a different sheet
      if (phaseRef.current === 'graded_hold') {
        const diffFromGraded = meanAbsDiff(gradedLumaRef.current, metrics.luma);
        if (diffFromGraded > 20) {
          gradedLumaRef.current = null;
          steadyFramesRef.current = 0;
          setLastHudResult(null);
          setLockProgress(0);
          setPhaseSync('searching');
          setHudMessage(
            isEn
              ? 'New sheet detected — hold steady inside the frame...'
              : 'Đã nhận diện phiếu mới — giữ yên trong khung để tự chấm...'
          );
        }
        return;
      }

      // Document-in-frame heuristic: bright white sheet + visible printed ink edges
      const sheetLooksPresent =
        metrics.meanLuma >= 82 && metrics.brightRatio >= 0.34 && metrics.edgeEnergy >= 6.2;

      if (!sheetLooksPresent) {
        steadyFramesRef.current = 0;
        setLockProgress(0);
        if (phaseRef.current !== 'searching') {
          setPhaseSync('searching');
        }
        setHudMessage(
          metrics.meanLuma < 82
            ? isEn
              ? 'Too dark — move to brighter light or turn on flash'
              : 'Ánh sáng yếu — đưa vào nơi sáng hơn hoặc bật đèn flash'
            : isEn
              ? 'Place the answer sheet inside the 4 corner brackets'
              : 'Đưa phiếu thi vào khớp 4 góc khung để tự động chấm'
        );
        return;
      }

      // Check camera steadiness
      if (motion < 11.5) {
        steadyFramesRef.current += 1;
        const pct = Math.min(100, Math.round((steadyFramesRef.current / 3) * 100));
        setLockProgress(pct);
        if (phaseRef.current !== 'locking') {
          setPhaseSync('locking');
        }
        setHudMessage(
          isEn ? 'Sheet aligned · Hold steady...' : 'Đã nhận diện phiếu · Giữ yên tay...'
        );

        if (steadyFramesRef.current >= 3) {
          steadyFramesRef.current = 0;
          void triggerLiveFrameGrade(false);
        }
      } else {
        steadyFramesRef.current = Math.max(0, steadyFramesRef.current - 1);
        setLockProgress(Math.round((steadyFramesRef.current / 3) * 100));
        setPhaseSync('searching');
        setHudMessage(
          isEn ? 'Hold camera steady over the sheet...' : 'Giữ chắc tay để khung tự động khóa...'
        );
      }
    }, 260);

    return () => window.clearInterval(timer);
  }, [autoScanEnabled, cameraActive, getGuideCropRect, isEn, setPhaseSync, triggerLiveFrameGrade]);

  // Reset hold manually to scan the next paper immediately
  const handleArmNextSheet = () => {
    gradedLumaRef.current = null;
    steadyFramesRef.current = 0;
    setLastHudResult(null);
    setLockProgress(0);
    setPhaseSync('searching');
    setHudMessage(
      isEn
        ? 'Ready · Place the next answer sheet in frame'
        : 'Sẵn sàng · Đưa phiếu thi tiếp theo vào khung'
    );
  };

  // Secondary flow: Upload existing images from gallery or run demo sheet
  const processGalleryImages = async (sources: Array<File | string>) => {
    if (!sources.length) return;
    setIsBatchScanning(true);
    setBatchProgress({ current: 0, total: sources.length });

    for (let i = 0; i < sources.length; i++) {
      setBatchProgress({ current: i + 1, total: sources.length });
      try {
        const compressed = await compressImageFile(sources[i], 1450, 0.86);
        await gradeSingleSheetImage(compressed, { isLiveScan: false, indexOffset: i });
      } catch (err: any) {
        onNotify(`${isEn ? 'Grading error' : 'Lỗi chấm phiếu'} #${i + 1}: ${err?.message || ''}`, 'error');
      }
    }

    setIsBatchScanning(false);
  };

  const handleRunDemo = async () => {
    const canvas = await renderAnswerSheetToCanvas(currentProfile, paperSize, true, branding);
    await processGalleryImages([canvas.toDataURL('image/jpeg', 0.9)]);
  };

  const frameAccentClass =
    scannerPhase === 'graded_hold'
      ? 'border-emerald-400'
      : scannerPhase === 'grading'
        ? 'border-indigo-400'
        : scannerPhase === 'locking'
          ? 'border-amber-400'
          : scannerPhase === 'retry_hint'
            ? 'border-rose-400'
            : 'border-white/90';

  const recentResults = currentProfileResults.slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <div className="bg-white border border-neutral-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs text-slate-500">
            {currentProfile.schoolName && (
              <>
                <span className="font-medium text-slate-700">{currentProfile.schoolName}</span>
                <span className="mx-1.5">·</span>
              </>
            )}
            <span>
              {currentProfile.gradeName}
              {currentProfile.classLabel ? ` (${currentProfile.classLabel})` : ''}
            </span>
            <span className="mx-1.5">·</span>
            <span className="tabular-nums">
              {examSchema.totalQ} {isEn ? 'questions' : 'câu'}
            </span>
            <span className="mx-1.5">·</span>
            <span className="tabular-nums">
              {isEn ? 'Scale' : 'Thang'} {currentProfile.maxScore}
            </span>
            {sessionScanCount > 0 && (
              <>
                <span className="mx-1.5">·</span>
                <span className="text-emerald-700 font-medium tabular-nums">
                  {sessionScanCount} {isEn ? 'scanned this session' : 'phiếu đã quét phiên này'}
                </span>
              </>
            )}
          </div>
          <h2 className="mt-0.5 text-lg font-bold text-slate-900">
            {isEn ? 'Live Auto-Scan Camera Grader' : 'Quét Camera Tự Động Chấm Phiếu Thi'}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {isEn
              ? 'Hold the camera over the answer sheet inside the frame — automatically reads Name, School, Class & grades instantly.'
              : 'Đưa camera soi trực tiếp phiếu thi vào trong khung — tự động quét Họ tên, Trường, Lớp, chấm điểm và lưu ngay.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={e => {
              const files = Array.from(e.target.files || []);
              if (files.length) processGalleryImages(files);
              e.target.value = '';
            }}
            className="hidden"
          />

          <button
            type="button"
            disabled={isBatchScanning || !canGrade}
            onClick={() => galleryInputRef.current?.click()}
            className="px-3 py-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50 text-xs font-medium text-slate-700 flex items-center gap-1.5 whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>
              {isBatchScanning
                ? `${isEn ? 'Grading' : 'Đang chấm'} (${batchProgress.current}/${batchProgress.total})`
                : isEn
                  ? 'Upload Images'
                  : 'Chọn ảnh có sẵn'}
            </span>
          </button>

          <button
            type="button"
            disabled={isBatchScanning || !canGrade}
            onClick={handleRunDemo}
            className="px-3 py-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50 text-xs font-medium text-slate-700 flex items-center gap-1.5 whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            <span>{isEn ? 'Run Sample' : 'Thử phiếu mẫu'}</span>
          </button>
        </div>
      </div>

      {!canGrade ? (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-800">
          {isEn
            ? 'Your account does not have grading permission.'
            : 'Tài khoản của bạn chưa được quản trị viên cấp quyền chấm bài.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT COLUMN (7/12): LIVE CAMERA VIEWFINDER WITH ALIGNMENT FRAME */}
          <div className="lg:col-span-7 bg-white border border-neutral-200 rounded-xl overflow-hidden">
            {/* Scanner Toolbar */}
            <div className="px-4 py-3 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {!cameraActive ? (
                  <button
                    type="button"
                    onClick={() => startCamera('environment')}
                    className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-2 whitespace-nowrap transition-colors"
                  >
                    <Camera className="w-4 h-4" />
                    <span>{isEn ? 'Start Live Scanner' : 'Bật Camera quét tự động'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="px-3.5 py-2 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <CameraOff className="w-3.5 h-3.5" />
                    <span>{isEn ? 'Stop Camera' : 'Tắt Camera'}</span>
                  </button>
                )}

                {cameraActive && (
                  <button
                    type="button"
                    onClick={() => setAutoScanEnabled(prev => !prev)}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                      autoScanEnabled
                        ? 'border-neutral-200 bg-neutral-50 text-slate-800 hover:bg-neutral-100'
                        : 'border-amber-300 bg-amber-50 text-amber-900'
                    }`}
                  >
                    {autoScanEnabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    <span>
                      {autoScanEnabled
                        ? isEn
                          ? 'Auto-Scan On'
                          : 'Tự động quét: Bật'
                        : isEn
                          ? 'Auto-Scan Paused'
                          : 'Tạm dừng tự quét'}
                    </span>
                  </button>
                )}
              </div>

              {cameraActive && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => startCamera(facingMode === 'environment' ? 'user' : 'environment')}
                    className="p-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-slate-600"
                    title={isEn ? 'Switch camera' : 'Đổi camera trước / sau'}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>

                  {torchSupported && (
                    <button
                      type="button"
                      onClick={handleToggleTorch}
                      className={`p-2 rounded-lg border transition-colors ${
                        torchOn
                          ? 'border-amber-300 bg-amber-50 text-amber-700'
                          : 'border-neutral-200 hover:bg-neutral-50 text-slate-600'
                      }`}
                      title={isEn ? 'Toggle flashlight' : 'Bật / tắt đèn flash'}
                    >
                      <Flashlight className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setSoundEnabled(prev => !prev)}
                    className="p-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-slate-600"
                    title={isEn ? 'Toggle sound chime' : 'Bật / tắt âm báo khi lưu'}
                  >
                    {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}
            </div>

            {/* Live Camera Stage */}
            <div className="relative bg-slate-950 aspect-[3/4] sm:aspect-[4/4.6] max-h-[640px] w-full overflow-hidden flex items-center justify-center">
              {cameraActive ? (
                <>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className="absolute inset-0 w-full h-full object-cover"
                  />

                  {/* Subtle Vignette Scrim around Guide Box */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-5 sm:p-8">
                    <div
                      ref={guideRef}
                      className="relative h-full max-h-[540px] aspect-[1/1.414] max-w-full rounded-lg shadow-[0_0_0_9999px_rgba(2,6,23,0.52)]"
                    >
                      {/* 4 Corner Alignment Brackets (matching 4 black sheet markers) */}
                      <span
                        className={`absolute -top-0.5 -left-0.5 w-8 h-8 border-t-[3.5px] border-l-[3.5px] rounded-tl-md transition-colors duration-150 ${frameAccentClass}`}
                      />
                      <span
                        className={`absolute -top-0.5 -right-0.5 w-8 h-8 border-t-[3.5px] border-r-[3.5px] rounded-tr-md transition-colors duration-150 ${frameAccentClass}`}
                      />
                      <span
                        className={`absolute -bottom-0.5 -left-0.5 w-8 h-8 border-b-[3.5px] border-l-[3.5px] rounded-bl-md transition-colors duration-150 ${frameAccentClass}`}
                      />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-8 h-8 border-b-[3.5px] border-r-[3.5px] rounded-br-md transition-colors duration-150 ${frameAccentClass}`}
                      />

                      {/* Inner Hairline Sheet Border */}
                      <div className="absolute inset-1.5 border border-white/25 rounded-sm" />

                      {/* Header Identity Target Strip Hint (Name · School · Class) */}
                      <div className="absolute top-[9%] left-[5%] right-[5%] h-[10%] border border-dashed border-white/55 rounded-sm flex items-center justify-center bg-slate-950/20">
                        <span className="text-[10px] font-medium text-white/90 tracking-tight px-2 truncate">
                          {isEn ? 'Name · School · Class Zone' : 'Vùng quét Họ tên · Trường · Lớp'}
                        </span>
                      </div>

                      {/* Animated Active Scan Line while Locking or Grading */}
                      {(scannerPhase === 'locking' || scannerPhase === 'grading') && (
                        <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-0.5 bg-emerald-400/90 shadow-[0_0_12px_rgba(52,211,153,0.9)] animate-pulse" />
                      )}

                      {/* Stability Lock Progress Bar */}
                      {scannerPhase === 'locking' && lockProgress > 0 && (
                        <div className="absolute left-4 right-4 bottom-4 h-1.5 bg-slate-900/60 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-400 transition-all duration-150"
                            style={{ width: `${lockProgress}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Top Status Bar Overlay */}
                  <div className="absolute top-3 inset-x-3 flex items-center justify-center pointer-events-none">
                    <div className="px-3.5 py-2 rounded-lg bg-slate-950/80 backdrop-blur-xs border border-white/15 text-xs font-medium text-white text-center max-w-[92%]">
                      {hudMessage}
                    </div>
                  </div>

                  {/* Instant Graded HUD Card Overlay (shows Name, School, Class, Score immediately on camera) */}
                  {scannerPhase === 'graded_hold' && lastHudResult && (
                    <div className="absolute inset-x-3 bottom-16 bg-slate-950/90 backdrop-blur-xs border border-emerald-400/50 rounded-xl p-3.5 text-white shadow-lg">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-0.5">
                          <div className="text-[11px] text-emerald-300 font-semibold flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span>{isEn ? 'Auto-graded & saved' : 'Đã tự động chấm & lưu kết quả'}</span>
                          </div>
                          <div className="text-sm font-bold truncate">{lastHudResult.studentName}</div>
                          <div className="text-xs text-slate-300 truncate">
                            {lastHudResult.schoolName} · {isEn ? 'Class' : 'Lớp'} {lastHudResult.className}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-2xl font-bold text-emerald-400 tabular-nums leading-none">
                            {lastHudResult.score}
                            <span className="text-xs font-normal text-slate-400">/{currentProfile.maxScore}</span>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-300 tabular-nums">
                            {lastHudResult.correctCount}/{lastHudResult.totalQuestions} · {lastHudResult.shields}/5 Shields
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Bottom Camera Controls Bar */}
                  <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2">
                    {scannerPhase === 'graded_hold' ? (
                      <button
                        type="button"
                        onClick={handleArmNextSheet}
                        className="flex-1 py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                      >
                        <ScanLine className="w-4 h-4" />
                        <span>{isEn ? 'Scan Next Sheet Now' : 'Quét phiếu tiếp theo ngay'}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={scannerPhase === 'grading'}
                        onClick={() => triggerLiveFrameGrade(true)}
                        className="flex-1 py-2.5 px-4 rounded-lg bg-white/95 hover:bg-white disabled:bg-white/50 text-slate-900 text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                      >
                        <ScanLine className="w-4 h-4" />
                        <span>
                          {scannerPhase === 'grading'
                            ? isEn
                              ? 'Grading frame...'
                              : 'Đang chấm khung hình...'
                            : isEn
                              ? 'Scan Frame Now'
                              : 'Quét ngay trong khung'}
                        </span>
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="p-8 text-center max-w-sm space-y-4">
                  <div className="w-12 h-12 mx-auto rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-white">
                    <ScanLine className="w-6 h-6" />
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="text-sm font-semibold text-white">
                      {isEn ? 'Hands-Free Live Sheet Scanner' : 'Quét phiếu thi trực tiếp qua khung Camera'}
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {isEn
                        ? 'No manual shutter needed. Align the 4 black corners of the 1-page sheet inside the viewfinder — AI automatically reads Student Name, School, Class and saves the score.'
                        : 'Không cần bấm chụp. Chỉ cần đưa phiếu thi vào khớp 4 góc khung camera, hệ thống tự nhận diện Họ tên, Trường, Lớp, chấm điểm và lưu ngay vào bảng kết quả.'}
                    </p>
                  </div>

                  {cameraError && (
                    <div className="p-3 rounded-lg bg-rose-950/90 border border-rose-500/40 text-xs text-rose-100 text-left">
                      {cameraError}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => startCamera('environment')}
                    className="w-full py-3 px-4 rounded-lg bg-white hover:bg-neutral-100 text-slate-900 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                  >
                    <Camera className="w-4 h-4" />
                    <span>{isEn ? 'Open Live Camera Frame' : 'Mở khung quét Camera ngay'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Quiet Optional Fallback Row (School / Class preset if blank on paper) */}
            <div className="px-4 py-3 border-t border-neutral-200 bg-neutral-50/70 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  {isEn ? 'Fallback School (used only if blank on sheet)' : 'Trường mặc định (nếu phiếu bỏ trống)'}
                </label>
                <input
                  type="text"
                  value={defaultSchool}
                  onChange={e => setDefaultSchool(e.target.value)}
                  placeholder={isEn ? 'e.g. Nguyen Binh Khiem Primary' : 'VD: Tiểu học Nguyễn Bỉnh Khiêm'}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white text-slate-900 focus:outline-none focus:border-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  {isEn ? 'Fallback Class (used only if blank on sheet)' : 'Lớp mặc định (nếu phiếu bỏ trống)'}
                </label>
                <input
                  type="text"
                  value={defaultClass}
                  onChange={e => setDefaultClass(e.target.value)}
                  placeholder={isEn ? 'e.g. 2A1' : 'VD: 2A1'}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white text-slate-900 focus:outline-none focus:border-slate-900"
                />
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN (5/12): SAVED RESULT VERIFICATION & RECENT SCAN FEED */}
          <div className="lg:col-span-5 space-y-5">
            {latestResult ? (
              <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-neutral-200 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-emerald-700 font-medium">
                      {isEn ? 'Latest saved scan' : 'Kết quả vừa quét & lưu'} · {latestResult.gradedBy}
                    </div>
                    <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">
                      {latestResult.score}
                      <span className="text-sm font-normal text-slate-400"> / {currentProfile.maxScore}</span>
                    </div>
                    <div className="text-xs text-slate-500 tabular-nums mt-0.5">
                      {latestResult.correctCount}/{latestResult.totalQuestions} {isEn ? 'correct' : 'câu đúng'} ·{' '}
                      <span className="text-amber-700 font-medium">
                        {latestResult.shields ||
                          computeCambridgeShields(latestResult.correctCount, latestResult.totalQuestions)}
                        /5 Shields
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpenReview(latestResult.id)}
                    className="px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-xs font-medium text-slate-700 flex items-center gap-1.5 shrink-0"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{isEn ? 'Inspect' : 'Xem ảnh'}</span>
                  </button>
                </div>

                {/* Scanned Identity Fields (Name, School, Class) — Saved & Directly Editable */}
                <div className="p-4 border-b border-neutral-200 bg-neutral-50/60 space-y-2.5 text-xs">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      {isEn ? 'Student Name' : 'Họ và tên học sinh'}
                    </label>
                    <input
                      type="text"
                      value={latestResult.studentName}
                      onChange={e => onUpdateMeta(latestResult.id, 'studentName', e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-neutral-200 bg-white font-semibold text-slate-900 focus:outline-none focus:border-slate-900"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">
                        {isEn ? 'School' : 'Trường'}
                      </label>
                      <input
                        type="text"
                        value={latestResult.schoolName}
                        onChange={e => onUpdateMeta(latestResult.id, 'schoolName', e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-neutral-200 bg-white font-medium text-slate-900 focus:outline-none focus:border-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">
                        {isEn ? 'Class' : 'Lớp'}
                      </label>
                      <input
                        type="text"
                        value={latestResult.className}
                        onChange={e => onUpdateMeta(latestResult.id, 'className', e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-neutral-200 bg-white font-medium text-slate-900 focus:outline-none focus:border-slate-900"
                      />
                    </div>
                  </div>
                </div>

                {/* Question Breakdown */}
                <div className="p-4 space-y-1.5 max-h-[300px] overflow-y-auto">
                  {(latestResult.questions || []).map((q, qIdx) => (
                    <div
                      key={qIdx}
                      className="px-3 py-1.5 rounded-lg border border-neutral-200 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 truncate">
                        <span className="font-semibold text-slate-900">{q.questionNumber}:</span>{' '}
                        <span className="font-mono text-slate-700">{q.studentAnswer}</span>
                        {!q.isCorrect && (
                          <span className="ml-1.5 text-emerald-700 font-medium">({q.correctAnswer})</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onUpdateQuestion(latestResult.id, qIdx, null, !q.isCorrect)}
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold shrink-0 transition-colors ${
                          q.isCorrect
                            ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                            : 'text-rose-700 bg-rose-50 hover:bg-rose-100'
                        }`}
                      >
                        {q.isCorrect ? (isEn ? 'Correct' : 'Đúng') : isEn ? 'Wrong' : 'Sai'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-white border border-neutral-200 rounded-xl p-6 text-center space-y-1.5">
                <div className="text-sm font-semibold text-slate-900">
                  {isEn ? 'No scanned sheets yet' : 'Chưa có bài quét nào'}
                </div>
                <p className="text-xs text-slate-500">
                  {isEn
                    ? 'Open the live camera frame on the left or run a sample sheet to see Name, School, Class, and Score saved here.'
                    : 'Mở khung quét Camera bên trái hoặc nhấn "Thử phiếu mẫu" — Họ tên, Trường, Lớp và Điểm sẽ hiển thị và lưu tự động tại đây.'}
                </p>
              </div>
            )}

            {/* Recent Saved Scans List */}
            {recentResults.length > 0 && (
              <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-900">
                    {isEn ? 'Recently saved results' : 'Danh sách bài vừa lưu'}
                  </span>
                  <span className="text-slate-500 tabular-nums">
                    {currentProfileResults.length} {isEn ? 'total' : 'bài'}
                  </span>
                </div>
                <div className="divide-y divide-neutral-200">
                  {recentResults.map(st => {
                    const isSelected = latestResult?.id === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => onSelectLatestId(st.id)}
                        className={`w-full px-4 py-2.5 text-left flex items-center justify-between gap-3 text-xs transition-colors ${
                          isSelected ? 'bg-neutral-50' : 'hover:bg-neutral-50/70'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate">{st.studentName}</div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {st.schoolName} · {isEn ? 'Class' : 'Lớp'} {st.className}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono font-bold text-slate-900 tabular-nums">
                            {st.score}/{currentProfile.maxScore}
                          </div>
                          <div className="text-[11px] text-slate-400 tabular-nums">
                            {st.correctCount}/{st.totalQuestions}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
