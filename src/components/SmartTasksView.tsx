import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Columns3,
  List,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Wand2
} from 'lucide-react';
import { apiRequest } from '../utils/api';
import type {
  ExamProfile,
  SmartTask,
  StudentResult,
  TaskCategory,
  TaskPriority,
  TaskStatus,
  UiLang
} from '../types';

interface SmartTasksViewProps {
  tasks: SmartTask[];
  currentProfile: ExamProfile;
  currentProfileResults: StudentResult[];
  teacherName: string;
  lang: UiLang;
  onUpsertTask: (task: SmartTask) => Promise<void>;
  onBulkUpsertTasks: (tasks: SmartTask[]) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onNotify: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3
};

export function SmartTasksView({
  tasks,
  currentProfile,
  currentProfileResults,
  teacherName,
  lang,
  onUpsertTask,
  onBulkUpsertTasks,
  onDeleteTask,
  onNotify
}: SmartTasksViewProps) {
  const isEn = lang === 'en';
  const todayIso = new Date().toISOString().slice(0, 10);

  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | TaskCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Quick capture (Manual or AI Breakdown)
  const [quickInput, setQuickInput] = useState('');
  const [quickPriority, setQuickPriority] = useState<TaskPriority>('medium');
  const [quickCategory, setQuickCategory] = useState<TaskCategory>('grading');
  const [quickDueDate, setQuickDueDate] = useState(todayIso);
  const [isAiBreakingDown, setIsAiBreakingDown] = useState(false);

  // AI Prioritization state
  const [isAiPrioritizing, setIsAiPrioritizing] = useState(false);
  const [focusAdvice, setFocusAdvice] = useState('');

  // Expanded task details + new subtask input
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [subtaskDraft, setSubtaskDraft] = useState('');

  // Focus Timer (Pomodoro)
  const [activeTimerTaskId, setActiveTimerTaskId] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [timerRunning, setTimerRunning] = useState(false);

  // Drag & drop on Kanban board
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (!timerRunning || !activeTimerTaskId) return;
    const interval = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          setTimerRunning(false);
          const task = tasks.find(t => t.id === activeTimerTaskId);
          if (task) {
            onUpsertTask({
              ...task,
              focusMinutesLogged: (task.focusMinutesLogged || 0) + 25
            });
            onNotify(
              isEn
                ? `Completed 25m focus session on "${task.title}"`
                : `Hoàn tất 25 phút tập trung cho "${task.title}"`,
              'success'
            );
          }
          return 25 * 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timerRunning, activeTimerTaskId, tasks, onUpsertTask, onNotify, isEn]);

  const priorityMeta = (p: TaskPriority) => {
    if (p === 'urgent') return { label: isEn ? 'Urgent' : 'Khẩn cấp', cls: 'text-rose-700 font-semibold' };
    if (p === 'high') return { label: isEn ? 'High' : 'Cao', cls: 'text-amber-700 font-semibold' };
    if (p === 'medium') return { label: isEn ? 'Medium' : 'Trung bình', cls: 'text-slate-700 font-medium' };
    return { label: isEn ? 'Low' : 'Thấp', cls: 'text-slate-400 font-normal' };
  };

  const categoryLabel = (c: TaskCategory) => {
    const map: Record<TaskCategory, { vi: string; en: string }> = {
      grading: { vi: 'Chấm thi', en: 'Grading' },
      preparation: { vi: 'Chuẩn bị đề', en: 'Exam Prep' },
      follow_up: { vi: 'Hỗ trợ HS', en: 'Follow-up' },
      admin: { vi: 'Hành chính', en: 'Admin' },
      general: { vi: 'Chung', en: 'General' }
    };
    return isEn ? map[c].en : map[c].vi;
  };

  const statusLabel = (s: TaskStatus) => {
    if (s === 'todo') return isEn ? 'To Do' : 'Cần làm';
    if (s === 'in_progress') return isEn ? 'In Progress' : 'Đang xử lý';
    return isEn ? 'Completed' : 'Hoàn thành';
  };

  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'done').length;
    const open = total - completed;
    const dueTodayOrOverdue = tasks.filter(
      t => t.status !== 'done' && t.dueDate && t.dueDate <= todayIso
    ).length;
    const totalFocusMins = tasks.reduce((sum, t) => sum + (t.focusMinutesLogged || 0), 0);
    const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, open, dueTodayOrOverdue, totalFocusMins, completionPct };
  }, [tasks, todayIso]);

  const filteredTasks = useMemo(() => {
    return tasks
      .filter(t => {
        if (statusFilter !== 'all' && t.status !== statusFilter) return false;
        if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const hit =
            t.title.toLowerCase().includes(q) ||
            (t.description || '').toLowerCase().includes(q) ||
            (t.assignee || '').toLowerCase().includes(q);
          if (!hit) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.status === 'done' && b.status !== 'done') return 1;
        if (a.status !== 'done' && b.status === 'done') return -1;
        const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (pDiff !== 0) return pDiff;
        if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
          return a.dueDate.localeCompare(b.dueDate);
        }
        return b.createdAt - a.createdAt;
      });
  }, [tasks, statusFilter, categoryFilter, searchQuery]);

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = quickInput.trim();
    if (!title) return;

    const newTask: SmartTask = {
      id: `task-${Date.now()}`,
      title,
      description: '',
      status: 'todo',
      priority: quickPriority,
      category: quickCategory,
      dueDate: quickDueDate,
      estimatedMinutes: 20,
      focusMinutesLogged: 0,
      assignee: teacherName || 'Admin',
      linkedProfileId: currentProfile.id,
      subtasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    setQuickInput('');
    await onUpsertTask(newTask);
    onNotify(isEn ? 'Task added.' : 'Đã thêm công việc mới.', 'success');
  };

  const handleAiBreakdown = async () => {
    const prompt = quickInput.trim();
    if (!prompt) {
      onNotify(
        isEn
          ? 'Enter a goal or messy note first for AI to break down.'
          : 'Nhập mục tiêu hoặc ghi chú để AI tự động chia nhỏ công việc.',
        'warning'
      );
      return;
    }

    setIsAiBreakingDown(true);
    try {
      const res = await apiRequest<{
        summary: string;
        tasks: Array<{
          title: string;
          description?: string;
          priority: string;
          category: string;
          dueDate?: string;
          estimatedMinutes?: number;
          assignee?: string;
          aiReason?: string;
          subtasks?: string[];
        }>;
      }>('/api/ai/tasks/breakdown', {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          contextGrade: `${currentProfile.gradeName} - ${currentProfile.examTitle}`,
          todayIso,
          defaultAssignee: teacherName
        })
      });

      const validP: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];
      const validC: TaskCategory[] = ['grading', 'preparation', 'follow_up', 'admin', 'general'];
      const now = Date.now();

      const generated: SmartTask[] = (res.tasks || []).map((item, idx) => ({
        id: `task-ai-${now}-${idx}`,
        title: item.title,
        description: item.description || '',
        status: 'todo',
        priority: validP.includes(item.priority as TaskPriority) ? (item.priority as TaskPriority) : 'medium',
        category: validC.includes(item.category as TaskCategory) ? (item.category as TaskCategory) : 'general',
        dueDate: item.dueDate || '',
        estimatedMinutes: Math.max(5, Number(item.estimatedMinutes) || 20),
        focusMinutesLogged: 0,
        assignee: item.assignee || teacherName || 'Admin',
        linkedProfileId: currentProfile.id,
        aiReason: item.aiReason || '',
        subtasks: (item.subtasks || []).map((st, sIdx) => ({
          id: `st-${now}-${idx}-${sIdx}`,
          title: st,
          done: false
        })),
        createdAt: now - idx * 100,
        updatedAt: now
      }));

      if (generated.length === 0) {
        onNotify(isEn ? 'AI returned no tasks.' : 'AI chưa tách được công việc nào.', 'warning');
      } else {
        await onBulkUpsertTasks(generated);
        setQuickInput('');
        if (res.summary) setFocusAdvice(res.summary);
        onNotify(
          isEn
            ? `AI created ${generated.length} structured tasks.`
            : `AI đã chia nhỏ thành ${generated.length} đầu việc ưu tiên.`,
          'success'
        );
      }
    } catch (err: any) {
      onNotify(err?.message || 'Lỗi AI lập kế hoạch.', 'error');
    } finally {
      setIsAiBreakingDown(false);
    }
  };

  const handleAiPrioritize = async () => {
    const openTasks = tasks.filter(t => t.status !== 'done');
    if (openTasks.length === 0) {
      onNotify(isEn ? 'No open tasks to prioritize.' : 'Không có công việc đang mở để sắp xếp.', 'info');
      return;
    }

    setIsAiPrioritizing(true);
    try {
      const res = await apiRequest<{
        focusAdvice: string;
        ranked: Array<{ id: string; priority: string; aiReason: string }>;
      }>('/api/ai/tasks/prioritize', {
        method: 'POST',
        body: JSON.stringify({
          tasks: openTasks,
          todayIso,
          lang
        })
      });

      const validP: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];
      const rankMap = new Map(res.ranked.map(r => [r.id, r]));
      const updated = openTasks.map(t => {
        const hit = rankMap.get(t.id);
        if (!hit) return t;
        return {
          ...t,
          priority: validP.includes(hit.priority as TaskPriority) ? (hit.priority as TaskPriority) : t.priority,
          aiReason: hit.aiReason || t.aiReason
        };
      });

      await onBulkUpsertTasks(updated);
      setFocusAdvice(res.focusAdvice || '');
      onNotify(
        isEn ? 'Tasks reprioritized by urgency & impact.' : 'Đã sắp xếp lại mức độ ưu tiên theo độ khẩn cấp & tác động.',
        'success'
      );
    } catch (err: any) {
      onNotify(err?.message || 'Lỗi AI sắp xếp ưu tiên.', 'error');
    } finally {
      setIsAiPrioritizing(false);
    }
  };

  const handleGenerateFromGrading = async () => {
    const maxScore = currentProfile.maxScore || 8;
    const lowScorers = currentProfileResults.filter(r => r.score < maxScore * 0.5);
    const unreviewed = currentProfileResults.filter(r => !r.reviewed);

    const existingStudentLinks = new Set(tasks.map(t => t.linkedStudentId).filter(Boolean));
    const now = Date.now();
    const toCreate: SmartTask[] = [];

    lowScorers.slice(0, 6).forEach((st, idx) => {
      if (existingStudentLinks.has(st.id)) return;
      toCreate.push({
        id: `task-follow-${st.id}-${now}`,
        title: isEn
          ? `Remedial follow-up: ${st.studentName} (${st.score}/${maxScore})`
          : `Kèm cặp bổ sung: ${st.studentName} (${st.className} · ${st.score}/${maxScore}đ)`,
        description: `${st.sectionBreakdown}. ${isEn ? 'Review wrong questions and share practice notes.' : 'Ôn lại các câu sai và gửi nhận xét phụ huynh.'}`,
        status: 'todo',
        priority: st.score < maxScore * 0.3 ? 'urgent' : 'high',
        category: 'follow_up',
        dueDate: todayIso,
        estimatedMinutes: 15,
        focusMinutesLogged: 0,
        assignee: st.gradedBy || teacherName || 'Admin',
        linkedProfileId: currentProfile.id,
        linkedStudentId: st.id,
        aiReason: isEn
          ? 'Auto-flagged from Cambridge grading score below 50%.'
          : 'Tự động tạo từ kết quả chấm điểm dưới 50%.',
        subtasks: [
          { id: `st-f1-${now}-${idx}`, title: isEn ? 'Inspect missed questions' : 'Kiểm tra các câu sai', done: false },
          { id: `st-f2-${now}-${idx}`, title: isEn ? 'Send brief parent note' : 'Gửi ghi chú ôn tập cho phụ huynh', done: false }
        ],
        createdAt: now - idx * 50,
        updatedAt: now
      });
    });

    if (unreviewed.length > 0 && !tasks.some(t => t.title.includes(currentProfile.gradeName) && t.status !== 'done' && t.category === 'grading')) {
      toCreate.push({
        id: `task-review-${now}`,
        title: isEn
          ? `Review ${unreviewed.length} pending papers in ${currentProfile.gradeName}`
          : `Duyệt lại ${unreviewed.length} bài chấm chờ kiểm tra (${currentProfile.gradeName})`,
        description: isEn
          ? 'Confirm handwritten answers before exporting final Excel report.'
          : 'Kiểm tra lại các câu viết tay trước khi chốt bảng điểm Excel.',
        status: 'todo',
        priority: 'high',
        category: 'grading',
        dueDate: todayIso,
        estimatedMinutes: unreviewed.length * 3,
        focusMinutesLogged: 0,
        assignee: teacherName || 'Admin',
        linkedProfileId: currentProfile.id,
        subtasks: [],
        createdAt: now,
        updatedAt: now
      });
    }

    if (toCreate.length === 0) {
      onNotify(
        isEn
          ? 'No new follow-up tasks needed from current grading results.'
          : 'Chưa có bài dưới chuẩn hoặc bài chờ duyệt mới để tạo việc tự động.',
        'info'
      );
      return;
    }

    await onBulkUpsertTasks(toCreate);
    onNotify(
      isEn
        ? `Generated ${toCreate.length} smart tasks from grading results.`
        : `Đã tạo tự động ${toCreate.length} công việc từ dữ liệu chấm thi.`,
      'success'
    );
  };

  const toggleTaskComplete = (task: SmartTask) => {
    const nextStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done';
    onUpsertTask({ ...task, status: nextStatus });
  };

  const toggleSubtask = (task: SmartTask, subId: string) => {
    const updatedSubs = task.subtasks.map(s => (s.id === subId ? { ...s, done: !s.done } : s));
    onUpsertTask({ ...task, subtasks: updatedSubs });
  };

  const addSubtask = (task: SmartTask) => {
    const text = subtaskDraft.trim();
    if (!text) return;
    onUpsertTask({
      ...task,
      subtasks: [...task.subtasks, { id: `st-${Date.now()}`, title: text, done: false }]
    });
    setSubtaskDraft('');
  };

  const startTimerForTask = (task: SmartTask) => {
    if (activeTimerTaskId === task.id) {
      setTimerRunning(prev => !prev);
    } else {
      setActiveTimerTaskId(task.id);
      setSecondsLeft(25 * 60);
      setTimerRunning(true);
      if (task.status === 'todo') {
        onUpsertTask({ ...task, status: 'in_progress' });
      }
    }
  };

  const formatClock = (totalSec: number) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const activeTimerTask = tasks.find(t => t.id === activeTimerTaskId) || null;

  return (
    <div className="space-y-6">
      {/* Minimalist KPI Strip — Single flat row, hairline dividers, tabular numerals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-neutral-200 rounded-xl divide-y lg:divide-y-0 lg:divide-x divide-neutral-200">
        <div className="p-4">
          <div className="text-xs text-slate-500">{isEn ? 'Open tasks' : 'Việc đang mở'}</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{stats.open}</div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">{isEn ? 'Due today / overdue' : 'Đến hạn hôm nay'}</div>
          <div className={`mt-1 text-2xl font-bold tabular-nums ${stats.dueTodayOrOverdue > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
            {stats.dueTodayOrOverdue}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">{isEn ? 'Completion rate' : 'Tỷ lệ hoàn thành'}</div>
          <div className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">{stats.completionPct}%</div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">{isEn ? 'Focus time logged' : 'Thời gian tập trung'}</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{stats.totalFocusMins}m</div>
        </div>
      </div>

      {/* Active Focus Timer Bar (only visible when a focus session is active) */}
      {activeTimerTask && (
        <div className="bg-slate-900 text-white rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-slate-400">
              {isEn ? 'Focus Session (25 min)' : 'Phiên tập trung (25 phút)'}
            </div>
            <div className="text-sm font-semibold truncate">{activeTimerTask.title}</div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="font-mono text-xl font-semibold tabular-nums tracking-tight">
              {formatClock(secondsLeft)}
            </span>
            <button
              type="button"
              onClick={() => setTimerRunning(prev => !prev)}
              className="px-3 py-1.5 rounded-lg bg-white text-slate-900 text-xs font-semibold flex items-center gap-1.5 hover:bg-neutral-100 transition-colors"
            >
              {timerRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{timerRunning ? (isEn ? 'Pause' : 'Tạm dừng') : isEn ? 'Resume' : 'Tiếp tục'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTimerRunning(false);
                setSecondsLeft(25 * 60);
              }}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              title={isEn ? 'Reset timer' : 'Đặt lại'}
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Smart Capture + AI Planner Bar */}
      <div className="bg-white border border-neutral-200 rounded-xl p-4 sm:p-5 space-y-3">
        <form onSubmit={handleManualAdd} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            value={quickInput}
            onChange={e => setQuickInput(e.target.value)}
            placeholder={
              isEn
                ? 'Type a task, or describe a goal for AI to split into steps (e.g., "Prepare Grade 2 final test by Friday")...'
                : 'Nhập công việc mới, hoặc viết mục tiêu để AI tự chia nhỏ (VD: "Chuẩn bị thi Starters lớp 2A1 thứ Sáu này")...'
            }
            className="flex-1 px-3.5 py-2.5 rounded-lg border border-neutral-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 transition-colors"
          />
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="submit"
              disabled={!quickInput.trim()}
              className="px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-sm font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>{isEn ? 'Add' : 'Thêm'}</span>
            </button>
            <button
              type="button"
              disabled={isAiBreakingDown || !quickInput.trim()}
              onClick={handleAiBreakdown}
              className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Sparkles className={`w-4 h-4 ${isAiBreakingDown ? 'animate-spin' : ''}`} />
              <span>{isAiBreakingDown ? (isEn ? 'Planning...' : 'Đang tách...') : isEn ? 'AI Split' : 'AI Chia nhỏ'}</span>
            </button>
          </div>
        </form>

        {/* Secondary inline quick metadata + Smart Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-neutral-100 text-xs">
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={quickPriority}
              onChange={e => setQuickPriority(e.target.value as TaskPriority)}
              className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-neutral-50 text-slate-700 font-medium focus:outline-none focus:border-slate-900"
            >
              <option value="urgent">{isEn ? 'Priority: Urgent' : 'Ưu tiên: Khẩn cấp'}</option>
              <option value="high">{isEn ? 'Priority: High' : 'Ưu tiên: Cao'}</option>
              <option value="medium">{isEn ? 'Priority: Medium' : 'Ưu tiên: Trung bình'}</option>
              <option value="low">{isEn ? 'Priority: Low' : 'Ưu tiên: Thấp'}</option>
            </select>

            <select
              value={quickCategory}
              onChange={e => setQuickCategory(e.target.value as TaskCategory)}
              className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-neutral-50 text-slate-700 font-medium focus:outline-none focus:border-slate-900"
            >
              <option value="grading">{categoryLabel('grading')}</option>
              <option value="preparation">{categoryLabel('preparation')}</option>
              <option value="follow_up">{categoryLabel('follow_up')}</option>
              <option value="admin">{categoryLabel('admin')}</option>
              <option value="general">{categoryLabel('general')}</option>
            </select>

            <input
              type="date"
              value={quickDueDate}
              onChange={e => setQuickDueDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-neutral-50 text-slate-700 font-mono text-xs focus:outline-none focus:border-slate-900"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isAiPrioritizing}
              onClick={handleAiPrioritize}
              className="px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-slate-700 font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <ArrowUpDown className={`w-3.5 h-3.5 text-indigo-600 ${isAiPrioritizing ? 'animate-spin' : ''}`} />
              <span>{isAiPrioritizing ? (isEn ? 'Sorting...' : 'Đang sắp xếp...') : isEn ? 'AI Prioritize' : 'AI Sắp xếp ưu tiên'}</span>
            </button>

            <button
              type="button"
              onClick={handleGenerateFromGrading}
              className="px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-slate-700 font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Wand2 className="w-3.5 h-3.5 text-slate-600" />
              <span>{isEn ? 'Sync from Grades' : 'Gợi ý từ bài chấm'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* AI Focus Advice strip */}
      {focusAdvice && (
        <div className="bg-indigo-50/70 border border-indigo-200/80 rounded-xl px-4 py-3 flex items-start justify-between gap-3 text-sm text-indigo-950">
          <div className="space-y-0.5">
            <div className="text-xs font-semibold text-indigo-700">
              {isEn ? 'Smart Focus Suggestion' : 'Gợi ý tập trung thông minh'}
            </div>
            <p className="text-sm leading-relaxed">{focusAdvice}</p>
          </div>
          <button
            type="button"
            onClick={() => setFocusAdvice('')}
            className="text-xs text-indigo-600 hover:text-indigo-900 font-medium shrink-0"
          >
            {isEn ? 'Dismiss' : 'Ẩn'}
          </button>
        </div>
      )}

      {/* Filter & View Switcher Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-0.5 bg-neutral-100 rounded-lg border border-neutral-200/70">
            {(['all', 'todo', 'in_progress', 'done'] as const).map(st => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  statusFilter === st ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st === 'all' ? (isEn ? 'All' : 'Tất cả') : statusLabel(st)}
              </button>
            ))}
          </div>

          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value as 'all' | TaskCategory)}
            className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs font-medium text-slate-700"
          >
            <option value="all">{isEn ? 'All Categories' : 'Mọi danh mục'}</option>
            <option value="grading">{categoryLabel('grading')}</option>
            <option value="preparation">{categoryLabel('preparation')}</option>
            <option value="follow_up">{categoryLabel('follow_up')}</option>
            <option value="admin">{categoryLabel('admin')}</option>
            <option value="general">{categoryLabel('general')}</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={isEn ? 'Search tasks...' : 'Tìm công việc...'}
              className="pl-8 pr-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs text-slate-900 w-44 sm:w-56 focus:outline-none focus:border-slate-900"
            />
          </div>

          <div className="inline-flex items-center p-0.5 bg-neutral-100 rounded-lg border border-neutral-200/70">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'list' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
              }`}
              title={isEn ? 'List view' : 'Danh sách'}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('board')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'board' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
              }`}
              title={isEn ? 'Kanban board' : 'Bảng Kanban'}
            >
              <Columns3 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* VIEW 1: MINIMALIST PRIORITY LIST */}
      {viewMode === 'list' ? (
        <div className="bg-white border border-neutral-200 rounded-xl divide-y divide-neutral-200">
          {filteredTasks.length === 0 ? (
            <div className="py-14 px-6 text-center">
              <p className="text-sm font-medium text-slate-700">
                {isEn ? 'No tasks match your filter.' : 'Chưa có công việc nào phù hợp bộ lọc.'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {isEn
                  ? 'Add a task above or let AI break down your exam schedule.'
                  : 'Nhập việc mới ở thanh trên hoặc nhấn AI Chia nhỏ để tự động lập kế hoạch.'}
              </p>
            </div>
          ) : (
            filteredTasks.map(task => {
              const pInfo = priorityMeta(task.priority);
              const isExpanded = expandedTaskId === task.id;
              const isDone = task.status === 'done';
              const completedSubs = task.subtasks.filter(s => s.done).length;
              const isOverdue = !isDone && task.dueDate && task.dueDate < todayIso;

              return (
                <div key={task.id} className="transition-colors hover:bg-neutral-50/70">
                  <div className="px-4 py-3.5 flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => toggleTaskComplete(task)}
                      aria-label="Toggle task complete"
                      className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                        isDone
                          ? 'bg-slate-900 border-slate-900 text-white'
                          : 'border-slate-300 hover:border-slate-900 bg-white'
                      }`}
                    >
                      {isDone && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                          className="text-left group flex items-center gap-1.5 min-w-0"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <span
                            className={`text-sm font-medium leading-snug ${
                              isDone ? 'line-through text-slate-400' : 'text-slate-900 group-hover:text-indigo-700'
                            }`}
                          >
                            {task.title}
                          </span>
                        </button>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {!isDone && (
                            <button
                              type="button"
                              onClick={() => startTimerForTask(task)}
                              className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
                                activeTimerTaskId === task.id && timerRunning
                                  ? 'bg-slate-900 text-white'
                                  : 'text-slate-600 hover:bg-neutral-100 hover:text-slate-900'
                              }`}
                              title={isEn ? 'Start 25m focus session' : 'Bắt đầu bấm giờ tập trung 25 phút'}
                            >
                              {activeTimerTaskId === task.id && timerRunning ? (
                                <Pause className="w-3 h-3" />
                              ) : (
                                <Play className="w-3 h-3" />
                              )}
                              <span className="hidden sm:inline">{isEn ? 'Focus' : 'Tập trung'}</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => onDeleteTask(task.id)}
                            className="p-1.5 rounded-md text-slate-400 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                            title={isEn ? 'Delete task' : 'Xóa'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Clean Unboxed Metadata Line (Zero-Pill Rule) */}
                      <div className="mt-1 pl-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <span className={pInfo.cls}>{pInfo.label}</span>
                        <span aria-hidden="true">·</span>
                        <span>{categoryLabel(task.category)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{statusLabel(task.status)}</span>
                        {task.dueDate && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className={`tabular-nums inline-flex items-center gap-1 ${isOverdue ? 'text-rose-700 font-medium' : ''}`}>
                              <Calendar className="w-3 h-3" />
                              {task.dueDate}
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {task.estimatedMinutes}m
                        </span>
                        {task.subtasks.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">
                              {completedSubs}/{task.subtasks.length} {isEn ? 'steps' : 'bước'}
                            </span>
                          </>
                        )}
                        {task.assignee && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{task.assignee}</span>
                          </>
                        )}
                      </div>

                      {task.aiReason && (
                        <p className="mt-1.5 pl-5 text-xs text-indigo-700/90">
                          {task.aiReason}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Expanded Detail Drawer */}
                  {isExpanded && (
                    <div className="px-12 pb-4 pt-1 space-y-3 border-t border-neutral-100 bg-neutral-50/40">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                        <div>
                          <label className="block text-slate-500 mb-1">{isEn ? 'Status' : 'Trạng thái'}</label>
                          <select
                            value={task.status}
                            onChange={e => onUpsertTask({ ...task, status: e.target.value as TaskStatus })}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white text-slate-800 font-medium"
                          >
                            <option value="todo">{statusLabel('todo')}</option>
                            <option value="in_progress">{statusLabel('in_progress')}</option>
                            <option value="done">{statusLabel('done')}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-slate-500 mb-1">{isEn ? 'Priority' : 'Mức ưu tiên'}</label>
                          <select
                            value={task.priority}
                            onChange={e => onUpsertTask({ ...task, priority: e.target.value as TaskPriority })}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white text-slate-800 font-medium"
                          >
                            <option value="urgent">{priorityMeta('urgent').label}</option>
                            <option value="high">{priorityMeta('high').label}</option>
                            <option value="medium">{priorityMeta('medium').label}</option>
                            <option value="low">{priorityMeta('low').label}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-slate-500 mb-1">{isEn ? 'Due date' : 'Hạn chót'}</label>
                          <input
                            type="date"
                            value={task.dueDate}
                            onChange={e => onUpsertTask({ ...task, dueDate: e.target.value })}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white font-mono text-xs text-slate-800"
                          />
                        </div>
                      </div>

                      {task.description && (
                        <p className="text-xs text-slate-600 leading-relaxed">{task.description}</p>
                      )}

                      {/* Subtasks Checklist */}
                      <div className="space-y-1.5">
                        <div className="text-xs font-medium text-slate-600">
                          {isEn ? 'Checklist' : 'Các bước thực hiện'}
                        </div>
                        {task.subtasks.map(sub => (
                          <label
                            key={sub.id}
                            className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer py-0.5"
                          >
                            <input
                              type="checkbox"
                              checked={sub.done}
                              onChange={() => toggleSubtask(task, sub.id)}
                              className="accent-slate-900 rounded"
                            />
                            <span className={sub.done ? 'line-through text-slate-400' : ''}>{sub.title}</span>
                          </label>
                        ))}
                        <div className="flex items-center gap-2 pt-1">
                          <input
                            type="text"
                            value={subtaskDraft}
                            onChange={e => setSubtaskDraft(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                addSubtask(task);
                              }
                            }}
                            placeholder={isEn ? 'Add a step...' : 'Thêm bước nhỏ...'}
                            className="flex-1 px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs focus:outline-none focus:border-slate-900"
                          />
                          <button
                            type="button"
                            onClick={() => addSubtask(task)}
                            className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800"
                          >
                            {isEn ? 'Add' : 'Thêm'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* VIEW 2: MINIMALIST 3-COLUMN KANBAN BOARD */
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['todo', 'in_progress', 'done'] as TaskStatus[]).map(colStatus => {
            const colTasks = filteredTasks.filter(t => t.status === colStatus);
            return (
              <div
                key={colStatus}
                onDragOver={e => e.preventDefault()}
                onDrop={() => {
                  if (!dragTaskId) return;
                  const target = tasks.find(t => t.id === dragTaskId);
                  if (target && target.status !== colStatus) {
                    onUpsertTask({ ...target, status: colStatus });
                  }
                  setDragTaskId(null);
                }}
                className="bg-white border border-neutral-200 rounded-xl p-3.5 min-h-[340px] flex flex-col"
              >
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-neutral-200">
                  <h3 className="text-xs font-semibold text-slate-900">{statusLabel(colStatus)}</h3>
                  <span className="text-xs font-mono text-slate-500 tabular-nums">{colTasks.length}</span>
                </div>

                <div className="space-y-2.5 flex-1">
                  {colTasks.map(task => {
                    const pInfo = priorityMeta(task.priority);
                    return (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={() => setDragTaskId(task.id)}
                        className="p-3 rounded-lg border border-neutral-200 bg-[#FAFAFA] hover:bg-white cursor-grab active:cursor-grabbing transition-colors space-y-2"
                      >
                        <div className="text-sm font-medium text-slate-900 leading-snug">{task.title}</div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                          <span className={pInfo.cls}>{pInfo.label}</span>
                          <span>·</span>
                          <span>{categoryLabel(task.category)}</span>
                          {task.dueDate && (
                            <>
                              <span>·</span>
                              <span className="tabular-nums">{task.dueDate}</span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center justify-between pt-1 text-[11px]">
                          <span className="text-slate-400 tabular-nums">{task.estimatedMinutes}m</span>
                          <div className="flex items-center gap-2">
                            {colStatus !== 'done' && (
                              <button
                                type="button"
                                onClick={() =>
                                  onUpsertTask({
                                    ...task,
                                    status: colStatus === 'todo' ? 'in_progress' : 'done'
                                  })
                                }
                                className="text-indigo-700 hover:underline font-medium"
                              >
                                {colStatus === 'todo'
                                  ? isEn
                                    ? 'Start'
                                    : 'Bắt đầu'
                                  : isEn
                                    ? 'Complete'
                                    : 'Xong'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {colTasks.length === 0 && (
                    <div className="py-10 text-center text-xs text-slate-400">
                      {isEn ? 'Drop tasks here' : 'Kéo công việc vào đây'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
