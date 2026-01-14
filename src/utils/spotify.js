const axios = require('axios');

/**
 * Spotify Web API Client using Client Credentials Flow
 * Handles authentication and data fetching for public Spotify content
 */
class SpotifyAPI {
    constructor(clientId, clientSecret) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.accessToken = null;
        this.tokenExpiry = null;
        this.isAuthenticating = false;
    }

    /**
     * Authenticate using Client Credentials Flow
     * No user authorization required - only for public data
     */
    async authenticate() {
        if (this.isAuthenticating) {
           
            while (this.isAuthenticating) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return;
        }

        this.isAuthenticating = true;

        try {
            const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
            
            const response = await axios.post('https://accounts.spotify.com/api/token', 
                'grant_type=client_credentials', {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 10000
            });

            this.accessToken = response.data.access_token;
            this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
        } catch (error) {
            throw new Error('Failed to authenticate with Spotify API');
        } finally {
            this.isAuthenticating = false;
        }
    }

    /**
     * Ensure we have a valid access token
     */
    async ensureValidToken() {
        if (!this.accessToken || Date.now() >= this.tokenExpiry) {
            await this.authenticate();
        }
    }

    /**
     * Extract Spotify ID from various URL formats
     */
    static extractSpotifyId(url, type = 'track') {
        const patterns = {
            track: /spotify\.com\/track\/([a-zA-Z0-9]+)/,
            playlist: /spotify\.com\/playlist\/([a-zA-Z0-9]+)/,
            album: /spotify\.com\/album\/([a-zA-Z0-9]+)/
        };

        const match = url.match(patterns[type]);
        return match ? match[1] : null;
    }

    /**
     * Get track metadata from Spotify
     */
    async getTrack(trackId) {
        await this.ensureValidToken();
        
        try {
            const response = await axios.get(`https://api.spotify.com/v1/tracks/${trackId}`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` },
                timeout: 10000
            });
            return response.data;
        } catch (error) {
            if (error.response?.status === 404) {
                throw new Error('Spotify track not found');
            }
            throw new Error(`Failed to fetch Spotify track: ${error.message}`);
        }
    }

    /**
     * Get playlist tracks with pagination support
     * Handles large playlists efficiently
     */
    async getPlaylistTracks(playlistId) {
        await this.ensureValidToken();
        
        let tracks = [];
        let offset = 0;
        const limit = 50;
        let playlistInfo = null;

        try {
            do {
                const response = await axios.get(
                    `https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
                    headers: { 'Authorization': `Bearer ${this.accessToken}` },
                    params: { limit, offset, fields: 'items(track(id,name,artists,duration_ms,external_urls,type,is_local)),next,total' },
                    timeout: 15000
                });

               
                if (offset === 0) {
                    const playlistResponse = await axios.get(
                        `https://api.spotify.com/v1/playlists/${playlistId}`, {
                        headers: { 'Authorization': `Bearer ${this.accessToken}` },
                        params: { fields: 'name,description,images,external_urls,owner' },
                        timeout: 10000
                    });
                    playlistInfo = playlistResponse.data;
                }

                const validTracks = response.data.items.filter(item => {
                    if (!item || !item.track) {
                        return false;
                    }
                    
                    const track = item.track;
                    
                    if (!track.id) {
                        return false;
                    }
                    
                    if (track.type !== 'track') {
                        return false;
                    }
                    
                    if (track.is_local) {
                        return false;
                    }
                    
                    if (!track.name || !track.artists || track.artists.length === 0) {
                        return false;
                    }
                    
                    return true;
                });

                tracks.push(...validTracks);
                offset += limit;

               
                if (!response.data.next || tracks.length >= 500) break;

               
                await new Promise(resolve => setTimeout(resolve, 100));

            } while (true);

            return { tracks, playlistInfo };
        } catch (error) {
            if (error.response?.status === 404) {
                throw new Error('Spotify playlist not found or is private');
            }
            throw new Error(`Failed to fetch Spotify playlist: ${error.message}`);
        }
    }

    /**
     * Get album tracks
     */
    async getAlbumTracks(albumId) {
        await this.ensureValidToken();
        
        try {
            const [albumResponse, tracksResponse] = await Promise.all([
                axios.get(`https://api.spotify.com/v1/albums/${albumId}`, {
                    headers: { 'Authorization': `Bearer ${this.accessToken}` },
                    params: { fields: 'name,artists,images,external_urls,release_date' },
                    timeout: 10000
                }),
                axios.get(`https://api.spotify.com/v1/albums/${albumId}/tracks`, {
                    headers: { 'Authorization': `Bearer ${this.accessToken}` },
                    params: { limit: 50 },
                    timeout: 10000
                })
            ]);

            const albumInfo = albumResponse.data;
            const tracks = tracksResponse.data.items.filter(track => track.id && !track.is_local);

            return { tracks, albumInfo };
        } catch (error) {
            if (error.response?.status === 404) {
                throw new Error('Spotify album not found');
            }
            throw new Error(`Failed to fetch Spotify album: ${error.message}`);
        }
    }

    /**
     * Search Spotify for tracks
     */
    async searchTracks(query, limit = 10) {
        await this.ensureValidToken();
        
        try {
            const response = await axios.get('https://api.spotify.com/v1/search', {
                headers: { 'Authorization': `Bearer ${this.accessToken}` },
                params: {
                    q: query,
                    type: 'track',
                    limit: Math.min(limit, 50)
                },
                timeout: 10000
            });

            return response.data.tracks.items.filter(track => track.id && !track.is_local);
        } catch (error) {
            throw new Error(`Failed to search Spotify: ${error.message}`);
        }
    }
}

module.exports = SpotifyAPI;
