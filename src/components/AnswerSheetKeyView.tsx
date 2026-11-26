import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Crop,
  Download,
  Eye,
  FileCheck2,
  FileText,
  ImagePlus,
  Printer,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { apiRequest } from '../utils/api';
import {
  applyAiImageCropsToParts,
  compressThumbnailFile,
  cropNormalizedBoxFromBase64,
  downloadPrintablePdfSheet,
  fileToBase64Images,
  renderAnswerSheetToCanvas
} from '../utils/grading';
import type { ExamPart, ExamProfile, NormalizedCropBox, SystemBranding, UiLang } from '../types';

interface AnswerSheetKeyViewProps {
  currentProfile: ExamProfile;
  branding: SystemBranding;
  paperSize: 'A4' | 'A5';
  onChangePaperSize: (size: 'A4' | 'A5') => void;
  canPrintSheet: boolean;
  canManageExams: boolean;
  lang: UiLang;
  onSaveProfile: (profile: ExamProfile) => Promise<void>;
  onSelectProfile?: (id: string) => void;
  onNotify: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

type ImageSlotRef =
  | { kind: 'scene'; partIdx: number; label: string }
  | { kind: 'target'; partIdx: number; targetIdx: number; label: string }
  | { kind: 'item'; partIdx: number; itemIdx: number; label: string };

const COLOUR_SWATCH_MAP: Record<string, string> = {
  RED: '#dc2626',
  GREEN: '#16a34a',
  BLUE: '#2563eb',
  YELLOW: '#eab308',
  PINK: '#ec4899',
  ORANGE: '#ea580c',
  PURPLE: '#9333ea',
  BROWN: '#92400e',
  BLACK: '#0f172a',
  WHITE: '#ffffff',
  GREY: '#64748b',
  GRAY: '#64748b'
};

function countEmbeddedImages(parts: ExamPart[]): number {
  let count = 0;
  for (const p of parts || []) {
    if (p.sceneImageDataUrl) count += 1;
    for (const tg of p.targets || []) {
      if (tg.imageDataUrl) count += 1;
    }
    for (const it of p.items || []) {
      if (it.imageDataUrl) count += 1;
    }
  }
  return count;
}

function InlineCommitInput({
  value,
  disabled,
  placeholder,
  className,
  onCommit
}: {
  value: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== value) {
      onCommit(trimmed);
    }
  };

