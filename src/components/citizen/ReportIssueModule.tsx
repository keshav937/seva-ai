import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LiveMap } from '../LiveMap.tsx';
import { getLocationStateLabel, useLiveLocation } from '../../hooks/useLiveLocation.ts';
import { apiFetch, formatDistance, getSessionToken } from '../../lib/api.ts';
import type { AuthUser, Department, NearbyPlace } from '../../types/seva.ts';

const REPORT_CATEGORIES = [
  {
    name: 'Roads and Potholes',
    subTypes: ['Potholes', 'Damaged roads', 'Broken footpaths', 'Dangerous road surfaces'],
  },
  {
    name: 'Waste Management',
    subTypes: ['Garbage accumulation', 'Overflowing dustbins', 'Illegal dumping', 'Uncollected garbage'],
  },
  {
    name: 'Drainage and Waterlogging',
    subTypes: ['Blocked drains', 'Sewage overflow', 'Waterlogging', 'Damaged drainage systems'],
  },
  {
    name: 'Traffic and Road Obstructions',
    subTypes: ['Traffic congestion', 'Illegal parking', 'Road blockages', 'Other obstructions'],
  },
  {
    name: 'Road Accident',
    subTypes: ['Collision / Vehicle crash', 'Pedestrian injury', 'Highway blockage', 'Hit and run'],
  },
  {
    name: 'Medical Assistance',
    subTypes: ['Medical emergencies', 'Injured persons', 'Ambulance assistance', 'Urgent medical support'],
  },
  {
    name: 'Women and Child Safety',
    subTypes: ['Harassment', 'Unsafe public locations', 'Suspicious activities', 'Emergency assistance'],
  },
  {
    name: 'Animal Rescue',
    subTypes: ['Injured stray animal', 'Animal trapped / hazard', 'Aggressive / rabid animal alert', 'Wildlife rescue'],
  },
  {
    name: 'Other Civic Issues',
    subTypes: ['Streetlight / Public Lighting', 'Parks & Public Spaces', 'Water Supply', 'Public Sanitation & Utilities', 'Other Civic Issue'],
  },
];

const DEFAULT_DEPT_BY_CATEGORY: Record<string, string> = {
  'Roads and Potholes': 'dept-pwd',
  'Waste Management': 'dept-waste',
  'Drainage and Waterlogging': 'dept-drain',
  'Traffic and Road Obstructions': 'dept-traffic',
  'Road Accident': 'dept-ecr',
  'Medical Assistance': 'dept-med',
  'Women and Child Safety': 'dept-pcr',
  'Animal Rescue': 'dept-animal',
  'Other Civic Issues': 'dept-other',
};

interface ReportIssueModuleProps {
  user: AuthUser;
  initialCategory?: string;
  onSubmitted: (reportId: string) => void;
}

