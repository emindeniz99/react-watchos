import { invoke } from "./invoke";

/** A place returned by {@link searchPOI}. */
export interface POIResult {
  lat: number;
  lon: number;
  /** The place name (e.g. "Blue Bottle Coffee"). */
  title: string;
  /** Locality/city, when MapKit provides one. */
  subtitle?: string;
}

/** Region bias for {@link searchPOI} — results near this center are preferred. */
export interface POISearchOptions {
  latitude?: number;
  longitude?: number;
  /** Region span in degrees (both axes). Defaults to 0.1 natively. */
  span?: number;
}

/**
 * Searches MapKit for points of interest matching a natural-language `query`
 * (e.g. "coffee", "gas station"), biased to the given region. Returns up to 15
 * places; an empty or failed search resolves to `[]` (never rejects for "no
 * results"), so the caller can bind the array straight to `Map` annotations.
 *
 * Async because it crosses the invoke channel to `MKLocalSearch`.
 */
export function searchPOI(
  query: string,
  options: POISearchOptions = {},
): Promise<POIResult[]> {
  return invoke<POIResult[]>("searchPOI", { query, ...options });
}
