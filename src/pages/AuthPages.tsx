import { ArrowLeft, Lock, UserCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { OtpVerificationPanel } from '../components/OtpVerificationPanel.tsx';
import { SevaLogo } from '../components/SevaLogo.tsx';
import { apiFetch, navigateTo, setSessionToken } from '../lib/api.ts';
import type { AuthUser, Department } from '../types/seva.ts';

interface AuthPagesProps {
  mode: 'register' | 'login' | 'authority-login' | 'authority-register';
  onAuthenticated: (user: AuthUser) => void;
}

export function AuthPages({ mode, onAuthenticated }: AuthPagesProps) {
  if (mode === 'register') {
    return <CitizenRegisterView onAuthenticated={onAuthenticated} />;
  }
  if (mode === 'authority-login' || mode === 'authority-register') {
    return (
      <AuthorityLoginView
        initialView={mode === 'authority-register' ? 'register' : 'login'}
        onAuthenticated={onAuthenticated}
      />
    );
  }
  return <CitizenLoginView onAuthenticated={onAuthenticated} />;
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
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
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigateTo('/');
          }}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </a>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 sm:p-8 space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
            <p className="text-sm text-slate-600 mt-1">{subtitle}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

function CitizenRegisterView({ onAuthenticated }: { onAuthenticated: (u: AuthUser) => void }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [dpdpConsent, setDpdpConsent] = useState(false);

  const [phoneProof, setPhoneProof] = useState<{ challengeId: string; verificationToken: string } | null>(null);
  const [emailProof, setEmailProof] = useState<{ challengeId: string; verificationToken: string } | null>(null);

  // Optional Emergency Caregiver Linking during registration
  const [linkCaregiver, setLinkCaregiver] = useState(false);
  const [cgName, setCgName] = useState('');
  const [cgPhone, setCgPhone] = useState('');
  const [cgRel, setCgRel] = useState('Family');
  const [cgPhoneProof, setCgPhoneProof] = useState<{ challengeId: string; verificationToken: string } | null>(null);
  const [cgLocationConsent, setCgLocationConsent] = useState(false);
  const [cgContactConsent, setCgContactConsent] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!phoneProof || !emailProof) {
      setError('Please verify both your mobile number and email address via OTP.');
      return;
    }
    if (linkCaregiver) {
      if (!cgName.trim() || !cgPhone.trim() || !cgRel.trim()) {
        setError('Please complete your caregiver name, mobile number, and relationship.');
        return;
      }
      if (!cgPhoneProof) {
        setError('Please verify your caregiver mobile number via OTP before linking.');
        return;
      }
      if (!cgLocationConsent || !cgContactConsent) {
        setError('Please confirm both location-sharing consent and caregiver contact consent.');
        return;
      }
    }
    setSubmitting(true);
    try {
      const payload: any = {
        fullName,
        email,
        phone,
        password,
        confirmPassword,
        phoneChallengeId: phoneProof.challengeId,
        phoneVerificationToken: phoneProof.verificationToken,
        emailChallengeId: emailProof.challengeId,
        emailVerificationToken: emailProof.verificationToken,
        dpdpConsent,
      };
      if (linkCaregiver && cgPhoneProof) {
        payload.caregiver = {
          name: cgName.trim(),
          phone: cgPhone.trim(),
          relationship: cgRel.trim(),
          phoneChallengeId: cgPhoneProof.challengeId,
          phoneVerificationToken: cgPhoneProof.verificationToken,
          locationConsent: cgLocationConsent,
          caregiverConsent: cgContactConsent,
        };
      }
      const res = await apiFetch('/api/auth/register/citizen', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (res.sessionToken) setSessionToken(res.sessionToken);
      onAuthenticated(res.user);
      navigateTo('/citizen');
    } catch (err: any) {
      setError(err.message || 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Citizen Registration"
      subtitle="Create your verified SEVA AI account with independent Phone & Email OTP verification."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Ananya Sharma"
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#14532D] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Mobile Number (with Country Code or 10 Digits)</label>
          <input
            required
            type="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setPhoneProof(null);
            }}
            placeholder="+91 9876543210"
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-mono focus:border-[#14532D] focus:outline-none"
          />
        </div>

        <OtpVerificationPanel
          channel="phone"
          target={phone}
          purpose="register_phone"
          label="Mobile OTP Verification"
          verified={Boolean(phoneProof)}
          onVerified={(r) => setPhoneProof({ challengeId: r.challengeId, verificationToken: r.verificationToken })}
        />

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailProof(null);
            }}
            placeholder="ananya@example.in"
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#14532D] focus:outline-none"
          />
        </div>

        <OtpVerificationPanel
          channel="email"
          target={email}
          purpose="register_email"
          label="Email OTP Verification"
          verified={Boolean(emailProof)}
          onVerified={(r) => setEmailProof({ challengeId: r.challengeId, verificationToken: r.verificationToken })}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 characters"
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#14532D] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Confirm Password</label>
            <input
              required
              type="password"
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat password"
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#14532D] focus:outline-none"
            />
          </div>
        </div>

        {/* Optional Caregiver Phone Linking */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-3">
          <label className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-800 cursor-pointer">
            <span>Link Emergency Caregiver Contact (Optional)</span>
            <input
              type="checkbox"
              checked={linkCaregiver}
              onChange={(e) => setLinkCaregiver(e.target.checked)}
              className="rounded border-slate-300 text-[#14532D]"
            />
          </label>
          <p className="text-xs text-slate-500">
            Verify a trusted family member&apos;s or caregiver&apos;s phone number via OTP so they immediately receive SOS alerts &amp; live location links.
          </p>

          {linkCaregiver && (
            <div className="space-y-3 pt-2 border-t border-slate-200">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  value={cgName}
                  onChange={(e) => setCgName(e.target.value)}
                  placeholder="Caregiver Full Name"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                />
                <input
                  value={cgRel}
                  onChange={(e) => setCgRel(e.target.value)}
                  placeholder="Relationship (e.g. Mother)"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                />
              </div>
              <input
                type="tel"
                value={cgPhone}
                onChange={(e) => {
                  setCgPhone(e.target.value);
                  setCgPhoneProof(null);
                }}
                placeholder="Caregiver Mobile (+91 98XXXXXXXX)"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono"
              />
              <OtpVerificationPanel
                channel="phone"
                target={cgPhone}
                purpose="caregiver_phone"
                label="Caregiver Mobile OTP Verification"
                verified={Boolean(cgPhoneProof)}
                onVerified={(r) => setCgPhoneProof({ challengeId: r.challengeId, verificationToken: r.verificationToken })}
              />
              <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cgLocationConsent}
                  onChange={(e) => setCgLocationConsent(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-[#14532D]"
                />
                <span>I consent to share my live GPS location with this caregiver when SOS is activated.</span>
              </label>
              <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cgContactConsent}
                  onChange={(e) => setCgContactConsent(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-[#14532D]"
                />
                <span>The caregiver has consented to receive emergency SMS &amp; tracking alerts on this mobile number.</span>
              </label>
            </div>
          )}
        </div>

        <label className="flex items-start gap-2.5 text-xs text-slate-600 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={dpdpConsent}
            onChange={(e) => setDpdpConsent(e.target.checked)}
            className="mt-0.5 rounded border-slate-300 text-[#14532D]"
          />
          <span>
            I consent to SEVA AI processing my civic reports, emergency contacts, and GPS telemetry in
            accordance with the Digital Personal Data Protection (DPDP) Act framework.
          </span>
        </label>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 text-sm font-semibold text-white bg-[#14532D] hover:bg-[#166534] rounded-lg disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Creating Verified Account...' : 'Create Citizen Account'}
        </button>

        <div className="text-center text-xs text-slate-600 pt-2">
          Already registered?{' '}
          <a
            href="/login"
            onClick={(e) => {
              e.preventDefault();
              navigateTo('/login');
            }}
            className="font-semibold text-[#14532D] hover:underline"
          >
            Sign In
          </a>
        </div>
      </form>
    </AuthShell>
  );
}

function CitizenLoginView({ onAuthenticated }: { onAuthenticated: (u: AuthUser) => void }) {
  const [tab, setTab] = useState<'password' | 'otp' | 'forgot'>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  // Phone OTP login state
  const [phone, setPhone] = useState('');
  const [otpChallengeId, setOtpChallengeId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');

  // Forgot password state
  const [resetChannel, setResetChannel] = useState<'phone' | 'email'>('email');
  const [resetTarget, setResetTarget] = useState('');
  const [resetChallengeId, setResetChallengeId] = useState<string | null>(null);
  const [resetOtp, setResetOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/login/password', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      if (res.sessionToken) setSessionToken(res.sessionToken);
      onAuthenticated(res.user);
      navigateTo('/citizen');
    } catch (err: any) {
      setError(err.message || 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpChallengeId || otpCode.length !== 6) {
      setError('Request an OTP and enter the 6-digit code.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/login/phone-otp', {
        method: 'POST',
        body: JSON.stringify({ phone, challengeId: otpChallengeId, otp: otpCode }),
      });
      if (res.sessionToken) setSessionToken(res.sessionToken);
      onAuthenticated(res.user);
      navigateTo('/citizen');
    } catch (err: any) {
      setError(err.message || 'OTP login failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetChallengeId || resetOtp.length !== 6) {
      setError('Request a verification OTP and enter the 6-digit code.');
      return;
    }
    setError(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/forgot-password/reset', {
        method: 'POST',
        body: JSON.stringify({
          target: resetTarget,
          channel: resetChannel,
          challengeId: resetChallengeId,
          otp: resetOtp,
          newPassword,
        }),
      });
      setSuccessMsg(res.message);
      setTab('password');
    } catch (err: any) {
      setError(err.message || 'Password reset failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Citizen Sign In"
      subtitle="Access your personal civic dashboard, report tracker, and Seva Shield."
    >
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
        <button
          type="button"
          onClick={() => {
            setTab('password');
            setError(null);
          }}
          className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${
            tab === 'password' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          Email / Password
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('otp');
            setError(null);
          }}
          className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${
            tab === 'otp' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          Phone + OTP
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('forgot');
            setError(null);
          }}
          className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${
            tab === 'forgot' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          Reset Password
        </button>
      </div>

      {successMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800">
          {successMsg}
        </div>
      )}

      {tab === 'password' && (
        <form onSubmit={handlePasswordLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email or Indian Mobile Number</label>
            <input
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="email@example.in or 9876543210"
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#14532D] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#14532D] focus:outline-none"
            />
          </div>
          {error && <div className="text-xs font-medium text-red-700">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 text-sm font-semibold text-white bg-[#14532D] hover:bg-[#166534] rounded-lg disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      )}

      {tab === 'otp' && (
        <form onSubmit={handleOtpLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Registered Indian Mobile Number</label>
            <input
              required
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 9876543210"
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-mono focus:border-[#14532D] focus:outline-none"
            />
          </div>
          <OtpVerificationPanel
            channel="phone"
            target={phone}
            purpose="login_phone"
            label="Login OTP Verification"
            hideVerifyButtonForDirectLogin
            onChallengeCreated={setOtpChallengeId}
            onOtpChange={setOtpCode}
            onVerified={() => {}}
          />
          {error && <div className="text-xs font-medium text-red-700">{error}</div>}
          <button
            type="submit"
            disabled={loading || !otpChallengeId || otpCode.length !== 6}
            className="w-full py-2.5 text-sm font-semibold text-white bg-[#14532D] hover:bg-[#166534] rounded-lg disabled:opacity-50"
          >
            {loading ? 'Verifying OTP...' : 'Sign In with OTP'}
          </button>
        </form>
      )}

      {tab === 'forgot' && (
        <form onSubmit={handleResetPassword} className="space-y-4">
          <div className="flex items-center gap-3 text-xs font-medium">
            <button
              type="button"
              onClick={() => setResetChannel('email')}
              className={`px-3 py-1.5 rounded-md border ${resetChannel === 'email' ? 'border-[#14532D] bg-emerald-50 text-[#14532D]' : 'border-slate-200 text-slate-600'}`}
            >
              Recover via Email
            </button>
            <button
              type="button"
              onClick={() => setResetChannel('phone')}
              className={`px-3 py-1.5 rounded-md border ${resetChannel === 'phone' ? 'border-[#14532D] bg-emerald-50 text-[#14532D]' : 'border-slate-200 text-slate-600'}`}
            >
              Recover via Mobile
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {resetChannel === 'email' ? 'Registered Email' : 'Registered Mobile Number'}
            </label>
            <input
              required
              value={resetTarget}
              onChange={(e) => setResetTarget(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#14532D] focus:outline-none"
            />
          </div>

          <OtpVerificationPanel
            channel={resetChannel}
            target={resetTarget}
            purpose="reset_password"
            label="Password Recovery OTP"
            hideVerifyButtonForDirectLogin
            onChallengeCreated={setResetChallengeId}
            onOtpChange={setResetOtp}
            onVerified={() => {}}
          />

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
            <input
              required
              type="password"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min 8 characters"
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#14532D] focus:outline-none"
            />
          </div>

          {error && <div className="text-xs font-medium text-red-700">{error}</div>}
          <button
            type="submit"
            disabled={loading || !resetChallengeId || resetOtp.length !== 6}
            className="w-full py-2.5 text-sm font-semibold text-white bg-[#14532D] hover:bg-[#166534] rounded-lg disabled:opacity-50"
          >
            {loading ? 'Updating Password...' : 'Reset Password'}
          </button>
        </form>
      )}

      <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span>
          New citizen?{' '}
          <a
            href="/register"
            onClick={(e) => {
              e.preventDefault();
              navigateTo('/register');
            }}
            className="font-semibold text-[#14532D] hover:underline"
          >
            Register Account
          </a>
        </span>
        <a
          href="/authority/login"
          onClick={(e) => {
            e.preventDefault();
            navigateTo('/authority/login');
          }}
          className="font-semibold text-slate-800 hover:underline"
        >
          Authority Officer Login &rarr;
        </a>
      </div>
    </AuthShell>
  );
}

function AuthorityLoginView({
  initialView,
  onAuthenticated,
}: {
  initialView: 'login' | 'register';
  onAuthenticated: (u: AuthUser) => void;
}) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [view, setView] = useState<'login' | 'register'>(initialView);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  // Login fields
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  // Registration fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [onboardPassword, setOnboardPassword] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [designation, setDesignation] = useState('');
  const [badgeNumber, setBadgeNumber] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/api/departments')
      .then((res) => {
        setDepartments(res.departments || []);
        if (res.departments?.[0]) {
          setDepartmentId(res.departments[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/authority/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      if (res.sessionToken) setSessionToken(res.sessionToken);
      onAuthenticated(res.user);
      navigateTo('/authority');
    } catch (err: any) {
      setError(err.message || 'Authority sign in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/authority/register', {
        method: 'POST',
        body: JSON.stringify({
          fullName,
          email,
          phone,
          password: onboardPassword,
          departmentId,
          designation,
          badgeNumber,
        }),
      });
      if (res.sessionToken) setSessionToken(res.sessionToken);
      onAuthenticated(res.user);
      navigateTo('/authority');
    } catch (err: any) {
      setError(err.message || 'Authority registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="SEVA AI Authority Portal"
      subtitle="Independent registration and sign-in for municipal, police, medical, animal rescue, and emergency officials."
    >
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
        <button
          type="button"
          onClick={() => {
            setView('login');
            setError(null);
          }}
          className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${
            view === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          Authority Sign In
        </button>
        <button
          type="button"
          onClick={() => {
            setView('register');
            setError(null);
          }}
          className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${
            view === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          Authority Registration
        </button>
      </div>

      {view === 'login' ? (
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Official Email or Registered Mobile
            </label>
            <input
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="officer@city.gov.in"
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#14532D] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#14532D] focus:outline-none"
            />
          </div>
          {error && <div className="text-xs font-medium text-red-700">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white bg-[#14532D] hover:bg-[#166534] rounded-lg disabled:opacity-50"
          >
            <Lock className="h-4 w-4" />
            {loading ? 'Authenticating...' : 'Sign In to Authority Dashboard'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleRegister} className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Officer Full Name</label>
              <input
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Inspector R. Verma"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Badge / Service ID</label>
              <input
                required
                value={badgeNumber}
                onChange={(e) => setBadgeNumber(e.target.value)}
                placeholder="NODAL-001"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Official Email</label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="officer@city.gov.in"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Official Mobile (10-digit)</label>
              <input
                required
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9876543210"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Department</label>
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
              <label className="block text-xs font-medium text-slate-700 mb-1">Designation</label>
              <input
                required
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="Nodal Response Officer"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Password (min 8 chars)</label>
            <input
              required
              type="password"
              minLength={8}
              value={onboardPassword}
              onChange={(e) => setOnboardPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {error && <div className="text-xs font-medium text-red-700">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white bg-[#14532D] hover:bg-[#166534] rounded-lg disabled:opacity-50"
          >
            <UserCheck className="h-4 w-4" />
            {loading ? 'Creating Authority Account...' : 'Create Authority Account & Enter Dashboard'}
          </button>
        </form>
      )}

      <div className="pt-3 border-t border-slate-200 text-xs text-slate-600 flex justify-between">
        <span>Not an authority officer?</span>
        <a
          href="/login"
          onClick={(e) => {
            e.preventDefault();
            navigateTo('/login');
          }}
          className="font-semibold text-[#14532D] hover:underline"
        >
          Citizen Sign In
        </a>
      </div>
    </AuthShell>
  );
}
