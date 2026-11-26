import {
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
const CLOUD_SEEDED_PREFIX = 'cambridge_grader_cloud_seeded_v2_';

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

function encodeBase64Unicode(obj: unknown): string {
  const json = JSON.stringify(obj);
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }
  return '';
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
    const compactResults = (store.allResults || []).map(r => ({
      ...r,
      pages: (r.pages || []).slice(0, 1).map(p => ({
        pageNum: p.pageNum,
        dataUrl: typeof p.dataUrl === 'string' && p.dataUrl.length < 120000 ? p.dataUrl : ''
      }))
    }));
    const payload = JSON.stringify({ ...store, sessionCode, allResults: compactResults });
    try {
      window.localStorage.setItem(`${LOCAL_WORKSPACE_PREFIX}${sessionCode}`, payload);
    } catch {
      // If localStorage 5MB quota is exceeded due to many cropped exam images, save a lightweight copy locally
      // while full images remain persisted in Firebase Firestore!
      const lightProfiles = (store.examProfiles || []).map(prof => ({
        ...prof,
        parts: (prof.parts || []).map(pt => ({
          ...pt,
          sceneImageDataUrl:
            typeof pt.sceneImageDataUrl === 'string' && pt.sceneImageDataUrl.length < 35000
              ? pt.sceneImageDataUrl
              : ''
        }))
      }));
      window.localStorage.setItem(
        `${LOCAL_WORKSPACE_PREFIX}${sessionCode}`,
        JSON.stringify({ ...store, sessionCode, examProfiles: lightProfiles, allResults: compactResults })
      );
    }
  } catch {
    // Ignore quota errors
  }
}

function toPublicTeacher(t: StoredCloudTeacher): TeacherAccount {
  const { passwordHash: _omitted, ...rest } = t;
  return rest;
}

/**
 * Automatically connects to and synchronizes with the shared Firebase Firestore database
 * as the authoritative multi-user source of truth.
 */
export async function syncWithSharedCloud(sessionCode = 'CAMBRIDGE-2026'): Promise<CloudWorkspaceSnapshot> {
  const cleanCode = sanitizeCode(sessionCode);
  const local = loadLocalWorkspace(cleanCode);
  try {
    const cloud = await ensureFirestoreWorkspace(cleanCode, local);
    if (cloud) {
      const seededKey = `${CLOUD_SEEDED_PREFIX}${cleanCode}`;
      const alreadySeeded =
        typeof window !== 'undefined' ? Boolean(window.localStorage.getItem(seededKey)) : true;

      if (!alreadySeeded && typeof window !== 'undefined') {
        window.localStorage.setItem(seededKey, '1');
        // One-time migration of any pre-existing local records into shared Firestore
        const cloudProfileIds = new Set(cloud.examProfiles.map(p => p.id));
        for (const p of local.examProfiles) {
          if (!cloudProfileIds.has(p.id)) {
            await upsertFirestoreProfile(cleanCode, p).catch(err =>
              console.warn('Initial profile push warning:', err)
            );
            cloud.examProfiles.unshift(p);
          }
        }
        const cloudResultIds = new Set(cloud.allResults.map(r => r.id));
        for (const r of local.allResults) {
          if (!cloudResultIds.has(r.id)) {
            await upsertFirestoreResult(cleanCode, r).catch(err =>
              console.warn('Initial result push warning:', err)
            );
            cloud.allResults.unshift(r);
          }
        }
        const cloudTaskIds = new Set(cloud.tasks.map(t => t.id));
        for (const t of local.tasks) {
          if (!cloudTaskIds.has(t.id)) {
            await upsertFirestoreTask(cleanCode, t).catch(err =>
              console.warn('Initial task push warning:', err)
            );
            cloud.tasks.unshift(t);
          }
        }
        const cloudTeacherIds = new Set(cloud.teacherAccounts.map(t => t.id));
        for (const t of local.teacherAccounts) {
          if (!cloudTeacherIds.has(t.id)) {
            await upsertFirestoreTeacher(cleanCode, t).catch(err =>
              console.warn('Initial teacher push warning:', err)
            );
            cloud.teacherAccounts.unshift(t);
          }
        }
        if (!cloud.adminPasswordHash && local.adminPasswordHash) {
          cloud.adminPasswordHash = local.adminPasswordHash;
          cloud.adminFullName = local.adminFullName || cloud.adminFullName;
          await updateFirestoreWorkspaceMeta(cleanCode, {
            adminFullName: cloud.adminFullName,
            adminPasswordHash: cloud.adminPasswordHash
          }).catch(() => {});
        }
      }

      saveLocalWorkspace(cloud);
      return cloud;
    }
  } catch (err) {
    console.warn('Firestore auto-sync warning, using local workspace cache:', err);
  }
  return local;
}

