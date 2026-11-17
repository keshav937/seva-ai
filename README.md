# SEVA AI — Civic Services, Public Safety & Emergency Response Platform

**One City. One Platform. Infinite Possibilities. A Safer Tomorrow.**

SEVA AI is a full-stack smart city civic reporting, public safety, Seva Shield SOS, medical emergency routing, and municipal authority command platform designed for Indian cities.

---

## Core Architecture

- **Frontend**: React + TypeScript + Vite + Tailwind CSS v4 + Leaflet (OpenStreetMap) + WebSocket real-time updates + jsPDF certificate generator.
- **Backend**: Node.js + Express + `ws` WebSocket Server running on port `3000` (`server.ts`).
- **Database & Storage**: SQLite (`better-sqlite3`, WAL mode, foreign keys enforced) initialized automatically at `./data/seva_ai.db`. Uploaded citizen evidence photos/videos and avatars are stored in private local storage (`./storage/media` and `./storage/avatars`) and served strictly through authenticated RBAC API endpoints (`/api/reports/media/:mediaId`, `/api/auth/avatars/:userId`).
- **AI Civic Intelligence Engine**: Server-side `@google/genai` (`gemini-4-hydrogen`) for optional image + text report analysis, category/severity suggestions, and authority trend summaries, paired with SQL spatial/text duplicate detection.
- **Mapping & Nearby Services**: Live `navigator.geolocation.watchPosition()` coordinates combined with OpenStreetMap Nominatim (geocoding) and Overpass API (live nearby hospitals, police stations, fire stations, pharmacies, clinics, ambulances).

---

## Zero Demo / Placeholder Data Policy

SEVA AI ships with **zero** pre-seeded demo users, **zero** demo reports, **zero** placeholder photographs, and **zero** simulated GPS coordinates.
- System initialization creates only the 8 operational municipal/emergency departments (`departments`) and 4 default badge tier thresholds (`badge_config`).
- To start using the Authority Portal on a fresh deployment, visit `/authority/login` to bootstrap the initial **Chief Administrator / Authority** account directly from the onboarding flow. Subsequent Authority officers require either an authenticated Chief Administrator or the server-side `AUTHORITY_ONBOARDING_KEY`.

---

## Environment Configuration

Copy `.env.example` to `.env` or set secrets in the host runtime:

| Variable | Description | Default / Requirement |
| --- | --- | --- |
| `SEVA_ENV_MODE` | `"development"` displays the generated 6-digit OTP in the **Development Test Mode** UI panel when external SMS/Email providers are not configured. Set `"production"` to enforce strict external provider delivery with zero frontend OTP exposure. | `"development"` |
| `SESSION_SECRET` | Secret used to sign session tokens, cookies, and OTP verification proofs. | Required in production |
| `APP_URL` | Public base URL of the deployment (used inside SOS caregiver tracking links). | `"http://localhost:3000"` |
| `GEMINI_API_KEY` | Google Gemini API key for server-side Civic Intelligence & Trend Analysis. | Optional (gracefully degrades if omitted) |
| `AUTHORITY_ONBOARDING_KEY` | Activation key required when creating additional Authority officer accounts outside a Chief Admin session. | `"SEVA-AUTH-2026"` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_VOICE_TWIML_URL` | Twilio REST credentials for real SMS OTPs, SOS SMS alerts, and emergency voice calls. | Optional |
| `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`, `MSG91_TEMPLATE_ID` | MSG91 API credentials for Indian DLT-compliant SMS delivery. | Optional |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Resend API credentials for transactional Email OTPs & report updates. | Optional |
| `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` | SendGrid API credentials (used if Resend is not configured). | Optional |

---

## Database Schema & Migrations

Database initialization and idempotent schema creation live in `server/db.ts` (`initializeDatabase()`). Tables created automatically on boot:
- **Identity & Auth**: `users`, `user_profiles`, `authority_accounts`, `sessions`, `otp_challenges`, `consent_records`
- **Civic Operations**: `departments`, `reports`, `report_locations`, `report_media`, `report_status_history`, `assignments`
- **Seva Shield & Medical**: `emergency_contacts`, `caregiver_permissions`, `sos_events`, `sos_location_updates`, `sos_external_alerts`, `medical_requests`
- **Governance, Gamification & Audits**: `notifications`, `citizen_points`, `citizen_badges`, `badge_config`, `leaderboard_records`, `annual_awards`, `audit_logs`

---

## Running Locally

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
npm start
```

---

## Verification & Testing Guide

1. **Build & Type Check**:
   - `npm run lint` (`tsc --noEmit`)
   - `npm run build` (`vite build`)
2. **Citizen & OTP Flow**:
   - Visit `/citizen/register`, request Mobile & Email OTPs (in `SEVA_ENV_MODE=development`, the generated random OTP appears inside the Development Test Mode panel; in `production`, SMS/Email providers are invoked strictly without exposing OTPs in responses).
   - Register, log in, submit a Civic Report with live camera/gallery evidence and live GPS, and verify it appears under **My Reports & Live Tracking**.
3. **Authority Portal Flow**:
   - Visit `/authority/login`, bootstrap the Chief Authority account on first run, and confirm all submitted citizen reports appear immediately in **All Citizen Reports** without any permission-blocker wall.
   - Update report status (`SUBMITTED -> RECEIVED -> UNDER REVIEW -> ASSIGNED -> IN PROGRESS -> RESOLVED`), inspect citizen uploaded media, and verify citizen points, badges, and leaderboard update automatically.
4. **Seva Shield SOS & Caregiver Tracking**:
   - Add emergency contacts (10-digit Indian numbers, max 5), activate SOS, inspect the live caregiver tracking page `/track/:token`, acknowledge as Authority, and resolve via **I'm Safe**.
