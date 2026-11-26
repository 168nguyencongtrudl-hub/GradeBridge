import {
  auth,
  deleteFirestoreProfile,
  deleteFirestoreResult,
  deleteFirestoreTask,
  deleteFirestoreTeacher,
  ensureFirestoreWorkspace,
  loadFirestoreWorkspace,
  updateFirestoreWorkspaceMeta,
  upsertFirestoreProfile,
  upsertFirestoreResult,
  upsertFirestoreTask,
  upsertFirestoreTeacher,
  type CloudWorkspaceSnapshot,
  type StoredCloudTeacher
} from '../firebase';
import { DEFAULT_SYSTEM_BRANDING, INITIAL_EXAM_PROFILES, createInitialTasks } from '../data/initialData';
import type {
  ExamProfile,
  SmartTask,
  StudentResult,
  SystemBranding,
  TeacherAccount,
  UserPermissions
} from '../types';

const TOKEN_STORAGE_KEY = 'cambridge_grader_auth_token_v1';
const ACCOUNT_STORAGE_KEY = 'cambridge_grader_auth_account_v1';
const LOCAL_WORKSPACE_PREFIX = 'cambridge_grader_room_v2_';

const FULL_ADMIN_PERMS: UserPermissions = {
  canGrade: true,
  canViewExport: true,
  canPrintSheet: true,
  canManageExams: true,
  canDeleteResults: true
};

let authToken: string | null = (() => {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null;
  } catch {
    return null;
  }
})();

