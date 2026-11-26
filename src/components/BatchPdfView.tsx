import React, { useMemo, useRef, useState } from 'react';
import { FileText, Sparkles, Upload } from 'lucide-react';
import { apiRequest } from '../utils/api';
import { computeCambridgeShields, renderPdfToPageImages } from '../utils/grading';
import type { ExamProfile, StudentResult, UiLang } from '../types';

interface BatchPdfViewProps {
  currentProfile: ExamProfile;
  teacherName: string;
  canGrade: boolean;
  canManageExams: boolean;
  lang: UiLang;
  onUpdateProfileField: <K extends keyof ExamProfile>(field: K, value: ExamProfile[K]) => Promise<void>;
  onSaveResult: (record: StudentResult, overwriteDuplicate?: boolean) => Promise<{ record: StudentResult; wasUpdated: boolean }>;
  onGoToScoreboard: () => void;
  onNotify: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function BatchPdfView({
  currentProfile,
  teacherName,
  canGrade,
  canManageExams,
  lang,
  onUpdateProfileField,
  onSaveResult,
  onGoToScoreboard,
  onNotify
}: BatchPdfViewProps) {
  const isEn = lang === 'en';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pdfFileName, setPdfFileName] = useState('');
  const [pdfPageImages, setPdfPageImages] = useState<Array<{ pageNum: number; dataUrl: string; base64: string }>>([]);
  const [isRendering, setIsRendering] = useState(false);
  const [isGrading, setIsGrading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const totalQuestions = (currentProfile.parts || []).reduce((sum, p) => sum + (p.items?.length || 0), 0);

  const studentBatches = useMemo(() => {
    const pps = Math.max(1, Number(currentProfile.pagesPerStudent) || 9);
    const batches: Array<{
      index: number;
      startPage: number;
      endPage: number;
      pages: Array<{ pageNum: number; dataUrl: string; base64: string }>;
    }> = [];
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

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsRendering(true);
    setPdfFileName(file.name);
    setPdfPageImages([]);
    try {
      const pages = await renderPdfToPageImages(file, 150, 1.35);
      setPdfPageImages(pages);
      onNotify(
        isEn
          ? `Split ${pages.length} pages from "${file.name}".`
          : `Đã tách ${pages.length} trang từ "${file.name}".`,
        'success'
      );
    } catch (err: any) {
      onNotify(err?.message || 'Lỗi đọc tệp PDF.', 'error');
    } finally {
      setIsRendering(false);
    }
    e.target.value = '';
  };

  const handleStartBatch = async () => {
    if (studentBatches.length === 0) return;
    setIsGrading(true);
    setProgress({ current: 0, total: studentBatches.length });
    const maxScore = currentProfile.maxScore || 8;

    for (let i = 0; i < studentBatches.length; i++) {
      const batch = studentBatches[i];
      setProgress({ current: i + 1, total: studentBatches.length });

      try {
        const aiData = await apiRequest<{
          studentName: string;
          className: string;
          schoolName: string;
          sectionBreakdown?: string;
          teacherNote?: string;
          questions: Array<{
            questionNumber: string;
            studentAnswer: string;
            correctAnswer: string;
            isCorrect: boolean;
            note?: string;
          }>;
        }>('/api/ai/grade-batch-student', {
          method: 'POST',
          body: JSON.stringify({
            pageImages: batch.pages.map(p => p.base64),
            answerKeyText: currentProfile.answerKeyText
          })
        });

        const questions = (aiData.questions || []).map((q, idx) => ({
          questionNumber: q.questionNumber || `Q${idx + 1}`,
          studentAnswer: q.studentAnswer || '',
          correctAnswer: q.correctAnswer || '',
          isCorrect: Boolean(q.isCorrect),
          note: q.note || ''
        }));

        const totalQ = questions.length || totalQuestions;
        const correctQ = questions.filter(q => q.isCorrect).length;
        const score = totalQ > 0 ? Number(((correctQ / totalQ) * maxScore).toFixed(2)) : 0;
        const shields = computeCambridgeShields(correctQ, totalQ);

        const record: StudentResult = {
          id: `pdf-${currentProfile.id}-${batch.index}-${Date.now()}`,
          profileId: currentProfile.id,
          gradeName: currentProfile.gradeName,
          examTitle: currentProfile.examTitle,
          gradedBy: teacherName.trim() || 'Giáo viên',
          createdAt: Date.now(),
          stt: batch.index,
          pageRange: `${batch.startPage}-${batch.endPage}`,
          pages: batch.pages.map(p => ({ pageNum: p.pageNum, dataUrl: p.dataUrl })),
          studentName: aiData.studentName || `Student #${batch.index}`,
          className: aiData.className || currentProfile.classLabel || currentProfile.gradeName,
          schoolName: aiData.schoolName || currentProfile.schoolName || 'Chưa rõ trường',
          listeningScore: aiData.sectionBreakdown || '-',
          rwScore: '-',
          shields,
          sectionBreakdown: aiData.sectionBreakdown || `${shields}/5 Shields`,
          teacherNote: aiData.teacherNote || '',
          questions,
          correctCount: correctQ,
          totalQuestions: totalQ,
          score,
          reviewed: false,
          status: 'needs_review'
        };

        await onSaveResult(record, true);
      } catch (err: any) {
        onNotify(`${isEn ? 'Error grading student' : 'Lỗi chấm học sinh'} #${batch.index}: ${err?.message || ''}`, 'error');
      }
    }

    setIsGrading(false);
    onNotify(
      isEn
        ? `Completed batch grading for ${studentBatches.length} students.`
        : `Hoàn tất chấm hàng loạt ${studentBatches.length} bài thi.`,
      'success'
    );
    onGoToScoreboard();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-neutral-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500">
              {currentProfile.schoolName ? `${currentProfile.schoolName} · ` : ''}
              {currentProfile.gradeName}
              {currentProfile.classLabel ? ` (${currentProfile.classLabel})` : ''} · {currentProfile.examTitle}
            </div>
            <h2 className="mt-1 text-lg font-bold text-slate-900">
              {isEn ? 'Batch Class PDF Auto-Grading' : 'Tách Trang PDF & Chấm Hàng Loạt Cả Lớp'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {isEn
                ? 'Automatically divides a scanned class PDF into fixed page packets per student and extracts Name, Class, School & answers.'
                : 'Tự động tách tệp PDF scan cả lớp thành từng bộ bài làm cố định cho mỗi học sinh và chấm theo đáp án chuẩn.'}
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <label className="text-slate-600 font-medium">
              {isEn ? 'Pages / student:' : 'Số trang / 1 HS:'}
            </label>
            <input
              type="number"
              min={1}
              max={30}
              disabled={!canManageExams}
              value={currentProfile.pagesPerStudent}
              onChange={e => onUpdateProfileField('pagesPerStudent', Math.max(1, Number(e.target.value) || 1))}
              className="w-16 px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-neutral-50 font-mono text-center font-semibold text-slate-900"
            />
          </div>
        </div>

        <div className="border border-dashed border-neutral-300 rounded-xl p-8 text-center bg-neutral-50/50 space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handlePdfUpload}
            className="hidden"
          />
          <FileText className="w-7 h-7 text-slate-400 mx-auto" />
          <div>
            <button
              type="button"
              disabled={isRendering || !canGrade}
              onClick={() => fileInputRef.current?.click()}
              className="px-5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors"
            >
              <Upload className="w-4 h-4" />
              <span>
                {isRendering
                  ? isEn
                    ? 'Splitting PDF pages...'
                    : 'Đang tách trang PDF...'
                  : isEn
                    ? 'Select Scanned Class PDF'
                    : 'Chọn tệp PDF scan cả lớp'}
              </span>
            </button>
          </div>

          {pdfFileName && (
            <p className="text-xs text-slate-600 tabular-nums">
              {pdfFileName} · {pdfPageImages.length} {isEn ? 'pages' : 'trang'} ·{' '}
              <span className="font-semibold text-emerald-700">
                {studentBatches.length} {isEn ? 'students detected' : 'học sinh'}
              </span>
            </p>
          )}
        </div>

        {studentBatches.length > 0 && (
          <div className="space-y-3">
            {isGrading && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-600 tabular-nums">
                  <span>{isEn ? 'Grading progress' : 'Tiến độ chấm bài'}</span>
                  <span>
                    {progress.current} / {progress.total}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-neutral-200 overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all"
                    style={{ width: `${Math.round((progress.current / Math.max(1, progress.total)) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={isGrading}
              onClick={handleStartBatch}
              className="w-full py-3 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Sparkles className={`w-4 h-4 ${isGrading ? 'animate-spin' : ''}`} />
              <span>
                {isGrading
                  ? `${isEn ? 'Grading student' : 'Đang chấm học sinh'} ${progress.current}/${progress.total}...`
                  : `${isEn ? 'Start Auto-Grading' : 'Bắt đầu chấm tự động'} (${studentBatches.length} ${isEn ? 'students' : 'học sinh'})`}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
