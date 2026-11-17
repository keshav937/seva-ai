import { CheckCircle2, MapPin, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LiveMap } from '../components/LiveMap.tsx';
import { SevaLogo } from '../components/SevaLogo.tsx';
import { useWebSocket } from '../hooks/useWebSocket.ts';
import { apiFetch, formatDateTime, navigateTo } from '../lib/api.ts';

export function CaregiverTrackPage({ token }: { token: string }) {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadTracking = async () => {
    try {
      const res = await apiFetch(`/api/seva-shield/track/${encodeURIComponent(token)}`);
      setData(res);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Unable to load tracking session.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTracking();
  }, [token]);

  useWebSocket(
    (evt) => {
      if (evt.type === 'sos:location_updated' || evt.type === 'sos:safe' || evt.type === 'sos:acknowledged') {
        loadTracking();
      }
    },
    { enabled: Boolean(token), trackingToken: token }
  );

  return (
    <div className="min-h-screen bg-[#F8FAF9] flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 h-16 flex items-center justify-between">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigateTo('/');
          }}
        >
          <SevaLogo size="md" />
        </a>
        <span className="text-xs font-semibold text-slate-600">Secure Caregiver Live Tracking</span>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8 space-y-6">
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Connecting to secure live location stream...
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{error}</div>
        ) : data ? (
          <div className="space-y-5">
            <div
              className={`rounded-xl border-2 p-6 ${
                data.isActive ? 'border-red-600 bg-red-50' : 'border-emerald-600 bg-emerald-50'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-mono font-bold">
                    {data.emergencyCode} · {data.sosStatus}
                  </div>
                  <h1 className="text-xl font-bold text-slate-900 mt-0.5">
                    {data.isActive
                      ? `Live Emergency Tracking: ${data.citizenName}`
                      : `${data.citizenName} Marked Safe — Tracking Ended`}
                  </h1>
                  <div className="text-xs text-slate-600 mt-1">
                    Activated: {formatDateTime(data.createdAt)}
                    {data.acknowledgedAt ? ` · Authority Acknowledged: ${formatDateTime(data.acknowledgedAt)}` : ''}
                    {data.resolvedAt ? ` · Safe Confirmed: ${formatDateTime(data.resolvedAt)}` : ''}
                  </div>
                </div>
                <div className="inline-flex items-center gap-1.5 text-sm font-bold">
                  {data.isActive ? (
                    <span className="text-red-700 inline-flex items-center gap-1.5">
                      <ShieldAlert className="h-5 w-5" />
                      Sharing Active
                    </span>
                  ) : (
                    <span className="text-emerald-700 inline-flex items-center gap-1.5">
                      <CheckCircle2 className="h-5 w-5" />
                      Marked Safe
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              {data.latestLocation ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 font-mono text-slate-800 tabular-nums">
                    <MapPin className="h-4 w-4 text-red-600" />
                    {data.latestLocation.latitude.toFixed(6)}, {data.latestLocation.longitude.toFixed(6)}
                    {data.latestLocation.accuracyMeters
                      ? ` (±${Math.round(data.latestLocation.accuracyMeters)}m)`
                      : ''}
                  </div>
                  <div className="text-slate-500">
                    Last GPS update: {formatDateTime(data.latestLocation.recordedAt)}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
                  Waiting for GPS coordinate fix from the citizen&apos;s device.
                </div>
              )}

              <LiveMap
                center={
                  data.latestLocation
                    ? { latitude: data.latestLocation.latitude, longitude: data.latestLocation.longitude }
                    : null
                }
                accuracyMeters={data.latestLocation?.accuracyMeters}
                trail={data.trail || []}
                heightClass="h-96"
                zoom={15}
              />
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
