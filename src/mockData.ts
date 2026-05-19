/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Channel {
  id: string;
  name: string;
  logo: string;
  streamUrl: string;
  category: string;
}

export interface Program {
  id: string;
  channelId: string;
  title: string;
  description: string;
  start: Date;
  end: Date;
}

export interface Movie {
  id: string;
  title: string;
  poster: string;
  year: number;
  rating: string;
  plot: string;
  category?: string;
  streamUrl?: string;
}

export interface Series {
  id: string;
  title: string;
  poster: string;
  year: number;
  rating: string;
  plot: string;
  seasons: number;
  category?: string;
}

export const MOCK_CHANNELS: Channel[] = [
  { id: '1', name: 'HBO HD', logo: 'https://placehold.co/100x100/111/fff?text=HBO', streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', category: 'Movies' },
  { id: '2', name: 'AMC', logo: 'https://placehold.co/100x100/111/fff?text=AMC', streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', category: 'Movies' },
  { id: '3', name: 'CNN International', logo: 'https://placehold.co/100x100/111/fff?text=CNN', streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', category: 'News' },
  { id: '4', name: 'BBC World News', logo: 'https://placehold.co/100x100/111/fff?text=BBC', streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', category: 'News' },
];

const now = new Date();
now.setMinutes(0, 0, 0);

export const MOCK_PROGRAMS: Program[] = MOCK_CHANNELS.flatMap(channel => {
  const programs: Program[] = [];
  // Generate programs for 24 hours (from -6h to +18h)
  for (let i = -6; i < 18; i++) {
    const startTime = new Date(now.getTime() + i * 3600000);
    const endTime = new Date(now.getTime() + (i + 1) * 3600000);
    
    // Different titles based on time of day
    let title = `${channel.name} Special`;
    let desc = 'Enjoy our premium selection of contents.';
    
    const hour = startTime.getHours();
    if (hour >= 6 && hour < 9) {
      title = `Morning with ${channel.name}`;
      desc = 'Start your day with the latest news and weather updates.';
    } else if (hour >= 9 && hour < 12) {
      title = `${channel.name} Coffee Break`;
      desc = 'A relaxed mid-morning show with interviews and lifestyle segments.';
    } else if (hour >= 12 && hour < 14) {
      title = `Noon Express: ${channel.name}`;
      desc = 'Fast-paced news and summaries from around the world.';
    } else if (hour >= 14 && hour < 17) {
      title = `${channel.name} Matinee`;
      desc = 'Afternoon movies and acclaimed series for your enjoyment.';
    } else if (hour >= 17 && hour < 19) {
      title = `${channel.name} News at Sunset`;
      desc = 'Comprehensive evening news report covering local and global events.';
    } else if (hour >= 19 && hour < 22) {
      title = `${channel.name} Prime Time`;
      desc = 'Our most popular shows and exclusive premieres.';
    } else if (hour >= 22 || hour < 2) {
      title = `Late Night with ${channel.name}`;
      desc = 'Talk shows, comedy, and international features.';
    } else {
      title = `${channel.name} Night Owl`;
      desc = 'Relaxing overnight programs and documentaries.';
    }
    
    programs.push({
      id: `p-${channel.id}-${i}`,
      channelId: channel.id,
      title,
      description: desc,
      start: startTime,
      end: endTime,
    });
  }
  return programs;
});

export const MOCK_MOVIES: Movie[] = [
  { id: 'm1', title: 'The Dark Knight', poster: 'https://placehold.co/300x450/111/fff?text=Batman', year: 2008, rating: '9.0', plot: 'When the menace known as the Joker wreaks havoc and chaos on the people of Gotham, Batman must accept one of the greatest psychological and physical tests of his ability to fight injustice.' },
  { id: 'm2', title: 'Inception', poster: 'https://placehold.co/300x450/111/fff?text=Inception', year: 2010, rating: '8.8', plot: 'A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O.' },
  { id: 'm3', title: 'Interstellar', poster: 'https://placehold.co/300x450/111/fff?text=Interstellar', year: 2014, rating: '8.7', plot: 'A team of explorers travel through a wormhole in space in an attempt to ensure humanity\'s survival.' },
  { id: 'm4', title: 'The Matrix', poster: 'https://placehold.co/300x450/111/fff?text=Matrix', year: 1999, rating: '8.7', plot: 'A computer hacker learns from mysterious rebels about the true nature of his reality and his role in the war against its controllers.' },
  { id: 'm5', title: 'Pulp Fiction', poster: 'https://placehold.co/300x450/111/fff?text=Pulp+Fiction', year: 1994, rating: '8.9', plot: 'The lives of two mob hitmen, a boxer, a gangster and his wife, and a pair of diner bandits intertwine in four tales of violence and redemption.' },
];

export const MOCK_SERIES: Series[] = [
  { id: 's1', title: 'Succession', poster: 'https://placehold.co/300x450/111/fff?text=Succession', year: 2018, rating: '8.9', plot: 'The Roy family is known for controlling the biggest media and entertainment company in the world. However, their world changes when their father steps down from the company.', seasons: 4 },
  { id: 's2', title: 'The Last of Us', poster: 'https://placehold.co/300x450/111/fff?text=TLOU', year: 2023, rating: '8.8', plot: 'After a global pandemic destroys civilization, a hardened survivor takes charge of a 14-year-old girl who may be humanity\'s last hope.', seasons: 1 },
  { id: 's3', title: 'Better Call Saul', poster: 'https://placehold.co/300x450/111/fff?text=BCS', year: 2015, rating: '8.9', plot: 'The trials and tribulations of criminal lawyer Jimmy McGill in the years leading up to his fateful run-in with Walter White and Jesse Pinkman.', seasons: 6 },
];
