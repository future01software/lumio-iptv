import { Movie, Series } from "../types/iptv";

export function getRecommendedMovies(
  currentMovie: Movie,
  allMovies: Movie[],
  limit = 10
): Movie[] {
  // Find movies in the same group or similar name
  return allMovies
    .filter((m) => m.id !== currentMovie.id)
    .filter((m) => {
      if (m.group && currentMovie.group && m.group === currentMovie.group) {
        return true;
      }
      if (m.year && currentMovie.year && m.year === currentMovie.year) {
        return true;
      }
      // Very basic text similarity
      const nameMatch = m.name.split(" ")[0] === currentMovie.name.split(" ")[0];
      return nameMatch;
    })
    .slice(0, limit);
}

export function getRecommendedSeries(
  currentSeries: Series,
  allSeries: Series[],
  limit = 10
): Series[] {
  return allSeries
    .filter((s) => s.id !== currentSeries.id)
    .filter((s) => {
      if (s.group && currentSeries.group && s.group === currentSeries.group) {
        return true;
      }
      return false;
    })
    .slice(0, limit);
}
