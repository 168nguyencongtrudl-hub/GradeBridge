import React, { useMemo, useState } from 'react';
import { Building2, Download, Eye, Search, Trash2 } from 'lucide-react';
import {
  computeCambridgeShields,
  exportAllGradesExcel,
  exportClassListExcel,
  exportProfileExcel,
  exportSchoolExcel
} from '../utils/grading';
import type { ExamProfile, StudentResult, UiLang } from '../types';

type ScoreboardScope = 'profile' | 'by_school' | 'by_class';

interface ScoreboardViewProps {
  currentProfile: ExamProfile;
  examProfiles: ExamProfile[];
  currentProfileResults: StudentResult[];
  allResults: StudentResult[];
  sessionCode: string;
  canViewExport: boolean;
  canDeleteResults: boolean;
  lang: UiLang;
  onOpenReview: (studentId: string) => void;
  onDeleteResult: (studentId: string) => Promise<void>;
  onNotify: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function ScoreboardView({
  currentProfile,
  examProfiles,
  currentProfileResults,
  allResults,
  sessionCode,
  canViewExport,
  canDeleteResults,
  lang,
  onOpenReview,
  onDeleteResult,
  onNotify
}: ScoreboardViewProps) {
  const isEn = lang === 'en';

  const [scope, setScope] = useState<ScoreboardScope>('profile');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSchool, setFilterSchool] = useState('ALL');
  const [filterClass, setFilterClass] = useState('ALL');
  const [filterTeacher, setFilterTeacher] = useState('ALL');

  const profileMap = useMemo(() => {
    const map = new Map<string, ExamProfile>();
    examProfiles.forEach(p => map.set(p.id, p));
    return map;
  }, [examProfiles]);

