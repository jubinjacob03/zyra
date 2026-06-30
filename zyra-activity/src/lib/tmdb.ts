export const TMDB_BASE_URL = "https://api.themoviedb.org/3";
export const TMDB_IMG_URL = "https://image.tmdb.org/t/p/w500";
export const TMDB_HERO_IMG_URL = "https://image.tmdb.org/t/p/original";

export const CATEGORIES = [
  { title: "Now Trending", url: "/trending/all/day" },
  { title: "Anime", url: "/discover/tv?with_genres=16&with_original_language=ja" },
  { title: "English Movies", url: "/discover/movie?with_original_language=en" },
  { title: "English Series", url: "/discover/tv?with_original_language=en" },
  { title: "Hindi (Bollywood)", url: "/discover/movie?with_original_language=hi" },
  { title: "Malayalam", url: "/discover/movie?with_original_language=ml" },
  { title: "Tamil", url: "/discover/movie?with_original_language=ta" },
  { title: "Telugu", url: "/discover/movie?with_original_language=te" },
  { title: "Kannada", url: "/discover/movie?with_original_language=kn" },
  { title: "Korean (K-Drama)", url: "/discover/tv?with_original_language=ko" },
  { title: "Japanese (Live Action)", url: "/discover/movie?with_original_language=ja" },
];

export async function fetchTMDB(endpoint: string, apiKey: string) {
  if (!apiKey) return null;
  try {
    const separator = endpoint.includes("?") ? "&" : "?";
    const res = await fetch(`${TMDB_BASE_URL}${endpoint}${separator}api_key=${apiKey}`);
    return await res.json();
  } catch (e) {
    console.error(e);
    return null;
  }
}

export async function searchTMDB(query: string, apiKey: string) {
  if (!apiKey || !query) return null;
  try {
    const res = await fetch(`${TMDB_BASE_URL}/search/multi?query=${encodeURIComponent(query)}&api_key=${apiKey}`);
    return await res.json();
  } catch (e) {
    console.error(e);
    return null;
  }
}