export async function pushAllLocalToFirestore(sessionCode = 'CAMBRIDGE-2026'): Promise<CloudWorkspaceSnapshot | null> {
  const cleanCode = sanitizeCode(sessionCode);
  const local = loadLocalWorkspace(cleanCode);
  await ensureFirestoreWorkspace(cleanCode, local);
  await updateFirestoreWorkspaceMeta(cleanCode, {
    adminFullName: local.adminFullName,
    adminPasswordHash: local.adminPasswordHash,
    systemBranding: local.systemBranding,
    googleSheetWebhookUrl: local.googleSheetWebhookUrl
  });
  for (const prof of local.examProfiles) {
    await upsertFirestoreProfile(cleanCode, prof);
  }
  for (const res of local.allResults) {
    await upsertFirestoreResult(cleanCode, res);
  }
  for (const task of local.tasks) {
    await upsertFirestoreTask(cleanCode, task);
  }
  for (const teacher of local.teacherAccounts) {
    await upsertFirestoreTeacher(cleanCode, teacher);
  }
  const latest = await loadFirestoreWorkspace(cleanCode);
  if (latest) saveLocalWorkspace(latest);
  return latest;
}

/**
 * Direct Shared Cloud (Firebase Firestore) + Local Cache handler for all workspace, auth & account routes.
 * Ensures 100% real-time persistence across Vercel and AI Studio for all users.
 */