export function ReportIssueModule({ user, initialCategory, onSubmitted }: ReportIssueModuleProps) {
  const [category, setCategory] = useState(initialCategory || 'Roads and Potholes');
  const [subType, setSubType] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState(
    DEFAULT_DEPT_BY_CATEGORY[initialCategory || 'Roads and Potholes'] || 'dept-pwd'
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<'Low' | 'Medium' | 'High' | 'Critical'>('Medium');
  const [contactPhone, setContactPhone] = useState(user.phone || '');
  const [incidentTime, setIncidentTime] = useState(() => new Date().toISOString().slice(0, 16));
  const [locationConsent, setLocationConsent] = useState(true);

  // Media evidence state
  const [photos, setPhotos] = useState<Array<{ file: File; previewUrl: string }>>([]);
  const [video, setVideo] = useState<{ file: File; previewUrl: string; duration: number } | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // Device camera state
  const [cameraMode, setCameraMode] = useState<'off' | 'photo' | 'video'>('off');
  const [recordingVideo, setRecordingVideo] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live GPS state
  const gps = useLiveLocation(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualResults, setManualResults] = useState<any[]>([]);
  const [manualLocation, setManualLocation] = useState<{ latitude: number; longitude: number; address: string; ward: string | null } | null>(null);

  // Nearby facilities for Road Accident reports
  const [accidentFacilities, setAccidentFacilities] = useState<NearbyPlace[]>([]);
  const [loadingFacilities, setLoadingFacilities] = useState(false);

  // AI Analysis state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<any | null>(null);

  // Submission state
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ departments: Department[] }>('/api/departments')
      .then((res) => setDepartments(res.departments || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (initialCategory) setCategory(initialCategory);
  }, [initialCategory]);

  const activeCategoryObj = REPORT_CATEGORIES.find((c) => c.name === category) || REPORT_CATEGORIES[0];

  useEffect(() => {
    setSubType(activeCategoryObj.subTypes[0] || '');
    const defaultDept = DEFAULT_DEPT_BY_CATEGORY[category];
    if (defaultDept) setDepartmentId(defaultDept);
  }, [category]);

  const effectiveCoords = gps.location
    ? { latitude: gps.location.latitude, longitude: gps.location.longitude, source: 'gps' as const, accuracy: gps.location.accuracy }
    : manualLocation
      ? { latitude: manualLocation.latitude, longitude: manualLocation.longitude, source: 'manual' as const, accuracy: null }
      : null;

  // When Road Accident is selected & GPS coords exist, automatically search nearby hospitals & police stations
  useEffect(() => {
    if (category !== 'Road Accident' || !effectiveCoords) return;
    let cancelled = false;
    setLoadingFacilities(true);
    apiFetch(`/api/places/nearby?lat=${effectiveCoords.latitude}&lng=${effectiveCoords.longitude}&category=emergency_all&radius=6000`)
      .then((res) => {
        if (!cancelled) setAccidentFacilities(res.places || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingFacilities(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category, effectiveCoords?.latitude, effectiveCoords?.longitude]);

  const stopCamera = () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setRecordingVideo(false);
    setRecordSeconds(0);
    setCameraMode('off');
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const startCamera = async (mode: 'photo' | 'video') => {
    setMediaError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError('Camera access is not supported on this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: mode === 'video',
      });
      streamRef.current = stream;
      setCameraMode(mode);
      setTimeout(() => {
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = stream;
        }
      }, 60);
    } catch (err: any) {
      setMediaError(err?.message || 'Camera permission denied. You can upload photos/video from gallery instead.');
    }
  };

  const capturePhoto = () => {
    const vid = videoPreviewRef.current;
    if (!vid) return;
    const canvas = document.createElement('canvas');
    canvas.width = vid.videoWidth || 1280;
    canvas.height = vid.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        if (photos.length >= 5) {
          setMediaError('Maximum 5 photographs per report.');
          return;
        }
        const file = new File([blob], `camera-capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
        setPhotos((prev) => [...prev, { file, previewUrl: URL.createObjectURL(file) }]);
        stopCamera();
      },
      'image/jpeg',
      0.9
    );
  };

  const toggleVideoRecording = () => {
    if (!streamRef.current) return;
    if (!recordingVideo) {
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(streamRef.current);
      recorderRef.current = recorder;
      let elapsed = 0;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        if (blob.size > 50 * 1024 * 1024) {
          setMediaError('Recorded video exceeds 50 MB limit.');
          return;
        }
        const file = new File([blob], `video-evidence-${Date.now()}.webm`, { type: 'video/webm' });
        setVideo({ file, previewUrl: URL.createObjectURL(file), duration: elapsed });
      };

      recorder.start();
      setRecordingVideo(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        elapsed += 1;
        setRecordSeconds(elapsed);
        if (elapsed >= 60) {
          stopCamera();
        }
      }, 1000);
    } else {
      stopCamera();
    }
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMediaError(null);
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        setMediaError(`"${file.name}" is not a valid image file.`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        setMediaError(`"${file.name}" exceeds the 10 MB photo limit.`);
        continue;
      }
      if (photos.length >= 5) {
        setMediaError('Maximum 5 photographs per report.');
        break;
      }
      setPhotos((prev) => [...prev, { file, previewUrl: URL.createObjectURL(file) }]);
    }
    e.target.value = '';
  };

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMediaError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setMediaError('Please select a valid video file.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setMediaError('Video file exceeds the 50 MB limit.');
      return;
    }
    const url = URL.createObjectURL(file);
    const tempVid = document.createElement('video');
    tempVid.preload = 'metadata';
    tempVid.onloadedmetadata = () => {
      if (tempVid.duration > 60) {
        URL.revokeObjectURL(url);
        setMediaError('Video duration exceeds the 60-second limit.');
        return;
      }
      setVideo({ file, previewUrl: url, duration: Math.round(tempVid.duration) });
    };
    tempVid.src = url;
    e.target.value = '';
  };

  const runAiAnalysis = async () => {
    setAiLoading(true);
    setAiResult(null);
    try {
      let imageBase64: string | undefined;
      let imageMimeType: string | undefined;

      if (photos[0]) {
        const file = photos[0].file;
        imageMimeType = file.type;
        imageBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(file);
        });
      }

      const res = await apiFetch('/api/reports/ai-analyze', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          selectedCategory: category,
          imageBase64,
          imageMimeType,
          latitude: effectiveCoords?.latitude ?? null,
          longitude: effectiveCoords?.longitude ?? null,
        }),
      });
      setAiResult(res);
    } catch (err: any) {
      setAiResult({ available: false, error: err.message, potentialDuplicates: [] });
    } finally {
      setAiLoading(false);
    }
  };

  const applyAiSuggestions = () => {
    if (!aiResult?.available) return;
    if (aiResult.suggestedCategory) setCategory(aiResult.suggestedCategory);
    if (aiResult.suggestedSeverity) setSeverity(aiResult.suggestedSeverity);
    if (aiResult.suggestedTitle && !title.trim()) setTitle(aiResult.suggestedTitle);
    if (aiResult.suggestedDescription && !description.trim()) setDescription(aiResult.suggestedDescription);
  };

  const searchManualAddress = async () => {
    if (manualQuery.trim().length < 3) return;
    try {
      const res = await apiFetch(`/api/places/search?q=${encodeURIComponent(manualQuery.trim())}`);
      setManualResults(res.results || []);
    } catch {
      setManualResults([]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!effectiveCoords) {
      setSubmitError('Actual live GPS coordinates are required. Please grant location permission and capture your position.');
      return;
    }
    if (title.trim().length < 3 || description.trim().length < 5) {
      setSubmitError('Please provide an incident title and detailed description.');
      return;
    }

    const fd = new FormData();
    fd.append('category', category);
    fd.append('subType', subType);
    if (departmentId) fd.append('departmentId', departmentId);
    fd.append('title', title.trim());
    fd.append('description', description.trim());
    fd.append('severity', severity);
    fd.append('latitude', String(effectiveCoords.latitude));
    fd.append('longitude', String(effectiveCoords.longitude));
    if (effectiveCoords.accuracy !== null) fd.append('accuracyMeters', String(effectiveCoords.accuracy));
    fd.append('locationSource', effectiveCoords.source);
    if (manualLocation) {
      fd.append('formattedAddress', manualLocation.address);
      if (manualLocation.ward) fd.append('ward', manualLocation.ward);
    }
    fd.append('incidentTimestamp', new Date(incidentTime).toISOString());
    fd.append('contactPhone', contactPhone);
    fd.append('locationConsent', String(locationConsent));

    if (aiResult?.available) {
      if (aiResult.suggestedCategory) fd.append('aiSuggestedCategory', aiResult.suggestedCategory);
      if (aiResult.suggestedSeverity) fd.append('aiSuggestedSeverity', aiResult.suggestedSeverity);
      if (aiResult.summary) fd.append('aiSummary', aiResult.summary);
      if (aiResult.confidence !== undefined) fd.append('aiConfidence', String(aiResult.confidence));
    }

    for (const p of photos) {
      fd.append('photos', p.file);
    }
    if (video) {
      fd.append('video', video.file);
      fd.append('videoDurationSeconds', String(video.duration));
    }

    setSubmitting(true);
    setUploadProgress(0);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/reports', true);
    xhr.withCredentials = true;
    const token = getSessionToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        setUploadProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };
    xhr.onload = () => {
      setSubmitting(false);
      setUploadProgress(null);
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          onSubmitted(data.reportId);
        } else {
          setSubmitError(data.error || 'Failed to submit report.');
        }
      } catch {
        setSubmitError('Unexpected server response.');
      }
    };
    xhr.onerror = () => {
      setSubmitting(false);
      setUploadProgress(null);
      setSubmitError('Network error while uploading report. Your form data has been preserved.');
    };
    xhr.send(fd);
  };

  const locStatus = getLocationStateLabel(gps.state);

  return (
    <div className="space-y-6">
      {/* Category quick-selector bar ("separate Report New Issue action for every category") */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Report New Civic or Emergency Issue</h2>
            <p className="text-xs text-slate-500">
              Select a category, attach real camera or gallery evidence, acquire live GPS, and submit to authorities.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {REPORT_CATEGORIES.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => setCategory(c.name)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                category === c.name
                  ? 'bg-[#14532D] text-white border-[#14532D]'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">1. Incident Details</h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Issue Sub-Type</label>
                <select
                  value={subType}
                  onChange={(e) => setSubType(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                >
                  {activeCategoryObj.subTypes.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Relevant Department</label>
                <select
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                >
                  {departments.length === 0 ? (
                    <option value={departmentId}>Auto-routed Department</option>
                  ) : (
                    departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Severity Level</label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Critical">Critical (Urgent)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Incident Title</label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Deep waterlogged pothole near main market junction"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Detailed Description</label>
              <textarea
                required
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe exact landmark, danger level, or assistance needed..."
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Date &amp; Time of Incident</label>
                <input
                  type="datetime-local"
                  value={incidentTime}
                  onChange={(e) => setIncidentTime(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Mobile Number</label>
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>
          </div>

          {/* Evidence Capture & Upload */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-slate-900">2. Real Photo &amp; Video Evidence</h3>
                <p className="text-xs text-slate-500">
                  Max 5 photos (10 MB each) and 1 video (max 50 MB / 60 seconds). Stored privately.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => startCamera('photo')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-800 hover:bg-slate-50"
              >
                <Camera className="h-4 w-4" />
                Capture Photo
              </button>
              <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-800 hover:bg-slate-50 cursor-pointer">
                <Upload className="h-4 w-4" />
                Upload from Gallery
                <input type="file" accept="image/*" multiple onChange={handlePhotoSelect} className="hidden" />
              </label>
              <button
                type="button"
                onClick={() => startCamera('video')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-800 hover:bg-slate-50"
              >
                <Video className="h-4 w-4" />
                Record Video
              </button>
              <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-800 hover:bg-slate-50 cursor-pointer">
                <Upload className="h-4 w-4" />
                Upload Video
                <input type="file" accept="video/*" onChange={handleVideoSelect} className="hidden" />
              </label>
            </div>

            {cameraMode !== 'off' && (
              <div className="rounded-lg border border-slate-300 bg-slate-950 p-3 space-y-3">
                <video ref={videoPreviewRef} autoPlay playsInline muted className="w-full max-h-64 rounded object-cover" />
                <div className="flex items-center justify-between gap-2">
                  {cameraMode === 'photo' ? (
                    <button
                      type="button"
                      onClick={capturePhoto}
                      className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                    >
                      Take Snapshot
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={toggleVideoRecording}
                      className={`px-4 py-2 text-xs font-semibold rounded-lg text-white ${
                        recordingVideo ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
                      }`}
                    >
                      {recordingVideo ? `Stop Recording (${recordSeconds}s / 60s)` : 'Start Recording (Max 60s)'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="px-3 py-2 text-xs font-semibold rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
                  >
                    Close Camera
                  </button>
                </div>
              </div>
            )}

            {mediaError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 font-medium">
                {mediaError}
              </div>
            )}

            {photos.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {photos.map((p, idx) => (
                  <div key={p.previewUrl} className="relative rounded-lg border border-slate-200 overflow-hidden bg-slate-100">
                    <img src={p.previewUrl} alt={`Evidence ${idx + 1}`} className="w-full h-28 object-cover" />
                    <button
                      type="button"
                      onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute top-1.5 right-1.5 p-1 rounded bg-slate-900/80 text-white hover:bg-red-600"
                      title="Delete photo"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {video && (
              <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="font-medium">
                    Video attached ({video.duration}s · {(video.file.size / (1024 * 1024)).toFixed(1)} MB)
                  </span>
                  <button
                    type="button"
                    onClick={() => setVideo(null)}
                    className="text-red-600 hover:underline font-semibold"
                  >
                    Remove Video
                  </button>
                </div>
                <video src={video.previewUrl} controls className="w-full max-h-52 rounded bg-black" />
              </div>
            )}

            {/* AI Civic Intelligence Engine */}
            <div className="pt-3 border-t border-slate-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-slate-600">
                  Use Gemini Vision &amp; Text Intelligence to suggest category, severity, summary, and check duplicates.
                </div>
                <button
                  type="button"
                  disabled={aiLoading || (!description.trim() && photos.length === 0)}
                  onClick={runAiAnalysis}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {aiLoading ? 'Analyzing...' : 'Analyze with SEVA AI'}
                </button>
              </div>

              {aiResult && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5 space-y-2 text-xs">
                  {aiResult.available ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-emerald-900">
                          AI Suggestion — Review &amp; Confirm (Not an enforcement decision)
                        </span>
                        <button
                          type="button"
                          onClick={applyAiSuggestions}
                          className="px-2.5 py-1 rounded bg-[#14532D] text-white font-semibold hover:bg-[#166534]"
                        >
                          Apply Suggestions
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-slate-700">
                        <div>Category: <strong>{aiResult.suggestedCategory}</strong></div>
                        <div>Severity: <strong>{aiResult.suggestedSeverity}</strong></div>
                        <div className="col-span-2">Routed Dept: <strong>{aiResult.recommendedDepartmentName}</strong></div>
                        {aiResult.summary && <div className="col-span-2">Summary: {aiResult.summary}</div>}
                      </div>
                    </>
                  ) : (
                    <div className="text-amber-900">{aiResult.error}</div>
                  )}

                  {aiResult.potentialDuplicates?.length > 0 && (
                    <div className="pt-2 border-t border-emerald-200 text-amber-900 space-y-1">
                      <div className="font-semibold flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Potential Nearby / Similar Active Reports Detected:
                      </div>
                      {aiResult.potentialDuplicates.map((d: any) => (
                        <div key={d.id} className="font-mono text-[11px]">
                          {d.tracking_code} · {d.title} ({d.status})
                          {d.distance_meters !== null ? ` · ${d.distance_meters}m away` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Real Live GPS & Submit */}
        <div className="lg:col-span-5 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900">3. Live GPS Location</h3>
              <span
                className={`text-xs font-semibold ${
                  locStatus.tone === 'emerald'
                    ? 'text-emerald-700'
                    : locStatus.tone === 'amber'
                      ? 'text-amber-700'
                      : locStatus.tone === 'red'
                        ? 'text-red-700'
                        : 'text-slate-500'
                }`}
              >
                {locStatus.label}
              </span>
            </div>

            <p className="text-xs text-slate-600">
              Your actual device GPS coordinates ensure the right municipal ward or emergency unit responds accurately.
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setManualMode(false);
                  setManualLocation(null);
                  gps.startTracking();
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#14532D] text-white hover:bg-[#166534]"
              >
                <MapPin className="h-3.5 w-3.5" />
                {gps.isWatching ? 'Refresh Live GPS' : 'Detect Live GPS'}
              </button>
              <button
                type="button"
                onClick={() => setManualMode((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                <Search className="h-3.5 w-3.5" />
                Manual Location Entry
              </button>
            </div>

            {gps.errorMessage && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 space-y-2">
                <div>{gps.errorMessage}</div>
                <button
                  type="button"
                  onClick={gps.startTracking}
                  className="inline-flex items-center gap-1 font-semibold underline"
                >
                  <RefreshCw className="h-3 w-3" /> Retry GPS Detection
                </button>
              </div>
            )}

            {gps.location && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs space-y-1 font-mono tabular-nums">
                <div className="font-sans font-semibold text-emerald-900">Live GPS Coordinates Captured</div>
                <div>
                  Lat: {gps.location.latitude.toFixed(6)} · Lng: {gps.location.longitude.toFixed(6)}
                </div>
                <div>
                  Accuracy: ±{Math.round(gps.location.accuracy)} meters
                  {gps.location.accuracy > 150 && ' (Weak GPS — wait for better fix outdoors)'}
                </div>
              </div>
            )}

            {manualMode && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                <div className="text-xs font-semibold text-amber-900">
                  Manual Address Fallback (Labelled as manual, not live GPS)
                </div>
                <div className="flex gap-2">
                  <input
                    value={manualQuery}
                    onChange={(e) => setManualQuery(e.target.value)}
                    placeholder="Enter street, landmark, city..."
                    className="flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={searchManualAddress}
                    className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-xs font-semibold"
                  >
                    Find
                  </button>
                </div>
                {manualResults.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setManualLocation({
                        latitude: r.latitude,
                        longitude: r.longitude,
                        address: r.displayName,
                        ward: r.ward,
                      });
                      setManualResults([]);
                    }}
                    className="block w-full text-left text-xs p-2 rounded bg-white border border-slate-200 hover:border-[#14532D]"
                  >
                    {r.displayName}
                  </button>
                ))}
                {manualLocation && (
                  <div className="text-xs text-slate-700 font-medium">
                    Selected: {manualLocation.address}
                  </div>
                )}
              </div>
            )}

            <LiveMap
              center={effectiveCoords ? { latitude: effectiveCoords.latitude, longitude: effectiveCoords.longitude } : null}
              accuracyMeters={effectiveCoords?.accuracy}
              markers={accidentFacilities.map((f) => ({
                id: f.id,
                latitude: f.latitude,
                longitude: f.longitude,
                title: f.name,
                subtitle: `${f.category} · ${formatDistance(f.distanceMeters)}`,
                kind: f.category.toLowerCase().includes('police') ? 'police' : 'hospital',
                navigationUrl: f.navigationUrl,
              }))}
              heightClass="h-60"
            />

            {category === 'Road Accident' && effectiveCoords && (
              <div className="pt-2 border-t border-slate-200 space-y-2">
                <div className="text-xs font-semibold text-slate-900">
                  Nearby Hospitals &amp; Police Stations (Live GPS · OpenStreetMap)
                </div>
                {loadingFacilities ? (
                  <div className="text-xs text-slate-500">Searching nearby emergency facilities...</div>
                ) : accidentFacilities.length === 0 ? (
                  <div className="text-xs text-slate-500">No facilities returned within 6 km.</div>
                ) : (
                  <div className="max-h-44 overflow-y-auto space-y-2">
                    {accidentFacilities.slice(0, 5).map((f) => (
                      <div key={f.id} className="rounded border border-slate-200 p-2 text-xs flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate">{f.name}</div>
                          <div className="text-slate-500 truncate">
                            {f.category} · {formatDistance(f.distanceMeters)}
                            {f.phone ? ` · ${f.phone}` : ''}
                          </div>
                        </div>
                        <a
                          href={f.navigationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#14532D] hover:underline shrink-0"
                        >
                          <Navigation className="h-3 w-3" />
                          Navigate
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={locationConsent}
                onChange={(e) => setLocationConsent(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-[#14532D]"
              />
              <span>I consent to attach these GPS coordinates and evidence metadata to this report.</span>
            </label>

            {uploadProgress !== null && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-mono text-slate-600">
                  <span>Uploading evidence...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-[#14532D] transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}

            {submitError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                {submitError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 py-3 text-sm font-semibold text-white bg-[#14532D] hover:bg-[#166534] rounded-lg disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              {submitting ? 'Submitting Report...' : 'Submit Report to Authority'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
