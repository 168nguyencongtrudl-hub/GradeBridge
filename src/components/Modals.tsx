import React, { useRef, useState } from 'react';
import {
  Check,
  Copy,
  DownloadCloud,
  FileCheck2,
  FileText,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  UploadCloud,
  X
} from 'lucide-react';
import { apiRequest } from '../utils/api';
import { applyAiImageCropsToParts, compressImageFile, fileToBase64Images } from '../utils/grading';
import { DEFAULT_SYSTEM_BRANDING, INITIAL_EXAM_PROFILES } from '../data/initialData';
import type {
  ExamPart,
  ExamProfile,
  SmartTask,
  StudentResult,
  SystemBranding,
  TeacherAccount,
  UiLang,
  UserPermissions
} from '../types';

// ============================================================================
// 1. STUDENT REVIEW MODAL
// ============================================================================
export function ReviewStudentModal({
  student,
  lang,
  onClose,
  onUpdateMeta,
  onUpdateQuestion,
  onCreateFollowUpTask
}: {
  student: StudentResult;
  lang: UiLang;
  onClose: () => void;
  onUpdateMeta: (studentId: string, field: 'studentName' | 'className' | 'schoolName', value: string) => void;
  onUpdateQuestion: (studentId: string, qIdx: number, newStudentAns: string | null, forceCorrect: boolean | null) => void;
  onCreateFollowUpTask: (student: StudentResult) => void;
}) {
  const isEn = lang === 'en';
  const [pageIdx, setPageIdx] = useState(0);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white border border-neutral-200 rounded-2xl max-w-6xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-xl">
        <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs text-slate-500 tabular-nums">
              {student.gradeName} · {isEn ? 'Score' : 'Điểm'}: <strong className="text-slate-900">{student.score}</strong> · {student.sectionBreakdown}
            </div>
            <h3 className="text-base font-bold text-slate-900 truncate">{student.studentName}</h3>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onCreateFollowUpTask(student)}
              className="px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-xs font-medium text-slate-700 whitespace-nowrap"
            >
              {isEn ? '+ Create Follow-up Task' : '+ Tạo việc kèm cặp'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-neutral-100 hover:text-slate-900"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-neutral-200">
          <div className="p-5 bg-neutral-50 flex flex-col items-center justify-center gap-3">
            {student.pages && student.pages[pageIdx]?.dataUrl ? (
              <>
                <img
                  src={student.pages[pageIdx].dataUrl}
                  alt="Scanned answer sheet"
                  className="max-h-[64vh] w-auto rounded-lg border border-neutral-200 bg-white object-contain"
                />
                {student.pages.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {student.pages.map((pg, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setPageIdx(idx)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                          pageIdx === idx ? 'bg-slate-900 text-white' : 'bg-white border border-neutral-200 text-slate-700'
                        }`}
                      >
                        {isEn ? 'Page' : 'Trang'} {pg.pageNum}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="py-16 text-center text-xs text-slate-400">
                {isEn
                  ? 'No stored scan preview for this record. Scores and question breakdown remain fully editable.'
                  : 'Không có ảnh lưu kèm cho bản ghi này. Toàn bộ điểm và chi tiết từng câu vẫn có thể chỉnh sửa bên phải.'}
              </div>
            )}
          </div>

          <div className="p-5 space-y-5 overflow-y-auto max-h-[74vh]">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">{isEn ? 'Student Name' : 'Họ và tên'}</label>
                <input
                  type="text"
                  value={student.studentName}
                  onChange={e => onUpdateMeta(student.id, 'studentName', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-200 font-medium text-slate-900 focus:outline-none focus:border-slate-900"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">{isEn ? 'Class' : 'Lớp'}</label>
                <input
                  type="text"
                  value={student.className}
                  onChange={e => onUpdateMeta(student.id, 'className', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-200 font-medium text-slate-900 focus:outline-none focus:border-slate-900"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">{isEn ? 'School' : 'Trường'}</label>
                <input
                  type="text"
                  value={student.schoolName}
                  onChange={e => onUpdateMeta(student.id, 'schoolName', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-200 font-medium text-slate-900 focus:outline-none focus:border-slate-900"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-700 tabular-nums">
                {isEn ? 'Question breakdown' : 'Chi tiết từng câu'} ({student.correctCount}/{student.totalQuestions})
              </div>
              <div className="divide-y divide-neutral-200 border border-neutral-200 rounded-xl overflow-hidden">
                {(student.questions || []).map((q, qIdx) => (
                  <div key={qIdx} className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs bg-white">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900">{q.questionNumber}</div>
                      <div className="text-[11px] text-slate-500">
                        {isEn ? 'Key:' : 'Đáp án:'} <span className="font-mono text-emerald-700 font-medium">{q.correctAnswer}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="text"
                        value={q.studentAnswer}
                        onChange={e => onUpdateQuestion(student.id, qIdx, e.target.value, null)}
                        className="w-28 px-2.5 py-1 rounded-md border border-neutral-200 bg-neutral-50 font-mono text-xs text-center text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => onUpdateQuestion(student.id, qIdx, null, !q.isCorrect)}
                        className={`px-2.5 py-1 rounded-md font-semibold text-[11px] ${
                          q.isCorrect ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {q.isCorrect ? (isEn ? 'Correct' : 'Đúng') : isEn ? 'Wrong' : 'Sai'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 2. EXAM BANK MODAL
// ============================================================================
export function ExamBankModal({
  examProfiles,
  selectedProfileId,
  allResults,
  canManageExams,
  lang,
  onSelectProfile,
  onSaveProfile,
  onDeleteProfile,
  onClose,
  onNotify
}: {
  examProfiles: ExamProfile[];
  selectedProfileId: string;
  allResults: StudentResult[];
  canManageExams: boolean;
  lang: UiLang;
  onSelectProfile: (id: string) => void;
  onSaveProfile: (profile: ExamProfile) => Promise<void>;
  onDeleteProfile: (id: string) => Promise<void>;
  onClose: () => void;
  onNotify: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const isEn = lang === 'en';
  const blankFileRef = useRef<HTMLInputElement>(null);
  const keyFileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'list' | 'create'>('list');
  const [schoolFilter, setSchoolFilter] = useState<string>('ALL');

  const [templateProfileId, setTemplateProfileId] = useState<string>(selectedProfileId || examProfiles[0]?.id || '');
  const [schoolName, setSchoolName] = useState('');
  const [gradeName, setGradeName] = useState('');
  const [classLabel, setClassLabel] = useState('');
  const [examTitle, setExamTitle] = useState('');
  const [examLevel, setExamLevel] = useState('Cambridge Pre-A1 Starters');
  const [pagesPerStudent, setPagesPerStudent] = useState(9);
  const [maxScore, setMaxScore] = useState(10);
  const [answerKeyText, setAnswerKeyText] = useState('');
  const [blankFileName, setBlankFileName] = useState('');
  const [blankExamImages, setBlankExamImages] = useState<string[]>([]);
  const [sourceFileName, setSourceFileName] = useState('');
  const [answerKeyImages, setAnswerKeyImages] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const countProfileImages = (prof: ExamProfile): number => {
    let total = 0;
    for (const pt of prof.parts || []) {
      if (pt.sceneImageDataUrl) total += 1;
      for (const tg of pt.targets || []) if (tg.imageDataUrl) total += 1;
      for (const it of pt.items || []) if (it.imageDataUrl) total += 1;
    }
    return total;
  };

  const applyTemplateToForm = (prof: ExamProfile) => {
    setTemplateProfileId(prof.id);
    setSchoolName(prof.schoolName || 'TH Nguyễn Bỉnh Khiêm');
    setGradeName(prof.gradeName || '');
    setClassLabel('');
    setExamTitle(prof.examTitle || '');
    setExamLevel(prof.examLevel || 'Cambridge Pre-A1 Starters');
    setPagesPerStudent(prof.pagesPerStudent || 9);
    setMaxScore(prof.maxScore || 10);
  };

  const uniqueSchools = Array.from(
    new Set(examProfiles.map(p => (p.schoolName || '').trim() || (isEn ? 'Unassigned School' : 'Chưa phân trường')))
  );

  const groupedBySchool = uniqueSchools
    .filter(sc => schoolFilter === 'ALL' || sc === schoolFilter)
    .map(sc => ({
      school: sc,
      profiles: examProfiles.filter(
        p => ((p.schoolName || '').trim() || (isEn ? 'Unassigned School' : 'Chưa phân trường')) === sc
      )
    }));


  const handleBlankFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imgs = await fileToBase64Images(file, 12);
      setBlankFileName(file.name);
      setBlankExamImages(imgs);
      onNotify(
        `${isEn ? 'Loaded blank exam' : 'Đã nạp đề trắng'}: "${file.name}" (${imgs.length} ${isEn ? 'pages' : 'trang'})`,
        'success'
      );
    } catch (err: any) {
      onNotify(err?.message || 'Lỗi đọc tệp đề trắng.', 'error');
    }
    e.target.value = '';
  };

  const handleKeyFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imgs = await fileToBase64Images(file, 12);
      setSourceFileName(file.name);
      setAnswerKeyImages(imgs);
      onNotify(
        `${isEn ? 'Loaded answer key' : 'Đã nạp đề đáp án'}: "${file.name}" (${imgs.length} ${isEn ? 'pages' : 'trang'})`,
        'success'
      );
    } catch (err: any) {
      onNotify(err?.message || 'Lỗi đọc tệp đáp án.', 'error');
    }
    e.target.value = '';
  };

  const handleSaveNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolName.trim()) {
      onNotify(isEn ? 'Please enter a School Name.' : 'Vui lòng nhập Tên Trường.', 'warning');
      return;
    }
    if (!gradeName.trim()) {
      onNotify(isEn ? 'Please enter a Grade Name.' : 'Vui lòng nhập Tên Khối Lớp.', 'warning');
      return;
    }
    setIsProcessing(true);
    try {
      const chosenTemplate =
        examProfiles.find(p => p.id === templateProfileId) || examProfiles[0] || INITIAL_EXAM_PROFILES[0];
      let extractedParts: ExamPart[] = [];
      let formattedText = answerKeyText;

      if (blankExamImages.length > 0 || answerKeyImages.length > 0 || answerKeyText.trim()) {
        const res = await apiRequest<{
          formattedAnswerText?: string;
          parts?: any[];
        }>('/api/ai/deconstruct-exam', {
          method: 'POST',
          body: JSON.stringify({
            blankExamImages,
            answerKeyImages,
            answerKeyText,
            fallbackLevel: examLevel
          })
        });
        extractedParts = await applyAiImageCropsToParts(
          res.parts || [],
          blankExamImages,
          answerKeyImages
        );
        if (res.formattedAnswerText) formattedText = res.formattedAnswerText;
      }

      const templatePartsCopy: ExamPart[] = JSON.parse(
        JSON.stringify(chosenTemplate?.parts || INITIAL_EXAM_PROFILES[0].parts)
      );

      const newProfile: ExamProfile = {
        id: `profile-${Date.now()}`,
        schoolName: schoolName.trim(),
        gradeName: gradeName.trim(),
        classLabel: classLabel.trim() || undefined,
        examTitle:
          examTitle.trim() ||
          chosenTemplate?.examTitle ||
          `${gradeName.trim()} - Cambridge Assessment`,
        examLevel,
        pagesPerStudent: Math.max(1, Number(pagesPerStudent) || chosenTemplate?.pagesPerStudent || 9),
        maxScore: Math.max(1, Number(maxScore) || chosenTemplate?.maxScore || 10),
        blankExamFileName: blankFileName || chosenTemplate?.blankExamFileName || undefined,
        sourceFileName: sourceFileName || chosenTemplate?.sourceFileName || 'Template Copy',
        updatedAt: Date.now(),
        parts: extractedParts.length > 0 ? extractedParts : templatePartsCopy,
        answerKeyText: formattedText.trim() || chosenTemplate?.answerKeyText || 'Answer key'
      };

      await onSaveProfile(newProfile);
      onSelectProfile(newProfile.id);
      onNotify(
        isEn
          ? `Created "${newProfile.schoolName} · ${newProfile.gradeName}".`
          : `Đã tạo bộ đề: "${newProfile.schoolName} · ${newProfile.gradeName}${newProfile.classLabel ? ` (Lớp ${newProfile.classLabel})` : ''}".`,
        'success'
      );
      onClose();
    } catch (err: any) {
      onNotify(err?.message || 'Lỗi tạo bộ đề.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="bg-white border border-neutral-200 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
        <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {isEn ? 'Schools & Exam Bank' : 'Kho Đề Mẫu Theo Trường & Khối Lớp'} ({examProfiles.length})
            </h3>
            <p className="text-xs text-slate-500">
              {isEn
                ? 'Each school and grade/class stores its own answer sheet, cropped illustrations, key, and separate student score list.'
                : 'Mỗi bộ đề đã làm xong được lưu làm đề mẫu chuẩn (kèm toàn bộ hình đã cắt & đáp án) để tái sử dụng hoặc nhân bản.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-neutral-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {canManageExams && (
          <div className="px-5 pt-3 border-b border-neutral-200 flex gap-4 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setTab('list')}
              className={`pb-2.5 border-b-2 transition-colors ${
                tab === 'list' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500'
              }`}
            >
              {isEn ? 'Saved Templates & Exams' : 'Kho Đề Mẫu Đã Lưu'}
            </button>
            <button
              type="button"
              onClick={() => setTab('create')}
              className={`pb-2.5 border-b-2 transition-colors ${
                tab === 'create' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500'
              }`}
            >
              {isEn ? '+ New / Clone from Template' : '+ Tạo mới / Nhân bản từ Đề mẫu'}
            </button>
          </div>
        )}

        <div className="p-5 overflow-y-auto flex-1 text-xs space-y-4">
          {tab === 'list' ? (
            <>
              {uniqueSchools.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSchoolFilter('ALL')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      schoolFilter === 'ALL'
                        ? 'bg-slate-900 text-white'
                        : 'bg-neutral-100 text-slate-700 hover:bg-neutral-200/70'
                    }`}
                  >
                    {isEn ? 'All Schools' : 'Tất cả trường'} ({uniqueSchools.length})
                  </button>
                  {uniqueSchools.map(sc => (
                    <button
                      key={sc}
                      type="button"
                      onClick={() => setSchoolFilter(sc)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        schoolFilter === sc
                          ? 'bg-slate-900 text-white'
                          : 'bg-neutral-100 text-slate-700 hover:bg-neutral-200/70'
                      }`}
                    >
                      {sc}
                    </button>
                  ))}
                </div>
              )}

              {groupedBySchool.map(group => {
                const schoolTotalGraded = group.profiles.reduce(
                  (sum, prof) => sum + allResults.filter(r => r.profileId === prof.id).length,
                  0
                );
                return (
                  <div key={group.school} className="space-y-2">
                    <div className="flex items-center justify-between text-xs pb-1 border-b border-neutral-200">
                      <span className="font-bold text-slate-900">{group.school}</span>
                      <span className="text-slate-500 tabular-nums">
                        {group.profiles.length} {isEn ? 'templates' : 'bộ đề mẫu'} · {schoolTotalGraded}{' '}
                        {isEn ? 'students' : 'bài đã lưu'}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {group.profiles.map(prof => {
                        const count = allResults.filter(r => r.profileId === prof.id).length;
                        const qCount = (prof.parts || []).reduce((s, p) => s + (p.items?.length || 0), 0);
                        const imgCount = countProfileImages(prof);
                        const active = prof.id === selectedProfileId;
                        return (
                          <div
                            key={prof.id}
                            className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                              active ? 'border-slate-900 bg-neutral-50' : 'border-neutral-200 bg-white'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm text-slate-900 truncate">
                                  {prof.gradeName}
                                  {prof.classLabel ? ` · ${isEn ? 'Class' : 'Lớp'} ${prof.classLabel}` : ''}
                                </span>
                                {imgCount > 0 && (
                                  <span className="px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-[10px] font-semibold text-emerald-700 shrink-0">
                                    {isEn ? `Template (${imgCount} pics)` : `Đề mẫu (${imgCount} hình)`}
                                  </span>
                                )}
                              </div>
                              <div className="text-slate-600 truncate">{prof.examTitle}</div>
                              <div className="mt-0.5 text-slate-500 tabular-nums">
                                {prof.parts.length} parts · {qCount} {isEn ? 'questions' : 'câu'} ·{' '}
                                {isEn ? 'Scale' : 'Thang'} {prof.maxScore} ·{' '}
                                <span className="font-medium text-slate-700">
                                  {count} {isEn ? 'saved scores' : 'điểm đã lưu'}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {canManageExams && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    applyTemplateToForm(prof);
                                    setTab('create');
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 text-indigo-800 font-medium inline-flex items-center gap-1 whitespace-nowrap"
                                  title={isEn ? 'Use as template for another class/school' : 'Dùng đề này làm mẫu tạo cho lớp/trường khác'}
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>{isEn ? 'Use Template' : 'Dùng làm mẫu'}</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectProfile(prof.id);
                                  onClose();
                                }}
                                className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-800 whitespace-nowrap"
                              >
                                {active ? (isEn ? 'Selected' : 'Đang chọn') : isEn ? 'Select' : 'Chọn'}
                              </button>
                              {canManageExams && examProfiles.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => onDeleteProfile(prof.id)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            <form onSubmit={handleSaveNew} className="space-y-4">
              <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/60 space-y-2">
                <label className="block text-indigo-950 font-semibold">
                  {isEn
                    ? '1. Choose Base Exam Template (keeps all cropped images & answer key if no new PDF is uploaded)'
                    : '1. Chọn từ Đề mẫu đã làm xong (Giữ nguyên toàn bộ hình đã cắt & đáp án nếu không nạp PDF mới)'}
                </label>
                <select
                  value={templateProfileId}
                  onChange={e => {
                    const found = examProfiles.find(p => p.id === e.target.value);
                    if (found) {
                      applyTemplateToForm(found);
                    } else {
                      setTemplateProfileId(e.target.value);
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-indigo-200 bg-white text-slate-900 font-medium"
                >
                  {examProfiles.map(prof => {
                    const imgs = countProfileImages(prof);
                    const qs = (prof.parts || []).reduce((s, p) => s + (p.items?.length || 0), 0);
                    return (
                      <option key={prof.id} value={prof.id}>
                        {prof.schoolName ? `${prof.schoolName} · ` : ''}
                        {prof.gradeName} — {prof.examTitle} ({qs} câu, {imgs} hình đã cắt)
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-slate-600 font-medium mb-1">
                    {isEn ? 'School Name *' : 'Tên Trường *'}
                  </label>
                  <input
                    type="text"
                    list="existing-schools-list"
                    placeholder={isEn ? 'e.g. Nguyen Binh Khiem Primary School' : 'VD: Tiểu học Nguyễn Bỉnh Khiêm'}
                    value={schoolName}
                    onChange={e => setSchoolName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-slate-900 focus:outline-none focus:border-slate-900"
                  />
                  <datalist id="existing-schools-list">
                    {uniqueSchools.map(sc => (
                      <option key={sc} value={sc} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-slate-600 font-medium mb-1">
                    {isEn ? 'Grade Name *' : 'Khối lớp *'}
                  </label>
                  <input
                    type="text"
                    placeholder={isEn ? 'e.g. Grade 4 (Movers)' : 'VD: Khối 4 (Movers)'}
                    value={gradeName}
                    onChange={e => setGradeName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-slate-900 focus:outline-none focus:border-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-medium mb-1">
                    {isEn ? 'Specific Class (optional)' : 'Lớp cụ thể (tùy chọn)'}
                  </label>
                  <input
                    type="text"
                    placeholder={isEn ? 'e.g. 4A1 (leave blank for all classes)' : 'VD: 4A1 (để trống nếu dùng chung cả khối)'}
                    value={classLabel}
                    onChange={e => setClassLabel(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-slate-900 focus:outline-none focus:border-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-medium mb-1">{isEn ? 'Exam Title' : 'Tên đề thi'}</label>
                  <input
                    type="text"
                    placeholder="Final Test 01"
                    value={examTitle}
                    onChange={e => setExamTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-slate-900 focus:outline-none focus:border-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-medium mb-1">{isEn ? 'Cambridge Level' : 'Cấp độ'}</label>
                  <select
                    value={examLevel}
                    onChange={e => setExamLevel(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-slate-900"
                  >
                    <option value="Cambridge Pre-A1 Starters">Cambridge Pre-A1 Starters</option>
                    <option value="Cambridge A1 Movers">Cambridge A1 Movers</option>
                    <option value="Cambridge A2 Flyers">Cambridge A2 Flyers</option>
                    <option value="Cambridge KET / PET">Cambridge KET / PET</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-600 font-medium mb-1">{isEn ? 'Pages/Student' : 'Trang/HS'}</label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={pagesPerStudent}
                      onChange={e => setPagesPerStudent(Number(e.target.value) || 9)}
                      className="w-full px-3 py-2 rounded-lg border border-neutral-200 font-mono text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 font-medium mb-1">{isEn ? 'Max Score' : 'Thang điểm'}</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={maxScore}
                      onChange={e => setMaxScore(Number(e.target.value) || 10)}
                      className="w-full px-3 py-2 rounded-lg border border-neutral-200 font-mono text-slate-900"
                    />
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50 space-y-3">
                <div>
                  <div className="font-semibold text-slate-800">
                    {isEn
                      ? 'Optional: Upload New Blank Exam + Answer Key (leave empty to keep selected template)'
                      : 'Tùy chọn: Nạp Đề trắng & Đề đáp án mới (Bỏ trống nếu muốn giữ nguyên toàn bộ hình & đáp án của Đề mẫu đã chọn ở trên)'}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {isEn
                      ? 'Blank exam builds complete student prompts; answer key supplies exact grading answers.'
                      : 'Nếu bạn chỉ muốn lấy đề mẫu vừa làm xong áp dụng cho lớp/trường khác, không cần tải lại file PDF.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="p-3 rounded-lg border border-dashed border-neutral-300 bg-white space-y-2">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-slate-800 inline-flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-500" />
                        <span>{isEn ? '1. Blank Exam' : '1. Đề trắng (học sinh)'}</span>
                      </span>
                      {blankExamImages.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setBlankFileName('');
                            setBlankExamImages([]);
                          }}
                          className="text-slate-400 hover:text-slate-700"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <input ref={blankFileRef} type="file" accept=".pdf,image/*" onChange={handleBlankFileChange} className="hidden" />
                    <button
                      type="button"
                      onClick={() => blankFileRef.current?.click()}
                      className="w-full px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-slate-800 font-medium flex items-center justify-center gap-1.5 truncate"
                    >
                      {blankExamImages.length > 0 ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                          <span className="truncate text-emerald-700">
                            {blankFileName} ({blankExamImages.length})
                          </span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-3.5 h-3.5 shrink-0" />
                          <span>{isEn ? 'Choose Blank PDF / Img' : 'Chọn tệp đề trắng'}</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="p-3 rounded-lg border border-dashed border-neutral-300 bg-white space-y-2">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-slate-800 inline-flex items-center gap-1.5">
                        <FileCheck2 className="w-3.5 h-3.5 text-indigo-600" />
                        <span>{isEn ? '2. Answer Key' : '2. Đề có đáp án'}</span>
                      </span>
                      {answerKeyImages.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setSourceFileName('');
                            setAnswerKeyImages([]);
                          }}
                          className="text-slate-400 hover:text-slate-700"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <input ref={keyFileRef} type="file" accept=".pdf,image/*" onChange={handleKeyFileChange} className="hidden" />
                    <button
                      type="button"
                      onClick={() => keyFileRef.current?.click()}
                      className="w-full px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-slate-800 font-medium flex items-center justify-center gap-1.5 truncate"
                    >
                      {answerKeyImages.length > 0 ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                          <span className="truncate text-emerald-700">
                            {sourceFileName} ({answerKeyImages.length})
                          </span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-3.5 h-3.5 shrink-0" />
                          <span>{isEn ? 'Choose Key PDF / Img' : 'Chọn tệp đáp án'}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <textarea
                  rows={3}
                  placeholder={isEn ? 'Optional: paste plain-text answer key notes...' : 'Tùy chọn: dán văn bản đáp án chuẩn tại đây...'}
                  value={answerKeyText}
                  onChange={e => setAnswerKeyText(e.target.value)}
                  className="w-full p-3 rounded-lg border border-neutral-200 bg-white font-mono text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={isProcessing}
                className="w-full py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-semibold flex items-center justify-center gap-2"
              >
                <Sparkles className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`} />
                <span>
                  {isProcessing
                    ? isEn
                      ? 'Analyzing & Saving...'
                      : 'AI đang bóc tách & lưu...'
                    : isEn
                      ? 'Create Grade Exam'
                      : 'Lưu bộ đề mới'}
                </span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 3. TEACHER ACCOUNTS & RBAC MODAL (ADMIN ONLY)
// ============================================================================
export function TeacherAccountsModal({
  accounts,
  sessionCode,
  onCreateAccount,
  onToggleActive,
  onTogglePermission,
  onDeleteAccount,
  onClose
}: {
  accounts: TeacherAccount[];
  sessionCode: string;
  onCreateAccount: (payload: {
    fullName: string;
    username: string;
    password: string;
    permissions: UserPermissions;
  }) => Promise<void>;
  onToggleActive: (acc: TeacherAccount) => Promise<void>;
  onTogglePermission: (acc: TeacherAccount, key: keyof UserPermissions) => Promise<void>;
  onDeleteAccount: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [perms, setPerms] = useState<UserPermissions>({
    canGrade: true,
    canViewExport: true,
    canPrintSheet: true,
    canManageExams: false,
    canDeleteResults: false
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !username.trim() || !password.trim()) return;
    setSubmitting(true);
    try {
      await onCreateAccount({ fullName: fullName.trim(), username: username.trim(), password: password.trim(), permissions: perms });
      setFullName('');
      setUsername('');
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="bg-white border border-neutral-200 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
        <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">Phân quyền giáo viên ({accounts.length})</h3>
            <p className="text-xs text-slate-500">
              Phòng <span className="font-mono font-semibold text-slate-800">{sessionCode}</span> · Mật khẩu được băm an toàn trên máy chủ
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-neutral-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-5 text-xs">
          <form onSubmit={handleSubmit} className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 space-y-3">
            <div className="font-semibold text-slate-800">Tạo tài khoản giáo viên mới</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input
                type="text"
                placeholder="Họ và tên GV"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                className="px-3 py-2 rounded-lg border border-neutral-200 bg-white text-slate-900"
              />
              <input
                type="text"
                placeholder="Tên đăng nhập"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="px-3 py-2 rounded-lg border border-neutral-200 bg-white font-mono text-slate-900"
              />
              <input
                type="password"
                placeholder="Mật khẩu (>= 4 ký tự)"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="px-3 py-2 rounded-lg border border-neutral-200 bg-white font-mono text-slate-900"
              />
            </div>

            <div className="flex flex-wrap gap-3 pt-1">
              {(
                [
                  { key: 'canGrade', label: 'Chấm bài' },
                  { key: 'canViewExport', label: 'Xuất Excel' },
                  { key: 'canPrintSheet', label: 'In phiếu' },
                  { key: 'canManageExams', label: 'Quản lý đề' },
                  { key: 'canDeleteResults', label: 'Xóa điểm' }
                ] as const
              ).map(p => (
                <label key={p.key} className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={perms[p.key]}
                    onChange={e => setPerms(prev => ({ ...prev, [p.key]: e.target.checked }))}
                    className="accent-slate-900"
                  />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-semibold inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{submitting ? 'Đang tạo...' : 'Cấp tài khoản'}</span>
            </button>
          </form>

          <div className="divide-y divide-neutral-200 border border-neutral-200 rounded-xl overflow-hidden">
            {accounts.length === 0 ? (
              <div className="py-10 text-center text-slate-400">Chưa có tài khoản giáo viên nào.</div>
            ) : (
              accounts.map(acc => (
                <div key={acc.id} className="p-3.5 bg-white space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-sm text-slate-900">{acc.fullName}</span>
                      <span className="ml-2 font-mono text-slate-500">@{acc.username}</span>
                      {!acc.active && <span className="ml-2 text-rose-700 font-medium">· Đang khóa</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onToggleActive(acc)}
                        className="px-2.5 py-1 rounded-md border border-neutral-200 hover:bg-neutral-50 text-slate-700 font-medium"
                      >
                        {acc.active ? 'Tạm khóa' : 'Mở khóa'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteAccount(acc.id)}
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 text-slate-600">
                    {(
                      [
                        { key: 'canGrade', label: 'Chấm bài' },
                        { key: 'canViewExport', label: 'Xuất Excel' },
                        { key: 'canPrintSheet', label: 'In phiếu' },
                        { key: 'canManageExams', label: 'Quản lý đề' },
                        { key: 'canDeleteResults', label: 'Xóa điểm' }
                      ] as const
                    ).map(p => (
                      <label key={p.key} className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(acc.permissions[p.key])}
                          onChange={() => onTogglePermission(acc, p.key)}
                          className="accent-slate-900"
                        />
                        <span>{p.label}</span>
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
  );
}

// ============================================================================
// 4. BRANDING & LOGO MODAL (ADMIN ONLY)
// ============================================================================
export function BrandingModal({
  branding,
  onSave,
  onClose,
  onNotify
}: {
  branding: SystemBranding;
  onSave: (next: SystemBranding) => Promise<void>;
  onClose: () => void;
  onNotify: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const [draft, setDraft] = useState<SystemBranding>(branding);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 360, 0.9);
      setDraft(prev => ({ ...prev, logoDataUrl: compressed.dataUrl }));
    } catch (err: any) {
      onNotify(err?.message || 'Lỗi tải ảnh logo.', 'error');
    }
    e.target.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="bg-white border border-neutral-200 rounded-2xl max-w-xl w-full overflow-hidden flex flex-col shadow-xl">
        <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">Tùy chỉnh thương hiệu & Logo</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-neutral-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs overflow-y-auto max-h-[80vh]">
          <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
            <div className="flex items-center gap-3">
              {draft.logoDataUrl ? (
                <img
                  src={draft.logoDataUrl}
                  alt="Logo preview"
                  style={{ width: `${draft.logoWidth}px`, height: `${draft.logoHeight}px` }}
                  className="object-contain rounded"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold">
                  C
                </div>
              )}
              <div>
                <div className="font-semibold text-sm text-slate-900">{draft.appName}</div>
                <div className="text-slate-500">{draft.appSubtitle}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 font-medium text-slate-800"
              >
                Tải logo
              </button>
              {draft.logoDataUrl && (
                <button
                  type="button"
                  onClick={() => setDraft(prev => ({ ...prev, logoDataUrl: '' }))}
                  className="px-2.5 py-1.5 rounded-lg text-rose-700 hover:bg-rose-50 font-medium"
                >
                  Xóa
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-600 font-medium mb-1">Tên ứng dụng</label>
              <input
                type="text"
                value={draft.appName}
                onChange={e => setDraft(prev => ({ ...prev, appName: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-slate-900"
              />
            </div>
            <div>
              <label className="block text-slate-600 font-medium mb-1">Mô tả ngắn</label>
              <input
                type="text"
                value={draft.appSubtitle}
                onChange={e => setDraft(prev => ({ ...prev, appSubtitle: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-slate-900"
              />
            </div>
            <div>
              <label className="block text-slate-600 font-medium mb-1">Tiêu đề phiếu in PDF</label>
              <input
                type="text"
                value={draft.sheetHeaderTitle}
                onChange={e => setDraft(prev => ({ ...prev, sheetHeaderTitle: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-slate-900"
              />
            </div>
            <div>
              <label className="block text-slate-600 font-medium mb-1">Chân trang phiếu in PDF</label>
              <input
                type="text"
                value={draft.sheetFooterNote}
                onChange={e => setDraft(prev => ({ ...prev, sheetFooterNote: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-slate-900"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-neutral-200">
            <button
              type="button"
              onClick={() => setDraft(DEFAULT_SYSTEM_BRANDING)}
              className="px-3 py-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-slate-700 font-medium"
            >
              Mặc định
            </button>
            <button
              type="button"
              onClick={async () => {
                await onSave(draft);
                onClose();
              }}
              className="px-5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold"
            >
              Lưu thay đổi
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 5. BACKUP & RESTORE MODAL (ADMIN ONLY)
// ============================================================================
export function BackupModal({
  sessionCode,
  examProfiles,
  allResults,
  tasks,
  branding,
  sheetUrl,
  onRestore,
  onClose,
  onNotify
}: {
  sessionCode: string;
  examProfiles: ExamProfile[];
  allResults: StudentResult[];
  tasks: SmartTask[];
  branding: SystemBranding;
  sheetUrl: string;
  onRestore: (payload: any) => Promise<void>;
  onClose: () => void;
  onNotify: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const restoreRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const payload = {
      app: 'Cambridge Grader & Smart Tasks Backup',
      exportedAt: new Date().toISOString(),
      sessionCode,
      systemBranding: branding,
      googleSheetWebhookUrl: sheetUrl,
      examProfiles,
      tasks,
      allResults: allResults.map(({ pages: _p, ...rest }) => ({ ...rest, pages: [] }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Backup_${sessionCode}_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    onNotify('Đã tải xuống tệp sao lưu JSON.', 'success');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      await onRestore(parsed);
      onClose();
    } catch (err: any) {
      onNotify(err?.message || 'Tệp sao lưu không hợp lệ.', 'error');
    }
    e.target.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="bg-white border border-neutral-200 rounded-2xl max-w-lg w-full overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">Sao lưu & Khôi phục dữ liệu</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-neutral-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          <div className="grid grid-cols-3 bg-neutral-50 border border-neutral-200 rounded-xl divide-x divide-neutral-200 text-center">
            <div className="p-3">
              <div className="text-lg font-bold text-slate-900 tabular-nums">{examProfiles.length}</div>
              <div className="text-slate-500">Bộ đề</div>
            </div>
            <div className="p-3">
              <div className="text-lg font-bold text-slate-900 tabular-nums">{allResults.length}</div>
              <div className="text-slate-500">Bài chấm</div>
            </div>
            <div className="p-3">
              <div className="text-lg font-bold text-slate-900 tabular-nums">{tasks.length}</div>
              <div className="text-slate-500">Công việc</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleExport}
              className="py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold flex items-center justify-center gap-2"
            >
              <DownloadCloud className="w-4 h-4" />
              <span>Tải file sao lưu (.JSON)</span>
            </button>

            <div>
              <input ref={restoreRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
              <button
                type="button"
                onClick={() => restoreRef.current?.click()}
                className="w-full py-3 px-4 rounded-xl border border-neutral-300 bg-white hover:bg-neutral-50 text-slate-900 font-semibold flex items-center justify-center gap-2"
              >
                <UploadCloud className="w-4 h-4" />
                <span>Nạp dữ liệu (.JSON)</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 6. GOOGLE SHEETS MODAL (ADMIN ONLY)
// ============================================================================
const APPS_SCRIPT_SNIPPET = `function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Thời gian", "Mã phòng", "Khối", "Bộ đề", "Họ và tên", "Lớp", "Trường", "Listening", "R&W", "Tổng điểm", "Số câu đúng", "Số Khiên", "GV Chấm", "Chi tiết câu sai"]);
  }
  var d = JSON.parse(e.postData.contents);
  sheet.appendRow([d.timestamp, d.sessionCode, d.gradeName, d.examTitle, d.studentName, d.className, d.schoolName, d.listeningScore, d.rwScore, d.score, d.correctCount, d.shields, d.gradedBy, d.wrongDetails]);
  return ContentService.createTextOutput(JSON.stringify({status: "ok"})).setMimeType(ContentService.MimeType.JSON);
}`;

export function GoogleSheetsModal({
  sheetUrl,
  totalResults,
  onSaveUrl,
  onSyncAll,
  onClose,
  onNotify
}: {
  sheetUrl: string;
  totalResults: number;
  onSaveUrl: (url: string) => Promise<void>;
  onSyncAll: () => Promise<void>;
  onClose: () => void;
  onNotify: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const [urlDraft, setUrlDraft] = useState(sheetUrl);
  const [syncing, setSyncing] = useState(false);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="bg-white border border-neutral-200 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
        <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">Đồng bộ Google Sheets</h3>
            <p className="text-xs text-slate-500">Tự động đẩy bảng điểm mới về Google Trang tính qua Apps Script</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-neutral-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          <div className="space-y-2">
            <label className="block font-semibold text-slate-700">Google Apps Script Web App URL (HTTPS)</label>
            <div className="flex gap-2">
              <input
                type="url"
                placeholder="https://script.google.com/macros/s/.../exec"
                value={urlDraft}
                onChange={e => setUrlDraft(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-neutral-200 font-mono text-xs text-slate-900"
              />
              <button
                type="button"
                onClick={() => onSaveUrl(urlDraft)}
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold shrink-0"
              >
                Lưu URL
              </button>
            </div>
            {sheetUrl && (
              <button
                type="button"
                disabled={syncing || totalResults === 0}
                onClick={async () => {
                  setSyncing(true);
                  try {
                    await onSyncAll();
                  } finally {
                    setSyncing(false);
                  }
                }}
                className="px-3.5 py-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-slate-800 font-medium inline-flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                <span>Đồng bộ toàn bộ {totalResults} bài hiện có sang Sheet</span>
              </button>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700">Mã Apps Script (Extensions → Apps Script → Deploy Web App)</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(APPS_SCRIPT_SNIPPET).catch(() => {});
                  onNotify('Đã sao chép mã Apps Script.', 'success');
                }}
                className="inline-flex items-center gap-1 text-indigo-700 hover:underline font-medium"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Sao chép</span>
              </button>
            </div>
            <pre className="p-3.5 rounded-xl bg-slate-900 text-neutral-100 font-mono text-[11px] overflow-x-auto leading-relaxed">
              {APPS_SCRIPT_SNIPPET}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
