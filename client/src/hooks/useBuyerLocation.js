import { useCallback, useState } from 'react';
import { endpoints } from '../lib/api';

export const RADIUS_OPTIONS = [5, 10, 25, 50, 100, 250];

/**
 * Buyer-selected search location. Browser geolocation is offered first, but a
 * typed place always works — including when permission is denied, and when the
 * server has no geocoding provider configured (then the typed text filters by
 * city instead of by distance).
 */
export function useBuyerLocation() {
  const [origin, setOrigin] = useState(null);
  const [label, setLabel] = useState('');
  const [radiusKm, setRadiusKm] = useState(RADIUS_OPTIONS[3]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [places, setPlaces] = useState([]);
  const [geocodingEnabled, setGeocodingEnabled] = useState(true);

  const applyPlace = useCallback((place) => {
    setOrigin({ lat: place.latitude, lng: place.longitude });
    setLabel(place.displayName || [place.city, place.state].filter(Boolean).join(', '));
    setStatus('located');
    setError('');
    setPlaces([]);
  }, []);

  const useMyLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError('This browser cannot share a location. Search for a place below instead.');
      setStatus('denied');
      return;
    }
    setStatus('requesting');
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLabel('My current location');
        setStatus('located');
      },
      (err) => {
        setStatus('denied');
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was declined. You can search for a place instead.'
            : 'Could not read your location. You can search for a place instead.'
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }, []);

  const searchPlaces = useCallback(async (term) => {
    if (!term || term.trim().length < 2) {
      setPlaces([]);
      return [];
    }
    setStatus('searching');
    try {
      const res = await endpoints.marketplace.geocode(term.trim());
      const payload = res.data.data;
      setGeocodingEnabled(payload.enabled !== false);
      setPlaces(payload.results || []);
      setStatus('ready');
      return payload.results || [];
    } catch {
      setPlaces([]);
      setStatus('ready');
      return [];
    }
  }, []);

  const clear = useCallback(() => {
    setOrigin(null);
    setLabel('');
    setStatus('idle');
    setError('');
    setPlaces([]);
  }, []);

  return {
    origin,
    label,
    radiusKm,
    setRadiusKm,
    status,
    error,
    places,
    geocodingEnabled,
    applyPlace,
    useMyLocation,
    searchPlaces,
    clear,
  };
}
