import { useEffect, useState } from 'react';
import { apiFetch, clearSessionToken, navigateTo } from './lib/api.ts';
import { AuthPages } from './pages/AuthPages.tsx';
import { AuthorityPortal } from './pages/AuthorityPortal.tsx';
import { CaregiverTrackPage } from './pages/CaregiverTrackPage.tsx';
import { CitizenPortal } from './pages/CitizenPortal.tsx';
import { LandingPage } from './pages/LandingPage.tsx';
import type { AuthUser } from './types/seva.ts';

export default function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const loadSession = async () => {
    try {
      const res = await apiFetch('/api/auth/session');
      if (res.authenticated && res.user) {
        setUser(res.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setAuthChecked(true);
    }
  };

  useEffect(() => {
    loadSession();

    const onPopState = () => setPathname(window.location.pathname);
    const onNavigate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setPathname(detail?.path || window.location.pathname);
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('seva:navigate', onNavigate);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('seva:navigate', onNavigate);
    };
  }, []);

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    clearSessionToken();
    setUser(null);
    navigateTo('/');
  };

  // Public Caregiver Live Tracking link (accessible without login)
  if (pathname.startsWith('/track/')) {
    const token = pathname.replace('/track/', '').split('/')[0];
    return <CaregiverTrackPage token={token} />;
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center text-sm font-medium text-slate-600">
        Loading SEVA AI...
      </div>
    );
  }

  if (pathname === '/register' || pathname === '/citizen/register') {
    if (user?.role === 'citizen') {
      return <CitizenPortal user={user} pathname="/citizen" onLogout={handleLogout} onRefreshUser={loadSession} />;
    }
    return <AuthPages mode="register" onAuthenticated={setUser} />;
  }

  if (pathname === '/login' || pathname === '/citizen/login') {
    if (user?.role === 'citizen') {
      return <CitizenPortal user={user} pathname="/citizen" onLogout={handleLogout} onRefreshUser={loadSession} />;
    }
    return <AuthPages mode="login" onAuthenticated={setUser} />;
  }

  if (pathname === '/authority/login' || pathname === '/authority/register') {
    if (user?.role === 'authority') {
      return <AuthorityPortal user={user} pathname="/authority" onLogout={handleLogout} />;
    }
    return (
      <AuthPages
        mode={pathname === '/authority/register' ? 'authority-register' : 'authority-login'}
        onAuthenticated={setUser}
      />
    );
  }

  if (pathname.startsWith('/citizen')) {
    if (!user || user.role !== 'citizen') {
      return <AuthPages mode="login" onAuthenticated={setUser} />;
    }
    return (
      <CitizenPortal
        user={user}
        pathname={pathname}
        onLogout={handleLogout}
        onRefreshUser={loadSession}
      />
    );
  }

  if (pathname.startsWith('/authority')) {
    if (!user || user.role !== 'authority') {
      return <AuthPages mode="authority-login" onAuthenticated={setUser} />;
    }
    return <AuthorityPortal user={user} pathname={pathname} onLogout={handleLogout} />;
  }

  return <LandingPage user={user} />;
}
