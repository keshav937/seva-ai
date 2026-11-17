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

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// Simple short-lived cache to respect OpenStreetMap fair-use limits for identical GPS coords
const placesCache = new Map<string, { timestamp: number; places: NearbyPlace[]; provider: string }>();
const CACHE_TTL_MS = 60 * 1000;

function getNominatimQueriesForCategory(category: string): Array<{ query: string; label: string }> {
  switch (category) {
    case 'hospital':
      return [{ query: 'hospital', label: 'Hospital' }];
    case 'clinic':
      return [{ query: 'clinic', label: 'Clinic' }];
    case 'veterinary':
      return [
        { query: 'veterinary', label: 'Veterinary Clinic' },
        { query: 'animal hospital', label: 'Animal Hospital' },
      ];
    case 'police':
      return [{ query: 'police station', label: 'Police Station' }];
    case 'ambulance':
      return [{ query: 'ambulance', label: 'Ambulance Station' }, { query: 'hospital', label: 'Hospital' }];
    case 'pharmacy':
      return [{ query: 'pharmacy', label: 'Pharmacy' }];
    case 'mall':
      return [{ query: 'shopping mall', label: 'Shopping Mall' }];
    case 'restaurant':
      return [{ query: 'restaurant', label: 'Restaurant' }];
    case 'transit':
      return [
        { query: 'metro station', label: 'Metro Station' },
        { query: 'bus station', label: 'Bus Station' },
      ];
    case 'public':
      return [{ query: 'park', label: 'Public Park' }];
    case 'emergency_all':
      return [
        { query: 'hospital', label: 'Hospital' },
        { query: 'police station', label: 'Police Station' },
        { query: 'pharmacy', label: 'Pharmacy' },
      ];
    default:
      return [
        { query: 'hospital', label: 'Hospital' },
        { query: 'police station', label: 'Police Station' },
        { query: 'pharmacy', label: 'Pharmacy' },
        { query: 'restaurant', label: 'Restaurant' },
      ];
  }
}

async function searchViaNominatim(params: {
  lat: number;
  lng: number;
  category: string;
  radiusMeters: number;
}): Promise<NearbyPlace[]> {
  const latDelta = params.radiusMeters / 111320;
  const lngDelta = params.radiusMeters / (111320 * Math.max(0.2, Math.cos((params.lat * Math.PI) / 180)));
  const left = (params.lng - lngDelta).toFixed(5);
  const right = (params.lng + lngDelta).toFixed(5);
  const top = (params.lat + latDelta).toFixed(5);
  const bottom = (params.lat - latDelta).toFixed(5);

  const queries = getNominatimQueriesForCategory(params.category);
  const seen = new Set<string>();
  const places: NearbyPlace[] = [];

  for (const qItem of queries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
        qItem.query
      )}&viewbox=${left},${top},${right},${bottom}&bounded=1&limit=20&addressdetails=1`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'SEVA-AI-SmartCity-Platform/1.0',
          'Accept-Language': 'en-IN,en',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!resp.ok) continue;

      const rows = (await resp.json()) as any[];
      for (const r of rows) {
        const elLat = Number(r.lat);
        const elLon = Number(r.lon);
        const name = r.name || r.display_name?.split(',')[0]?.trim();
        if (!Number.isFinite(elLat) || !Number.isFinite(elLon) || !name) continue;

        const key = `${name.toLowerCase()}:${elLat.toFixed(4)}:${elLon.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const dist = haversineMeters(params.lat, params.lng, elLat, elLon);
        if (dist > params.radiusMeters * 1.25) continue;

        places.push({
          id: `osm-${r.osm_type || 'node'}-${r.osm_id || r.place_id}`,
          name,
          category: qItem.label,
          address: r.display_name || 'Address available via map navigation',
          phone: null,
          openingHours: null,
          latitude: elLat,
          longitude: elLon,
          distanceMeters: Math.round(dist),
          navigationUrl: `https://www.google.com/maps/dir/?api=1&destination=${elLat},${elLon}`,
          osmUrl: `https://www.openstreetmap.org/${r.osm_type || 'node'}/${r.osm_id || ''}`,
          source: 'OpenStreetMap',
        });
      }
    } catch {
      clearTimeout(timeout);
    }
  }

  places.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return places.slice(0, 30);
}

