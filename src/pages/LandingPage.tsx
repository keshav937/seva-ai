import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Award,
  Car,
  Droplets,
  HeartHandshake,
  MapPin,
  Shield,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { SevaLogo } from '../components/SevaLogo.tsx';
import { apiFetch, navigateTo } from '../lib/api.ts';
import type { AuthUser } from '../types/seva.ts';

interface LandingPageProps {
  user: AuthUser | null;
}

export function LandingPage({ user }: LandingPageProps) {
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [awardData, setAwardData] = useState<{ currentBanner: any; hallOfFame: any[] }>({
    currentBanner: null,
    hallOfFame: [],
  });

  useEffect(() => {
    apiFetch('/api/awards')
      .then((d) => setAwardData(d))
      .catch(() => {});
  }, []);

  const primaryAction = () => {
    if (user?.role === 'authority') {
      navigateTo('/authority');
    } else if (user?.role === 'citizen') {
      navigateTo('/citizen');
    } else {
      navigateTo('/register');
    }
  };

  const services = [
    {
      number: '01',
      title: 'Roads and Potholes',
      desc: 'Report damaged roads, potholes, and broken footpaths with GPS precision and photographic evidence.',
      icon: Wrench,
      department: 'Public Works Department',
    },
    {
      number: '02',
      title: 'Waste Management',
      desc: 'Escalate overflowing dustbins, uncollected garbage, and illegal dumping directly to municipal sanitation.',
      icon: Trash2,
      department: 'Municipal Waste Department',
    },
    {
      number: '03',
      title: 'Drainage and Waterlogging',
      desc: 'Flag blocked drains, sewage overflows, and monsoon waterlogging for rapid engineering clearance.',
      icon: Droplets,
      department: 'Drainage Department',
    },
    {
      number: '04',
      title: 'Traffic and Road Obstructions',
      desc: 'Alert Traffic Police about bottlenecks, illegal parking, fallen trees, or road accidents.',
      icon: Car,
      department: 'Traffic Police & Emergency Control Room',
    },
    {
      number: '05',
      title: 'Medical Assistance',
      desc: 'Locate verified nearby hospitals and ambulance stations via live GPS and dispatch urgent medical requests.',
      icon: Activity,
      department: 'Medical & Ambulance Services',
    },
    {
      number: '06',
      title: 'Seva Shield: Women & Child Safety',
      desc: '2-second SOS activation, voice protection in English and Hindi, live caregiver tracking, and police routing.',
      icon: Shield,
      department: 'Police Control Room',
    },
    {
      number: '07',
      title: 'Animal Rescue Hub',
      desc: 'Report injured strays, trapped wildlife, or animal hazards with live GPS and veterinary dispatch.',
      icon: HeartHandshake,
      department: 'Animal Welfare & Rescue Unit',
    },
  ];

  const workflowSteps = [
    'Citizen Report',
    'AI Triage Suggestion',
    'Live GPS Coordinates',
    'Smart Authority Routing',
    'Officer Investigation',
    'Real-Time Citizen Tracking',
    'Verified Resolution',
  ];

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-slate-900 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigateTo('/');
            }}
            className="whitespace-nowrap shrink-0"
          >
            <SevaLogo size="md" />
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a href="#services" className="hover:text-[#14532D] transition-colors whitespace-nowrap shrink-0">
              Services
            </a>
            <a href="#workflow" className="hover:text-[#14532D] transition-colors whitespace-nowrap shrink-0">
              Workflow
            </a>
            <a
              href="/login"
              onClick={(e) => {
                e.preventDefault();
                navigateTo('/login');
              }}
              className="hover:text-[#14532D] transition-colors whitespace-nowrap shrink-0"
            >
              Citizen Login
            </a>
            <a
              href="/authority/login"
              onClick={(e) => {
                e.preventDefault();
                navigateTo('/authority/login');
              }}
              className="hover:text-[#14532D] transition-colors whitespace-nowrap shrink-0"
            >
              Authority Portal
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={primaryAction}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#14532D] hover:bg-[#166534] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {user ? (user.role === 'authority' ? 'Authority Dashboard' : 'Citizen Dashboard') : 'Get Started'}
            </button>
          </div>
        </div>
      </header>

      {/* Consented Annual Award Banner (only shown if confirmed winner opted in) */}
      {awardData.currentBanner && (
        <div className="bg-emerald-950 text-emerald-50 border-b border-emerald-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2.5">
              <Award className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                <strong>{awardData.currentBanner.award_year} {awardData.currentBanner.title}:</strong>{' '}
                {awardData.currentBanner.winner_name}
                {awardData.currentBanner.city ? ` · ${awardData.currentBanner.city}` : ''}
              </span>
            </div>
            <span className="font-mono text-xs text-emerald-200 tabular-nums">
              Certificate {awardData.currentBanner.certificate_code}
            </span>
          </div>
        </div>
      )}

      <main className="flex-1">
        {/* Hero Section */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
              <div className="text-xs font-semibold tracking-wide text-emerald-800">
                One City · One Platform · Infinite Possibilities · A Safer Tomorrow
              </div>

              <h1
                className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 leading-[1.12]"
                style={{ textWrap: 'balance' }}
              >
                Your City. Your Voice. Your Safety.
              </h1>

              <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl">
                SEVA AI connects citizens, police control rooms, hospitals, ambulance services, trusted
                caregivers, and municipal departments on one real-time civic intelligence and emergency
                response platform built for Indian cities.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={primaryAction}
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-[#14532D] hover:bg-[#166534] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </button>
                <a
                  href="#services"
                  className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Explore Services
                </a>
              </div>

              <div className="pt-4 border-t border-slate-200 grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="font-semibold text-slate-900">Live GPS Engine</div>
                  <div className="text-xs text-slate-500 mt-0.5">High-accuracy device telemetry</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-900">Seva Shield SOS</div>
                  <div className="text-xs text-slate-500 mt-0.5">Caregiver &amp; police alerts</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-900">Unified Portal</div>
                  <div className="text-xs text-slate-500 mt-0.5">Direct authority tracking</div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 flex">
              {!heroImgFailed ? (
                <div className="w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-100 min-h-[300px]">
                  <img
                    src="/src/assets/images/hero_seva_smart_city_1794890988775.jpg"
                    alt="Modern Indian smart city transit boulevard powered by SEVA AI"
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgFailed(true)}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="w-full rounded-xl border border-slate-200 bg-gradient-to-br from-[#14532D] to-emerald-700 p-8 flex flex-col justify-end text-white min-h-[300px]">
                  <MapPin className="h-10 w-10 text-emerald-200 mb-4" />
                  <h2 className="text-xl font-semibold">Unified Smart City Command</h2>
                  <p className="text-sm text-emerald-100 mt-1">
                    Real-time civic reporting, emergency SOS, and municipal resolution.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Core Services */}
        <section id="services" className="bg-white border-y border-slate-200 py-14">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                Core Urban Services &amp; Emergency Modules
              </h2>
              <p className="text-sm sm:text-base text-slate-600 mt-2">
                Report once, reach the right authority. Every verified submission creates an auditable
                tracking ID routed directly to the responsible municipal or emergency department.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map((svc) => {
                const Icon = svc.icon;
                return (
                  <div
                    key={svc.number}
                    className="rounded-xl border border-slate-200 bg-[#F8FAF9] p-6 flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-semibold text-emerald-800 tabular-nums">
                          {svc.number}.
                        </span>
                        <Icon className="h-5 w-5 text-[#14532D]" />
                      </div>
                      <h3 className="text-lg font-semibold text-slate-900">{svc.title}</h3>
                      <p className="text-sm text-slate-600 leading-relaxed">{svc.desc}</p>
                    </div>
                    <div className="pt-3 border-t border-slate-200 text-xs text-slate-500">
                      Routed to: <span className="font-medium text-slate-700">{svc.department}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Unified Workflow */}
        <section id="workflow" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                  End-to-End Transparent Response Pipeline
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  Citizen reports and authority actions operate on the exact same live database record.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigateTo('/login')}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 text-slate-800 hover:bg-slate-50 transition-colors"
                >
                  Citizen Sign In
                </button>
                <button
                  type="button"
                  onClick={() => navigateTo('/authority/login')}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#14532D] text-white hover:bg-[#166534] transition-colors"
                >
                  Authority Portal
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {workflowSteps.map((step, i) => (
                <div
                  key={step}
                  className="rounded-lg border border-slate-200 bg-[#F8FAF9] p-3.5 space-y-1.5"
                >
                  <div className="text-xs font-mono font-semibold text-emerald-700 tabular-nums">
                    0{i + 1}
                  </div>
                  <div className="text-xs sm:text-sm font-semibold text-slate-900 leading-snug">
                    {step}
                  </div>
                </div>
              ))}
            </div>

            {awardData.hallOfFame.length > 0 && (
              <div className="pt-6 border-t border-slate-200">
                <h3 className="text-base font-semibold text-slate-900 mb-3">
                  Hall of Fame — Most Socially Alert Citizens
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {awardData.hallOfFame.map((w) => (
                    <div key={w.certificate_code} className="rounded-lg border border-slate-200 bg-[#F8FAF9] p-4">
                      <div className="text-xs font-mono text-emerald-800 tabular-nums">
                        {w.award_year} · {w.certificate_code}
                      </div>
                      <div className="text-sm font-semibold text-slate-900 mt-1">{w.winner_name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{w.title}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="bg-white border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <div className="space-y-1">
            <div className="font-semibold text-slate-800">
              SEVA AI — Smart City Intelligence &amp; Emergency Response Ecosystem
            </div>
            <div>
              DPDP Act Compliant Data Governance · Real-time GPS &amp; OpenStreetMap Intelligence
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <a
              href="/register"
              onClick={(e) => {
                e.preventDefault();
                navigateTo('/register');
              }}
              className="hover:text-slate-900"
            >
              Citizen Registration
            </a>
            <a
              href="/login"
              onClick={(e) => {
                e.preventDefault();
                navigateTo('/login');
              }}
              className="hover:text-slate-900"
            >
              Citizen Sign In
            </a>
            <a
              href="/authority/login"
              onClick={(e) => {
                e.preventDefault();
                navigateTo('/authority/login');
              }}
              className="hover:text-slate-900"
            >
              Authority Login
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
