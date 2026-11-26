import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { DEFAULT_SYSTEM_BRANDING, INITIAL_EXAM_PROFILES, createInitialTasks } from './data/initialData';
import type {
  ExamPart,
  ExamProfile,
  SmartTask,
  StudentResult,
  SystemBranding,
  TeacherAccount,
  UserPermissions
} from './types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Validate connection to Firestore on startup
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write'
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map(provider => ({
          providerId: provider.providerId,
          email: provider.email
        })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function sanitizeFirestoreId(raw: string, fallback = 'item-1'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 128);
  return cleaned || fallback;
}

function clampStr(val: unknown, maxLen: number, minLen = 0, fallback = ''): string {
  const s = String(val ?? '').slice(0, maxLen);
  if (s.length < minLen) return fallback.slice(0, maxLen);
  return s;
}

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export async function signInWithGooglePopup(): Promise<User> {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutFirebase(): Promise<void> {
  await firebaseSignOut(auth);
}

export { onAuthStateChanged, type User };

export interface StoredCloudTeacher extends TeacherAccount {
  passwordHash: string;
}

export interface CloudWorkspaceSnapshot {
  sessionCode: string;
  adminFullName: string;
  adminPasswordHash: string;
  examProfiles: ExamProfile[];
  allResults: StudentResult[];
  tasks: SmartTask[];
  teacherAccounts: StoredCloudTeacher[];
  systemBranding: SystemBranding;
  googleSheetWebhookUrl: string;
}

export async function ensureFirestoreWorkspace(
  rawSessionCode: string,
  seed?: Partial<CloudWorkspaceSnapshot>
): Promise<CloudWorkspaceSnapshot | null> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return null;

  const workspaceId = sanitizeFirestoreId(rawSessionCode.toUpperCase(), 'CAMBRIDGE-2026').slice(0, 64);
  const wsPath = `workspaces/${workspaceId}`;
  const wsRef = doc(db, 'workspaces', workspaceId);

  let wsSnap;
  try {
    wsSnap = await getDoc(wsRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, wsPath);
  }

  const branding = { ...DEFAULT_SYSTEM_BRANDING, ...(seed?.systemBranding || {}) };

  if (!wsSnap.exists()) {
    const createPayload = {
      sessionCode: workspaceId,
      ownerId: user.uid,
      adminFullName: clampStr(seed?.adminFullName || user.displayName || 'Administrator', 120, 1, 'Administrator'),
      adminPasswordHash: clampStr(seed?.adminPasswordHash || '', 256),
      appName: clampStr(branding.appName, 120, 1, 'Cambridge Grader'),
      appSubtitle: clampStr(branding.appSubtitle, 200),
      logoDataUrl: clampStr(branding.logoDataUrl, 350000),
      logoWidth: clampInt(branding.logoWidth, 16, 200, 36),
      logoHeight: clampInt(branding.logoHeight, 16, 200, 36),
      sheetHeaderTitle: clampStr(branding.sheetHeaderTitle, 200),
      sheetFooterNote: clampStr(branding.sheetFooterNote, 300),
      googleSheetWebhookUrl: clampStr(seed?.googleSheetWebhookUrl || '', 500),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    try {
      await setDoc(wsRef, createPayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, wsPath);
    }

    const initialProfiles =
      seed?.examProfiles && seed.examProfiles.length > 0 ? seed.examProfiles : INITIAL_EXAM_PROFILES;
    for (const prof of initialProfiles) {
      await upsertFirestoreProfile(workspaceId, prof);
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const initialTasks = seed?.tasks && seed.tasks.length > 0 ? seed.tasks : createInitialTasks(todayIso);
    for (const t of initialTasks) {
      await upsertFirestoreTask(workspaceId, t);
    }

    if (seed?.allResults && seed.allResults.length > 0) {
      for (const r of seed.allResults) {
        await upsertFirestoreResult(workspaceId, r);
      }
    }
  }

  return loadFirestoreWorkspace(workspaceId);
}

export async function loadFirestoreWorkspace(rawSessionCode: string): Promise<CloudWorkspaceSnapshot | null> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return null;

  const workspaceId = sanitizeFirestoreId(rawSessionCode.toUpperCase(), 'CAMBRIDGE-2026').slice(0, 64);
  const wsPath = `workspaces/${workspaceId}`;
  const wsRef = doc(db, 'workspaces', workspaceId);

  let wsSnap;
  try {
    wsSnap = await getDoc(wsRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, wsPath);
  }

  if (!wsSnap.exists()) return null;
  const wsData = wsSnap.data();
  const ownerId = String(wsData.ownerId || user.uid);

  const profilesPath = `workspaces/${workspaceId}/profiles`;
  const resultsPath = `workspaces/${workspaceId}/results`;
  const tasksPath = `workspaces/${workspaceId}/tasks`;
  const teachersPath = `workspaces/${workspaceId}/teachers`;

  let profSnaps;
  try {
    profSnaps = await getDocs(query(collection(db, profilesPath), where('ownerId', '==', ownerId)));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, profilesPath);
  }

  let resSnaps;
  try {
    resSnaps = await getDocs(query(collection(db, resultsPath), where('ownerId', '==', ownerId)));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, resultsPath);
  }

  let taskSnaps;
  try {
    taskSnaps = await getDocs(query(collection(db, tasksPath), where('ownerId', '==', ownerId)));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, tasksPath);
  }

  let teacherSnaps;
  try {
    teacherSnaps = await getDocs(query(collection(db, teachersPath), where('ownerId', '==', ownerId)));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, teachersPath);
  }

  const examProfiles: ExamProfile[] = profSnaps.docs.map(d => {
    const data = d.data();
    return {
      id: String(data.id || d.id),
      schoolName: String(data.schoolName || ''),
      gradeName: String(data.gradeName || 'Grade'),
      classLabel: String(data.classLabel || ''),
      examTitle: String(data.examTitle || 'Cambridge Exam'),
      examLevel: String(data.examLevel || ''),
      pagesPerStudent: Number(data.pagesPerStudent) || 9,
      maxScore: Number(data.maxScore) || 8,
      sourceFileName: String(data.sourceFileName || ''),
      answerKeyText: String(data.rawAnswerKeyText || ''),
      parts: Array.isArray(data.parts) ? (data.parts as ExamPart[]) : [],
      updatedAt: data.updatedAt?.toMillis?.() || Date.now()
    };
  });

  const allResults: StudentResult[] = resSnaps.docs
    .map(d => {
      const data = d.data();
      return {
        id: String(data.id || d.id),
        profileId: String(data.profileId || ''),
        stt: Number(data.stt) || 1,
        studentName: String(data.studentName || 'Học sinh'),
        className: String(data.className || ''),
        schoolName: String(data.schoolName || ''),
        gradeName: String(data.gradeName || ''),
        examTitle: String(data.examTitle || ''),
        pageRange: '1-1',
        score: Number(data.score) || 0,
        correctCount: Number(data.correctCount) || 0,
        totalQuestions: Number(data.totalQuestions) || 0,
        shields: Number(data.shields) || 1,
        listeningScore: String(data.listeningScore || ''),
        rwScore: String(data.rwScore || ''),
        sectionBreakdown: String(data.sectionBreakdown || ''),
        teacherNote: String(data.teacherNote || ''),
        gradedBy: String(data.gradedBy || ''),
        reviewed: Boolean(data.reviewed),
        status: 'completed' as const,
        questions: Array.isArray(data.questions) ? data.questions : [],
        pages: [],
        createdAt: data.createdAt?.toMillis?.() || Date.now()
      };
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const tasks: SmartTask[] = taskSnaps.docs
    .map(d => {
      const data = d.data();
      return {
        id: String(data.id || d.id),
        title: String(data.title || 'Task'),
        description: String(data.description || ''),
        status: (['todo', 'in_progress', 'done'].includes(data.status) ? data.status : 'todo') as SmartTask['status'],
        priority: (['urgent', 'high', 'medium', 'low'].includes(data.priority)
          ? data.priority
          : 'medium') as SmartTask['priority'],
        category: (['grading', 'preparation', 'follow_up', 'admin', 'general'].includes(data.category)
          ? data.category
          : 'general') as SmartTask['category'],
        dueDate: String(data.dueDate || ''),
        estimatedMinutes: Number(data.estimatedMinutes) || 15,
        focusMinutesLogged: Number(data.focusMinutesLogged) || 0,
        assignee: String(data.assignee || ''),
        linkedProfileId: String(data.linkedProfileId || ''),
        linkedStudentId: String(data.linkedStudentId || ''),
        aiReason: String(data.aiReason || ''),
        subtasks: Array.isArray(data.subtasks) ? data.subtasks : [],
        createdAt: data.createdAt?.toMillis?.() || Date.now(),
        updatedAt: data.updatedAt?.toMillis?.() || Date.now()
      };
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const teacherAccounts: StoredCloudTeacher[] = teacherSnaps.docs.map(d => {
    const data = d.data();
    const permissions: UserPermissions = {
      canGrade: Boolean(data.canGrade),
      canViewExport: Boolean(data.canViewExport),
      canPrintSheet: Boolean(data.canPrintSheet),
      canManageExams: Boolean(data.canManageExams),
      canDeleteResults: Boolean(data.canDeleteResults)
    };
    return {
      id: String(data.id || d.id),
      username: String(data.username || ''),
      fullName: String(data.fullName || ''),
      role: 'teacher',
      active: Boolean(data.active),
      permissions,
      passwordHash: String(data.passwordHash || ''),
      createdAt: data.createdAt?.toMillis?.() || Date.now()
    };
  });

  const systemBranding: SystemBranding = {
    appName: String(wsData.appName || DEFAULT_SYSTEM_BRANDING.appName),
    appSubtitle: String(wsData.appSubtitle ?? DEFAULT_SYSTEM_BRANDING.appSubtitle),
    logoDataUrl: String(wsData.logoDataUrl || ''),
    logoWidth: Number(wsData.logoWidth) || DEFAULT_SYSTEM_BRANDING.logoWidth,
    logoHeight: Number(wsData.logoHeight) || DEFAULT_SYSTEM_BRANDING.logoHeight,
    sheetHeaderTitle: String(wsData.sheetHeaderTitle || DEFAULT_SYSTEM_BRANDING.sheetHeaderTitle),
    sheetFooterNote: String(wsData.sheetFooterNote || DEFAULT_SYSTEM_BRANDING.sheetFooterNote),
    updatedAt: wsData.updatedAt?.toMillis?.() || Date.now()
  };

  return {
    sessionCode: workspaceId,
    adminFullName: String(wsData.adminFullName || 'Administrator'),
    adminPasswordHash: String(wsData.adminPasswordHash || ''),
    examProfiles: examProfiles.length > 0 ? examProfiles : INITIAL_EXAM_PROFILES,
    allResults,
    tasks,
    teacherAccounts,
    systemBranding,
    googleSheetWebhookUrl: String(wsData.googleSheetWebhookUrl || '')
  };
}

export async function updateFirestoreWorkspaceMeta(
  rawSessionCode: string,
  updates: Partial<{
    adminFullName: string;
    adminPasswordHash: string;
    systemBranding: SystemBranding;
    googleSheetWebhookUrl: string;
  }>
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const workspaceId = sanitizeFirestoreId(rawSessionCode.toUpperCase(), 'CAMBRIDGE-2026').slice(0, 64);
  const wsPath = `workspaces/${workspaceId}`;
  const wsRef = doc(db, 'workspaces', workspaceId);

  let snap;
  try {
    snap = await getDoc(wsRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, wsPath);
  }

  if (!snap.exists()) {
    await ensureFirestoreWorkspace(workspaceId, {
      adminFullName: updates.adminFullName,
      adminPasswordHash: updates.adminPasswordHash,
      systemBranding: updates.systemBranding,
      googleSheetWebhookUrl: updates.googleSheetWebhookUrl
    });
    return;
  }

  const existing = snap.data();
  const b = updates.systemBranding;
  const patch: Record<string, unknown> = {
    adminFullName: clampStr(updates.adminFullName ?? existing.adminFullName, 120, 1, 'Administrator'),
    adminPasswordHash: clampStr(updates.adminPasswordHash ?? existing.adminPasswordHash, 256),
    appName: clampStr(b ? b.appName : existing.appName, 120, 1, 'Cambridge Grader'),
    appSubtitle: clampStr(b ? b.appSubtitle : existing.appSubtitle, 200),
    logoDataUrl: clampStr(b ? b.logoDataUrl : existing.logoDataUrl, 350000),
    logoWidth: clampInt(b ? b.logoWidth : existing.logoWidth, 16, 200, 36),
    logoHeight: clampInt(b ? b.logoHeight : existing.logoHeight, 16, 200, 36),
    sheetHeaderTitle: clampStr(b ? b.sheetHeaderTitle : existing.sheetHeaderTitle, 200),
    sheetFooterNote: clampStr(b ? b.sheetFooterNote : existing.sheetFooterNote, 300),
    googleSheetWebhookUrl: clampStr(updates.googleSheetWebhookUrl ?? existing.googleSheetWebhookUrl, 500),
    updatedAt: serverTimestamp()
  };

  try {
    await updateDoc(wsRef, patch);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, wsPath);
  }
}

export async function upsertFirestoreProfile(rawSessionCode: string, profile: ExamProfile): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const workspaceId = sanitizeFirestoreId(rawSessionCode.toUpperCase(), 'CAMBRIDGE-2026').slice(0, 64);
  const profileId = sanitizeFirestoreId(profile.id, `profile-${Date.now()}`);
  const path = `workspaces/${workspaceId}/profiles/${profileId}`;
  const ref = doc(db, 'workspaces', workspaceId, 'profiles', profileId);

  // Sanitize parts so embedded base64 images don't exceed Firestore's 1MB document limit
  const safeParts = (Array.isArray(profile.parts) ? profile.parts : []).slice(0, 30).map(p => ({
    id: String(p.id || ''),
    title: String(p.title || ''),
    skill: p.skill === 'Listening' ? 'Listening' : 'Reading & Writing',
    type: String(p.type || 'mcq_abc'),
    note: String(p.note || ''),
    sceneImageDataUrl: typeof p.sceneImageDataUrl === 'string' && p.sceneImageDataUrl.length < 90000 ? p.sceneImageDataUrl : '',
    options: Array.isArray(p.options) ? p.options.slice(0, 15).map(String) : [],
    targets: Array.isArray(p.targets)
      ? p.targets.slice(0, 15).map(t => ({
          code: String(t.code || ''),
          label: String(t.label || ''),
          imageDataUrl: typeof t.imageDataUrl === 'string' && t.imageDataUrl.length < 60000 ? t.imageDataUrl : ''
        }))
      : [],
    items: Array.isArray(p.items)
      ? p.items.slice(0, 50).map(it => ({
          q: Number(it.q) || 1,
          prompt: String(it.prompt || ''),
          ans: String(it.ans || ''),
          targetDesc: String(it.targetDesc || ''),
          imageDataUrl: typeof it.imageDataUrl === 'string' && it.imageDataUrl.length < 60000 ? it.imageDataUrl : ''
        }))
      : []
  }));

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!snap.exists()) {
    try {
      await setDoc(ref, {
        id: profileId,
        workspaceId,
        ownerId: user.uid,
        schoolName: clampStr(profile.schoolName, 200),
        gradeName: clampStr(profile.gradeName, 120, 1, 'Grade'),
        classLabel: clampStr(profile.classLabel, 120),
        examTitle: clampStr(profile.examTitle, 250, 1, 'Cambridge Exam'),
        examLevel: clampStr(profile.examLevel, 120),
        pagesPerStudent: clampInt(profile.pagesPerStudent, 1, 50, 9),
        maxScore: clampNum(profile.maxScore, 1, 1000, 8),
        sourceFileName: clampStr(profile.sourceFileName, 250),
        rawAnswerKeyText: clampStr(profile.answerKeyText, 50000),
        parts: safeParts,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    try {
      await updateDoc(ref, {
        schoolName: clampStr(profile.schoolName, 200),
        gradeName: clampStr(profile.gradeName, 120, 1, 'Grade'),
        classLabel: clampStr(profile.classLabel, 120),
        examTitle: clampStr(profile.examTitle, 250, 1, 'Cambridge Exam'),
        examLevel: clampStr(profile.examLevel, 120),
        pagesPerStudent: clampInt(profile.pagesPerStudent, 1, 50, 9),
        maxScore: clampNum(profile.maxScore, 1, 1000, 8),
        sourceFileName: clampStr(profile.sourceFileName, 250),
        rawAnswerKeyText: clampStr(profile.answerKeyText, 50000),
        parts: safeParts,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

export async function deleteFirestoreProfile(rawSessionCode: string, rawProfileId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  const workspaceId = sanitizeFirestoreId(rawSessionCode.toUpperCase(), 'CAMBRIDGE-2026').slice(0, 64);
  const profileId = sanitizeFirestoreId(rawProfileId);
  const path = `workspaces/${workspaceId}/profiles/${profileId}`;
  try {
    await deleteDoc(doc(db, 'workspaces', workspaceId, 'profiles', profileId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function upsertFirestoreResult(rawSessionCode: string, result: StudentResult): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const workspaceId = sanitizeFirestoreId(rawSessionCode.toUpperCase(), 'CAMBRIDGE-2026').slice(0, 64);
  const resultId = sanitizeFirestoreId(result.id, `res-${Date.now()}`);
  const profileId = sanitizeFirestoreId(result.profileId, INITIAL_EXAM_PROFILES[0].id);
  const path = `workspaces/${workspaceId}/results/${resultId}`;
  const ref = doc(db, 'workspaces', workspaceId, 'results', resultId);

  const safeQuestions = (Array.isArray(result.questions) ? result.questions : []).slice(0, 200).map(q => ({
    questionNumber: clampStr(q.questionNumber, 60),
    skill: clampStr(q.skill || '', 40),
    partType: clampStr(q.partType || '', 40),
    studentAnswer: clampStr(q.studentAnswer, 200),
    correctAnswer: clampStr(q.correctAnswer, 200),
    isCorrect: Boolean(q.isCorrect),
    note: clampStr(q.note || '', 300)
  }));

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!snap.exists()) {
    try {
      await setDoc(ref, {
        id: resultId,
        workspaceId,
        ownerId: user.uid,
        profileId,
        stt: clampInt(result.stt, 0, 100000, 1),
        studentName: clampStr(result.studentName, 160, 1, 'Chưa rõ'),
        className: clampStr(result.className, 120),
        schoolName: clampStr(result.schoolName, 200),
        gradeName: clampStr(result.gradeName, 120),
        examTitle: clampStr(result.examTitle, 250),
        score: clampNum(result.score, 0, 1000, 0),
        correctCount: clampInt(result.correctCount, 0, 500, 0),
        totalQuestions: clampInt(result.totalQuestions, 0, 500, 0),
        shields: clampInt(result.shields, 0, 5, 1),
        listeningScore: clampStr(result.listeningScore, 60),
        rwScore: clampStr(result.rwScore, 60),
        sectionBreakdown: clampStr(result.sectionBreakdown, 300),
        teacherNote: clampStr(result.teacherNote, 1000),
        gradedBy: clampStr(result.gradedBy, 160),
        reviewed: Boolean(result.reviewed),
        questions: safeQuestions,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    try {
      await updateDoc(ref, {
        stt: clampInt(result.stt, 0, 100000, 1),
        studentName: clampStr(result.studentName, 160, 1, 'Chưa rõ'),
        className: clampStr(result.className, 120),
        schoolName: clampStr(result.schoolName, 200),
        gradeName: clampStr(result.gradeName, 120),
        examTitle: clampStr(result.examTitle, 250),
        score: clampNum(result.score, 0, 1000, 0),
        correctCount: clampInt(result.correctCount, 0, 500, 0),
        totalQuestions: clampInt(result.totalQuestions, 0, 500, 0),
        shields: clampInt(result.shields, 0, 5, 1),
        listeningScore: clampStr(result.listeningScore, 60),
        rwScore: clampStr(result.rwScore, 60),
        sectionBreakdown: clampStr(result.sectionBreakdown, 300),
        teacherNote: clampStr(result.teacherNote, 1000),
        gradedBy: clampStr(result.gradedBy, 160),
        reviewed: Boolean(result.reviewed),
        questions: safeQuestions,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

export async function deleteFirestoreResult(rawSessionCode: string, rawResultId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  const workspaceId = sanitizeFirestoreId(rawSessionCode.toUpperCase(), 'CAMBRIDGE-2026').slice(0, 64);
  const resultId = sanitizeFirestoreId(rawResultId);
  const path = `workspaces/${workspaceId}/results/${resultId}`;
  try {
    await deleteDoc(doc(db, 'workspaces', workspaceId, 'results', resultId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function upsertFirestoreTask(rawSessionCode: string, task: SmartTask): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const workspaceId = sanitizeFirestoreId(rawSessionCode.toUpperCase(), 'CAMBRIDGE-2026').slice(0, 64);
  const taskId = sanitizeFirestoreId(task.id, `task-${Date.now()}`);
  const path = `workspaces/${workspaceId}/tasks/${taskId}`;
  const ref = doc(db, 'workspaces', workspaceId, 'tasks', taskId);

  const safeStatus = ['todo', 'in_progress', 'done'].includes(task.status) ? task.status : 'todo';
  const safePriority = ['urgent', 'high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium';
  const safeCategory = ['grading', 'preparation', 'follow_up', 'admin', 'general'].includes(task.category)
    ? task.category
    : 'general';
  const safeSubtasks = (Array.isArray(task.subtasks) ? task.subtasks : []).slice(0, 30).map(s => ({
    id: clampStr(s.id, 80, 1, 'sub-1'),
    title: clampStr(s.title, 200, 1, 'Subtask'),
    done: Boolean(s.done)
  }));

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!snap.exists()) {
    try {
      await setDoc(ref, {
        id: taskId,
        workspaceId,
        ownerId: user.uid,
        title: clampStr(task.title, 300, 1, 'Công việc'),
        description: clampStr(task.description, 1500),
        status: safeStatus,
        priority: safePriority,
        category: safeCategory,
        dueDate: clampStr(task.dueDate, 40),
        estimatedMinutes: clampInt(task.estimatedMinutes, 1, 1440, 15),
        focusMinutesLogged: clampInt(task.focusMinutesLogged, 0, 100000, 0),
        assignee: clampStr(task.assignee, 160),
        linkedProfileId: clampStr(task.linkedProfileId, 128),
        linkedStudentId: clampStr(task.linkedStudentId, 128),
        aiReason: clampStr(task.aiReason, 500),
        subtasks: safeSubtasks,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    try {
      await updateDoc(ref, {
        title: clampStr(task.title, 300, 1, 'Công việc'),
        description: clampStr(task.description, 1500),
        status: safeStatus,
        priority: safePriority,
        category: safeCategory,
        dueDate: clampStr(task.dueDate, 40),
        estimatedMinutes: clampInt(task.estimatedMinutes, 1, 1440, 15),
        focusMinutesLogged: clampInt(task.focusMinutesLogged, 0, 100000, 0),
        assignee: clampStr(task.assignee, 160),
        linkedProfileId: clampStr(task.linkedProfileId, 128),
        linkedStudentId: clampStr(task.linkedStudentId, 128),
        aiReason: clampStr(task.aiReason, 500),
        subtasks: safeSubtasks,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

export async function deleteFirestoreTask(rawSessionCode: string, rawTaskId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  const workspaceId = sanitizeFirestoreId(rawSessionCode.toUpperCase(), 'CAMBRIDGE-2026').slice(0, 64);
  const taskId = sanitizeFirestoreId(rawTaskId);
  const path = `workspaces/${workspaceId}/tasks/${taskId}`;
  try {
    await deleteDoc(doc(db, 'workspaces', workspaceId, 'tasks', taskId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function upsertFirestoreTeacher(rawSessionCode: string, teacher: StoredCloudTeacher): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const workspaceId = sanitizeFirestoreId(rawSessionCode.toUpperCase(), 'CAMBRIDGE-2026').slice(0, 64);
  const teacherId = sanitizeFirestoreId(teacher.id, `teacher-${Date.now()}`);
  const path = `workspaces/${workspaceId}/teachers/${teacherId}`;
  const ref = doc(db, 'workspaces', workspaceId, 'teachers', teacherId);

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!snap.exists()) {
    try {
      await setDoc(ref, {
        id: teacherId,
        workspaceId,
        ownerId: user.uid,
        username: clampStr(teacher.username, 80, 1, 'teacher'),
        fullName: clampStr(teacher.fullName, 160, 1, 'Teacher'),
        active: Boolean(teacher.active),
        passwordHash: clampStr(teacher.passwordHash, 256, 1, 'hash'),
        canGrade: Boolean(teacher.permissions?.canGrade),
        canViewExport: Boolean(teacher.permissions?.canViewExport),
        canPrintSheet: Boolean(teacher.permissions?.canPrintSheet),
        canManageExams: Boolean(teacher.permissions?.canManageExams),
        canDeleteResults: Boolean(teacher.permissions?.canDeleteResults),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    try {
      await updateDoc(ref, {
        fullName: clampStr(teacher.fullName, 160, 1, 'Teacher'),
        active: Boolean(teacher.active),
        passwordHash: clampStr(teacher.passwordHash, 256, 1, 'hash'),
        canGrade: Boolean(teacher.permissions?.canGrade),
        canViewExport: Boolean(teacher.permissions?.canViewExport),
        canPrintSheet: Boolean(teacher.permissions?.canPrintSheet),
        canManageExams: Boolean(teacher.permissions?.canManageExams),
        canDeleteResults: Boolean(teacher.permissions?.canDeleteResults),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

export async function deleteFirestoreTeacher(rawSessionCode: string, rawTeacherId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  const workspaceId = sanitizeFirestoreId(rawSessionCode.toUpperCase(), 'CAMBRIDGE-2026').slice(0, 64);
  const teacherId = sanitizeFirestoreId(rawTeacherId);
  const path = `workspaces/${workspaceId}/teachers/${teacherId}`;
  try {
    await deleteDoc(doc(db, 'workspaces', workspaceId, 'teachers', teacherId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
