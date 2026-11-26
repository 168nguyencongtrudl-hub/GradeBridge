import type { ExamProfile, SmartTask, SystemBranding } from '../types';
import { BUILT_IN_EXAM_PROFILES } from './builtInProfiles';

export const INITIAL_EXAM_PROFILES: ExamProfile[] = BUILT_IN_EXAM_PROFILES;

export const DEFAULT_SYSTEM_BRANDING: SystemBranding = {
  appName: 'Cambridge Grader',
  appSubtitle: 'Chấm thi Cambridge AI & Quản lý công việc thông minh',
  logoDataUrl: '',
  logoWidth: 32,
  logoHeight: 32,
  sheetHeaderTitle: 'CAMBRIDGE ENGLISH ANSWER SHEET (1-PAGE SUMMARY)',
  sheetFooterNote:
    'Instructions: Draw clear lines to match; fill or circle the correct option; write words clearly on the lines.'
};

export function createInitialTasks(todayIso: string): SmartTask[] {
  const now = Date.now();
  return [
    {
      id: 'task-init-1',
      title: 'Kiểm tra đáp án và in 35 phiếu trả lời 1 trang (A4) cho Grade 2 & Khối 4',
      description: 'Rà soát lại Listening Part 1 và Part 4 trước khi in phiếu A4 phát cho các lớp.',
      status: 'todo',
      priority: 'high',
      category: 'preparation',
      dueDate: todayIso,
      estimatedMinutes: 20,
      focusMinutesLogged: 0,
      assignee: 'Admin',
      linkedProfileId: 'profile-1795668046499',
      subtasks: [
        { id: 'st-1', title: 'Đối chiếu đáp án và hình minh họa đã cắt', done: true },
        { id: 'st-2', title: 'Xuất file PDF khổ A4 và in thử 1 bản', done: false }
      ],
      createdAt: now - 3600000,
      updatedAt: now - 3600000
    },
    {
      id: 'task-init-2',
      title: 'Chấm thử 1 phiếu mẫu 9→1 bằng Camera AI để kiểm chuẩn',
      description: 'Chạy thử phiếu mẫu trong mục Chấm thi 1 trang để xác nhận tốc độ nhận diện chữ viết tay và nối tranh.',
      status: 'in_progress',
      priority: 'medium',
      category: 'grading',
      dueDate: todayIso,
      estimatedMinutes: 10,
      focusMinutesLogged: 5,
      assignee: 'Admin',
      linkedProfileId: 'profile-khoi-2-g2ft1',
      subtasks: [
        { id: 'st-3', title: 'Chạy thử phiếu mẫu Grade 2', done: false },
        { id: 'st-4', title: 'Kiểm tra bảng điểm và xuất thử file Excel', done: false }
      ],
      createdAt: now - 1800000,
      updatedAt: now - 1800000
    }
  ];
}
