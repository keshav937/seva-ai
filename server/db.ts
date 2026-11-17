import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const STORAGE_MEDIA_DIR = path.resolve(process.cwd(), 'storage', 'media');
export const STORAGE_AVATAR_DIR = path.resolve(process.cwd(), 'storage', 'avatars');
if (!fs.existsSync(STORAGE_MEDIA_DIR)) {
  fs.mkdirSync(STORAGE_MEDIA_DIR, { recursive: true });
}
if (!fs.existsSync(STORAGE_AVATAR_DIR)) {
  fs.mkdirSync(STORAGE_AVATAR_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, 'seva_ai.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('citizen', 'authority')),
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      email_verified INTEGER NOT NULL DEFAULT 0,
      anonymous_leaderboard INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      deletion_requested_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      avatar_filename TEXT,
      avatar_mime TEXT,
      address TEXT,
      ward TEXT,
      city TEXT,
      voice_protection_enabled INTEGER NOT NULL DEFAULT 0,
      voice_language TEXT NOT NULL DEFAULT 'en-IN',
      voice_custom_phrase TEXT,
      notify_sms INTEGER NOT NULL DEFAULT 1,
      notify_email INTEGER NOT NULL DEFAULT 1,
      notify_in_app INTEGER NOT NULL DEFAULT 1,
      share_location_consent INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category_scope TEXT NOT NULL,
      description TEXT,
      escalation_order INTEGER NOT NULL DEFAULT 1,
      contact_email TEXT,
      contact_phone TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jurisdictions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      ward_code TEXT,
      department_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS authority_accounts (
      user_id TEXT PRIMARY KEY,
      department_id TEXT NOT NULL,
      jurisdiction_id TEXT,
      designation TEXT NOT NULL,
      badge_number TEXT NOT NULL UNIQUE,
      is_chief_admin INTEGER NOT NULL DEFAULT 0,
      onboarded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (department_id) REFERENCES departments(id),
      FOREIGN KEY (jurisdiction_id) REFERENCES jurisdictions(id)
    );

    CREATE TABLE IF NOT EXISTS otp_challenges (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      target TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('phone', 'email')),
      purpose TEXT NOT NULL CHECK (purpose IN ('register_phone', 'register_email', 'login_phone', 'reset_password', 'verify_phone', 'authority_login', 'caregiver_phone')),
      otp_hash TEXT NOT NULL,
      otp_salt TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      consumed INTEGER NOT NULL DEFAULT 0,
      delivery_status TEXT NOT NULL DEFAULT 'PENDING',
      delivery_provider TEXT,
      delivery_error TEXT,
      expires_at TEXT NOT NULL,
      resend_available_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      tracking_code TEXT NOT NULL UNIQUE,
      citizen_id TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN (
        'Roads and Potholes',
        'Waste Management',
        'Drainage and Waterlogging',
        'Traffic and Road Obstructions',
        'Medical Assistance',
        'Women and Child Safety',
        'Road Accident',
        'Animal Rescue',
        'Other Civic Issues'
      )),
      sub_type TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('Low', 'Medium', 'High', 'Critical')),
      status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN (
        'SUBMITTED',
        'RECEIVED',
        'UNDER REVIEW',
        'ASSIGNED',
        'IN PROGRESS',
        'RESOLVED',
        'REJECTED',
        'REOPENED',
        'ESCALATED'
      )),
      contact_phone TEXT,
      contact_email TEXT,
      ward TEXT,
      incident_timestamp TEXT NOT NULL,
      assigned_department_id TEXT,
      assigned_officer_id TEXT,
      ai_suggested_category TEXT,
      ai_suggested_severity TEXT,
      ai_summary TEXT,
      ai_confidence REAL,
      is_sensitive INTEGER NOT NULL DEFAULT 0,
      admin_heatmap_approved INTEGER NOT NULL DEFAULT 0,
      is_verified_civic INTEGER NOT NULL DEFAULT 0,
      is_duplicate INTEGER NOT NULL DEFAULT 0,
      duplicate_of_id TEXT,
      resolution_description TEXT,
      resolved_at TEXT,
      rejection_reason TEXT,
      escalation_level INTEGER NOT NULL DEFAULT 0,
      last_escalated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (citizen_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_department_id) REFERENCES departments(id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_officer_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS report_locations (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL UNIQUE,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy_meters REAL,
      location_source TEXT NOT NULL DEFAULT 'gps' CHECK (location_source IN ('gps', 'manual')),
      formatted_address TEXT,
      ward TEXT,
      captured_at TEXT NOT NULL,
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS report_media (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      uploader_id TEXT NOT NULL,
      media_kind TEXT NOT NULL CHECK (media_kind IN ('evidence_photo', 'evidence_video', 'resolution_photo')),
      stored_filename TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      duration_seconds REAL,
      latitude REAL,
      longitude REAL,
      location_consent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
      FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      department_id TEXT NOT NULL,
      officer_id TEXT,
      assigned_by TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
      FOREIGN KEY (department_id) REFERENCES departments(id),
      FOREIGN KEY (officer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS report_status_history (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      action_note TEXT,
      evidence_media_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS emergency_contacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      relationship TEXT NOT NULL,
      is_caregiver INTEGER NOT NULL DEFAULT 1,
      linked_user_id TEXT,
      location_consent INTEGER NOT NULL DEFAULT 0,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      verified_at TEXT,
      caregiver_consent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, phone),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS caregiver_permissions (
      id TEXT PRIMARY KEY,
      citizen_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      caregiver_user_id TEXT,
      can_view_live_location INTEGER NOT NULL DEFAULT 1,
      can_receive_sos INTEGER NOT NULL DEFAULT 1,
      consent_granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      FOREIGN KEY (citizen_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES emergency_contacts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sos_events (
      id TEXT PRIMARY KEY,
      emergency_code TEXT NOT NULL UNIQUE,
      citizen_id TEXT NOT NULL,
      trigger_method TEXT NOT NULL CHECK (trigger_method IN ('button', 'voice', 'manual')),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ACKNOWLEDGED', 'ESCALATED', 'SAFE_RESOLVED')),
      initial_latitude REAL,
      initial_longitude REAL,
      initial_accuracy REAL,
      latest_latitude REAL,
      latest_longitude REAL,
      latest_accuracy REAL,
      latest_location_at TEXT,
      last_sms_location_at TEXT,
      acknowledged_by TEXT,
      acknowledged_at TEXT,
      escalation_level INTEGER NOT NULL DEFAULT 0,
      last_escalated_at TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (citizen_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tracking_sessions (
      id TEXT PRIMARY KEY,
      sos_event_id TEXT NOT NULL UNIQUE,
      citizen_id TEXT NOT NULL,
      tracking_token TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      consent_active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (sos_event_id) REFERENCES sos_events(id) ON DELETE CASCADE,
      FOREIGN KEY (citizen_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sos_location_updates (
      id TEXT PRIMARY KEY,
      sos_event_id TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy_meters REAL,
      heading REAL,
      speed REAL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (sos_event_id) REFERENCES sos_events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS medical_requests (
      id TEXT PRIMARY KEY,
      tracking_code TEXT NOT NULL UNIQUE,
      citizen_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      patient_condition TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'High',
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy_meters REAL,
      formatted_address TEXT,
      selected_facility_name TEXT,
      selected_facility_address TEXT,
      selected_facility_phone TEXT,
      selected_facility_distance_m REAL,
      status TEXT NOT NULL DEFAULT 'Received' CHECK (status IN (
        'Received',
        'Authority Notified',
        'Acknowledged',
        'Ambulance Assigned',
        'On the Way',
        'Resolved'
      )),
      call_status TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED',
      call_detail TEXT,
      assigned_officer_id TEXT,
      escalation_level INTEGER NOT NULL DEFAULT 0,
      last_escalated_at TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (citizen_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS facility_records (
      id TEXT PRIMARY KEY,
      request_type TEXT NOT NULL,
      request_id TEXT NOT NULL,
      facility_name TEXT NOT NULL,
      facility_type TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      distance_meters REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'OpenStreetMap',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS emergency_notifications (
      id TEXT PRIMARY KEY,
      sos_event_id TEXT,
      medical_request_id TEXT,
      recipient_name TEXT NOT NULL,
      recipient_phone TEXT,
      recipient_email TEXT,
      recipient_user_id TEXT,
      channel TEXT NOT NULL CHECK (channel IN ('in_app', 'sms', 'email', 'voice')),
      status TEXT NOT NULL CHECK (status IN ('QUEUED', 'SENDING', 'ACCEPTED_BY_PROVIDER', 'DELIVERED', 'FAILED', 'NOT_CONFIGURED')),
      provider TEXT,
      provider_message_id TEXT,
      error_message TEXT,
      payload_text TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link_path TEXT,
      related_id TEXT,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'emergency')),
      is_read INTEGER NOT NULL DEFAULT 0,
      is_acknowledged INTEGER NOT NULL DEFAULT 0,
      acknowledged_at TEXT,
      delivery_channel TEXT NOT NULL DEFAULT 'in_app',
      delivery_status TEXT NOT NULL DEFAULT 'DELIVERED',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS badge_config (
      id TEXT PRIMARY KEY,
      badge_code TEXT NOT NULL UNIQUE,
      badge_name TEXT NOT NULL,
      min_verified_reports INTEGER NOT NULL,
      points_per_verified INTEGER NOT NULL DEFAULT 25,
      points_per_evidence INTEGER NOT NULL DEFAULT 10,
      points_per_location INTEGER NOT NULL DEFAULT 5,
      points_per_resolved INTEGER NOT NULL DEFAULT 20,
      points_per_medical INTEGER NOT NULL DEFAULT 30,
      daily_point_cap INTEGER NOT NULL DEFAULT 150,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS citizen_points (
      id TEXT PRIMARY KEY,
      citizen_id TEXT NOT NULL,
      report_id TEXT,
      points INTEGER NOT NULL,
      reason TEXT NOT NULL,
      awarded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (citizen_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS citizen_badges (
      id TEXT PRIMARY KEY,
      citizen_id TEXT NOT NULL,
      badge_code TEXT NOT NULL,
      badge_name TEXT NOT NULL,
      awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
      audit_note TEXT,
      UNIQUE(citizen_id, badge_code),
      FOREIGN KEY (citizen_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS leaderboard_records (
      citizen_id TEXT PRIMARY KEY,
      total_points INTEGER NOT NULL DEFAULT 0,
      verified_reports INTEGER NOT NULL DEFAULT 0,
      resolved_reports INTEGER NOT NULL DEFAULT 0,
      ward TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (citizen_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS annual_awards (
      id TEXT PRIMARY KEY,
      award_year INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT 'MOST SOCIALLY ALERT CITIZEN',
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SHORTLISTED', 'CONFIRMED')),
      winner_citizen_id TEXT,
      winner_consent INTEGER NOT NULL DEFAULT 0,
      confirmed_by TEXT,
      confirmed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (winner_citizen_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS award_candidates (
      id TEXT PRIMARY KEY,
      award_id TEXT NOT NULL,
      citizen_id TEXT NOT NULL,
      rank_order INTEGER NOT NULL,
      verified_reports_count INTEGER NOT NULL,
      total_points INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'SHORTLISTED' CHECK (status IN ('SHORTLISTED', 'DISQUALIFIED', 'WINNER')),
      investigation_note TEXT,
      disqualification_reason TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(award_id, citizen_id),
      FOREIGN KEY (award_id) REFERENCES annual_awards(id) ON DELETE CASCADE,
      FOREIGN KEY (citizen_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS certificates (
      id TEXT PRIMARY KEY,
      certificate_code TEXT NOT NULL UNIQUE,
      award_id TEXT NOT NULL,
      citizen_id TEXT NOT NULL,
      winner_name TEXT NOT NULL,
      award_year INTEGER NOT NULL,
      award_title TEXT NOT NULL,
      issued_by TEXT NOT NULL,
      issued_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (award_id) REFERENCES annual_awards(id) ON DELETE CASCADE,
      FOREIGN KEY (citizen_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      detail TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS consent_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      consent_type TEXT NOT NULL,
      granted INTEGER NOT NULL,
      policy_version TEXT NOT NULL DEFAULT 'DPDP-2026.1',
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sms_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      recipient_phone TEXT NOT NULL,
      event_type TEXT NOT NULL,
      related_id TEXT,
      message_body TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('QUEUED', 'ACCEPTED_BY_PROVIDER', 'DELIVERED', 'FAILED', 'NOT_CONFIGURED')),
      provider TEXT,
      provider_message_id TEXT,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_reports_citizen ON reports(citizen_id);
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
    CREATE INDEX IF NOT EXISTS idx_reports_category ON reports(category);
    CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_sos_citizen ON sos_events(citizen_id, status);
    CREATE INDEX IF NOT EXISTS idx_otp_target ON otp_challenges(target, channel, purpose);
    CREATE INDEX IF NOT EXISTS idx_sms_logs_user ON sms_logs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sms_logs_related ON sms_logs(related_id, event_type);
  `);

  // Idempotent column migrations for existing databases
  const ecCols = (db.prepare('PRAGMA table_info(emergency_contacts)').all() as Array<{ name: string }>).map((c) => c.name);
  if (!ecCols.includes('phone_verified')) {
    db.exec('ALTER TABLE emergency_contacts ADD COLUMN phone_verified INTEGER NOT NULL DEFAULT 0;');
  }
  if (!ecCols.includes('verified_at')) {
    db.exec('ALTER TABLE emergency_contacts ADD COLUMN verified_at TEXT;');
  }
  if (!ecCols.includes('caregiver_consent')) {
    db.exec('ALTER TABLE emergency_contacts ADD COLUMN caregiver_consent INTEGER NOT NULL DEFAULT 0;');
  }

  const sosCols = (db.prepare('PRAGMA table_info(sos_events)').all() as Array<{ name: string }>).map((c) => c.name);
  if (!sosCols.includes('last_sms_location_at')) {
    db.exec('ALTER TABLE sos_events ADD COLUMN last_sms_location_at TEXT;');
  }

  // Safe schema migration if existing otp_challenges lacks 'caregiver_phone' CHECK value
  const otpDdl = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='otp_challenges'")
    .get() as { sql?: string } | undefined;

  if (otpDdl?.sql && !otpDdl.sql.includes("'caregiver_phone'")) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE otp_challenges_migrated (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        target TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('phone', 'email')),
        purpose TEXT NOT NULL CHECK (purpose IN ('register_phone', 'register_email', 'login_phone', 'reset_password', 'verify_phone', 'authority_login', 'caregiver_phone')),
        otp_hash TEXT NOT NULL,
        otp_salt TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        consumed INTEGER NOT NULL DEFAULT 0,
        delivery_status TEXT NOT NULL DEFAULT 'PENDING',
        delivery_provider TEXT,
        delivery_error TEXT,
        expires_at TEXT NOT NULL,
        resend_available_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO otp_challenges_migrated SELECT * FROM otp_challenges;
      DROP TABLE otp_challenges;
      ALTER TABLE otp_challenges_migrated RENAME TO otp_challenges;
      CREATE INDEX IF NOT EXISTS idx_otp_target ON otp_challenges(target, channel, purpose);
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
  }

  // Safe schema migration if existing reports lacks 'Animal Rescue' or 'Other Civic Issues' CHECK value
  const reportsDdl = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reports'")
    .get() as { sql?: string } | undefined;

  if (reportsDdl?.sql && (!reportsDdl.sql.includes("'Animal Rescue'") || !reportsDdl.sql.includes("'Other Civic Issues'"))) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE reports_migrated (
        id TEXT PRIMARY KEY,
        tracking_code TEXT NOT NULL UNIQUE,
        citizen_id TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN (
          'Roads and Potholes',
          'Waste Management',
          'Drainage and Waterlogging',
          'Traffic and Road Obstructions',
          'Medical Assistance',
          'Women and Child Safety',
          'Road Accident',
          'Animal Rescue',
          'Other Civic Issues'
        )),
        sub_type TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('Low', 'Medium', 'High', 'Critical')),
        status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN (
          'SUBMITTED',
          'RECEIVED',
          'UNDER REVIEW',
          'ASSIGNED',
          'IN PROGRESS',
          'RESOLVED',
          'REJECTED',
          'REOPENED',
          'ESCALATED'
        )),
        contact_phone TEXT,
        contact_email TEXT,
        ward TEXT,
        incident_timestamp TEXT NOT NULL,
        assigned_department_id TEXT,
        assigned_officer_id TEXT,
        ai_suggested_category TEXT,
        ai_suggested_severity TEXT,
        ai_summary TEXT,
        ai_confidence REAL,
        is_sensitive INTEGER NOT NULL DEFAULT 0,
        admin_heatmap_approved INTEGER NOT NULL DEFAULT 0,
        is_verified_civic INTEGER NOT NULL DEFAULT 0,
        is_duplicate INTEGER NOT NULL DEFAULT 0,
        duplicate_of_id TEXT,
        resolution_description TEXT,
        resolved_at TEXT,
        rejection_reason TEXT,
        escalation_level INTEGER NOT NULL DEFAULT 0,
        last_escalated_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (citizen_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (assigned_department_id) REFERENCES departments(id) ON DELETE SET NULL,
        FOREIGN KEY (assigned_officer_id) REFERENCES users(id) ON DELETE SET NULL
      );
      INSERT INTO reports_migrated SELECT * FROM reports;
      DROP TABLE reports;
      ALTER TABLE reports_migrated RENAME TO reports;
      CREATE INDEX IF NOT EXISTS idx_reports_citizen ON reports(citizen_id);
      CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
      CREATE INDEX IF NOT EXISTS idx_reports_category ON reports(category);
      CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
  }

  // Seed legitimate system configuration: Municipal & Emergency Departments (idempotent)
  const insertDept = db.prepare(`
    INSERT OR IGNORE INTO departments (id, code, name, category_scope, description, escalation_order, contact_email)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const departments = [
    ['dept-pwd', 'PWD', 'Public Works Department', 'Roads and Potholes', 'Road maintenance, pothole repairs, footpaths, and street surfacing.', 1, 'pwd-control@city.gov.in'],
    ['dept-waste', 'SWM', 'Municipal Waste Department', 'Waste Management', 'Solid waste collection, dustbin clearance, and illegal dumping enforcement.', 1, 'sanitation@city.gov.in'],
    ['dept-drain', 'DRN', 'Drainage Department', 'Drainage and Waterlogging', 'Stormwater drains, sewage clearance, and flood waterlogging mitigation.', 1, 'drainage@city.gov.in'],
    ['dept-traffic', 'TRF', 'Traffic Police', 'Traffic and Road Obstructions', 'Traffic congestion management, illegal parking, and road obstruction removal.', 1, 'traffic-control@police.gov.in'],
    ['dept-ecr', 'ECR', 'Emergency Control Room', 'Road Accident', 'Integrated multi-agency road accident and emergency dispatch center.', 2, 'ecr-dispatch@city.gov.in'],
    ['dept-med', 'MED', 'Medical & Ambulance Services', 'Medical Assistance', 'Emergency ambulance routing, trauma triage, and hospital coordination.', 1, 'medical-108@health.gov.in'],
    ['dept-pcr', 'PCR', 'Police Control Room (Women & Child Safety)', 'Women and Child Safety', 'Rapid police response, women safety patrol, and SOS emergency dispatch.', 1, 'pcr-112@police.gov.in'],
    ['dept-animal', 'ANM', 'Animal Welfare & Rescue Unit', 'Animal Rescue', 'Veterinary rescue, injured stray care, and wildlife hazard response.', 1, 'animal-rescue@city.gov.in'],
    ['dept-other', 'OTH', 'General Municipal Services', 'Other Civic Issues', 'General civic complaints, street lighting, parks, utilities, and miscellaneous issues.', 1, 'civic-helpdesk@city.gov.in'],
    ['dept-hq', 'CHQ', 'Municipal Commissioner & Nodal Escalation Desk', 'Escalation', 'Senior supervisory escalation authority for unacknowledged critical alerts.', 3, 'commissioner-desk@city.gov.in'],
  ];
  const deptTx = db.transaction(() => {
    for (const d of departments) {
      insertDept.run(...d);
    }
  });
  deptTx();

  // Seed default configurable badge thresholds (system config, not fake badges)
  const badgeCount = db.prepare('SELECT COUNT(*) as c FROM badge_config').get() as { c: number };
  if (badgeCount.c === 0) {
    const insertBadge = db.prepare(`
      INSERT INTO badge_config (id, badge_code, badge_name, min_verified_reports, points_per_verified, points_per_evidence, points_per_location, points_per_resolved, points_per_medical, daily_point_cap)
      VALUES (?, ?, ?, ?, 25, 10, 5, 20, 30, 150)
    `);
    const badges = [
      ['bc-bronze', 'BRONZE_CITIZEN', 'Bronze Citizen', 1],
      ['bc-silver', 'SILVER_CITIZEN', 'Silver Citizen', 10],
      ['bc-gold', 'GOLD_CITIZEN', 'Gold Citizen', 25],
      ['bc-platinum', 'PLATINUM_GUARDIAN', 'Platinum Guardian', 50],
    ];
    const tx = db.transaction(() => {
      for (const b of badges) {
        insertBadge.run(...b);
      }
    });
    tx();
  }
}

export function getDepartmentIdForCategory(category: string): string {
  switch (category) {
    case 'Roads and Potholes':
      return 'dept-pwd';
    case 'Waste Management':
      return 'dept-waste';
    case 'Drainage and Waterlogging':
      return 'dept-drain';
    case 'Traffic and Road Obstructions':
      return 'dept-traffic';
    case 'Road Accident':
      return 'dept-ecr';
    case 'Medical Assistance':
      return 'dept-med';
    case 'Women and Child Safety':
      return 'dept-pcr';
    case 'Animal Rescue':
      return 'dept-animal';
    case 'Other Civic Issues':
      return 'dept-other';
    default:
      return 'dept-other';
  }
}
