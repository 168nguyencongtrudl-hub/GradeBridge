export type PartType =
  | 'draw_lines'
  | 'listen_colour'
  | 'tick_cross'
  | 'yes_no'
  | 'mcq_abc'
  | 'matching_ag'
  | 'text_blank';

export interface NormalizedCropBox {
  source?: 'blank' | 'key';
  pageIndex: number;
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface DrawLineTarget {
  code: string;
  label: string;
  imageDataUrl?: string;
}

export interface ExamPartItem {
  q: number;
  prompt: string;
  ans: string;
  targetDesc?: string;
  imageDataUrl?: string;
}

export interface ExamPart {
  id: string;
  title: string;
  skill: 'Listening' | 'Reading & Writing';
  type: PartType;
  note?: string;
  sceneImageDataUrl?: string;
  options?: string[];
  targets?: DrawLineTarget[];
  items: ExamPartItem[];
}

export interface ExamProfile {
  id: string;
  schoolName?: string;
  gradeName: string;
  classLabel?: string;
  examTitle: string;
  examLevel: string;
  pagesPerStudent: number;
  maxScore: number;
  blankExamFileName?: string;
  sourceFileName: string;
  updatedAt: number;
  parts: ExamPart[];
  answerKeyText: string;
}

export interface GradedQuestion {
  questionNumber: string;
  qNum?: number;
  partTitle?: string;
  skill?: string;
  partType?: PartType;
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  note?: string;
}

export interface StudentPageImage {
  pageNum: number;
  dataUrl: string;
}

export interface StudentResult {
  id: string;
  profileId: string;
  gradeName: string;
  examTitle: string;
  gradedBy: string;
  createdAt: number;
  stt: number;
  pageRange: string;
  pages: StudentPageImage[];
  studentName: string;
  className: string;
  schoolName: string;
  listeningScore: string;
  rwScore: string;
  shields: number;
  sectionBreakdown: string;
  teacherNote: string;
  questions: GradedQuestion[];
  correctCount: number;
  totalQuestions: number;
  score: number;
  reviewed: boolean;
  status: 'completed' | 'needs_review';
}

export interface UserPermissions {
  canGrade: boolean;
  canViewExport: boolean;
  canPrintSheet: boolean;
  canManageExams: boolean;
  canDeleteResults: boolean;
}

export interface TeacherAccount {
  id: string;
  username: string;
  fullName: string;
  role: 'admin' | 'teacher';
  active: boolean;
  permissions: UserPermissions;
  createdAt: number;
}

export interface SystemBranding {
  appName: string;
  appSubtitle: string;
  logoDataUrl: string;
  logoWidth: number;
  logoHeight: number;
  sheetHeaderTitle: string;
  sheetFooterNote: string;
  updatedAt?: number;
}

export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskCategory = 'grading' | 'preparation' | 'follow_up' | 'admin' | 'general';

export interface SubTask {
  id: string;
  title: string;
  done: boolean;
}

export interface SmartTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: TaskCategory;
  dueDate: string; // YYYY-MM-DD or ''
  estimatedMinutes: number;
  focusMinutesLogged: number;
  assignee: string;
  linkedProfileId?: string;
  linkedStudentId?: string;
  aiReason?: string;
  subtasks: SubTask[];
  createdAt: number;
  updatedAt: number;
}

export type WorkspaceSection = 'tasks' | 'omr' | 'batch' | 'sheet' | 'scoreboard';
export type UiLang = 'vi' | 'en';