  // Base pool depends on selected view scope
  const baseResults = useMemo(() => {
    return scope === 'profile'
      ? currentProfileResults
      : [...allResults].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [scope, currentProfileResults, allResults]);

  const uniqueSchools = useMemo(
    () =>
      Array.from(
        new Set(
          baseResults
            .map(r => (r.schoolName || '').trim() || (profileMap.get(r.profileId)?.schoolName || '').trim())
            .filter(Boolean)
        )
      ),
    [baseResults, profileMap]
  );

  const uniqueClasses = useMemo(
    () => Array.from(new Set(baseResults.map(r => (r.className || '').trim()).filter(Boolean))),
    [baseResults]
  );

  const uniqueTeachers = useMemo(
    () => Array.from(new Set(baseResults.map(r => r.gradedBy).filter(Boolean))),
    [baseResults]
  );

  const filteredResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return baseResults.filter(st => {
      const effectiveSchool =
        (st.schoolName || '').trim() || (profileMap.get(st.profileId)?.schoolName || '').trim();
      const matchSearch =
        !q ||
        st.studentName.toLowerCase().includes(q) ||
        st.className.toLowerCase().includes(q) ||
        effectiveSchool.toLowerCase().includes(q) ||
        st.gradeName.toLowerCase().includes(q);
      const matchSchool = filterSchool === 'ALL' || effectiveSchool === filterSchool;
      const matchClass = filterClass === 'ALL' || st.className === filterClass;
      const matchTeacher = filterTeacher === 'ALL' || st.gradedBy === filterTeacher;
      return matchSearch && matchSchool && matchClass && matchTeacher;
    });
  }, [baseResults, searchQuery, filterSchool, filterClass, filterTeacher, profileMap]);

  // Summary statistics for currently viewed filtered results
  const stats = useMemo(() => {
    if (filteredResults.length === 0) {
      return {
        avgScore: '0.0',
        passRate: 0,
        hardestQuestions: [] as Array<{ q: string; count: number; rate: number }>
      };
    }
    const sum = filteredResults.reduce((acc, s) => acc + (Number(s.score) || 0), 0);
    const avgScore = (sum / filteredResults.length).toFixed(1);
    const passCount = filteredResults.filter(s => {
      const profMax = profileMap.get(s.profileId)?.maxScore || currentProfile.maxScore || 8;
      return (Number(s.score) || 0) >= profMax * 0.5;
    }).length;
    const passRate = Math.round((passCount / filteredResults.length) * 100);

    const wrongCounter: Record<string, number> = {};
    if (scope === 'profile') {
      filteredResults.forEach(st => {
        (st.questions || []).forEach(q => {
          if (!q.isCorrect) {
            wrongCounter[q.questionNumber] = (wrongCounter[q.questionNumber] || 0) + 1;
          }
        });
      });
    }

    const hardestQuestions = Object.entries(wrongCounter)
      .map(([q, count]) => ({
        q,
        count,
        rate: Math.round((count / filteredResults.length) * 100)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return { avgScore, passRate, hardestQuestions };
  }, [filteredResults, profileMap, currentProfile.maxScore, scope]);

  // Partitioned lists by School
  const groupedBySchool = useMemo(() => {
    const map = new Map<string, StudentResult[]>();
    filteredResults.forEach(st => {
      const sc =
        (st.schoolName || '').trim() ||
        (profileMap.get(st.profileId)?.schoolName || '').trim() ||
        (isEn ? 'Unspecified School' : 'Chưa rõ trường');
      const list = map.get(sc) || [];
      list.push(st);
      map.set(sc, list);
    });
    return Array.from(map.entries()).map(([schoolName, list]) => {
      const avg = (list.reduce((a, b) => a + (Number(b.score) || 0), 0) / Math.max(1, list.length)).toFixed(1);
      const classes = Array.from(new Set(list.map(r => r.className).filter(Boolean)));
      return { schoolName, list, avg, classes };
    });
  }, [filteredResults, profileMap, isEn]);

  // Partitioned lists by (School + Class)
  const groupedByClass = useMemo(() => {
    const map = new Map<string, { schoolName: string; className: string; gradeName: string; list: StudentResult[] }>();
    filteredResults.forEach(st => {
      const sc =
        (st.schoolName || '').trim() ||
        (profileMap.get(st.profileId)?.schoolName || '').trim() ||
        (isEn ? 'Unspecified School' : 'Chưa rõ trường');
      const cls = (st.className || st.gradeName || (isEn ? 'General' : 'Chưa rõ lớp')).trim();
      const key = `${sc}__${cls}`;
      const existing = map.get(key);
      if (existing) {
        existing.list.push(st);
      } else {
        map.set(key, { schoolName: sc, className: cls, gradeName: st.gradeName, list: [st] });
      }
    });
    return Array.from(map.values()).map(g => {
      const avg = (g.list.reduce((a, b) => a + (Number(b.score) || 0), 0) / Math.max(1, g.list.length)).toFixed(1);
      return { ...g, avg };
    });
  }, [filteredResults, profileMap, isEn]);

  const renderStudentTable = (rows: StudentResult[], showGradeColumn = false) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50/70 text-[11px] font-semibold text-slate-500">
            <th className="py-2.5 pl-4 pr-2 w-10">#</th>
            <th className="py-2.5 px-3">{isEn ? 'Student Name' : 'Họ và tên'}</th>
            <th className="py-2.5 px-3">{isEn ? 'School' : 'Trường'}</th>
            <th className="py-2.5 px-3">{isEn ? 'Class' : 'Lớp'}</th>
            {showGradeColumn && <th className="py-2.5 px-3">{isEn ? 'Grade / Exam' : 'Khối / Đề'}</th>}
            <th className="py-2.5 px-3 text-right">{isEn ? 'Correct' : 'Đúng'}</th>
            <th className="py-2.5 px-3 text-right">{isEn ? 'Shields' : 'Khiên'}</th>
            <th className="py-2.5 px-3 text-right">{isEn ? 'Score' : 'Điểm'}</th>
            <th className="py-2.5 pl-2 pr-4 text-right w-20">{isEn ? 'Action' : 'Xem'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200 text-xs">
          {rows.map((st, idx) => {
            const shields = st.shields || computeCambridgeShields(st.correctCount, st.totalQuestions);
            const profMax = profileMap.get(st.profileId)?.maxScore || currentProfile.maxScore || 8;
            return (
              <tr
                key={st.id}
                onClick={() => onOpenReview(st.id)}
                className="hover:bg-neutral-50 cursor-pointer transition-colors"
              >
                <td className="py-3 pl-4 pr-2 text-slate-400 font-mono tabular-nums">{rows.length - idx}</td>
                <td className="py-3 px-3">
                  <div className="font-semibold text-slate-900">{st.studentName}</div>
                  <div className="text-[11px] text-slate-500">{st.sectionBreakdown}</div>
                </td>
                <td className="py-3 px-3 text-slate-700 font-medium">{st.schoolName}</td>
                <td className="py-3 px-3 text-slate-700 font-mono">{st.className}</td>
                {showGradeColumn && (
                  <td className="py-3 px-3 text-slate-500 truncate max-w-[180px]">{st.gradeName}</td>
                )}
                <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                  {st.correctCount}/{st.totalQuestions}
                </td>
                <td className="py-3 px-3 text-right font-mono tabular-nums text-amber-700 font-medium">
                  {shields}/5
                </td>
                <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                  {st.score}
                  <span className="text-[11px] font-normal text-slate-400">/{profMax}</span>
                </td>
                <td className="py-3 pl-2 pr-4 text-right" onClick={e => e.stopPropagation()}>
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onOpenReview(st.id)}
                      className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-neutral-100"
                      title={isEn ? 'Inspect' : 'Xem chi tiết'}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    {canDeleteResults && (
                      <button
                        type="button"
                        onClick={() => onDeleteResult(st.id)}
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                        title={isEn ? 'Delete' : 'Xóa'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Scope Switcher: Separate Lists per Exam Profile, per School, or per Class */}
      <div className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">
            {currentProfile.schoolName ? `${currentProfile.schoolName} · ` : ''}
            {currentProfile.gradeName}
            {currentProfile.classLabel ? ` · ${isEn ? 'Class' : 'Lớp'} ${currentProfile.classLabel}` : ''}
          </div>
          <h2 className="text-base font-bold text-slate-900">
            {isEn ? 'Score Lists by School & Class' : 'Danh Sách Điểm Riêng Theo Trường & Khối Lớp'}
          </h2>
        </div>

        <div className="inline-flex p-1 rounded-lg bg-neutral-100 border border-neutral-200 text-xs font-medium">
          <button
            type="button"
            onClick={() => {
              setScope('profile');
              setFilterSchool('ALL');
              setFilterClass('ALL');
            }}
            className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap ${
              scope === 'profile' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {isEn ? 'Current Exam' : 'Đề đang chọn'} ({currentProfileResults.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setScope('by_school');
              setFilterClass('ALL');
            }}
            className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap ${
              scope === 'by_school' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {isEn ? 'Separate by School' : 'Riêng từng Trường'}
          </button>
          <button
            type="button"
            onClick={() => setScope('by_class')}
            className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap ${
              scope === 'by_class' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {isEn ? 'Separate by Class' : 'Riêng từng Lớp'}
          </button>
        </div>
      </div>

      {/* Minimalist KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-neutral-200 rounded-xl divide-y lg:divide-y-0 lg:divide-x divide-neutral-200">
        <div className="p-4">
          <div className="text-xs text-slate-500">{isEn ? 'Shown papers' : 'Bài đang xem'}</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{filteredResults.length}</div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">{isEn ? 'Average score' : 'Điểm trung bình'}</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">
            {stats.avgScore}
            {scope === 'profile' && (
              <span className="text-sm font-normal text-slate-400"> / {currentProfile.maxScore}</span>
            )}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">{isEn ? 'Pass rate (≥50%)' : 'Tỷ lệ đạt (≥50%)'}</div>
          <div className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">{stats.passRate}%</div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">{isEn ? 'All schools total' : 'Tổng tất cả trường'}</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{allResults.length}</div>
        </div>
      </div>

      {/* Hardest Questions Inline Insight (current profile mode) */}
      {scope === 'profile' && stats.hardestQuestions.length > 0 && (
        <div className="bg-white border border-neutral-200 rounded-xl px-5 py-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span className="font-semibold text-slate-700">
            {isEn ? 'Most missed:' : 'Câu sai nhiều nhất:'}
          </span>
          {stats.hardestQuestions.map((hq, idx) => (
            <span key={hq.q} className="text-slate-600 tabular-nums">
              {idx > 0 && <span className="mr-3 text-slate-300">·</span>}
              <span className="font-medium text-slate-900">{hq.q}</span> ({hq.rate}%)
            </span>
          ))}
        </div>
      )}

      {/* Filters & Export Bar */}
      <div className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 flex-1 min-w-[260px]">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={isEn ? 'Search name, school, class...' : 'Tìm tên, trường, lớp...'}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-neutral-200 text-xs text-slate-900 focus:outline-none focus:border-slate-900"
            />
          </div>

          <select
            value={filterSchool}
            onChange={e => setFilterSchool(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-neutral-50 text-xs font-medium text-slate-700"
          >
            <option value="ALL">
              {isEn ? 'All Schools' : 'Tất cả trường'} ({uniqueSchools.length})
            </option>
            {uniqueSchools.map(sc => (
              <option key={sc} value={sc}>
                {sc}
              </option>
            ))}
          </select>

          <select
            value={filterClass}
            onChange={e => setFilterClass(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-neutral-50 text-xs font-medium text-slate-700"
          >
            <option value="ALL">
              {isEn ? 'All Classes' : 'Tất cả lớp'} ({uniqueClasses.length})
            </option>
            {uniqueClasses.map(cl => (
              <option key={cl} value={cl}>
                {cl}
              </option>
            ))}
          </select>

          <select
            value={filterTeacher}
            onChange={e => setFilterTeacher(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-neutral-50 text-xs font-medium text-slate-700"
          >
            <option value="ALL">
              {isEn ? 'All Examiners' : 'Tất cả GV'} ({uniqueTeachers.length})
            </option>
            {uniqueTeachers.map(tc => (
              <option key={tc} value={tc}>
                {tc}
              </option>
            ))}
          </select>
        </div>

        {canViewExport && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={currentProfileResults.length === 0}
              onClick={() => {
                exportProfileExcel(currentProfile, currentProfileResults, sessionCode);
                onNotify(isEn ? 'Exported current exam Excel file.' : 'Đã xuất bảng điểm Excel bộ đề hiện tại.', 'success');
              }}
              className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Excel {currentProfile.gradeName}</span>
            </button>

            <button
              type="button"
              disabled={allResults.length === 0}
              onClick={() => {
                exportAllGradesExcel(examProfiles, allResults, sessionCode);
                onNotify(isEn ? 'Exported all schools Excel file.' : 'Đã xuất bảng điểm tổng hợp tất cả trường.', 'success');
              }}
              className="px-3 py-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50 text-slate-700 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>{isEn ? 'All Schools' : 'Tất cả trường'}</span>
            </button>
          </div>
        )}
      </div>

      {/* VIEW 1: CURRENT EXAM PROFILE TABLE */}
      {scope === 'profile' && (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          {filteredResults.length === 0 ? (
            <div className="py-14 px-6 text-center text-sm text-slate-500">
              {isEn
                ? `No graded papers saved yet for ${currentProfile.schoolName ? `${currentProfile.schoolName} · ` : ''}${currentProfile.gradeName}.`
                : `Chưa có bài chấm nào được lưu cho ${currentProfile.schoolName ? `${currentProfile.schoolName} · ` : ''}${currentProfile.gradeName}.`}
            </div>
          ) : (
            renderStudentTable(filteredResults, false)
          )}
        </div>
      )}

      {/* VIEW 2: SEPARATE LISTS PER SCHOOL */}
      {scope === 'by_school' && (
        <div className="space-y-5">
          {groupedBySchool.length === 0 ? (
            <div className="bg-white border border-neutral-200 rounded-xl py-14 px-6 text-center text-sm text-slate-500">
              {isEn ? 'No graded results found.' : 'Chưa có danh sách điểm nào được lưu.'}
            </div>
          ) : (
            groupedBySchool.map(group => (
              <div key={group.schoolName} className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{group.schoolName}</h3>
                    <div className="text-xs text-slate-500 tabular-nums mt-0.5">
                      {group.list.length} {isEn ? 'students' : 'học sinh'} · {group.classes.length}{' '}
                      {isEn ? 'classes' : 'lớp'} · {isEn ? 'Avg' : 'ĐTB'}: {group.avg}
                    </div>
                  </div>
                  {canViewExport && (
                    <button
                      type="button"
                      onClick={() => {
                        exportSchoolExcel(group.schoolName, group.list, sessionCode);
                        onNotify(
                          isEn
                            ? `Exported Excel for ${group.schoolName}.`
                            : `Đã xuất file Excel riêng cho trường ${group.schoolName}.`,
                          'success'
                        );
                      }}
                      className="px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-xs font-semibold text-slate-800 flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{isEn ? 'Export School Excel' : 'Xuất Excel trường này'}</span>
                    </button>
                  )}
                </div>
                {renderStudentTable(group.list, true)}
              </div>
            ))
          )}
        </div>
      )}

      {/* VIEW 3: SEPARATE LISTS PER CLASS (SCHOOL + CLASS) */}
      {scope === 'by_class' && (
        <div className="space-y-5">
          {groupedByClass.length === 0 ? (
            <div className="bg-white border border-neutral-200 rounded-xl py-14 px-6 text-center text-sm text-slate-500">
              {isEn ? 'No class score lists found.' : 'Chưa có danh sách điểm theo từng lớp.'}
            </div>
          ) : (
            groupedByClass.map(group => (
              <div
                key={`${group.schoolName}-${group.className}`}
                className="bg-white border border-neutral-200 rounded-xl overflow-hidden"
              >
                <div className="px-5 py-3.5 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs text-slate-500">
                      {group.schoolName} · {group.gradeName}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">
                      {isEn ? 'Class' : 'Lớp'} {group.className}
                      <span className="ml-2 text-xs font-normal text-slate-500 tabular-nums">
                        · {group.list.length} {isEn ? 'students' : 'học sinh'} · {isEn ? 'Avg' : 'ĐTB'}: {group.avg}
                      </span>
                    </h3>
                  </div>
                  {canViewExport && (
                    <button
                      type="button"
                      onClick={() => {
                        exportClassListExcel(group.schoolName, group.className, group.list, sessionCode);
                        onNotify(
                          isEn
                            ? `Exported Class ${group.className} (${group.schoolName}).`
                            : `Đã xuất danh sách Excel riêng lớp ${group.className} (${group.schoolName}).`,
                          'success'
                        );
                      }}
                      className="px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-xs font-semibold text-slate-800 flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{isEn ? 'Export Class Excel' : 'Xuất Excel lớp này'}</span>
                    </button>
                  )}
                </div>
                {renderStudentTable(group.list, false)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
