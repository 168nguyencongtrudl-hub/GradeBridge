import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: ''
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Unknown error'
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught application error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let parsedError = this.state.errorMessage;
      try {
        const obj = JSON.parse(this.state.errorMessage);
        if (obj && obj.error) {
          parsedError = `${obj.error} (${obj.operationType || 'firestore'} · ${obj.path || ''})`;
        }
      } catch {
        // Plain error text
      }

      return (
        <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-neutral-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h2 className="text-base font-bold text-slate-900">Đã xảy ra lỗi kết nối dữ liệu</h2>
            <p className="text-xs text-slate-600 break-words font-mono bg-neutral-50 p-3 rounded-lg border border-neutral-200">
              {parsedError}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '' });
                window.location.reload();
              }}
              className="w-full py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
            >
              Tải lại ứng dụng
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
