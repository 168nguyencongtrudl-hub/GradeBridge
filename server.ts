import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { INITIAL_EXAM_PROFILES, DEFAULT_SYSTEM_BRANDING, createInitialTasks } from './src/data/initialData.ts';
import type {
  ExamProfile,
  SmartTask,
  StudentResult,
  SystemBranding,
  TeacherAccount,
  UserPermissions
} from './src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

function resolveWritableRoomsDir(): string {
  const preferred = path.resolve(__dirname, 'data', 'rooms');
  try {
    fs.mkdirSync(preferred, { recursive: true });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    const fallback = path.resolve(os.tmpdir(), 'cambridge-grader-rooms');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

const ROOMS_DIR = resolveWritableRoomsDir();

function resolveSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretFile = path.resolve(ROOMS_DIR, '.session_secret');
  try {
    if (fs.existsSync(secretFile)) {
      const saved = fs.readFileSync(secretFile, 'utf8').trim();
      if (saved.length >= 32) return saved;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, generated, 'utf8');
    return generated;
  } catch {
    return crypto.createHash('sha256').update(__dirname).digest('hex');
  }
}

const SESSION_SECRET = resolveSessionSecret();

// ============================================================================
// SERVER-SIDE GEMINI CLIENT
// ============================================================================
function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY chưa được cấu hình trên máy chủ.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

const GEMINI_MODEL = 'gemini-4-hydrogen';

async function callGeminiJson<T>(params: {
  systemInstruction: string;
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
  responseSchema: Record<string, unknown>;
  thinkingLevel?: ThinkingLevel;
}): Promise<T> {
  const ai = getGeminiClient();
  let delay = 800;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: { parts: params.parts },
        config: {
          systemInstruction: params.systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: params.responseSchema,
          ...(params.thinkingLevel ? { thinkingConfig: { thinkingLevel: params.thinkingLevel } } : {})
        }
      });
      const text = (response.text ?? '{}').trim();
      return JSON.parse(text) as T;
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  return {} as T;
}

