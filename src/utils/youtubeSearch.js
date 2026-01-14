const youtube = require('youtube-sr').default;

/**
 * Advanced YouTube Search Engine for Spotify-to-YouTube conversion
 * Uses multiple search strategies and similarity scoring for accurate matching
 */
class YouTubeSearchEngine {
    /**
     * Find the best YouTube match for a Spotify track
     * @param {Object} spotifyTrack - Spotify track object
     * @returns {Object|null} Best matching YouTube video or null
     */
    static async findBestMatch(spotifyTrack) {
        const { name: title, artists, duration_ms } = spotifyTrack;
        const artistNames = artists.map(a => a.name).join(' ');
        const primaryArtist = artists[0]?.name || '';
        const durationSeconds = Math.floor(duration_ms / 1000);

       
        const cleanTitle = this.cleanTrackTitle(title);

       
        const searchQueries = [
            `${cleanTitle} ${primaryArtist} official audio`,
            `${cleanTitle} ${primaryArtist} official video`,
            `${cleanTitle} ${primaryArtist} official`,
            `${title} ${primaryArtist} lyrics`,
            `${title} ${primaryArtist} music video`,
            `${title} ${artistNames}`,
            `${title} ${primaryArtist}`,
            `${cleanTitle} ${primaryArtist}`,
           
            `${title.split(' ')[0]} ${primaryArtist}`,
            `${primaryArtist} ${title}`,
           
            `${title}`,
            `${primaryArtist}`
        ];

        for (let i = 0; i < searchQueries.length; i++) {
            const query = searchQueries[i];
            
            try {
                const results = await Promise.race([
                    youtube.search(query, { 
                        limit: i < 4 ? 10 : 8,
                        type: 'video'
                    }),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Search timeout')), 10000)
                    )
                ]);
                
                if (!results || results.length === 0) {
                    continue;
                }

               
                const bestMatch = this.selectBestMatch(results, title, artistNames, durationSeconds);
                
                if (bestMatch) {
                    return bestMatch;
                }
                
               
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                continue;
            }
        }
        return null;
    }

    /**
     * Select the best match from YouTube search results using weighted scoring
     * @param {Array} results - YouTube search results
     * @param {string} originalTitle - Original Spotify track title
     * @param {string} artistNames - Artist names string
     * @param {number} targetDuration - Target duration in seconds
     * @returns {Object|null} Best matching video or null
     */
    static selectBestMatch(results, originalTitle, artistNames, targetDuration) {
        let bestMatch = null;
        let bestScore = 0;

        for (let i = 0; i < results.length; i++) {
            const video = results[i];
            if (!video || !video.title) {
                continue;
            }

            if (!video.duration || video.duration === 0) {
                continue;
            }

           
            let duration = video.duration;
            if (duration > 10000) {
                duration = Math.floor(duration / 1000);
            }

           
            if (duration < 10 || duration > 1200) {
                continue;
            }

           
            const titleScore = this.calculateTitleSimilarity(video.title, originalTitle);
            const artistScore = this.calculateArtistSimilarity(video.title, artistNames);
            const durationScore = this.calculateDurationSimilarity(duration, targetDuration);
            const channelScore = this.calculateChannelScore(video.channel?.name || '');
            
           
            const totalScore = (titleScore * 0.50) + (artistScore * 0.35) + (durationScore * 0.10) + (channelScore * 0.05);

           
            if (totalScore > bestScore && totalScore > 0.05) {
                bestScore = totalScore;
                bestMatch = video;
                bestMatch.matchScore = totalScore;
               
                bestMatch.correctedDuration = duration;
            }
        }

        return bestMatch;
    }

    /**
     * Calculate title similarity between YouTube and Spotify titles
     */
    static calculateTitleSimilarity(youtubeTitle, spotifyTitle) {
        const normalize = str => str.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const ytNorm = normalize(youtubeTitle);
        const spNorm = normalize(spotifyTitle);

       
        if (ytNorm.includes(spNorm) || spNorm.includes(ytNorm)) {
            return 1.0;
        }
        
       
        const ytWords = new Set(ytNorm.split(' ').filter(w => w.length > 0));
        const spWords = new Set(spNorm.split(' ').filter(w => w.length > 0));
        
        const intersection = new Set([...ytWords].filter(x => spWords.has(x)));
        const union = new Set([...ytWords, ...spWords]);
        
        const jaccardScore = union.size > 0 ? intersection.size / union.size : 0;
        
       
        let partialMatches = 0;
        for (const spWord of spWords) {
            for (const ytWord of ytWords) {
                if (spWord.length > 2 && ytWord.includes(spWord)) {
                    partialMatches++;
                    break;
                } else if (spWord.length <= 2 && ytWord === spWord) {
                    partialMatches++;
                    break;
                }
            }
        }
        
        const partialScore = spWords.size > 0 ? partialMatches / spWords.size : 0;
        
       
        return Math.max(jaccardScore, partialScore * 0.9);
    }

    /**
     * Calculate artist similarity in YouTube title
     */
    static calculateArtistSimilarity(youtubeTitle, artistNames) {
        const ytTitle = youtubeTitle.toLowerCase();
        const artists = artistNames.toLowerCase().split(/[,&\s]+/).filter(a => a.length > 0);
        
        let matchScore = 0;
        let totalArtists = artists.length;
        
        for (const artist of artists) {
           
            if (ytTitle.includes(artist)) {
                matchScore += artist === artists[0] ? 1.0 : 0.8;
            }
           
            else if (artist.length > 2) {
                const artistWords = artist.split(' ');
                let partialMatches = 0;
                for (const word of artistWords) {
                    if (word.length > 1 && ytTitle.includes(word)) {
                        partialMatches++;
                    }
                }
                if (partialMatches > 0) {
                    matchScore += (partialMatches / artistWords.length) * 0.7;
                }
            }
        }
        
        return totalArtists > 0 ? Math.min(matchScore / totalArtists, 1.0) : 0;
    }

    /**
     * Calculate duration similarity with tolerance
     */
    static calculateDurationSimilarity(youtubeDuration, spotifyDuration) {
        if (!youtubeDuration || !spotifyDuration) return 0.5;
        
        const diff = Math.abs(youtubeDuration - spotifyDuration);
        const avgDuration = (youtubeDuration + spotifyDuration) / 2;
        
       
        const tolerance = avgDuration * 0.30;
        
        if (diff === 0) return 1.0;
        if (diff <= 10) return 0.9;
        if (diff <= 30) return 0.8;
        if (diff <= tolerance) return Math.max(0.5, 1 - (diff / tolerance) * 0.4);
        
        return 0.3;
    }

    /**
     * Calculate channel credibility score
     * Official channels and known music channels get higher scores
     */
    static calculateChannelScore(channelName) {
        if (!channelName) return 0;
        
        const channel = channelName.toLowerCase();
        
       
        if (channel.includes('official') || channel.includes('vevo') || 
            channel.includes('records') || channel.includes('music')) {
            return 1.0;
        }
        
       
        if (channel.includes(' - topic')) {
            return 0.9;
        }
        
       
        const musicDistributors = ['warner', 'sony', 'universal', 'atlantic', 'columbia', 'emi'];
        if (musicDistributors.some(dist => channel.includes(dist))) {
            return 0.8;
        }
        
        return 0.3;
    }

    /**
     * Clean and format track title for better matching
     */
    static cleanTrackTitle(title) {
        return title
            .replace(/\(.*?\)/g, '')
            .replace(/\[.*?\]/g, '')
            .replace(/\s*-\s*remaster.*$/i, '')
            .replace(/\s*-\s*\d{4}.*$/i, '')
            .trim();
    }
}

module.exports = YouTubeSearchEngine;
