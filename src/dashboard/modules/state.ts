// ============================================================
//  All-Downloader — Dashboard Shared State Store
// ============================================================
import { DEFAULT_SETTINGS } from '../../shared/constants.js';

export interface CachedRowRefs {
  tr: HTMLElement;
  fill: HTMLElement | null;
  label: HTMLElement | null;
  sizeCell: HTMLElement | null;
  speed: HTMLElement | null;
  eta: HTMLElement | null;
  statusCol: HTMLElement | null;
}

export interface DashboardState {
  downloads: Record<string, any>;
  settings: any;
  stats: any;
  currentView: string;
  activeFilter: string;
  activeCat: string;
  searchQuery: string;
  sortCol: string;
  sortDir: 'asc' | 'desc';
  selected: Set<string>;
  latestQueueOrder: string[];
  debounceQueueSliderTimer: any;
  histSortCol: string;
  histSortDir: 'asc' | 'desc';
  currentPage: number;
  PAGE_SIZE: number;
  histCurrentPage: number;
  HIST_PAGE_SIZE: number;
  pendingProgressIds: Set<string>;
  rafScheduled: boolean;
  rowCache: Map<string, CachedRowRefs>;
}

export const state: DashboardState = {
  downloads: {},
  settings: { ...DEFAULT_SETTINGS },
  stats: {},
  currentView: 'downloads',
  activeFilter: 'all',
  activeCat: 'all',
  searchQuery: '',
  sortCol: 'createdAt',
  sortDir: 'desc',
  selected: new Set<string>(),
  latestQueueOrder: [],
  debounceQueueSliderTimer: null,
  histSortCol: 'time',
  histSortDir: 'desc',
  currentPage: 1,
  PAGE_SIZE: 50,
  histCurrentPage: 1,
  HIST_PAGE_SIZE: 50,
  pendingProgressIds: new Set<string>(),
  rafScheduled: false,
  rowCache: new Map<string, CachedRowRefs>(),
};