// ============================================================================
// PASSWORD HASHING (SCRYPT) & SIGNED BEARER TOKENS
// ============================================================================
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(keyHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function timingSafeStringMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

interface TokenPayload {
  sub: string;
  role: 'admin' | 'teacher';
  sessionCode: string;
  username: string;
  exp: number;
}

function signToken(payload: Omit<TokenPayload, 'exp'>): string {
  const full: TokenPayload = {
    ...payload,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7 // 7 days
  };
  const encoded = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token: string): TokenPayload | null {
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  const sigMatches = timingSafeStringMatch(sig, expectedSig);
  if (!sigMatches && Boolean(process.env.SESSION_SECRET)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (
      !decoded ||
      typeof decoded.sub !== 'string' ||
      (decoded.role !== 'admin' && decoded.role !== 'teacher') ||
      typeof decoded.sessionCode !== 'string' ||
      typeof decoded.exp !== 'number' ||
      decoded.exp < Date.now()
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

// ============================================================================
// SAFE ROOM DATA STORAGE (PATH CONFINED)
// ============================================================================
interface StoredTeacherAccount extends TeacherAccount {
  passwordHash: string;
}

interface RoomStore {
  sessionCode: string;
  adminFullName: string;
  adminPasswordHash: string | null;
  examProfiles: ExamProfile[];
  allResults: StudentResult[];
  tasks: SmartTask[];
  teacherAccounts: StoredTeacherAccount[];
  systemBranding: SystemBranding;
  googleSheetWebhookUrl: string;
}

function sanitizeSessionCode(raw: unknown): string {
  const cleaned = String(raw ?? 'CAMBRIDGE-2026')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
  return cleaned || 'CAMBRIDGE-2026';
}

function getRoomFilePath(sessionCode: string): string {
  const safeCode = sanitizeSessionCode(sessionCode);
  const resolved = path.resolve(ROOMS_DIR, `${safeCode}.json`);
  if (!resolved.startsWith(ROOMS_DIR + path.sep)) {
    throw new Error('Invalid session path');
  }
  return resolved;
}

function createDefaultRoom(sessionCode: string): RoomStore {
  const todayIso = new Date().toISOString().slice(0, 10);
  return {
    sessionCode,
    adminFullName: 'Administrator',
    adminPasswordHash: null,
    examProfiles: JSON.parse(JSON.stringify(INITIAL_EXAM_PROFILES)),
    allResults: [],
    tasks: createInitialTasks(todayIso),
    teacherAccounts: [],
    systemBranding: { ...DEFAULT_SYSTEM_BRANDING },
    googleSheetWebhookUrl: ''
  };
}

function loadRoom(sessionCode: string): RoomStore {
  const safeCode = sanitizeSessionCode(sessionCode);
  const filePath = getRoomFilePath(safeCode);
  if (!fs.existsSync(filePath)) {
    const fresh = createDefaultRoom(safeCode);
    saveRoom(fresh);
    return fresh;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<RoomStore>;
    const defaults = createDefaultRoom(safeCode);
    return {
      ...defaults,
      ...parsed,
      sessionCode: safeCode,
      examProfiles: Array.isArray(parsed.examProfiles) && parsed.examProfiles.length > 0 ? parsed.examProfiles : defaults.examProfiles,
      allResults: Array.isArray(parsed.allResults) ? parsed.allResults : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : defaults.tasks,
      teacherAccounts: Array.isArray(parsed.teacherAccounts) ? parsed.teacherAccounts : [],
      systemBranding: { ...DEFAULT_SYSTEM_BRANDING, ...(parsed.systemBranding || {}) },
      googleSheetWebhookUrl: typeof parsed.googleSheetWebhookUrl === 'string' ? parsed.googleSheetWebhookUrl : ''
    };
  } catch {
    const fresh = createDefaultRoom(safeCode);
    saveRoom(fresh);
    return fresh;
  }
}

function saveRoom(store: RoomStore): void {
  const filePath = getRoomFilePath(store.sessionCode);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function toPublicAccount(acc: StoredTeacherAccount): TeacherAccount {
  const { passwordHash: _omitted, ...publicFields } = acc;
  return publicFields;
}

const FULL_ADMIN_PERMS: UserPermissions = {
  canGrade: true,
  canViewExport: true,
  canPrintSheet: true,
  canManageExams: true,
  canDeleteResults: true
};

// ============================================================================
// AUTH MIDDLEWARE
// ============================================================================
interface AuthedRequest extends Request {
  auth?: {
    account: TeacherAccount;
    sessionCode: string;
  };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' });
    return;
  }
  const token = header.slice(7).trim();
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.' });
    return;
  }

  const room = loadRoom(payload.sessionCode);
  if (payload.role === 'admin' && payload.sub === 'root-admin') {
    req.auth = {
      sessionCode: room.sessionCode,
      account: {
        id: 'root-admin',
        username: 'admin',
        fullName: room.adminFullName || 'Administrator',
        role: 'admin',
        active: true,
        permissions: FULL_ADMIN_PERMS,
        createdAt: 0
      }
    };
    next();
    return;
  }

  const teacher = room.teacherAccounts.find(a => a.id === payload.sub);
  if (!teacher || !teacher.active) {
    res.status(403).json({ error: 'Tài khoản đã bị khóa hoặc không tồn tại.' });
    return;
  }

  req.auth = {
    sessionCode: room.sessionCode,
    account: toPublicAccount(teacher)
  };
  next();
}

function requirePermission(perm: keyof UserPermissions | 'admin') {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const account = req.auth?.account;
    if (!account) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (account.role === 'admin') {
      next();
      return;
    }
    if (perm === 'admin' || !account.permissions[perm]) {
      res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' });
      return;
    }
    next();
  };
}

// ============================================================================
// EXPRESS APP SETUP
// ============================================================================
async function startServer() {
  const app = express();
  app.use(express.json({ limit: '35mb' }));

  // --------------------------------------------------------------------------
  // AUTH ROUTES
  // --------------------------------------------------------------------------
  app.get('/api/auth/status', (req, res) => {
    const sessionCode = sanitizeSessionCode(req.query.sessionCode);
    const room = loadRoom(sessionCode);
    const envPasscode = (process.env.ADMIN_PASSCODE || '').trim();
    const adminConfigured = Boolean(envPasscode) || Boolean(room.adminPasswordHash);
    res.json({
      sessionCode: room.sessionCode,
      adminConfigured,
      envConfigured: Boolean(envPasscode),
      branding: room.systemBranding
    });
  });

  app.post('/api/auth/setup-admin', (req, res) => {
    const sessionCode = sanitizeSessionCode(req.body?.sessionCode);
    const fullName = String(req.body?.fullName || 'Administrator').trim().slice(0, 80) || 'Administrator';
    const password = String(req.body?.password || '').trim();

    if (password.length < 4) {
      res.status(400).json({ error: 'Mật khẩu quản trị cần tối thiểu 4 ký tự.' });
      return;
    }

    const envPasscode = (process.env.ADMIN_PASSCODE || '').trim();
    const room = loadRoom(sessionCode);
    if (envPasscode || room.adminPasswordHash) {
      res.status(409).json({ error: 'Quản trị viên đã được thiết lập cho phòng thi này. Vui lòng đăng nhập.' });
      return;
    }

    room.adminFullName = fullName;
    room.adminPasswordHash = hashPassword(password);
    saveRoom(room);

    const token = signToken({
      sub: 'root-admin',
      role: 'admin',
      sessionCode: room.sessionCode,
      username: 'admin'
    });

    res.json({
      token,
      sessionCode: room.sessionCode,
      account: {
        id: 'root-admin',
        username: 'admin',
        fullName: room.adminFullName,
        role: 'admin',
        active: true,
        permissions: FULL_ADMIN_PERMS,
        createdAt: Date.now()
      }
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const sessionCode = sanitizeSessionCode(req.body?.sessionCode);
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '').trim();

    if (!username || !password) {
      res.status(400).json({ error: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.' });
      return;
    }

    const room = loadRoom(sessionCode);
    const envPasscode = (process.env.ADMIN_PASSCODE || '').trim();

    if (username === 'admin' || username === 'administrator') {
      let valid = false;
      if (envPasscode) {
        valid = timingSafeStringMatch(password, envPasscode);
      } else if (room.adminPasswordHash) {
        valid = verifyPassword(password, room.adminPasswordHash);
      } else {
        res.status(409).json({ error: 'Chưa thiết lập mật khẩu quản trị. Vui lòng tạo mật khẩu quản trị lần đầu.' });
        return;
      }

      if (!valid) {
        res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
        return;
      }

      const token = signToken({
        sub: 'root-admin',
        role: 'admin',
        sessionCode: room.sessionCode,
        username: 'admin'
      });

      res.json({
        token,
        sessionCode: room.sessionCode,
        account: {
          id: 'root-admin',
          username: 'admin',
          fullName: room.adminFullName || 'Administrator',
          role: 'admin',
          active: true,
          permissions: FULL_ADMIN_PERMS,
          createdAt: 0
        }
      });
      return;
    }

    const matched = room.teacherAccounts.find(a => a.username.trim().toLowerCase() === username);
    if (!matched || !verifyPassword(password, matched.passwordHash)) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }
    if (!matched.active) {
      res.status(403).json({ error: 'This account has been locked by Administrator.' });
      return;
    }

    const token = signToken({
      sub: matched.id,
      role: 'teacher',
      sessionCode: room.sessionCode,
      username: matched.username
    });

    res.json({
      token,
      sessionCode: room.sessionCode,
      account: toPublicAccount(matched)
    });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({
      sessionCode: req.auth!.sessionCode,
      account: req.auth!.account
    });
  });

  // --------------------------------------------------------------------------
  // WORKSPACE DATA ROUTES
  // --------------------------------------------------------------------------
  app.get('/api/workspace', requireAuth, (req: AuthedRequest, res) => {
    const room = loadRoom(req.auth!.sessionCode);
    const isAdmin = req.auth!.account.role === 'admin';
    res.json({
      sessionCode: room.sessionCode,
      examProfiles: room.examProfiles,
      allResults: room.allResults,
      tasks: room.tasks,
      systemBranding: room.systemBranding,
      googleSheetWebhookUrl: isAdmin ? room.googleSheetWebhookUrl : Boolean(room.googleSheetWebhookUrl) ? 'CONFIGURED' : '',
      teacherAccounts: isAdmin ? room.teacherAccounts.map(toPublicAccount) : []
    });
  });

  // Exam Profiles
  app.put('/api/workspace/profiles/:id', requireAuth, requirePermission('canManageExams'), (req: AuthedRequest, res) => {
    const profile = req.body as ExamProfile;
    if (!profile || !profile.id || !profile.gradeName) {
      res.status(400).json({ error: 'Dữ liệu bộ đề không hợp lệ.' });
      return;
    }
    const room = loadRoom(req.auth!.sessionCode);
    const exists = room.examProfiles.some(p => p.id === profile.id);
    const cleanProfile: ExamProfile = { ...profile, updatedAt: Date.now() };
    room.examProfiles = exists
      ? room.examProfiles.map(p => (p.id === profile.id ? cleanProfile : p))
      : [cleanProfile, ...room.examProfiles];
    saveRoom(room);
    res.json({ profile: cleanProfile });
  });

  app.delete('/api/workspace/profiles/:id', requireAuth, requirePermission('canManageExams'), (req: AuthedRequest, res) => {
    const room = loadRoom(req.auth!.sessionCode);
    if (room.examProfiles.length <= 1) {
      res.status(400).json({ error: 'Cần giữ lại ít nhất 1 bộ đề trong kho.' });
      return;
    }
    room.examProfiles = room.examProfiles.filter(p => p.id !== req.params.id);
    saveRoom(room);
    res.json({ ok: true });
  });

  // Student Grading Results
  app.put('/api/workspace/results/:id', requireAuth, requirePermission('canGrade'), (req: AuthedRequest, res) => {
    const result = req.body as StudentResult;
    const overwriteDuplicate = req.query.overwriteDuplicate !== 'false';
    if (!result || !result.id || !result.profileId) {
      res.status(400).json({ error: 'Dữ liệu bài chấm không hợp lệ.' });
      return;
    }
    const room = loadRoom(req.auth!.sessionCode);
    const normName = (result.studentName || '').trim().toLowerCase();
    const normClass = (result.className || '').trim().toLowerCase();
    const normSchool = (result.schoolName || '').trim().toLowerCase();
    const duplicate =
      overwriteDuplicate && normName && normName !== 'chưa rõ'
        ? room.allResults.find(
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
      : result;

    // Limit embedded page images to prevent runaway JSON growth
    const safePages = (finalRecord.pages || []).slice(0, 1).map(p => ({
      pageNum: p.pageNum,
      dataUrl: typeof p.dataUrl === 'string' && p.dataUrl.length < 480000 ? p.dataUrl : ''
    }));
    const persistedRecord: StudentResult = { ...finalRecord, pages: safePages };

    const exists = room.allResults.some(r => r.id === persistedRecord.id);
    room.allResults = exists
      ? room.allResults.map(r => (r.id === persistedRecord.id ? persistedRecord : r))
      : [persistedRecord, ...room.allResults];
    saveRoom(room);

    // Fire-and-forget safe Google Sheets push if configured
    if (room.googleSheetWebhookUrl) {
      forwardToGoogleSheet(room.googleSheetWebhookUrl, room.sessionCode, persistedRecord).catch(() => {});
    }

    res.json({ record: persistedRecord, wasUpdated: Boolean(duplicate) });
  });

  app.delete('/api/workspace/results/:id', requireAuth, requirePermission('canDeleteResults'), (req: AuthedRequest, res) => {
    const room = loadRoom(req.auth!.sessionCode);
    room.allResults = room.allResults.filter(r => r.id !== req.params.id);
    saveRoom(room);
    res.json({ ok: true });
  });

  // Smart Tasks
  app.put('/api/workspace/tasks/:id', requireAuth, (req: AuthedRequest, res) => {
    const task = req.body as SmartTask;
    if (!task || !task.id || !task.title) {
      res.status(400).json({ error: 'Nội dung công việc không hợp lệ.' });
      return;
    }
    const room = loadRoom(req.auth!.sessionCode);
    const cleanTask: SmartTask = { ...task, updatedAt: Date.now() };
    const exists = room.tasks.some(t => t.id === cleanTask.id);
    room.tasks = exists
      ? room.tasks.map(t => (t.id === cleanTask.id ? cleanTask : t))
      : [cleanTask, ...room.tasks];
    saveRoom(room);
    res.json({ task: cleanTask });
  });

  app.post('/api/workspace/tasks/bulk', requireAuth, (req: AuthedRequest, res) => {
    const incoming = req.body?.tasks as SmartTask[];
    if (!Array.isArray(incoming)) {
      res.status(400).json({ error: 'Danh sách công việc không hợp lệ.' });
      return;
    }
    const room = loadRoom(req.auth!.sessionCode);
    const byId = new Map<string, SmartTask>();
    for (const existing of room.tasks) byId.set(existing.id, existing);
    for (const item of incoming) {
      if (item && item.id && item.title) {
        byId.set(item.id, { ...item, updatedAt: Date.now() });
      }
    }
    room.tasks = Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
    saveRoom(room);
    res.json({ tasks: room.tasks });
  });

  app.delete('/api/workspace/tasks/:id', requireAuth, (req: AuthedRequest, res) => {
    const room = loadRoom(req.auth!.sessionCode);
    room.tasks = room.tasks.filter(t => t.id !== req.params.id);
    saveRoom(room);
    res.json({ ok: true });
  });

  // Branding, Sheet URL & Restore (Admin only)
  app.put('/api/workspace/branding', requireAuth, requirePermission('admin'), (req: AuthedRequest, res) => {
    const room = loadRoom(req.auth!.sessionCode);
    const incoming = req.body as Partial<SystemBranding>;
    room.systemBranding = {
      ...DEFAULT_SYSTEM_BRANDING,
      ...room.systemBranding,
      ...incoming,
      updatedAt: Date.now()
    };
    saveRoom(room);
    res.json({ systemBranding: room.systemBranding });
  });

  app.put('/api/workspace/sheet-url', requireAuth, requirePermission('admin'), (req: AuthedRequest, res) => {
    const rawUrl = String(req.body?.webhookUrl || '').trim();
    if (rawUrl && !isAllowedGoogleScriptUrl(rawUrl)) {
      res.status(400).json({ error: 'URL phải là đường dẫn HTTPS hợp lệ từ script.google.com.' });
      return;
    }
    const room = loadRoom(req.auth!.sessionCode);
    room.googleSheetWebhookUrl = rawUrl;
    saveRoom(room);
    res.json({ webhookUrl: rawUrl });
  });

  app.post('/api/workspace/restore', requireAuth, requirePermission('admin'), (req: AuthedRequest, res) => {
    const payload = req.body || {};
    const room = loadRoom(req.auth!.sessionCode);
    if (payload.systemBranding && typeof payload.systemBranding === 'object') {
      room.systemBranding = { ...DEFAULT_SYSTEM_BRANDING, ...payload.systemBranding, updatedAt: Date.now() };
    }
    if (typeof payload.googleSheetWebhookUrl === 'string') {
      if (!payload.googleSheetWebhookUrl || isAllowedGoogleScriptUrl(payload.googleSheetWebhookUrl)) {
        room.googleSheetWebhookUrl = payload.googleSheetWebhookUrl;
      }
    }
    if (Array.isArray(payload.examProfiles) && payload.examProfiles.length > 0) {
      room.examProfiles = payload.examProfiles;
    }
    if (Array.isArray(payload.allResults)) {
      room.allResults = payload.allResults;
    }
    if (Array.isArray(payload.tasks)) {
      room.tasks = payload.tasks;
    }
    saveRoom(room);
    res.json({
      examProfiles: room.examProfiles,
      allResults: room.allResults,
      tasks: room.tasks,
      systemBranding: room.systemBranding,
      googleSheetWebhookUrl: room.googleSheetWebhookUrl
    });
  });

  // Teacher Account Management (Admin only)
  app.post('/api/accounts', requireAuth, requirePermission('admin'), (req: AuthedRequest, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '').trim();
    const fullName = String(req.body?.fullName || '').trim();
    const permissions = (req.body?.permissions || {}) as UserPermissions;

    if (!username || !password || !fullName) {
      res.status(400).json({ error: 'Vui lòng nhập đầy đủ Họ tên, Tên đăng nhập và Mật khẩu.' });
      return;
    }
    if (password.length < 4) {
      res.status(400).json({ error: 'Mật khẩu cần tối thiểu 4 ký tự.' });
      return;
    }

    const room = loadRoom(req.auth!.sessionCode);
    if (
      username.toLowerCase() === 'admin' ||
      room.teacherAccounts.some(a => a.username.toLowerCase() === username.toLowerCase())
    ) {
      res.status(409).json({ error: 'Tên đăng nhập này đã tồn tại.' });
      return;
    }

    const created: StoredTeacherAccount = {
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
      passwordHash: hashPassword(password),
      createdAt: Date.now()
    };

    room.teacherAccounts = [created, ...room.teacherAccounts];
    saveRoom(room);
    res.json({ account: toPublicAccount(created) });
  });

  app.patch('/api/accounts/:id', requireAuth, requirePermission('admin'), (req: AuthedRequest, res) => {
    const room = loadRoom(req.auth!.sessionCode);
    const target = room.teacherAccounts.find(a => a.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
      return;
    }
    if (typeof req.body?.active === 'boolean') {
      target.active = req.body.active;
    }
    if (req.body?.permissions && typeof req.body.permissions === 'object') {
      target.permissions = {
        ...target.permissions,
        ...req.body.permissions
      };
    }
    if (typeof req.body?.newPassword === 'string' && req.body.newPassword.trim().length >= 4) {
      target.passwordHash = hashPassword(req.body.newPassword.trim());
    }
    saveRoom(room);
    res.json({ account: toPublicAccount(target) });
  });

  app.delete('/api/accounts/:id', requireAuth, requirePermission('admin'), (req: AuthedRequest, res) => {
    const room = loadRoom(req.auth!.sessionCode);
    room.teacherAccounts = room.teacherAccounts.filter(a => a.id !== req.params.id);
    saveRoom(room);
    res.json({ ok: true });
  });

  // --------------------------------------------------------------------------
  // GOOGLE SHEETS SSRF-SAFE PROXY
  // --------------------------------------------------------------------------
  app.post('/api/sheets/sync-all', requireAuth, requirePermission('admin'), async (req: AuthedRequest, res) => {
    const room = loadRoom(req.auth!.sessionCode);
    if (!room.googleSheetWebhookUrl || !isAllowedGoogleScriptUrl(room.googleSheetWebhookUrl)) {
      res.status(400).json({ error: 'Chưa cấu hình URL Google Apps Script hợp lệ.' });
      return;
    }
    let sent = 0;
    for (const record of room.allResults) {
      const ok = await forwardToGoogleSheet(room.googleSheetWebhookUrl, room.sessionCode, record);
      if (ok) sent++;
    }
    res.json({ sent, total: room.allResults.length });
  });

  // --------------------------------------------------------------------------
  // GEMINI AI ROUTES (SERVER-SIDE ONLY)
  // --------------------------------------------------------------------------
  app.post('/api/ai/deconstruct-exam', requireAuth, requirePermission('canManageExams'), async (req: AuthedRequest, res) => {
    try {
      const blankExamImages: string[] = Array.isArray(req.body?.blankExamImages)
        ? req.body.blankExamImages.slice(0, 12)
        : [];
      const answerKeyImages: string[] = Array.isArray(req.body?.answerKeyImages)
        ? req.body.answerKeyImages.slice(0, 12)
        : Array.isArray(req.body?.sourceImages)
          ? req.body.sourceImages.slice(0, 12)
          : [];
      const answerKeyText = String(req.body?.answerKeyText || '');
      const fallbackLevel = String(req.body?.fallbackLevel || 'Cambridge Pre-A1 Starters');

      const hasBlank = blankExamImages.length > 0;
      const hasKey = answerKeyImages.length > 0;

      const systemInstruction = `You are a Cambridge English Assessment specialist (Pre-A1 Starters, A1 Movers, A2 Flyers) designing visual, kid-friendly 1-Page Summary Student Answer Sheets (9->1) for young learners (ages 6-10 who know limited English reading).
When BOTH a Blank Student Exam and an Official Answer Key are provided:
- Use DOCUMENT 1 (BLANK STUDENT EXAM, source="blank") for exact student-facing prompts, examples, distractors, AND clean visual illustration crops (NEVER leaking answers or red answer lines).
- Use DOCUMENT 2 (OFFICIAL ANSWER KEY, source="key") to extract exact correct answers ("ans"), trace drawn lines accurately to target codes (A..E), confirm colours, ✓/✗, YES/NO, MCQ letters, and exact spellings.

VISUAL IMAGE EXTRACTION (HIGH PRIORITY FOR YOUNG LEARNERS):
Each uploaded page is labeled with its source ("blank" or "key") and 0-based pageIndex (e.g., [BLANK PAGE 0], [KEY PAGE 0]).
Whenever an exam page contains illustrations/pictures, return tight normalized bounding boxes (0 to 1000 scale: ymin, xmin, ymax, xmax where ymin < ymax and xmin < xmax) so the app can automatically crop and embed the real exam pictures onto the student answer sheet:
- Prefer source="blank" whenever blank pages are provided (so cropped images have NO answer lines or answer text). Only use source="key" if no blank pages were uploaded.
- For "draw_lines" (Listening Part 1):
  * MANDATORY whenever exam page images are provided: For EVERY target in "targets" (A, B, C, D, E...), you MUST return a tight, accurate "imageCrop" cropping THAT SPECIFIC PERSON/CHARACTER (head-to-body plus their key object, e.g. boy in blue cap + bee, girl + snake, farmer + fence) from source="blank" (fallback source="key" only if blank was not uploaded). The printed student answer sheet replaces all text descriptions with these cropped pictures!
  * Also return "sceneCrop" for the overall scene picture if present.
  * Keep each target's "label" concise (2-6 words, for teacher reference only).
- For "yes_no" or "listen_colour" with a single shared scene picture: return "sceneCrop" for that illustration.
- For "tick_cross", "text_blank" (picture spelling like bookshop/child/farmer), "listen_colour" (if individual objects are shown), or visual "mcq_abc": return "imageCrop" on each item tightly cropping the picture for that question (ONLY the picture, excluding any written answer!).

Formatting rules:
1. Classify every Part strictly by its actual question format:
   - "draw_lines": Matching names to people in a picture. Include "targets" with codes (A..E), concise simple English labels, and "imageCrop" for every person (including distractors). Set item prompt = character name (e.g., "Adam"), ans = target code ("A").
   - "listen_colour": Listening and colouring objects. Put distinct uppercase colours in "options" and uppercase colour in "ans". Do NOT write the colour answer in prompt.
   - "tick_cross": Put a tick (✓) or cross (✗). Normalize ans to "✓" or "✗".
   - "yes_no": Normalize ans to "YES" or "NO".
   - "mcq_abc": Multiple choice A, B, C (or D).
   - "matching_ag": Matching letters A-G.
   - "text_blank": Writing words, names, or numbers. Include concise student-facing prompt labels from the blank exam when present without leaking the answer.
2. Skip Example questions (0 / Example) in graded items (you may mention the example in the part's "note"), and number graded items q sequentially from 1 to N.
3. Set "skill" strictly to "Listening" or "Reading & Writing".
4. Return a clean, readable "formattedAnswerText" summarizing all parts and answers.`;

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        {
          text: `Analyze the provided Cambridge exam materials (${fallbackLevel}) and build the complete kid-friendly visual 1-Page Summary Answer Sheet structure in 100% English, including tight 0-1000 bounding-box imageCrops for characters and question illustrations.
Provided inputs: ${hasBlank ? `${blankExamImages.length} blank student exam page(s) [source="blank", pageIndex 0..${blankExamImages.length - 1}]` : 'no blank exam images'}, ${hasKey ? `${answerKeyImages.length} answer key page(s) [source="key", pageIndex 0..${answerKeyImages.length - 1}]` : 'no answer key images'}.
${answerKeyText.trim() ? `Attached answer key text:\n${answerKeyText}` : ''}`
        }
      ];

      if (hasBlank) {
        parts.push({
          text: '=== DOCUMENT 1: BLANK STUDENT EXAM (source="blank" — use for student prompts, distractors & clean illustration imageCrops) ==='
        });
        blankExamImages.forEach((b64, idx) => {
          if (typeof b64 === 'string' && b64.length > 0) {
            parts.push({ text: `[BLANK PAGE ${idx}]` });
            parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
          }
        });
      }

      if (hasKey) {
        parts.push({
          text: '=== DOCUMENT 2: OFFICIAL ANSWER KEY EXAM (source="key" — use for exact correct answers, line-matching traces, colours, ticks, YES/NO & spellings) ==='
        });
        answerKeyImages.forEach((b64, idx) => {
          if (typeof b64 === 'string' && b64.length > 0) {
            parts.push({ text: `[KEY PAGE ${idx}]` });
            parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
          }
        });
      }

      const cropBoxSchema = {
        type: Type.OBJECT,
        properties: {
          source: { type: Type.STRING },
          pageIndex: { type: Type.INTEGER },
          ymin: { type: Type.INTEGER },
          xmin: { type: Type.INTEGER },
          ymax: { type: Type.INTEGER },
          xmax: { type: Type.INTEGER }
        },
        required: ['pageIndex', 'ymin', 'xmin', 'ymax', 'xmax']
      };

      const aiRes = await callGeminiJson<{
        suggestedGrade?: string;
        suggestedTitle?: string;
        formattedAnswerText?: string;
        parts?: any[];
      }>({
        systemInstruction,
        parts,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggestedGrade: { type: Type.STRING },
            suggestedTitle: { type: Type.STRING },
            formattedAnswerText: { type: Type.STRING },
            parts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  skill: { type: Type.STRING },
                  type: { type: Type.STRING },
                  note: { type: Type.STRING },
                  sceneCrop: cropBoxSchema,
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  targets: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        code: { type: Type.STRING },
                        label: { type: Type.STRING },
                        imageCrop: cropBoxSchema
                      },
                      required: ['code', 'label']
                    }
                  },
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        q: { type: Type.INTEGER },
                        prompt: { type: Type.STRING },
                        ans: { type: Type.STRING },
                        targetDesc: { type: Type.STRING },
                        imageCrop: cropBoxSchema
                      },
                      required: ['q', 'ans']
                    }
                  }
                },
                required: ['title', 'skill', 'type', 'items']
              }
            }
          },
          required: ['formattedAnswerText', 'parts']
        }
      });

      // PASS 2: Dedicated Visual Object-Detection Cropper Pass (prioritizes cropping real exam illustrations cleanly!)
      const visualPages = hasBlank ? blankExamImages : answerKeyImages;
      const visualSource: 'blank' | 'key' = hasBlank ? 'blank' : 'key';
      if (visualPages.length > 0 && Array.isArray(aiRes.parts) && aiRes.parts.length > 0) {
        try {
          aiRes.parts = await runDedicatedVisualCropPass(aiRes.parts, visualPages, visualSource);
        } catch {
          // Non-fatal: keep Pass 1 crops if Pass 2 fails
        }
      }

      res.json(aiRes);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Lỗi AI phân tích đề thi.' });
    }
  });

  // Shared helper: Dedicated AI Vision Bounding-Box Extractor (Gemini box_2d [ymin, xmin, ymax, xmax] 0..1000)
  async function runDedicatedVisualCropPass(
    examParts: any[],
    pageImages: string[],
    source: 'blank' | 'key'
  ): Promise<any[]> {
    const requests: Array<{
      slotId: string;
      partIdx: number;
      kind: 'scene' | 'target' | 'item';
      subIdx?: number;
      description: string;
    }> = [];

    examParts.forEach((part, pIdx) => {
      const pType = String(part?.type || '');
      const pTitle = String(part?.title || `Part ${pIdx + 1}`);

      if (pType === 'draw_lines') {
        (part.targets || []).forEach((tg: any, tIdx: number) => {
          const code = String(tg?.code || String.fromCharCode(65 + tIdx));
          const desc = String(tg?.label || '').trim() || `Person/Character ${code}`;
          requests.push({
            slotId: `p${pIdx}_t${tIdx}`,
            partIdx: pIdx,
            kind: 'target',
            subIdx: tIdx,
            description: `${pTitle} — Target ${code}: Crop ONLY the specific person/character + their key object: "${desc}". Tight head-to-body crop, excluding printed names outside the picture.`
          });
        });
      } else if (pType === 'yes_no' || pType === 'listen_colour') {
        requests.push({
          slotId: `p${pIdx}_scene`,
          partIdx: pIdx,
          kind: 'scene',
          description: `${pTitle} — Main shared scene illustration for this part (excluding title text and answer blanks).`
        });
        (part.items || []).forEach((it: any, iIdx: number) => {
          const hint = String(it?.targetDesc || it?.prompt || it?.ans || '').trim();
          if (pType === 'listen_colour') {
            requests.push({
              slotId: `p${pIdx}_i${iIdx}`,
              partIdx: pIdx,
              kind: 'item',
              subIdx: iIdx,
              description: `${pTitle} — Q${it?.q ?? iIdx + 1}: Specific object to colour${hint ? ` (${hint})` : ''}.`
            });
          }
        });
      } else if (pType === 'tick_cross' || pType === 'text_blank' || pType === 'mcq_abc') {
        if (pType === 'text_blank') {
          requests.push({
            slotId: `p${pIdx}_scene`,
            partIdx: pIdx,
            kind: 'scene',
            description: `${pTitle} — ONLY if this part has ONE shared scene illustration (e.g. Listening Part 2 'Listen and write' about a picture), crop that shared illustration (excluding instructions text). Do NOT repeat the shared scene on individual items.`
          });
        }
        (part.items || []).forEach((it: any, iIdx: number) => {
          const hint = String(it?.prompt || it?.targetDesc || it?.ans || '').trim();
          requests.push({
            slotId: `p${pIdx}_i${iIdx}`,
            partIdx: pIdx,
            kind: 'item',
            subIdx: iIdx,
            description: `${pTitle} — Question ${it?.q ?? iIdx + 1}: ONLY if this question has its OWN DISTINCT individual illustration (e.g. a specific object/animal for spelling or tick/cross)${hint ? ` (context: ${hint})` : ''}. Crop ONLY that distinct picture — skip if all questions share one single scene image.`
          });
        });
      }
    });

    if (requests.length === 0 || pageImages.length === 0) return examParts;

    const visionSystemInstruction = `You are a precision Visual Illustration Extractor for young-learner Cambridge English exam sheets.
Your SOLE job is to inspect the provided exam pages and locate exact tight 2D bounding boxes (box_2d = [ymin, xmin, ymax, xmax], integer 0..1000 normalized to page height & width) for every requested illustration slot!

STRICT PRIORITIES:
1. HIGHEST PRIORITY — Every "draw_lines" Target (A, B, C, D, E...): You MUST locate and return a clean, tight box_2d around EACH distinct person/character described! Include the character's head, clothes, and the key item they are holding/pointing at so a 6-year-old child immediately recognizes them by sight. Do NOT include the printed text names around the outside of the scene!
2. Picture questions ("tick_cross", picture "text_blank", "listen_colour", visual "mcq_abc"): Locate each question's illustration cleanly, excluding answer lines/words/ticks.
3. Shared scene illustrations ("yes_no", "listen_colour"): Return the main illustration box.
4. Only omit a slot if that question truly has NO illustration/picture anywhere in the provided exam pages (e.g. a pure text fill-in-the-blank passage).
5. Always verify pageIndex (0 to ${pageImages.length - 1}), ensure 0 <= ymin < ymax <= 1000 and 0 <= xmin < xmax <= 1000, and make every box tight and accurate.`;

    const visionParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      {
        text: `Locate exact 0..1000 bounding boxes (box_2d: [ymin, xmin, ymax, xmax]) on the ${pageImages.length} exam page(s) below for these illustration slots:\n${requests
          .map(r => `- [${r.slotId}] ${r.description}`)
          .join('\n')}`
      }
    ];

    pageImages.forEach((b64, idx) => {
      if (typeof b64 === 'string' && b64.length > 0) {
        visionParts.push({ text: `[EXAM PAGE ${idx}]` });
        visionParts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
      }
    });

    const cropResult = await callGeminiJson<{
      crops?: Array<{
        slotId: string;
        pageIndex: number;
        box_2d: number[];
      }>;
    }>({
      systemInstruction: visionSystemInstruction,
      parts: visionParts,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          crops: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                slotId: { type: Type.STRING },
                pageIndex: { type: Type.INTEGER },
                box_2d: {
                  type: Type.ARRAY,
                  items: { type: Type.INTEGER }
                }
              },
              required: ['slotId', 'pageIndex', 'box_2d']
            }
          }
        },
        required: ['crops']
      }
    });

    const bySlot = new Map<string, { source: 'blank' | 'key'; pageIndex: number; ymin: number; xmin: number; ymax: number; xmax: number }>();
    for (const c of cropResult.crops || []) {
      if (!c || !c.slotId || !Array.isArray(c.box_2d) || c.box_2d.length < 4) continue;
      const [y1, x1, y2, x2] = c.box_2d.map(Number);
      if (![y1, x1, y2, x2].every(Number.isFinite)) continue;
      const ymin = Math.max(0, Math.min(1000, Math.min(y1, y2)));
      const ymax = Math.max(0, Math.min(1000, Math.max(y1, y2)));
      const xmin = Math.max(0, Math.min(1000, Math.min(x1, x2)));
      const xmax = Math.max(0, Math.min(1000, Math.max(x1, x2)));
      if (ymax <= ymin + 15 || xmax <= xmin + 15) continue;
      const pageIndex = Math.max(0, Math.min(pageImages.length - 1, Math.floor(Number(c.pageIndex) || 0)));
      bySlot.set(c.slotId, { source, pageIndex, ymin, xmin, ymax, xmax });
    }

    return examParts.map((part, pIdx) => {
      const nextPart = { ...part };
      const sceneBox = bySlot.get(`p${pIdx}_scene`);
      if (sceneBox) {
        nextPart.sceneCrop = sceneBox;
      }
      if (Array.isArray(part.targets)) {
        nextPart.targets = part.targets.map((tg: any, tIdx: number) => {
          const tBox = bySlot.get(`p${pIdx}_t${tIdx}`);
          return tBox ? { ...tg, imageCrop: tBox } : tg;
        });
      }
      if (Array.isArray(part.items)) {
        nextPart.items = part.items.map((it: any, iIdx: number) => {
          const iBox = bySlot.get(`p${pIdx}_i${iIdx}`);
          return iBox ? { ...it, imageCrop: iBox } : it;
        });
      }
      return nextPart;
    });
  }

  // Dedicated endpoint: Auto-extract & crop visual illustrations for an existing exam profile
  app.post('/api/ai/extract-part-images', requireAuth, requirePermission('canManageExams'), async (req: AuthedRequest, res) => {
    try {
      const blankExamImages: string[] = Array.isArray(req.body?.blankExamImages)
        ? req.body.blankExamImages.slice(0, 12)
        : [];
      const answerKeyImages: string[] = Array.isArray(req.body?.answerKeyImages)
        ? req.body.answerKeyImages.slice(0, 12)
        : [];
      const existingParts: any[] = Array.isArray(req.body?.parts) ? req.body.parts : [];

      const visualPages = blankExamImages.length > 0 ? blankExamImages : answerKeyImages;
      const visualSource: 'blank' | 'key' = blankExamImages.length > 0 ? 'blank' : 'key';

      if (visualPages.length === 0) {
        res.status(400).json({ error: 'Vui lòng nạp tệp đề trắng hoặc đề đáp án trước khi AI tự cắt ảnh.' });
        return;
      }
      if (existingParts.length === 0) {
        res.status(400).json({ error: 'Bộ đề chưa có cấu trúc phần thi.' });
        return;
      }

      const enrichedParts = await runDedicatedVisualCropPass(existingParts, visualPages, visualSource);
      res.json({ parts: enrichedParts });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Lỗi AI tự cắt hình minh họa từ đề.' });
    }
  });

  app.post('/api/ai/grade-omr', requireAuth, requirePermission('canGrade'), async (req: AuthedRequest, res) => {
    try {
      const imageBase64 = String(req.body?.imageBase64 || '');
      const examTitle = String(req.body?.examTitle || '');
      const gradeName = String(req.body?.gradeName || '');
      const totalQ = Number(req.body?.totalQ || 0);
      const schemaDescription = String(req.body?.schemaDescription || '');
      const isLiveScan = Boolean(req.body?.isLiveScan);

      if (!imageBase64) {
        res.status(400).json({ error: 'Thiếu dữ liệu hình ảnh phiếu thi.' });
        return;
      }

      const systemInstruction = `You are an AI Optical & Handwriting Grader for the Cambridge 1-Page Answer Sheet "${examTitle}" (${gradeName}).
The sheet has 4 black corner alignment markers and contains these sections:
${schemaDescription}

Tasks:
1. Sheet Validation ("sheetDetected"):
   - Check if this image actually shows a readable exam answer sheet / test paper inside the frame.
   - If the image is an empty table, face, ceiling, hand, blank wall, or severely blurry/cut-off so questions cannot be read, set "sheetDetected" to false and provide a short helpful guidance message in Vietnamese in "detectionNote" (e.g., "Chưa thấy rõ phiếu thi trong khung — hãy căn 4 góc phiếu vào khung").
   - Otherwise set "sheetDetected" to true and "detectionNote" to "".
2. Student Identity Header Extraction (HIGH PRIORITY — read printed or handwritten Vietnamese/English carefully):
   - studentName: Full student name from "Full Name" / "Họ và tên" / "Name" field (preserve Vietnamese diacritics accurately; return "" if completely blank).
   - schoolName: School name from "School" / "Trường" field (e.g. "Tiểu học Nguyễn Bỉnh Khiêm", "Nguyen Binh Khiem Primary School"; preserve full school name; return "" if blank).
   - className: Class name from "Class" / "Lớp" field (e.g. "2A1", "3B", "Starters 1"; return "" if blank).
3. Read the student's answer for ALL ${totalQ} questions:
   - For "draw_lines": Trace the drawn line from each top name dot (or left name dot on older sheets) to its connected picture target dot (A, B, C, D, E...) and return the target code letter. Return "" if unattempted.
   - For "mcq_abc", "listen_colour", "yes_no", "tick_cross", "matching_ag": Return the darkened/circled/ticked value (e.g., A, RED, YES, ✓). Return "" if blank.
   - For "text_blank": Transcribe the handwritten English word or number on the line. Return "" if blank.
4. Return the complete "answers" array containing ${totalQ} items when sheetDetected is true (or empty array if sheetDetected is false).`;

      const aiRes = await callGeminiJson({
        systemInstruction,
        thinkingLevel: isLiveScan ? ThinkingLevel.LOW : undefined,
        parts: [
          {
            text: `Validate and grade this 1-page Cambridge answer sheet (${totalQ} questions total). Carefully extract Full Name (studentName), School (schoolName), Class (className), and all ${totalQ} answers.`
          },
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }
        ],
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sheetDetected: { type: Type.BOOLEAN },
            detectionNote: { type: Type.STRING },
            studentName: { type: Type.STRING },
            className: { type: Type.STRING },
            schoolName: { type: Type.STRING },
            answers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  q: { type: Type.INTEGER },
                  studentAnswer: { type: Type.STRING }
                },
                required: ['q', 'studentAnswer']
              }
            }
          },
          required: ['sheetDetected', 'studentName', 'className', 'schoolName', 'answers']
        }
      });

      res.json(aiRes);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Lỗi AI chấm phiếu 1 trang.' });
    }
  });

  app.post('/api/ai/grade-batch-student', requireAuth, requirePermission('canGrade'), async (req: AuthedRequest, res) => {
    try {
      const pageImages: string[] = Array.isArray(req.body?.pageImages) ? req.body.pageImages.slice(0, 20) : [];
      const answerKeyText = String(req.body?.answerKeyText || '');

      if (pageImages.length === 0) {
        res.status(400).json({ error: 'Thiếu ảnh trang bài làm.' });
        return;
      }

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        {
          text: `Grade this student's handwritten Cambridge exam (${pageImages.length} pages) against the official answer key below.\n\nOFFICIAL ANSWER KEY:\n${answerKeyText}`
        }
      ];
      for (const b64 of pageImages) {
        parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
      }

      const aiRes = await callGeminiJson({
        systemInstruction:
          'You are an expert Cambridge English examiner. Extract studentName, className, schoolName from page 1, compare every question with the Official Answer Key, and return structured grading JSON.',
        parts,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            studentName: { type: Type.STRING },
            className: { type: Type.STRING },
            schoolName: { type: Type.STRING },
            sectionBreakdown: { type: Type.STRING },
            teacherNote: { type: Type.STRING },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  questionNumber: { type: Type.STRING },
                  studentAnswer: { type: Type.STRING },
                  correctAnswer: { type: Type.STRING },
                  isCorrect: { type: Type.BOOLEAN },
                  note: { type: Type.STRING }
                },
                required: ['questionNumber', 'studentAnswer', 'correctAnswer', 'isCorrect']
              }
            }
          },
          required: ['studentName', 'className', 'schoolName', 'questions']
        }
      });

      res.json(aiRes);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Lỗi AI chấm bài PDF.' });
    }
  });

  // Smart Task Management AI #1: Natural Language Breakdown
  app.post('/api/ai/tasks/breakdown', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const prompt = String(req.body?.prompt || '').trim();
      const contextGrade = String(req.body?.contextGrade || '');
      const todayIso = String(req.body?.todayIso || new Date().toISOString().slice(0, 10));
      const defaultAssignee = String(req.body?.defaultAssignee || req.auth!.account.fullName);

      if (!prompt) {
        res.status(400).json({ error: 'Vui lòng nhập mô tả công việc.' });
        return;
      }

      const systemInstruction = `You are a concise, intelligent productivity planner for Cambridge English teachers and exam coordinators.
Given a user's natural language goal or messy note, break it down into 1 to 5 crisp, concrete, actionable tasks in the SAME language as the user's input (Vietnamese or English).
Today's date is ${todayIso}. Active grade context: ${contextGrade || 'General'}.
Rules:
- Each task must have a clear action-verb title (under 90 chars).
- Assign realistic priority: "urgent", "high", "medium", or "low".
- Assign category: "grading", "preparation", "follow_up", "admin", or "general".
- Infer dueDate as YYYY-MM-DD relative to ${todayIso} if a deadline is mentioned, otherwise "".
- Estimate realistic duration in minutes (5 to 120).
- Include 2-3 short subtasks when helpful.
- Provide a brief 1-sentence aiReason explaining why this priority/schedule makes sense.`;

      const aiRes = await callGeminiJson({
        systemInstruction,
        parts: [{ text: `User input: ${prompt}\nDefault assignee: ${defaultAssignee}` }],
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            tasks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  priority: { type: Type.STRING },
                  category: { type: Type.STRING },
                  dueDate: { type: Type.STRING },
                  estimatedMinutes: { type: Type.INTEGER },
                  assignee: { type: Type.STRING },
                  aiReason: { type: Type.STRING },
                  subtasks: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  }
                },
                required: ['title', 'priority', 'category', 'estimatedMinutes']
              }
            }
          },
          required: ['summary', 'tasks']
        }
      });

      res.json(aiRes);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Lỗi AI lập kế hoạch công việc.' });
    }
  });

  // Smart Task Management AI #2: Smart Prioritization
  app.post('/api/ai/tasks/prioritize', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const tasks = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
      const todayIso = String(req.body?.todayIso || new Date().toISOString().slice(0, 10));
      const lang = req.body?.lang === 'en' ? 'English' : 'Vietnamese';

      if (tasks.length === 0) {
        res.status(400).json({ error: 'Không có công việc nào đang mở để sắp xếp.' });
        return;
      }

      const compactTasks = tasks.map((t: SmartTask) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        category: t.category,
        dueDate: t.dueDate,
        estimatedMinutes: t.estimatedMinutes
      }));

      const systemInstruction = `You are a smart task prioritizer using Eisenhower urgency-impact principles.
Today is ${todayIso}. Respond in ${lang}.
Review the open tasks and return:
1. "focusAdvice": 1-2 crisp sentences stating what to focus on first today and why.
2. "ranked": Every task ID ordered from highest priority to lowest, with updated "priority" ("urgent"|"high"|"medium"|"low") and a short 1-line "aiReason".`;

      const aiRes = await callGeminiJson({
        systemInstruction,
        parts: [{ text: JSON.stringify(compactTasks) }],
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            focusAdvice: { type: Type.STRING },
            ranked: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  priority: { type: Type.STRING },
                  aiReason: { type: Type.STRING }
                },
                required: ['id', 'priority', 'aiReason']
              }
            }
          },
          required: ['focusAdvice', 'ranked']
        }
      });

      res.json(aiRes);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Lỗi AI sắp xếp ưu tiên.' });
    }
  });

  // --------------------------------------------------------------------------
  // VITE DEV MIDDLEWARE OR STATIC PROD ASSETS
  // --------------------------------------------------------------------------
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
    vite.warmupRequest?.('/src/main.tsx').catch(() => {});
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