function buildOverpassQuery(lat: number, lng: number, radiusMeters: number, category: string): string {
  const r = Math.min(Math.max(radiusMeters, 500), 15000);
  let filters: string[] = [];

  switch (category) {
    case 'hospital':
      filters = [
        `nwr["amenity"="hospital"](around:${r},${lat},${lng});`,
      ];
      break;
    case 'clinic':
      filters = [
        `nwr["amenity"="clinic"](around:${r},${lat},${lng});`,
        `nwr["amenity"="doctors"](around:${r},${lat},${lng});`,
      ];
      break;
    case 'police':
      filters = [
        `nwr["amenity"="police"](around:${r},${lat},${lng});`,
      ];
      break;
    case 'ambulance':
      filters = [
        `nwr["emergency"="ambulance_station"](around:${r},${lat},${lng});`,
        `nwr["amenity"="hospital"](around:${r},${lat},${lng});`,
      ];
      break;
    case 'pharmacy':
      filters = [
        `nwr["amenity"="pharmacy"](around:${r},${lat},${lng});`,
      ];
      break;
    case 'mall':
      filters = [
        `nwr["shop"="mall"](around:${r},${lat},${lng});`,
        `nwr["shop"="department_store"](around:${r},${lat},${lng});`,
      ];
      break;
    case 'restaurant':
      filters = [
        `nwr["amenity"="restaurant"](around:${r},${lat},${lng});`,
        `nwr["amenity"="cafe"](around:${r},${lat},${lng});`,
      ];
      break;
    case 'transit':
      filters = [
        `nwr["railway"="station"](around:${r},${lat},${lng});`,
        `nwr["station"="subway"](around:${r},${lat},${lng});`,
        `nwr["amenity"="bus_station"](around:${r},${lat},${lng});`,
        `node["highway"="bus_stop"](around:${Math.min(r, 3000)},${lat},${lng});`,
      ];
      break;
    case 'public':
      filters = [
        `nwr["leisure"="park"](around:${r},${lat},${lng});`,
        `nwr["amenity"="community_centre"](around:${r},${lat},${lng});`,
        `nwr["amenity"="townhall"](around:${r},${lat},${lng});`,
      ];
      break;
    case 'emergency_all':
      filters = [
        `nwr["amenity"="hospital"](around:${r},${lat},${lng});`,
        `nwr["amenity"="police"](around:${r},${lat},${lng});`,
        `nwr["emergency"="ambulance_station"](around:${r},${lat},${lng});`,
        `nwr["amenity"="pharmacy"](around:${r},${lat},${lng});`,
      ];
      break;
    default:
      filters = [
        `nwr["amenity"~"hospital|clinic|police|pharmacy|bus_station|restaurant"](around:${r},${lat},${lng});`,
        `nwr["shop"="mall"](around:${r},${lat},${lng});`,
      ];
  }

  return `[out:json][timeout:7];(${filters.join('')});out center 40;`;
}

function formatOsmAddress(tags: Record<string, string>): string {
  const parts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:suburb'] || tags['addr:neighbourhood'],
    tags['addr:city'] || tags['addr:town'] || tags['addr:district'],
    tags['addr:state'],
    tags['addr:postcode'],
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  return tags['addr:full'] || tags['vicinity'] || 'Address details available via map navigation';
}

function inferCategoryLabel(tags: Record<string, string>): string {
  if (tags.emergency === 'ambulance_station') return 'Ambulance Station';
  if (tags.amenity === 'hospital') return 'Hospital';
  if (tags.amenity === 'clinic' || tags.amenity === 'doctors') return 'Clinic';
  if (tags.amenity === 'police') return 'Police Station';
  if (tags.amenity === 'pharmacy') return 'Pharmacy';
  if (tags.shop === 'mall' || tags.shop === 'department_store') return 'Shopping Mall';
  if (tags.amenity === 'restaurant') return 'Restaurant';
  if (tags.amenity === 'cafe') return 'Cafe';
  if (tags.station === 'subway') return 'Metro Station';
  if (tags.railway === 'station') return 'Railway / Metro Station';
  if (tags.amenity === 'bus_station' || tags.highway === 'bus_stop') return 'Bus Station / Stop';
  if (tags.leisure === 'park') return 'Public Park';
  if (tags.amenity === 'community_centre' || tags.amenity === 'townhall') return 'Public Civic Facility';
  return tags.amenity || tags.shop || tags.leisure || 'Public Place';
}

