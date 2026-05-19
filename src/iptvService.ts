/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Channel, Movie, Series, Program } from './mockData';

export interface Credentials {
  server: string;
  username: string;
  password: string;
}

export const fetchIPTV = async (creds: Credentials, action?: string, categoryId?: string) => {
  const params = new URLSearchParams({
    url: creds.server,
    username: creds.username,
    password: creds.password,
  });
  if (action) params.append('action', action);
  if (categoryId) params.append('category_id', categoryId);

  const response = await fetch(`https://iptv-app-1isz.onrender.com/api/iptv?${params.toString()}`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.details || `Server Error: ${response.status}`);
  }
  return response.json();
};

export const fetchEPG = async (creds: Credentials, streamId: string) => {
  const params = new URLSearchParams({
    url: creds.server,
    username: creds.username,
    password: creds.password,
    action: 'get_short_epg',
    stream_id: streamId,
  });

  const response = await fetch(`https://iptv-app-1isz.onrender.com/api/iptv?${params.toString()}`);
  if (!response.ok) return null;
  return response.json();
};

export const mapEPG = (data: any, channelId: string): Program[] => {
  const listings = data?.epg_listings || [];
  if (!Array.isArray(listings)) return [];

  return listings.map((item: any) => {
    // XC API dates can be strings "YYYY-MM-DD HH:MM:SS" or timestamps
    let start: Date;
    let end: Date;

    if (item.start_timestamp) {
      start = new Date(parseInt(item.start_timestamp) * 1000);
    } else if (item.start) {
      start = new Date(item.start.replace(' ', 'T'));
    } else {
      start = new Date();
    }

    if (item.stop_timestamp) {
      end = new Date(parseInt(item.stop_timestamp) * 1000);
    } else if (item.end) {
      end = new Date(item.end.replace(' ', 'T'));
    } else {
      end = new Date();
    }
    
    const decodeIfBase64 = (str: string) => {
      if (!str || typeof str !== 'string') return str;
      
      // XC API often returns base64 for titles if they contain special chars.
      // Heuristic: if it's reasonably long, no spaces, and valid base64 chars.
      // URL-safe base64 uses - and _ instead of + and /.
      const isBase64 = str.length > 4 && !str.includes(' ') && /^[a-zA-Z0-9\+\/_\-]*={0,2}$/.test(str);
      
      if (isBase64) {
        try { 
          // Normalize to standard base64 if it's URL-safe
          const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
          const binaryString = atob(normalized);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const decoded = new TextDecoder().decode(bytes);
          
          // Heuristic: only return decoded if it looks like meaningful text
          // and not just random binary data. 
          // Check for high percentage of printable characters.
          const printableCount = (decoded.match(/[\x20-\x7E\s\u00A0-\uFFFF]/g) || []).length;
          if (printableCount > decoded.length * 0.8) {
            return decoded;
          }
        } catch(e) { /* ignore */ }
      }
      return str;
    };

    return {
      id: String(item.id || Math.random()),
      channelId,
      title: decodeIfBase64(item.title) || 'No Title',
      description: decodeIfBase64(item.description) || 'No description available.',
      start,
      end
    };
  });
};

export const mapChannels = (data: any, creds: Credentials): Channel[] => {
  if (!Array.isArray(data)) return [];
  return data.map((item: any) => {
    // Some providers include basic now-playing info in the live stream objects
    // as epg_listings or specific fields like "epg_now_playing"
    const currentProgram = item.epg_listings?.[0]?.title || item.now_playing || item.name || 'No Information';
    
    return {
      id: String(item.stream_id || ''),
      name: String(item.name || 'Unnamed Channel'),
      logo: item.stream_icon || '',
      category: String(item.category_id !== undefined ? item.category_id : ''),
      streamUrl: `${creds.server.replace(/\/+$/, '')}/live/${creds.username}/${creds.password}/${item.stream_id}.ts`,
      epgTitle: currentProgram,
      epgTime: 'Loading Grid...',
      epgProgress: 0,
    };
  });
};

export const mapMovies = (data: any, creds: Credentials): Movie[] => {
  if (!Array.isArray(data)) return [];
  return data.map((item: any) => ({
    id: String(item.stream_id || ''),
    title: String(item.name || 'Unnamed Movie'),
    poster: item.stream_icon || '',
    year: parseInt(item.year) || 0,
    rating: item.rating || '0',
    plot: 'No description available.',
    streamUrl: `${creds.server.replace(/\/+$/, '')}/movie/${creds.username}/${creds.password}/${item.stream_id}.mp4`,
    category: String(item.category_id !== undefined ? item.category_id : ''),
  }));
};

export const mapSeries = (data: any, creds: Credentials): Series[] => {
  if (!Array.isArray(data)) return [];
  return data.map((item: any) => ({
    id: String(item.series_id || ''),
    title: String(item.name || 'Unnamed Series'),
    poster: item.cover || '',
    year: parseInt(item.releaseDate || item.last_modified) || 0,
    rating: item.rating || '0',
    plot: item.plot || 'No description available.',
    seasons: 0,
    category: String(item.category_id !== undefined ? item.category_id : ''),
  }));
};

export const fetchSeriesInfo = async (creds: Credentials, seriesId: string) => {
  const params = new URLSearchParams({
    url: creds.server,
    username: creds.username,
    password: creds.password,
    action: 'get_series_info',
    series_id: seriesId,
  });

  const response = await fetch(`https://iptv-app-1isz.onrender.com/api/iptv?${params.toString()}`);
  if (!response.ok) return null;
  return response.json();
};
export const mapIPTVCategories = (data: any): { id: string; name: string }[] => {
  let categories: any[] = [];
  
  if (Array.isArray(data)) {
    categories = data;
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.categories)) {
      categories = data.categories;
    } else {
      // Some providers return objects with numeric keys instead of an array
      categories = Object.values(data).filter(item => item && typeof item === 'object');
    }
  }

  return categories
    .filter(item => item && (item.category_id !== undefined || item.id !== undefined))
    .map((item: any) => ({
      id: String(item.category_id !== undefined ? item.category_id : item.id),
      name: String(item.category_name || item.name || 'Unknown Category'),
    }));
};
