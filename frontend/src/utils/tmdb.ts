const TMDB_BASE_URL = "https://api.themoviedb.org/3";

export interface TMDBMovie {
  id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  overview: string;
}

export interface TMDBSeries {
  id: number;
  name: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  vote_average: number;
  overview: string;
}

export interface TMDBVideo {
  key: string;
  site: string;
  type: string;
}

export const fetchTMDB = async (endpoint: string, apiKey: string, params: Record<string, string> = {}) => {
  if (!apiKey) return null;
  
  const query = new URLSearchParams({
    api_key: apiKey,
    language: "tr-TR",
    ...params
  }).toString();

  try {
    const res = await fetch(`${TMDB_BASE_URL}${endpoint}?${query}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("TMDB fetch error", err);
    return null;
  }
};

export const searchMovie = async (title: string, year: string | null, apiKey: string): Promise<TMDBMovie | null> => {
  if (!apiKey) return null;
  const params: Record<string, string> = { query: title };
  if (year) params.primary_release_year = year;
  
  const data = await fetchTMDB("/search/movie", apiKey, params);
  if (data?.results?.length > 0) {
    return data.results[0] as TMDBMovie;
  }
  return null;
};

export const searchSeries = async (title: string, year: string | null, apiKey: string): Promise<TMDBSeries | null> => {
  if (!apiKey) return null;
  const params: Record<string, string> = { query: title };
  if (year) params.first_air_date_year = year;
  
  const data = await fetchTMDB("/search/tv", apiKey, params);
  if (data?.results?.length > 0) {
    return data.results[0] as TMDBSeries;
  }
  return null;
};

/** Returns the bare YouTube video key (not a full URL) so callers can build either a
 * watch link or an embed URL for in-app playback. */
export const getMovieTrailer = async (id: number, apiKey: string): Promise<string | null> => {
  if (!apiKey) return null;
  const data = await fetchTMDB(`/movie/${id}/videos`, apiKey);
  const videos: TMDBVideo[] = data?.results || [];
  const trailer = videos.find(v => v.site === "YouTube" && v.type === "Trailer") || videos.find(v => v.site === "YouTube");
  return trailer ? trailer.key : null;
};

export const getSeriesTrailer = async (id: number, apiKey: string): Promise<string | null> => {
  if (!apiKey) return null;
  const data = await fetchTMDB(`/tv/${id}/videos`, apiKey);
  const videos: TMDBVideo[] = data?.results || [];
  const trailer = videos.find(v => v.site === "YouTube" && v.type === "Trailer") || videos.find(v => v.site === "YouTube");
  return trailer ? trailer.key : null;
};

export const getImageUrl = (path: string | null, size: "w500" | "w780" | "original" = "w500") => {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/${size}${path}`;
};
