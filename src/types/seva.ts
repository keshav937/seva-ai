export type UserRole = 'citizen' | 'authority';

export interface AuthUser {
  id: string;
  role: UserRole;
  full_name: string;
  email: string;
  phone: string;
  phone_verified: number;
  email_verified: number;
  anonymous_leaderboard: number;
  department_id?: string | null;
  department_name?: string | null;
  designation?: string | null;
  badge_number?: string | null;
  is_chief_admin?: number;
}

export interface UserProfile {
  user_id: string;
  avatar_filename?: string | null;
  avatarUrl?: string | null;
  address?: string | null;
  ward?: string | null;
  city?: string | null;
  voice_protection_enabled: number;
  voice_language: 'en-IN' | 'hi-IN';
  voice_custom_phrase?: string | null;
  notify_sms: number;
  notify_email: number;
  notify_in_app: number;
  share_location_consent: number;
  completionPct: number;
}

export interface ProviderStatus {
  smsConfigured: boolean;
  smsProvider: string | null;
  emailConfigured: boolean;
  emailProvider: string | null;
  voiceConfigured: boolean;
  voiceProvider: string | null;
}

export interface ReportMediaItem {
  id: string;
  media_kind: 'evidence_photo' | 'evidence_video' | 'resolution_photo';
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds?: number | null;
  created_at: string;
  url: string;
}

export interface ReportHistoryItem {
  id: string;
  previous_status: string | null;
  new_status: string;
  updated_by_name: string;
  updated_by_role: string;
  action_note: string | null;
  evidence_media_id: string | null;
  created_at: string;
}

export interface CivicReport {
  id: string;
  trackingCode: string;
  citizenId: string;
  citizenName: string;
  citizenPhone: string | null;
  citizenEmail: string | null;
  category: string;
  subType: string | null;
  title: string;
  description: string;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  status: string;
  ward: string | null;
  incidentTimestamp: string;
  assignedDepartmentId: string | null;
  assignedDepartmentName: string | null;
  assignedOfficerId: string | null;
  assignedOfficerName: string | null;
  aiSuggestedCategory: string | null;
  aiSuggestedSeverity: string | null;
  aiSummary: string | null;
  aiConfidence: number | null;
  isSensitive: boolean;
  adminHeatmapApproved: boolean;
  isVerifiedCivic: boolean;
  isDuplicate: boolean;
  resolutionDescription: string | null;
  resolvedAt: string | null;
  rejectionReason: string | null;
  escalationLevel: number;
  createdAt: string;
  updatedAt: string;
  location: {
    latitude: number;
    longitude: number;
    accuracyMeters: number | null;
    source: 'gps' | 'manual';
    formattedAddress: string | null;
    ward: string | null;
    capturedAt: string;
  } | null;
  media: ReportMediaItem[];
  history: ReportHistoryItem[];
}

export interface NearbyPlace {
  id: string;
  name: string;
  category: string;
  address: string;
  phone: string | null;
  openingHours: string | null;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  navigationUrl: string;
  osmUrl: string;
  source: 'OpenStreetMap';
}

export interface NotificationItem {
  id: string;
  user_id: string;
  category: string;
  title: string;
  message: string;
  link_path: string | null;
  related_id: string | null;
  priority: 'normal' | 'high' | 'emergency';
  is_read: number;
  is_acknowledged: number;
  created_at: string;
}

export interface SmsLogItem {
  id: string;
  user_id: string | null;
  recipient_phone: string;
  event_type: string;
  related_id: string | null;
  message_body: string;
  status: 'QUEUED' | 'ACCEPTED_BY_PROVIDER' | 'DELIVERED' | 'FAILED' | 'NOT_CONFIGURED';
  provider: string | null;
  provider_message_id: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  category_scope: string;
  description: string | null;
  escalation_order: number;
  contact_email: string | null;
  assigned_reports_count?: number;
  officers_count?: number;
}
