"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { Play, X, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDiscordSync } from "@/lib/discord";
import { useRouter, useSearchParams } from "next/navigation";

const SERVERS = [
  { name: "VidEasy", getUrl: (id: string, type: string) => `https://player.videasy.to/${type}/${id}` },
  { name: "VidSrc Pro", getUrl: (id: string, type: string) => `https://vidsrc.pro/embed/${type}/${id}` },
  { name: "VidLink", getUrl: (id: string, type: string) => `https://vidlink.pro/${type}/${id}` },
  { name: "SuperEmbed", getUrl: (id: string, type: string) => `https://superembed.stream/?video_id=${id}&tmdb=1` },
  { name: "AutoEmbed", getUrl: (id: string, type: string) => `https://autoembed.co/${type}/tmdb/${id}` },
];

function WatchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const type = searchParams.get("t") || "movie";
  const id = searchParams.get("v") || "";
  const initialServerIndex = parseInt(searchParams.get("server") || "0", 10);
  
  const [serverIndex, setServerIndex] = useState(initialServerIndex);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [iframeError, setIframeError] = useState(false);

  const { status, remoteState, broadcastState, logAction } = useDiscordSync();
  const isRemoteUpdate = useRef(false);
  const iframeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (logAction && id) logAction("watch_started", `Started watching ${type} ${id} on server ${SERVERS[serverIndex]?.name}`);
  }, [id, type, serverIndex, logAction]);

  useEffect(() => {
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
      window.open = originalOpen;
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
    iframeTimeoutRef.current = setTimeout(() => {
      if (iframeLoading) {
        setIframeError(true);
        setIframeLoading(false);
      }
    }, 10000);

    return () => {
      if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
    };
  }, [iframeLoading, serverIndex]);

  useEffect(() => {
    if (remoteState) {
      isRemoteUpdate.current = true;
      if (remoteState.state === "play_media") {
        if (remoteState.media.id !== id || remoteState.media.type !== type) {
          router.push(`/watch?t=${remoteState.media.type}&v=${remoteState.media.id}&server=${remoteState.serverIndex || 0}`);
        } else if (remoteState.serverIndex !== serverIndex) {
          setServerIndex(remoteState.serverIndex);
          setIframeLoading(true);
          setIframeError(false);
        }
      } else if (remoteState.state === "close_media") {
        router.push("/");
      }
      setTimeout(() => {
        isRemoteUpdate.current = false;
      }, 500);
    }
  }, [remoteState, id, type, serverIndex, router]);

  const changeServer = (idx: number) => {
    if (logAction) logAction("change_server", `Switched to server ${SERVERS[idx].name}`);
    setServerIndex(idx);
    setIframeLoading(true);
    setIframeError(false);
    
    if (!isRemoteUpdate.current) {
      broadcastState("play_media", { media: { id, type }, serverIndex: idx });
    }
  };

  const handleBack = () => {
    if (logAction) logAction("back_to_home", "Clicked back to home button");
    if (!isRemoteUpdate.current) {
      broadcastState("close_media");
    }
    router.push("/");
  };

  const handleIframeLoad = () => {
    setIframeLoading(false);
    setIframeError(false);
    if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
  };

  if (!id) return <div className="bg-black min-h-screen"></div>;

  return (
    <div className="fixed inset-0 bg-black z-[100] flex flex-col font-sans">
      <div className={`p-4 flex justify-between items-center bg-gradient-to-b from-black/90 via-black/60 to-transparent absolute top-0 w-full z-20 transition-opacity duration-300 pt-6 ${iframeLoading || iframeError ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}>
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            className="text-white hover:bg-white/20 rounded-full bg-black/40 backdrop-blur-md border border-white/10 ml-4 flex items-center" 
            onClick={handleBack}
          >
            <ArrowLeft className="w-5 h-5 mr-2" /> Back
          </Button>
          
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
        </div>
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
            <p className="text-gray-400 font-medium">Connecting to <span className="text-white">{SERVERS[serverIndex]?.name}</span>...</p>
          </div>
        )}
        
        {iframeError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-10 px-4 text-center">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
              <X className="w-8 h-8 text-[#e50914]" />
            </div>
            <h3 className="text-2xl font-bold text-white mb-2">Server Connection Failed</h3>
            <p className="text-gray-400 mb-6 max-w-md">
              {SERVERS[serverIndex]?.name} took too long to respond or refused to connect. Please try selecting a different server from the top menu.
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
          src={SERVERS[serverIndex]?.getUrl(id, type)} 
          className={`w-full h-full border-0 transition-opacity duration-500 ${iframeLoading || iframeError ? 'opacity-0' : 'opacity-100'}`}
          allowFullScreen
          allow="autoplay; encrypted-media; fullscreen"
          referrerPolicy="no-referrer"
          onLoad={handleIframeLoad}
        />
      </div>
    </div>
  );
}

export default function WatchPage() {
  return (
    <Suspense fallback={<div className="bg-black min-h-screen"></div>}>
      <WatchContent />
    </Suspense>
  );
}
