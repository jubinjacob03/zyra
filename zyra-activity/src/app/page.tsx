"use client";

import { useEffect, useState, useRef } from "react";
import { Play, X, Search, Loader2, Info, Bell, User, ChevronDown, Volume2, ThumbsUp, Plus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useDiscordSync } from "@/lib/discord";
import { fetchTMDB, searchTMDB, CATEGORIES, TMDB_IMG_URL, TMDB_HERO_IMG_URL } from "@/lib/tmdb";

const SERVERS = [
  { name: "VidEasy", getUrl: (id: string, type: string) => `https://player.videasy.to/${type}/${id}` },
  { name: "VidSrc Pro", getUrl: (id: string, type: string) => `https://vidsrc.pro/embed/${type}/${id}` },
  { name: "VidLink", getUrl: (id: string, type: string) => `https://vidlink.pro/${type}/${id}` },
  { name: "SuperEmbed", getUrl: (id: string, type: string) => `https://superembed.stream/?video_id=${id}&tmdb=1` },
  { name: "AutoEmbed", getUrl: (id: string, type: string) => `https://autoembed.co/${type}/tmdb/${id}` },
];

export default function Home() {
  const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY || "";
  
  const [heroItem, setHeroItem] = useState<any>(null);
  const [rowsData, setRowsData] = useState<{ title: string; items: any[]; defaultType: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  const [playerOpen, setPlayerOpen] = useState(false);
  const [currentMedia, setCurrentMedia] = useState<{ id: string; type: string } | null>(null);
  const [serverIndex, setServerIndex] = useState(0);
  const [iframeLoading, setIframeLoading] = useState(false);
  const [iframeError, setIframeError] = useState(false);

  const { status, remoteState, broadcastState } = useDiscordSync();
  const isRemoteUpdate = useRef(false);
  const iframeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 0);
    window.addEventListener("scroll", handleScroll);

    // Inject popup blocker into our parent window
    const originalOpen = window.open;
    window.open = function() {
      console.log("Popup blocked by Zyra Parent Window!");
      return null;
    };

    // Intercept top-level redirects triggered by iframe ads
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // Required for Chrome to show the prompt
      return '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.open = originalOpen;
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    if (apiKey) {
      loadContent();
    }
  }, [apiKey]);

  useEffect(() => {
    if (remoteState) {
      isRemoteUpdate.current = true;
      if (remoteState.state === "play_media") {
        setCurrentMedia(remoteState.media);
        setServerIndex(remoteState.serverIndex);
        setPlayerOpen(true);
        setIframeLoading(true);
        setIframeError(false);
      } else if (remoteState.state === "close_media") {
        setPlayerOpen(false);
        setCurrentMedia(null);
      }
      setTimeout(() => {
        isRemoteUpdate.current = false;
      }, 500);
    }
  }, [remoteState]);

  const loadContent = async () => {
    setIsLoading(true);
    const trending = await fetchTMDB("/trending/all/day", apiKey);
    if (trending?.results?.length > 0) {
      setHeroItem(trending.results[0]);
    }

    const newRows = [];
    for (const cat of CATEGORIES) {
      const data = await fetchTMDB(cat.url, apiKey);
      if (data?.results?.length > 0) {
        newRows.push({
          title: cat.title,
          items: data.results,
          defaultType: cat.url.includes("/tv") ? "tv" : "movie",
        });
      }
    }
    setRowsData(newRows);
    setIsLoading(false);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    const results = await searchTMDB(searchQuery, apiKey);
    if (results?.results) {
      setSearchResults(results.results.filter((item: any) => item.poster_path && (item.media_type === "movie" || item.media_type === "tv")));
    }
    setIsSearching(false);
  };

  const openPlayer = (id: string, type: string, srvIdx = 0, broadcast = true) => {
    setCurrentMedia({ id, type });
    setServerIndex(srvIdx);
    setPlayerOpen(true);
    setIframeLoading(true);
    setIframeError(false);

    // Set a timeout to detect if the iframe fails to load
    if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
    iframeTimeoutRef.current = setTimeout(() => {
      if (iframeLoading) {
        setIframeError(true);
        setIframeLoading(false);
      }
    }, 10000); // 10 seconds timeout

    if (broadcast && !isRemoteUpdate.current) {
      broadcastState("play_media", { media: { id, type }, serverIndex: srvIdx });
    }
  };

  const closePlayer = (broadcast = true) => {
    setPlayerOpen(false);
    setCurrentMedia(null);
    if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);

    if (broadcast && !isRemoteUpdate.current) {
      broadcastState("close_media");
    }
  };

  const changeServer = (idx: number) => {
    setServerIndex(idx);
    setIframeLoading(true);
    setIframeError(false);
    
    if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
    iframeTimeoutRef.current = setTimeout(() => {
      if (iframeLoading) {
        setIframeError(true);
        setIframeLoading(false);
      }
    }, 10000);

    if (!isRemoteUpdate.current && currentMedia) {
      broadcastState("play_media", { media: currentMedia, serverIndex: idx });
    }
  };

  const handleIframeLoad = () => {
    setIframeLoading(false);
    setIframeError(false);
    if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
  };

  return (
    <div className="min-h-screen bg-[#141414] text-white overflow-x-hidden pb-20 font-sans selection:bg-[#e50914] selection:text-white">
      {/* Header */}
      <header className={`fixed top-0 w-full px-4 md:px-12 py-4 z-50 flex justify-between items-center transition-all duration-500 ${isScrolled ? 'bg-[#141414] shadow-lg' : 'bg-gradient-to-b from-black/90 via-black/50 to-transparent'}`}>
        <div className="flex items-center gap-8 md:gap-12">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-[#e50914] text-3xl md:text-4xl font-extrabold uppercase tracking-wider cursor-pointer"
            onClick={() => { setSearchQuery(""); setSearchResults([]); }}
          >
            NexFlix
          </motion.div>
          <nav className="hidden md:flex gap-6 text-sm font-medium text-gray-300">
            <a href="#" className="text-white font-bold transition-colors">Home</a>
            <a href="#" className="hover:text-gray-400 transition-colors">TV Shows</a>
            <a href="#" className="hover:text-gray-400 transition-colors">Movies</a>
            <a href="#" className="hover:text-gray-400 transition-colors">New & Popular</a>
            <a href="#" className="hover:text-gray-400 transition-colors">My List</a>
          </nav>
        </div>

        <div className="flex items-center gap-6">
          <motion.form 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            onSubmit={handleSearch} 
            className={`flex items-center bg-black/60 border transition-all duration-300 ${searchOpen ? 'border-white' : 'border-transparent'}`}
          >
            <Button 
              type="button" 
              variant="ghost" 
              size="icon" 
              className="rounded-none hover:bg-transparent"
              onClick={() => setSearchOpen(!searchOpen)}
            >
              <Search className="w-5 h-5 text-white" />
            </Button>
            <input 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Titles, people, genres" 
              className={`bg-transparent text-white text-sm outline-none transition-all duration-300 ${searchOpen ? 'w-48 md:w-64 px-2 py-1.5 opacity-100' : 'w-0 px-0 opacity-0'}`}
            />
            {isSearching && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          </motion.form>
          <Bell className="w-5 h-5 cursor-pointer hidden md:block hover:text-gray-300 transition-colors" />
          <div className="w-8 h-8 bg-gray-600 rounded flex items-center justify-center cursor-pointer hover:ring-2 ring-white transition-all">
            <User className="w-5 h-5" />
          </div>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {isLoading ? (
          /* Loading Skeletons */
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-32 px-12 space-y-12">
            <div className="w-full h-[60vh] bg-gray-800/50 animate-pulse rounded-lg" />
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-4">
                <div className="w-48 h-6 bg-gray-800/50 animate-pulse rounded" />
                <div className="flex gap-4 overflow-hidden">
                  {[1, 2, 3, 4, 5, 6].map((j) => (
                    <div key={j} className="w-[160px] aspect-[2/3] bg-gray-800/50 animate-pulse rounded-md shrink-0" />
                  ))}
                </div>
              </div>
            ))}
          </motion.div>
        ) : searchResults.length > 0 ? (
          /* Search Results View */
          <motion.div 
            key="search-results"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="pt-32 px-4 md:px-12"
          >
            <h2 className="text-2xl md:text-3xl font-bold mb-8 text-gray-400">Explore titles related to: <span className="text-white">{searchQuery}</span></h2>
            <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-3 md:gap-4">
              {searchResults.map((item) => (
                <motion.div 
                  key={item.id}
                  whileHover={{ scale: 1.05, zIndex: 10 }}
                  className="cursor-pointer relative group rounded-md overflow-hidden aspect-[2/3] shadow-lg"
                  onClick={() => openPlayer(item.id, item.media_type || "movie", 0)}
                >
                  <img 
                    src={`${TMDB_IMG_URL}${item.poster_path}`} 
                    alt={item.title || item.name} 
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Play className="w-12 h-12 text-white fill-white drop-shadow-lg" />
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        ) : (
          /* Main View */
          <motion.div 
            key="main-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Hero Section */}
            {heroItem && (
              <div className="relative h-[85vh] md:h-[95vh] w-full">
                <div className="absolute inset-0">
                  <img 
                    src={`${TMDB_HERO_IMG_URL}${heroItem.backdrop_path}`} 
                    className="w-full h-full object-cover"
                    alt="Hero Background"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#141414] via-[#141414]/70 to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-transparent" />
                </div>
                
                <motion.div 
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2, duration: 0.8 }}
                  className="relative z-10 flex flex-col justify-center h-full px-4 md:px-12 w-full md:w-[50%]"
                >
                  <h1 className="text-5xl md:text-7xl font-extrabold mb-4 drop-shadow-2xl leading-tight">
                    {heroItem.title || heroItem.name}
                  </h1>
                  <p className="text-lg md:text-xl mb-8 drop-shadow-md line-clamp-3 text-gray-200 font-medium max-w-2xl">
                    {heroItem.overview}
                  </p>
                  <div className="flex gap-4">
                    <Button 
                      size="lg" 
                      className="bg-white text-black hover:bg-white/80 font-bold text-lg md:text-xl px-6 md:px-8 py-6 rounded-md transition-transform hover:scale-105"
                      onClick={() => openPlayer(heroItem.id, heroItem.media_type || "movie", 0)}
                    >
                      <Play className="w-6 h-6 md:w-8 md:h-8 mr-2 fill-black" /> Play
                    </Button>
                    <Button 
                      size="lg" 
                      className="bg-gray-500/70 text-white hover:bg-gray-500/50 font-bold text-lg md:text-xl px-6 md:px-8 py-6 rounded-md transition-transform hover:scale-105"
                    >
                      <Info className="w-6 h-6 md:w-8 md:h-8 mr-2" /> More Info
                    </Button>
                  </div>
                </motion.div>
              </div>
            )}

            {/* Rows */}
            <div className="mt-[-100px] md:mt-[-150px] relative z-20 space-y-8 md:space-y-12 pb-12">
              {rowsData.map((row, idx) => (
                <motion.div 
                  key={idx} 
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 0.5 }}
                  className="px-4 md:px-12"
                >
                  <h2 className="text-xl md:text-2xl font-semibold mb-2 md:mb-4 text-[#e5e5e5] hover:text-white cursor-pointer transition-colors flex items-center group">
                    {row.title}
                    <span className="text-[#54b9c5] text-sm ml-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
                      Explore All <ChevronDown className="w-4 h-4 -rotate-90 ml-1" />
                    </span>
                  </h2>
                  <div className="flex gap-2 overflow-x-auto overflow-y-hidden scrollbar-hide pb-32 pt-16 -mt-16 -mb-20">
                    {row.items.map((item) => {
                      if (!item.poster_path) return null;
                      return (
                        <motion.div 
                          key={item.id} 
                          whileHover={{ scale: 1.3, zIndex: 50, y: -20 }}
                          transition={{ delay: 0.4, duration: 0.3 }}
                          className="relative w-[120px] md:w-[160px] shrink-0 cursor-pointer rounded-md shadow-xl group"
                          onClick={() => openPlayer(item.id, item.media_type || row.defaultType, 0)}
                        >
                          <img 
                            src={`${TMDB_IMG_URL}${item.poster_path}`} 
                            alt={item.title || item.name} 
                            className="w-full h-auto object-cover rounded-md group-hover:rounded-b-none transition-all duration-300"
                            loading="lazy"
                          />
                          {/* Advanced Hover Card Details */}
                          <div className="absolute top-full left-0 w-full bg-[#181818] p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-b-md shadow-[0_10px_20px_rgba(0,0,0,0.8)] pointer-events-none">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex gap-1">
                                <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
                                  <Play className="w-3 h-3 text-black fill-black ml-0.5" />
                                </div>
                                <div className="w-6 h-6 border-2 border-gray-500 rounded-full flex items-center justify-center">
                                  <Plus className="w-3 h-3 text-white" />
                                </div>
                                <div className="w-6 h-6 border-2 border-gray-500 rounded-full flex items-center justify-center">
                                  <ThumbsUp className="w-3 h-3 text-white" />
                                </div>
                              </div>
                              <div className="w-6 h-6 border-2 border-gray-500 rounded-full flex items-center justify-center">
                                <ChevronDown className="w-3 h-3 text-white" />
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-green-500 font-bold text-[10px]">{(item.vote_average * 10).toFixed(0)}% Match</span>
                              <span className="border border-gray-600 px-1 text-[8px] text-gray-300">HD</span>
                            </div>
                            <p className="text-white font-bold text-xs truncate">{item.title || item.name}</p>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Player Modal */}
      <AnimatePresence>
        {playerOpen && currentMedia && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black z-[100] flex flex-col"
          >
            {/* Auto-hiding Header */}
            <div className={`p-4 flex justify-between items-center bg-gradient-to-b from-black/90 via-black/60 to-transparent absolute top-0 w-full z-20 transition-opacity duration-300 pt-6 ${iframeLoading || iframeError ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}>
              <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4">
                <span className="text-gray-400 font-medium text-sm flex items-center mr-2 uppercase tracking-wider">Servers:</span>
                {SERVERS.map((srv, idx) => (
                  <Button 
                    key={idx}
                    variant={idx === serverIndex ? "default" : "secondary"}
                    className={`rounded-full px-6 transition-all duration-300 ${idx === serverIndex ? "bg-[#e50914] hover:bg-[#f40612] text-white font-bold shadow-[0_0_15px_rgba(229,9,20,0.5)]" : "bg-black/40 text-gray-300 hover:bg-white/20 hover:text-white backdrop-blur-md border border-white/10"}`}
                    onClick={() => changeServer(idx)}
                  >
                    {srv.name}
                  </Button>
                ))}
              </div>
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/20 rounded-full bg-black/40 backdrop-blur-md border border-white/10 w-10 h-10 mr-4" onClick={() => closePlayer()}>
                <X className="w-6 h-6" />
              </Button>
            </div>

            <div className="flex-1 w-full bg-black pt-0 relative flex items-center justify-center">
              {iframeLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#141414] z-10">
                  <div className="relative w-24 h-24 mb-8">
                    <div className="absolute inset-0 border-4 border-gray-800 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-[#e50914] rounded-full border-t-transparent animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Play className="w-8 h-8 text-[#e50914] ml-1" />
                    </div>
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-2 tracking-wide">Loading Stream</h3>
                  <p className="text-gray-400 font-medium">Connecting to <span className="text-white">{SERVERS[serverIndex].name}</span>...</p>
                </div>
              )}
              
              {iframeError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-10 px-4 text-center">
                  <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
                    <X className="w-8 h-8 text-[#e50914]" />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-2">Server Connection Failed</h3>
                  <p className="text-gray-400 mb-6 max-w-md">
                    {SERVERS[serverIndex].name} took too long to respond or refused to connect. Please try selecting a different server from the top menu.
                  </p>
                  <div className="flex gap-2 flex-wrap justify-center">
                    {SERVERS.map((srv, idx) => {
                      if (idx === serverIndex) return null;
                      return (
                        <Button 
                          key={idx}
                          variant="outline"
                          className="bg-gray-800 text-white border-gray-700 hover:bg-gray-700"
                          onClick={() => changeServer(idx)}
                        >
                          Try {srv.name}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}

              <iframe 
                src={SERVERS[serverIndex].getUrl(currentMedia.id, currentMedia.type)} 
                className={`w-full h-full border-0 transition-opacity duration-500 ${iframeLoading || iframeError ? 'opacity-0' : 'opacity-100'}`}
                allowFullScreen
                allow="autoplay; encrypted-media; fullscreen"
                referrerPolicy="no-referrer"
                onLoad={handleIframeLoad}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status Bar */}
      <motion.div 
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="fixed bottom-4 left-4 bg-black/80 text-gray-300 px-4 py-2 rounded-full text-sm z-50 backdrop-blur-md border border-gray-800 shadow-lg flex items-center gap-2"
      >
        <div className={`w-2 h-2 rounded-full animate-pulse ${status.includes("Offline") || status.includes("Error") ? "bg-red-500" : "bg-green-500"}`} />
        {status}
      </motion.div>
    </div>
  );
}