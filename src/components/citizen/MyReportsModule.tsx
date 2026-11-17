import { ArrowLeft, CheckCircle2, Clock, FileWarning, MapPin, RefreshCw, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LiveMap } from '../LiveMap.tsx';
import { apiFetch, formatDateTime, withAuthToken } from '../../lib/api.ts';
import type { CivicReport } from '../../types/seva.ts';

const LIFECYCLE_STAGES = [
  { key: 'SUBMITTED', label: 'Report Submitted' },
  { key: 'RECEIVED', label: 'Report Received' },
  { key: 'UNDER REVIEW', label: 'Under Review' },
  { key: 'ASSIGNED', label: 'Department Assigned' },
  { key: 'IN PROGRESS', label: 'Work in Progress' },
  { key: 'RESOLVED', label: 'Issue Resolved' },
];

interface MyReportsModuleProps {
  selectedReportId?: string | null;
  onSelectReport: (id: string | null) => void;
  onNewReport: () => void;
  refreshSignal: number;
}

export function MyReportsModule({
  selectedReportId,
  onSelectReport,
  onNewReport,
  refreshSignal,
}: MyReportsModuleProps) {
  const [reports, setReports] = useState<CivicReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchCode, setSearchCode] = useState('');

  const loadReports = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/reports/my');
      setReports(res.reports || []);
    } catch (err: any) {
      setError(err.message || 'Unable to load your submitted reports.');
    } finally {
      setLoading(false);
    }
  };

  const [directReport, setDirectReport] = useState<CivicReport | null>(null);

  useEffect(() => {
    loadReports();
  }, [refreshSignal]);

  useEffect(() => {
    if (!selectedReportId) {
      setDirectReport(null);
      return;
    }
    const match = reports.find((r) => r.id === selectedReportId);
    if (match) {
      setDirectReport(match);
      return;
    }
    apiFetch(`/api/reports/${selectedReportId}`)
      .then((res) => setDirectReport(res.report || null))
      .catch(() => setDirectReport(null));
  }, [selectedReportId, reports]);

  const activeReport = selectedReportId ? reports.find((r) => r.id === selectedReportId) || directReport : null;

  if (activeReport) {
    const evidencePhotos = activeReport.media.filter((m) => m.media_kind === 'evidence_photo');
    const evidenceVideos = activeReport.media.filter((m) => m.media_kind === 'evidence_video');
    const resolutionPhotos = activeReport.media.filter((m) => m.media_kind === 'resolution_photo');

    const getStageTimestamp = (stageKey: string) => {
      const match = activeReport.history.find((h) => h.new_status === stageKey);
      return match ? formatDateTime(match.created_at) : null;
    };

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onSelectReport(null)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to My Reports
          </button>
          <span className="font-mono text-xs font-semibold text-emerald-900 tabular-nums">
            {activeReport.trackingCode} · {activeReport.status}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-5">
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div>
                <div className="text-xs text-slate-500">
                  {activeReport.category} · {activeReport.severity} Severity · Submitted {formatDateTime(activeReport.createdAt)}
                </div>
                <h2 className="text-xl font-bold text-slate-900 mt-1">{activeReport.title}</h2>
              </div>

              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{activeReport.description}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-200 text-xs">
                <div>
                  <span className="text-slate-500">Assigned Department:</span>{' '}
                  <strong className="text-slate-900">{activeReport.assignedDepartmentName || 'Routing...'}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Assigned Officer:</span>{' '}
                  <strong className="text-slate-900">{activeReport.assignedOfficerName || 'Pending assignment'}</strong>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-500">Location:</span>{' '}
                  <strong className="text-slate-900">
                    {activeReport.location?.formattedAddress || 'Coordinates recorded'}
                  </strong>
                </div>
              </div>

              {activeReport.status === 'REJECTED' && activeReport.rejectionReason && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-900 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <XCircle className="h-4 w-4" />
                    Report Rejected by Authority
                  </div>
                  <p>{activeReport.rejectionReason}</p>
                </div>
              )}

              {activeReport.resolutionDescription && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2 text-xs text-emerald-950">
                  <div className="font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                    Official Resolution Record ({formatDateTime(activeReport.resolvedAt)})
                  </div>
                  <p>{activeReport.resolutionDescription}</p>
                  {resolutionPhotos.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      {resolutionPhotos.map((rp) => {
                        const src = withAuthToken(rp.url);
                        return (
                          <a key={rp.id} href={src} target="_blank" rel="noopener noreferrer">
                            <img
                              src={src}
                              alt="Resolution evidence"
                              className="w-full h-32 object-cover rounded border border-emerald-300"
                            />
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Citizen Uploaded Evidence (strictly actual uploaded media, zero stock placeholders) */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <h3 className="text-base font-semibold text-slate-900">Your Uploaded Evidence</h3>
              {evidencePhotos.length === 0 && evidenceVideos.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500">
                  No photograph attached
                </div>
              ) : (
                <div className="space-y-4">
                  {evidencePhotos.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {evidencePhotos.map((m) => {
                        const src = withAuthToken(m.url);
                        return (
                          <a key={m.id} href={src} target="_blank" rel="noopener noreferrer" className="block">
                            <img
                              src={src}
                              alt={m.original_filename}
                              className="w-full h-32 object-cover rounded-lg border border-slate-200"
                            />
                          </a>
                        );
                      })}
                    </div>
                  )}
                  {evidenceVideos.map((v) => (
                    <video key={v.id} src={withAuthToken(v.url)} controls className="w-full max-h-64 rounded-lg bg-black" />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 space-y-5">
            {/* 6-Stage Tracking Timeline */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <h3 className="text-base font-semibold text-slate-900">Live Status Timeline</h3>
              <ol className="space-y-3">
                {LIFECYCLE_STAGES.map((stage) => {
                  const ts = getStageTimestamp(stage.key);
                  const reached = Boolean(ts) || activeReport.status === stage.key;
                  return (
                    <li key={stage.key} className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${
                          reached ? 'bg-[#14532D] text-white' : 'bg-slate-200 text-slate-500'
                        }`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-semibold ${reached ? 'text-slate-900' : 'text-slate-400'}`}>
                          {stage.label}
                        </div>
                        <div className="text-xs font-mono text-slate-500 tabular-nums">
                          {ts || 'Pending authority action'}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>

              <div className="pt-4 border-t border-slate-200 space-y-2">
                <div className="text-xs font-semibold text-slate-800">Detailed Authority Action Log</div>
                {activeReport.history.map((h) => (
                  <div key={h.id} className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-xs space-y-0.5">
                    <div className="flex justify-between font-semibold text-slate-900">
                      <span>{h.new_status}</span>
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                        {formatDateTime(h.created_at)}
                      </span>
                    </div>
                    {h.action_note && <p className="text-slate-600">{h.action_note}</p>}
                    <div className="text-[11px] text-slate-400">Updated by {h.updated_by_name}</div>
                  </div>
                ))}
              </div>
            </div>

            {activeReport.location && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-[#14532D]" />
                  Reported Coordinates ({activeReport.location.latitude.toFixed(5)}, {activeReport.location.longitude.toFixed(5)})
                </div>
                <LiveMap
                  center={{
                    latitude: activeReport.location.latitude,
                    longitude: activeReport.location.longitude,
                  }}
                  accuracyMeters={activeReport.location.accuracyMeters}
                  heightClass="h-48"
                  zoom={15}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const filtered = reports.filter((r) => {
    if (!searchCode.trim()) return true;
    const q = searchCode.toLowerCase();
    return r.trackingCode.toLowerCase().includes(q) || r.title.toLowerCase().includes(q) || r.category.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">My Reports &amp; Live Tracking</h2>
          <p className="text-xs text-slate-500">
            Track real-time status updates, assigned departments, and official resolution records.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadReports}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={onNewReport}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#14532D] text-white hover:bg-[#166534]"
          >
            Report New Issue
          </button>
        </div>
      </div>

      <input
        value={searchCode}
        onChange={(e) => setSearchCode(e.target.value)}
        placeholder="Search by Report ID (e.g. SEVA-2026-...) or title..."
        className="w-full sm:max-w-md rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm"
      />

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading your reports...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={loadReports} className="font-semibold underline">
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center space-y-3">
          <FileWarning className="h-8 w-8 text-slate-400 mx-auto" />
          <div className="text-sm font-semibold text-slate-900">No reports submitted yet</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Your submitted civic, medical, accident, or safety reports will appear here with live tracking timelines.
          </p>
          <button
            type="button"
            onClick={onNewReport}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#14532D] text-white"
          >
            Submit Your First Report
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((r) => {
            const firstPhoto = r.media.find((m) => m.media_kind === 'evidence_photo');
            return (
              <div
                key={r.id}
                onClick={() => onSelectReport(r.id)}
                className="rounded-xl border border-slate-200 bg-white p-4 hover:border-[#14532D] cursor-pointer transition-colors flex gap-4"
              >
                <div className="w-24 h-24 rounded-lg border border-slate-200 bg-slate-100 shrink-0 overflow-hidden flex items-center justify-center text-[11px] text-slate-500 text-center p-1">
                  {firstPhoto ? (
                    <img src={withAuthToken(firstPhoto.url)} alt={r.title} className="w-full h-full object-cover" />
                  ) : (
                    <span>No photograph attached</span>
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono font-semibold text-[#14532D] tabular-nums">{r.trackingCode}</span>
                    <span
                      className={`font-semibold ${
                        r.status === 'RESOLVED'
                          ? 'text-emerald-700'
                          : r.status === 'REJECTED'
                            ? 'text-red-700'
                            : r.status === 'ESCALATED'
                              ? 'text-red-700'
                              : 'text-amber-700'
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-slate-900 truncate">{r.title}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {r.category} · {r.assignedDepartmentName || 'Routing'}
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1 pt-1 tabular-nums">
                    <Clock className="h-3 w-3" />
                    Updated {formatDateTime(r.updatedAt)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
