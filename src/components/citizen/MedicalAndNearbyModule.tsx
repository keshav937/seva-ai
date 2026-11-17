import { Activity, MapPin, Navigation, PhoneCall, RefreshCw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LiveMap } from '../LiveMap.tsx';
import { getLocationStateLabel, useLiveLocation } from '../../hooks/useLiveLocation.ts';
import { apiFetch, formatDateTime, formatDistance } from '../../lib/api.ts';
import type { AuthUser, NearbyPlace } from '../../types/seva.ts';

const PLACE_FILTERS = [
  { key: 'hospital', label: 'Hospitals' },
  { key: 'police', label: 'Police Stations' },
  { key: 'ambulance', label: 'Ambulances' },
  { key: 'clinic', label: 'Clinics' },
  { key: 'pharmacy', label: 'Pharmacies' },
  { key: 'mall', label: 'Shopping Malls' },
  { key: 'restaurant', label: 'Restaurants' },
  { key: 'transit', label: 'Metro & Bus' },
  { key: 'public', label: 'Public Places' },
];

export function MedicalAssistanceModule({ user, wsSignal }: { user: AuthUser; wsSignal: number }) {
  const gps = useLiveLocation(true);
  const [phone, setPhone] = useState(user.phone || '');
  const [condition, setCondition] = useState('');
  const [severity, setSeverity] = useState<'Medium' | 'High' | 'Critical'>('Critical');
  const [triggerVoice, setTriggerVoice] = useState(false);

  const [hospitals, setHospitals] = useState<NearbyPlace[]>([]);
  const [selectedHospital, setSelectedHospital] = useState<NearbyPlace | null>(null);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [placesError, setPlacesError] = useState<string | null>(null);

  const [requests, setRequests] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMyRequests = async () => {
    try {
      const res = await apiFetch('/api/medical/my');
      setRequests(res.requests || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadMyRequests();
  }, [wsSignal]);

  const fetchNearbyHospitals = async (lat: number, lng: number) => {
    setLoadingPlaces(true);
    setPlacesError(null);
    try {
      const res = await apiFetch(`/api/places/nearby?lat=${lat}&lng=${lng}&category=ambulance&radius=7000`);
      setHospitals(res.places || []);
      if (res.places?.[0] && !selectedHospital) {
        setSelectedHospital(res.places[0]);
      }
    } catch (err: any) {
      setPlacesError(err.message || 'Unable to load nearby hospitals.');
    } finally {
      setLoadingPlaces(false);
    }
  };

  useEffect(() => {
    if (gps.location) {
      fetchNearbyHospitals(gps.location.latitude, gps.location.longitude);
    }
  }, [gps.location?.latitude.toFixed(3), gps.location?.longitude.toFixed(3)]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!gps.location) {
      setError('Live GPS coordinates are required to dispatch medical assistance.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/medical/request', {
        method: 'POST',
        body: JSON.stringify({
          phone,
          patientCondition: condition,
          severity,
          latitude: gps.location.latitude,
          longitude: gps.location.longitude,
          accuracyMeters: gps.location.accuracy,
          selectedFacility: selectedHospital
            ? {
                name: selectedHospital.name,
                address: selectedHospital.address,
                phone: selectedHospital.phone,
                latitude: selectedHospital.latitude,
                longitude: selectedHospital.longitude,
                distanceMeters: selectedHospital.distanceMeters,
              }
            : null,
          triggerVoiceAlert: triggerVoice,
        }),
      });
      setSubmitResult(res);
      setCondition('');
      await loadMyRequests();
    } catch (err: any) {
      setError(err.message || 'Medical request submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const locStatus = getLocationStateLabel(gps.state);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Medical Assistance &amp; Ambulance Response</h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Uses your actual live GPS coordinates to locate nearest hospitals and dispatch requests to authorities.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="tel:108"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-red-600 text-white hover:bg-red-700"
          >
            <PhoneCall className="h-3.5 w-3.5" />
            Call 108 Ambulance
          </a>
          <span className="text-xs font-semibold text-slate-700">{locStatus.label}</span>
        </div>
      </div>

      {gps.errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 flex items-center justify-between">
          <span>{gps.errorMessage}</span>
          <button type="button" onClick={gps.startTracking} className="font-semibold underline">
            Retry GPS
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleSubmit} className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-900">Request Urgent Medical Assistance</h3>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Mobile Number</label>
            <input
              required
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Urgency / Severity</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as any)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              <option value="Critical">Critical (Life-threatening / Trauma)</option>
              <option value="High">High (Urgent Ambulance Needed)</option>
              <option value="Medium">Medium (Medical Transport / Clinic)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Patient Condition &amp; Details</label>
            <textarea
              required
              rows={4}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="Describe symptoms, injuries, consciousness, or number of patients..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {selectedHospital && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs space-y-0.5">
              <div className="font-semibold text-emerald-950">Preferred Nearby Facility</div>
              <div className="text-emerald-900">
                {selectedHospital.name} ({formatDistance(selectedHospital.distanceMeters)})
              </div>
            </div>
          )}

          <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={triggerVoice}
              onChange={(e) => setTriggerVoice(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-[#14532D]"
            />
            <span>Trigger automated Twilio Voice emergency call if configured on server.</span>
          </label>

          {error && <div className="text-xs font-medium text-red-700">{error}</div>}

          {submitResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950 space-y-1">
              <div className="font-bold">
                Request {submitResult.trackingCode} Submitted ({submitResult.status})
              </div>
              {submitResult.callStatus && submitResult.callStatus !== 'NOT_ATTEMPTED' && (
                <div>
                  Voice Call Status: <strong>{submitResult.callStatus}</strong>
                  {submitResult.callDetail ? ` — ${submitResult.callDetail}` : ''}
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !gps.location}
            className="w-full inline-flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            <Activity className="h-4 w-4" />
            {submitting ? 'Dispatching Request...' : 'Send Medical Assistance Request'}
          </button>
        </form>

        <div className="lg:col-span-7 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Nearest Hospitals &amp; Ambulance Providers (Live GPS)
              </h3>
              {gps.location && (
                <button
                  type="button"
                  onClick={() => fetchNearbyHospitals(gps.location!.latitude, gps.location!.longitude)}
                  className="text-xs font-semibold text-[#14532D] inline-flex items-center gap-1"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </button>
              )}
            </div>

            <LiveMap
              center={gps.location ? { latitude: gps.location.latitude, longitude: gps.location.longitude } : null}
              accuracyMeters={gps.location?.accuracy}
              markers={hospitals.map((h) => ({
                id: h.id,
                latitude: h.latitude,
                longitude: h.longitude,
                title: h.name,
                subtitle: `${h.category} · ${formatDistance(h.distanceMeters)}`,
                kind: 'hospital',
                navigationUrl: h.navigationUrl,
              }))}
              heightClass="h-56"
            />

            {placesError && <div className="text-xs text-red-700">{placesError}</div>}

            {loadingPlaces ? (
              <div className="text-xs text-slate-500">Searching real OpenStreetMap medical facilities...</div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {hospitals.map((h) => (
                  <div
                    key={h.id}
                    onClick={() => setSelectedHospital(h)}
                    className={`rounded-lg border p-3 text-xs flex items-center justify-between gap-3 cursor-pointer ${
                      selectedHospital?.id === h.id ? 'border-[#14532D] bg-emerald-50/50' : 'border-slate-200'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">{h.name}</div>
                      <div className="text-slate-500 truncate">
                        {formatDistance(h.distanceMeters)} · {h.address}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Source: {h.source} {h.phone ? `· Phone: ${h.phone}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {h.phone && (
                        <a
                          href={`tel:${h.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="px-2.5 py-1.5 rounded border border-slate-300 font-semibold text-slate-800"
                        >
                          Call
                        </a>
                      )}
                      <a
                        href={h.navigationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="px-2.5 py-1.5 rounded bg-[#14532D] text-white font-semibold"
                      >
                        Navigate
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h3 className="text-base font-bold text-slate-900">Your Medical Requests</h3>
            {requests.length === 0 ? (
              <p className="text-xs text-slate-500">No medical emergency requests submitted.</p>
            ) : (
              <div className="space-y-2">
                {requests.map((r) => (
                  <div key={r.id} className="rounded-lg border border-slate-200 p-3 text-xs space-y-1">
                    <div className="flex justify-between font-semibold">
                      <span className="font-mono text-[#14532D]">{r.tracking_code}</span>
                      <span className="text-red-700">{r.status}</span>
                    </div>
                    <div className="text-slate-800">{r.patient_condition}</div>
                    <div className="text-slate-500">
                      {r.selected_facility_name || r.formatted_address} · {formatDateTime(r.created_at)}
                    </div>
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

export function NearbyPlacesModule() {
  const gps = useLiveLocation(true);
  const [category, setCategory] = useState('hospital');
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Explicit manual entry fallback ONLY when GPS fails or user explicitly asks
  const [manualOpen, setManualOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualResults, setManualResults] = useState<any[]>([]);
  const [manualCoords, setManualCoords] = useState<{ latitude: number; longitude: number; label: string } | null>(null);

  const activeCoords = gps.location
    ? { latitude: gps.location.latitude, longitude: gps.location.longitude, isLiveGps: true, label: 'Live Device GPS' }
    : manualCoords
      ? { latitude: manualCoords.latitude, longitude: manualCoords.longitude, isLiveGps: false, label: `Manual Entry: ${manualCoords.label}` }
      : null;

  const searchPlaces = async (lat: number, lng: number, cat: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/places/nearby?lat=${lat}&lng=${lng}&category=${cat}&radius=5000`);
      setPlaces(res.places || []);
    } catch (err: any) {
      setError(err.message || 'Nearby places search failed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeCoords) {
      searchPlaces(activeCoords.latitude, activeCoords.longitude, category);
    }
  }, [activeCoords?.latitude.toFixed(3), activeCoords?.longitude.toFixed(3), category]);

  const handleManualSearch = async () => {
    if (manualQuery.trim().length < 3) return;
    try {
      const res = await apiFetch(`/api/places/search?q=${encodeURIComponent(manualQuery.trim())}`);
      setManualResults(res.results || []);
    } catch {
      setManualResults([]);
    }
  };

  const locStatus = getLocationStateLabel(gps.state);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">City Map &amp; Nearby Location Intelligence</h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Real-world facilities queried strictly from your live GPS coordinates via OpenStreetMap Overpass API.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-slate-700">{locStatus.label}</span>
          {gps.location && (
            <span className="font-mono text-slate-500 tabular-nums">
              (±{Math.round(gps.location.accuracy)}m)
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setManualCoords(null);
              gps.startTracking();
            }}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#14532D] text-white font-semibold"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh GPS
          </button>
        </div>
      </div>

      {gps.errorMessage && !manualCoords && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 space-y-3 text-xs text-red-900">
          <div className="font-bold">Nearby places cannot be calculated accurately without GPS</div>
          <p>{gps.errorMessage}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={gps.startTracking}
              className="px-4 py-2 rounded-lg bg-red-700 text-white font-semibold"
            >
              Retry Live GPS
            </button>
            <button
              type="button"
              onClick={() => setManualOpen(true)}
              className="px-4 py-2 rounded-lg border border-red-300 bg-white text-red-900 font-semibold"
            >
              Use Manual Location Search (Alternative)
            </button>
          </div>
        </div>
      )}

      {manualOpen && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
          <div className="text-xs font-semibold text-amber-900">
            Manual Location Search (Clearly labelled alternative — not live GPS)
          </div>
          <div className="flex gap-2">
            <input
              value={manualQuery}
              onChange={(e) => setManualQuery(e.target.value)}
              placeholder="Enter Indian city, neighborhood, or landmark..."
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
            />
            <button
              type="button"
              onClick={handleManualSearch}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold"
            >
              <Search className="h-3.5 w-3.5" />
              Search
            </button>
          </div>
          {manualResults.map((r, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setManualCoords({ latitude: r.latitude, longitude: r.longitude, label: r.displayName });
                setManualResults([]);
              }}
              className="block w-full text-left p-2 rounded bg-white border border-slate-200 text-xs hover:border-[#14532D]"
            >
              {r.displayName}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {PLACE_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setCategory(f.key)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              category === f.key
                ? 'bg-[#14532D] text-white border-[#14532D]'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6">
          <LiveMap
            center={activeCoords ? { latitude: activeCoords.latitude, longitude: activeCoords.longitude } : null}
            accuracyMeters={gps.location?.accuracy}
            markers={places.map((p) => ({
              id: p.id,
              latitude: p.latitude,
              longitude: p.longitude,
              title: p.name,
              subtitle: `${p.category} · ${formatDistance(p.distanceMeters)}`,
              kind:
                category === 'hospital' || category === 'ambulance'
                  ? 'hospital'
                  : category === 'police'
                    ? 'police'
                    : 'place',
              navigationUrl: p.navigationUrl,
            }))}
            heightClass="h-[440px]"
          />
        </div>

        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">
              Closest Results ({places.length})
            </h3>
            {activeCoords && (
              <span className="text-[11px] font-mono text-slate-500">
                {activeCoords.label}
              </span>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex justify-between">
              <span>{error}</span>
              {activeCoords && (
                <button
                  type="button"
                  onClick={() => searchPlaces(activeCoords.latitude, activeCoords.longitude, category)}
                  className="font-semibold underline"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {!activeCoords ? (
            <div className="text-xs text-slate-500 py-8 text-center">
              Waiting for live GPS coordinates to query nearby places...
            </div>
          ) : loading ? (
            <div className="text-xs text-slate-500 py-8 text-center">
              Fetching real facilities from OpenStreetMap around your location...
            </div>
          ) : places.length === 0 ? (
            <div className="text-xs text-slate-500 py-8 text-center">
              No facilities returned by OpenStreetMap within 5 km for this category.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
              {places.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-200 p-3 text-xs space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm text-slate-900">{p.name}</div>
                      <div className="text-slate-500">{p.category} · {p.address}</div>
                    </div>
                    <span className="font-mono font-bold text-[#14532D] shrink-0 tabular-nums">
                      {formatDistance(p.distanceMeters)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-500">
                    <span>
                      Source: {p.source}
                      {p.phone ? ` · Tel: ${p.phone}` : ''}
                      {p.openingHours ? ` · Hours: ${p.openingHours}` : ''}
                    </span>
                    <a
                      href={p.navigationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-[#14532D] hover:underline"
                    >
                      <Navigation className="h-3 w-3" />
                      Navigate
                    </a>
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
