import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Camera,
  CheckSquare,
  Cloud,
  Database,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Layers,
  LogOut,
  Menu,
  Sliders,
  Users,
  X
} from 'lucide-react';
import { AuthView } from './components/AuthView';
import { SmartTasksView } from './components/SmartTasksView';
import { OmrScanView } from './components/OmrScanView';
import { BatchPdfView } from './components/BatchPdfView';
import { AnswerSheetKeyView } from './components/AnswerSheetKeyView';
import { ScoreboardView } from './components/ScoreboardView';
import {
  BackupModal,
  BrandingModal,
  ExamBankModal,
  GoogleSheetsModal,
  ReviewStudentModal,
  TeacherAccountsModal
} from './components/Modals';
import { apiRequest, getAuthToken, pushAllLocalToFirestore, setAuthToken } from './utils/api';
import { checkHybridAnswerMatch, computeCambridgeShields } from './utils/grading';
import { DEFAULT_SYSTEM_BRANDING, INITIAL_EXAM_PROFILES } from './data/initialData';
import type {
  ExamProfile,
  SmartTask,
  StudentResult,
  SystemBranding,
  TeacherAccount,
  UiLang,
  UserPermissions,
  WorkspaceSection
} from './types';

export default function App() {
  const [sessionCode, setSessionCode] = useState('CAMBRIDGE-2026');
  const [currentAccount, setCurrentAccount] = useState<TeacherAccount | null>(null);
  const [teacherName, setTeacherName] = useState('Administrator');
  const [lang, setLang] = useState<UiLang>('vi');

  // Core workspace state (persisted on server & shared Firestore)
  const [examProfiles, setExamProfiles] = useState<ExamProfile[]>(INITIAL_EXAM_PROFILES);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(INITIAL_EXAM_PROFILES[0].id);
  const [allResults, setAllResults] = useState<StudentResult[]>([]);
  const [tasks, setTasks] = useState<SmartTask[]>([]);
  const [teacherAccounts, setTeacherAccounts] = useState<TeacherAccount[]>([]);
  const [branding, setBranding] = useState<SystemBranding>(DEFAULT_SYSTEM_BRANDING);
  const [sheetUrl, setSheetUrl] = useState('');

  // Navigation & UI state
  const [activeSection, setActiveSection] = useState<WorkspaceSection>('tasks');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [paperSize, setPaperSize] = useState<'A4' | 'A5'>('A4');
  const [latestOmrId, setLatestOmrId] = useState<string | null>(null);

  // Modals
  const [reviewStudentId, setReviewStudentId] = useState<string | null>(null);
  const [examBankOpen, setExamBankOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [brandingOpen, setBrandingOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [sheetsOpen, setSheetsOpen] = useState(false);

  // Minimalist Toast
  const [toast, setToast] = useState<{ id: number; message: string; type: 'info' | 'success' | 'warning' | 'error' } | null>(null);
  const notify = useCallback((message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const id = Date.now();
    setToast({ id, message, type });
    setTimeout(() => {
      setToast(prev => (prev && prev.id === id ? null : prev));
    }, 3600);
  }, []);

  const hasPermission = useCallback(
    (perm: keyof UserPermissions): boolean => {
      if (!currentAccount) return false;
      if (currentAccount.role === 'admin') return true;
      return Boolean(currentAccount.permissions?.[perm]);
    },
    [currentAccount]
  );

  const [cloudSyncing, setCloudSyncing] = useState(false);

  // Restore saved session token on startup
  useEffect(() => {
    if (!getAuthToken()) return;
    apiRequest<{ sessionCode: string; account: TeacherAccount }>('/api/auth/me')
      .then(res => {
        setSessionCode(res.sessionCode);
        setCurrentAccount(res.account);
        setTeacherName(res.account.fullName || res.account.username);
        setLang(res.account.role === 'admin' ? 'vi' : 'en');
      })
      .catch(() => {
        setAuthToken(null);
      });
  }, []);

  // Load full workspace when authenticated (automatically connects & merges with shared Firestore)
  const loadWorkspace = useCallback(async () => {
    const data = await apiRequest<{
      sessionCode: string;
      examProfiles: ExamProfile[];
      allResults: StudentResult[];
      tasks: SmartTask[];
      systemBranding: SystemBranding;
      googleSheetWebhookUrl: string;
      teacherAccounts: TeacherAccount[];
    }>('/api/workspace');

    setSessionCode(data.sessionCode);
    setExamProfiles(data.examProfiles);
    setSelectedProfileId(prev =>
      data.examProfiles.some(p => p.id === prev) ? prev : data.examProfiles[0]?.id || INITIAL_EXAM_PROFILES[0].id
    );
    setAllResults(data.allResults);
    setTasks(data.tasks);
    setBranding({ ...DEFAULT_SYSTEM_BRANDING, ...data.systemBranding });
    setSheetUrl(data.googleSheetWebhookUrl === 'CONFIGURED' ? '' : data.googleSheetWebhookUrl || '');
    setTeacherAccounts(data.teacherAccounts || []);
  }, []);

  useEffect(() => {
    if (!currentAccount) return;
    loadWorkspace().catch(err => notify(err?.message || 'Không thể tải dữ liệu phòng thi.', 'error'));
  }, [currentAccount, loadWorkspace, notify]);

  const handleRefreshCloud = async () => {
    setCloudSyncing(true);
    try {
      await pushAllLocalToFirestore(sessionCode);
      await loadWorkspace();
      notify('Đã đồng bộ dữ liệu chung cho tất cả người dùng.', 'success');
    } catch (err: any) {
      notify(err?.message || 'Không thể đồng bộ dữ liệu.', 'error');
    } finally {
      setCloudSyncing(false);
    }
  };

  const handleAuthenticated = (res: { token: string; sessionCode: string; account: TeacherAccount }) => {
    setAuthToken(res.token);
    setSessionCode(res.sessionCode);
    setCurrentAccount(res.account);
    setTeacherName(res.account.fullName || res.account.username);
    setLang(res.account.role === 'admin' ? 'vi' : 'en');
    notify(
      res.account.role === 'admin'
        ? `Xin chào, ${res.account.fullName}.`
        : `Welcome, ${res.account.fullName}.`,
      'success'
    );
  };

  const handleLogout = () => {
    setAuthToken(null);
    setCurrentAccount(null);
    setMobileMenuOpen(false);
  };

  // Derived data
  const currentProfile = useMemo(() => {
    return examProfiles.find(p => p.id === selectedProfileId) || examProfiles[0] || INITIAL_EXAM_PROFILES[0];
  }, [examProfiles, selectedProfileId]);

  const schoolNames = useMemo(() => {
    const names = Array.from(
      new Set(examProfiles.map(p => (p.schoolName || '').trim()).filter(Boolean))
    );
    return names;
  }, [examProfiles]);

  const activeSchoolName = (currentProfile.schoolName || '').trim();

  const profilesInActiveSchool = useMemo(() => {
    if (!activeSchoolName) return examProfiles;
    const matched = examProfiles.filter(p => (p.schoolName || '').trim() === activeSchoolName);
    return matched.length > 0 ? matched : examProfiles;
  }, [examProfiles, activeSchoolName]);

  const currentProfileResults = useMemo(() => {
    return allResults
      .filter(r => r.profileId === currentProfile.id)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [allResults, currentProfile.id]);

  const latestOmrResult = useMemo(() => {
    if (latestOmrId) {
      const hit = currentProfileResults.find(r => r.id === latestOmrId);
      if (hit) return hit;
    }
    return currentProfileResults[0] || null;
  }, [currentProfileResults, latestOmrId]);

  const reviewStudent = useMemo(
    () => allResults.find(r => r.id === reviewStudentId) || null,
    [allResults, reviewStudentId]
  );

  const openTaskCount = useMemo(() => tasks.filter(t => t.status !== 'done').length, [tasks]);

  // Persistence handlers
  const handleSaveProfile = async (profile: ExamProfile) => {
    const res = await apiRequest<{ profile: ExamProfile }>(`/api/workspace/profiles/${encodeURIComponent(profile.id)}`, {
      method: 'PUT',
      body: JSON.stringify(profile)
    });
    setExamProfiles(prev =>
      prev.some(p => p.id === res.profile.id)
        ? prev.map(p => (p.id === res.profile.id ? res.profile : p))
        : [res.profile, ...prev]
    );
  };

  const handleDeleteProfile = async (profileId: string) => {
    await apiRequest(`/api/workspace/profiles/${encodeURIComponent(profileId)}`, { method: 'DELETE' });
    setExamProfiles(prev => {
      const next = prev.filter(p => p.id !== profileId);
      if (selectedProfileId === profileId && next[0]) setSelectedProfileId(next[0].id);
      return next;
    });
    notify(lang === 'en' ? 'Exam profile removed.' : 'Đã xóa bộ đề khỏi kho.', 'info');
  };

  const handleSaveResult = async (record: StudentResult, overwriteDuplicate = true) => {
    const res = await apiRequest<{ record: StudentResult; wasUpdated: boolean }>(
      `/api/workspace/results/${encodeURIComponent(record.id)}?overwriteDuplicate=${overwriteDuplicate ? 'true' : 'false'}`,
      {
        method: 'PUT',
        body: JSON.stringify(record)
      }
    );
    setAllResults(prev =>
      prev.some(r => r.id === res.record.id)
        ? prev.map(r => (r.id === res.record.id ? res.record : r))
        : [res.record, ...prev]
    );
    return res;
  };

  const handleDeleteResult = async (studentId: string) => {
    await apiRequest(`/api/workspace/results/${encodeURIComponent(studentId)}`, { method: 'DELETE' });
    setAllResults(prev => prev.filter(r => r.id !== studentId));
    notify(lang === 'en' ? 'Result deleted.' : 'Đã xóa bản ghi bài chấm.', 'info');
  };

  const handleUpdateQuestion = async (
    studentId: string,
    qIdx: number,
    newStudentAns: string | null,
    forceCorrect: boolean | null
  ) => {
    const target = allResults.find(r => r.id === studentId);
    if (!target) return;

    const updatedQs = target.questions.map((q, idx) => {
      if (idx !== qIdx) return q;
      const ans = newStudentAns !== null ? newStudentAns : q.studentAnswer;
      const isCorr = forceCorrect !== null ? forceCorrect : checkHybridAnswerMatch(ans, q.correctAnswer, q.partType);
      return { ...q, studentAnswer: ans, isCorrect: isCorr };
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

    await handleSaveResult(
      {
        ...target,
        questions: updatedQs,
        correctCount,
        score,
        shields,
        listeningScore: listeningQs.length > 0 ? `${listeningCorrect}/${listeningQs.length}` : target.listeningScore,
        rwScore: rwQs.length > 0 ? `${rwCorrect}/${rwQs.length}` : target.rwScore,
        sectionBreakdown:
          listeningQs.length > 0
            ? `Listening ${listeningCorrect}/${listeningQs.length} · R&W ${rwCorrect}/${rwQs.length} · ${shields}/5 Shields`
            : `${shields}/5 Shields`,
        reviewed: true,
        status: 'completed'
      },
      false
    );
  };

  const handleUpdateStudentMeta = async (
    studentId: string,
    field: 'studentName' | 'className' | 'schoolName',
    value: string
  ) => {
    const target = allResults.find(r => r.id === studentId);
    if (!target) return;
    await handleSaveResult({ ...target, [field]: value }, false);
  };

  // Smart Task handlers
  const handleUpsertTask = async (task: SmartTask) => {
    setTasks(prev =>
      prev.some(t => t.id === task.id) ? prev.map(t => (t.id === task.id ? task : t)) : [task, ...prev]
    );
    try {
      const res = await apiRequest<{ task: SmartTask }>(`/api/workspace/tasks/${encodeURIComponent(task.id)}`, {
        method: 'PUT',
        body: JSON.stringify(task)
      });
      setTasks(prev => prev.map(t => (t.id === res.task.id ? res.task : t)));
    } catch (err: any) {
      notify(err?.message || 'Không thể lưu công việc.', 'error');
    }
  };

  const handleBulkUpsertTasks = async (incoming: SmartTask[]) => {
    try {
      const res = await apiRequest<{ tasks: SmartTask[] }>('/api/workspace/tasks/bulk', {
        method: 'POST',
        body: JSON.stringify({ tasks: incoming })
      });
      setTasks(res.tasks);
    } catch (err: any) {
      notify(err?.message || 'Không thể cập nhật danh sách công việc.', 'error');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    try {
      await apiRequest(`/api/workspace/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    } catch (err: any) {
      notify(err?.message || 'Không thể xóa công việc.', 'error');
    }
  };

  const handleCreateFollowUpFromReview = async (student: StudentResult) => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const maxScore = currentProfile.maxScore || 8;
    const newTask: SmartTask = {
      id: `task-st-${Date.now()}`,
      title:
        lang === 'en'
          ? `Follow up with ${student.studentName} (${student.score}/${maxScore})`
          : `Kèm cặp học sinh ${student.studentName} (${student.className} · ${student.score}/${maxScore}đ)`,
      description: student.sectionBreakdown,
      status: 'todo',
      priority: student.score < maxScore * 0.5 ? 'high' : 'medium',
      category: 'follow_up',
      dueDate: todayIso,
      estimatedMinutes: 15,
      focusMinutesLogged: 0,
      assignee: teacherName,
      linkedProfileId: student.profileId,
      linkedStudentId: student.id,
      subtasks: [
        {
          id: `sub-${Date.now()}-1`,
          title: lang === 'en' ? 'Review missed questions' : 'Xem lại các câu sai chính',
          done: false
        }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await handleUpsertTask(newTask);
    setReviewStudentId(null);
    setActiveSection('tasks');
    notify(
      lang === 'en' ? `Created follow-up task for ${student.studentName}.` : `Đã tạo công việc hỗ trợ cho ${student.studentName}.`,
      'success'
    );
  };

  if (!currentAccount) {
    return <AuthView initialSessionCode={sessionCode} onAuthenticated={handleAuthenticated} />;
  }

  const isEn = currentAccount.role !== 'admin' || lang === 'en';
  const navItems: Array<{
    id: WorkspaceSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }> = [
    { id: 'tasks', label: isEn ? 'Smart Tasks' : 'Công việc thông minh', icon: CheckSquare, count: openTaskCount },
    { id: 'omr', label: isEn ? 'Live Camera Scan' : 'Quét Camera tự động', icon: Camera },
    { id: 'batch', label: isEn ? 'Batch Class PDF' : 'Chấm PDF cả lớp', icon: Layers },
    { id: 'sheet', label: isEn ? 'Answer Sheet & Key' : 'Phiếu in & Đáp án', icon: FileText },
    { id: 'scoreboard', label: isEn ? 'Scoreboard' : 'Bảng điểm', icon: BarChart3, count: currentProfileResults.length }
  ];

  const activeNav = navItems.find(n => n.id === activeSection) || navItems[0];

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Brand Wordmark */}
      <div className="px-5 h-16 flex items-center justify-between border-b border-neutral-200 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {branding.logoDataUrl ? (
            <img
              src={branding.logoDataUrl}
              alt={branding.appName}
              referrerPolicy="no-referrer"
              style={{
                width: `${Math.min(34, Math.max(24, branding.logoWidth || 28))}px`,
                height: `${Math.min(34, Math.max(24, branding.logoHeight || 28))}px`
              }}
              className="object-contain shrink-0"
            />
          ) : (
            <div className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">
              C
            </div>
          )}
          <span className="font-display font-bold text-sm tracking-tight text-slate-900 truncate">
            {branding.appName}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-neutral-100"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Active School & Grade/Class Selector */}
      <div className="px-4 py-4 border-b border-neutral-200 space-y-2.5">
        <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
          <span>{isEn ? 'School & Grade' : 'Trường & Khối lớp'}</span>
          <button
            type="button"
            onClick={() => setExamBankOpen(true)}
            className="text-indigo-700 hover:underline font-medium"
          >
            {isEn ? '+ Add / Manage' : '+ Tạo / Kho đề'}
          </button>
        </div>

        {schoolNames.length > 0 && (
          <select
            value={activeSchoolName}
            onChange={e => {
              const targetSchool = e.target.value;
              const firstInSchool = examProfiles.find(p => (p.schoolName || '').trim() === targetSchool);
              if (firstInSchool) setSelectedProfileId(firstInSchool.id);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:border-slate-900"
            aria-label={isEn ? 'Select school' : 'Chọn trường'}
          >
            {schoolNames.map(sc => (
              <option key={sc} value={sc}>
                {sc}
              </option>
            ))}
          </select>
        )}

        <select
          value={selectedProfileId}
          onChange={e => setSelectedProfileId(e.target.value)}
          className="w-full px-2.5 py-2 rounded-lg border border-neutral-200 bg-neutral-50 text-xs font-semibold text-slate-900 focus:outline-none focus:border-slate-900"
          aria-label={isEn ? 'Select grade exam' : 'Chọn khối lớp và bộ đề'}
        >
          {profilesInActiveSchool.map(prof => (
            <option key={prof.id} value={prof.id}>
              {prof.gradeName}
              {prof.classLabel ? ` · ${prof.classLabel}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Primary Workspace Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map(item => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveSection(item.id);
                setMobileMenuOpen(false);
              }}
              className={`w-full px-3 py-2.5 rounded-lg text-xs font-medium flex items-center justify-between gap-2 transition-colors whitespace-nowrap ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-neutral-100 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </span>
              {typeof item.count === 'number' && item.count > 0 && (
                <span className={`font-mono text-[11px] tabular-nums ${active ? 'text-slate-300' : 'text-slate-400'}`}>
                  {item.count}
                </span>
              )}
            </button>
          );
        })}

        {/* Admin Utilities */}
        {currentAccount.role === 'admin' && (
          <div className="pt-5 mt-5 border-t border-neutral-200 space-y-1">
            <div className="px-3 pb-1 text-[11px] font-medium text-slate-400">
              {isEn ? 'Administration' : 'Quản trị hệ thống'}
            </div>
            <button
              type="button"
              onClick={() => {
                setExamBankOpen(true);
                setMobileMenuOpen(false);
              }}
              className="w-full px-3 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-neutral-100 hover:text-slate-900 flex items-center gap-2.5"
            >
              <FolderOpen className="w-4 h-4 text-slate-400" />
              <span>{isEn ? 'Exam Bank' : 'Kho đề & Đáp án'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAccountsOpen(true);
                setMobileMenuOpen(false);
              }}
              className="w-full px-3 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-neutral-100 hover:text-slate-900 flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2.5">
                <Users className="w-4 h-4 text-slate-400" />
                <span>{isEn ? 'Teachers & Roles' : 'Phân quyền GV'}</span>
              </span>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">{teacherAccounts.length}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSheetsOpen(true);
                setMobileMenuOpen(false);
              }}
              className="w-full px-3 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-neutral-100 hover:text-slate-900 flex items-center gap-2.5"
            >
              <FileSpreadsheet className="w-4 h-4 text-slate-400" />
              <span>Google Sheets</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setBrandingOpen(true);
                setMobileMenuOpen(false);
              }}
              className="w-full px-3 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-neutral-100 hover:text-slate-900 flex items-center gap-2.5"
            >
              <Sliders className="w-4 h-4 text-slate-400" />
              <span>{isEn ? 'Branding & Logo' : 'Giao diện & Logo'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setBackupOpen(true);
                setMobileMenuOpen(false);
              }}
              className="w-full px-3 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-neutral-100 hover:text-slate-900 flex items-center gap-2.5"
            >
              <Database className="w-4 h-4 text-slate-400" />
              <span>{isEn ? 'Backup & Restore' : 'Sao lưu & Nạp dữ liệu'}</span>
            </button>
          </div>
        )}
      </nav>

      {/* Footer Account & Language */}
      <div className="p-4 border-t border-neutral-200 space-y-2 shrink-0">
        <button
          type="button"
          disabled={cloudSyncing}
          onClick={handleRefreshCloud}
          className="w-full px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
        >
          <Cloud className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            {cloudSyncing
              ? isEn
                ? 'Syncing Shared Cloud...'
                : 'Đang đồng bộ dữ liệu...'
              : isEn
                ? 'Shared Cloud Active · Refresh'
                : 'Tự động lưu Cloud · Làm mới'}
          </span>
        </button>

        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="min-w-0">
            <div className="font-semibold text-slate-900 truncate">{currentAccount.fullName}</div>
            <div className="text-[11px] font-mono text-slate-500 truncate">{sessionCode}</div>
          </div>
          {currentAccount.role === 'admin' && (
            <button
              type="button"
              onClick={() => setLang(prev => (prev === 'vi' ? 'en' : 'vi'))}
              className="px-2 py-1 rounded border border-neutral-200 bg-neutral-50 text-[11px] font-mono font-semibold text-slate-700 hover:bg-neutral-100"
              title="Toggle language"
            >
              {lang.toUpperCase()}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full px-3 py-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-xs font-medium text-slate-700 flex items-center justify-center gap-1.5 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>{isEn ? 'Sign out' : 'Đăng xuất'}</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[252px] shrink-0 bg-white border-r border-neutral-200 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-[268px] bg-white h-full border-r border-neutral-200 shadow-xl">
            {sidebarContent}
          </div>
          <div className="flex-1 bg-slate-950/40" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Clean Single-Row Top Bar (Contextual Breadcrumb + Primary Action) */}
        <header className="h-16 bg-white border-b border-neutral-200 px-4 sm:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-neutral-100"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              {currentProfile.schoolName && (
                <>
                  <span className="text-slate-500 hidden md:inline truncate max-w-[200px]">
                    {currentProfile.schoolName}
                  </span>
                  <span className="text-slate-300 hidden md:inline">/</span>
                </>
              )}
              <span className="text-slate-400 hidden sm:inline whitespace-nowrap">
                {currentProfile.gradeName}
                {currentProfile.classLabel ? ` (${currentProfile.classLabel})` : ''}
              </span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <h1 className="font-display font-bold text-slate-900 truncate">{activeNav.label}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {activeSection !== 'tasks' ? (
              <button
                type="button"
                onClick={() => setActiveSection('tasks')}
                className="px-3.5 py-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-xs font-medium text-slate-700 whitespace-nowrap"
              >
                {isEn ? 'Smart Tasks' : 'Công việc'} ({openTaskCount})
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveSection('omr')}
                className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>{isEn ? 'Scan Sheet' : 'Chấm phiếu ngay'}</span>
              </button>
            )}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 w-full max-w-[1160px] mx-auto px-4 sm:px-8 py-6 sm:py-8">
          {activeSection === 'tasks' && (
            <SmartTasksView
              tasks={tasks}
              currentProfile={currentProfile}
              currentProfileResults={currentProfileResults}
              teacherName={teacherName}
              lang={isEn ? 'en' : 'vi'}
              onUpsertTask={handleUpsertTask}
              onBulkUpsertTasks={handleBulkUpsertTasks}
              onDeleteTask={handleDeleteTask}
              onNotify={notify}
            />
          )}

          {activeSection === 'omr' && (
            <OmrScanView
              currentProfile={currentProfile}
              currentProfileResults={currentProfileResults}
              latestResult={latestOmrResult}
              branding={branding}
              paperSize={paperSize}
              teacherName={teacherName}
              canGrade={hasPermission('canGrade')}
              lang={isEn ? 'en' : 'vi'}
              onSaveResult={handleSaveResult}
              onUpdateMeta={handleUpdateStudentMeta}
              onUpdateQuestion={handleUpdateQuestion}
              onOpenReview={id => setReviewStudentId(id)}
              onSelectLatestId={setLatestOmrId}
              onNotify={notify}
            />
          )}

          {activeSection === 'batch' && (
            <BatchPdfView
              currentProfile={currentProfile}
              teacherName={teacherName}
              canGrade={hasPermission('canGrade')}
              canManageExams={hasPermission('canManageExams')}
              lang={isEn ? 'en' : 'vi'}
              onUpdateProfileField={async (field, value) => {
                await handleSaveProfile({ ...currentProfile, [field]: value, updatedAt: Date.now() });
              }}
              onSaveResult={handleSaveResult}
              onGoToScoreboard={() => setActiveSection('scoreboard')}
              onNotify={notify}
            />
          )}

          {activeSection === 'sheet' && (
            <AnswerSheetKeyView
              currentProfile={currentProfile}
              branding={branding}
              paperSize={paperSize}
              onChangePaperSize={setPaperSize}
              canPrintSheet={hasPermission('canPrintSheet')}
              canManageExams={hasPermission('canManageExams')}
              lang={isEn ? 'en' : 'vi'}
              onSaveProfile={handleSaveProfile}
              onNotify={notify}
            />
          )}

          {activeSection === 'scoreboard' && (
            <ScoreboardView
              currentProfile={currentProfile}
              examProfiles={examProfiles}
              currentProfileResults={currentProfileResults}
              allResults={allResults}
              sessionCode={sessionCode}
              canViewExport={hasPermission('canViewExport')}
              canDeleteResults={hasPermission('canDeleteResults')}
              lang={isEn ? 'en' : 'vi'}
              onOpenReview={id => setReviewStudentId(id)}
              onDeleteResult={handleDeleteResult}
              onNotify={notify}
            />
          )}
        </main>
      </div>

      {/* Modals */}
      {reviewStudent && (
        <ReviewStudentModal
          student={reviewStudent}
          lang={isEn ? 'en' : 'vi'}
          onClose={() => setReviewStudentId(null)}
          onUpdateMeta={handleUpdateStudentMeta}
          onUpdateQuestion={handleUpdateQuestion}
          onCreateFollowUpTask={handleCreateFollowUpFromReview}
        />
      )}

      {examBankOpen && (
        <ExamBankModal
          examProfiles={examProfiles}
          selectedProfileId={selectedProfileId}
          allResults={allResults}
          canManageExams={hasPermission('canManageExams')}
          lang={isEn ? 'en' : 'vi'}
          onSelectProfile={setSelectedProfileId}
          onSaveProfile={handleSaveProfile}
          onDeleteProfile={handleDeleteProfile}
          onClose={() => setExamBankOpen(false)}
          onNotify={notify}
        />
      )}

      {accountsOpen && currentAccount.role === 'admin' && (
        <TeacherAccountsModal
          accounts={teacherAccounts}
          sessionCode={sessionCode}
          onCreateAccount={async payload => {
            try {
              const res = await apiRequest<{ account: TeacherAccount }>('/api/accounts', {
                method: 'POST',
                body: JSON.stringify(payload)
              });
              setTeacherAccounts(prev => [res.account, ...prev]);
              notify(`Đã cấp tài khoản cho "${res.account.fullName}".`, 'success');
            } catch (err: any) {
              notify(err?.message || 'Không thể tạo tài khoản giáo viên.', 'error');
            }
          }}
          onToggleActive={async acc => {
            try {
              const res = await apiRequest<{ account: TeacherAccount }>(`/api/accounts/${encodeURIComponent(acc.id)}`, {
                method: 'PATCH',
                body: JSON.stringify({ active: !acc.active })
              });
              setTeacherAccounts(prev => prev.map(a => (a.id === acc.id ? res.account : a)));
            } catch (err: any) {
              notify(err?.message || 'Không thể cập nhật trạng thái tài khoản.', 'error');
            }
          }}
          onTogglePermission={async (acc, key) => {
            try {
              const res = await apiRequest<{ account: TeacherAccount }>(`/api/accounts/${encodeURIComponent(acc.id)}`, {
                method: 'PATCH',
                body: JSON.stringify({ permissions: { [key]: !acc.permissions[key] } })
              });
              setTeacherAccounts(prev => prev.map(a => (a.id === acc.id ? res.account : a)));
            } catch (err: any) {
              notify(err?.message || 'Không thể cập nhật quyền giáo viên.', 'error');
            }
          }}
          onDeleteAccount={async id => {
            try {
              await apiRequest(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
              setTeacherAccounts(prev => prev.filter(a => a.id !== id));
              notify('Đã xóa tài khoản giáo viên.', 'info');
            } catch (err: any) {
              notify(err?.message || 'Không thể xóa tài khoản giáo viên.', 'error');
            }
          }}
          onClose={() => setAccountsOpen(false)}
        />
      )}

      {brandingOpen && currentAccount.role === 'admin' && (
        <BrandingModal
          branding={branding}
          onSave={async next => {
            try {
              const res = await apiRequest<{ systemBranding: SystemBranding }>('/api/workspace/branding', {
                method: 'PUT',
                body: JSON.stringify(next)
              });
              setBranding(res.systemBranding);
              notify('Đã lưu tùy chỉnh giao diện & logo.', 'success');
            } catch (err: any) {
              notify(err?.message || 'Không thể lưu tùy chỉnh giao diện.', 'error');
            }
          }}
          onClose={() => setBrandingOpen(false)}
          onNotify={notify}
        />
      )}

      {backupOpen && currentAccount.role === 'admin' && (
        <BackupModal
          sessionCode={sessionCode}
          examProfiles={examProfiles}
          allResults={allResults}
          tasks={tasks}
          branding={branding}
          sheetUrl={sheetUrl}
          onRestore={async payload => {
            try {
              const res = await apiRequest<{
                examProfiles: ExamProfile[];
                allResults: StudentResult[];
                tasks: SmartTask[];
                systemBranding: SystemBranding;
                googleSheetWebhookUrl: string;
              }>('/api/workspace/restore', {
                method: 'POST',
                body: JSON.stringify(payload)
              });
              setExamProfiles(res.examProfiles);
              if (res.examProfiles[0]) setSelectedProfileId(res.examProfiles[0].id);
              setAllResults(res.allResults);
              setTasks(res.tasks);
              setBranding(res.systemBranding);
              setSheetUrl(res.googleSheetWebhookUrl || '');
              notify('Đã khôi phục dữ liệu thành công.', 'success');
            } catch (err: any) {
              notify(err?.message || 'Không thể khôi phục dữ liệu.', 'error');
            }
          }}
          onClose={() => setBackupOpen(false)}
          onNotify={notify}
        />
      )}

      {sheetsOpen && currentAccount.role === 'admin' && (
        <GoogleSheetsModal
          sheetUrl={sheetUrl}
          totalResults={allResults.length}
          onSaveUrl={async url => {
            try {
              const res = await apiRequest<{ webhookUrl: string }>('/api/workspace/sheet-url', {
                method: 'PUT',
                body: JSON.stringify({ webhookUrl: url })
              });
              setSheetUrl(res.webhookUrl);
              notify(res.webhookUrl ? 'Đã lưu liên kết Google Sheets.' : 'Đã ngắt kết nối Google Sheets.', 'success');
            } catch (err: any) {
              notify(err?.message || 'Không thể lưu liên kết Google Sheets.', 'error');
            }
          }}
          onSyncAll={async () => {
            try {
              const res = await apiRequest<{ sent: number; total: number }>('/api/sheets/sync-all', {
                method: 'POST'
              });
              notify(`Đã đồng bộ ${res.sent}/${res.total} bài chấm sang Google Sheets.`, 'success');
            } catch (err: any) {
              notify(err?.message || 'Không thể đồng bộ Google Sheets.', 'error');
            }
          }}
          onClose={() => setSheetsOpen(false)}
          onNotify={notify}
        />
      )}

      {/* Minimalist Toast Notification */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-50 max-w-sm px-4 py-3 rounded-xl border text-xs font-medium shadow-lg ${
            toast.type === 'error'
              ? 'bg-rose-950 text-white border-rose-800'
              : toast.type === 'warning'
                ? 'bg-amber-950 text-white border-amber-800'
                : toast.type === 'success'
                  ? 'bg-slate-900 text-white border-slate-800'
                  : 'bg-white text-slate-900 border-neutral-200'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
