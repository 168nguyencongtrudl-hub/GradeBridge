import React, { useEffect, useState } from 'react';
import { ArrowRight, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../utils/api';
import type { SystemBranding, TeacherAccount } from '../types';

interface AuthViewProps {
  initialSessionCode: string;
  onAuthenticated: (data: {
    token: string;
    sessionCode: string;
    account: TeacherAccount;
  }) => void;
}

export function AuthView({ initialSessionCode, onAuthenticated }: AuthViewProps) {
  const sessionCode = initialSessionCode || 'CAMBRIDGE-2026';
  const [adminConfigured, setAdminConfigured] = useState<boolean | null>(null);
  const [branding, setBranding] = useState<SystemBranding | null>(null);

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest<{
      sessionCode: string;
      adminConfigured: boolean;
      branding: SystemBranding;
    }>(`/api/auth/status?sessionCode=${encodeURIComponent(sessionCode)}`)
      .then(res => {
        if (!active) return;
        setAdminConfigured(res.adminConfigured);
        setBranding(res.branding);
      })
      .catch(() => {
        if (!active) return;
        setAdminConfigured(false);
      });

    return () => {
      active = false;
    };
  }, [sessionCode]);

  const handleSetupAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.trim().length < 4) {
      setError('Mật khẩu quản trị cần tối thiểu 4 ký tự.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest<{
        token: string;
        sessionCode: string;
        account: TeacherAccount;
      }>('/api/auth/setup-admin', {
        method: 'POST',
        body: JSON.stringify({
          sessionCode,
          fullName: fullName.trim() || 'Administrator',
          password: password.trim()
        })
      });
      onAuthenticated(res);
    } catch (err: any) {
      setError(err?.message || 'Không thể thiết lập tài khoản quản trị.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password.trim()) {
      setError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest<{
        token: string;
        sessionCode: string;
        account: TeacherAccount;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          sessionCode,
          username: username.trim(),
          password: password.trim()
        })
      });
      onAuthenticated(res);
    } catch (err: any) {
      setError(err?.message || 'Đăng nhập thất bại.');
    } finally {
      setSubmitting(false);
    }
  };

  const isSetupMode = adminConfigured === false;

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col justify-center items-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          {branding?.logoDataUrl ? (
            <img
              src={branding.logoDataUrl}
              alt={branding.appName}
              referrerPolicy="no-referrer"
              style={{
                width: `${Math.min(72, Math.max(36, branding.logoWidth || 40))}px`,
                height: `${Math.min(72, Math.max(36, branding.logoHeight || 40))}px`
              }}
              className="mx-auto mb-4 object-contain"
            />
          ) : (
            <div className="w-10 h-10 mx-auto mb-4 rounded-xl bg-slate-900 text-white flex items-center justify-center">
              {isSetupMode ? <ShieldCheck className="w-5 h-5" /> : <Lock className="w-4 h-4" />}
            </div>
          )}

          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {branding?.appName || 'Cambridge Grader'}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            {isSetupMode
              ? 'Thiết lập mật khẩu quản trị viên lần đầu cho không gian làm việc'
              : 'Đăng nhập vào không gian chấm thi & quản lý công việc'}
          </p>
        </div>

        <div className="bg-white border border-neutral-200 rounded-2xl p-6 sm:p-7">
          {adminConfigured === null ? (
            <div className="py-8 text-center text-sm text-slate-400">
              Đang kết nối dữ liệu hệ thống...
            </div>
          ) : isSetupMode ? (
            <form onSubmit={handleSetupAdmin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Tên quản trị viên
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="VD: Cô Minh Anh"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-neutral-200 text-sm text-slate-900 focus:outline-none focus:border-slate-900 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Tạo mật khẩu quản trị
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Tối thiểu 4 ký tự"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-neutral-200 text-sm text-slate-900 focus:outline-none focus:border-slate-900 transition-colors"
                  autoComplete="new-password"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Xác nhận mật khẩu
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Nhập lại mật khẩu"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-neutral-200 text-sm text-slate-900 focus:outline-none focus:border-slate-900 transition-colors"
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <p className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
              >
                <span>{submitting ? 'Đang khởi tạo...' : 'Khởi tạo & Vào không gian làm việc'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Tên đăng nhập
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-neutral-200 text-sm text-slate-900 focus:outline-none focus:border-slate-900 transition-colors"
                  autoComplete="username"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Mật khẩu
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-neutral-200 text-sm text-slate-900 focus:outline-none focus:border-slate-900 transition-colors"
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <p className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
              >
                <KeyRound className="w-4 h-4" />
                <span>{submitting ? 'Đang xác thực...' : 'Đăng nhập'}</span>
              </button>
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-slate-400">
          Cambridge English Assessment · 1-Page OMR & Smart Task Workspace
        </p>
      </div>
    </div>
  );
}