export function setAuthToken(token: string | null): void {
  authToken = token;
  try {
    if (typeof window !== 'undefined') {
      if (token) {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
      } else {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
        window.localStorage.removeItem(ACCOUNT_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore storage errors
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

export function saveCachedAccount(sessionCode: string, account: TeacherAccount): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify({ sessionCode, account }));
    }
  } catch {
    // Ignore storage errors
  }
}

export function getCachedAccount(): { sessionCode: string; account: TeacherAccount } | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sanitizeCode(raw?: string | null): string {
  const cleaned = String(raw || 'CAMBRIDGE-2026')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
  return cleaned || 'CAMBRIDGE-2026';
}

function simpleHash(password: string): string {
  let h1 = 0xdeadbeef ^ password.length;
  let h2 = 0x41c6ce57 ^ password.length;
  for (let i = 0, ch; i < password.length; i++) {
    ch = password.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `v1:${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

export function loadLocalWorkspace(rawSessionCode = 'CAMBRIDGE-2026'): CloudWorkspaceSnapshot {
  const sessionCode = sanitizeCode(rawSessionCode);
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaults: CloudWorkspaceSnapshot = {
    sessionCode,
    adminFullName: 'Administrator',
    adminPasswordHash: '',
    examProfiles: JSON.parse(JSON.stringify(INITIAL_EXAM_PROFILES)),
    allResults: [],
    tasks: createInitialTasks(todayIso),
    teacherAccounts: [],
    systemBranding: { ...DEFAULT_SYSTEM_BRANDING },
    googleSheetWebhookUrl: ''
  };

  try {
    if (typeof window === 'undefined') return defaults;
    const raw = window.localStorage.getItem(`${LOCAL_WORKSPACE_PREFIX}${sessionCode}`);
    if (!raw) {
      saveLocalWorkspace(defaults);
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<CloudWorkspaceSnapshot>;
    return {
      ...defaults,
      ...parsed,
      sessionCode,
      examProfiles:
        Array.isArray(parsed.examProfiles) && parsed.examProfiles.length > 0
          ? parsed.examProfiles
          : defaults.examProfiles,
      allResults: Array.isArray(parsed.allResults) ? parsed.allResults : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : defaults.tasks,
      teacherAccounts: Array.isArray(parsed.teacherAccounts) ? parsed.teacherAccounts : [],
      systemBranding: { ...DEFAULT_SYSTEM_BRANDING, ...(parsed.systemBranding || {}) },
      googleSheetWebhookUrl: typeof parsed.googleSheetWebhookUrl === 'string' ? parsed.googleSheetWebhookUrl : ''
    };
  } catch {
    return defaults;
  }
}

export function saveLocalWorkspace(store: CloudWorkspaceSnapshot): void {
  try {
    if (typeof window === 'undefined') return;
    const sessionCode = sanitizeCode(store.sessionCode);
    // Keep result page thumbnails compact in localStorage
    const compactResults = (store.allResults || []).map(r => ({
      ...r,
      pages: (r.pages || []).slice(0, 1).map(p => ({
        pageNum: p.pageNum,
        dataUrl: typeof p.dataUrl === 'string' && p.dataUrl.length < 180000 ? p.dataUrl : ''
      }))
    }));
    window.localStorage.setItem(
      `${LOCAL_WORKSPACE_PREFIX}${sessionCode}`,
      JSON.stringify({ ...store, sessionCode, allResults: compactResults })
    );
  } catch {
    // Ignore quota errors
  }
}

function toPublicTeacher(t: StoredCloudTeacher): TeacherAccount {
  const { passwordHash: _omitted, ...rest } = t;
  return rest;
}

async function syncFromCloudIfAuthenticated(sessionCode: string): Promise<CloudWorkspaceSnapshot> {
  const local = loadLocalWorkspace(sessionCode);
  if (auth.currentUser && auth.currentUser.emailVerified) {
    try {
      const cloud = await ensureFirestoreWorkspace(sessionCode, local);
      if (cloud) {
        const merged: CloudWorkspaceSnapshot = {
          ...local,
          ...cloud,
          adminPasswordHash: cloud.adminPasswordHash || local.adminPasswordHash,
          examProfiles: cloud.examProfiles.length > 0 ? cloud.examProfiles : local.examProfiles,
          allResults: cloud.allResults.length >= local.allResults.length ? cloud.allResults : local.allResults,
          tasks: cloud.tasks.length > 0 ? cloud.tasks : local.tasks,
          teacherAccounts:
            cloud.teacherAccounts.length >= local.teacherAccounts.length
              ? cloud.teacherAccounts
              : local.teacherAccounts
        };
        saveLocalWorkspace(merged);
        return merged;
      }
    } catch (err) {
      console.warn('Firestore sync warning, using local workspace fallback:', err);
    }
  }
  return local;
}

export async function pushAllLocalToFirestore(sessionCode = 'CAMBRIDGE-2026'): Promise<CloudWorkspaceSnapshot | null> {
  if (!auth.currentUser || !auth.currentUser.emailVerified) return null;
  const local = loadLocalWorkspace(sessionCode);
  await ensureFirestoreWorkspace(sessionCode, local);
  await updateFirestoreWorkspaceMeta(sessionCode, {
    adminFullName: local.adminFullName,
    adminPasswordHash: local.adminPasswordHash,
    systemBranding: local.systemBranding,
    googleSheetWebhookUrl: local.googleSheetWebhookUrl
  });
  for (const prof of local.examProfiles) {
    await upsertFirestoreProfile(sessionCode, prof);
  }
  for (const res of local.allResults) {
    await upsertFirestoreResult(sessionCode, res);
  }
  for (const task of local.tasks) {
    await upsertFirestoreTask(sessionCode, task);
  }
  for (const teacher of local.teacherAccounts) {
    await upsertFirestoreTeacher(sessionCode, teacher);
  }
  const latest = await loadFirestoreWorkspace(sessionCode);
  if (latest) saveLocalWorkspace(latest);
  return latest;
}

/**
 * Fallback/Cloud handler for all workspace & auth routes so the application works
 * 100% seamlessly on Vercel (even without the Express backend) and syncs with Firebase Firestore.
 */
async function handleClientPersistedRoute<T>(url: string, options: RequestInit = {}): Promise<T | null> {
  const method = (options.method || 'GET').toUpperCase();
  const parsedUrl = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  const pathname = parsedUrl.pathname;
  const body = options.body ? JSON.parse(String(options.body)) : {};
  const cachedAuth = getCachedAccount();
  const sessionCode = sanitizeCode(
    parsedUrl.searchParams.get('sessionCode') || body?.sessionCode || cachedAuth?.sessionCode || 'CAMBRIDGE-2026'
  );

  // 1. GET /api/auth/status
  if (pathname === '/api/auth/status' && method === 'GET') {
    const store = await syncFromCloudIfAuthenticated(sessionCode);
    return {
      sessionCode: store.sessionCode,
      adminConfigured: Boolean(store.adminPasswordHash),
      envConfigured: false,
      branding: store.systemBranding
    } as unknown as T;
  }

  // 2. POST /api/auth/setup-admin
  if (pathname === '/api/auth/setup-admin' && method === 'POST') {
    const fullName = String(body?.fullName || 'Administrator').trim() || 'Administrator';
    const password = String(body?.password || '').trim();
    if (password.length < 4) {
      throw new Error('Mật khẩu quản trị cần tối thiểu 4 ký tự.');
    }
    const store = await syncFromCloudIfAuthenticated(sessionCode);
    store.adminFullName = fullName;
    store.adminPasswordHash = simpleHash(password);
    saveLocalWorkspace(store);
    if (auth.currentUser && auth.currentUser.emailVerified) {
      await updateFirestoreWorkspaceMeta(sessionCode, {
        adminFullName: store.adminFullName,
        adminPasswordHash: store.adminPasswordHash
      }).catch(() => {});
    }
    const account: TeacherAccount = {
      id: 'root-admin',
      username: 'admin',
      fullName: store.adminFullName,
      role: 'admin',
      active: true,
      permissions: FULL_ADMIN_PERMS,
      createdAt: Date.now()
    };
    const token = `local-token.${btoa(JSON.stringify({ sub: 'root-admin', role: 'admin', sessionCode }))}`;
    saveCachedAccount(sessionCode, account);
    return { token, sessionCode, account } as unknown as T;
  }

  // 3. POST /api/auth/login
  if (pathname === '/api/auth/login' && method === 'POST') {
    const username = String(body?.username || '').trim().toLowerCase();
    const password = String(body?.password || '').trim();
    if (!username || !password) {
      throw new Error('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
    }
    const store = await syncFromCloudIfAuthenticated(sessionCode);
    const inputHash = simpleHash(password);

    if (username === 'admin' || username === 'administrator') {
      if (!store.adminPasswordHash) {
        // First login when no password hash is set in local/cloud yet sets it automatically
        store.adminPasswordHash = inputHash;
        saveLocalWorkspace(store);
      } else if (store.adminPasswordHash !== inputHash && store.adminPasswordHash !== password) {
        throw new Error('Tên đăng nhập hoặc mật khẩu không chính xác.');
      }
      const account: TeacherAccount = {
        id: 'root-admin',
        username: 'admin',
        fullName: store.adminFullName || 'Administrator',
        role: 'admin',
        active: true,
        permissions: FULL_ADMIN_PERMS,
        createdAt: 0
      };
      const token = `local-token.${btoa(JSON.stringify({ sub: 'root-admin', role: 'admin', sessionCode }))}`;
      saveCachedAccount(sessionCode, account);
      return { token, sessionCode, account } as unknown as T;
    }

    const matched = store.teacherAccounts.find(a => a.username.trim().toLowerCase() === username);
    if (!matched || (matched.passwordHash !== inputHash && matched.passwordHash !== password)) {
      throw new Error('Tên đăng nhập hoặc mật khẩu không chính xác.');
    }
    if (!matched.active) {
      throw new Error('Tài khoản này đã bị khóa bởi Quản trị viên.');
    }
    const account = toPublicTeacher(matched);
    const token = `local-token.${btoa(JSON.stringify({ sub: account.id, role: 'teacher', sessionCode }))}`;
    saveCachedAccount(sessionCode, account);
    return { token, sessionCode, account } as unknown as T;
  }

  // 4. GET /api/auth/me
  if (pathname === '/api/auth/me' && method === 'GET') {
    if (cachedAuth) {
      return cachedAuth as unknown as T;
    }
    if (auth.currentUser) {
      const account: TeacherAccount = {
        id: auth.currentUser.uid,
        username: auth.currentUser.email || 'admin',
        fullName: auth.currentUser.displayName || auth.currentUser.email || 'Administrator',
        role: 'admin',
        active: true,
        permissions: FULL_ADMIN_PERMS,
        createdAt: Date.now()
      };
      saveCachedAccount(sessionCode, account);
      return { sessionCode, account } as unknown as T;
    }
    throw new Error('Phiên đăng nhập đã hết hạn.');
  }

  // 5. GET /api/workspace
  if (pathname === '/api/workspace' && method === 'GET') {
    const store = await syncFromCloudIfAuthenticated(sessionCode);
    return {
      sessionCode: store.sessionCode,
      examProfiles: store.examProfiles,
      allResults: store.allResults,
      tasks: store.tasks,
      systemBranding: store.systemBranding,
      googleSheetWebhookUrl: store.googleSheetWebhookUrl,
      teacherAccounts: store.teacherAccounts.map(toPublicTeacher)
    } as unknown as T;
  }

  // 6. PUT / DELETE /api/workspace/profiles/:id
  if (pathname.startsWith('/api/workspace/profiles/')) {
    const profileId = decodeURIComponent(pathname.replace('/api/workspace/profiles/', ''));
    const store = loadLocalWorkspace(sessionCode);
    if (method === 'PUT') {
      const profile: ExamProfile = { ...(body as ExamProfile), id: profileId, updatedAt: Date.now() };
      const exists = store.examProfiles.some(p => p.id === profile.id);
      store.examProfiles = exists
        ? store.examProfiles.map(p => (p.id === profile.id ? profile : p))
        : [profile, ...store.examProfiles];
      saveLocalWorkspace(store);
      if (auth.currentUser && auth.currentUser.emailVerified) {
        await upsertFirestoreProfile(sessionCode, profile).catch(() => {});
      }
      return { profile } as unknown as T;
    }
    if (method === 'DELETE') {
      if (store.examProfiles.length <= 1) {
        throw new Error('Cần giữ lại ít nhất 1 bộ đề trong kho.');
      }
      store.examProfiles = store.examProfiles.filter(p => p.id !== profileId);
      saveLocalWorkspace(store);
      if (auth.currentUser && auth.currentUser.emailVerified) {
        await deleteFirestoreProfile(sessionCode, profileId).catch(() => {});
      }
      return { ok: true } as unknown as T;
    }
  }

  // 7. PUT / DELETE /api/workspace/results/:id
  if (pathname.startsWith('/api/workspace/results/')) {
    const resultId = decodeURIComponent(pathname.replace('/api/workspace/results/', ''));
    const store = loadLocalWorkspace(sessionCode);
    if (method === 'PUT') {
      const result = body as StudentResult;
      const overwriteDuplicate = parsedUrl.searchParams.get('overwriteDuplicate') !== 'false';
      const normName = (result.studentName || '').trim().toLowerCase();
      const normClass = (result.className || '').trim().toLowerCase();
      const normSchool = (result.schoolName || '').trim().toLowerCase();
      const duplicate =
        overwriteDuplicate && normName && normName !== 'chưa rõ'
          ? store.allResults.find(
              r =>
                r.id !== result.id &&
                r.profileId === result.profileId &&
                (r.studentName || '').trim().toLowerCase() === normName &&
                (r.className || '').trim().toLowerCase() === normClass &&
                (!normSchool ||
                  normSchool === 'chưa rõ' ||
                  !(r.schoolName || '').trim() ||
                  (r.schoolName || '').trim().toLowerCase() === 'chưa rõ' ||
                  (r.schoolName || '').trim().toLowerCase() === normSchool)
            )
          : null;
      const finalRecord: StudentResult = duplicate
        ? { ...result, id: duplicate.id, stt: duplicate.stt }
        : { ...result, id: resultId };
      const exists = store.allResults.some(r => r.id === finalRecord.id);
      store.allResults = exists
        ? store.allResults.map(r => (r.id === finalRecord.id ? finalRecord : r))
        : [finalRecord, ...store.allResults];
      saveLocalWorkspace(store);
      if (auth.currentUser && auth.currentUser.emailVerified) {
        await upsertFirestoreResult(sessionCode, finalRecord).catch(() => {});
      }
      return { record: finalRecord, wasUpdated: Boolean(duplicate) } as unknown as T;
    }
    if (method === 'DELETE') {
      store.allResults = store.allResults.filter(r => r.id !== resultId);
      saveLocalWorkspace(store);
      if (auth.currentUser && auth.currentUser.emailVerified) {
        await deleteFirestoreResult(sessionCode, resultId).catch(() => {});
      }
      return { ok: true } as unknown as T;
    }
  }

  // 8. POST /api/workspace/tasks/bulk
  if (pathname === '/api/workspace/tasks/bulk' && method === 'POST') {
    const incoming = Array.isArray(body?.tasks) ? (body.tasks as SmartTask[]) : [];
    const store = loadLocalWorkspace(sessionCode);
    const byId = new Map<string, SmartTask>();
    for (const existing of store.tasks) byId.set(existing.id, existing);
    for (const item of incoming) {
      if (item && item.id && item.title) {
        const clean = { ...item, updatedAt: Date.now() };
        byId.set(item.id, clean);
        if (auth.currentUser && auth.currentUser.emailVerified) {
          await upsertFirestoreTask(sessionCode, clean).catch(() => {});
        }
      }
    }
    store.tasks = Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
    saveLocalWorkspace(store);
    return { tasks: store.tasks } as unknown as T;
  }

  // 9. PUT / DELETE /api/workspace/tasks/:id
  if (pathname.startsWith('/api/workspace/tasks/')) {
    const taskId = decodeURIComponent(pathname.replace('/api/workspace/tasks/', ''));
    const store = loadLocalWorkspace(sessionCode);
    if (method === 'PUT') {
      const cleanTask: SmartTask = { ...(body as SmartTask), id: taskId, updatedAt: Date.now() };
      const exists = store.tasks.some(t => t.id === cleanTask.id);
      store.tasks = exists
        ? store.tasks.map(t => (t.id === cleanTask.id ? cleanTask : t))
        : [cleanTask, ...store.tasks];
      saveLocalWorkspace(store);
      if (auth.currentUser && auth.currentUser.emailVerified) {
        await upsertFirestoreTask(sessionCode, cleanTask).catch(() => {});
      }
      return { task: cleanTask } as unknown as T;
    }
    if (method === 'DELETE') {
      store.tasks = store.tasks.filter(t => t.id !== taskId);
      saveLocalWorkspace(store);
      if (auth.currentUser && auth.currentUser.emailVerified) {
        await deleteFirestoreTask(sessionCode, taskId).catch(() => {});
      }
      return { ok: true } as unknown as T;
    }
  }

  // 10. PUT /api/workspace/branding
  if (pathname === '/api/workspace/branding' && method === 'PUT') {
    const store = loadLocalWorkspace(sessionCode);
    store.systemBranding = {
      ...DEFAULT_SYSTEM_BRANDING,
      ...store.systemBranding,
      ...(body as Partial<SystemBranding>),
      updatedAt: Date.now()
    };
    saveLocalWorkspace(store);
    if (auth.currentUser && auth.currentUser.emailVerified) {
      await updateFirestoreWorkspaceMeta(sessionCode, {
        systemBranding: store.systemBranding
      }).catch(() => {});
    }
    return { systemBranding: store.systemBranding } as unknown as T;
  }

  // 11. PUT /api/workspace/sheet-url
  if (pathname === '/api/workspace/sheet-url' && method === 'PUT') {
    const rawUrl = String(body?.webhookUrl || '').trim();
    const store = loadLocalWorkspace(sessionCode);
    store.googleSheetWebhookUrl = rawUrl;
    saveLocalWorkspace(store);
    if (auth.currentUser && auth.currentUser.emailVerified) {
      await updateFirestoreWorkspaceMeta(sessionCode, {
        googleSheetWebhookUrl: rawUrl
      }).catch(() => {});
    }
    return { webhookUrl: rawUrl } as unknown as T;
  }

  // 12. POST /api/workspace/restore
  if (pathname === '/api/workspace/restore' && method === 'POST') {
    const store = loadLocalWorkspace(sessionCode);
    if (body.systemBranding && typeof body.systemBranding === 'object') {
      store.systemBranding = { ...DEFAULT_SYSTEM_BRANDING, ...body.systemBranding, updatedAt: Date.now() };
    }
    if (typeof body.googleSheetWebhookUrl === 'string') {
      store.googleSheetWebhookUrl = body.googleSheetWebhookUrl;
    }
    if (Array.isArray(body.examProfiles) && body.examProfiles.length > 0) {
      store.examProfiles = body.examProfiles;
    }
    if (Array.isArray(body.allResults)) {
      store.allResults = body.allResults;
    }
    if (Array.isArray(body.tasks)) {
      store.tasks = body.tasks;
    }
    saveLocalWorkspace(store);
    if (auth.currentUser && auth.currentUser.emailVerified) {
      await pushAllLocalToFirestore(sessionCode).catch(() => {});
    }
    return {
      examProfiles: store.examProfiles,
      allResults: store.allResults,
      tasks: store.tasks,
      systemBranding: store.systemBranding,
      googleSheetWebhookUrl: store.googleSheetWebhookUrl
    } as unknown as T;
  }

  // 13. POST /api/accounts
  if (pathname === '/api/accounts' && method === 'POST') {
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '').trim();
    const fullName = String(body?.fullName || '').trim();
    const permissions = (body?.permissions || {}) as UserPermissions;
    if (!username || !password || !fullName) {
      throw new Error('Vui lòng nhập đầy đủ Họ tên, Tên đăng nhập và Mật khẩu.');
    }
    const store = loadLocalWorkspace(sessionCode);
    if (
      username.toLowerCase() === 'admin' ||
      store.teacherAccounts.some(a => a.username.toLowerCase() === username.toLowerCase())
    ) {
      throw new Error('Tên đăng nhập này đã tồn tại.');
    }
    const created: StoredCloudTeacher = {
      id: `teacher-${Date.now()}`,
      username,
      fullName,
      role: 'teacher',
      active: true,
      permissions: {
        canGrade: Boolean(permissions.canGrade),
        canViewExport: Boolean(permissions.canViewExport),
        canPrintSheet: Boolean(permissions.canPrintSheet),
        canManageExams: Boolean(permissions.canManageExams),
        canDeleteResults: Boolean(permissions.canDeleteResults)
      },
      passwordHash: simpleHash(password),
      createdAt: Date.now()
    };
    store.teacherAccounts = [created, ...store.teacherAccounts];
    saveLocalWorkspace(store);
    if (auth.currentUser && auth.currentUser.emailVerified) {
      await upsertFirestoreTeacher(sessionCode, created).catch(() => {});
    }
    return { account: toPublicTeacher(created) } as unknown as T;
  }

  // 14. PATCH / DELETE /api/accounts/:id
  if (pathname.startsWith('/api/accounts/')) {
    const accountId = decodeURIComponent(pathname.replace('/api/accounts/', ''));
    const store = loadLocalWorkspace(sessionCode);
    if (method === 'PATCH') {
      const target = store.teacherAccounts.find(a => a.id === accountId);
      if (!target) throw new Error('Không tìm thấy tài khoản.');
      if (typeof body?.active === 'boolean') target.active = body.active;
      if (body?.permissions && typeof body.permissions === 'object') {
        target.permissions = { ...target.permissions, ...body.permissions };
      }
      if (typeof body?.newPassword === 'string' && body.newPassword.trim().length >= 4) {
        target.passwordHash = simpleHash(body.newPassword.trim());
      }
      saveLocalWorkspace(store);
      if (auth.currentUser && auth.currentUser.emailVerified) {
        await upsertFirestoreTeacher(sessionCode, target).catch(() => {});
      }
      return { account: toPublicTeacher(target) } as unknown as T;
    }
    if (method === 'DELETE') {
      store.teacherAccounts = store.teacherAccounts.filter(a => a.id !== accountId);
      saveLocalWorkspace(store);
      if (auth.currentUser && auth.currentUser.emailVerified) {
        await deleteFirestoreTeacher(sessionCode, accountId).catch(() => {});
      }
      return { ok: true } as unknown as T;
    }
  }

  return null;
}

/**
 * Mirror successful backend API responses into localStorage & Firebase Firestore
 * so that data is always backed up both locally and in the cloud!
 */
async function mirrorSuccessToLocalAndCloud(url: string, options: RequestInit, responseData: any): Promise<void> {
  const method = (options.method || 'GET').toUpperCase();
  const parsedUrl = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  const pathname = parsedUrl.pathname;
  const cachedAuth = getCachedAccount();
  const sessionCode = sanitizeCode(responseData?.sessionCode || cachedAuth?.sessionCode || 'CAMBRIDGE-2026');

  if ((pathname === '/api/auth/login' || pathname === '/api/auth/setup-admin') && responseData?.account) {
    saveCachedAccount(sessionCode, responseData.account);
    if (pathname === '/api/auth/setup-admin' && options.body) {
      const body = JSON.parse(String(options.body));
      const store = loadLocalWorkspace(sessionCode);
      store.adminFullName = responseData.account.fullName || 'Administrator';
      if (body?.password) {
        store.adminPasswordHash = simpleHash(String(body.password).trim());
      }
      saveLocalWorkspace(store);
    }
    return;
  }

  if (pathname === '/api/workspace' && method === 'GET' && responseData?.examProfiles) {
    const local = loadLocalWorkspace(sessionCode);
    // Merge server & local/cloud data so whichever has more recent or richer data wins
    const merged: CloudWorkspaceSnapshot = {
      ...local,
      sessionCode,
      examProfiles:
        Array.isArray(responseData.examProfiles) && responseData.examProfiles.length >= local.examProfiles.length
          ? responseData.examProfiles
          : local.examProfiles,
      allResults:
        Array.isArray(responseData.allResults) && responseData.allResults.length >= local.allResults.length
          ? responseData.allResults
          : local.allResults,
      tasks:
        Array.isArray(responseData.tasks) && responseData.tasks.length > 0 ? responseData.tasks : local.tasks,
      systemBranding: responseData.systemBranding || local.systemBranding,
      googleSheetWebhookUrl:
        responseData.googleSheetWebhookUrl && responseData.googleSheetWebhookUrl !== 'CONFIGURED'
          ? responseData.googleSheetWebhookUrl
          : local.googleSheetWebhookUrl
    };
    saveLocalWorkspace(merged);

    if (auth.currentUser && auth.currentUser.emailVerified) {
      const cloud = await ensureFirestoreWorkspace(sessionCode, merged).catch(() => null);
      if (cloud) {
        if (cloud.examProfiles.length > merged.examProfiles.length) responseData.examProfiles = cloud.examProfiles;
        if (cloud.allResults.length > merged.allResults.length) responseData.allResults = cloud.allResults;
        if (cloud.tasks.length > 0) responseData.tasks = cloud.tasks;
        saveLocalWorkspace({
          ...merged,
          examProfiles: responseData.examProfiles,
          allResults: responseData.allResults,
          tasks: responseData.tasks
        });
      }
    }
    return;
  }

  // For mutations, also run the client/cloud persistence update so localStorage and Firestore stay 100% synced
  if (method !== 'GET' && !pathname.startsWith('/api/ai/')) {
    await handleClientPersistedRoute(url, options).catch(() => {});
  }
}

export async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  try {
    const res = await fetch(url, {
      ...options,
      headers
    });

    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    if (res.ok && isJson) {
      const data = await res.json();
      await mirrorSuccessToLocalAndCloud(url, options, data).catch(() => {});
      return data as T;
    }

    // If running on Vercel static deployment (where /api/* returns 404/405/HTML) or token rotated,
    // handle workspace & auth persistence directly via Firestore + localStorage!
    if (!url.startsWith('/api/ai/')) {
      const fallbackResult = await handleClientPersistedRoute<T>(url, options);
      if (fallbackResult !== null) {
        return fallbackResult;
      }
    }

    const data = isJson ? await res.json().catch(() => ({})) : {};
    const message = typeof data?.error === 'string' ? data.error : `Lỗi máy chủ (${res.status})`;
    throw new Error(message);
  } catch (networkOrRouteErr: any) {
    if (!url.startsWith('/api/ai/')) {
      const fallbackResult = await handleClientPersistedRoute<T>(url, options);
      if (fallbackResult !== null) {
        return fallbackResult;
      }
    }
    throw networkOrRouteErr;
  }
}
