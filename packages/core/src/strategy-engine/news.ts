import type { NewsRisk } from './types.js';

/**
 * News risk.
 *
 * The application reports proximity to high-impact events. It does not block
 * trading unless the user has explicitly switched the news filter on — the
 * spec is deliberate about this, and the News Impact Analyzer exists to
 * measure whether the filter helps rather than assuming it does.
 */

export interface CalendarEventLike {
  id: string;
  name: string;
  country: string;
  /** epoch seconds, UTC */
  time: number;
  importance: 'high' | 'medium' | 'low';
}

export function buildNewsRisk(
  events: CalendarEventLike[],
  at: number,
  options: { windowMinutes: number; filterEnabled: boolean; minImportance?: 'high' | 'medium' },
): NewsRisk {
  const minImportance = options.minImportance ?? 'high';
  const rank = { low: 0, medium: 1, high: 2 } as const;
  const threshold = rank[minImportance];

  const relevant = events
    .filter((event) => rank[event.importance] >= threshold)
    .filter((event) => Math.abs(event.time - at) <= options.windowMinutes * 60)
    .sort((a, b) => Math.abs(a.time - at) - Math.abs(b.time - at));

  const nearest = relevant[0];

  if (!nearest) {
    const upcoming = events
      .filter((event) => rank[event.importance] >= threshold && event.time > at)
      .sort((a, b) => a.time - b.time)[0];

    return {
      nextEventName: upcoming?.name ?? null,
      nextEventTime: upcoming?.time ?? null,
      minutesToEvent: upcoming ? Math.round((upcoming.time - at) / 60) : null,
      impact: upcoming?.importance ?? null,
      filterBlocks: false,
      eventNearby: false,
      message: upcoming
        ? `Next ${upcoming.importance}-impact event: ${upcoming.name} in ${Math.round((upcoming.time - at) / 60)} min.`
        : 'No high-impact events scheduled in the loaded window.',
    };
  }

  const minutes = Math.round((nearest.time - at) / 60);
  const direction = minutes >= 0 ? `in ${minutes} min` : `${Math.abs(minutes)} min ago`;

  return {
    nextEventName: nearest.name,
    nextEventTime: nearest.time,
    minutesToEvent: minutes,
    impact: nearest.importance,
    filterBlocks: options.filterEnabled,
    eventNearby: true,
    message: `HIGH IMPACT EVENT ${direction.toUpperCase()}: ${nearest.name} (${nearest.country}).`,
  };
}