export async function searchNearbyPlaces(params: {
  lat: number;
  lng: number;
  category: string;
  radiusMeters?: number;
}): Promise<{ places: NearbyPlace[]; provider: string; queriedAt: string }> {
  const radius = params.radiusMeters || 5000;
  const cacheKey = `${params.lat.toFixed(3)}:${params.lng.toFixed(3)}:${params.category}:${radius}`;
  const cached = placesCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return {
      places: cached.places,
      provider: cached.provider,
      queriedAt: new Date(cached.timestamp).toISOString(),
    };
  }

  const query = buildOverpassQuery(params.lat, params.lng, radius, params.category);

  const queryOverpassMirror = async (endpoint: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SEVA-AI-SmartCity-Platform/1.0',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { elements?: any[] };
      return data.elements || [];
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  };

  try {
    const elements = await Promise.any(OVERPASS_ENDPOINTS.map((ep) => queryOverpassMirror(ep)));
    const seen = new Set<string>();
    const places: NearbyPlace[] = [];

    for (const el of elements) {
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      if (typeof elLat !== 'number' || typeof elLon !== 'number') continue;

      const tags = (el.tags || {}) as Record<string, string>;
      const name = tags.name || tags['name:en'];
      if (!name) continue;

      const dedupeKey = `${name.toLowerCase()}:${elLat.toFixed(4)}:${elLon.toFixed(4)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const dist = haversineMeters(params.lat, params.lng, elLat, elLon);
      places.push({
        id: `osm-${el.type}-${el.id}`,
        name,
        category: inferCategoryLabel(tags),
        address: formatOsmAddress(tags),
        phone: tags.phone || tags['contact:phone'] || tags['contact:mobile'] || null,
        openingHours: tags.opening_hours || null,
        latitude: elLat,
        longitude: elLon,
        distanceMeters: Math.round(dist),
        navigationUrl: `https://www.google.com/maps/dir/?api=1&destination=${elLat},${elLon}`,
        osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
        source: 'OpenStreetMap',
      });
    }

    places.sort((a, b) => a.distanceMeters - b.distanceMeters);
    const limited = places.slice(0, 30);
    const provider = 'OpenStreetMap (Overpass API)';
    placesCache.set(cacheKey, { timestamp: Date.now(), places: limited, provider });

    return {
      places: limited,
      provider,
      queriedAt: new Date().toISOString(),
    };
  } catch {
    // Fallback to genuine OpenStreetMap Nominatim bounded POI search if Overpass mirrors are congested
    const nominatimPlaces = await searchViaNominatim({
      lat: params.lat,
      lng: params.lng,
      category: params.category,
      radiusMeters: radius,
    });
    const provider = 'OpenStreetMap (Nominatim Bounded Search)';
    placesCache.set(cacheKey, { timestamp: Date.now(), places: nominatimPlaces, provider });
    return {
      places: nominatimPlaces,
      provider,
      queriedAt: new Date().toISOString(),
    };
  }
}

export async function reverseGeocodeCoords(lat: number, lng: number): Promise<{
  formattedAddress: string;
  ward: string | null;
  city: string | null;
  provider: string;
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'SEVA-AI-SmartCity-Platform/1.0',
          'Accept-Language': 'en-IN,en',
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    if (!resp.ok) {
      return {
        formattedAddress: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        ward: null,
        city: null,
        provider: 'GPS Coordinates (Reverse geocode unavailable)',
      };
    }
    const data = await resp.json() as any;
    const addr = data.address || {};
    return {
      formattedAddress: data.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      ward: addr.suburb || addr.neighbourhood || addr.city_district || null,
      city: addr.city || addr.town || addr.state_district || null,
      provider: 'OpenStreetMap Nominatim',
    };
  } catch {
    return {
      formattedAddress: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      ward: null,
      city: null,
      provider: 'GPS Coordinates',
    };
  }
}

export async function forwardGeocodeAddress(query: string): Promise<Array<{
  displayName: string;
  latitude: number;
  longitude: number;
  ward: string | null;
  city: string | null;
}>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const resp = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&countrycodes=in&limit=5&addressdetails=1`,
    {
      headers: {
        'User-Agent': 'SEVA-AI-SmartCity-Platform/1.0',
        'Accept-Language': 'en-IN,en',
      },
      signal: controller.signal,
    }
  );
  clearTimeout(timeout);
  if (!resp.ok) {
    throw new Error(`Address lookup failed with HTTP ${resp.status}`);
  }
  const rows = (await resp.json()) as any[];
  return rows.map((r) => ({
    displayName: r.display_name,
    latitude: Number(r.lat),
    longitude: Number(r.lon),
    ward: r.address?.suburb || r.address?.neighbourhood || null,
    city: r.address?.city || r.address?.town || null,
  }));
}