  return (
    <input
      type="text"
      disabled={disabled}
      value={draft}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
}

interface CropFromExamModalProps {
  slotLabel: string;
  isScene: boolean;
  blankPages: string[];
  keyPages: string[];
  lang: UiLang;
  onLoadExamPages: (source: 'blank' | 'key', file: File) => Promise<void>;
  onConfirmCrop: (dataUrl: string) => Promise<void>;
  onClose: () => void;
  onNotify: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

function CropFromExamModal({
  slotLabel,
  isScene,
  blankPages,
  keyPages,
  lang,
  onLoadExamPages,
  onConfirmCrop,
  onClose,
  onNotify
}: CropFromExamModalProps) {
  const isEn = lang === 'en';
  const [sourceTab, setSourceTab] = useState<'blank' | 'key'>(blankPages.length > 0 ? 'blank' : 'key');
  const [pageIdx, setPageIdx] = useState(0);
  const [isApplying, setIsApplying] = useState(false);
  const [isLoadingQuickFile, setIsLoadingQuickFile] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const quickUploadRef = useRef<HTMLInputElement>(null);

  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  const activePages = sourceTab === 'blank' ? blankPages : keyPages;

  useEffect(() => {
    if (sourceTab === 'blank' && blankPages.length === 0 && keyPages.length > 0) {
      setSourceTab('key');
      setPageIdx(0);
    } else if (sourceTab === 'key' && keyPages.length === 0 && blankPages.length > 0) {
      setSourceTab('blank');
      setPageIdx(0);
    }
  }, [blankPages.length, keyPages.length, sourceTab]);

  useEffect(() => {
    if (pageIdx >= activePages.length && activePages.length > 0) {
      setPageIdx(0);
    }
    setSelection(null);
    setDragStart(null);
  }, [pageIdx, activePages.length, sourceTab]);

  const getRelativePoint = (clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const pt = getRelativePoint(e.clientX, e.clientY);
    if (!pt) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragStart(pt);
    setSelection({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const pt = getRelativePoint(e.clientX, e.clientY);
    if (!pt) return;
    setSelection({
      x1: Math.min(dragStart.x, pt.x),
      y1: Math.min(dragStart.y, pt.y),
      x2: Math.max(dragStart.x, pt.x),
      y2: Math.max(dragStart.y, pt.y)
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStart) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if not captured
      }
      setDragStart(null);
    }
  };

  const hasValidSelection =
    selection && selection.x2 - selection.x1 > 0.025 && selection.y2 - selection.y1 > 0.025;

  const handleConfirm = async () => {
    const currentBase64 = activePages[pageIdx];
    if (!currentBase64 || !selection || !hasValidSelection) {
      onNotify(
        isEn ? 'Drag a rectangle over the picture you want to crop.' : 'Hãy kéo chuột khoanh vùng hình ảnh cần cắt trên trang đề.',
        'warning'
      );
      return;
    }

    setIsApplying(true);
    try {
      const box: NormalizedCropBox = {
        source: sourceTab,
        pageIndex: pageIdx,
        xmin: Math.round(selection.x1 * 1000),
        ymin: Math.round(selection.y1 * 1000),
        xmax: Math.round(selection.x2 * 1000),
        ymax: Math.round(selection.y2 * 1000)
      };
      const croppedDataUrl = await cropNormalizedBoxFromBase64(
        currentBase64,
        box,
        isScene ? 640 : 280,
        0.84
      );
      if (!croppedDataUrl) {
        throw new Error(isEn ? 'Could not crop selected area.' : 'Không thể cắt vùng ảnh đã chọn.');
      }
      await onConfirmCrop(croppedDataUrl);
      onClose();
    } catch (err: any) {
      onNotify(err?.message || 'Lỗi cắt ảnh từ trang đề.', 'error');
    } finally {
      setIsApplying(false);
    }
  };

  const handleQuickUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoadingQuickFile(true);
    try {
      await onLoadExamPages('blank', file);
      setSourceTab('blank');
      setPageIdx(0);
    } finally {
      setIsLoadingQuickFile(false);
      e.target.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white border border-neutral-200 rounded-2xl max-w-4xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-xl">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-neutral-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-slate-500">
              {isEn ? 'Drag a box over the exam picture to attach' : 'Kéo chuột khoanh vùng hình trên trang đề để gắn vào phiếu in'}
            </div>
            <h3 className="text-sm font-bold text-slate-900 truncate">
              {isEn ? 'Crop Image for:' : 'Cắt hình cho:'} {slotLabel}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-neutral-100 hover:text-slate-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Controls Bar */}
        <div className="px-5 py-2.5 bg-neutral-50 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex p-0.5 rounded-lg bg-white border border-neutral-200 font-medium">
              <button
                type="button"
                disabled={blankPages.length === 0}
                onClick={() => {
                  setSourceTab('blank');
                  setPageIdx(0);
                }}
                className={`px-2.5 py-1 rounded-md transition-colors disabled:opacity-40 ${
                  sourceTab === 'blank' ? 'bg-slate-900 text-white' : 'text-slate-600'
                }`}
              >
                {isEn ? 'Blank Exam' : 'Đề trắng'} ({blankPages.length})
              </button>
              <button
                type="button"
                disabled={keyPages.length === 0}
                onClick={() => {
                  setSourceTab('key');
                  setPageIdx(0);
                }}
                className={`px-2.5 py-1 rounded-md transition-colors disabled:opacity-40 ${
                  sourceTab === 'key' ? 'bg-slate-900 text-white' : 'text-slate-600'
                }`}
              >
                {isEn ? 'Answer Key' : 'Đề đáp án'} ({keyPages.length})
              </button>
            </div>

            {activePages.length > 1 && (
              <div className="flex items-center gap-1 flex-wrap">
                {activePages.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setPageIdx(idx)}
                    className={`px-2 py-1 rounded-md border text-[11px] font-mono font-semibold ${
                      pageIdx === idx
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-neutral-200 hover:bg-neutral-100'
                    }`}
                  >
                    {isEn ? 'P' : 'Tr'} {idx + 1}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={quickUploadRef}
              type="file"
              accept=".pdf,image/*"
              onChange={handleQuickUpload}
              className="hidden"
            />
            <button
              type="button"
              disabled={isLoadingQuickFile}
              onClick={() => quickUploadRef.current?.click()}
              className="px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-slate-800 font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>
                {isLoadingQuickFile
                  ? isEn
                    ? 'Loading...'
                    : 'Đang nạp...'
                  : isEn
                    ? 'Load PDF / Image'
                    : 'Nạp tệp đề để cắt'}
              </span>
            </button>
          </div>
        </div>

        {/* Canvas Workspace */}
        <div className="flex-1 overflow-auto bg-neutral-100 p-4 flex items-center justify-center min-h-[340px]">
          {activePages[pageIdx] ? (
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="relative inline-block select-none touch-none cursor-crosshair shadow-sm bg-white border border-neutral-300"
            >
              <img
                ref={imgRef}
                src={`data:image/jpeg;base64,${activePages[pageIdx]}`}
                alt={`Exam page ${pageIdx + 1}`}
                draggable={false}
                className="block max-h-[60vh] max-w-full w-auto h-auto pointer-events-none"
              />

              {selection && (
                <div
                  style={{
                    left: `${selection.x1 * 100}%`,
                    top: `${selection.y1 * 100}%`,
                    width: `${Math.max(0.5, (selection.x2 - selection.x1) * 100)}%`,
                    height: `${Math.max(0.5, (selection.y2 - selection.y1) * 100)}%`
                  }}
                  className="absolute border-2 border-indigo-600 bg-indigo-500/15 pointer-events-none"
                />
              )}
            </div>
          ) : (
            <div className="text-center max-w-sm space-y-3 py-10">
              <div className="text-sm font-semibold text-slate-800">
                {isEn ? 'No exam pages loaded yet' : 'Chưa có trang đề nào được nạp trong phiên này'}
              </div>
              <p className="text-xs text-slate-500">
                {isEn
                  ? 'Upload the blank student exam PDF or image now so you can crop pictures directly onto the answer sheet.'
                  : 'Hãy nạp nhanh tệp PDF/ảnh đề trắng ở nút phía trên hoặc ngay bên dưới để khoanh vùng cắt hình.'}
              </p>
              <button
                type="button"
                disabled={isLoadingQuickFile}
                onClick={() => quickUploadRef.current?.click()}
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{isEn ? 'Upload Blank Exam PDF / Image' : 'Chọn tệp PDF / ảnh đề trắng'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-neutral-200 flex items-center justify-between gap-3 bg-white text-xs">
          <span className="text-slate-500">
            {hasValidSelection
              ? isEn
                ? 'Selection ready — click "Attach Cropped Image" to save to sheet.'
                : 'Đã chọn vùng ảnh — bấm "Gắn ảnh đã cắt" để đưa ngay vào phiếu in.'
              : isEn
                ? 'Tip: Click and drag over any character or object on the page.'
                : 'Mẹo: Nhấn giữ và kéo chuột bao quanh nhân vật hoặc đồ vật cần đưa lên phiếu in.'}
          </span>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-slate-700 font-medium"
            >
              {isEn ? 'Cancel' : 'Hủy'}
            </button>
            <button
              type="button"
              disabled={!hasValidSelection || isApplying}
              onClick={handleConfirm}
              className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Crop className="w-3.5 h-3.5" />
              <span>
                {isApplying
                  ? isEn
                    ? 'Attaching...'
                    : 'Đang gắn...'
                  : isEn
                    ? 'Attach Cropped Image'
                    : 'Gắn ảnh đã cắt'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AnswerSheetKeyView({
  currentProfile,
  branding,
  paperSize,
  onChangePaperSize,
  canPrintSheet,
  canManageExams,
  lang,
  onSaveProfile,
  onSelectProfile,
  onNotify
}: AnswerSheetKeyViewProps) {
  const isEn = lang === 'en';
  const blankFileInputRef = useRef<HTMLInputElement>(null);
  const keyFileInputRef = useRef<HTMLInputElement>(null);
  const slotUploadInputRef = useRef<HTMLInputElement>(null);

  const [blankFileName, setBlankFileName] = useState('');
  const [blankExamImages, setBlankExamImages] = useState<string[]>([]);
  const [keyFileName, setKeyFileName] = useState('');
  const [answerKeyImages, setAnswerKeyImages] = useState<string[]>([]);
  const [isLoadingFile, setIsLoadingFile] = useState<'blank' | 'key' | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExtractingImages, setIsExtractingImages] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState('');
  const [isRenderingPreview, setIsRenderingPreview] = useState(false);

  const [pendingUploadSlot, setPendingUploadSlot] = useState<ImageSlotRef | null>(null);
  const [cropModalSlot, setCropModalSlot] = useState<ImageSlotRef | null>(null);

  const [draftSchool, setDraftSchool] = useState(currentProfile.schoolName || '');
  const [draftGrade, setDraftGrade] = useState(currentProfile.gradeName || '');
  const [draftClass, setDraftClass] = useState(currentProfile.classLabel || '');

  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [showCloneForm, setShowCloneForm] = useState(false);
  const [cloneSchool, setCloneSchool] = useState(currentProfile.schoolName || '');
  const [cloneGrade, setCloneGrade] = useState(currentProfile.gradeName || '');
  const [cloneClass, setCloneClass] = useState('');
  const [cloneTitle, setCloneTitle] = useState(currentProfile.examTitle || '');

  useEffect(() => {
    setDraftSchool(currentProfile.schoolName || '');
    setDraftGrade(currentProfile.gradeName || '');
    setDraftClass(currentProfile.classLabel || '');
    setCloneSchool(currentProfile.schoolName || '');
    setCloneGrade(currentProfile.gradeName || '');
    setCloneClass('');
    setCloneTitle(currentProfile.examTitle || '');
  }, [
    currentProfile.id,
    currentProfile.schoolName,
    currentProfile.gradeName,
    currentProfile.classLabel,
    currentProfile.examTitle
  ]);

  useEffect(() => {
    if (!showPreview) {
      setPreviewDataUrl('');
      return;
    }
    let cancelled = false;
    setIsRenderingPreview(true);
    void (async () => {
      try {
        const canvas = await renderAnswerSheetToCanvas(currentProfile, paperSize, false, branding);
        if (!cancelled) {
          setPreviewDataUrl(canvas.toDataURL('image/jpeg', 0.88));
        }
      } catch (err: any) {
        if (!cancelled) {
          onNotify(err?.message || 'Lỗi dựng ảnh xem trước phiếu.', 'error');
        }
      } finally {
        if (!cancelled) {
          setIsRenderingPreview(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showPreview, currentProfile, paperSize, branding, onNotify]);

  const commitScopeMeta = () => {
    const nextSchool = draftSchool.trim();
    const nextGrade = draftGrade.trim() || currentProfile.gradeName;
    const nextClass = draftClass.trim();
    if (
      nextSchool === (currentProfile.schoolName || '') &&
      nextGrade === currentProfile.gradeName &&
      nextClass === (currentProfile.classLabel || '')
    ) {
      return;
    }
    onSaveProfile({
      ...currentProfile,
      schoolName: nextSchool,
      gradeName: nextGrade,
      classLabel: nextClass || undefined,
      updatedAt: Date.now()
    });
  };

  const totalQuestions = (currentProfile.parts || []).reduce((sum, p) => sum + (p.items?.length || 0), 0);
  const embeddedImagesCount = countEmbeddedImages(currentProfile.parts || []);

  const handleSaveAsStandardTemplate = async () => {
    setIsSavingTemplate(true);
    try {
      const updatedProfile: ExamProfile = {
        ...currentProfile,
        schoolName: draftSchool.trim() || currentProfile.schoolName,
        gradeName: draftGrade.trim() || currentProfile.gradeName,
        classLabel: draftClass.trim() || undefined,
        updatedAt: Date.now()
      };
      await onSaveProfile(updatedProfile);
      onNotify(
        isEn
          ? `Saved "${updatedProfile.gradeName}" (${embeddedImagesCount} cropped pictures, ${totalQuestions} questions) as standard shared template!`
          : `Đã lưu bộ đề "${updatedProfile.gradeName}" (gồm ${embeddedImagesCount} hình đã cắt & ${totalQuestions} câu đáp án) làm Đề mẫu chuẩn dùng chung!`,
        'success'
      );
    } catch (err: any) {
      onNotify(err?.message || 'Không thể lưu đề mẫu.', 'error');
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleCreateClonedTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetSchool = cloneSchool.trim() || currentProfile.schoolName || 'TH Nguyễn Bỉnh Khiêm';
    const targetGrade = cloneGrade.trim() || `${currentProfile.gradeName} (Bản sao)`;
    const targetClass = cloneClass.trim();
    setIsSavingTemplate(true);
    try {
      const clonedProfile: ExamProfile = {
        ...JSON.parse(JSON.stringify(currentProfile)),
        id: `profile-${Date.now()}`,
        schoolName: targetSchool,
        gradeName: targetGrade,
        classLabel: targetClass || undefined,
        examTitle: cloneTitle.trim() || currentProfile.examTitle,
        updatedAt: Date.now()
      };
      await onSaveProfile(clonedProfile);
      if (onSelectProfile) {
        onSelectProfile(clonedProfile.id);
      }
      setShowCloneForm(false);
      onNotify(
        isEn
          ? `Cloned template to "${targetSchool} · ${targetGrade}${targetClass ? ` (${targetClass})` : ''}" with all ${embeddedImagesCount} cropped images!`
          : `Đã nhân bản từ đề mẫu sang "${targetSchool} · ${targetGrade}${targetClass ? ` (Lớp ${targetClass})` : ''}" (giữ nguyên toàn bộ ${embeddedImagesCount} hình đã cắt & đáp án)!`,
        'success'
      );
    } catch (err: any) {
      onNotify(err?.message || 'Lỗi nhân bản đề mẫu.', 'error');
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handlePrintInline = async () => {
    try {
      const canvas = await renderAnswerSheetToCanvas(currentProfile, paperSize, false, branding);
      const imgData = canvas.toDataURL('image/jpeg', 0.96);
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) {
        document.body.removeChild(iframe);
        return;
      }

      const style = doc.createElement('style');
      style.textContent = `@page { size: ${paperSize} portrait; margin: 0; } body { margin: 0; display: flex; justify-content: center; } img { width: 100%; max-width: ${paperSize === 'A5' ? '148mm' : '210mm'}; height: auto; }`;
      doc.head.appendChild(style);

      const img = doc.createElement('img');
      img.src = imgData;
      img.onload = () => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }, 1200);
      };
      doc.body.appendChild(img);
    } catch (err: any) {
      onNotify(err?.message || 'Lỗi mở hộp thoại in.', 'error');
    }
  };

  const handleDownloadPdf = async () => {
    try {
      await downloadPrintablePdfSheet(currentProfile, paperSize, branding);
      onNotify(isEn ? `Downloaded ${paperSize} PDF.` : `Đã tải phiếu PDF khổ ${paperSize}.`, 'success');
    } catch (err: any) {
      onNotify(err?.message || 'Lỗi xuất tệp PDF.', 'error');
    }
  };

  const loadExamPagesFromFile = async (source: 'blank' | 'key', file: File) => {
    setIsLoadingFile(source);
    try {
      const imgs = await fileToBase64Images(file, 12);
      if (source === 'blank') {
        setBlankFileName(file.name);
        setBlankExamImages(imgs);
        onNotify(
          isEn
            ? `Loaded blank exam "${file.name}" (${imgs.length} pages).`
            : `Đã nạp tệp đề trắng "${file.name}" (${imgs.length} trang).`,
          'success'
        );
      } else {
        setKeyFileName(file.name);
        setAnswerKeyImages(imgs);
        onNotify(
          isEn
            ? `Loaded answer key "${file.name}" (${imgs.length} pages).`
            : `Đã nạp tệp đề có đáp án "${file.name}" (${imgs.length} trang).`,
          'success'
        );
      }
    } catch (err: any) {
      onNotify(err?.message || 'Lỗi đọc tệp đề thi.', 'error');
    } finally {
      setIsLoadingFile(null);
    }
  };

  const handleSelectBlankFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadExamPagesFromFile('blank', file);
    e.target.value = '';
  };

  const handleSelectKeyFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadExamPagesFromFile('key', file);
    e.target.value = '';
  };

  const handleAnalyzeExamFiles = async () => {
    const hasFiles = blankExamImages.length > 0 || answerKeyImages.length > 0;
    const hasText = Boolean(currentProfile.answerKeyText?.trim());
    if (!hasFiles && !hasText) {
      onNotify(
        isEn
          ? 'Please upload the blank exam, the answer key, or enter answer text first.'
          : 'Vui lòng nạp tệp đề trắng, tệp đề có đáp án hoặc nhập văn bản đáp án trước.',
        'warning'
      );
      return;
    }

    setIsAnalyzing(true);
    try {
      const res = await apiRequest<{
        formattedAnswerText: string;
        parts: any[];
      }>('/api/ai/deconstruct-exam', {
        method: 'POST',
        body: JSON.stringify({
          blankExamImages,
          answerKeyImages,
          answerKeyText: currentProfile.answerKeyText,
          fallbackLevel: currentProfile.examLevel
        })
      });

      const parsedParts = await applyAiImageCropsToParts(
        res.parts || [],
        blankExamImages,
        answerKeyImages
      );
      const croppedCount = countEmbeddedImages(parsedParts);

      await onSaveProfile({
        ...currentProfile,
        blankExamFileName: blankFileName || currentProfile.blankExamFileName,
        sourceFileName: keyFileName || currentProfile.sourceFileName,
        parts: parsedParts.length > 0 ? parsedParts : currentProfile.parts,
        answerKeyText: res.formattedAnswerText || currentProfile.answerKeyText,
        updatedAt: Date.now()
      });

      setShowPreview(true);
      onNotify(
        isEn
          ? `Built 1-page sheet (${parsedParts.length} parts, ${croppedCount} cropped exam pictures).`
          : `AI đã dựng phiếu 1 trang gồm ${parsedParts.length} phần và tự tách ${croppedCount} hình minh họa từ đề.`,
        'success'
      );
    } catch (err: any) {
      onNotify(err?.message || 'Lỗi AI phân tích bộ đề.', 'error');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAutoCropExamImages = async () => {
    if (blankExamImages.length === 0 && answerKeyImages.length === 0) {
      onNotify(
        isEn
          ? 'Please select the Blank Exam PDF/image first so AI can crop pictures from it.'
          : 'Vui lòng chọn tệp Đề trắng (PDF hoặc ảnh) trước để AI tự cắt hình minh họa từ đề.',
        'info'
      );
      blankFileInputRef.current?.click();
      return;
    }

    setIsExtractingImages(true);
    try {
      // Strip existing large data URLs from payload so the request is fast & compact
      const lightweightParts = (currentProfile.parts || []).map(p => ({
        title: p.title,
        skill: p.skill,
        type: p.type,
        note: p.note,
        options: p.options,
        targets: (p.targets || []).map(tg => ({ code: tg.code, label: tg.label })),
        items: (p.items || []).map(it => ({
          q: it.q,
          prompt: it.prompt,
          ans: it.ans,
          targetDesc: it.targetDesc
        }))
      }));

      const res = await apiRequest<{ parts: any[] }>('/api/ai/extract-part-images', {
        method: 'POST',
        body: JSON.stringify({
          blankExamImages,
          answerKeyImages,
          parts: lightweightParts
        })
      });

      const croppedParts = await applyAiImageCropsToParts(
        res.parts || [],
        blankExamImages,
        answerKeyImages
      );

      // Merge cropped pictures into existing parts while preserving answers & any already-attached images
      let newlyAttached = 0;
      const mergedParts: ExamPart[] = (currentProfile.parts || []).map((orig, pIdx) => {
        const aiPart = croppedParts[pIdx];
        if (!aiPart) return orig;
        const nextScene = aiPart.sceneImageDataUrl || orig.sceneImageDataUrl;
        if (aiPart.sceneImageDataUrl) newlyAttached++;

        const nextTargets = (orig.targets || []).map((tg, tIdx) => {
          const aiTg = aiPart.targets?.[tIdx];
          if (aiTg?.imageDataUrl) {
            newlyAttached++;
            return { ...tg, imageDataUrl: aiTg.imageDataUrl };
          }
          return tg;
        });

        const nextItems = (orig.items || []).map((it, iIdx) => {
          const aiIt = aiPart.items?.[iIdx];
          if (aiIt?.imageDataUrl) {
            newlyAttached++;
            return { ...it, imageDataUrl: aiIt.imageDataUrl };
          }
          return it;
        });

        return {
          ...orig,
          ...(nextScene ? { sceneImageDataUrl: nextScene } : {}),
          targets: nextTargets,
          items: nextItems
        };
      });

      await onSaveProfile({
        ...currentProfile,
        blankExamFileName: blankFileName || currentProfile.blankExamFileName,
        parts: mergedParts,
        updatedAt: Date.now()
      });

      setShowPreview(true);
      onNotify(
        newlyAttached > 0
          ? isEn
            ? `AI automatically cropped and attached ${newlyAttached} pictures from the exam.`
            : `AI đã tự động trích xuất & cắt ${newlyAttached} hình từ đề gắn vào phiếu in.`
          : isEn
            ? 'No matching illustrations found on these pages. You can still use "Crop Exam" manually.'
            : 'Không tìm thấy hình minh họa khớp trên các trang vừa nạp. Bạn có thể bấm "Cắt từ đề" để khoanh tay.',
        newlyAttached > 0 ? 'success' : 'warning'
      );
    } catch (err: any) {
      onNotify(err?.message || 'Lỗi AI tự cắt hình từ đề.', 'error');
    } finally {
      setIsExtractingImages(false);
    }
  };

  const applyImageToSlot = async (slot: ImageSlotRef, dataUrl: string | undefined) => {
    const updatedParts = (currentProfile.parts || []).map((p, idx) => {
      if (idx !== slot.partIdx) return p;
      if (slot.kind === 'scene') {
        return { ...p, sceneImageDataUrl: dataUrl };
      }
      if (slot.kind === 'target') {
        return {
          ...p,
          targets: (p.targets || []).map((tg, tIdx) =>
            tIdx === slot.targetIdx ? { ...tg, imageDataUrl: dataUrl } : tg
          )
        };
      }
      return {
        ...p,
        items: (p.items || []).map((it, iIdx) =>
          iIdx === slot.itemIdx ? { ...it, imageDataUrl: dataUrl } : it
        )
      };
    });

    await onSaveProfile({
      ...currentProfile,
      parts: updatedParts,
      updatedAt: Date.now()
    });
  };

  const triggerSlotFileUpload = (slot: ImageSlotRef) => {
    setPendingUploadSlot(slot);
    slotUploadInputRef.current?.click();
  };

  const handleSlotFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const slot = pendingUploadSlot;
    e.target.value = '';
    setPendingUploadSlot(null);
    if (!file || !slot) return;

    try {
      const maxDim = slot.kind === 'scene' ? 640 : 280;
      const dataUrl = await compressThumbnailFile(file, maxDim, 0.82);
      await applyImageToSlot(slot, dataUrl);
      onNotify(
        isEn ? `Attached image to ${slot.label}.` : `Đã gắn ảnh vào ${slot.label}.`,
        'success'
      );
    } catch (err: any) {
      onNotify(err?.message || 'Lỗi tải ảnh lên khung hình.', 'error');
    }
  };

  const updateTargetLabel = (partIdx: number, targetIdx: number, nextLabel: string) => {
    const updatedParts = currentProfile.parts.map((p, idx) => {
      if (idx !== partIdx) return p;
      return {
        ...p,
        targets: (p.targets || []).map((tg, tIdx) =>
          tIdx === targetIdx ? { ...tg, label: nextLabel } : tg
        )
      };
    });
    onSaveProfile({ ...currentProfile, parts: updatedParts, updatedAt: Date.now() });
  };

  const updateItemAnswer = (partIdx: number, itemIdx: number, newAns: string) => {
    const updatedParts = currentProfile.parts.map((p, idx) => {
      if (idx !== partIdx) return p;
      return {
        ...p,
        items: p.items.map((it, i) => (i === itemIdx ? { ...it, ans: newAns } : it))
      };
    });
    onSaveProfile({ ...currentProfile, parts: updatedParts, updatedAt: Date.now() });
  };

  const bothFilesReady = blankExamImages.length > 0 && answerKeyImages.length > 0;
  const hasLoadedExamPages = blankExamImages.length > 0 || answerKeyImages.length > 0;

  return (
    <div className="space-y-6">
      {/* Shared hidden file input for attaching an image to any scene / draw_lines target / question item */}
      <input
        ref={slotUploadInputRef}
        type="file"
        accept="image/*"
        onChange={handleSlotFileChange}
        className="hidden"
      />

      {/* Header & Print / PDF controls */}
      <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
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
                {totalQuestions} {isEn ? 'questions' : 'câu'}
              </span>
              <span className="mx-1.5">·</span>
              <span className="tabular-nums">
                {isEn ? 'Scale' : 'Thang'} {currentProfile.maxScore}
              </span>
              {embeddedImagesCount > 0 && (
                <>
                  <span className="mx-1.5">·</span>
                  <span className="text-emerald-700 font-medium tabular-nums">
                    {embeddedImagesCount} {isEn ? 'pictures on sheet' : 'hình trên phiếu'}
                  </span>
                </>
              )}
              {currentProfile.blankExamFileName && (
                <>
                  <span className="mx-1.5">·</span>
                  <span>
                    {isEn ? 'Blank:' : 'Đề trắng:'} {currentProfile.blankExamFileName}
                  </span>
                </>
              )}
            </div>
            <h2 className="mt-0.5 text-lg font-bold text-slate-900">
              {isEn ? '1-Page Answer Sheet & Answer Key' : 'Phiếu Trả Lời 1 Trang & Đáp Án Chuẩn'}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canManageExams && (
              <>
                <button
                  type="button"
                  disabled={isSavingTemplate}
                  onClick={handleSaveAsStandardTemplate}
                  className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Save as Template' : 'Lưu làm đề mẫu'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowCloneForm(prev => !prev)}
                  className="px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100/80 text-indigo-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Clone Template' : 'Nhân bản mẫu này'}</span>
                </button>
              </>
            )}

            {canPrintSheet && (
              <>
                <div className="inline-flex p-0.5 rounded-lg bg-neutral-100 border border-neutral-200 text-xs font-medium">
                  {(['A4', 'A5'] as const).map(size => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => onChangePaperSize(size)}
                      className={`px-3 py-1.5 rounded-md transition-colors ${
                        paperSize === size ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setShowPreview(prev => !prev)}
                  className="px-3 py-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-xs font-medium text-slate-700 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{showPreview ? (isEn ? 'Hide Preview' : 'Ẩn xem trước') : isEn ? 'Preview Sheet' : 'Xem trước phiếu'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{isEn ? `PDF (${paperSize})` : `Tải PDF (${paperSize})`}</span>
                </button>

                <button
                  type="button"
                  onClick={handlePrintInline}
                  className="px-3.5 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-slate-900 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Print' : 'In phiếu'}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {canManageExams && showCloneForm && (
          <form
            onSubmit={handleCreateClonedTemplate}
            className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/50 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-indigo-950">
                {isEn
                  ? `Clone "${currentProfile.gradeName}" (keeps all ${embeddedImagesCount} cropped pictures & ${totalQuestions} answer keys)`
                  : `Nhân bản từ đề mẫu "${currentProfile.gradeName}" (giữ nguyên toàn bộ ${embeddedImagesCount} hình đã cắt & ${totalQuestions} câu đáp án)`}
              </div>
              <button
                type="button"
                onClick={() => setShowCloneForm(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="block text-[11px] text-slate-600 mb-1">
                  {isEn ? 'Target School' : 'Trường áp dụng'}
                </label>
                <input
                  type="text"
                  value={cloneSchool}
                  onChange={e => setCloneSchool(e.target.value)}
                  placeholder="VD: TH Nguyễn Bỉnh Khiêm"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white font-medium text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-600 mb-1">
                  {isEn ? 'Target Grade' : 'Khối lớp mới'}
                </label>
                <input
                  type="text"
                  value={cloneGrade}
                  onChange={e => setCloneGrade(e.target.value)}
                  placeholder="VD: Khối 4"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white font-medium text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-600 mb-1">
                  {isEn ? 'Class (e.g. 4A1, 4A2)' : 'Lớp cụ thể (VD: 4A1, 4A2)'}
                </label>
                <input
                  type="text"
                  value={cloneClass}
                  onChange={e => setCloneClass(e.target.value)}
                  placeholder="VD: 4A1"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white font-medium text-slate-900"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={isSavingTemplate}
                  className="w-full px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center justify-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Create from Template' : 'Tạo từ mẫu này'}</span>
                </button>
              </div>
            </div>
          </form>
        )}

        {canManageExams && (
          <div className="pt-3 border-t border-neutral-200 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                {isEn ? 'School (printed on sheet)' : 'Trường (in sẵn trên phiếu & lưu riêng)'}
              </label>
              <input
                type="text"
                value={draftSchool}
                onChange={e => setDraftSchool(e.target.value)}
                onBlur={commitScopeMeta}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                placeholder={isEn ? 'e.g. Nguyen Binh Khiem Primary' : 'VD: TH Nguyễn Bỉnh Khiêm'}
                className="w-full px-3 py-1.5 rounded-lg border border-neutral-200 bg-neutral-50 font-medium text-slate-900 focus:outline-none focus:border-slate-900 focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                {isEn ? 'Grade' : 'Khối lớp'}
              </label>
              <input
                type="text"
                value={draftGrade}
                onChange={e => setDraftGrade(e.target.value)}
                onBlur={commitScopeMeta}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                placeholder="VD: Grade 2 (G2_FT1)"
                className="w-full px-3 py-1.5 rounded-lg border border-neutral-200 bg-neutral-50 font-medium text-slate-900 focus:outline-none focus:border-slate-900 focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                {isEn ? 'Class (optional)' : 'Lớp cụ thể (tùy chọn)'}
              </label>
              <input
                type="text"
                value={draftClass}
                onChange={e => setDraftClass(e.target.value)}
                onBlur={commitScopeMeta}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                placeholder={isEn ? 'e.g. 2A1 (or blank for whole grade)' : 'VD: 2A1 (hoặc bỏ trống cho cả khối)'}
                className="w-full px-3 py-1.5 rounded-lg border border-neutral-200 bg-neutral-50 font-medium text-slate-900 focus:outline-none focus:border-slate-900 focus:bg-white"
              />
            </div>
          </div>
        )}
      </div>

      {/* Live Canvas Sheet Preview */}
      {showPreview && (
        <div className="bg-white border border-neutral-200 rounded-xl p-4 sm:p-6 flex flex-col items-center justify-center gap-3">
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <span className="font-semibold text-slate-800">
              {paperSize === 'A5'
                ? isEn
                  ? 'A5 Portrait (148 × 210 mm · 300 DPI)'
                  : 'Khổ giấy A5 dọc (148 × 210 mm · 300 DPI sắc nét)'
                : isEn
                  ? 'A4 Portrait (210 × 297 mm · 300 DPI)'
                  : 'Khổ giấy A4 dọc (210 × 297 mm · 300 DPI sắc nét)'}
            </span>
          </div>
          {isRenderingPreview && !previewDataUrl ? (
            <div className="py-16 text-xs text-slate-500">
              {isEn ? 'Rendering printable answer sheet...' : 'Đang dựng bản xem trước phiếu in...'}
            </div>
          ) : previewDataUrl ? (
            <img
              src={previewDataUrl}
              alt="Cambridge 1-page answer sheet preview"
              className={`w-full h-auto border border-neutral-200 rounded-lg shadow-xs ${
                paperSize === 'A5' ? 'max-w-[640px]' : 'max-w-[920px]'
              }`}
            />
          ) : null}
        </div>
      )}

      {/* Dual-File AI Exam Builder (Blank Exam + Answer Key Exam) */}
      {canManageExams && (
        <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {isEn
                ? 'Build Visual Printable Sheet from Blank Exam + Answer Key'
                : 'Nạp Đề Trắng & Đề Có Đáp Án — AI tự tách hình minh họa cho phiếu in'}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {isEn
                ? 'AI automatically crops character & object pictures from the blank exam for young learners, and you can also attach or manually crop any picture frame below.'
                : 'AI tự cắt hình nhân vật (nối hình) và hình câu hỏi từ đề trắng để học sinh lớp nhỏ dễ nhận diện. Giáo viên cũng có thể tự gán hoặc khoanh cắt lại từng khung ảnh bên dưới.'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Slot 1: Blank Student Exam */}
            <div className="p-4 rounded-xl border border-dashed border-neutral-300 bg-neutral-50/60 flex flex-col justify-between gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>{isEn ? '1. Blank Student Exam' : '1. Tệp đề trắng (Đề học sinh)'}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {isEn
                      ? 'Unanswered PDF/image — AI extracts clean illustrations & prompts without red answer lines.'
                      : 'PDF hoặc ảnh đề chưa làm — AI tách ảnh sạch (không dính đường nối đáp án) để in lên phiếu.'}
                  </p>
                </div>
                {blankExamImages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setBlankFileName('');
                      setBlankExamImages([]);
                    }}
                    className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-neutral-200/70"
                    title={isEn ? 'Clear file' : 'Gỡ tệp'}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <input
                ref={blankFileInputRef}
                type="file"
                accept=".pdf,image/*"
                onChange={handleSelectBlankFile}
                className="hidden"
              />

              <div className="flex items-center justify-between gap-2 pt-1">
                {blankExamImages.length > 0 ? (
                  <span className="text-xs text-emerald-700 font-medium truncate flex items-center gap-1.5 tabular-nums">
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{blankFileName}</span>
                    <span className="text-slate-500 shrink-0">({blankExamImages.length} {isEn ? 'pgs' : 'tr'})</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400 truncate">
                    {currentProfile.blankExamFileName
                      ? `${isEn ? 'Saved:' : 'Đã lưu:'} ${currentProfile.blankExamFileName}`
                      : isEn
                        ? 'No file selected'
                        : 'Chưa chọn tệp'}
                  </span>
                )}
                <button
                  type="button"
                  disabled={isLoadingFile !== null || isAnalyzing}
                  onClick={() => blankFileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-50 text-xs font-medium text-slate-800 flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>
                    {isLoadingFile === 'blank'
                      ? isEn
                        ? 'Reading...'
                        : 'Đang đọc...'
                      : isEn
                        ? 'Choose Blank PDF'
                        : 'Chọn đề trắng'}
                  </span>
                </button>
              </div>
            </div>

            {/* Slot 2: Official Answer Key Exam */}
            <div className="p-4 rounded-xl border border-dashed border-neutral-300 bg-neutral-50/60 flex flex-col justify-between gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <FileCheck2 className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>{isEn ? '2. Answer Key Exam' : '2. Tệp đề có đáp án (Đáp án chuẩn)'}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {isEn
                      ? 'Completed PDF/image — extracts exact answers, drawn lines & colours.'
                      : 'PDF hoặc ảnh đã điền đáp án — trích xuất chính xác đường nối, màu và từ khóa.'}
                  </p>
                </div>
                {answerKeyImages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setKeyFileName('');
                      setAnswerKeyImages([]);
                    }}
                    className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-neutral-200/70"
                    title={isEn ? 'Clear file' : 'Gỡ tệp'}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <input
                ref={keyFileInputRef}
                type="file"
                accept=".pdf,image/*"
                onChange={handleSelectKeyFile}
                className="hidden"
              />

              <div className="flex items-center justify-between gap-2 pt-1">
                {answerKeyImages.length > 0 ? (
                  <span className="text-xs text-emerald-700 font-medium truncate flex items-center gap-1.5 tabular-nums">
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{keyFileName}</span>
                    <span className="text-slate-500 shrink-0">({answerKeyImages.length} {isEn ? 'pgs' : 'tr'})</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400 truncate">
                    {currentProfile.sourceFileName
                      ? `${isEn ? 'Saved:' : 'Đã lưu:'} ${currentProfile.sourceFileName}`
                      : isEn
                        ? 'No file selected'
                        : 'Chưa chọn tệp'}
                  </span>
                )}
                <button
                  type="button"
                  disabled={isLoadingFile !== null || isAnalyzing}
                  onClick={() => keyFileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-50 text-xs font-medium text-slate-800 flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>
                    {isLoadingFile === 'key'
                      ? isEn
                        ? 'Reading...'
                        : 'Đang đọc...'
                      : isEn
                        ? 'Choose Answer Key'
                        : 'Chọn đề đáp án'}
                  </span>
                </button>
              </div>
            </div>
          </div>

          <textarea
            rows={3}
            placeholder={isEn ? 'Optional: edit or paste plain-text answer key notes...' : 'Tùy chọn: chỉnh sửa hoặc dán thêm ghi chú đáp án bằng văn bản...'}
            value={currentProfile.answerKeyText || ''}
            onChange={e => onSaveProfile({ ...currentProfile, answerKeyText: e.target.value, updatedAt: Date.now() })}
            className="w-full p-3 rounded-lg border border-neutral-200 bg-neutral-50 font-mono text-xs text-slate-800 focus:outline-none focus:border-slate-900 focus:bg-white"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              {bothFilesReady
                ? isEn
                  ? 'Both files ready — AI will auto-crop clean pictures from the blank exam and match keys.'
                  : 'Đã đủ cả 2 tệp — AI sẽ tự tách hình sạch từ đề trắng và đối chiếu đáp án chuẩn.'
                : isEn
                  ? 'Tip: Upload the blank exam to auto-extract kid-friendly pictures for matching & visual items.'
                  : 'Mẹo: Nạp tệp đề trắng để AI tự cắt hình nhân vật & đồ vật đưa thẳng vào phiếu in cho học sinh lớp nhỏ.'}
            </span>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isExtractingImages || isAnalyzing || isLoadingFile !== null}
                onClick={handleAutoCropExamImages}
                className="px-3.5 py-2.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-50 text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Crop className={`w-3.5 h-3.5 ${isExtractingImages ? 'animate-pulse' : ''}`} />
                <span>
                  {isExtractingImages
                    ? isEn
                      ? 'AI Cropping Images...'
                      : 'AI đang tự cắt hình...'
                    : isEn
                      ? 'AI Auto-Crop Pictures Only'
                      : 'AI tự cắt ảnh từ đề'}
                </span>
              </button>

              <button
                type="button"
                disabled={isAnalyzing || isExtractingImages || isLoadingFile !== null}
                onClick={handleAnalyzeExamFiles}
                className="px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                <span>
                  {isAnalyzing
                    ? isEn
                      ? 'Extracting Pictures & Keys...'
                      : 'AI đang tách hình & dựng phiếu...'
                    : bothFilesReady
                      ? isEn
                        ? 'Analyze Both Files & Extract Pictures'
                        : 'AI tách hình & dựng phiếu từ 2 tệp'
                      : isEn
                        ? 'AI Analyze & Update Sheet'
                        : 'AI phân tích & cập nhật phiếu in'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Structured Answer Key & Visual Picture Frame Manager */}
      <div className="bg-white border border-neutral-200 rounded-xl divide-y divide-neutral-200">
        {(currentProfile.parts || []).map((part, pIdx) => {
          const sceneSlot: ImageSlotRef = {
            kind: 'scene',
            partIdx: pIdx,
            label: `${part.title} (${isEn ? 'Part Scene' : 'Hình minh họa phần'})`
          };

          return (
            <div key={part.id || pIdx} className="p-5 space-y-3.5">
              {/* Part Header + Part Scene Image Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{part.title}</h3>
                  <div className="text-xs text-slate-500">
                    {part.skill}
                    {part.note ? ` · ${part.note}` : ''}
                  </div>
                </div>

                {canManageExams && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => triggerSlotFileUpload(sceneSlot)}
                      className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-slate-700 font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <ImagePlus className="w-3.5 h-3.5 text-slate-500" />
                      <span>
                        {part.sceneImageDataUrl
                          ? isEn
                            ? 'Replace Scene'
                            : 'Đổi ảnh phần'
                          : isEn
                            ? 'Add Part Picture'
                            : 'Gán ảnh minh họa phần'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCropModalSlot(sceneSlot)}
                      className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-slate-700 font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                      title={
                        hasLoadedExamPages
                          ? isEn
                            ? 'Crop directly from uploaded exam page'
                            : 'Khoanh cắt trực tiếp từ trang đề đã nạp'
                          : isEn
                            ? 'Open cropper (you can load exam PDF inside)'
                            : 'Mở khung cắt ảnh từ đề'
                      }
                    >
                      <Crop className="w-3.5 h-3.5 text-slate-500" />
                      <span>{isEn ? 'Crop from Exam' : 'Cắt từ đề'}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Part Scene Picture Preview (if attached) */}
              {part.sceneImageDataUrl && (
                <div className="p-3 rounded-xl border border-neutral-200 bg-neutral-50/70 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-36 h-20 rounded-lg border border-neutral-200 bg-white p-1 flex items-center justify-center shrink-0">
                      <img
                        src={part.sceneImageDataUrl}
                        alt={part.title}
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                    <div className="text-xs min-w-0">
                      <div className="font-semibold text-slate-800">
                        {isEn ? 'Shared Scene Picture (Printed on Sheet)' : 'Tranh minh họa chung (In trực tiếp lên phiếu)'}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {isEn
                          ? 'Helps young students recognize the scene visually without reading long instructions.'
                          : 'Giúp học sinh lớp nhỏ nhìn tranh là nhận ra ngữ cảnh câu hỏi ngay trên phiếu thi.'}
                      </p>
                    </div>
                  </div>
                  {canManageExams && (
                    <button
                      type="button"
                      onClick={() => applyImageToSlot(sceneSlot, undefined)}
                      className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-slate-600 text-xs font-medium inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{isEn ? 'Remove' : 'Xóa ảnh'}</span>
                    </button>
                  )}
                </div>
              )}

              {/* Draw Lines Picture Frame Cards (Kid-friendly Character/Object Frames A..E — Replaces Text on Printed Sheet) */}
              {part.type === 'draw_lines' && part.targets && part.targets.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-semibold text-slate-800">
                        {isEn
                          ? 'Visual Picture Frames (Horizontal Layout — Replaces Text on Printed Sheet)'
                          : 'Khung hình nhân vật / đồ vật (Xoay ngang trên phiếu — Thay thế hoàn toàn phần chữ)'}
                      </span>
                      <div className="text-[11px] text-slate-500">
                        {isEn
                          ? 'Names on top connect downward to cropped images A–E below to save space.'
                          : 'Tên học sinh nằm hàng trên nối xuống hàng ảnh A–E bên dưới, tiết kiệm 50% diện tích dọc.'}
                      </div>
                    </div>
                    {canManageExams && (
                      <button
                        type="button"
                        disabled={isExtractingImages || isAnalyzing}
                        onClick={handleAutoCropExamImages}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Sparkles className={`w-3.5 h-3.5 ${isExtractingImages ? 'animate-spin' : ''}`} />
                        <span>
                          {isExtractingImages
                            ? isEn
                              ? 'AI Cropping...'
                              : 'AI đang tự cắt...'
                            : isEn
                              ? 'AI Auto-Crop from Exam'
                              : 'AI tự cắt hình từ đề'}
                        </span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {part.targets.map((tg, tIdx) => {
                      const targetSlot: ImageSlotRef = {
                        kind: 'target',
                        partIdx: pIdx,
                        targetIdx: tIdx,
                        label: `${part.title} · ${isEn ? 'Picture' : 'Hình'} ${tg.code}`
                      };

                      return (
                        <div
                          key={tg.code}
                          className="rounded-xl border border-neutral-200 bg-neutral-50/50 p-3 flex flex-col gap-2"
                        >
                          {/* Picture Frame */}
                          <div className="relative h-28 rounded-lg border border-dashed border-neutral-300 bg-white flex items-center justify-center overflow-hidden p-1.5">
                            <span className="absolute top-1.5 left-1.5 w-6 h-6 rounded-md bg-slate-900 text-white font-mono text-xs font-bold flex items-center justify-center">
                              {tg.code}
                            </span>

                            {tg.imageDataUrl ? (
                              <>
                                <img
                                  src={tg.imageDataUrl}
                                  alt={`Target ${tg.code}`}
                                  className="max-w-full max-h-full object-contain"
                                />
                                {canManageExams && (
                                  <button
                                    type="button"
                                    onClick={() => applyImageToSlot(targetSlot, undefined)}
                                    title={isEn ? 'Remove picture' : 'Xóa ảnh'}
                                    className="absolute top-1.5 right-1.5 p-1 rounded-md bg-white/95 border border-neutral-200 text-slate-500 hover:text-rose-700 hover:border-rose-200"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </>
                            ) : (
                              <div className="text-center px-4">
                                <div className="text-xs font-medium text-slate-600">
                                  {isEn ? `Picture Frame ${tg.code}` : `Khung hình ${tg.code}`}
                                </div>
                                <div className="text-[11px] text-slate-400 mt-0.5">
                                  {isEn ? 'Printed instead of text' : 'In lên phiếu thay phần chữ'}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Teacher-only Reference Hint (Not printed on student sheet) */}
                          <div>
                            <div className="text-[10px] text-slate-400 mb-0.5">
                              {isEn ? 'Teacher note (not printed on sheet)' : 'Gợi ý cắt hình cho GV (không in lên phiếu)'}
                            </div>
                            <InlineCommitInput
                              value={tg.label || ''}
                              disabled={!canManageExams}
                              placeholder={isEn ? 'Reference description for teacher...' : 'Ghi chú nhân vật để GV đối chiếu...'}
                              onCommit={next => updateTargetLabel(pIdx, tIdx, next)}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs text-slate-700 focus:outline-none focus:border-slate-900 disabled:bg-neutral-100"
                            />
                          </div>

                          {/* Teacher Image Actions */}
                          {canManageExams && (
                            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                              <button
                                type="button"
                                onClick={() => triggerSlotFileUpload(targetSlot)}
                                className="px-2 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-slate-700 font-medium inline-flex items-center justify-center gap-1 whitespace-nowrap"
                              >
                                <ImagePlus className="w-3.5 h-3.5 text-slate-500" />
                                <span>{tg.imageDataUrl ? (isEn ? 'Change' : 'Đổi ảnh') : isEn ? 'Attach' : 'Gán ảnh'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setCropModalSlot(targetSlot)}
                                className="px-2 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-slate-700 font-medium inline-flex items-center justify-center gap-1 whitespace-nowrap"
                              >
                                <Crop className="w-3.5 h-3.5 text-slate-500" />
                                <span>{isEn ? 'Crop Exam' : 'Cắt từ đề'}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Question Items Grid (with Mini Image Slots for Visual Recognition) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {(part.items || []).map((it, iIdx) => {
                  const opts =
                    part.options && part.options.length > 0
                      ? part.options
                      : part.type === 'listen_colour'
                        ? ['RED', 'GREEN', 'BLUE', 'YELLOW']
                        : part.type === 'yes_no'
                          ? ['YES', 'NO']
                          : part.type === 'tick_cross'
                            ? ['✓', '✗']
                            : part.type === 'draw_lines'
                              ? part.targets?.map(t => t.code) || ['A', 'B', 'C', 'D', 'E']
                              : part.type === 'matching_ag'
                                ? ['A', 'B', 'C', 'D', 'E', 'F', 'G']
                                : ['A', 'B', 'C'];

                  const itemSlot: ImageSlotRef = {
                    kind: 'item',
                    partIdx: pIdx,
                    itemIdx: iIdx,
                    label: `${part.title} · Q${it.q}`
                  };

                  const colourHex =
                    part.type === 'listen_colour'
                      ? COLOUR_SWATCH_MAP[String(it.ans || '').trim().toUpperCase()]
                      : undefined;

                  return (
                    <div
                      key={iIdx}
                      className="p-2.5 rounded-lg border border-neutral-200 bg-white flex flex-col gap-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex items-center gap-1.5 truncate">
                          <span className="font-mono font-semibold text-slate-900 shrink-0">Q{it.q}</span>
                          {it.prompt && <span className="text-slate-600 truncate">{it.prompt}</span>}
                          {!it.prompt && it.targetDesc && (
                            <span className="text-slate-500 truncate">{it.targetDesc}</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {colourHex && (
                            <span
                              style={{ backgroundColor: colourHex }}
                              className="w-3 h-3 rounded-full border border-neutral-300 shrink-0"
                            />
                          )}
                          {part.type === 'text_blank' ? (
                            <input
                              type="text"
                              disabled={!canManageExams}
                              value={it.ans}
                              onChange={e => updateItemAnswer(pIdx, iIdx, e.target.value)}
                              className="w-24 px-2 py-1 rounded border border-neutral-200 bg-neutral-50 font-mono text-xs text-slate-900 focus:outline-none focus:border-slate-900"
                            />
                          ) : (
                            <select
                              disabled={!canManageExams}
                              value={it.ans}
                              onChange={e => updateItemAnswer(pIdx, iIdx, e.target.value)}
                              className="px-2 py-1 rounded border border-neutral-200 bg-neutral-50 font-mono text-xs font-semibold text-slate-900 focus:outline-none focus:border-slate-900"
                            >
                              {opts.map(opt => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>

                      {/* Mini Visual Image Slot for non-draw_lines questions */}
                      {part.type !== 'draw_lines' && (it.imageDataUrl || canManageExams) && (
                        <div className="pt-1.5 border-t border-neutral-100 flex items-center justify-between gap-2">
                          {it.imageDataUrl ? (
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-12 h-9 rounded border border-neutral-200 bg-neutral-50 p-0.5 flex items-center justify-center shrink-0">
                                <img
                                  src={it.imageDataUrl}
                                  alt={`Q${it.q}`}
                                  className="max-w-full max-h-full object-contain"
                                />
                              </div>
                              <span className="text-[11px] text-emerald-700 font-medium truncate">
                                {isEn ? 'Image attached' : 'Đã gắn hình'}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400 truncate">
                              {isEn ? 'Optional picture' : 'Hình minh họa câu'}
                            </span>
                          )}

                          {canManageExams && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => triggerSlotFileUpload(itemSlot)}
                                title={isEn ? 'Attach image from device' : 'Gán ảnh từ máy'}
                                className="p-1 rounded border border-neutral-200 hover:bg-neutral-50 text-slate-600"
                              >
                                <ImagePlus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setCropModalSlot(itemSlot)}
                                title={isEn ? 'Crop picture from exam page' : 'Cắt hình từ trang đề'}
                                className="p-1 rounded border border-neutral-200 hover:bg-neutral-50 text-slate-600"
                              >
                                <Crop className="w-3.5 h-3.5" />
                              </button>
                              {it.imageDataUrl && (
                                <button
                                  type="button"
                                  onClick={() => applyImageToSlot(itemSlot, undefined)}
                                  title={isEn ? 'Remove image' : 'Xóa hình'}
                                  className="p-1 rounded border border-neutral-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-slate-500"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Interactive Crop-From-Exam Modal */}
      {cropModalSlot && (
        <CropFromExamModal
          slotLabel={cropModalSlot.label}
          isScene={cropModalSlot.kind === 'scene'}
          blankPages={blankExamImages}
          keyPages={answerKeyImages}
          lang={lang}
          onLoadExamPages={loadExamPagesFromFile}
          onConfirmCrop={async dataUrl => {
            await applyImageToSlot(cropModalSlot, dataUrl);
            onNotify(
              isEn
                ? `Cropped & attached picture to ${cropModalSlot.label}.`
                : `Đã cắt và gắn hình vào ${cropModalSlot.label}.`,
              'success'
            );
          }}
          onClose={() => setCropModalSlot(null)}
          onNotify={onNotify}
        />
      )}
    </div>
  );
}
