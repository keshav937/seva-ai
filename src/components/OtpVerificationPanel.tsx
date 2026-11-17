import { Check, Copy, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';

interface OtpVerificationPanelProps {
  channel: 'phone' | 'email';
  target: string;
  purpose: 'register_phone' | 'register_email' | 'login_phone' | 'reset_password' | 'verify_phone' | 'authority_login' | 'caregiver_phone';
  label: string;
  onVerified: (result: { challengeId: string; verificationToken: string; otp: string }) => void;
  verified?: boolean;
  hideVerifyButtonForDirectLogin?: boolean;
  onChallengeCreated?: (challengeId: string) => void;
  onOtpChange?: (otp: string) => void;
}

export function OtpVerificationPanel({
  channel,
  target,
  purpose,
  label,
  onVerified,
  verified = false,
  hideVerifyButtonForDirectLogin = false,
  onChallengeCreated,
  onOtpChange,
}: OtpVerificationPanelProps) {
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [requestedTarget, setRequestedTarget] = useState<string>('');
  const [otpInput, setOtpInput] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [mode, setMode] = useState<'development' | 'production'>('development');
  const [deliveryInfo, setDeliveryInfo] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!expiresAt && !resendAt) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt, resendAt]);

  useEffect(() => {
    if (challengeId && !verified && target.trim() !== requestedTarget) {
      setChallengeId(null);
      setOtpInput('');
      setDevOtp(null);
      setDeliveryInfo(null);
      setError(null);
    }
  }, [target, challengeId, verified, requestedTarget]);

  const expirySeconds = expiresAt ? Math.max(0, Math.ceil((expiresAt - nowMs) / 1000)) : 0;
  const resendSeconds = resendAt ? Math.max(0, Math.ceil((resendAt - nowMs) / 1000)) : 0;

  const handleRequestOtp = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/otp/request', {
        method: 'POST',
        body: JSON.stringify({ channel, target, purpose }),
      });
      setChallengeId(res.challengeId);
      setRequestedTarget(target.trim());
      setMode(res.mode);
      setDevOtp(res.devOtp || null);
      setExpiresAt(new Date(res.expiresAt).getTime());
      setResendAt(new Date(res.resendAvailableAt).getTime());
      onChallengeCreated?.(res.challengeId);

      if (res.deliveryStatus === 'ACCEPTED_BY_PROVIDER' || res.deliveryStatus === 'DELIVERED') {
        setDeliveryInfo(`OTP accepted by ${res.deliveryProvider} for delivery to ${res.target}.`);
      } else if (res.mode === 'development') {
        setDeliveryInfo(
          res.deliveryStatus === 'NOT_CONFIGURED'
            ? `Demo Mode: ${channel === 'phone' ? 'SMS' : 'Email'} gateway not configured (no external message sent). Use the Demo Testing OTP below.`
            : res.deliveryError
              ? `Demo Mode active (provider notice: ${res.deliveryError}). Use the Demo Testing OTP below.`
              : 'Demo Mode active. Use the Demo Testing OTP below.'
        );
      }
    } catch (err: any) {
      setError(err.message || 'Failed to request OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!challengeId) return;
    setError(null);
    setVerifying(true);
    try {
      const res = await apiFetch('/api/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId, otp: otpInput.trim() }),
      });
      onVerified({ challengeId, verificationToken: res.verificationToken, otp: otpInput.trim() });
    } catch (err: any) {
      setError(err.message || 'OTP verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const copyDevOtp = () => {
    if (!devOtp) return;
    navigator.clipboard?.writeText(devOtp);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-slate-800">{label}</div>
        {verified ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <ShieldCheck className="h-4 w-4" />
            Verified
          </span>
        ) : (
          <button
            type="button"
            disabled={loading || !target.trim() || resendSeconds > 0}
            onClick={handleRequestOtp}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-[#14532D] text-white hover:bg-[#166534] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : challengeId ? 'Resend OTP' : 'Send OTP'}
          </button>
        )}
      </div>

      {deliveryInfo && !verified && (
        <p className="text-xs text-slate-600">{deliveryInfo}</p>
      )}

      {/* Website-visible Demo OTP panel strictly in server-enforced Development / Demo Mode */}
      {mode === 'development' && devOtp && !verified && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-amber-900">
              DEMO / TESTING OTP (Not delivered externally in Demo Mode)
            </span>
            <button
              type="button"
              onClick={copyDevOtp}
              className="inline-flex items-center gap-1 text-xs font-semibold text-amber-900 hover:underline whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy OTP'}
            </button>
          </div>
          <div className="flex items-center justify-between">
            <code className="font-mono text-lg font-bold tracking-widest text-slate-900 tabular-nums">
              {devOtp}
            </code>
            <span className="text-xs font-mono text-amber-800 tabular-nums">
              Expires in {Math.floor(expirySeconds / 60)}:{String(expirySeconds % 60).padStart(2, '0')}
            </span>
          </div>
        </div>
      )}

      {challengeId && !verified && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otpInput}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, '').slice(0, 6);
              setOtpInput(val);
              onOtpChange?.(val);
            }}
            placeholder="Enter 6-digit OTP"
            className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono tracking-widest focus:border-[#14532D] focus:outline-none"
          />
          {!hideVerifyButtonForDirectLogin && (
            <button
              type="button"
              disabled={verifying || otpInput.length !== 6}
              onClick={handleVerifyOtp}
              className="px-4 py-2 text-xs font-semibold rounded-md bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              {verifying ? 'Verifying...' : 'Verify OTP'}
            </button>
          )}
        </div>
      )}

      {error && <p className="text-xs font-medium text-red-700">{error}</p>}
    </div>
  );
}
