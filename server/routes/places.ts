import express from 'express';
import { z } from 'zod';
import { forwardGeocodeAddress, reverseGeocodeCoords, searchNearbyPlaces } from '../places.ts';

export const placesRouter = express.Router();

placesRouter.get('/nearby', async (req, res) => {
  const schema = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    category: z.string().default('hospital'),
    radius: z.coerce.number().min(500).max(15000).default(5000),
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid live GPS latitude and longitude are required to search nearby places.' });
    return;
  }

  try {
    const result = await searchNearbyPlaces({
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      category: parsed.data.category,
      radiusMeters: parsed.data.radius,
    });
    res.json(result);
  } catch (err: any) {
    res.status(502).json({
      error: err?.message || 'Unable to reach OpenStreetMap nearby places provider. Please retry.',
    });
  }
});

placesRouter.get('/reverse', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: 'Valid latitude and longitude required.' });
    return;
  }
  const geo = await reverseGeocodeCoords(lat, lng);
  res.json(geo);
});

placesRouter.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) {
    res.status(400).json({ error: 'Enter at least 3 characters to search an address manually.' });
    return;
  }
  try {
    const results = await forwardGeocodeAddress(q);
    res.json({ results, provider: 'OpenStreetMap Nominatim (Manual Entry)' });
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'Address lookup failed.' });
  }
});
