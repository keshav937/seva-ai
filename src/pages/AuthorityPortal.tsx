import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Award,
  BarChart3,
  Bell,
  Building2,
  CheckCircle2,
  FileText,
  LogOut,
  Menu,
  ShieldAlert,
  Sparkles,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LiveMap } from '../components/LiveMap.tsx';
import { SevaLogo } from '../components/SevaLogo.tsx';
import { useWebSocket } from '../hooks/useWebSocket.ts';
import { apiFetch, formatDateTime, navigateTo, withAuthToken } from '../lib/api.ts';
import type { AuthUser, CivicReport, Department, NotificationItem } from '../types/seva.ts';

type AuthorityTab = 'reports' | 'emergency' | 'notifications' | 'admin';

interface AuthorityPortalProps {
  user: AuthUser;
  pathname: string;
  onLogout: () => void;
}

function resolveAuthRoute(pathname: string): { tab: AuthorityTab; reportId: string | null } {
  if (pathname.startsWith('/authority/reports/')) {
    return { tab: 'reports', reportId: pathname.replace('/authority/reports/', '') };
  }
  if (pathname === '/authority/emergency') return { tab: 'emergency', reportId: null };
  if (pathname === '/authority/notifications') return { tab: 'notifications', reportId: null };
  if (pathname === '/authority/admin') return { tab: 'admin', reportId: null };
  return { tab: 'reports', reportId: null };
}

