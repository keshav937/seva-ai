import { jsPDF } from 'jspdf';
import { Award, Bell, Check, Download, FileCheck, HeartHandshake, Lock, MapPin, MessageSquare, PlusCircle, RefreshCw, Shield, Trophy, Upload, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LiveMap } from '../LiveMap.tsx';
import { getLocationStateLabel, useLiveLocation } from '../../hooks/useLiveLocation.ts';
import { apiFetch, formatDateTime, formatDistance, navigateTo, withAuthToken } from '../../lib/api.ts';
import type { AuthUser, CivicReport, NearbyPlace, NotificationItem, SmsLogItem, UserProfile } from '../../types/seva.ts';

// ============================================================
// 1. CITY CRIME & SAFETY HEATMAP (Admin-Approved, Anonymized)
// ============================================================
export function HeatmapModule() {
  const [subType, setSubType] = useState('ALL');
  const [timeOfDay, setTimeOfDay] = useState('all');
  const [ward, setWard] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [data, setData] = useState<{
    zones: any[];
    totalApprovedIncidents: number;
    lastUpdatedAt: string | null;
    disclaimer: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadHeatmap = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (subType !== 'ALL') params.set('subType', subType);
      if (timeOfDay !== 'all') params.set('timeOfDay', timeOfDay);
      if (ward.trim()) params.set('ward', ward.trim());
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const res = await apiFetch(`/api/heatmap?${params.toString()}`);
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHeatmap();
  }, [subType, timeOfDay]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">City Crime &amp; Safety Heatmap</h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Aggregated solely from administrator-approved safety &amp; harassment reports. Reporter identities are never shown.
          </p>
        </div>
        <div className="text-xs font-mono text-slate-500">
          Last updated: {data?.lastUpdatedAt ? formatDateTime(data.lastUpdatedAt) : 'No approved incidents yet'}
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <select
          value={subType}
          onChange={(e) => setSubType(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
        >
          <option value="ALL">All Incident Types</option>
          <option value="Harassment">Harassment</option>
          <option value="Unsafe public locations">Unsafe public locations</option>
          <option value="Suspicious activities">Suspicious activities</option>
          <option value="Emergency assistance">Emergency assistance</option>
        </select>

        <select
          value={timeOfDay}
          onChange={(e) => setTimeOfDay(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
        >
          <option value="all">Day &amp; Night</option>
          <option value="day">Daytime (06:00–17:59)</option>
          <option value="night">Nighttime (18:00–05:59)</option>
        </select>

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
          aria-label="From date"
        />

        <input
          value={ward}
          onChange={(e) => setWard(e.target.value)}
          placeholder="Filter by Ward / Area"
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
        />

        <button
          type="button"
          onClick={loadHeatmap}
          className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#14532D] text-white hover:bg-[#166534]"
        >
          Apply Filters
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8">
          <LiveMap heatmapZones={data?.zones || []} heightClass="h-[420px]" zoom={13} />
        </div>

        <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h3 className="text-base font-bold text-slate-900">Risk Legend &amp; Summary</h3>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 rounded-full bg-emerald-600 inline-block" />
              <span><strong>Low reported risk</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 rounded-full bg-amber-600 inline-block" />
              <span><strong>Moderate reported risk</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 rounded-full bg-red-600 inline-block" />
              <span><strong>High reported risk</strong></span>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 text-xs space-y-1">
            <div>
              Approved incidents in view:{' '}
              <strong className="font-mono tabular-nums">{data?.totalApprovedIncidents ?? 0}</strong>
            </div>
            <div>
              Aggregated zones:{' '}
              <strong className="font-mono tabular-nums">{data?.zones.length ?? 0}</strong>
            </div>
          </div>

          {!loading && data?.zones.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              No administrator-approved safety incidents match the current filters.
            </div>
          )}

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
            {data?.disclaimer ||
              'Heatmap reflects only administrator-approved safety reports. Absence of reports never guarantees an area is completely safe.'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 2. CITIZEN REWARDS, BADGES, LEADERBOARD & ANNUAL AWARD
// ============================================================
export function RewardsAndLeaderboardModule({ user, onProfileUpdated }: { user: AuthUser; onProfileUpdated: () => void }) {
  const [rewards, setRewards] = useState<any | null>(null);
  const [period, setPeriod] = useState<'month' | 'year' | 'all' | 'ward'>('all');
  const [wardFilter, setWardFilter] = useState('');
  const [leaderboard, setLeaderboard] = useState<{ entries: any[]; selfEntry: any }>({ entries: [], selfEntry: null });
  const [myAwards, setMyAwards] = useState<any[]>([]);
  const [hallOfFame, setHallOfFame] = useState<any[]>([]);
  const [anonymous, setAnonymous] = useState(Boolean(user.anonymous_leaderboard));

  const loadData = async () => {
    const [rRes, aRes, hRes] = await Promise.all([
      apiFetch('/api/rewards/my'),
      apiFetch('/api/awards/my'),
      apiFetch('/api/awards'),
    ]);
    setRewards(rRes);
    setMyAwards(aRes.awards || []);
    setHallOfFame(hRes.hallOfFame || []);
  };

  const loadLeaderboard = async () => {
    const p = period === 'ward' ? 'all' : period;
    const w = period === 'ward' && wardFilter.trim() ? `&ward=${encodeURIComponent(wardFilter.trim())}` : '';
    const res = await apiFetch(`/api/leaderboard?period=${p}${w}`);
    setLeaderboard({ entries: res.entries || [], selfEntry: res.selfEntry || null });
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadLeaderboard();
  }, [period]);

  const toggleAnonymous = async (val: boolean) => {
    setAnonymous(val);
    await apiFetch('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ anonymousLeaderboard: val }),
    });
    onProfileUpdated();
    await loadLeaderboard();
  };

  const downloadPdfCertificate = (award: any) => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setDrawColor(20, 83, 45);
    doc.setLineWidth(2);
    doc.rect(12, 12, 273, 186);
    doc.setLineWidth(0.5);
    doc.rect(16, 16, 265, 178);

    doc.setFontSize(14);
    doc.setTextColor(5, 150, 105);
    doc.text('SEVA AI — SMART CITY INTELLIGENCE & EMERGENCY RESPONSE', 148.5, 36, { align: 'center' });

    doc.setFontSize(26);
    doc.setTextColor(20, 83, 45);
    doc.text('CERTIFICATE OF CIVIC EXCELLENCE', 148.5, 56, { align: 'center' });

    doc.setFontSize(14);
    doc.setTextColor(51, 65, 85);
    doc.text('THIS ANNUAL HONOUR IS PROUDLY PRESENTED TO', 148.5, 76, { align: 'center' });

    doc.setFontSize(28);
    doc.setTextColor(15, 23, 42);
    doc.text(user.full_name.toUpperCase(), 148.5, 96, { align: 'center' });

    doc.setFontSize(16);
    doc.setTextColor(20, 83, 45);
    doc.text(`${award.title} — ${award.award_year}`, 148.5, 114, { align: 'center' });

    doc.setFontSize(11);
    doc.setTextColor(71, 85, 105);
    doc.text(
      'In recognition of verified civic reporting, public safety vigilance, and verified community contribution.',
      148.5,
      132,
      { align: 'center' }
    );

    doc.setFontSize(10);
    doc.text(`Certificate Code: ${award.certificate_code || 'VERIFIED'}`, 30, 172);
    doc.text(`Issued: ${formatDateTime(award.issued_at || award.confirmed_at)}`, 148.5, 172, { align: 'center' });
    doc.text('Authorized City Authority · SEVA AI', 267, 172, { align: 'right' });

    doc.save(`SEVA-AI-Award-${award.award_year}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Citizen Rewards, Badges &amp; Leaderboard</h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Points and badges are awarded strictly for authority-verified civic reports and confirmed resolutions.
          </p>
        </div>
        <div className="flex items-center gap-5 font-mono tabular-nums">
          <div className="text-right">
            <div className="text-xs text-slate-500 font-sans">Verified Points</div>
            <div className="text-2xl font-bold text-[#14532D]">{rewards?.totalPoints ?? 0}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500 font-sans">Verified Reports</div>
            <div className="text-2xl font-bold text-slate-900">{rewards?.verifiedReports ?? 0}</div>
          </div>
        </div>
      </div>

      {/* Annual Awards Won by User */}
      {myAwards.length > 0 && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-6 space-y-3">
          {myAwards.map((aw) => (
            <div key={aw.id} className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold text-amber-800">ANNUAL CIVIC AWARD WINNER · {aw.award_year}</div>
                <h3 className="text-lg font-bold text-slate-900">{aw.title}</h3>
                <div className="text-xs font-mono text-slate-700">Certificate: {aw.certificate_code}</div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(aw.winner_consent)}
                    onChange={async (e) => {
                      await apiFetch(`/api/awards/${aw.id}/consent`, {
                        method: 'POST',
                        body: JSON.stringify({ consent: e.target.checked }),
                      });
                      loadData();
                    }}
                  />
                  Display my name in Hall of Fame
                </label>
                <button
                  type="button"
                  onClick={() => downloadPdfCertificate(aw)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-[#14532D] text-white"
                >
                  <Download className="h-4 w-4" />
                  Download PDF Certificate
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Badges & Points Ledger */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Award className="h-4 w-4 text-[#14532D]" />
            Your Civic Badges ({rewards?.badges?.length ?? 0})
          </h3>
          {rewards?.badges?.length === 0 ? (
            <p className="text-xs text-slate-500">
              Submit a report and have it verified by municipal authorities to unlock your Bronze Citizen and First Report badges.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {rewards?.badges?.map((b: any) => (
                <div key={b.id} className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                  <div className="text-sm font-bold text-emerald-950">{b.badge_name}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{b.audit_note}</div>
                  <div className="text-[11px] font-mono text-slate-400 mt-1">{formatDateTime(b.awarded_at)}</div>
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-slate-200">
            <div className="text-xs font-semibold text-slate-800 mb-2">Badge Tier Thresholds</div>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
              {rewards?.badgeTiers?.map((t: any) => (
                <div key={t.id} className="flex justify-between rounded bg-slate-50 px-2.5 py-1.5">
                  <span>{t.badge_name}</span>
                  <span className="font-mono font-semibold">{t.min_verified_reports}+</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-900">Points Audit History</h3>
          {rewards?.pointsHistory?.length === 0 ? (
            <p className="text-xs text-slate-500">
              No points awarded yet. Rejected, duplicate, or unverified reports do not earn points.
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {rewards?.pointsHistory?.map((p: any) => (
                <div key={p.id} className="rounded-lg border border-slate-200 p-2.5 text-xs flex justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">{p.reason}</div>
                    <div className="text-slate-500">
                      {p.tracking_code ? `${p.tracking_code} · ` : ''}
                      {formatDateTime(p.created_at)}
                    </div>
                  </div>
                  <div className={`font-mono font-bold tabular-nums ${p.points >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {p.points >= 0 ? `+${p.points}` : p.points}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Real Database Leaderboard */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-600" />
            Verified Citizen Leaderboard
          </h3>
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => toggleAnonymous(e.target.checked)}
              className="rounded border-slate-300 text-[#14532D]"
            />
            Display me as Anonymous Citizen
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['month', 'year', 'all', 'ward'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setPeriod(tab)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border ${
                period === tab ? 'bg-[#14532D] text-white border-[#14532D]' : 'bg-slate-50 text-slate-700 border-slate-200'
              }`}
            >
              {tab === 'month' ? 'This Month' : tab === 'year' ? 'This Year' : tab === 'all' ? 'All Time' : 'Area / Ward'}
            </button>
          ))}
          {period === 'ward' && (
            <div className="flex items-center gap-2">
              <input
                value={wardFilter}
                onChange={(e) => setWardFilter(e.target.value)}
                placeholder="Ward name..."
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={loadLeaderboard}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white"
              >
                Filter
              </button>
            </div>
          )}
        </div>

        {leaderboard.selfEntry && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs flex justify-between">
            <span>
              Your Current Rank: <strong>#{leaderboard.selfEntry.rank}</strong> ({leaderboard.selfEntry.badge})
            </span>
            <span className="font-mono font-bold tabular-nums">
              {leaderboard.selfEntry.points} pts · {leaderboard.selfEntry.verifiedReports} verified
            </span>
          </div>
        )}

        {leaderboard.entries.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">
            No verified citizen scores recorded in this period yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Rank</th>
                  <th className="py-2 pr-3">Citizen</th>
                  <th className="py-2 pr-3">Ward</th>
                  <th className="py-2 pr-3">Badge</th>
                  <th className="py-2 pr-3 text-right">Verified</th>
                  <th className="py-2 text-right">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leaderboard.entries.map((row) => (
                  <tr key={row.rank} className={row.isSelf ? 'bg-emerald-50/70 font-semibold' : ''}>
                    <td className="py-2.5 pr-3 font-mono tabular-nums">#{row.rank}</td>
                    <td className="py-2.5 pr-3">{row.displayName}{row.isSelf ? ' (You)' : ''}</td>
                    <td className="py-2.5 pr-3 text-slate-600">{row.ward}</td>
                    <td className="py-2.5 pr-3 text-emerald-800">{row.badge}</td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{row.verifiedReports}</td>
                    <td className="py-2.5 text-right font-mono font-bold tabular-nums">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Hall of Fame */}
      {hallOfFame.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
          <h3 className="text-base font-bold text-slate-900">Hall of Fame — Past Annual Winners</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {hallOfFame.map((w) => (
              <div key={w.certificate_code} className="rounded-lg border border-slate-200 p-4 text-xs space-y-1">
                <div className="font-mono font-bold text-[#14532D]">{w.award_year}</div>
                <div className="text-sm font-bold text-slate-900">{w.winner_name}</div>
                <div className="text-slate-600">{w.title}</div>
                <div className="font-mono text-[11px] text-slate-400">{w.certificate_code}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 3. USER PROFILE & DPDP PRIVACY SETTINGS
// ============================================================
export function ProfileSettingsModule({
  user,
  profile,
  onUpdated,
  onLogout,
}: {
  user: AuthUser;
  profile: UserProfile | null;
  onUpdated: () => void;
  onLogout: () => void;
}) {
  const [fullName, setFullName] = useState(user.full_name);
  const [address, setAddress] = useState(profile?.address || '');
  const [ward, setWard] = useState(profile?.ward || '');
  const [city, setCity] = useState(profile?.city || '');
  const [notifySms, setNotifySms] = useState(Boolean(profile?.notify_sms ?? 1));
  const [notifyEmail, setNotifyEmail] = useState(Boolean(profile?.notify_email ?? 1));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [avatarMsg, setAvatarMsg] = useState<string | null>(null);

  const [currPwd, setCurrPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);

  useEffect(() => {
    setFullName(user.full_name);
    setAddress(profile?.address || '');
    setWard(profile?.ward || '');
    setCity(profile?.city || '');
    setNotifySms(Boolean(profile?.notify_sms ?? 1));
    setNotifyEmail(Boolean(profile?.notify_email ?? 1));
  }, [user.full_name, profile?.address, profile?.ward, profile?.city, profile?.notify_sms, profile?.notify_email]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ fullName, address, ward, city, notifySms, notifyEmail }),
      });
      setMsg('Profile and preferences saved.');
      onUpdated();
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarMsg(null);
    try {
      const fd = new FormData();
      fd.append('avatar', file);
      await apiFetch('/api/auth/profile/avatar', { method: 'POST', body: fd });
      setAvatarMsg('Profile photograph updated.');
      onUpdated();
    } catch (err: any) {
      setAvatarMsg(err.message || 'Avatar upload failed.');
    } finally {
      e.target.value = '';
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMsg(null);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: currPwd, newPassword: newPwd }),
      });
      setCurrPwd('');
      setNewPwd('');
      setPwdMsg('Password changed successfully.');
    } catch (err: any) {
      setPwdMsg(err.message);
    }
  };

  const handleDeletionRequest = async () => {
    try {
      const res = await apiFetch('/api/auth/request-deletion', { method: 'POST' });
      setMsg(res.message);
    } catch (err: any) {
      setMsg(err.message || 'Unable to submit deletion request.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center">
            {profile?.avatarUrl ? (
              <img src={withAuthToken(profile.avatarUrl)} alt={user.full_name} className="h-full w-full object-cover" />
            ) : (
              <User className="h-7 w-7 text-slate-400" />
            )}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{user.full_name}</h2>
            <div className="text-xs font-mono text-slate-600">
              {user.email} · {user.phone}
            </div>
            <div className="text-xs text-emerald-700 mt-0.5">
              Profile Completion: <strong className="font-mono">{profile?.completionPct ?? 0}%</strong>
            </div>
            {avatarMsg && <div className="text-xs font-medium text-emerald-700 mt-1">{avatarMsg}</div>}
          </div>
        </div>
        <label className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer">
          <Upload className="h-3.5 w-3.5" />
          Upload Profile Photograph
          <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
        </label>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleSaveProfile} className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-900">Personal Details &amp; Notification Preferences</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">City</label>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Bengaluru, Pune, Delhi"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Preferred Area / Ward</label>
              <input
                value={ward}
                onChange={(e) => setWard(e.target.value)}
                placeholder="e.g. Indiranagar Ward 80"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Address (Voluntary)</label>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-200 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={notifySms} onChange={(e) => setNotifySms(e.target.checked)} />
              <span>Receive consented SMS updates on report status changes</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} />
              <span>Receive email updates for reports and awards</span>
            </label>
          </div>

          {msg && <div className="text-xs font-medium text-emerald-700">{msg}</div>}

          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 text-xs font-semibold rounded-lg bg-[#14532D] text-white hover:bg-[#166534]"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </form>

        <div className="lg:col-span-5 space-y-5">
          <form onSubmit={handleChangePassword} className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
              <Lock className="h-4 w-4" />
              Change Password
            </h3>
            <input
              required
              type="password"
              value={currPwd}
              onChange={(e) => setCurrPwd(e.target.value)}
              placeholder="Current password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              required
              type="password"
              minLength={8}
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="New password (min 8 chars)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            {pwdMsg && <div className="text-xs font-medium text-slate-700">{pwdMsg}</div>}
            <button type="submit" className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white">
              Update Password
            </button>
          </form>

          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
              <Shield className="h-4 w-4 text-[#14532D]" />
              DPDP Privacy &amp; Session Controls
            </h3>
            <p className="text-xs text-slate-600">
              Your reports, evidence photos, and contacts are protected under Indian DPDP governance.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDeletionRequest}
                className="px-3 py-2 text-xs font-semibold rounded-lg border border-red-300 text-red-700 hover:bg-red-50"
              >
                Request Account / Data Deletion
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-800 hover:bg-slate-50"
              >
                Secure Logout
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 4. CENTRALIZED NOTIFICATION CENTER
// ============================================================
export function NotificationsModule({
  notifications,
  smsLogs = [],
  onRefresh,
}: {
  notifications: NotificationItem[];
  smsLogs?: SmsLogItem[];
  onRefresh: () => void;
}) {
  const [retryingSmsId, setRetryingSmsId] = useState<string | null>(null);
  const [smsRetryMsg, setSmsRetryMsg] = useState<string | null>(null);

  const markRead = async (id: string) => {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
    onRefresh();
  };

  const markAllRead = async () => {
    await apiFetch('/api/notifications/read-all', { method: 'POST' });
    onRefresh();
  };

  const retrySms = async (smsId: string) => {
    setRetryingSmsId(smsId);
    setSmsRetryMsg(null);
    try {
      const res = await apiFetch(`/api/notifications/sms/${smsId}/retry`, { method: 'POST' });
      setSmsRetryMsg(
        res.status === 'DELIVERED' || res.status === 'ACCEPTED_BY_PROVIDER'
          ? `SMS dispatched via ${res.provider} (${res.status}).`
          : `SMS retry recorded (${res.status}${res.errorMessage ? `: ${res.errorMessage}` : ''}).`
      );
      onRefresh();
    } catch (err: any) {
      setSmsRetryMsg(err.message || 'Could not retry SMS dispatch.');
    } finally {
      setRetryingSmsId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Notification Center</h2>
          <p className="text-xs text-slate-500">
            Real-time report status updates, SOS caregiver alerts, medical dispatches, and SMS delivery logs.
          </p>
        </div>
        <button
          type="button"
          onClick={markAllRead}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-50"
        >
          <Check className="h-3.5 w-3.5" />
          Mark All Read
        </button>
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
          <Bell className="h-7 w-7 text-slate-400 mx-auto mb-2" />
          No notifications recorded yet.
        </div>
      ) : (
        <div className="space-y-2.5">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`rounded-xl border p-4 flex flex-wrap items-start justify-between gap-3 ${
                n.priority === 'emergency'
                  ? 'border-red-300 bg-red-50'
                  : n.is_read
                    ? 'border-slate-200 bg-white'
                    : 'border-emerald-300 bg-emerald-50/40'
              }`}
            >
              <div className="space-y-1">
                <div className="text-xs text-slate-500">
                  {n.category} · {formatDateTime(n.created_at)}
                  {!n.is_read && <strong className="ml-2 text-[#14532D]">Unread</strong>}
                </div>
                <div className="text-sm font-bold text-slate-900">{n.title}</div>
                <p className="text-xs text-slate-700">{n.message}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {n.link_path && (
                  <button
                    type="button"
                    onClick={() => {
                      markRead(n.id);
                      navigateTo(n.link_path!);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#14532D] text-white"
                  >
                    Open
                  </button>
                )}
                {!n.is_read && (
                  <button
                    type="button"
                    onClick={() => markRead(n.id)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white"
                  >
                    Mark Read
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SMS Notification Delivery History */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-[#14532D]" />
              SMS Delivery History ({smsLogs.length})
            </h3>
            <p className="text-xs text-slate-500">
              Honest gateway delivery records for OTPs, SOS caregiver alerts, and complaint lifecycle SMS messages.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        {smsRetryMsg && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
            {smsRetryMsg}
          </div>
        )}

        {smsLogs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
            No SMS dispatches recorded for your account yet.
          </div>
        ) : (
          <div className="space-y-2.5">
            {smsLogs.map((log) => {
              const badgeClass =
                log.status === 'DELIVERED' || log.status === 'ACCEPTED_BY_PROVIDER'
                  ? 'bg-emerald-100 text-emerald-800'
                  : log.status === 'NOT_CONFIGURED'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-red-100 text-red-800';
              return (
                <div key={log.id} className="rounded-lg border border-slate-200 p-3 text-xs space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900">{log.event_type}</span>
                      <span className="font-mono text-slate-600">{log.recipient_phone}</span>
                      <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${badgeClass}`}>
                        {log.status}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      {formatDateTime(log.created_at)}
                    </div>
                  </div>
                  <p className="text-slate-700">{log.message_body}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                    <div>
                      Provider: <strong>{log.provider}</strong>
                      {log.provider_message_id ? ` · SID: ${log.provider_message_id}` : ''}
                      {log.retry_count > 0 ? ` · Retries: ${log.retry_count}` : ''}
                      {log.error_message ? ` · ${log.error_message}` : ''}
                    </div>
                    {(log.status === 'FAILED' || log.status === 'NOT_CONFIGURED') && (
                      <button
                        type="button"
                        disabled={retryingSmsId === log.id}
                        onClick={() => retrySms(log.id)}
                        className="px-2.5 py-1 rounded bg-slate-900 text-white font-semibold disabled:opacity-50"
                      >
                        {retryingSmsId === log.id ? 'Retrying...' : 'Retry SMS'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 5. ANIMAL RESCUE HUB
// ============================================================
export function AnimalRescueHubModule({
  myReports,
  onReportAnimal,
  onSelectReport,
}: {
  myReports: CivicReport[];
  onReportAnimal: () => void;
  onSelectReport: (reportId: string) => void;
}) {
  const gps = useLiveLocation(false);
  const [vets, setVets] = useState<NearbyPlace[]>([]);
  const [loadingVets, setLoadingVets] = useState(false);
  const [vetError, setVetError] = useState<string | null>(null);

  const animalReports = myReports.filter((r) => r.category === 'Animal Rescue');

  useEffect(() => {
    if (!gps.location) return;
    setLoadingVets(true);
    setVetError(null);
    apiFetch(`/api/places/nearby?lat=${gps.location.latitude}&lng=${gps.location.longitude}&category=veterinary&radius=7000`)
      .then((res) => setVets(res.places || []))
      .catch((err: any) => setVetError(err.message || 'Unable to fetch nearby veterinary centers.'))
      .finally(() => setLoadingVets(false));
  }, [gps.location?.latitude.toFixed(3), gps.location?.longitude.toFixed(3)]);

  const locStatus = getLocationStateLabel(gps.state);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
            <HeartHandshake className="h-4 w-4" />
            ANIMAL WELFARE &amp; RESCUE UNIT
          </div>
          <h2 className="text-xl font-bold text-slate-900 mt-0.5">Animal Rescue Hub</h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Report injured strays, trapped animals, or wildlife hazards directly to the Animal Welfare &amp; Rescue Unit.
          </p>
        </div>
        <button
          type="button"
          onClick={onReportAnimal}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold rounded-lg bg-[#14532D] text-white hover:bg-[#166534]"
        >
          <PlusCircle className="h-4 w-4" />
          Report Animal Rescue Incident
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">Your Animal Rescue Reports ({animalReports.length})</h3>
            <button
              type="button"
              onClick={onReportAnimal}
              className="text-xs font-semibold text-[#14532D] hover:underline"
            >
              + New Rescue Report
            </button>
          </div>

          {animalReports.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center space-y-2">
              <p className="text-xs text-slate-600">No animal rescue reports submitted yet from your account.</p>
              <button
                type="button"
                onClick={onReportAnimal}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#14532D] text-white"
              >
                Submit Animal Rescue Report
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {animalReports.map((r) => (
                <div
                  key={r.id}
                  onClick={() => onSelectReport(r.id)}
                  className="rounded-lg border border-slate-200 p-3 text-xs cursor-pointer hover:border-[#14532D] space-y-1"
                >
                  <div className="flex justify-between font-semibold">
                    <span className="font-mono text-[#14532D]">{r.trackingCode}</span>
                    <span className="text-slate-900">{r.status}</span>
                  </div>
                  <div className="text-sm font-bold text-slate-900">{r.title}</div>
                  <div className="text-slate-500">
                    {r.subType || 'Animal Rescue'} · {r.assignedDepartmentName || 'Animal Welfare & Rescue Unit'}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-950 space-y-1">
            <div className="font-bold">First-Response Safety Guidance</div>
            <p>
              Keep a safe distance from injured or distressed animals. Share exact GPS location, clear photos, and
              visible landmarks so veterinary rescue teams reach the spot quickly.
            </p>
          </div>
        </div>

        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900">Nearby Veterinary &amp; Animal Hospitals</h3>
              <p className="text-xs text-slate-500">{locStatus.label}</p>
            </div>
            <button
              type="button"
              onClick={gps.startTracking}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#14532D] text-white"
            >
              <MapPin className="h-3.5 w-3.5" />
              {gps.isWatching ? 'Refresh GPS' : 'Find Nearby Vets'}
            </button>
          </div>

          <LiveMap
            center={gps.location ? { latitude: gps.location.latitude, longitude: gps.location.longitude } : null}
            accuracyMeters={gps.location?.accuracy}
            markers={vets.map((v) => ({
              id: v.id,
              latitude: v.latitude,
              longitude: v.longitude,
              title: v.name,
              subtitle: `${v.category} · ${formatDistance(v.distanceMeters)}`,
              kind: 'hospital',
              navigationUrl: v.navigationUrl,
            }))}
            heightClass="h-52"
          />

          {vetError && <div className="text-xs text-red-700">{vetError}</div>}

          {!gps.location ? (
            <div className="text-xs text-slate-500">
              Click &quot;Find Nearby Vets&quot; to query OpenStreetMap for veterinary clinics near your GPS location.
            </div>
          ) : loadingVets ? (
            <div className="text-xs text-slate-500">Searching nearby veterinary facilities...</div>
          ) : vets.length === 0 ? (
            <div className="text-xs text-slate-500">No veterinary clinics returned within 7 km.</div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {vets.map((v) => (
                <div key={v.id} className="rounded-lg border border-slate-200 p-2.5 text-xs flex justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{v.name}</div>
                    <div className="text-slate-500 truncate">
                      {formatDistance(v.distanceMeters)} · {v.address}
                    </div>
                  </div>
                  <a
                    href={v.navigationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-[#14532D] hover:underline shrink-0"
                  >
                    Navigate
                  </a>
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
// 6. PRIVACY & DPDP GOVERNANCE HUB
// ============================================================
export function DpdpPrivacyHubModule({
  user,
  onLogout,
}: {
  user: AuthUser;
  onLogout: () => void;
}) {
  const [summary, setSummary] = useState<{
    policyVersion: string;
    deletionRequestedAt: string | null;
    accountCreatedAt: string | null;
    consents: any[];
    recentAudit: any[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadSummary = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/dpdp/summary');
      setSummary(res);
    } catch (err: any) {
      setStatusMsg(err.message || 'Unable to load DPDP summary.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, []);

  const handleRequestDeletion = async () => {
    setStatusMsg(null);
    try {
      const res = await apiFetch('/api/auth/request-deletion', { method: 'POST' });
      setStatusMsg(res.message);
      await loadSummary();
    } catch (err: any) {
      setStatusMsg(err.message || 'Unable to log deletion request.');
    }
  };

  const handleDownloadDataSummary = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      policyVersion: summary?.policyVersion || 'DPDP-2026.1',
      account: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        accountCreatedAt: summary?.accountCreatedAt || null,
        deletionRequestedAt: summary?.deletionRequestedAt || null,
      },
      consents: summary?.consents || [],
      recentAudit: summary?.recentAudit || [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seva-dpdp-summary-${user.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-[#14532D] flex items-center gap-1.5">
            <Shield className="h-4 w-4" />
            DIGITAL PERSONAL DATA PROTECTION (DPDP ACT)
          </div>
          <h2 className="text-xl font-bold text-slate-900 mt-0.5">Privacy &amp; DPDP Governance Hub</h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Review your active data processing consents, security audit trail, data export, and erasure controls.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadSummary}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleDownloadDataSummary}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-[#14532D] text-white hover:bg-[#166534]"
          >
            <Download className="h-3.5 w-3.5" />
            Export Personal Data JSON
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-[#14532D]" />
            Recorded Consents ({summary?.consents.length ?? 0})
          </h3>
          {loading ? (
            <p className="text-xs text-slate-500">Loading consent ledger...</p>
          ) : (summary?.consents.length ?? 0) === 0 ? (
            <p className="text-xs text-slate-500">No consent records found.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {summary?.consents.map((c) => (
                <div key={c.id} className="rounded-lg border border-slate-200 p-3 text-xs flex justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">{c.consent_type}</div>
                    <div className="text-slate-500">Policy: {c.policy_version}</div>
                  </div>
                  <div className="text-right">
                    <span className={`font-semibold ${c.granted ? 'text-emerald-700' : 'text-red-700'}`}>
                      {c.granted ? 'Granted' : 'Revoked'}
                    </span>
                    <div className="text-[11px] font-mono text-slate-400">{formatDateTime(c.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-6 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Lock className="h-4 w-4 text-[#14532D]" />
              Your DPDP Rights &amp; Erasure Status
            </h3>
            <div className="text-xs text-slate-600 space-y-1.5">
              <div>Policy Version: <strong className="font-mono">{summary?.policyVersion || 'DPDP-2026.1'}</strong></div>
              <div>
                Account Created:{' '}
                <strong className="font-mono">{formatDateTime(summary?.accountCreatedAt)}</strong>
              </div>
              <div>
                Data Deletion Status:{' '}
                <strong className={summary?.deletionRequestedAt ? 'text-amber-700' : 'text-emerald-700'}>
                  {summary?.deletionRequestedAt
                    ? `Requested on ${formatDateTime(summary.deletionRequestedAt)}`
                    : 'Active — No pending deletion request'}
                </strong>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={handleRequestDeletion}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-red-300 text-red-700 hover:bg-red-50"
              >
                Request Account / Data Deletion
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-800 hover:bg-slate-50"
              >
                End Active Session
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Your Recent Security Audit Trail</h3>
            {loading ? (
              <p className="text-xs text-slate-500">Loading audit events...</p>
            ) : (summary?.recentAudit.length ?? 0) === 0 ? (
              <p className="text-xs text-slate-500">No recent audit events logged.</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto text-[11px] font-mono">
                {summary?.recentAudit.map((a, idx) => (
                  <div key={idx} className="border-b border-slate-100 py-1 flex justify-between gap-2">
                    <span className="truncate text-slate-800">{a.action}</span>
                    <span className="text-slate-400 shrink-0">{formatDateTime(a.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
