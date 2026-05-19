/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Tv, Film, Clapperboard, Settings as SettingsIcon, Heart, Play, Pause, Volume2, Maximize, X, Search, Star, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { MOCK_CHANNELS, MOCK_MOVIES, MOCK_SERIES, MOCK_PROGRAMS, Channel, Movie, Series, Program } from './mockData';
import { Credentials, fetchIPTV, mapChannels, mapMovies, mapSeries, mapIPTVCategories, fetchEPG, mapEPG } from './iptvService';

type ViewMode = 'channels' | 'movies' | 'series' | 'settings' | 'search';

const isBackKey = (key: string) => 
  key === 'Backspace' || 
  key === 'Escape' || 
  key === 'BrowserBack' || 
  key === 'Back' || 
  key === 'GoBack';

export default function App() {
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    console.log("App mounted");
  }, []);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [rememberMe, setRememberMe] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('channels');
  const [focusedIndex, setFocusedIndex] = useState(1);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [epgData, setEpgData] = useState<Record<string, Program[]>>({});
  const [liveCategories, setLiveCategories] = useState<{ id: string; name: string }[]>([]);
  const [movieCategories, setMovieCategories] = useState<{ id: string; name: string }[]>([]);
  const [seriesCategories, setSeriesCategories] = useState<{ id: string; name: string }[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [selectedVOD, setSelectedVOD] = useState<any>(null);
  const [focusArea, setFocusArea] = useState<'sidebar' | 'search' | 'groups' | 'epg'>('sidebar');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [focusedGroupIndex, setFocusedGroupIndex] = useState(0);
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [favoritePromptChannel, setFavoritePromptChannel] = useState<Channel | null>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isLongPressActive = useRef(false);

  // Refs for auto-scrolling
  const groupsListRef = useRef<HTMLDivElement>(null);
  const contentListRef = useRef<HTMLDivElement>(null);

  // Function to scroll focused element into view
  const scrollFocusedIntoView = useCallback((containerRef: React.RefObject<HTMLElement | null>, selector: string) => {
    const container = containerRef.current;
    if (!container) return;
    const focused = container.querySelector(selector);
    if (focused) {
      focused.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  // Update scrolling when focused indices change
  useEffect(() => {
    if (focusArea === 'groups') {
      scrollFocusedIntoView(groupsListRef, '[data-focused="true"]');
    }
  }, [focusedGroupIndex, focusArea, scrollFocusedIntoView]);

  useEffect(() => {
    if (focusArea === 'epg') {
      scrollFocusedIntoView(contentListRef, '[data-focused="true"]');
    }
  }, [focusedIndex, focusArea, scrollFocusedIntoView]);

  // Function to toggle favorite
  const toggleFavorite = useCallback((channelId: string) => {
    setFavorites(prev => 
      prev.includes(channelId) 
        ? prev.filter(id => id !== channelId) 
        : [...prev, channelId]
    );
  }, []);

  const handleLogin = async (loginCreds: Credentials, saveLogin: boolean = false) => {
    setIsLoading(true);
    setLoadingStep('Authenticating...');
    try {
      // Validate login
      const info = await fetchIPTV(loginCreds);
      
      // Validate login - Some providers return different structures
      if (info.user_info?.auth === 0 || info.status === 'error' || info.error) {
        throw new Error(info.error || info.message || 'Invalid credentials');
      }

      setLoadingStep('Downloading Live Channels...');
      const [liveData, liveCats] = await Promise.all([
        fetchIPTV(loginCreds, 'get_live_streams'),
        fetchIPTV(loginCreds, 'get_live_categories')
      ]);

      setLoadingStep('Initializing...');
      const mappedChannels = mapChannels(Array.isArray(liveData) ? liveData : [], loginCreds);
      const mappedLiveCats = [{ id: 'fav', name: 'Favorites' }, { id: 'all', name: 'All Channels' }, ...mapIPTVCategories(liveCats)];
      
      setCreds(loginCreds);
      
      if (saveLogin) {
        localStorage.setItem('iptv_creds', JSON.stringify(loginCreds));
      } else {
        localStorage.removeItem('iptv_creds');
      }

      setChannels(mappedChannels); 
      setLiveCategories(mappedLiveCats);
      
      // Auto-resume last played channel based on settings
      const lastPlayedId = localStorage.getItem('last_played_channel_id');
      const startMode = localStorage.getItem('startup_behavior') || 'last_channel';
      const lastChannel = lastPlayedId ? mappedChannels.find(c => c.id === lastPlayedId) : null;

      if (lastChannel) {
        setSelectedChannel(lastChannel);
        if (startMode === 'last_channel') {
          setFullContentMode(true);
        }
      } else if (mappedChannels.length > 0) {
        setSelectedChannel(mappedChannels[0]);
      }

      setIsLoggedIn(true);

      // BACKGROUND DOWNLOADS START HERE
      (async () => {
        try {
          // Download Movie Categories & Data
          const [movieData, movieCats] = await Promise.all([
            fetchIPTV(loginCreds, 'get_vod_streams'),
            fetchIPTV(loginCreds, 'get_vod_categories')
          ]);
          const mappedMovies = mapMovies(Array.isArray(movieData) ? movieData : [], loginCreds);
          const mappedMovieCats = [{ id: 'all', name: 'All Movies' }, ...mapIPTVCategories(movieCats)];
          setMovies(mappedMovies);
          setMovieCategories(mappedMovieCats);

          // Download Series Categories & Data
          const [seriesData, seriesCats] = await Promise.all([
            fetchIPTV(loginCreds, 'get_series'),
            fetchIPTV(loginCreds, 'get_series_categories')
          ]);
          const mappedSeries = mapSeries(Array.isArray(seriesData) ? seriesData : [], loginCreds);
          const mappedSeriesCats = [{ id: 'all', name: 'All Series' }, ...mapIPTVCategories(seriesCats)];
          setSeries(mappedSeries);
          setSeriesCategories(mappedSeriesCats);
        } catch (bgErr) {
          console.error("Background data fetch failed:", bgErr);
        }
      })();
    } catch (err: any) {
      console.error("Login Error:", err);
      
      const isDemo = loginCreds.username === 'demo' && loginCreds.password === 'demo';
      
      if (isDemo) {
        // Fallback to mock data for demo
        setChannels(MOCK_CHANNELS);
        setMovies(MOCK_MOVIES);
        setSeries(MOCK_SERIES);
        setLiveCategories([
          { id: 'fav', name: 'Favorites' },
          { id: 'all', name: 'All Channels' },
          { id: 'Movies', name: 'Movies' },
          { id: 'News', name: 'News' }
        ]);
        setMovieCategories([{ id: 'all', name: 'All Movies' }]);
        setSeriesCategories([{ id: 'all', name: 'All Series' }]);
        
        // Auto-resume last played channel for demo
        const lastPlayedId = localStorage.getItem('last_played_channel_id');
        const lastChannel = lastPlayedId ? MOCK_CHANNELS.find(c => c.id === lastPlayedId) : null;
        
        if (lastChannel) {
          setSelectedChannel(lastChannel);
          setFullContentMode(true);
        } else if (MOCK_CHANNELS.length > 0) {
          setSelectedChannel(MOCK_CHANNELS[0]);
        }
        
        setIsLoggedIn(true);
      } else {
        const message = err.message || 'Connection failed';
        alert(`Login failed: ${message}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Check for saved login on mount
  useEffect(() => {
    const saved = localStorage.getItem('iptv_creds');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        handleLogin(parsed, true)
          .catch((err) => {
            console.error("Auto-login failed:", err);
            setIsInitializing(false);
          })
          .finally(() => {
            // Short delay to ensure state transitions are clean
            setTimeout(() => setIsInitializing(false), 200);
          });
      } catch (e) {
        console.error("Failed to parse saved credentials");
        setIsInitializing(false);
      }
    } else {
      setIsInitializing(false);
    }
  }, []);

  // Memoized Filtered Lists
  const filteredChannels = useMemo(() => {
    return channels.filter(ch => {
      const matchesCategory = selectedCategoryId === 'all' || 
        (selectedCategoryId === 'fav' ? favorites.includes(ch.id) : ch.category === selectedCategoryId);
      const matchesSearch = !searchQuery || ch.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [channels, selectedCategoryId, favorites, searchQuery]);

  const filteredMovies = useMemo(() => {
    return movies.filter(m => {
      const matchesCategory = selectedCategoryId === 'all' || m.category === selectedCategoryId;
      const matchesSearch = !searchQuery || m.title.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [movies, selectedCategoryId, searchQuery]);

  const filteredSeries = useMemo(() => {
    return series.filter(s => {
      const matchesCategory = selectedCategoryId === 'all' || s.category === selectedCategoryId;
      const matchesSearch = !searchQuery || s.title.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [series, selectedCategoryId, searchQuery]);

  // EPG Cache Helpers
  const saveEPGCache = (id: string, programs: Program[]) => {
    try {
      const cacheObj = {
        timestamp: Date.now(),
        programs: programs.map(p => ({
          ...p,
          start: p.start.toISOString(),
          end: p.end.toISOString()
        }))
      };
      localStorage.setItem(`epg_cache_${id}`, JSON.stringify(cacheObj));
    } catch (e) {
      console.warn(`Failed to cache EPG for ${id}`, e);
    }
  };

  const getEPGCache = (id: string): Program[] | null => {
    try {
      const cached = localStorage.getItem(`epg_cache_${id}`);
      if (!cached) return null;
      const { timestamp, programs } = JSON.parse(cached);
      const oneDay = 24 * 60 * 60 * 1000;
      if (Date.now() - timestamp < oneDay) {
        return programs.map((p: any) => ({
          ...p,
          start: new Date(p.start),
          end: new Date(p.end)
        }));
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  // EPG Auto Refresh on Start & Focus
  useEffect(() => {
    if (isLoggedIn && channels.length > 0 && creds) {
      const fetchAllEPG = async () => {
        const BATCH_SIZE = 50;
        
        // Prioritize favorites first
        const favChannels = channels.filter(c => favorites.includes(c.id));
        const otherChannels = channels.filter(c => !favorites.includes(c.id));
        const prioritizedOrder = [...favChannels, ...otherChannels];
        const totalChannels = prioritizedOrder.length;
        
        for (let i = 0; i < totalChannels; i += BATCH_SIZE) {
          const batch = prioritizedOrder.slice(i, i + BATCH_SIZE);
          
          await Promise.all(batch.map(async (ch) => {
            if (!epgData[ch.id]) {
              const cached = getEPGCache(ch.id);
              if (cached) {
                setEpgData(prev => ({ ...prev, [ch.id]: cached }));
              } else {
                try {
                  const data = await fetchEPG(creds, ch.id);
                  if (data) {
                    const programs = mapEPG(data, ch.id);
                    setEpgData(prev => ({ ...prev, [ch.id]: programs }));
                    saveEPGCache(ch.id, programs);
                  }
                } catch (err) {
                  console.warn(`EPG init failed for ${ch.id}`, err);
                }
              }
            }
          }));
          
          // Small delay between batches to avoid overwhelming the provider
          if (i + BATCH_SIZE < totalChannels) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      };

      fetchAllEPG();
    }
  }, [isLoggedIn, channels.length, creds]);

  // Fetch EPG for focused channel if missing
  useEffect(() => {
    if (isLoggedIn && focusArea === 'epg' && creds) {
      const channel = filteredChannels[focusedIndex];
      if (channel && !epgData[channel.id]) {
        // Check cache first
        const cached = getEPGCache(channel.id);
        if (cached) {
          setEpgData(prev => ({ ...prev, [channel.id]: cached }));
        } else {
          fetchEPG(creds, channel.id).then(data => {
            if (data) {
               const programs = mapEPG(data, channel.id);
               setEpgData(prev => ({ ...prev, [channel.id]: programs }));
               saveEPGCache(channel.id, programs);
            }
          }).catch(err => console.warn(`Focused EPG load failed for ${channel.id}`, err));
        }
      }
    }
  }, [focusedIndex, focusArea, isLoggedIn, creds, filteredChannels]);

  const [fullContentMode, setFullContentMode] = useState(false);
  const [startupBehavior, setStartupBehavior] = useState<'guide' | 'last_channel'>(
    (localStorage.getItem('startup_behavior') as any) || 'last_channel'
  );

  // Sync Full Screen Mode with Browser History for Back button support
  useEffect(() => {
    if (fullContentMode) {
      window.history.pushState({ modal: 'fullContent' }, '');
      
      const handlePopState = () => {
        setFullContentMode(false);
      };
      
      window.addEventListener('popstate', handlePopState);
      return () => {
        window.removeEventListener('popstate', handlePopState);
        if (window.history.state?.modal === 'fullContent') {
          window.history.back();
        }
      };
    }
  }, [fullContentMode]);

  const [activeExternalKey, setActiveExternalKey] = useState<((key: string) => void) | null>(null);

  // Handle spatial navigation emulated by keyboard
  const processKey = useCallback((key: string) => {
    // If long press just triggered the prompt, don't execute the standard Enter action
    if (key === 'Enter' && isLongPressActive.current) {
      isLongPressActive.current = false;
      return;
    }

    // Exit full screen always takes priority
    if (fullContentMode && isBackKey(key)) {
      setFullContentMode(false);
      return;
    }

    // Modal behavior takes precedence
    if (selectedVOD) return;

    if (!isLoggedIn || fullContentMode) return;

    const currentCategories = 
      viewMode === 'channels' ? liveCategories : 
      viewMode === 'movies' ? movieCategories : 
      seriesCategories;

    // Add "Long Press" simulation
    if (key === 'f' && viewMode === 'channels' && focusArea === 'content') {
      const currentChannel = filteredChannels[focusedIndex];
      if (currentChannel) toggleFavorite(currentChannel.id);
    }

    const COL_COUNT = 5;

    // Handle search input focus
    if (focusArea === 'search') {
      if (key === 'ArrowDown') {
        if (viewMode === 'search') {
          setFocusArea('epg');
          setFocusedIndex(0);
        } else {
          setFocusArea('sidebar');
          setFocusedIndex(0);
        }
        return;
      }
      if (key === 'ArrowRight') {
        if (viewMode === 'search') {
          setFocusArea('epg');
          setFocusedIndex(0);
        } else {
          setFocusArea('groups');
          setFocusedIndex(0);
        }
        return;
      }
      if (key === 'ArrowLeft') {
        setFocusArea('sidebar');
        setFocusedIndex(0); 
        return;
      }
      if (key === 'Enter') {
        searchInputRef.current?.focus();
        return;
      }
      if (key === 'Escape' || (key === 'Backspace' && searchQuery === '')) {
        setFocusArea('sidebar');
        setFocusedIndex(4);
        searchInputRef.current?.blur();
        return;
      }
      return; 
    }

    switch (key) {
      case 'ArrowLeft':
        if (focusArea === 'epg') {
          if (viewMode === 'search') {
             setFocusArea('sidebar');
             setFocusedIndex(0);
          } else if (viewMode === 'movies' || viewMode === 'series') {
            if (focusedIndex % COL_COUNT === 0) {
              setFocusArea('groups');
              setFocusedIndex(focusedGroupIndex);
            } else {
              setFocusedIndex(prev => Math.max(0, prev - 1));
            }
          } else {
            setFocusArea('groups');
          }
        } else if (focusArea === 'groups') {
           setFocusArea('sidebar');
           const sidebarViews: (ViewMode | string)[] = ['search', 'channels', 'movies', 'series', 'mylist', 'settings'];
           const idx = sidebarViews.indexOf(viewMode);
           setFocusedIndex(idx !== -1 ? idx : 1);
        }
        break;
      case 'ArrowRight':
        if (focusArea === 'sidebar') {
           if (viewMode === 'search') {
             setFocusArea('search');
           } else {
             setFocusArea('groups');
           }
        } else if (focusArea === 'groups') {
          setFocusArea('epg');
          setFocusedIndex(0);
        } else if (focusArea === 'epg') {
          if (viewMode === 'movies' || viewMode === 'series') {
            const list = viewMode === 'movies' ? filteredMovies : filteredSeries;
            if ((focusedIndex + 1) % COL_COUNT !== 0) {
              setFocusedIndex(prev => Math.min(list.length - 1, prev + 1));
            }
          }
        }
        break;
      case 'ArrowUp':
        if (focusArea === 'sidebar') {
          setFocusedIndex(prev => Math.max(0, prev - 1));
        } else if (focusArea === 'groups') {
          setFocusedGroupIndex(prev => Math.max(0, prev - 1));
        } else if (focusArea === 'epg') {
           if (viewMode === 'search') {
               if (focusedIndex < 5) {
                   setFocusArea('search');
               } else {
                   setFocusedIndex(prev => Math.max(0, prev - 5));
               }
           } else if (viewMode === 'movies' || viewMode === 'series') {
               setFocusedIndex(prev => Math.max(0, prev - COL_COUNT));
           } else {
               setFocusedIndex(prev => Math.max(0, prev - 1));
           }
        }
        break;
      case 'ArrowDown':
        let currentListLength = 0;
        if (focusArea === 'sidebar') currentListLength = 6;
        else if (focusArea === 'groups') currentListLength = currentCategories.length;
        else {
          if (viewMode === 'channels') currentListLength = filteredChannels.length;
          else if (viewMode === 'search') {
             const resChannels = channels.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 50);
             const resMovies = movies.filter(m => m.title.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 50);
             const resSeries = series.filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 50);
             currentListLength = resChannels.length + resMovies.length + resSeries.length;
          }
          else if (viewMode === 'movies') currentListLength = filteredMovies.length;
          else if (viewMode === 'series') currentListLength = filteredSeries.length;
          else if (viewMode === 'settings') currentListLength = 3; 
        }

        const max = Math.max(0, currentListLength - 1);
        if (focusArea === 'groups') {
          setFocusedGroupIndex(prev => Math.min(max, prev + 1));
        } else if (focusArea === 'epg' && (viewMode === 'movies' || viewMode === 'series')) {
          setFocusedIndex(prev => Math.min(max, prev + COL_COUNT));
        } else if (focusArea === 'epg') {
          setFocusedIndex(prev => Math.min(max, prev + 1));
        } else {
          setFocusedIndex(prev => Math.min(max, prev + 1));
        }
        break;
      case 'Enter':
        if (focusArea === 'sidebar') {
          const sidebarViews: (ViewMode | string)[] = ['search', 'channels', 'movies', 'series', 'mylist', 'settings'];
          const nextView = sidebarViews[focusedIndex];
          if (nextView === 'search') {
            setViewMode('search');
            setFocusArea('search');
            setFocusedIndex(0);
            setSearchQuery('');
          } else if (nextView === 'recordings' || nextView === 'mylist') {
            // Do nothing
          } else {
            setViewMode(nextView as ViewMode);
            setFocusedIndex(0);
            setFocusedGroupIndex(0);
            setSelectedCategoryId('all');
            setFocusArea('groups');
          }
        } else if (focusArea === 'groups') {
           setSelectedCategoryId(currentCategories[focusedGroupIndex]?.id || 'all');
           setFocusArea('epg');
           setFocusedIndex(0);
        } else if (focusArea === 'epg') {
          if (viewMode === 'search') {
            const resChannels = channels.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 50);
            const resMovies = movies.filter(m => m.title.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 50);
            const resSeries = series.filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 50);
            
            if (focusedIndex < resChannels.length) {
               const channel = resChannels[focusedIndex];
               setSelectedChannel(channel);
               setFullContentMode(true);
               localStorage.setItem('last_played_channel_id', channel.id);
            } else if (focusedIndex < resChannels.length + resMovies.length) {
               setSelectedVOD(resMovies[focusedIndex - resChannels.length]);
            } else if (focusedIndex < resChannels.length + resMovies.length + resSeries.length) {
               setSelectedVOD(resSeries[focusedIndex - resChannels.length - resMovies.length]);
            }
          } else if (viewMode === 'channels') {
            const channel = filteredChannels[focusedIndex];
            if (channel) {
              if (selectedChannel?.id === channel.id) {
                setFullContentMode(true);
                localStorage.setItem('last_played_channel_id', channel.id);
              } else {
                setSelectedChannel(channel);
              }
            }
          } else if (viewMode === 'movies' && filteredMovies[focusedIndex]) {
            setSelectedVOD(filteredMovies[focusedIndex]);
          } else if (viewMode === 'series' && filteredSeries[focusedIndex]) {
            setSelectedVOD(filteredSeries[focusedIndex]);
          }
        }
        break;
      case 'Escape':
      case 'Backspace':
        if (focusArea === 'epg') {
          setFocusArea('groups');
        } else if (focusArea === 'groups') {
          setFocusArea('sidebar');
        } else if (viewMode === 'search' && focusArea === 'search') {
          setFocusArea('sidebar');
          setFocusedIndex(0);
        }
        break;
      case 'BrowserBack':
      case 'Back':
      case 'GoBack':
        if (focusArea === 'epg') {
          setFocusArea('groups');
        } else if (focusArea === 'groups') {
          setFocusArea('sidebar');
        }
        break;
    }
  }, [focusArea, focusedIndex, focusedGroupIndex, viewMode, channels, movies, series, liveCategories, movieCategories, seriesCategories, selectedCategoryId, favorites, isLoggedIn, fullContentMode, selectedChannel, toggleFavorite, selectedVOD]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (favoritePromptChannel) {
      if (isBackKey(e.key)) {
        e.preventDefault();
        setFavoritePromptChannel(null);
      } else if (e.key === 'Enter') {
        const isFav = favorites.includes(favoritePromptChannel.id);
        toggleFavorite(favoritePromptChannel.id);
        setFavoritePromptChannel(null);
      }
      return;
    }

    if (e.key === 'Enter' && focusArea === 'epg' && viewMode === 'channels' && !fullContentMode && !e.repeat) {
      isLongPressActive.current = false;
      longPressTimer.current = setTimeout(() => {
        const channel = filteredChannels[focusedIndex];
        if (channel) {
          setFavoritePromptChannel(channel);
          isLongPressActive.current = true;
        }
      }, 700);
    }
    processKey(e.key);
  }, [processKey, favoritePromptChannel, favorites, toggleFavorite, focusArea, viewMode, fullContentMode, filteredChannels, focusedIndex]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  // Handle auto-selection of category as user scrolls through groups
  useEffect(() => {
    if (focusArea === 'groups') {
      const currentCats = 
        viewMode === 'channels' ? liveCategories : 
        viewMode === 'movies' ? movieCategories : 
        seriesCategories;
      
      const newId = currentCats[focusedGroupIndex]?.id || 'all';
      if (newId !== selectedCategoryId) {
        setSelectedCategoryId(newId);
        setFocusedIndex(0);
      }
    }
  }, [focusedGroupIndex, focusArea, viewMode, liveCategories, movieCategories, seriesCategories, selectedCategoryId]);

  // Fetch EPG for a range of channels to fill the guide
  useEffect(() => {
    if (creds && viewMode === 'channels' && filteredChannels.length > 0) {
      const start = Math.max(0, focusedIndex - 3);
      const end = Math.min(filteredChannels.length, focusedIndex + 12);
      
      for (let i = start; i < end; i++) {
        const channel = filteredChannels[i];
        if (channel && !epgData[channel.id]) {
          // Add a small delay to avoid hammering the API all at once
          const delay = (i - start) * 150;
          setTimeout(() => {
            fetchEPG(creds, channel.id).then(data => {
              if (data) {
                const programs = mapEPG(data, channel.id);
                setEpgData(prev => ({ ...prev, [channel.id]: programs }));
              }
            }).catch(() => {});
          }, delay);
        }
      }
    }
  }, [focusedIndex, filteredChannels, creds, viewMode, epgData]);

  if (initError) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#121B22] text-white p-10">
        <div className="text-center">
          <h1 className="text-4xl font-black mb-4">Something went wrong</h1>
          <p className="text-slate-400 mb-8">{initError}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-8 py-4 bg-sky-500 rounded-xl font-bold"
          >
            Reload App
          </button>
        </div>
      </div>
    );
  }

  if (isInitializing) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#121B22] text-white">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative"
        >
          <div className="w-24 h-24 rounded-[2rem] bg-sky-600 flex items-center justify-center shadow-2xl shadow-sky-600/40 relative z-10">
            <Tv size={56} className="text-white" />
          </div>
          <div className="absolute inset-0 bg-sky-500/20 blur-[60px] rounded-full animate-pulse" />
        </motion.div>
        
        <div className="mt-12 text-center">
          <div className="text-2xl font-black tracking-[0.2em] uppercase text-white mb-2">Streaming Portal</div>
          <div className="text-sky-400 font-bold uppercase tracking-widest text-sm animate-pulse">Initializing System</div>
          {loadingStep && (
            <div className="mt-6 px-6 py-2 rounded-full bg-white/5 border border-white/10 text-xs font-bold text-slate-500 uppercase tracking-widest">
              {loadingStep}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
     return (
       <div id="app-login-container" className="flex h-screen w-screen bg-[#121B22] text-white">
         <LoginView onLogin={handleLogin} isLoading={isLoading} loadingStep={loadingStep} onExternalKey={setActiveExternalKey} />
       </div>
     );
  }

  const currentCategories = 
    viewMode === 'channels' ? liveCategories : 
    viewMode === 'movies' ? movieCategories : 
    seriesCategories;

  return (
    <div id="app-main-container" className="flex h-screen w-screen overflow-hidden bg-[#121B22] text-white">
      {/* Sidebar Navigation - using flex to fill height */}
      <nav
        style={{ 
          width: focusArea === 'sidebar' ? 240 : (focusArea === 'epg' ? 0 : 80)
        }}
        className={`relative z-[60] flex flex-col bg-[#1C2F3B] transition-all duration-300 overflow-hidden ${
          focusArea === 'epg' ? 'border-none' : 'border-r border-white/5'
        }`}
      >
        <div className="mb-12 px-6 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-sky-600 flex items-center justify-center shadow-lg shadow-sky-600/20">
            <Tv size={32} className="text-white" />
          </div>
          {focusArea === 'sidebar' && (
            <div className="flex flex-col">
              <span className="font-black text-lg leading-none tracking-tight text-white">Streaming</span>
              <span className="font-bold text-sky-400 text-sm">TV Box</span>
            </div>
          )}
        </div>

        <div className="flex-1 w-full px-4 space-y-2">
          <SidebarItem
            icon={<Search size={22} />}
            label="Search"
            active={viewMode === 'search'}
            focused={focusArea === 'sidebar' && focusedIndex === 0}
            expanded={focusArea === 'sidebar'}
            onClick={() => { 
                setViewMode('search'); 
                setFocusArea('search');
                setFocusedIndex(0);
                setSearchQuery('');
            }}
          />
          <SidebarItem
            icon={<Tv size={22} />}
            label="TV"
            active={viewMode === 'channels'}
            focused={focusArea === 'sidebar' && focusedIndex === 1}
            expanded={focusArea === 'sidebar'}
            onClick={() => { 
                setViewMode('channels'); 
                setFocusedIndex(0);
                setFocusedGroupIndex(0);
                setSelectedCategoryId('all');
                setFocusArea('groups');
            }}
          />
          <SidebarItem
            icon={<Film size={22} />}
            label="Movies"
            active={viewMode === 'movies'}
            focused={focusArea === 'sidebar' && focusedIndex === 2}
            expanded={focusArea === 'sidebar'}
            onClick={() => { 
                setViewMode('movies'); 
                setFocusedIndex(0);
                setFocusedGroupIndex(0);
                setSelectedCategoryId('all');
                setFocusArea('groups');
            }}
          />
          <SidebarItem
            icon={<Clapperboard size={22} />}
            label="Shows"
            active={viewMode === 'series'}
            focused={focusArea === 'sidebar' && focusedIndex === 3}
            expanded={focusArea === 'sidebar'}
            onClick={() => { 
                setViewMode('series'); 
                setFocusedIndex(0);
                setFocusedGroupIndex(0);
                setSelectedCategoryId('all');
                setFocusArea('groups');
            }}
          />
          <SidebarItem
            icon={<Heart size={22} />}
            label="My list"
            active={false}
            focused={focusArea === 'sidebar' && focusedIndex === 4}
            expanded={focusArea === 'sidebar'}
            onClick={() => {}}
          />
        </div>

        <div className="mt-auto px-4">
          <SidebarItem
            icon={<SettingsIcon size={22} />}
            label="Settings"
            active={viewMode === 'settings'}
            focused={focusArea === 'sidebar' && focusedIndex === 5}
            expanded={focusArea === 'sidebar'}
            onClick={() => { setViewMode('settings'); setFocusArea('epg'); }}
          />
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 relative overflow-hidden flex">
        <AnimatePresence mode="wait">
          {viewMode === 'channels' && (
            <ChannelsView
              items={filteredChannels}
              categories={currentCategories}
              focusedIndex={focusedIndex}
              focusArea={focusArea}
              focusedGroupIndex={focusedGroupIndex}
              selectedCategoryId={selectedCategoryId}
              onChannelSelect={setSelectedChannel}
              selectedChannel={selectedChannel}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              groupsListRef={groupsListRef}
              contentListRef={contentListRef}
              epgData={epgData}
            />
          )}
          {viewMode === 'movies' && (
            <VODView
              type="movies"
              items={filteredMovies}
              categories={currentCategories}
              focusArea={focusArea}
              focusedIndex={focusedIndex}
              focusedGroupIndex={focusedGroupIndex}
              selectedCategoryId={selectedCategoryId}
              isFocused={focusArea === 'epg'}
              selectedItem={selectedVOD}
              setSelectedItem={setSelectedVOD}
              containerRef={contentListRef}
              groupsListRef={groupsListRef}
            />
          )}
          {viewMode === 'series' && (
            <VODView
              type="series"
              items={filteredSeries}
              categories={currentCategories}
              focusArea={focusArea}
              focusedIndex={focusedIndex}
              focusedGroupIndex={focusedGroupIndex}
              selectedCategoryId={selectedCategoryId}
              isFocused={focusArea === 'epg'}
              selectedItem={selectedVOD}
              setSelectedItem={setSelectedVOD}
              containerRef={contentListRef}
              groupsListRef={groupsListRef}
            />
          )}
          {viewMode === 'settings' && (
            <SettingsView
              focusedIndex={focusedIndex}
              isFocused={focusArea === 'epg'}
              containerRef={contentListRef}
              startupBehavior={startupBehavior}
              setStartupBehavior={setStartupBehavior}
            />
          )}
          {viewMode === 'search' && (
            <SearchView
              query={searchQuery}
              onQueryChange={setSearchQuery}
              channels={channels}
              movies={movies}
              series={series}
              focusedIndex={focusedIndex}
              focusArea={focusArea}
              onSelectChannel={setSelectedChannel}
              onSelectVOD={setSelectedVOD}
              containerRef={contentListRef}
              searchInputRef={searchInputRef}
            />
          )}
        </AnimatePresence>

        {/* Full Screen Player overlay */}
        <AnimatePresence>
          {fullContentMode && selectedChannel && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-black"
            >
              <VideoPlayer url={selectedChannel.streamUrl} autoPlay showControls />
              
              <button 
                onClick={() => setFullContentMode(false)}
                className="absolute top-6 right-6 z-[110] p-4 bg-black/40 hover:bg-black/60 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md border border-white/10 group"
              >
                <X size={32} />
                <span className="absolute right-full mr-4 top-1/2 -translate-y-1/2 bg-black/60 px-3 py-1 rounded text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  Close Player
                </span>
              </button>

              <div className="absolute top-8 left-8 p-4 bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 group opacity-0 hover:opacity-100 transition-opacity">
                 <div className="flex items-center gap-4 text-white">
                    {!!selectedChannel.logo && <img src={selectedChannel.logo} className="w-12 h-12 object-contain" />}
                    <div>
                      <div className="text-2xl font-black">{selectedChannel.name}</div>
                      <div className="text-sky-400 text-xs font-bold uppercase tracking-widest">{selectedChannel.category}</div>
                    </div>
                 </div>
                 <div className="mt-4 text-xs text-slate-500 font-bold">Press ESC or BACK to exit</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {favoritePromptChannel && (
            <FavoritePrompt 
              channel={favoritePromptChannel}
              isFavorite={favorites.includes(favoritePromptChannel.id)}
              onToggle={() => toggleFavorite(favoritePromptChannel.id)}
              onClose={() => setFavoritePromptChannel(null)}
            />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function FavoritePrompt({ channel, isFavorite, onToggle, onClose }: { 
  channel: Channel, 
  isFavorite: boolean, 
  onToggle: () => void, 
  onClose: () => void 
}) {
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 outline-none">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="bg-[#1C2F3B] border border-white/10 rounded-[2.5rem] p-10 max-w-sm w-full shadow-2xl relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-1.5 bg-sky-500" />
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-24 h-24 rounded-2xl bg-black/40 border border-white/5 flex items-center justify-center p-4 mb-6 shadow-inner">
            <img src={channel.logo || undefined} className="w-full h-full object-contain" />
          </div>
          <div className="text-2xl font-black mb-1 line-clamp-1">{channel.name}</div>
          <div className="text-sky-400 text-xs font-black uppercase tracking-[0.2em]">Add to Favorites?</div>
        </div>
        
        <div className="space-y-4">
          <button 
            autoFocus
            onClick={() => { onToggle(); onClose(); }}
            className="w-full py-4 rounded-2xl flex items-center justify-center gap-3 transition-all bg-sky-500 hover:bg-sky-400 text-white font-black text-sm uppercase tracking-wider shadow-lg shadow-sky-500/20 active:scale-95"
          >
            {isFavorite ? <X size={20} /> : <Star size={20} fill="currentColor" />}
            {isFavorite ? 'Remove from Fav' : 'Add to Favorites'}
          </button>
          
          <button 
            onClick={onClose}
            className="w-full py-4 rounded-2xl flex items-center justify-center gap-3 transition-all bg-white/5 hover:bg-white/10 text-slate-400 font-black text-sm uppercase tracking-wider border border-white/10 active:scale-95"
          >
            Cancel
          </button>
        </div>
      </motion.div>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-[#121B22]/90 backdrop-blur-md -z-10" 
        onClick={onClose} 
      />
    </div>
  );
}

interface VideoPlayerProps {
  url: string;
  muted?: boolean;
  autoPlay?: boolean;
  className?: string;
  showControls?: boolean;
  objectFit?: "contain" | "cover";
}

function VideoPlayer({ url, muted = false, autoPlay = true, className = "", showControls = false, objectFit = "contain" }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<any>(null);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const MAX_RETRIES = 10;

  useEffect(() => {
    if (!url || !videoRef.current) return;
    setError(null);
    retryRef.current = 0;
    setIsRetrying(false);
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);

    const video = videoRef.current;
    let hls: Hls | null = null;

    const onPlaying = () => {
      retryRef.current = 0;
      setIsRetrying(false);
      setError(null);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      console.log("Stream playing successfully.");
    };

    video.addEventListener('playing', onPlaying);

    const loadStream = () => {
      const isHls = url.includes('.m3u8') || url.includes('stream') || (retryRef.current > 5 && url.includes('.ts'));
      const isMpegTs = url.includes('.ts') && retryRef.current <= 5;

      if (isHls && Hls.isSupported()) {
        if (hlsRef.current) hlsRef.current.destroy();
        if (mpegtsRef.current) mpegtsRef.current.destroy();

        const hls = new Hls({
           enableWorker: true,
           lowLatencyMode: false,
           manifestLoadingMaxRetry: 10,
           levelLoadingMaxRetry: 10,
           xhrSetup: (xhr) => {
             xhr.withCredentials = false;
           }
        });
        hls.loadSource(url);
        hls.attachMedia(video);
        hlsRef.current = hls;

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            console.warn("Fatal HLS error", data);
            
            if (retryRef.current < MAX_RETRIES) {
              retryRef.current += 1;
              setIsRetrying(true);
              
              if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
              retryTimerRef.current = setTimeout(() => {
                const currentHls = hlsRef.current;
                if (!currentHls) return;

                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                  currentHls.startLoad();
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                  currentHls.recoverMediaError();
                } else {
                  loadStream();
                }
              }, 3000);
            } else {
              setIsRetrying(false);
              setError("Stream Error (Max Retries)");
            }
          }
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log("HLS Manifest Parsed - playing");
          if (autoPlay) {
            const playPromise = video.play();
            if (playPromise !== undefined) {
              playPromise.catch(e => console.log("Autoplay blocked or failed", e));
            }
          }
        });
      } else if (isMpegTs && (mpegts.getFeatureList() as any).mse) {
        if (hlsRef.current) hlsRef.current.destroy();
        if (mpegtsRef.current) mpegtsRef.current.destroy();
        
        const player = mpegts.createPlayer({
          type: 'mse',
          url: url,
          isLive: true
        }, {
          enableStashBuffer: false,
          stashInitialSize: 128
        });
        player.attachMediaElement(video);
        player.load();
        
        const playResult = player.play();
        if (playResult && typeof playResult.catch === 'function') {
           playResult.catch(e => console.warn("MPEG-TS play error", e));
        }
        mpegtsRef.current = player;

        player.on(mpegts.Events.ERROR, (type: any, detail: any) => {
          console.warn("MPEG-TS error", type, detail);
          if (retryRef.current < MAX_RETRIES) {
            retryRef.current += 1;
            setIsRetrying(true);
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            retryTimerRef.current = setTimeout(loadStream, 3000);
          } else {
            setError(`Failed to load MPEG-TS stream after ${MAX_RETRIES} attempts.`);
          }
        });
      } else {
        video.src = url;
        const errorHandler = (e: any) => {
          console.warn("Video Element Error", e, "Retry:", retryRef.current);
          if (retryRef.current < MAX_RETRIES) {
            retryRef.current += 1;
            setIsRetrying(true);
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            retryTimerRef.current = setTimeout(() => {
              // Double check we still need to retry
              if (retryRef.current === 0) return;

              if (videoRef.current) {
                videoRef.current.load();
                if (autoPlay) videoRef.current.play().catch(p => console.log("Retry play blocked", p));
              }
              retryTimerRef.current = null;
            }, 3000);
          } else {
            setIsRetrying(false);
            setError("Format not supported or Stream dead");
          }
        };
        video.addEventListener('error', errorHandler);
        if (autoPlay) {
           video.play().catch(e => console.log("Autoplay blocked", e));
        }
        return () => video.removeEventListener('error', errorHandler);
      }
    };

    const cleanup = loadStream();

    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
      if (mpegtsRef.current) {
        mpegtsRef.current.destroy();
        mpegtsRef.current = null;
      }
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      video.removeEventListener('playing', onPlaying);
      if (typeof cleanup === 'function') cleanup();
    };
  }, [url, autoPlay]);

  return (
    <div className={`relative w-full h-full bg-[#121B22] flex items-center justify-center ${className}`}>
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/80 z-20">
          <Tv className="text-white/20 mb-4" size={64} />
          <div className="text-white text-lg font-black uppercase tracking-widest">{error}</div>
          <div className="text-slate-500 text-xs mt-2 truncate max-w-[80%]">{url}</div>
          <button 
            onClick={() => { setError(null); retryRef.current = 0; window.location.reload(); }}
            className="mt-6 px-4 py-2 bg-sky-600 rounded-lg text-xs font-bold uppercase tracking-widest"
          >
            Manual Reload
          </button>
        </div>
      )}
      {isRetrying && !error && (
        <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest text-sky-400 border border-white/10 z-20">
          Retrying ({retryRef.current}/{MAX_RETRIES})...
        </div>
      )}
      <video
        ref={videoRef}
        className={`w-full h-full ${objectFit === 'cover' ? 'object-cover' : 'object-contain'}`}
        muted={muted}
        playsInline
        controls={showControls}
      />
    </div>
  );
}

// SidebarItem component
function SidebarItem({ icon, label, active, focused, expanded, onClick }: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  focused: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`px-4 py-3 rounded-xl flex items-center cursor-pointer transition-all duration-200 ${
        focused ? 'bg-sky-500 text-white scale-105 shadow-lg shadow-sky-500/20 font-black' :
        active ? 'text-white' : 'text-white/60 hover:text-white'
      }`}
    >
      <div className="min-w-[24px] flex justify-center">{icon}</div>
      {expanded && (
        <span className="ml-4 font-medium whitespace-nowrap">
          {label}
        </span>
      )}
    </div>
  );
}

function ChannelsView({ 
  items, 
  categories, 
  focusedIndex, 
  focusArea, 
  focusedGroupIndex,
  selectedCategoryId,
  onChannelSelect, 
  selectedChannel, 
  favorites, 
  onToggleFavorite,
  groupsListRef,
  contentListRef,
  epgData
}: {
  items: Channel[];
  categories: { id: string; name: string }[];
  focusedIndex: number;
  focusArea: 'sidebar' | 'search' | 'groups' | 'epg';
  focusedGroupIndex: number;
  selectedCategoryId: string;
  onChannelSelect: (ch: Channel) => void;
  selectedChannel: Channel | null;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
  groupsListRef: React.RefObject<HTMLDivElement | null>;
  contentListRef: React.RefObject<HTMLDivElement | null>;
  epgData: Record<string, Program[]>;
}) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Time scale configuration
  const PIXELS_PER_HOUR = 320;
  const PIXELS_PER_MINUTE = PIXELS_PER_HOUR / 60;
  
  // Start the timeline snap to the current half-hour increment
  const timelineStart = useMemo(() => {
    const d = new Date(currentTime);
    const mins = d.getMinutes();
    const snapMins = mins >= 30 ? 30 : 0;
    d.setMinutes(snapMins, 0, 0);
    return d; 
  }, [Math.floor(currentTime.getTime() / 1800000)]); 

  const timeSlots = useMemo(() => {
    return Array.from({ length: 24 }).map((_, i) => {
      return new Date(timelineStart.getTime() + i * 1800000);
    });
  }, [timelineStart]);

  const getProgramWidth = (start: Date, end: Date) => {
    const durationMins = (end.getTime() - start.getTime()) / 60000;
    return durationMins * PIXELS_PER_MINUTE;
  };

  const getProgramOffset = (start: Date) => {
    const offsetMins = (start.getTime() - timelineStart.getTime()) / 60000;
    return offsetMins * PIXELS_PER_MINUTE;
  };

  const nowPointerOffset = (currentTime.getTime() - timelineStart.getTime()) / 60000 * PIXELS_PER_MINUTE;

  const activePrograms = selectedChannel ? (epgData[selectedChannel.id] || []) : [];
  const currentProgram = activePrograms.find(p => currentTime >= p.start && currentTime <= p.end);
  const nextProgramIdx = activePrograms.findIndex(p => p === currentProgram) + 1;
  const nextProgram = activePrograms[nextProgramIdx];

  const remainingMins = currentProgram 
    ? Math.floor((currentProgram.end.getTime() - currentTime.getTime()) / 60000) 
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-full w-full bg-[#121B22]"
    >
      {/* Groups Column */}
      <div 
        ref={groupsListRef}
        className={`${focusArea === 'epg' ? 'w-0 opacity-0 pointer-events-none px-0' : 'w-[280px] px-3'} shrink-0 bg-[#16242F] border-r border-white/5 flex flex-col py-6 gap-1 transition-all duration-500 overflow-y-auto custom-scrollbar overflow-x-hidden`}
      >
        <div className="flex flex-col mb-4">
           {/* Mocking the special CAN text from image if applicable, or just a title */}
           <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] pl-4">Categories</div>
        </div>
        {categories.map((cat, idx) => {
           const isGroupsFocused = focusArea === 'groups' && focusedGroupIndex === idx;
           const isSelected = selectedCategoryId === cat.id;

           return (
            <div
              key={cat.id}
              data-focused={isGroupsFocused}
              className={`text-left px-4 py-2.5 rounded-xl transition-all duration-300 font-bold text-base border flex justify-between items-center ${
                isGroupsFocused 
                  ? 'bg-sky-500 text-white border-sky-400 shadow-lg shadow-sky-500/20 scale-105 z-10' 
                  : isSelected
                    ? 'text-white border-white/10'
                    : 'bg-transparent text-white/50 border-transparent hover:text-white'
              }`}
            >
               <span className="truncate">{cat.name}</span>
            </div>
           );
        })}
      </div>

      {/* Main Content Split: Player Top, EPG Bottom */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#121B22]">
        {/* Top: Now Playing Section */}
        <div className="h-[40%] flex gap-8 p-6 border-b border-white/5 bg-gradient-to-b from-[#1C2F3B] to-[#121B22]">
          <div className="aspect-video h-full rounded-2xl border border-white/10 overflow-hidden shadow-2xl relative shadow-black/50 shrink-0 bg-black">
            <VideoPlayer url={selectedChannel?.streamUrl || undefined} autoPlay muted objectFit="cover" />
          </div>

          <div className="flex-1 flex flex-col justify-center min-w-0 pr-4">
             {selectedChannel && (
               <>
                 <div className="text-sky-400 font-bold uppercase text-sm mb-1 tracking-widest opacity-80">
                   {selectedChannel.name}
                 </div>
                 <h2 className="text-[22px] h-[38.85px] leading-[52px] text-left font-black mb-3 tracking-tight line-clamp-2 uppercase">
                   {currentProgram?.title || 'Program Information Unavailable'}
                 </h2>
                 <div className="flex items-center gap-4 text-slate-400 font-bold mb-6">
                    <div className="text-[17px] flex items-center gap-3">
                      {currentProgram && (
                        <>
                          {currentProgram.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — {currentProgram.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </>
                      )}
                    </div>
                    {remainingMins > 0 && (
                      <div className="bg-sky-500/10 border border-sky-500/20 px-3 py-1 rounded-lg text-sm text-sky-400 font-black">
                        {remainingMins} MIN LEFT
                      </div>
                    )}
                 </div>
                 <p className="text-[#ebeef3] text-[15px] leading-relaxed line-clamp-3 max-w-3xl font-medium">
                   {currentProgram?.description || 'Toronto\'s breaking news, weather and traffic information. CP24 is Canada\'s 24-hour local news source.'}
                 </p>
               </>
             )}
          </div>
        </div>

        {/* Bottom: EPG Grid */}
        <div className="flex-1 flex flex-col min-h-0 bg-[#16242F]">
           {/* Timeline Header Row (Date/Time) */}
           <div className="flex bg-[#1C2F3B] border-b border-white/5 items-center h-10">
              <div className="w-[260px] shrink-0 px-6 flex items-center relative z-30 bg-[#1C2F3B] border-none">
                 <div className="text-xs font-black text-white whitespace-nowrap bg-sky-500 px-3 py-1 rounded-lg shadow-lg shadow-sky-500/20">
                    {currentTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()} | {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                 </div>
              </div>
              <div className="flex-1 flex overflow-hidden">
                 {timeSlots.map((slot, hi) => (
                   <div 
                     key={hi} 
                     className="shrink-0 flex items-center px-4 text-xs font-black text-slate-400 border-l border-white/5 h-full"
                     style={{ width: PIXELS_PER_HOUR / 2 }}
                   >
                     {slot.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase()}
                   </div>
                 ))}
              </div>
           </div>

           {/* Channels Rows */}
           <div ref={contentListRef} className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="min-w-max">
                 {items.map((channel, i) => {
                    const realPrograms = epgData[channel.id] || [];
                    const isRowFocused = focusArea === 'epg' && focusedIndex === i;
                    
                    return (
                      <div key={channel.id} data-focused={isRowFocused} className={`flex border-b border-white/5 relative group transition-colors ${isRowFocused ? 'bg-white/5' : ''}`}>
                        {/* Channel Header (Sticky-ish) */}
                        <div className={`w-[260px] shrink-0 py-2 pl-4 flex items-center gap-2 border-r border-white/5 relative bg-[#16242F] z-30 ${isRowFocused ? 'text-sky-400' : 'text-slate-300'}`}>
                           <div className="text-sm font-black w-5 shrink-0">{i + 1}</div>
                           <img src={channel.logo || undefined} className="w-8 h-8 object-contain rounded-md bg-black/40 p-1 border border-white/5" />
                           <div className="text-sm font-bold leading-tight line-clamp-1 flex-1 min-w-0 pr-4">{channel.name}</div>
                           {isRowFocused && <div className="absolute right-2 text-sky-500 scale-90">▶</div>}
                        </div>

                        {/* Timeline Programs Row */}
                        <div className="flex-1 flex relative h-10 items-center">
                           {/* Now Vertical Line (Global overlay) - simplified per row for now */}
                           <div 
                             className="absolute top-0 bottom-0 w-0.5 bg-sky-500/30 z-20 pointer-events-none border-r border-sky-500/50"
                             style={{ left: nowPointerOffset }}
                           />

                           {realPrograms.length === 0 ? (
                             <div className="text-slate-600 font-bold px-8 uppercase tracking-widest text-sm italic">No Schedule</div>
                           ) : (
                             realPrograms.map((prog, pi) => {
                               const left = getProgramOffset(prog.start);
                               const width = getProgramWidth(prog.start, prog.end);
                               const isNow = currentTime >= prog.start && currentTime <= prog.end;

                               // Skip rendering if way outside window
                               if (left + width < 0 || left > PIXELS_PER_HOUR * 12) return null;

                               return (
                                 <div
                                   key={prog.id}
                                   className={`absolute inset-y-1 rounded-sm flex flex-col justify-center px-4 transition-all border-l border-white/5 ${
                                      isNow 
                                        ? 'bg-[#1C2F3B] text-white z-20 shadow-xl' 
                                        : 'bg-transparent text-slate-600'
                                   } ${isRowFocused && isNow ? 'bg-[#284455] z-30 ring-1 ring-sky-500/50' : ''}`}
                                   style={{ left, width: width - 1 }}
                                 >
                                    <div className={`text-xs font-black leading-tight ${isNow ? 'whitespace-nowrap overflow-visible relative z-50' : 'truncate'}`}>{prog.title}</div>
                                 </div>
                               );
                             })
                           )}
                        </div>
                      </div>
                    );
                 })}
              </div>
           </div>
        </div>
      </div>
    </motion.div>
  );
}

function VODView({ type, items, categories, focusArea, focusedIndex, focusedGroupIndex, selectedCategoryId, isFocused, selectedItem, setSelectedItem, containerRef, groupsListRef }: {
  type: 'movies' | 'series';
  items: any[];
  categories: { id: string; name: string }[];
  focusArea: 'sidebar' | 'search' | 'groups' | 'epg';
  focusedIndex: number;
  focusedGroupIndex: number;
  selectedCategoryId: string;
  isFocused: boolean;
  selectedItem: any;
  setSelectedItem: (item: any) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  groupsListRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [seriesInfo, setSeriesInfo] = useState<any>(null);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [activeEpisode, setActiveEpisode] = useState<any>(null);
  const [modalFocus, setModalFocus] = useState<'info' | 'seasons' | 'episodes'>('info');
  const [modalFocusedIndex, setModalFocusedIndex] = useState(0);

  useEffect(() => {
    if (selectedItem && type === 'series') {
      const getInfo = async () => {
        try {
          // If we have creds, fetch real info. For now, let's assume we might need them or use mock.
          // In a real app, you'd pass creds here.
          setSeriesInfo(null);
          setSelectedSeason(null);
          setActiveEpisode(null);
          setModalFocus('info');
          setModalFocusedIndex(0);
        } catch (e) {
          console.error(e);
        }
      };
      getInfo();
    }
  }, [selectedItem, type]);

  // Handle modal navigation
  useEffect(() => {
    if (!selectedItem) return;

    const handleModalKey = (e: KeyboardEvent) => {
      // Back keys for both modal and player
      if (isBackKey(e.key)) {
        e.preventDefault();
        if (isPlaying) {
          setIsPlaying(false);
        } else {
          setSelectedItem(null);
        }
        return;
      }

      if (isPlaying) return;

      if (e.key === 'ArrowDown') {
        if (modalFocus === 'info') {
           setModalFocus('seasons');
           setModalFocusedIndex(0);
        } else if (modalFocus === 'seasons') {
           setModalFocus('episodes');
           setModalFocusedIndex(0);
        }
      } else if (e.key === 'ArrowUp') {
        if (modalFocus === 'episodes') {
           setModalFocus('seasons');
           setModalFocusedIndex(0);
        } else if (modalFocus === 'seasons') {
           setModalFocus('info');
           setModalFocusedIndex(0);
        }
      } else if (e.key === 'ArrowRight') {
         setModalFocusedIndex(prev => prev + 1);
      } else if (e.key === 'ArrowLeft') {
         setModalFocusedIndex(prev => Math.max(0, prev - 1));
      } else if (e.key === 'Enter') {
         if (modalFocus === 'seasons') {
            setSelectedSeason(modalFocusedIndex + 1);
            setModalFocus('episodes');
            setModalFocusedIndex(0);
         } else if (modalFocus === 'episodes') {
            setIsPlaying(true);
         }
      }
    };

    window.addEventListener('keydown', handleModalKey);
    return () => window.removeEventListener('keydown', handleModalKey);
  }, [selectedItem, isPlaying, modalFocus, modalFocusedIndex]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-full w-full bg-[#121B22]"
    >
      {/* Groups Column */}
      <div 
        ref={groupsListRef}
        className={`${focusArea === 'epg' ? 'w-0 opacity-0 pointer-events-none px-0' : 'w-[280px] px-3'} shrink-0 bg-[#16242F] border-r border-white/5 flex flex-col py-6 gap-1 transition-all duration-500 overflow-y-auto custom-scrollbar overflow-x-hidden`}
      >
        <div className="flex flex-col mb-4">
           <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] pl-4">Categories</div>
        </div>
        {categories.map((cat, idx) => {
           const isGroupsFocused = focusArea === 'groups' && focusedGroupIndex === idx;
           const isSelected = selectedCategoryId === cat.id;

           return (
            <div
              key={cat.id}
              data-focused={isGroupsFocused}
              className={`text-left px-4 py-2.5 rounded-xl transition-all duration-300 font-bold text-base border flex justify-between items-center ${
                isGroupsFocused 
                  ? 'bg-sky-500 text-white border-sky-400 shadow-lg shadow-sky-500/20 scale-105 z-10' 
                  : isSelected
                    ? 'text-white border-white/10'
                    : 'bg-transparent text-white/50 border-transparent hover:text-white'
              }`}
            >
               <span className="truncate">{cat.name}</span>
            </div>
           );
        })}
      </div>

      <div className="flex-1 flex flex-col p-12 overflow-hidden">
        <header className="mb-12 shrink-0">
          <h1 className="text-6xl font-black tracking-tighter text-white/90 capitalize">{type}</h1>
          <p className="text-slate-400 mt-2 uppercase tracking-widest text-sm font-bold opacity-60">Browse your {type} collection</p>
        </header>

        <div ref={containerRef} className="flex-1 overflow-y-auto pr-6 -mr-6 pb-20 custom-scrollbar">
          {items.length === 0 ? (
            <div className="p-20 text-center text-slate-500 font-bold uppercase tracking-widest text-2xl">
              No items found in this group
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-10">
              {items.map((item, i) => {
                const itemFocused = isFocused && focusedIndex === i;
                return (
                  <div
                    key={item.id}
                    data-focused={itemFocused}
                    className={`relative transition-all duration-500 transform group cursor-pointer ${
                      itemFocused ? 'scale-105 z-10' : 'scale-100'
                    }`}
                    onClick={() => setSelectedItem(item)}
                  >
                    <div className={`aspect-[2/3] rounded-[32px] overflow-hidden shadow-2xl border-4 transition-all duration-300 ${
                      itemFocused ? 'border-sky-500 shadow-sky-500/40' : 'border-white/5 opacity-70'
                    }`}>
                      <img 
                        src={item.poster || undefined} 
                        alt={item.title} 
                        className="w-full h-full object-cover" 
                      />
                      <div className={`absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent transition-opacity duration-300 ${itemFocused ? 'opacity-40' : 'opacity-20'}`} />
                      
                      {itemFocused && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                          <Play className="text-white fill-current" size={64} />
                        </div>
                      )}
                    </div>

                    <div className="mt-4 px-2">
                      <div className={`font-black text-xl truncate transition-colors ${itemFocused ? 'text-white' : 'text-slate-400'}`}>
                          {item.title}
                      </div>
                      <div className="flex gap-2 mt-1 items-center opacity-60">
                          <span className="text-sky-400 text-[10px] font-bold tracking-widest uppercase">{item.rating} IMDB</span>
                          <span className="w-1 h-1 bg-white/20 rounded-full" />
                          <span className="text-slate-400 text-[10px] font-bold tracking-widest uppercase">{item.year}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {selectedItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-black/95 backdrop-blur-md">
             {isPlaying ? (
               <div className="w-full h-full relative group">
                  <VideoPlayer url={selectedItem.streamUrl || "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"} />
                  <div className="absolute top-8 left-8 opacity-0 group-hover:opacity-100 transition-opacity">
                     <button 
                        onClick={() => setIsPlaying(false)}
                        className="bg-white/10 hover:bg-white/20 text-white px-6 py-2 rounded-full backdrop-blur-md border border-white/10 text-sm font-bold flex items-center gap-2"
                     >
                        Close Player
                     </button>
                  </div>
               </div>
             ) : (
                 <motion.div
                   initial={{ opacity: 0, scale: 0.9, y: 30 }}
                   animate={{ opacity: 1, scale: 1, y: 0 }}
                   exit={{ opacity: 0, scale: 0.9 }}
                   className="bg-[#121B22] border border-white/10 rounded-[40px] max-w-7xl w-[90vw] aspect-video flex overflow-hidden shadow-2xl relative"
                 >
                   <div className="w-[30%] h-full shrink-0 border-r border-white/5">
                     <img 
                       src={selectedItem.poster || undefined} 
                       alt={selectedItem.title} 
                       className="w-full h-full object-cover" 
                     />
                   </div>
                   <div className="flex-1 p-12 flex flex-col min-h-0 bg-gradient-to-br from-white/[0.02] to-transparent">
                     <button
                         className="absolute top-8 right-8 text-slate-500 hover:text-white bg-white/5 p-3 rounded-full transition-colors z-10"
                         onClick={() => setSelectedItem(null)}
                     >
                         <X size={24} />
                     </button>
                     <h2 className="text-6xl font-black tracking-tighter mb-4 text-white leading-tight pr-12">{selectedItem.title}</h2>
                     <div className="flex gap-6 items-center mb-6">
                         <div className="flex items-center gap-2 bg-sky-500/20 text-sky-400 px-4 py-1.5 rounded-xl border border-sky-500/30">
                            <Star size={18} className="fill-current" />
                            <span className="text-xl font-black tracking-widest">{selectedItem.rating || '8.5'}</span>
                         </div>
                         <div className="text-xl text-slate-400 font-bold opacity-60 font-mono">{selectedItem.year}</div>
                         <div className="text-xl text-slate-400 font-bold opacity-60 font-mono">{selectedItem.duration || '2h 15m'}</div>
                         {selectedItem.seasons && (
                           <>
                              <div className="w-1 h-1 bg-white/20 rounded-full" />
                              <div className="text-xl text-slate-400 font-bold opacity-60">{selectedItem.seasons} Seasons</div>
                           </>
                         )}
                     </div>
                     <p className="text-xl text-slate-300 leading-relaxed max-w-2xl mb-8 font-medium opacity-80 line-clamp-3">
                         {selectedItem.plot}
                     </p>
 
                     {type === 'series' ? (
                       <div className="flex-1 min-h-0 flex flex-col space-y-6">
                         <section className="shrink-0">
                           <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-sky-500 mb-4 opacity-70">Seasons</h3>
                           <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                             {Array.from({ length: selectedItem.seasons || 1 }).map((_, i) => {
                               const isFocused = modalFocus === 'seasons' && modalFocusedIndex === i;
                               const isSelected = selectedSeason === (i + 1);
                               return (
                                 <button
                                   key={i}
                                   onClick={() => setSelectedSeason(i + 1)}
                                   className={`px-6 py-2.5 rounded-xl font-bold text-base transition-all shrink-0 border-2 ${
                                     isFocused ? 'bg-sky-500 border-sky-300 scale-105 shadow-lg' : 
                                     isSelected ? 'bg-sky-500/20 border-sky-500 text-white' : 'bg-white/5 border-white/5 text-slate-400 hover:text-slate-200'
                                   }`}
                                 >
                                   Season {i + 1}
                                 </button>
                               );
                             })}
                           </div>
                         </section>
 
                         {selectedSeason && (
                           <section className="flex-1 min-h-0 min-w-0">
                             <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-sky-500 mb-4 opacity-70">Episodes - Season {selectedSeason}</h3>
                             <div className="grid grid-cols-4 gap-4 overflow-y-auto pr-4 pb-4 custom-scrollbar h-full max-h-[300px]">
                               {Array.from({ length: 12 }).map((_, i) => {
                                 const isFocused = modalFocus === 'episodes' && modalFocusedIndex === i;
                                 const episodeNames = [
                                   "Pilot", "Shadows", "The Return", "Betrayal", "Foundations", "Expansion", 
                                   "The Truth", "Broken", "Legacy", "Reckoning", "The Last Stand", "New Dawn"
                                 ];
                                 return (
                                   <div
                                     key={i}
                                     onClick={() => setIsPlaying(true)}
                                     className={`relative rounded-[20px] overflow-hidden cursor-pointer transition-all border-4 ${
                                       isFocused ? 'border-sky-500 scale-105 shadow-xl' : 'border-white/5 hover:border-white/10'
                                     }`}
                                   >
                                     <div className="aspect-video bg-zinc-800 relative">
                                       <img 
                                         src={`https://placehold.co/640x360/111/fff?text=S${selectedSeason}+E${i + 1}`} 
                                         className="w-full h-full object-cover"
                                       />
                                       <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex items-end p-3">
                                          <div className="flex flex-col">
                                            <span className="text-sky-400 text-[10px] font-black uppercase tracking-[0.2em] mb-0.5">Episode {i + 1}</span>
                                            <span className="text-white font-bold text-sm tracking-tight truncate w-full">{episodeNames[i] || 'TBD Episode'}</span>
                                          </div>
                                       </div>
                                     </div>
                                   </div>
                                 );
                               })}
                             </div>
                           </section>
                         )}
                       </div>
                     ) : (
                        <div className="flex-1" />
                     )}
 
                     <div className="flex gap-4 mt-8 shrink-0">
                         <button 
                           onClick={() => setIsPlaying(true)}
                           className="bg-sky-500 text-white px-10 py-5 rounded-[24px] font-black text-xl uppercase tracking-widest hover:bg-sky-400 transition-all shadow-xl shadow-sky-500/40 active:scale-95 flex items-center gap-3"
                         >
                           <Play fill="currentColor" size={24} /> Play Now
                         </button>
                         <button className="bg-white/5 text-slate-400 px-6 py-5 rounded-[24px] hover:bg-white/10 transition-all active:scale-95 border border-white/5">
                           <Heart size={28} />
                         </button>
                     </div>
                   </div>
                 </motion.div>
             )}
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SearchView({ 
  query, 
  onQueryChange, 
  channels, 
  movies, 
  series,
  focusedIndex,
  focusArea,
  onSelectChannel,
  onSelectVOD,
  containerRef,
  searchInputRef
}: {
  query: string;
  onQueryChange: (q: string) => void;
  channels: Channel[];
  movies: Movie[];
  series: Series[];
  focusedIndex: number;
  focusArea: string;
  onSelectChannel: (c: Channel) => void;
  onSelectVOD: (v: any) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const filteredChannels = useMemo(() => 
    channels.filter(c => c.name.toLowerCase().includes(query.toLowerCase())).slice(0, 50)
  , [channels, query]);

  const filteredMovies = useMemo(() => 
    movies.filter(m => m.title.toLowerCase().includes(query.toLowerCase())).slice(0, 50)
  , [movies, query]);

  const filteredSeries = useMemo(() => 
    series.filter(s => s.title.toLowerCase().includes(query.toLowerCase())).slice(0, 50)
  , [series, query]);

  const totalResults = filteredChannels.length + filteredMovies.length + filteredSeries.length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col h-full w-full bg-[#121B22] p-12"
    >
      <header className="mb-12">
        <h1 className="text-6xl font-black tracking-tighter text-white/90">Search</h1>
        <div className="mt-8 relative max-w-4xl">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500" size={32} />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Type to search..."
            className={`w-full bg-white/5 border-2 rounded-[32px] py-6 pl-20 pr-8 text-2xl font-bold transition-all ${
              focusArea === 'search' ? 'border-sky-500 bg-white/10 ring-4 ring-sky-500/20 shadow-2xl shadow-sky-500/10' : 'border-white/5'
            }`}
          />
        </div>
      </header>

      <div ref={containerRef} className="flex-1 overflow-y-auto custom-scrollbar pr-4 pb-20">
        {query.length > 0 ? (
          <div className="space-y-16">
            {filteredChannels.length > 0 && (
              <section>
                <h2 className="text-sm font-black uppercase tracking-[0.3em] text-sky-500 mb-6">Channels ({filteredChannels.length})</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                  {filteredChannels.map((ch, idx) => {
                    const isFocused = focusArea === 'epg' && focusedIndex === idx;
                    return (
                      <div
                        key={ch.id}
                        data-focused={isFocused}
                        onClick={() => onSelectChannel(ch)}
                        className={`p-6 rounded-3xl border transition-all duration-300 cursor-pointer flex items-center gap-4 ${
                          isFocused ? 'bg-sky-500 border-transparent scale-105 shadow-xl text-white' : 'bg-white/5 border-white/5 text-slate-400 hover:text-white'
                        }`}
                      >
                        <div className="w-12 h-12 bg-black/40 rounded-xl flex items-center justify-center shrink-0 overflow-hidden">
                          {ch.logo ? <img src={ch.logo} className="w-full h-full object-contain" /> : <Tv size={24} />}
                        </div>
                        <span className="font-bold text-sm leading-tight line-clamp-2">{ch.name}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {filteredMovies.length > 0 && (
              <section>
                <h2 className="text-sm font-black uppercase tracking-[0.3em] text-sky-500 mb-6">Movies ({filteredMovies.length})</h2>
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                  {filteredMovies.map((m, idx) => {
                    const offset = filteredChannels.length;
                    const isFocused = focusArea === 'epg' && focusedIndex === (idx + offset);
                    return (
                      <div
                        key={m.id}
                        data-focused={isFocused}
                        onClick={() => onSelectVOD(m)}
                        className={`aspect-[2/3] rounded-3xl overflow-hidden border-4 transition-all duration-300 cursor-pointer ${
                          isFocused ? 'border-sky-500 scale-105 shadow-2xl z-10' : 'border-white/5 opacity-80 hover:opacity-100'
                        }`}
                      >
                        <img src={m.poster} className="w-full h-full object-cover" />
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {filteredSeries.length > 0 && (
              <section>
                <h2 className="text-sm font-black uppercase tracking-[0.3em] text-sky-500 mb-6">Shows ({filteredSeries.length})</h2>
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                  {filteredSeries.map((s, idx) => {
                    const offset = filteredChannels.length + filteredMovies.length;
                    const isFocused = focusArea === 'epg' && focusedIndex === (idx + offset);
                    return (
                      <div
                        key={s.id}
                        data-focused={isFocused}
                        onClick={() => onSelectVOD(s)}
                        className={`aspect-[2/3] rounded-3xl overflow-hidden border-4 transition-all duration-300 cursor-pointer ${
                          isFocused ? 'border-sky-500 scale-105 shadow-2xl z-10' : 'border-white/5 opacity-80 hover:opacity-100'
                        }`}
                      >
                        <img src={s.poster} className="w-full h-full object-cover" />
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {totalResults === 0 && (
              <div className="flex flex-col items-center justify-center py-20 opacity-40">
                <Search size={80} className="mb-6" />
                <p className="text-3xl font-bold text-center">No results found for <br/><span className="text-sky-500">"{query}"</span></p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-40 opacity-20">
            <Search size={120} className="mb-8" />
            <p className="text-4xl font-black uppercase tracking-[0.2em]">Enter Search Query</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function SettingsView({ focusedIndex, isFocused, containerRef, startupBehavior, setStartupBehavior }: {
  focusedIndex: number;
  isFocused: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  startupBehavior: 'guide' | 'last_channel';
  setStartupBehavior: (val: 'guide' | 'last_channel') => void;
  key?: string;
}) {
  const options = [
    { 
      label: 'Startup Behavior', 
      desc: startupBehavior === 'last_channel' ? 'Start with Full Screen Player' : 'Start with TV Guide',
      action: () => {
        const next = startupBehavior === 'last_channel' ? 'guide' : 'last_channel';
        setStartupBehavior(next);
        localStorage.setItem('startup_behavior', next);
      }
    },
    { label: 'Playlist Update', desc: 'Refresh your channel and VOD library', action: () => window.location.reload() },
    { label: 'Logout', desc: 'Clear saved credentials and return to login', action: () => {
      localStorage.removeItem('iptv_creds');
      window.location.reload();
    }}
  ];

  const handleAction = (opt: any) => {
    if (opt.action) opt.action();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex h-full w-full bg-[#121B22]"
    >
      {/* Settings also get standard two-column layout for consistency */}
      <div className={`${isFocused ? 'w-0 opacity-0 pointer-events-none px-0' : 'w-[280px] px-3'} shrink-0 bg-[#16242F] border-r border-white/5 flex flex-col py-6 gap-1 transition-all duration-500 overflow-y-auto custom-scrollbar overflow-x-hidden`}>
         <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] pl-4 mb-4">Control</div>
         <div className="px-4 py-2.5 rounded-xl bg-white/10 text-white font-bold text-base border border-white/5">Preferences</div>
      </div>

      <div className="flex-1 p-12 flex flex-col">
        <header className="mb-12">
          <h1 className="text-6xl font-black tracking-tighter text-white/90">Settings</h1>
          <p className="text-slate-400 mt-1 uppercase tracking-widest text-sm font-bold opacity-60">Application Configuration</p>
        </header>

        <div ref={containerRef} className="max-w-2xl space-y-4 pr-4 overflow-y-auto custom-scrollbar h-full pb-20">
          {options.map((opt, i) => {
            const itemFocused = isFocused && focusedIndex === i;
            return (
              <div
                key={opt.label}
                data-focused={itemFocused}
                onClick={() => handleAction(opt)}
                className={`p-10 rounded-[32px] border transition-all duration-300 cursor-pointer ${
                  itemFocused 
                    ? 'bg-sky-500 border-transparent shadow-2xl shadow-sky-500/20 scale-105' 
                    : 'bg-white/5 border-white/5 hover:bg-white/10'
                }`}
              >
                <div className="text-3xl font-black mb-2">{opt.label}</div>
                <div className={`text-lg font-medium ${itemFocused ? 'text-sky-100' : 'text-slate-500'}`}>{opt.desc}</div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

function LoginView({ onLogin, isLoading, loadingStep, onExternalKey }: { 
  onLogin: (creds: Credentials, remember: boolean) => void, 
  isLoading: boolean, 
  loadingStep?: string,
  onExternalKey?: (onKey: (key: string) => void) => void
}) {
  const [focusedField, setFocusedField] = useState(0); // 0: Server, 1: Username, 2: Password, 3: Remember, 4: Connect, 5: Demo
  const [formData, setFormData] = useState({ server: '', username: '', password: '' });
  const [remember, setRemember] = useState(true);
  const serverRef = useRef<HTMLInputElement>(null);
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  const processKey = useCallback((key: string) => {
    if (isLoading) return;
    
    if (isBackKey(key)) {
      return;
    }

    switch (key) {
      case 'ArrowUp':
        setFocusedField(prev => Math.max(0, prev - 1));
        break;
      case 'ArrowDown':
        setFocusedField(prev => Math.min(5, prev + 1));
        break;
      case 'Enter':
        if (focusedField === 3) setRemember(!remember);
        if (focusedField === 4) onLogin(formData, remember);
        if (focusedField === 5) onLogin({ server: 'http://demo.com', username: 'demo', password: 'demo' }, false);
        break;
    }
  }, [focusedField, onLogin, formData, isLoading, remember]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    processKey(e.key);
  }, [processKey]);

  useEffect(() => {
    if (onExternalKey) onExternalKey(processKey);
  }, [onExternalKey, processKey]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleChange = (field: string, val: string) => {
    setFormData(prev => ({ ...prev, [field]: val }));
  };

  return (
    <div className="h-screen w-screen flex text-white overflow-hidden bg-[#121B22]">
      <div className="md:w-1/2 flex flex-col justify-center px-12 lg:px-20 relative bg-gradient-to-br from-[#1C2F3B] to-[#121B22]">
        <div className="absolute top-12 left-12 lg:left-20">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-sky-600 rounded-xl shadow-lg shadow-sky-600/20">
              <Tv size={32} className="text-white" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-xl font-black text-white">Streaming</span>
              <span className="text-sm font-bold text-sky-400">TV Box</span>
            </div>
          </div>
        </div>
        
        <div className="space-y-6">
          <h1 className="text-6xl lg:text-8xl font-black leading-[1.1] tracking-tighter">
            Your Premium <br />
            <span className="text-sky-400">TV Portal</span>
          </h1>
          <p className="text-xl lg:text-2xl text-slate-400 font-medium max-w-md opacity-80 decoration-sky-500/50 underline underline-offset-8">
            Access thousands of channels and movies instantly. Polished, fast, and secure.
          </p>
        </div>

        <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-sky-500/10 blur-[120px] rounded-full" />
      </div>

      <div className="md:w-1/2 flex items-center justify-center bg-zinc-900/30 border-l border-white/5">
        <div className="w-full max-w-md space-y-2 p-12">
          <div className="mb-10">
            <h2 className="text-2xl font-bold mb-2">Connect Account</h2>
            <p className="text-slate-500 font-medium">Enter your playlist credentials below</p>
          </div>

          <LoginInput label="Playlist URL" value={formData.server} focused={focusedField === 0} placeholder="http://server.com:80" onChange={(v) => handleChange('server', v)} onFocus={() => setFocusedField(0)} inputRef={serverRef} />
          <LoginInput label="Username" value={formData.username} focused={focusedField === 1} placeholder="Username" onChange={(v) => handleChange('username', v)} onFocus={() => setFocusedField(1)} inputRef={userRef} />
          <LoginInput label="Password" value={formData.password} focused={focusedField === 2} placeholder="Password" type="password" onChange={(v) => handleChange('password', v)} onFocus={() => setFocusedField(2)} inputRef={passRef} />

          <div onClick={() => setRemember(!remember)} onMouseEnter={() => setFocusedField(3)} className={`p-5 rounded-2xl border transition-all duration-300 cursor-pointer flex items-center justify-between ${focusedField === 3 ? 'bg-white/10 border-sky-500/50' : 'bg-transparent border-transparent'}`}>
            <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">Remember my login</span>
            <div className={`w-12 h-6 rounded-full transition-colors relative ${remember ? 'bg-sky-500' : 'bg-zinc-800'}`}>
              <div style={{ transform: `translateX(${remember ? '24px' : '0px'})` }} className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-lg transition-transform duration-300" />
            </div>
          </div>

          <div className="pt-6 space-y-4">
            <button onClick={() => onLogin(formData, remember)} disabled={isLoading} className={`w-full py-5 rounded-2xl font-black text-xl uppercase tracking-[0.1em] transition-all duration-300 flex flex-col items-center justify-center ${focusedField === 4 ? 'bg-sky-500 text-white shadow-2xl shadow-sky-500/40 scale-105' : 'bg-white/5 text-slate-400 border border-white/5'} ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}>
              {isLoading ? 'Connecting...' : 'Connect'}
            </button>
            <button onClick={() => onLogin({ server: 'http://demo.com', username: 'demo', password: 'demo' }, false)} disabled={isLoading} className={`w-full py-4 rounded-3xl font-bold text-sm uppercase tracking-[0.2em] transition-all duration-300 ${focusedField === 5 ? 'bg-white/10 text-white border-white/20 scale-105' : 'bg-transparent text-slate-600 border border-transparent'}`}>
              Try Quick Demo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginInput({ label, value, focused, placeholder, type = 'text', onChange, onFocus, inputRef }: {
  label: string;
  value: string;
  focused: boolean;
  placeholder: string;
  type?: string;
  onChange: (val: string) => void;
  onFocus: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div 
      onClick={() => inputRef.current?.focus()}
      className={`p-5 rounded-2xl border transition-all duration-300 cursor-pointer ${
        focused ? 'bg-white/10 border-sky-500/50 scale-[1.02]' : 'bg-white/5 border-transparent'
      }`}
    >
      <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">{label}</div>
      <input
        ref={inputRef}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        className="w-full bg-transparent border-none outline-none text-lg font-medium text-white placeholder:text-slate-700"
      />
    </div>
  );
}
