import {
  AlertOctagon,
  CheckCircle2,
  Copy,
  Edit2,
  Mic,
  MicOff,
  Navigation,
  PhoneCall,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LiveMap } from '../LiveMap.tsx';
import { OtpVerificationPanel } from '../OtpVerificationPanel.tsx';
import { getLocationStateLabel, useLiveLocation } from '../../hooks/useLiveLocation.ts';
import { apiFetch, formatDateTime, formatDistance } from '../../lib/api.ts';
import type { AuthUser, NearbyPlace, UserProfile } from '../../types/seva.ts';

interface SevaShieldModuleProps {
  user: AuthUser;
  profile: UserProfile | null;
  wsSignal: number;
}

export function SevaShieldModule({ user, profile, wsSignal }: SevaShieldModuleProps) {
  const gps = useLiveLocation(false);

  const [contacts, setContacts] = useState<any[]>([]);
  const [sosHistory, setSosHistory] = useState<any[]>([]);
  const [caregiverAlerts, setCaregiverAlerts] = useState<any[]>([]);
  const [nearbyPolice, setNearbyPolice] = useState<NearbyPlace[]>([]);
  const [loadingPolice, setLoadingPolice] = useState(false);

  // Add / Edit contact form
  const [showAddContact, setShowAddContact] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [cOriginalPhone, setCOriginalPhone] = useState('');
  const [cOriginalVerified, setCOriginalVerified] = useState(false);
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cRel, setCRel] = useState('Family');
  const [cConsent, setCConsent] = useState(false);
  const [cCaregiverConsent, setCCaregiverConsent] = useState(false);
  const [cPhoneProof, setCPhoneProof] = useState<{ challengeId: string; verificationToken: string } | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [savingContact, setSavingContact] = useState(false);

  // SOS hold & countdown state
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [pendingTriggerMethod, setPendingTriggerMethod] = useState<'button' | 'voice'>('button');
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Alarm Web Audio
  const [alarmPlaying, setAlarmPlaying] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const alarmPulseRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Voice protection
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState<'en-IN' | 'hi-IN'>(profile?.voice_language || 'en-IN');
  const [customPhrase, setCustomPhrase] = useState(profile?.voice_custom_phrase || '');
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const [copiedLink, setCopiedLink] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadAll = async () => {
    try {
      const [cRes, sRes, cgRes] = await Promise.all([
        apiFetch('/api/seva-shield/contacts'),
        apiFetch('/api/seva-shield/sos/my'),
        apiFetch('/api/seva-shield/caregiver-alerts'),
      ]);
      setContacts(cRes.contacts || []);
      setSosHistory(sRes.events || []);
      setCaregiverAlerts(cgRes.alerts || []);
    } catch {
      // handled gracefully
    }
  };

  useEffect(() => {
    loadAll();
  }, [wsSignal]);

  const activeSos = sosHistory.find((s) => s.status !== 'SAFE_RESOLVED') || null;

  // Stream live GPS location updates every time watchPosition updates during active SOS
  const lastSentAtRef = useRef<number>(0);
  useEffect(() => {
    if (!activeSos) return;
    if (!gps.isWatching) {
      gps.startTracking();
    }
    if (gps.location && Date.now() - lastSentAtRef.current >= 3000) {
      lastSentAtRef.current = Date.now();
      apiFetch(`/api/seva-shield/sos/${activeSos.id}/location`, {
        method: 'POST',
        body: JSON.stringify({
          latitude: gps.location.latitude,
          longitude: gps.location.longitude,
          accuracyMeters: gps.location.accuracy,
          heading: gps.location.heading,
          speed: gps.location.speed,
        }),
      }).catch(() => {});
    }
  }, [activeSos?.id, gps.location?.timestamp]);

  // Fetch real nearby police stations when GPS acquired
  useEffect(() => {
    if (!gps.location) return;
    setLoadingPolice(true);
    apiFetch(`/api/places/nearby?lat=${gps.location.latitude}&lng=${gps.location.longitude}&category=police&radius=6000`)
      .then((res) => setNearbyPolice(res.places || []))
      .catch(() => {})
      .finally(() => setLoadingPolice(false));
  }, [gps.location?.latitude.toFixed(3), gps.location?.longitude.toFixed(3)]);

  const startAlarm = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 880;
      gain.gain.value = 0.25;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      audioCtxRef.current = ctx;
      oscRef.current = osc;
      setAlarmPlaying(true);

      let high = true;
      alarmPulseRef.current = setInterval(() => {
        high = !high;
        osc.frequency.setValueAtTime(high ? 920 : 620, ctx.currentTime);
      }, 350);
    } catch {
      // Browser audio permission blocked
    }
  };

  const stopAlarm = () => {
    if (alarmPulseRef.current) clearInterval(alarmPulseRef.current);
    try {
      oscRef.current?.stop();
      audioCtxRef.current?.close();
    } catch {
      // ignore
    }
    oscRef.current = null;
    audioCtxRef.current = null;
    setAlarmPlaying(false);
  };

  useEffect(() => {
    return () => {
      stopAlarm();
      if (holdTimerRef.current) clearInterval(holdTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      recognitionRef.current?.stop();
    };
  }, []);

  const triggerSosActivation = async (method: 'button' | 'voice' | 'manual') => {
    setActionError(null);
    if (!gps.isWatching) gps.startTracking();
    startAlarm();

    try {
      await apiFetch('/api/seva-shield/sos/activate', {
        method: 'POST',
        body: JSON.stringify({
          triggerMethod: method,
          latitude: gps.location?.latitude ?? null,
          longitude: gps.location?.longitude ?? null,
          accuracyMeters: gps.location?.accuracy ?? null,
        }),
      });
      await loadAll();
    } catch (err: any) {
      await loadAll();
      setActionError(err.message || 'SOS activation failed.');
    }
  };

  const beginFiveSecondCountdown = (method: 'button' | 'voice') => {
    if (activeSos || countdown !== null) return;
    if (!gps.isWatching) gps.startTracking();
    setPendingTriggerMethod(method);
    setCountdown(5);
    let sec = 5;
    countdownTimerRef.current = setInterval(() => {
      sec -= 1;
      if (sec <= 0) {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        setCountdown(null);
        triggerSosActivation(method);
      } else {
        setCountdown(sec);
      }
    }, 1000);
  };

  const cancelCountdown = () => {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = null;
    setCountdown(null);
  };

  const startHoldSos = () => {
    if (activeSos || countdown !== null) return;
    setHoldProgress(0);
    const start = Date.now();
    holdTimerRef.current = setInterval(() => {
      const pct = Math.min(100, Math.round(((Date.now() - start) / 2000) * 100));
      setHoldProgress(pct);
      if (pct >= 100) {
        if (holdTimerRef.current) clearInterval(holdTimerRef.current);
        holdTimerRef.current = null;
        setHoldProgress(0);
        beginFiveSecondCountdown('button');
      }
    }, 50);
  };

  const cancelHoldSos = () => {
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldProgress(0);
  };

  const handleMarkSafe = async () => {
    if (!activeSos) return;
    stopAlarm();
    gps.stopTracking();
    try {
      await apiFetch(`/api/seva-shield/sos/${activeSos.id}/safe`, { method: 'POST' });
      await loadAll();
    } catch (err: any) {
      setActionError(err.message || 'Could not update safe status.');
    }
  };

  const retryDelivery = async (notifId: string) => {
    try {
      await apiFetch(`/api/seva-shield/sos/notifications/${notifId}/retry`, { method: 'POST' });
      await loadAll();
    } catch (err: any) {
      setActionError(err.message || 'Retry failed.');
    }
  };

  const resetContactForm = () => {
    setEditingContactId(null);
    setCOriginalPhone('');
    setCOriginalVerified(false);
    setCName('');
    setCPhone('');
    setCEmail('');
    setCRel('Family');
    setCConsent(false);
    setCCaregiverConsent(false);
    setCPhoneProof(null);
    setContactError(null);
    setShowAddContact(false);
  };

  const openEditContact = (c: any) => {
    setEditingContactId(c.id);
    setCOriginalPhone(c.phone || '');
    setCOriginalVerified(Boolean(c.phone_verified));
    setCName(c.name || '');
    setCPhone(c.phone || '');
    setCEmail(c.email || '');
    setCRel(c.relationship || 'Family');
    setCConsent(Boolean(c.location_consent));
    setCCaregiverConsent(Boolean(c.caregiver_consent ?? c.location_consent));
    setCPhoneProof(null);
    setContactError(null);
    setShowAddContact(true);
  };

  const needsCaregiverOtp =
    !editingContactId || !cOriginalVerified || cPhone.trim() !== cOriginalPhone.trim();

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactError(null);
    if (!cConsent || !cCaregiverConsent) {
      setContactError('Both citizen location-sharing consent and caregiver contact consent are required.');
      return;
    }
    if (needsCaregiverOtp && !cPhoneProof) {
      setContactError('Please verify the caregiver mobile number with OTP before saving.');
      return;
    }

    setSavingContact(true);
    try {
      if (editingContactId) {
        await apiFetch(`/api/seva-shield/contacts/${editingContactId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: cName,
            phone: cPhone,
            email: cEmail,
            relationship: cRel,
            isCaregiver: true,
            locationConsent: cConsent,
            caregiverConsent: cCaregiverConsent,
            phoneChallengeId: cPhoneProof?.challengeId,
            phoneVerificationToken: cPhoneProof?.verificationToken,
          }),
        });
      } else {
        await apiFetch('/api/seva-shield/contacts', {
          method: 'POST',
          body: JSON.stringify({
            name: cName,
            phone: cPhone,
            email: cEmail,
            relationship: cRel,
            isCaregiver: true,
            locationConsent: cConsent,
            caregiverConsent: cCaregiverConsent,
            phoneChallengeId: cPhoneProof!.challengeId,
            phoneVerificationToken: cPhoneProof!.verificationToken,
          }),
        });
      }
      resetContactForm();
      await loadAll();
    } catch (err: any) {
      setContactError(err.message || 'Failed to save emergency contact.');
    } finally {
      setSavingContact(false);
    }
  };

  const handleDeleteContact = async (id: string) => {
    await apiFetch(`/api/seva-shield/contacts/${id}`, { method: 'DELETE' });
    if (editingContactId === id) {
      resetContactForm();
    }
    await loadAll();
  };

  const startVoiceProtection = () => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      setVoiceStatus('Web Speech API is not supported in this browser. Use Chrome or Android Chrome for voice triggers.');
      return;
    }
    try {
      const rec = new SpeechRec();
      rec.lang = voiceLang;
      rec.continuous = true;
      rec.interimResults = true;

      rec.onstart = () => {
        setVoiceListening(true);
        setVoiceStatus(`Listening (${voiceLang}). Say "Help me Seva"${voiceLang === 'hi-IN' ? ' or "Seva madad karo"' : ''}.`);
      };

      rec.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((r: any) => r[0].transcript)
          .join(' ')
          .toLowerCase();

        const triggers = ['help me seva', 'seva madad karo', 'सेवा मदद करो'];
        if (customPhrase.trim()) triggers.push(customPhrase.trim().toLowerCase());

        if (triggers.some((t) => transcript.includes(t))) {
          setVoiceStatus(`Trigger phrase detected: "${transcript.slice(-40)}". Starting SOS countdown!`);
          beginFiveSecondCountdown('voice');
        }
      };

      rec.onerror = (e: any) => {
        setVoiceStatus(`Voice recognition error: ${e.error}. Click Start Voice Protection to resume.`);
        setVoiceListening(false);
      };

      rec.onend = () => {
        setVoiceListening(false);
      };

      recognitionRef.current = rec;
      rec.start();
    } catch (err: any) {
      setVoiceStatus(err?.message || 'Unable to start microphone voice protection.');
    }
  };

  const stopVoiceProtection = () => {
    recognitionRef.current?.stop();
    setVoiceListening(false);
    setVoiceStatus('Voice protection stopped.');
  };

  const locStatus = getLocationStateLabel(gps.state);
  const trackingUrl = activeSos?.tracking_token ? `${window.location.origin}/track/${activeSos.tracking_token}` : null;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-red-700">SEVA SHIELD</div>
          <h2 className="text-xl font-bold text-slate-900">Your Personal Safety &amp; Emergency Companion</h2>
          <p className="text-xs text-slate-600 mt-0.5">
            2-second SOS activation, live GPS caregiver tracking, audio alarm, and voice trigger protection.
          </p>
        </div>
        <div className="text-xs font-semibold text-slate-700">
          Safety Status:{' '}
          <span className={activeSos ? 'text-red-700' : 'text-emerald-700'}>
            {activeSos ? `ACTIVE EMERGENCY (${activeSos.emergency_code})` : 'Protected / Standby'}
          </span>
        </div>
      </div>

      {/* Countdown Overlay Banner */}
      {countdown !== null && (
        <div className="rounded-xl border-2 border-red-600 bg-red-50 p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-lg font-bold text-red-800">
              SOS Triggering in <span className="font-mono text-2xl tabular-nums">{countdown}s</span> ({pendingTriggerMethod})
            </div>
            <p className="text-xs text-red-700">
              Emergency contacts, linked caregivers, and Police Control Room will receive your live GPS coordinates.
            </p>
          </div>
          <button
            type="button"
            onClick={cancelCountdown}
            className="px-6 py-3 text-sm font-bold rounded-lg bg-slate-900 text-white hover:bg-slate-800"
          >
            CANCEL SOS
          </button>
        </div>
      )}

      {/* Active SOS Command Banner */}
      {activeSos && (
        <div className="rounded-xl border-2 border-red-600 bg-red-50 p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-mono font-bold text-red-700">
                EMERGENCY ACTIVE · {activeSos.emergency_code} · {activeSos.status}
              </div>
              <h3 className="text-lg font-bold text-red-950 mt-0.5">
                Live GPS Sharing &amp; Authority Response Active
              </h3>
              {activeSos.acknowledged_at && (
                <p className="text-xs font-semibold text-emerald-800 mt-1">
                  Acknowledged by {activeSos.acknowledged_by_name || 'Authority Officer'} at{' '}
                  {formatDateTime(activeSos.acknowledged_at)}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {alarmPlaying ? (
                <button
                  type="button"
                  onClick={stopAlarm}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold rounded-lg border border-red-300 bg-white text-red-800"
                >
                  <VolumeX className="h-4 w-4" />
                  Stop Alarm
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startAlarm}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold rounded-lg border border-red-300 bg-white text-red-800"
                >
                  <Volume2 className="h-4 w-4" />
                  Sound Alarm
                </button>
              )}
              <button
                type="button"
                onClick={handleMarkSafe}
                className="inline-flex items-center gap-1.5 px-6 py-3 text-sm font-bold rounded-lg bg-[#14532D] text-white hover:bg-[#166534]"
              >
                <CheckCircle2 className="h-4 w-4" />
                I&apos;m Safe — End Emergency
              </button>
            </div>
          </div>

          {trackingUrl && (
            <div className="rounded-lg bg-white border border-red-200 p-3 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-semibold text-slate-800">Secure Caregiver Tracking URL:</span>{' '}
                  <code className="font-mono text-red-800 break-all">{trackingUrl}</code>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(trackingUrl);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 1800);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-slate-900 text-white font-semibold shrink-0"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copiedLink ? 'Copied' : 'Copy Link'}
                </button>
              </div>
              {activeSos.latest_latitude != null && activeSos.latest_longitude != null ? (
                <div className="text-slate-700">
                  <span className="font-semibold">Live Google Maps Coordinates:</span>{' '}
                  <a
                    href={`https://maps.google.com/?q=${Number(activeSos.latest_latitude).toFixed(6)},${Number(activeSos.latest_longitude).toFixed(6)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[#14532D] underline"
                  >
                    https://maps.google.com/?q={Number(activeSos.latest_latitude).toFixed(6)},{Number(activeSos.latest_longitude).toFixed(6)}
                  </a>
                </div>
              ) : (
                <div className="text-amber-800 font-medium">
                  Live GPS location could not be obtained from device — SOS alert sent without coordinates. Enable GPS permissions to stream coordinates automatically.
                </div>
              )}
            </div>
          )}

          {/* Alert Delivery Statuses */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-red-900">Alert Delivery Statuses</div>
            {activeSos.deliveries?.length === 0 ? (
              <div className="text-xs text-red-800">
                No emergency contacts saved yet. Authority Command Center has been notified.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {activeSos.deliveries?.map((del: any) => (
                  <div
                    key={del.id}
                    className="rounded-lg bg-white border border-red-200 p-2.5 text-xs flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">
                        {del.recipient_name} ({del.channel.toUpperCase()})
                      </div>
                      <div className="text-slate-600">
                        Status: <strong>{del.status}</strong> · {del.provider}
                        {del.error_message ? ` (${del.error_message})` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {(del.status === 'FAILED' || del.status === 'NOT_CONFIGURED') && del.channel !== 'in_app' && (
                        <>
                          <button
                            type="button"
                            onClick={() => retryDelivery(del.id)}
                            className="px-2 py-1 rounded bg-slate-900 text-white font-semibold"
                          >
                            Retry
                          </button>
                          {del.recipient_phone && (
                            <a
                              href={`sms:${del.recipient_phone}?body=${encodeURIComponent(del.payload_text || 'EMERGENCY SOS')}`}
                              className="px-2 py-1 rounded border border-slate-300 text-slate-800 font-semibold"
                            >
                              SMS App
                            </a>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          {actionError}
        </div>
      )}

      {/* SOS Button + Voice Protection + Live GPS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 flex flex-col items-center justify-center text-center space-y-5">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-900">Emergency SOS Trigger</h3>
            <p className="text-xs text-slate-500">
              Press and hold for 2 seconds to start the 5-second cancellable emergency countdown.
            </p>
          </div>

          <button
            type="button"
            disabled={Boolean(activeSos) || countdown !== null}
            onMouseDown={startHoldSos}
            onMouseUp={cancelHoldSos}
            onMouseLeave={cancelHoldSos}
            onTouchStart={startHoldSos}
            onTouchEnd={cancelHoldSos}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') beginFiveSecondCountdown('button');
            }}
            className="relative w-44 h-44 rounded-full bg-red-600 hover:bg-red-700 active:scale-95 disabled:opacity-50 text-white shadow-lg flex flex-col items-center justify-center gap-1.5 transition-transform select-none"
          >
            <AlertOctagon className="h-10 w-10" />
            <span className="text-xl font-extrabold tracking-wide">SOS</span>
            <span className="text-[11px] font-medium text-red-100">
              {holdProgress > 0 ? `Holding ${holdProgress}%` : 'Hold 2 Seconds'}
            </span>
          </button>

          <div className="w-full pt-3 border-t border-slate-200 text-left space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-900">Voice-Activated Emergency Protection</div>
              <span className={`text-xs font-semibold ${voiceListening ? 'text-emerald-700' : 'text-slate-500'}`}>
                {voiceListening ? 'Listening' : 'Inactive'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={voiceLang}
                onChange={(e) => setVoiceLang(e.target.value as 'en-IN' | 'hi-IN')}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
              >
                <option value="en-IN">English (en-IN): &quot;Help me Seva&quot;</option>
                <option value="hi-IN">Hindi (hi-IN): &quot;Seva madad karo&quot;</option>
              </select>
              <input
                value={customPhrase}
                onChange={(e) => setCustomPhrase(e.target.value)}
                placeholder="Custom trigger phrase"
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>

            <div className="flex gap-2">
              {!voiceListening ? (
                <button
                  type="button"
                  onClick={startVoiceProtection}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-[#14532D] text-white"
                >
                  <Mic className="h-3.5 w-3.5" />
                  Start Voice Protection
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopVoiceProtection}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white"
                >
                  <MicOff className="h-3.5 w-3.5" />
                  Stop Voice Protection
                </button>
              )}
            </div>

            {voiceStatus && <p className="text-[11px] text-slate-700">{voiceStatus}</p>}
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
              Browser limitation notice: Web-based GPS and voice recognition cannot guarantee continuous operation when
              the browser is closed or the device screen is locked.
            </p>
          </div>
        </div>

        {/* Live GPS Map + Nearby Police Stations */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900">Live Location Sharing &amp; Nearby Police</h3>
              <p className="text-xs text-slate-500">
                Status: <strong>{locStatus.label}</strong>
                {gps.location ? ` · Accuracy ±${Math.round(gps.location.accuracy)}m` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={gps.isWatching ? gps.stopTracking : gps.startTracking}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#14532D] text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {gps.isWatching ? 'Stop Live GPS' : 'Start Live GPS'}
            </button>
          </div>

          {gps.errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex justify-between items-center">
              <span>{gps.errorMessage}</span>
              <button type="button" onClick={gps.startTracking} className="font-semibold underline">
                Retry
              </button>
            </div>
          )}

          <LiveMap
            center={gps.location ? { latitude: gps.location.latitude, longitude: gps.location.longitude } : null}
            accuracyMeters={gps.location?.accuracy}
            markers={nearbyPolice.map((p) => ({
              id: p.id,
              latitude: p.latitude,
              longitude: p.longitude,
              title: p.name,
              subtitle: `Police · ${formatDistance(p.distanceMeters)}`,
              kind: 'police',
              navigationUrl: p.navigationUrl,
            }))}
            heightClass="h-64"
          />

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-800">
              Nearby Police Stations (Real OpenStreetMap Data)
            </div>
            {!gps.location ? (
              <div className="text-xs text-slate-500">
                Click &quot;Start Live GPS&quot; to detect your actual coordinates and locate nearest police stations.
              </div>
            ) : loadingPolice ? (
              <div className="text-xs text-slate-500">Querying nearby police stations...</div>
            ) : nearbyPolice.length === 0 ? (
              <div className="text-xs text-slate-500">No police stations returned in 6 km radius.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {nearbyPolice.slice(0, 4).map((p) => (
                  <div key={p.id} className="rounded-lg border border-slate-200 p-2.5 text-xs flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">{p.name}</div>
                      <div className="text-slate-500 truncate">
                        {formatDistance(p.distanceMeters)} · {p.address}
                      </div>
                    </div>
                    <a
                      href={p.navigationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-[#14532D] shrink-0"
                    >
                      <Navigation className="h-3 w-3" />
                      Go
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Emergency Contacts (Max 5) & Caregiver Connections */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Emergency Contacts &amp; Caregivers ({contacts.length} / 5)
              </h3>
              <p className="text-xs text-slate-500">
                Registered SEVA AI contacts automatically receive in-website alerts alongside SMS/email notifications.
              </p>
            </div>
            {(contacts.length < 5 || editingContactId) && (
              <button
                type="button"
                onClick={() => {
                  if (showAddContact) {
                    resetContactForm();
                  } else {
                    setShowAddContact(true);
                  }
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#14532D] text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                {showAddContact ? 'Close Form' : 'Add Contact'}
              </button>
            )}
          </div>

          {showAddContact && (
            <form onSubmit={handleSaveContact} className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="text-xs font-bold text-slate-800">
                {editingContactId ? 'Update Caregiver Contact' : 'Link New Verified Emergency Caregiver'}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  required
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  placeholder="Contact Full Name"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                />
                <input
                  required
                  type="tel"
                  value={cPhone}
                  onChange={(e) => {
                    setCPhone(e.target.value);
                    setCPhoneProof(null);
                  }}
                  placeholder="Caregiver Phone Number (e.g. +919876543210)"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono"
                />
                <input
                  type="email"
                  value={cEmail}
                  onChange={(e) => setCEmail(e.target.value)}
                  placeholder="Email (optional)"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                />
                <input
                  required
                  value={cRel}
                  onChange={(e) => setCRel(e.target.value)}
                  placeholder="Relationship (e.g. Mother, Sister)"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                />
              </div>

              {needsCaregiverOtp ? (
                <OtpVerificationPanel
                  channel="phone"
                  purpose="caregiver_phone"
                  target={cPhone}
                  label="Caregiver Mobile OTP Verification (Required before SOS alerts can be sent)"
                  verified={Boolean(cPhoneProof)}
                  onVerified={setCPhoneProof}
                />
              ) : (
                <div className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  Caregiver mobile number ({cPhone}) is OTP-verified.
                </div>
              )}

              <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cConsent}
                  onChange={(e) => setCConsent(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-[#14532D]"
                />
                <span>I consent to share my live GPS location and SOS alerts with this trusted contact.</span>
              </label>

              <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cCaregiverConsent}
                  onChange={(e) => setCCaregiverConsent(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-[#14532D]"
                />
                <span>I confirm the caregiver has consented to receive emergency SMS alerts and tracking links.</span>
              </label>

              {contactError && <div className="text-xs font-medium text-red-700">{contactError}</div>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={resetContactForm}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingContact}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#14532D] text-white disabled:opacity-50"
                >
                  {savingContact ? 'Saving...' : editingContactId ? 'Update Contact' : 'Save Contact'}
                </button>
              </div>
            </form>
          )}

          {contacts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
              No emergency contacts added yet. Add up to 5 trusted contacts or caregivers.
            </div>
          ) : (
            <div className="space-y-2">
              {contacts.map((c) => (
                <div key={c.id} className="rounded-lg border border-slate-200 p-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {c.name} <span className="text-xs font-normal text-slate-500">· {c.relationship}</span>
                      </span>
                      {c.phone_verified ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          OTP Verified
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                          Unverified (SOS SMS withheld — Edit to verify)
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-mono text-slate-600 mt-0.5">
                      {c.phone}
                      {c.email ? ` · ${c.email}` : ''}
                    </div>
                    <div className="text-[11px] text-emerald-700 mt-0.5">
                      {c.linked_user_id
                        ? `Caregiver SEVA AI account linked (${c.linked_user_name})`
                        : 'External SMS/Email alert recipient'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditContact(c)}
                      className="p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                      title={c.phone_verified ? 'Edit contact' : 'Verify & edit contact'}
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <a
                      href={`tel:${c.phone}`}
                      className="p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                      title="Call contact"
                    >
                      <PhoneCall className="h-4 w-4" />
                    </a>
                    <button
                      type="button"
                      onClick={() => handleDeleteContact(c.id)}
                      className="p-2 rounded-lg border border-slate-200 text-red-600 hover:bg-red-50"
                      title="Delete contact"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Caregiver Incoming SOS Alerts + Personal SOS History */}
        <div className="lg:col-span-5 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h3 className="text-base font-bold text-slate-900">Caregiver Connections (Incoming Alerts)</h3>
            {caregiverAlerts.length === 0 ? (
              <p className="text-xs text-slate-500">
                No SOS alerts from citizens who linked your mobile number ({user.phone}) as a caregiver.
              </p>
            ) : (
              <div className="space-y-2">
                {caregiverAlerts.map((a) => (
                  <div key={a.id} className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs space-y-1">
                    <div className="flex justify-between font-bold text-red-900">
                      <span>{a.citizen_name} ({a.emergency_code})</span>
                      <span>{a.status}</span>
                    </div>
                    <div className="text-slate-700">Started: {formatDateTime(a.created_at)}</div>
                    {a.tracking_token && (
                      <a
                        href={`/track/${a.tracking_token}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block font-semibold text-[#14532D] underline"
                      >
                        Open Live Caregiver Map &rarr;
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h3 className="text-base font-bold text-slate-900">Your SOS History</h3>
            {sosHistory.length === 0 ? (
              <p className="text-xs text-slate-500">No SOS activations recorded on your account.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {sosHistory.map((ev) => (
                  <div key={ev.id} className="rounded-lg border border-slate-200 p-2.5 text-xs space-y-0.5">
                    <div className="flex justify-between font-semibold">
                      <span className="font-mono text-slate-900">{ev.emergency_code}</span>
                      <span className={ev.status === 'SAFE_RESOLVED' ? 'text-emerald-700' : 'text-red-700'}>
                        {ev.status}
                      </span>
                    </div>
                    <div className="text-slate-500">
                      Triggered via {ev.trigger_method} · {formatDateTime(ev.created_at)}
                    </div>
                    {ev.resolved_at && (
                      <div className="text-emerald-700">Marked Safe: {formatDateTime(ev.resolved_at)}</div>
                    )}
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