export function AuthorityPortal({ user, pathname, onLogout }: AuthorityPortalProps) {
  const initial = resolveAuthRoute(pathname);
  const [tab, setTab] = useState<AuthorityTab>(initial.tab);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(initial.reportId);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Real DB data
  const [reports, setReports] = useState<CivicReport[]>([]);
  const [overview, setOverview] = useState<any>({});
  const [departments, setDepartments] = useState<Department[]>([]);
  const [officers, setOfficers] = useState<any[]>([]);
  const [sosAlerts, setSosAlerts] = useState<any[]>([]);
  const [medicalRequests, setMedicalRequests] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Filters
  const [fCategory, setFCategory] = useState('ALL');
  const [fSeverity, setFSeverity] = useState('ALL');
  const [fStatus, setFStatus] = useState('ALL');
  const [fDepartment, setFDepartment] = useState('ALL');
  const [fWard, setFWard] = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fSearch, setFSearch] = useState('');

  // High-priority incoming alert sound
  const [urgentBanner, setUrgentBanner] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const alarmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const playChime = () => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 740;
      gain.gain.value = 0.18;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(() => {
        osc.stop();
        ctx.close();
      }, 320);
    } catch {
      // Audio permission not granted yet
    }
  };

  const stopUrgentChime = () => {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
    setUrgentBanner(null);
  };

  useEffect(() => {
    const resolved = resolveAuthRoute(pathname);
    setTab(resolved.tab);
    setSelectedReportId(resolved.reportId);
  }, [pathname]);

  const loadReports = async () => {
    const params = new URLSearchParams();
    if (fCategory !== 'ALL') params.set('category', fCategory);
    if (fSeverity !== 'ALL') params.set('severity', fSeverity);
    if (fStatus !== 'ALL') params.set('status', fStatus);
    if (fDepartment !== 'ALL') params.set('departmentId', fDepartment);
    if (fWard.trim()) params.set('ward', fWard.trim());
    if (fDateFrom) params.set('dateFrom', fDateFrom);
    if (fSearch.trim()) params.set('search', fSearch.trim());

    const res = await apiFetch(`/api/reports?${params.toString()}`);
    setReports(res.reports || []);
    setOverview(res.overview || {});
  };

  const loadAllOperational = async () => {
    try {
      const [deptRes, usersRes, sosRes, medRes, notifRes] = await Promise.all([
        apiFetch('/api/admin/departments'),
        apiFetch('/api/admin/users'),
        apiFetch('/api/seva-shield/sos/all'),
        apiFetch('/api/medical'),
        apiFetch('/api/notifications'),
      ]);
      setDepartments(deptRes.departments || []);
      setOfficers(usersRes.officers || []);
      setSosAlerts(sosRes.events || []);
      setMedicalRequests(medRes.requests || []);
      setNotifications(notifRes.notifications || []);
      setUnreadCount(notifRes.unreadCount || 0);
    } catch {
      // handled
    }
  };

  useEffect(() => {
    loadReports();
  }, [fCategory, fSeverity, fStatus, fDepartment]);

  useEffect(() => {
    loadAllOperational();
    return () => {
      if (alarmIntervalRef.current) clearInterval(alarmIntervalRef.current);
    };
  }, []);

  const { connected } = useWebSocket((evt) => {
    if (evt.type === 'sos:activated' || evt.type === 'sos:escalated' || evt.type === 'medical:created') {
      const msg =
        evt.type === 'sos:activated'
          ? `LIVE SOS ALERT: ${evt.sos?.citizenName} (${evt.sos?.emergencyCode})`
          : evt.type === 'sos:escalated'
            ? `ESCALATED SOS ALERT: ${evt.emergencyCode}`
            : `MEDICAL EMERGENCY: ${evt.request?.tracking_code}`;
      setUrgentBanner(msg);
      playChime();
      if (!alarmIntervalRef.current && soundEnabled) {
        alarmIntervalRef.current = setInterval(playChime, 4500);
      }
      loadAllOperational();
      loadReports();
    } else if (evt.type === 'report:created' || evt.type === 'report:updated' || evt.type === 'sos:location_updated' || evt.type === 'sos:safe' || evt.type === 'sos:acknowledged' || evt.type === 'medical:updated' || evt.type === 'notification:new') {
      if (evt.type === 'report:created' && evt.severity === 'Critical') {
        setUrgentBanner(`CRITICAL REPORT SUBMITTED: ${evt.trackingCode} — ${evt.title}`);
        playChime();
      }
      loadReports();
      loadAllOperational();
    }
  });

  const [directReport, setDirectReport] = useState<CivicReport | null>(null);

  useEffect(() => {
    if (!selectedReportId) {
      setDirectReport(null);
      return;
    }
    const found = reports.find((r) => r.id === selectedReportId);
    if (found) {
      setDirectReport(found);
      return;
    }
    apiFetch(`/api/reports/${selectedReportId}`)
      .then((res) => setDirectReport(res.report || null))
      .catch(() => setDirectReport(null));
  }, [selectedReportId, reports]);

  const goTab = (next: AuthorityTab, path: string) => {
    setTab(next);
    setSelectedReportId(null);
    setMobileMenuOpen(false);
    navigateTo(path);
  };

  const activeReport = selectedReportId ? reports.find((r) => r.id === selectedReportId) || directReport : null;

  return (
    <div className="min-h-screen bg-[#F8FAF9] flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-slate-950 text-slate-100 shrink-0">
        <div className="h-16 px-5 border-b border-slate-800 flex items-center justify-between">
          <span className="font-display text-lg font-bold tracking-tight text-white">SEVA AI Command</span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {[
            { id: 'reports', path: '/authority', label: 'All Citizen Reports', icon: FileText },
            { id: 'emergency', path: '/authority/emergency', label: 'Emergency Control', icon: ShieldAlert },
            { id: 'notifications', path: '/authority/notifications', label: 'Alert Feed', icon: Bell },
            { id: 'admin', path: '/authority/admin', label: 'Admin Control Center', icon: Building2 },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => goTab(item.id as AuthorityTab, item.path)}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  active ? 'bg-emerald-700 text-white' : 'text-slate-300 hover:bg-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </span>
                {item.id === 'notifications' && unreadCount > 0 && (
                  <span className="text-xs font-mono font-bold text-amber-400">{unreadCount}</span>
                )}
                {item.id === 'emergency' && (overview.activeSos > 0 || overview.medicalEmergencies > 0) && (
                  <span className="text-xs font-mono font-bold text-red-400">
                    {(overview.activeSos || 0) + (overview.medicalEmergencies || 0)}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-3 text-xs">
          <div>
            <div className="font-bold text-white truncate">{user.full_name}</div>
            <div className="text-slate-400 truncate">
              {user.designation || 'Authority Officer'} · {user.department_name || 'Command'}
            </div>
            <div className="text-[11px] font-mono text-emerald-400 mt-0.5">
              Badge: {user.badge_number || 'OFFICIAL'} · {connected ? 'Live' : 'Reconnecting'}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-900"
          >
            <LogOut className="h-3.5 w-3.5" />
            Secure Logout
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div className="text-sm font-semibold text-slate-900">
              Authority Portal · {user.department_name || 'Unified City Command'}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSoundEnabled((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700"
            >
              {soundEnabled ? <Volume2 className="h-3.5 w-3.5 text-emerald-700" /> : <VolumeX className="h-3.5 w-3.5" />}
              {soundEnabled ? 'Alert Sound On' : 'Muted'}
            </button>
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                navigateTo('/');
              }}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              Public Home
            </a>
          </div>
        </header>

        {mobileMenuOpen && (
          <div className="lg:hidden bg-white border-b border-slate-200 p-3 grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => goTab('reports', '/authority')} className="px-3 py-2 text-xs font-semibold rounded bg-slate-100 text-left">
              All Reports
            </button>
            <button type="button" onClick={() => goTab('emergency', '/authority/emergency')} className="px-3 py-2 text-xs font-semibold rounded bg-slate-100 text-left">
              Emergency Control
            </button>
            <button type="button" onClick={() => goTab('notifications', '/authority/notifications')} className="px-3 py-2 text-xs font-semibold rounded bg-slate-100 text-left">
              Alerts ({unreadCount})
            </button>
            <button type="button" onClick={() => goTab('admin', '/authority/admin')} className="px-3 py-2 text-xs font-semibold rounded bg-slate-100 text-left">
              Admin Center
            </button>
            <button type="button" onClick={onLogout} className="px-3 py-2 text-xs font-semibold rounded bg-red-50 text-red-700 text-left col-span-2">
              Logout
            </button>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
          {/* High-priority incoming alert bar */}
          {urgentBanner && (
            <div className="rounded-xl border-2 border-red-600 bg-red-50 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-bold text-red-900">
                <ShieldAlert className="h-5 w-5 text-red-600 shrink-0" />
                <span>{urgentBanner}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    stopUrgentChime();
                    goTab('emergency', '/authority/emergency');
                  }}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-600 text-white"
                >
                  Open Emergency Center
                </button>
                <button
                  type="button"
                  onClick={stopUrgentChime}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-300 bg-white text-red-900"
                >
                  Acknowledge &amp; Silence
                </button>
              </div>
            </div>
          )}

          {/* Real Database Overview Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              { label: 'Total Reports', val: overview.total ?? 0, tone: 'text-slate-900' },
              { label: 'Pending / Submitted', val: overview.pending ?? 0, tone: 'text-amber-700' },
              { label: 'In Progress', val: (overview.assigned ?? 0) + (overview.underReview ?? 0) + (overview.inProgress ?? 0), tone: 'text-blue-700' },
              { label: 'Resolved', val: overview.resolved ?? 0, tone: 'text-emerald-700' },
              { label: 'Escalated', val: overview.escalated ?? 0, tone: 'text-red-700' },
              { label: 'Active SOS / Med', val: (overview.activeSos ?? 0) + (overview.medicalEmergencies ?? 0), tone: 'text-red-700' },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs text-slate-500">{kpi.label}</div>
                <div className={`text-2xl font-bold font-mono tabular-nums mt-1 ${kpi.tone}`}>{kpi.val}</div>
              </div>
            ))}
          </div>

          {tab === 'reports' && !activeReport && (
            <div className="space-y-5">
              {/* Filters */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
                  <input
                    value={fSearch}
                    onChange={(e) => setFSearch(e.target.value)}
                    placeholder="Search ID, title, citizen..."
                    className="lg:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                  <select value={fCategory} onChange={(e) => setFCategory(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs bg-white">
                    <option value="ALL">All Categories</option>
                    <option value="Roads and Potholes">Roads and Potholes</option>
                    <option value="Waste Management">Waste Management</option>
                    <option value="Drainage and Waterlogging">Drainage and Waterlogging</option>
                    <option value="Traffic and Road Obstructions">Traffic and Road Obstructions</option>
                    <option value="Road Accident">Road Accident</option>
                    <option value="Medical Assistance">Medical Assistance</option>
                    <option value="Women and Child Safety">Women and Child Safety</option>
                    <option value="Animal Rescue">Animal Rescue</option>
                    <option value="Other Civic Issues">Other Civic Issues</option>
                  </select>
                  <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs bg-white">
                    <option value="ALL">All Statuses</option>
                    <option value="SUBMITTED">SUBMITTED</option>
                    <option value="RECEIVED">RECEIVED</option>
                    <option value="UNDER REVIEW">UNDER REVIEW</option>
                    <option value="ASSIGNED">ASSIGNED</option>
                    <option value="IN PROGRESS">IN PROGRESS</option>
                    <option value="RESOLVED">RESOLVED</option>
                    <option value="REJECTED">REJECTED</option>
                    <option value="REOPENED">REOPENED</option>
                    <option value="ESCALATED">ESCALATED</option>
                  </select>
                  <select value={fSeverity} onChange={(e) => setFSeverity(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs bg-white">
                    <option value="ALL">All Severities</option>
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                  <select value={fDepartment} onChange={(e) => setFDepartment(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs bg-white">
                    <option value="ALL">All Departments</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    value={fWard}
                    onChange={(e) => setFWard(e.target.value)}
                    placeholder="Filter by Ward / Area..."
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                  <input
                    type="date"
                    value={fDateFrom}
                    onChange={(e) => setFDateFrom(e.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={loadReports}
                    className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#14532D] text-white"
                  >
                    Search &amp; Filter
                  </button>
                </div>
              </div>

              {/* Reports Table / Cards */}
              {reports.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
                  No citizen reports match the current filters. All incoming citizen reports appear here immediately upon submission.
                </div>
              ) : (
                <div className="space-y-3">
                  {reports.map((r) => {
                    const photo = r.media.find((m) => m.media_kind === 'evidence_photo');
                    return (
                      <div
                        key={r.id}
                        onClick={() => navigateTo(`/authority/reports/${r.id}`)}
                        className="rounded-xl border border-slate-200 bg-white p-4 hover:border-[#14532D] cursor-pointer transition-colors flex flex-col sm:flex-row gap-4"
                      >
                        <div className="w-full sm:w-28 h-28 rounded-lg border border-slate-200 bg-slate-100 shrink-0 overflow-hidden flex items-center justify-center text-[11px] text-slate-500 text-center p-1">
                          {photo ? (
                            <img src={withAuthToken(photo.url)} alt={r.title} className="w-full h-full object-cover" />
                          ) : (
                            <span>No photograph attached</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-mono font-bold text-[#14532D] tabular-nums">
                              {r.trackingCode} · {r.category} · {r.severity}
                            </span>
                            <span className="font-semibold text-slate-900">{r.status}</span>
                          </div>
                          <div className="text-base font-bold text-slate-900">{r.title}</div>
                          <p className="text-xs text-slate-600 line-clamp-2">{r.description}</p>
                          <div className="text-xs text-slate-500 pt-1">
                            Citizen: <strong>{r.citizenName}</strong> ({r.citizenPhone}) · Dept:{' '}
                            <strong>{r.assignedDepartmentName || 'Unassigned'}</strong> ·{' '}
                            {formatDateTime(r.createdAt)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'reports' && activeReport && (
            <AuthorityReportDetail
              report={activeReport}
              departments={departments}
              officers={officers}
              onBack={() => navigateTo('/authority')}
              onUpdated={async () => {
                await loadReports();
                await loadAllOperational();
              }}
            />
          )}

          {tab === 'emergency' && (
            <AuthorityEmergencyCenter
              sosAlerts={sosAlerts}
              medicalRequests={medicalRequests}
              onRefresh={loadAllOperational}
            />
          )}

          {tab === 'notifications' && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">Authority Alert Feed</h2>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/api/notifications/read-all', { method: 'POST' });
                    loadAllOperational();
                  }}
                  className="text-xs font-semibold text-[#14532D] hover:underline"
                >
                  Mark All Read
                </button>
              </div>
              {notifications.length === 0 ? (
                <p className="text-xs text-slate-500">No authority alerts recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`rounded-lg border p-3 text-xs flex justify-between gap-3 ${
                        n.priority === 'emergency' ? 'border-red-300 bg-red-50' : 'border-slate-200'
                      }`}
                    >
                      <div>
                        <div className="font-bold text-slate-900">{n.title}</div>
                        <div className="text-slate-600 mt-0.5">{n.message}</div>
                        <div className="text-[11px] font-mono text-slate-400 mt-1">{formatDateTime(n.created_at)}</div>
                      </div>
                      {n.link_path && (
                        <button
                          type="button"
                          onClick={() => navigateTo(n.link_path!)}
                          className="px-3 py-1.5 rounded bg-[#14532D] text-white font-semibold h-fit shrink-0"
                        >
                          Inspect
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'admin' && (
            <AuthorityAdminControlCenter
              departments={departments}
              onRefresh={loadAllOperational}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// ============================================================
// AUTHORITY REPORT DETAIL & LIFECYCLE MANAGEMENT
// ============================================================
function AuthorityReportDetail({
  report,
  departments,
  officers,
  onBack,
  onUpdated,
}: {
  report: CivicReport;
  departments: Department[];
  officers: any[];
  onBack: () => void;
  onUpdated: () => Promise<void>;
}) {
  const [status, setStatus] = useState(report.status);
  const [departmentId, setDepartmentId] = useState(report.assignedDepartmentId || departments[0]?.id || '');
  const [officerId, setOfficerId] = useState(report.assignedOfficerId || '');
  const [actionNote, setActionNote] = useState('');
  const [resolutionDesc, setResolutionDesc] = useState(report.resolutionDescription || '');
  const [rejectionReason, setRejectionReason] = useState(report.rejectionReason || '');
  const [heatmapApproved, setHeatmapApproved] = useState(report.adminHeatmapApproved);
  const [isVerifiedCivic, setIsVerifiedCivic] = useState(report.isVerifiedCivic);
  const [isDuplicate, setIsDuplicate] = useState(report.isDuplicate);
  const [falsePenalty, setFalsePenalty] = useState(false);
  const [resolutionPhoto, setResolutionPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    setStatus(report.status);
    setDepartmentId(report.assignedDepartmentId || departments[0]?.id || '');
    setOfficerId(report.assignedOfficerId || '');
    setResolutionDesc(report.resolutionDescription || '');
    setRejectionReason(report.rejectionReason || '');
    setHeatmapApproved(report.adminHeatmapApproved);
    setIsVerifiedCivic(report.isVerifiedCivic);
    setIsDuplicate(report.isDuplicate);
  }, [report.id, report.updatedAt, departments]);

  const evidencePhotos = report.media.filter((m) => m.media_kind === 'evidence_photo');
  const evidenceVideos = report.media.filter((m) => m.media_kind === 'evidence_video');
  const resolutionPhotos = report.media.filter((m) => m.media_kind === 'resolution_photo');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSavedMsg(null);
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('status', status);
      if (departmentId) fd.append('assignedDepartmentId', departmentId);
      if (officerId) fd.append('assignedOfficerId', officerId);
      if (actionNote.trim()) fd.append('actionNote', actionNote.trim());
      if (resolutionDesc.trim()) fd.append('resolutionDescription', resolutionDesc.trim());
      if (rejectionReason.trim()) fd.append('rejectionReason', rejectionReason.trim());
      fd.append('adminHeatmapApproved', String(heatmapApproved));
      fd.append('isVerifiedCivic', String(isVerifiedCivic));
      fd.append('isDuplicate', String(isDuplicate));
      fd.append('applyFalseReportPenalty', String(falsePenalty));
      if (resolutionPhoto) fd.append('resolutionPhoto', resolutionPhoto);

      await apiFetch(`/api/reports/${report.id}/status`, { method: 'PATCH', body: fd });
      setSavedMsg(`Report updated to ${status}. Citizen notified.`);
      setActionNote('');
      setResolutionPhoto(null);
      await onUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to update report.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to All Citizen Reports
        </button>
        <span className="font-mono text-xs font-bold text-[#14532D]">{report.trackingCode}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="text-xs text-slate-500">
              {report.category} {report.subType ? `(${report.subType})` : ''} · {report.severity} Severity ·{' '}
              {formatDateTime(report.createdAt)}
            </div>
            <h2 className="text-xl font-bold text-slate-900">{report.title}</h2>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{report.description}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-200 text-xs">
              <div>
                <span className="text-slate-500">Citizen:</span> <strong>{report.citizenName}</strong>
              </div>
              <div>
                <span className="text-slate-500">Verified Contact:</span>{' '}
                <strong className="font-mono">{report.citizenPhone}</strong>
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-500">Email:</span> <strong>{report.citizenEmail}</strong>
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-500">Address:</span>{' '}
                <strong>{report.location?.formattedAddress || 'Coordinates recorded'}</strong>
              </div>
            </div>

            {report.aiSuggestedCategory && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs space-y-1">
                <div className="font-semibold text-emerald-900">AI Triage Suggestion (Advisory Only)</div>
                <div>
                  Suggested Category: <strong>{report.aiSuggestedCategory}</strong> · Suggested Severity:{' '}
                  <strong>{report.aiSuggestedSeverity}</strong>
                </div>
                {report.aiSummary && <div>Summary: {report.aiSummary}</div>}
              </div>
            )}
          </div>

          {/* Citizen Uploaded Evidence */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
            <h3 className="text-base font-bold text-slate-900">Citizen Uploaded Evidence</h3>
            {evidencePhotos.length === 0 && evidenceVideos.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500">
                No photograph attached
              </div>
            ) : (
              <div className="space-y-3">
                {evidencePhotos.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {evidencePhotos.map((m) => {
                      const src = withAuthToken(m.url);
                      return (
                        <a key={m.id} href={src} target="_blank" rel="noopener noreferrer">
                          <img
                            src={src}
                            alt={m.original_filename}
                            className="w-full h-36 object-cover rounded-lg border border-slate-200"
                          />
                        </a>
                      );
                    })}
                  </div>
                )}
                {evidenceVideos.map((v) => (
                  <video key={v.id} src={withAuthToken(v.url)} controls className="w-full max-h-64 rounded bg-black" />
                ))}
              </div>
            )}

            {resolutionPhotos.length > 0 && (
              <div className="pt-3 border-t border-slate-200 space-y-2">
                <div className="text-xs font-semibold text-emerald-800">Uploaded Resolution Evidence</div>
                <div className="grid grid-cols-2 gap-3">
                  {resolutionPhotos.map((rp) => {
                    const src = withAuthToken(rp.url);
                    return (
                      <a key={rp.id} href={src} target="_blank" rel="noopener noreferrer">
                        <img src={src} alt="Resolution" className="w-full h-32 object-cover rounded border border-emerald-300" />
                      </a>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {report.location && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
              <div className="text-xs font-semibold text-slate-900 font-mono">
                GPS Location: {report.location.latitude.toFixed(6)}, {report.location.longitude.toFixed(6)} (Source:{' '}
                {report.location.source})
              </div>
              <LiveMap
                center={{ latitude: report.location.latitude, longitude: report.location.longitude }}
                accuracyMeters={report.location.accuracyMeters}
                heightClass="h-56"
                zoom={15}
              />
            </div>
          )}
        </div>

        {/* Right: Authority Action Form + Audit History */}
        <div className="lg:col-span-5 space-y-5">
          <form onSubmit={handleSave} className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Investigation &amp; Status Action</h3>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Report Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                {[
                  'SUBMITTED',
                  'RECEIVED',
                  'UNDER REVIEW',
                  'ASSIGNED',
                  'IN PROGRESS',
                  'RESOLVED',
                  'REJECTED',
                  'REOPENED',
                  'ESCALATED',
                ].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Assign Department</label>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Assign Officer</label>
              <select
                value={officerId}
                onChange={(e) => setOfficerId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="">Unassigned / Department Pool</option>
                {officers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.full_name} ({o.department_name})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Investigation / Action Note</label>
              <textarea
                rows={2}
                value={actionNote}
                onChange={(e) => setActionNote(e.target.value)}
                placeholder="Record inspection findings or dispatch note..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            </div>

            {status === 'RESOLVED' && (
              <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div>
                  <label className="block text-xs font-semibold text-emerald-950 mb-1">
                    Resolution Details (Mandatory)
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={resolutionDesc}
                    onChange={(e) => setResolutionDesc(e.target.value)}
                    placeholder="Describe work completed to resolve this report..."
                    className="w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-emerald-950 mb-1">
                    Resolution Photograph (Optional)
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setResolutionPhoto(e.target.files?.[0] || null)}
                    className="text-xs"
                  />
                </div>
              </div>
            )}

            {status === 'REJECTED' && (
              <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
                <label className="block text-xs font-semibold text-red-950">Rejection Reason (Mandatory)</label>
                <textarea
                  required
                  rows={2}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-xs"
                />
                <label className="flex items-center gap-2 text-xs text-red-900 cursor-pointer">
                  <input type="checkbox" checked={falsePenalty} onChange={(e) => setFalsePenalty(e.target.checked)} />
                  <span>Apply false-report points penalty (-25 pts)</span>
                </label>
              </div>
            )}

            <div className="space-y-2 pt-2 border-t border-slate-200 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isVerifiedCivic}
                  onChange={(e) => setIsVerifiedCivic(e.target.checked)}
                />
                <span>Verify report as genuine civic contribution (awards citizen points)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isDuplicate} onChange={(e) => setIsDuplicate(e.target.checked)} />
                <span>Mark as duplicate report (blocks duplicate points)</span>
              </label>
              {report.category === 'Women and Child Safety' && (
                <label className="flex items-center gap-2 cursor-pointer text-amber-900 font-semibold">
                  <input
                    type="checkbox"
                    checked={heatmapApproved}
                    onChange={(e) => setHeatmapApproved(e.target.checked)}
                  />
                  <span>Approve anonymized location for City Crime &amp; Safety Heatmap</span>
                </label>
              )}
            </div>

            {error && <div className="text-xs font-medium text-red-700">{error}</div>}
            {savedMsg && <div className="text-xs font-medium text-emerald-700">{savedMsg}</div>}

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 text-sm font-semibold rounded-lg bg-[#14532D] text-white hover:bg-[#166534] disabled:opacity-50"
            >
              {saving ? 'Updating Record...' : 'Save Status Update'}
            </button>
          </form>

          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
            <h4 className="text-sm font-bold text-slate-900">Report Audit History</h4>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {report.history.map((h) => (
                <div key={h.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs">
                  <div className="flex justify-between font-semibold">
                    <span>
                      {h.previous_status ? `${h.previous_status} → ` : ''}
                      {h.new_status}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">{formatDateTime(h.created_at)}</span>
                  </div>
                  {h.action_note && <div className="text-slate-600 mt-0.5">{h.action_note}</div>}
                  <div className="text-[11px] text-slate-400">By {h.updated_by_name}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// AUTHORITY EMERGENCY CONTROL CENTER (SOS + MEDICAL)
// ============================================================
function AuthorityEmergencyCenter({
  sosAlerts,
  medicalRequests,
  onRefresh,
}: {
  sosAlerts: any[];
  medicalRequests: any[];
  onRefresh: () => void;
}) {
  const acknowledgeSos = async (sosId: string) => {
    await apiFetch(`/api/seva-shield/sos/${sosId}/acknowledge`, { method: 'POST' });
    onRefresh();
  };

  const updateMedicalStatus = async (medId: string, status: string) => {
    await apiFetch(`/api/medical/${medId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    onRefresh();
  };

  const activePins = [
    ...sosAlerts
      .filter((s) => s.status !== 'SAFE_RESOLVED' && typeof s.latest_latitude === 'number')
      .map((s) => ({
        id: s.id,
        latitude: s.latest_latitude,
        longitude: s.latest_longitude,
        title: `SOS: ${s.citizen_name} (${s.emergency_code})`,
        subtitle: `${s.status} · Tel: ${s.citizen_phone}`,
        kind: 'sos' as const,
      })),
    ...medicalRequests
      .filter((m) => m.status !== 'Resolved')
      .map((m) => ({
        id: m.id,
        latitude: m.latitude,
        longitude: m.longitude,
        title: `Medical: ${m.citizen_name} (${m.tracking_code})`,
        subtitle: `${m.status} · ${m.patient_condition}`,
        kind: 'hospital' as const,
      })),
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="text-lg font-bold text-slate-900">Live Emergency Operations Map</h2>
        <LiveMap markers={activePins} heightClass="h-72" zoom={13} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="text-base font-bold text-slate-900">Seva Shield SOS Alerts ({sosAlerts.length})</h3>
          {sosAlerts.length === 0 ? (
            <p className="text-xs text-slate-500">No SOS alerts recorded.</p>
          ) : (
            <div className="space-y-3 max-h-[420px] overflow-y-auto">
              {sosAlerts.map((s) => (
                <div
                  key={s.id}
                  className={`rounded-lg border p-3.5 text-xs space-y-2 ${
                    s.status === 'SAFE_RESOLVED' ? 'border-slate-200 bg-slate-50' : 'border-red-300 bg-red-50'
                  }`}
                >
                  <div className="flex justify-between font-bold">
                    <span className="font-mono">{s.emergency_code} · {s.citizen_name}</span>
                    <span className={s.status === 'SAFE_RESOLVED' ? 'text-emerald-700' : 'text-red-700'}>
                      {s.status}
                    </span>
                  </div>
                  <div className="text-slate-700">
                    Phone: <span className="font-mono">{s.citizen_phone}</span> · Trigger: {s.trigger_method} ·{' '}
                    {formatDateTime(s.created_at)}
                  </div>
                  {typeof s.latest_latitude === 'number' && (
                    <div className="font-mono text-[11px] text-slate-600">
                      GPS: {s.latest_latitude.toFixed(5)}, {s.latest_longitude.toFixed(5)} (±
                      {Math.round(s.latest_accuracy || 0)}m)
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {s.status !== 'SAFE_RESOLVED' && !s.acknowledged_at && (
                      <button
                        type="button"
                        onClick={() => acknowledgeSos(s.id)}
                        className="px-3 py-1.5 rounded bg-[#14532D] text-white font-semibold"
                      >
                        Acknowledge SOS
                      </button>
                    )}
                    {s.tracking_token && (
                      <a
                        href={`/track/${s.tracking_token}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded border border-slate-300 bg-white font-semibold text-slate-800"
                      >
                        Open Live Tracking Map
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="text-base font-bold text-slate-900">Medical Assistance Dispatches ({medicalRequests.length})</h3>
          {medicalRequests.length === 0 ? (
            <p className="text-xs text-slate-500">No medical emergency requests recorded.</p>
          ) : (
            <div className="space-y-3 max-h-[420px] overflow-y-auto">
              {medicalRequests.map((m) => (
                <div key={m.id} className="rounded-lg border border-slate-200 p-3.5 text-xs space-y-2">
                  <div className="flex justify-between font-bold">
                    <span className="font-mono text-[#14532D]">{m.tracking_code} · {m.citizen_name}</span>
                    <span className="text-red-700">{m.status}</span>
                  </div>
                  <div className="text-slate-800">{m.patient_condition}</div>
                  <div className="text-slate-500">
                    Tel: <span className="font-mono">{m.phone}</span> · {m.formatted_address}
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {['Acknowledged', 'Ambulance Assigned', 'On the Way', 'Resolved'].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => updateMedicalStatus(m.id, st)}
                        className={`px-2.5 py-1 rounded text-[11px] font-semibold border ${
                          m.status === st
                            ? 'bg-[#14532D] text-white border-[#14532D]'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// AUTHORITY ADMIN CONTROL CENTER (Clean Unified Modules)
// ============================================================
function AuthorityAdminControlCenter({
  departments,
  onRefresh,
}: {
  departments: Department[];
  onRefresh: () => void;
}) {
  const [subTab, setSubTab] = useState<'departments' | 'users' | 'awards' | 'analytics'>('departments');

  // Dept create form
  const [deptCode, setDeptCode] = useState('');
  const [deptName, setDeptName] = useState('');
  const [deptScope, setDeptScope] = useState('');

  // Users
  const [citizens, setCitizens] = useState<any[]>([]);
  const [officers, setOfficers] = useState<any[]>([]);

  // Awards
  const [awardYear, setAwardYear] = useState(new Date().getFullYear());
  const [awardData, setAwardData] = useState<any>({ award: null, candidates: [] });
  const [awardMsg, setAwardMsg] = useState<string | null>(null);

  // Analytics & Audit
  const [analytics, setAnalytics] = useState<any | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [aiInsights, setAiInsights] = useState<string | null>(null);

  const loadAdminData = async () => {
    const [uRes, aRes, anRes, logRes] = await Promise.all([
      apiFetch('/api/admin/users'),
      apiFetch(`/api/awards/admin?year=${awardYear}`),
      apiFetch('/api/admin/analytics'),
      apiFetch('/api/admin/audit-logs'),
    ]);
    setCitizens(uRes.citizens || []);
    setOfficers(uRes.officers || []);
    setAwardData(aRes);
    setAnalytics(anRes);
    setAuditLogs(logRes.logs || []);
  };

  useEffect(() => {
    loadAdminData();
  }, [awardYear]);

  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/departments', {
      method: 'POST',
      body: JSON.stringify({ code: deptCode, name: deptName, categoryScope: deptScope }),
    });
    setDeptCode('');
    setDeptName('');
    setDeptScope('');
    onRefresh();
    loadAdminData();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'departments', label: 'Department Management' },
          { id: 'users', label: 'User & Authority Management' },
          { id: 'awards', label: 'Annual Award & Shortlist' },
          { id: 'analytics', label: 'Analytics, DPDP & Audit Logs' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id as any)}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg border ${
              subTab === t.id ? 'bg-[#14532D] text-white border-[#14532D]' : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'departments' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h3 className="text-base font-bold text-slate-900">Active City Departments</h3>
            <div className="space-y-2">
              {departments.map((d) => (
                <div key={d.id} className="rounded-lg border border-slate-200 p-3 text-xs flex justify-between gap-2">
                  <div>
                    <div className="font-bold text-slate-900">
                      [{d.code}] {d.name}
                    </div>
                    <div className="text-slate-500">Scope: {d.category_scope}</div>
                  </div>
                  <div className="text-right font-mono text-slate-600">
                    <div>{d.assigned_reports_count ?? 0} reports</div>
                    <div>{d.officers_count ?? 0} officers</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={handleCreateDept} className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-3 h-fit">
            <h3 className="text-base font-bold text-slate-900">Add New Department</h3>
            <input
              required
              value={deptCode}
              onChange={(e) => setDeptCode(e.target.value)}
              placeholder="Code (e.g. WTR)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
            />
            <input
              required
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              placeholder="Department Name"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
            <input
              required
              value={deptScope}
              onChange={(e) => setDeptScope(e.target.value)}
              placeholder="Category Scope"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
            <button type="submit" className="w-full py-2 text-xs font-semibold rounded-lg bg-[#14532D] text-white">
              Create Department
            </button>
          </form>
        </div>
      )}

      {subTab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              Authority Officers ({officers.length})
            </h3>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {officers.map((o) => (
                <div key={o.id} className="rounded-lg border border-slate-200 p-3 text-xs flex justify-between gap-2">
                  <div>
                    <div className="font-bold text-slate-900">{o.full_name}</div>
                    <div className="text-slate-600">
                      {o.designation} · {o.department_name} · Badge {o.badge_number}
                    </div>
                  </div>
                  <span className="font-semibold text-emerald-700">{o.is_active ? 'Active' : 'Inactive'}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h3 className="text-base font-bold text-slate-900">Registered Citizens ({citizens.length})</h3>
            {citizens.length === 0 ? (
              <p className="text-xs text-slate-500">No citizen accounts registered yet.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {citizens.map((c) => (
                  <div key={c.id} className="rounded-lg border border-slate-200 p-3 text-xs flex justify-between gap-2">
                    <div>
                      <div className="font-bold text-slate-900">{c.full_name}</div>
                      <div className="text-slate-500 font-mono">
                        {c.phone} · {c.reports_count} reports
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/admin/users/${c.id}/status`, {
                          method: 'PATCH',
                          body: JSON.stringify({ isActive: !c.is_active }),
                        });
                        loadAdminData();
                      }}
                      className={`px-2.5 py-1 rounded text-[11px] font-semibold ${
                        c.is_active ? 'bg-slate-100 text-slate-700' : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {c.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'awards' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
                <Award className="h-4 w-4 text-amber-600" />
                Annual Award: MOST SOCIALLY ALERT CITIZEN ({awardYear})
              </h3>
              <p className="text-xs text-slate-500">
                Shortlist top verified citizens, investigate eligibility, disqualify if needed, and confirm winner.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={awardYear}
                onChange={(e) => setAwardYear(Number(e.target.value))}
                className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-mono"
              />
              <button
                type="button"
                onClick={async () => {
                  setAwardMsg(null);
                  try {
                    const res = await apiFetch('/api/awards/admin/shortlist', {
                      method: 'POST',
                      body: JSON.stringify({ year: awardYear }),
                    });
                    setAwardMsg(`Shortlisted ${res.count} top verified citizens for ${awardYear}.`);
                    loadAdminData();
                  } catch (err: any) {
                    setAwardMsg(err.message);
                  }
                }}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-[#14532D] text-white"
              >
                Generate Shortlist
              </button>
            </div>
          </div>

          {awardMsg && <div className="text-xs font-semibold text-emerald-800">{awardMsg}</div>}

          {awardData.candidates?.length === 0 ? (
            <p className="text-xs text-slate-500">
              No shortlisted candidates for {awardYear} yet. Citizens must have verified reports and points.
            </p>
          ) : (
            <div className="space-y-2.5">
              {awardData.candidates.map((cand: any) => (
                <div key={cand.id} className="rounded-lg border border-slate-200 p-3.5 text-xs flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-900">
                      #{cand.rank_order} {cand.full_name} ({cand.status})
                    </div>
                    <div className="text-slate-600 font-mono">
                      {cand.total_points} pts · {cand.verified_reports_count} verified reports
                    </div>
                    {cand.disqualification_reason && (
                      <div className="text-red-700 mt-0.5">Disqualified: {cand.disqualification_reason}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {cand.status !== 'DISQUALIFIED' && awardData.award?.status !== 'CONFIRMED' && (
                      <>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch('/api/awards/admin/confirm', {
                              method: 'POST',
                              body: JSON.stringify({ awardId: awardData.award.id, candidateId: cand.id }),
                            });
                            setAwardMsg(`Confirmed ${cand.full_name} as ${awardYear} winner & issued PDF certificate.`);
                            loadAdminData();
                          }}
                          className="px-3 py-1.5 rounded bg-[#14532D] text-white font-semibold"
                        >
                          Confirm Winner
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/awards/admin/candidate/${cand.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({
                                action: 'disqualify',
                                disqualificationReason: 'Disqualified following authority audit verification.',
                              }),
                            });
                            loadAdminData();
                          }}
                          className="px-3 py-1.5 rounded border border-red-300 text-red-700 font-semibold"
                        >
                          Disqualify
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === 'analytics' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
                  <BarChart3 className="h-4 w-4" />
                  Category Breakdown (Database)
                </h3>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await apiFetch('/api/admin/analytics/ai-insights', { method: 'POST' });
                    setAiInsights(res.available ? res.insights : res.error);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-700 text-white"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  AI Trend Insights
                </button>
              </div>
              {analytics?.byCategory?.length === 0 ? (
                <p className="text-xs text-slate-500">No reports submitted yet.</p>
              ) : (
                <div className="space-y-2 text-xs">
                  {analytics?.byCategory?.map((c: any) => (
                    <div key={c.category} className="flex justify-between border-b border-slate-100 py-1.5">
                      <span className="font-medium text-slate-800">{c.category}</span>
                      <span className="font-mono tabular-nums">
                        {c.count} total · {c.resolved} resolved
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {aiInsights && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950 whitespace-pre-wrap">
                  {aiInsights}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <h3 className="text-base font-bold text-slate-900">DPDP Privacy &amp; Compliance Hub</h3>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-slate-500">Consents Logged</div>
                  <div className="text-lg font-bold font-mono">{analytics?.dpdpStats?.consentsRecorded ?? 0}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-slate-500">Sensitive Cases</div>
                  <div className="text-lg font-bold font-mono">{analytics?.dpdpStats?.sensitiveReportsCount ?? 0}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-slate-500">Deletion Requests</div>
                  <div className="text-lg font-bold font-mono">{analytics?.dpdpStats?.deletionRequests ?? 0}</div>
                </div>
              </div>

              <h4 className="text-xs font-bold text-slate-800 pt-2">Recent Security &amp; Audit Logs</h4>
              <div className="space-y-1.5 max-h-52 overflow-y-auto text-[11px] font-mono">
                {auditLogs.map((l) => (
                  <div key={l.id} className="border-b border-slate-100 py-1 flex justify-between gap-2">
                    <span className="truncate">
                      {l.action} · {l.actor_name || 'System'}
                    </span>
                    <span className="text-slate-400 shrink-0">{formatDateTime(l.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