async function handleSharedCloudDataRoute<T>(url: string, options: RequestInit = {}): Promise<T | null> {
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
    const store = await syncWithSharedCloud(sessionCode);
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
    const store = await syncWithSharedCloud(sessionCode);
    store.adminFullName = fullName;
    store.adminPasswordHash = simpleHash(password);
    saveLocalWorkspace(store);
    await updateFirestoreWorkspaceMeta(sessionCode, {
      adminFullName: store.adminFullName,
      adminPasswordHash: store.adminPasswordHash
    });

    const account: TeacherAccount = {
      id: 'root-admin',
      username: 'admin',
      fullName: store.adminFullName,
      role: 'admin',
      active: true,
      permissions: FULL_ADMIN_PERMS,
      createdAt: Date.now()
    };
    const token = `local-token.${encodeBase64Unicode({ sub: 'root-admin', role: 'admin', sessionCode })}`;
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
    const store = await syncWithSharedCloud(sessionCode);
    const inputHash = simpleHash(password);

    if (username === 'admin' || username === 'administrator') {
      if (!store.adminPasswordHash) {
        store.adminPasswordHash = inputHash;
        saveLocalWorkspace(store);
        await updateFirestoreWorkspaceMeta(sessionCode, {
          adminFullName: store.adminFullName,
          adminPasswordHash: store.adminPasswordHash
        });
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
      const token = `local-token.${encodeBase64Unicode({ sub: 'root-admin', role: 'admin', sessionCode })}`;
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
    const token = `local-token.${encodeBase64Unicode({ sub: account.id, role: 'teacher', sessionCode })}`;
    saveCachedAccount(sessionCode, account);
    return { token, sessionCode, account } as unknown as T;
  }

  // 4. GET /api/auth/me
  if (pathname === '/api/auth/me' && method === 'GET') {
    if (cachedAuth) {
      return cachedAuth as unknown as T;
    }
    throw new Error('Phiên đăng nhập đã hết hạn.');
  }

  // 5. GET /api/workspace
  if (pathname === '/api/workspace' && method === 'GET') {
    const store = await syncWithSharedCloud(sessionCode);
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
      await upsertFirestoreProfile(sessionCode, profile);
      return { profile } as unknown as T;
    }
    if (method === 'DELETE') {
      if (store.examProfiles.length <= 1) {
        throw new Error('Cần giữ lại ít nhất 1 bộ đề trong kho.');
      }
      store.examProfiles = store.examProfiles.filter(p => p.id !== profileId);
      saveLocalWorkspace(store);
      await deleteFirestoreProfile(sessionCode, profileId);
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
      await upsertFirestoreResult(sessionCode, finalRecord);
      return { record: finalRecord, wasUpdated: Boolean(duplicate) } as unknown as T;
    }
    if (method === 'DELETE') {
      store.allResults = store.allResults.filter(r => r.id !== resultId);
      saveLocalWorkspace(store);
      await deleteFirestoreResult(sessionCode, resultId);
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
        await upsertFirestoreTask(sessionCode, clean);
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
      await upsertFirestoreTask(sessionCode, cleanTask);
      return { task: cleanTask } as unknown as T;
    }
    if (method === 'DELETE') {
      store.tasks = store.tasks.filter(t => t.id !== taskId);
      saveLocalWorkspace(store);
      await deleteFirestoreTask(sessionCode, taskId);
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
    await updateFirestoreWorkspaceMeta(sessionCode, {
      systemBranding: store.systemBranding
    });
    return { systemBranding: store.systemBranding } as unknown as T;
  }

  // 11. PUT /api/workspace/sheet-url
  if (pathname === '/api/workspace/sheet-url' && method === 'PUT') {
    const rawUrl = String(body?.webhookUrl || '').trim();
    const store = loadLocalWorkspace(sessionCode);
    store.googleSheetWebhookUrl = rawUrl;
    saveLocalWorkspace(store);
    await updateFirestoreWorkspaceMeta(sessionCode, {
      googleSheetWebhookUrl: rawUrl
    });
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
    await pushAllLocalToFirestore(sessionCode);
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
    const store = await syncWithSharedCloud(sessionCode);
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
    await upsertFirestoreTeacher(sessionCode, created);
    return { account: toPublicTeacher(created) } as unknown as T;
  }

  // 14. PATCH / DELETE /api/accounts/:id
  if (pathname.startsWith('/api/accounts/')) {
    const accountId = decodeURIComponent(pathname.replace('/api/accounts/', ''));
    const store = await syncWithSharedCloud(sessionCode);
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
      await upsertFirestoreTeacher(sessionCode, target);
      return { account: toPublicTeacher(target) } as unknown as T;
    }
    if (method === 'DELETE') {
      store.teacherAccounts = store.teacherAccounts.filter(a => a.id !== accountId);
      saveLocalWorkspace(store);
      await deleteFirestoreTeacher(sessionCode, accountId);
      return { ok: true } as unknown as T;
    }
  }

  return null;
}

export async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  // For all workspace data, auth, and teacher account operations, use Shared Cloud Firestore directly
  // as the primary multi-user database so data is 100% persisted across AI Studio and Vercel!
  if (!url.startsWith('/api/ai/') && !url.startsWith('/api/sheets/')) {
    try {
      const cloudResult = await handleSharedCloudDataRoute<T>(url, options);
      if (cloudResult !== null) {
        // Also mirror to backend Express disk storage in the background when available
        fetch(url, { ...options, headers }).catch(() => {});
        return cloudResult;
      }
    } catch (cloudErr) {
      throw cloudErr;
    }
  }

  // For AI endpoints (/api/ai/*) and Google Sheets proxy (/api/sheets/*), call the server endpoint
  const res = await fetch(url, {
    ...options,
    headers
  });

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (res.ok && isJson) {
    const data = await res.json();
    return data as T;
  }

  const data = isJson ? await res.json().catch(() => ({})) : {};
  if (res.status === 413) {
    throw new Error('Dung lượng ảnh đề thi quá lớn (vượt giới hạn 4.5MB của máy chủ). Hệ thống sẽ tự nén nhỏ hơn, vui lòng thử lại.');
  }
  const message =
    typeof data?.error === 'string'
      ? data.error
      : `Lỗi kết nối AI máy chủ (HTTP ${res.status}). Nếu bạn đang chạy trên Vercel, hãy kiểm tra biến môi trường GEMINI_API_KEY và Redeploy.`;
  throw new Error(message);
}
