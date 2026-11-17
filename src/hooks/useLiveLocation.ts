import { useCallback, useEffect, useRef, useState } from 'react';

export type LocationState =
  | 'idle'
  | 'requesting_permission'
  | 'obtaining_gps'
  | 'improving_accuracy'
  | 'acquired'
  | 'weak_gps'
  | 'permission_denied'
  | 'gps_unavailable'
  | 'network_disconnected';

export interface GpsReading {
  latitude: number;
  longitude: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: string;
}

export function useLiveLocation(autoStart = false) {
  const [state, setState] = useState<LocationState>('idle');
  const [location, setLocation] = useState<GpsReading | null>(null);
  const [lastKnownLocation, setLastKnownLocation] = useState<GpsReading | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isWatching, setIsWatching] = useState(false);

  const watchIdRef = useRef<number | null>(null);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsWatching(false);
  }, []);

  const startTracking = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState('gps_unavailable');
      setErrorMessage('Geolocation is not supported by this browser or device.');
      return;
    }

    if (!navigator.onLine) {
      setState('network_disconnected');
    } else {
      setState('requesting_permission');
    }
    setErrorMessage(null);

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    setState('obtaining_gps');
    setIsWatching(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = pos.coords.accuracy;
        const reading: GpsReading = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: acc,
          heading: pos.coords.heading ?? null,
          speed: pos.coords.speed ?? null,
          timestamp: new Date(pos.timestamp || Date.now()).toISOString(),
        };

        setLocation(reading);
        setLastKnownLocation(reading);
        setErrorMessage(null);

        if (!navigator.onLine) {
          setState('network_disconnected');
        } else if (acc > 150) {
          setState('weak_gps');
        } else if (acc > 50) {
          setState('improving_accuracy');
        } else {
          setState('acquired');
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setState('permission_denied');
          setErrorMessage(
            'Location permission was denied. Enable GPS access in your browser/device settings and click Retry.'
          );
          stopTracking();
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setState('gps_unavailable');
          setErrorMessage('GPS signal unavailable on this device right now. Move outdoors or retry.');
        } else if (err.code === err.TIMEOUT) {
          setState('gps_unavailable');
          setErrorMessage('GPS fix timed out while waiting for high-accuracy coordinates. Please retry.');
        } else {
          setState('gps_unavailable');
          setErrorMessage(err.message || 'Unable to acquire live GPS location.');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      }
    );
  }, [stopTracking]);

  useEffect(() => {
    const onOffline = () => setState((prev) => (prev === 'acquired' ? 'network_disconnected' : prev));
    const onOnline = () => {
      if (location) {
        setState(location.accuracy > 150 ? 'weak_gps' : location.accuracy > 50 ? 'improving_accuracy' : 'acquired');
      }
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [location]);

  useEffect(() => {
    if (autoStart) {
      startTracking();
    }
    return () => {
      stopTracking();
    };
  }, [autoStart, startTracking, stopTracking]);

  return {
    state,
    location,
    lastKnownLocation,
    errorMessage,
    isWatching,
    startTracking,
    stopTracking,
  };
}

export function getLocationStateLabel(state: LocationState): { label: string; tone: 'emerald' | 'amber' | 'red' | 'slate' } {
  switch (state) {
    case 'requesting_permission':
      return { label: 'Requesting permission', tone: 'amber' };
    case 'obtaining_gps':
      return { label: 'Obtaining GPS', tone: 'amber' };
    case 'improving_accuracy':
      return { label: 'Improving accuracy', tone: 'amber' };
    case 'acquired':
      return { label: 'Location acquired', tone: 'emerald' };
    case 'weak_gps':
      return { label: 'Weak GPS', tone: 'amber' };
    case 'permission_denied':
      return { label: 'Permission denied', tone: 'red' };
    case 'gps_unavailable':
      return { label: 'GPS unavailable', tone: 'red' };
    case 'network_disconnected':
      return { label: 'Network disconnected', tone: 'red' };
    default:
      return { label: 'Location inactive', tone: 'slate' };
  }
}
