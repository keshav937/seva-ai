import L from 'leaflet';
import { useEffect, useRef } from 'react';

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  subtitle?: string;
  kind?: 'user' | 'place' | 'hospital' | 'police' | 'report' | 'sos' | 'accident';
  navigationUrl?: string;
}

export interface HeatmapCircle {
  latitude: number;
  longitude: number;
  riskLevel: string;
  incidentCount: number;
  riskScore: number;
  ward?: string | null;
}

interface LiveMapProps {
  center?: { latitude: number; longitude: number } | null;
  accuracyMeters?: number | null;
  markers?: MapMarker[];
  trail?: Array<{ latitude: number; longitude: number }>;
  heatmapZones?: HeatmapCircle[];
  heightClass?: string;
  zoom?: number;
}

function createPinIcon(kind: MapMarker['kind'] = 'place'): L.DivIcon {
  const colors: Record<string, { bg: string; ring: string }> = {
    user: { bg: '#059669', ring: '#D1FAE5' },
    hospital: { bg: '#DC2626', ring: '#FEE2E2' },
    police: { bg: '#1E40AF', ring: '#DBEAFE' },
    sos: { bg: '#DC2626', ring: '#FCA5A5' },
    accident: { bg: '#D97706', ring: '#FEF3C7' },
    report: { bg: '#14532D', ring: '#DCFCE7' },
    place: { bg: '#0F172A', ring: '#E2E8F0' },
  };
  const c = colors[kind] || colors.place;
  const size = kind === 'user' || kind === 'sos' ? 18 : 14;

  return L.divIcon({
    className: 'seva-map-pin',
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${c.bg};border:3px solid ${c.ring};box-shadow:0 2px 6px rgba(0,0,0,0.28);"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function LiveMap({
  center,
  accuracyMeters,
  markers = [],
  trail = [],
  heatmapZones = [],
  heightClass = 'h-80',
  zoom = 14,
}: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialLat = center?.latitude ?? markers[0]?.latitude ?? heatmapZones[0]?.latitude ?? 20.5937;
    const initialLng = center?.longitude ?? markers[0]?.longitude ?? heatmapZones[0]?.longitude ?? 78.9629;
    const initialZoom = center || markers[0] || heatmapZones[0] ? zoom : 5;

    const map = L.map(containerRef.current, {
      center: [initialLat, initialLng],
      zoom: initialZoom,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    if (center) {
      map.setView([center.latitude, center.longitude], zoom, { animate: true });

      if (accuracyMeters && accuracyMeters > 0) {
        L.circle([center.latitude, center.longitude], {
          radius: Math.min(accuracyMeters, 2000),
          color: '#059669',
          fillColor: '#10B981',
          fillOpacity: 0.12,
          weight: 1.5,
        }).addTo(group);
      }

      L.marker([center.latitude, center.longitude], { icon: createPinIcon('user') })
        .bindPopup(
          `<div style="font-size:12px;"><strong>Your Live GPS</strong><br/>${center.latitude.toFixed(5)}, ${center.longitude.toFixed(5)}${accuracyMeters ? `<br/>Accuracy: ±${Math.round(accuracyMeters)}m` : ''}</div>`
        )
        .addTo(group);
    }

    if (trail.length > 1) {
      L.polyline(
        trail.map((p) => [p.latitude, p.longitude] as [number, number]),
        { color: '#DC2626', weight: 3, opacity: 0.85 }
      ).addTo(group);
    }

    for (const m of markers) {
      const marker = L.marker([m.latitude, m.longitude], { icon: createPinIcon(m.kind) });
      const navHtml = m.navigationUrl
        ? `<br/><a href="${m.navigationUrl}" target="_blank" rel="noopener noreferrer" style="color:#14532D;font-weight:600;text-decoration:underline;">Navigate &rarr;</a>`
        : '';
      marker.bindPopup(
        `<div style="font-size:12px;max-width:220px;"><strong>${m.title}</strong>${m.subtitle ? `<br/><span>${m.subtitle}</span>` : ''}${navHtml}</div>`
      );
      marker.addTo(group);
    }

    for (const z of heatmapZones) {
      const color =
        z.riskLevel === 'High reported risk'
          ? '#DC2626'
          : z.riskLevel === 'Moderate reported risk'
            ? '#D97706'
            : '#059669';
      L.circle([z.latitude, z.longitude], {
        radius: 280,
        color,
        fillColor: color,
        fillOpacity: 0.35,
        weight: 1.5,
      })
        .bindPopup(
          `<div style="font-size:12px;"><strong>${z.riskLevel}</strong><br/>Approved reports in grid: ${z.incidentCount}<br/>Area: ${z.ward || 'Anonymized Zone'}</div>`
        )
        .addTo(group);
    }

    if (!center && markers.length > 0) {
      const bounds = L.latLngBounds(markers.map((m) => [m.latitude, m.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
    } else if (!center && heatmapZones.length > 0) {
      const bounds = L.latLngBounds(heatmapZones.map((z) => [z.latitude, z.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
    }
  }, [center, accuracyMeters, markers, trail, heatmapZones, zoom]);

  return (
    <div
      ref={containerRef}
      className={`w-full ${heightClass} rounded-lg border border-slate-200 bg-slate-100 overflow-hidden`}
      aria-label="Interactive geospatial map"
    />
  );
}