// ============================================================================
// SSRF-SAFE GOOGLE SHEETS HELPER
// ============================================================================
function isAllowedGoogleScriptUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'script.google.com' || host === 'script.googleusercontent.com';
  } catch {
    return false;
  }
}

async function forwardToGoogleSheet(webhookUrl: string, sessionCode: string, record: StudentResult): Promise<boolean> {
  if (!isAllowedGoogleScriptUrl(webhookUrl)) return false;
  const wrongList = (record.questions || [])
    .filter(q => !q.isCorrect)
    .map(q => `${q.questionNumber} (${q.studentAnswer}->${q.correctAnswer})`)
    .join('; ');

  const payload = {
    sessionCode,
    timestamp: new Date(record.createdAt || Date.now()).toLocaleString('vi-VN'),
    gradeName: record.gradeName || '',
    examTitle: record.examTitle || '',
    studentName: record.studentName || '',
    className: record.className || '',
    schoolName: record.schoolName || '',
    listeningScore: record.listeningScore || '-',
    rwScore: record.rwScore || '-',
    score: record.score ?? 0,
    correctCount: `${record.correctCount}/${record.totalQuestions}`,
    shields: `${record.shields}/5`,
    gradedBy: record.gradedBy || 'Hệ thống',
    wrongDetails: wrongList || 'Đúng toàn bộ'
  };

  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
    return resp.ok || resp.status === 302;
  } catch {
    return false;
  }
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
