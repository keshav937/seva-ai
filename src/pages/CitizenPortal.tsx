import {
  Activity,
  AlertOctagon,
  Award,
  Bell,
  Car,
  FileText,
  Flame,
  HeartHandshake,
  Home,
  Lock,
  LogOut,
  Map as MapIcon,
  Menu,
  PlusCircle,
  Shield,
  User,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { SevaLogo } from '../components/SevaLogo.tsx';
import {
  AnimalRescueHubModule,
  DpdpPrivacyHubModule,
  HeatmapModule,
  NotificationsModule,
  ProfileSettingsModule,
  RewardsAndLeaderboardModule,
} from '../components/citizen/CivicCommunityModules.tsx';
import { MedicalAssistanceModule, NearbyPlacesModule } from '../components/citizen/MedicalAndNearbyModule.tsx';
import { MyReportsModule } from '../components/citizen/MyReportsModule.tsx';
import { ReportIssueModule } from '../components/citizen/ReportIssueModule.tsx';
import { SevaShieldModule } from '../components/citizen/SevaShieldModule.tsx';
import { useWebSocket } from '../hooks/useWebSocket.ts';
import { apiFetch, formatDateTime, navigateTo, withAuthToken } from '../lib/api.ts';
import type { AuthUser, CivicReport, NotificationItem, SmsLogItem, UserProfile } from '../types/seva.ts';

type CitizenTab =
  | 'home'
  | 'report'
  | 'reports'
  | 'seva-shield'
  | 'medical'
  | 'animal-rescue'
  | 'nearby'
  | 'heatmap'
  | 'rewards'
  | 'notifications'
  | 'dpdp'
  | 'profile';

interface CitizenPortalProps {
  user: AuthUser;
  pathname: string;
  onLogout: () => void;
  onRefreshUser: () => void;
}

function resolveTabFromPath(pathname: string): { tab: CitizenTab; reportId: string | null } {
  if (pathname.startsWith('/citizen/reports/')) {
    return { tab: 'reports', reportId: pathname.replace('/citizen/reports/', '') };
  }
  if (pathname === '/citizen/reports') return { tab: 'reports', reportId: null };
  if (pathname === '/citizen/report') return { tab: 'report', reportId: null };
  if (pathname === '/citizen/seva-shield') return { tab: 'seva-shield', reportId: null };
  if (pathname === '/citizen/medical') return { tab: 'medical', reportId: null };
  if (pathname === '/citizen/animal-rescue') return { tab: 'animal-rescue', reportId: null };
  if (pathname === '/citizen/nearby') return { tab: 'nearby', reportId: null };
  if (pathname === '/citizen/heatmap') return { tab: 'heatmap', reportId: null };
  if (pathname === '/citizen/rewards') return { tab: 'rewards', reportId: null };
  if (pathname === '/citizen/notifications') return { tab: 'notifications', reportId: null };
  if (pathname === '/citizen/dpdp') return { tab: 'dpdp', reportId: null };
  if (pathname === '/citizen/profile') return { tab: 'profile', reportId: null };
  return { tab: 'home', reportId: null };
}

export function CitizenPortal({ user, pathname, onLogout, onRefreshUser }: CitizenPortalProps) {
  const initial = resolveTabFromPath(pathname);
  const [tab, setTab] = useState<CitizenTab>(initial.tab);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(initial.reportId);
  const [reportCategoryPreset, setReportCategoryPreset] = useState<string | undefined>(undefined);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [myReports, setMyReports] = useState<CivicReport[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [smsLogs, setSmsLogs] = useState<SmsLogItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeSos, setActiveSos] = useState<any | null>(null);
  const [wsSignal, setWsSignal] = useState(0);

  useEffect(() => {
    const resolved = resolveTabFromPath(pathname);
    setTab(resolved.tab);
    setSelectedReportId(resolved.reportId);
  }, [pathname]);

  const loadDashboardState = async () => {
    try {
      const [meRes, repRes, notifRes, sosRes] = await Promise.all([
        apiFetch('/api/auth/me'),
        apiFetch('/api/reports/my'),
        apiFetch('/api/notifications'),
        apiFetch('/api/seva-shield/sos/my'),
      ]);
      setProfile(meRes.profile || null);
      setMyReports(repRes.reports || []);
      setNotifications(notifRes.notifications || []);
      setSmsLogs(notifRes.smsLogs || []);
      setUnreadCount(notifRes.unreadCount || 0);
      setActiveSos((sosRes.events || []).find((e: any) => e.status !== 'SAFE_RESOLVED') || null);
    } catch {
      // handled
    }
  };

  useEffect(() => {
    loadDashboardState();
  }, [wsSignal]);

  const { connected } = useWebSocket(() => {
    setWsSignal((n) => n + 1);
  });

  const goTab = (next: CitizenTab, path: string, presetCat?: string) => {
    setTab(next);
    setSelectedReportId(null);
    setReportCategoryPreset(presetCat);
    setMobileMenuOpen(false);
    navigateTo(path);
  };

  const navItems: Array<{ id: CitizenTab; path: string; label: string; icon: any }> = [
    { id: 'home', path: '/citizen', label: 'Overview', icon: Home },
    { id: 'report', path: '/citizen/report', label: 'Report Issue', icon: PlusCircle },
    { id: 'reports', path: '/citizen/reports', label: 'My Reports', icon: FileText },
    { id: 'seva-shield', path: '/citizen/seva-shield', label: 'Seva Shield SOS', icon: Shield },
    { id: 'medical', path: '/citizen/medical', label: 'Medical Aid', icon: Activity },
    { id: 'animal-rescue', path: '/citizen/animal-rescue', label: 'Animal Rescue Hub', icon: HeartHandshake },
    { id: 'nearby', path: '/citizen/nearby', label: 'City Map & Nearby', icon: MapIcon },
    { id: 'heatmap', path: '/citizen/heatmap', label: 'Safety Heatmap', icon: Flame },
    { id: 'rewards', path: '/citizen/rewards', label: 'Rewards & Ranks', icon: Award },
    { id: 'notifications', path: '/citizen/notifications', label: 'Notifications', icon: Bell },
    { id: 'dpdp', path: '/citizen/dpdp', label: 'Privacy & DPDP Hub', icon: Lock },
    { id: 'profile', path: '/citizen/profile', label: 'Profile Settings', icon: User },
  ];

  return (
    <div className="min-h-screen bg-[#F8FAF9] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-white border-r border-slate-200 shrink-0">
        <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigateTo('/');
            }}
          >
            <SevaLogo size="sm" />
          </a>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => goTab(item.id, item.path)}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  active ? 'bg-[#14532D] text-white' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.id === 'notifications' && unreadCount > 0 && (
                  <span className={`text-xs font-mono font-bold ${active ? 'text-emerald-100' : 'text-red-600'}`}>
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
              {profile?.avatarUrl ? (
                <img src={withAuthToken(profile.avatarUrl)} alt={user.full_name} className="h-full w-full object-cover" />
              ) : (
                <User className="h-4 w-4 text-slate-500" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900 truncate">{user.full_name}</div>
              <div className="text-[11px] text-slate-500 truncate">{connected ? 'Live sync active' : 'Reconnecting...'}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700"
              aria-label="Toggle navigation"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div className="text-sm font-semibold text-slate-900">
              Citizen Portal / {navItems.find((n) => n.id === tab)?.label}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => goTab('seva-shield', '/citizen/seva-shield')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-red-600 text-white hover:bg-red-700 whitespace-nowrap shrink-0"
            >
              <AlertOctagon className="h-3.5 w-3.5" />
              SOS
            </button>
            <button
              type="button"
              onClick={() => goTab('notifications', '/citizen/notifications')}
              className="relative p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 px-1 text-[10px] font-mono font-bold rounded bg-red-600 text-white">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-white border-b border-slate-200 p-3 grid grid-cols-2 gap-1.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => goTab(item.id, item.path)}
                className={`px-3 py-2 text-xs font-semibold rounded-lg text-left ${
                  tab === item.id ? 'bg-[#14532D] text-white' : 'bg-slate-50 text-slate-700'
                }`}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={onLogout}
              className="px-3 py-2 text-xs font-semibold rounded-lg text-left bg-red-50 text-red-700"
            >
              Logout
            </button>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
          {/* Active SOS Emergency Banner across citizen dashboard */}
          {activeSos && (
            <div className="rounded-xl border-2 border-red-600 bg-red-50 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-red-900">
                <strong className="text-sm">ACTIVE EMERGENCY SOS ({activeSos.emergency_code})</strong> · Status:{' '}
                <strong>{activeSos.status}</strong> · Started {formatDateTime(activeSos.created_at)}
              </div>
              <button
                type="button"
                onClick={() => goTab('seva-shield', '/citizen/seva-shield')}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-red-600 text-white"
              >
                Open Active SOS Controls
              </button>
            </div>
          )}

          {tab === 'home' && (
            <div className="space-y-6">
              {/* Personalized Header Card */}
              <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 rounded-full border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center">
                    {profile?.avatarUrl ? (
                      <img src={withAuthToken(profile.avatarUrl)} alt={user.full_name} className="h-full w-full object-cover" />
                    ) : (
                      <User className="h-6 w-6 text-slate-400" />
                    )}
                  </div>
                  <div>
                    <h1 className="text-xl font-bold text-slate-900">Welcome, {user.full_name}</h1>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Profile Completion: <strong className="font-mono">{profile?.completionPct ?? 0}%</strong> ·{' '}
                      Reports Submitted: <strong className="font-mono">{myReports.length}</strong>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => goTab('profile', '/citizen/profile')}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-800 hover:bg-slate-50"
                >
                  Edit Profile &amp; Photo
                </button>
              </div>

              {/* Quick Action Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <button
                  type="button"
                  onClick={() => goTab('report', '/citizen/report', 'Roads and Potholes')}
                  className="rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-[#14532D] transition-colors space-y-2"
                >
                  <PlusCircle className="h-5 w-5 text-[#14532D]" />
                  <div className="text-base font-bold text-slate-900">Report a Civic Issue</div>
                  <div className="text-xs text-slate-600">
                    Roads, waste, drainage, traffic obstructions with real camera evidence &amp; GPS.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => goTab('medical', '/citizen/medical')}
                  className="rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-red-600 transition-colors space-y-2"
                >
                  <Activity className="h-5 w-5 text-red-600" />
                  <div className="text-base font-bold text-slate-900">Medical Assistance</div>
                  <div className="text-xs text-slate-600">
                    Locate nearest verified hospitals, request ambulance dispatch &amp; track response.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => goTab('report', '/citizen/report', 'Road Accident')}
                  className="rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-amber-600 transition-colors space-y-2"
                >
                  <Car className="h-5 w-5 text-amber-600" />
                  <div className="text-base font-bold text-slate-900">Report a Road Accident</div>
                  <div className="text-xs text-slate-600">
                    Capture live GPS, view nearest hospitals &amp; police stations, and alert control room.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => goTab('seva-shield', '/citizen/seva-shield')}
                  className="rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-red-600 transition-colors space-y-2"
                >
                  <Shield className="h-5 w-5 text-red-600" />
                  <div className="text-base font-bold text-slate-900">Women Safety &amp; Emergency SOS</div>
                  <div className="text-xs text-slate-600">
                    Seva Shield 2-second SOS, caregiver live tracking, voice trigger &amp; emergency contacts.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => goTab('reports', '/citizen/reports')}
                  className="rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-[#14532D] transition-colors space-y-2"
                >
                  <FileText className="h-5 w-5 text-[#14532D]" />
                  <div className="text-base font-bold text-slate-900">Track My Reports</div>
                  <div className="text-xs text-slate-600">
                    Follow every submitted report from submission through department resolution.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => goTab('nearby', '/citizen/nearby')}
                  className="rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-[#14532D] transition-colors space-y-2"
                >
                  <MapIcon className="h-5 w-5 text-[#14532D]" />
                  <div className="text-base font-bold text-slate-900">City Map &amp; Nearby Places</div>
                  <div className="text-xs text-slate-600">
                    Live GPS lookup for hospitals, police, pharmacies, metro/bus stations &amp; malls.
                  </div>
                </button>
              </div>

              {/* Separate Report New Issue shortcut for every category */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                <div className="text-sm font-bold text-slate-900">Report New Issue by Category</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    'Roads and Potholes',
                    'Waste Management',
                    'Drainage and Waterlogging',
                    'Traffic and Road Obstructions',
                    'Medical Assistance',
                    'Women and Child Safety',
                    'Road Accident',
                    'Animal Rescue',
                    'Other Civic Issues',
                  ].map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => goTab('report', '/citizen/report', cat)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-slate-50 hover:border-[#14532D] hover:bg-emerald-50 text-slate-800"
                    >
                      + Report {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Personal Recent Reports & Notifications */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900">Your Recent Reports</h3>
                    <button
                      type="button"
                      onClick={() => goTab('reports', '/citizen/reports')}
                      className="text-xs font-semibold text-[#14532D] hover:underline"
                    >
                      View All
                    </button>
                  </div>
                  {myReports.length === 0 ? (
                    <p className="text-xs text-slate-500">You have not submitted any civic reports yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {myReports.slice(0, 4).map((r) => (
                        <div
                          key={r.id}
                          onClick={() => navigateTo(`/citizen/reports/${r.id}`)}
                          className="rounded-lg border border-slate-200 p-3 text-xs flex justify-between gap-2 cursor-pointer hover:border-[#14532D]"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate">{r.title}</div>
                            <div className="text-slate-500">
                              <span className="font-mono">{r.trackingCode}</span> · {r.category}
                            </div>
                          </div>
                          <span className="font-semibold text-[#14532D] shrink-0">{r.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900">Recent Notifications</h3>
                    <button
                      type="button"
                      onClick={() => goTab('notifications', '/citizen/notifications')}
                      className="text-xs font-semibold text-[#14532D] hover:underline"
                    >
                      Notification Center
                    </button>
                  </div>
                  {notifications.length === 0 ? (
                    <p className="text-xs text-slate-500">No notifications yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {notifications.slice(0, 4).map((n) => (
                        <div key={n.id} className="rounded-lg border border-slate-200 p-3 text-xs">
                          <div className="font-semibold text-slate-900">{n.title}</div>
                          <div className="text-slate-600 mt-0.5 line-clamp-2">{n.message}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'report' && (
            <ReportIssueModule
              user={user}
              initialCategory={reportCategoryPreset}
              onSubmitted={(reportId) => {
                loadDashboardState();
                navigateTo(`/citizen/reports/${reportId}`);
              }}
            />
          )}

          {tab === 'reports' && (
            <MyReportsModule
              selectedReportId={selectedReportId}
              onSelectReport={(id) => navigateTo(id ? `/citizen/reports/${id}` : '/citizen/reports')}
              onNewReport={() => goTab('report', '/citizen/report')}
              refreshSignal={wsSignal}
            />
          )}

          {tab === 'seva-shield' && <SevaShieldModule user={user} profile={profile} wsSignal={wsSignal} />}
          {tab === 'medical' && <MedicalAssistanceModule user={user} wsSignal={wsSignal} />}
          {tab === 'animal-rescue' && (
            <AnimalRescueHubModule
              myReports={myReports}
              onReportAnimal={() => goTab('report', '/citizen/report', 'Animal Rescue')}
              onSelectReport={(reportId) => navigateTo(`/citizen/reports/${reportId}`)}
            />
          )}
          {tab === 'nearby' && <NearbyPlacesModule />}
          {tab === 'heatmap' && <HeatmapModule />}
          {tab === 'rewards' && <RewardsAndLeaderboardModule user={user} onProfileUpdated={onRefreshUser} />}
          {tab === 'notifications' && (
            <NotificationsModule notifications={notifications} smsLogs={smsLogs} onRefresh={loadDashboardState} />
          )}
          {tab === 'dpdp' && <DpdpPrivacyHubModule user={user} onLogout={onLogout} />}
          {tab === 'profile' && (
            <ProfileSettingsModule
              user={user}
              profile={profile}
              onUpdated={() => {
                onRefreshUser();
                loadDashboardState();
              }}
              onLogout={onLogout}
            />
          )}
        </main>
      </div>
    </div>
  );
}
