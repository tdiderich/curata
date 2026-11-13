export interface ActionBarFolder {
  id: string;
  name: string;
  parentId: string | null;
  visibility: string;
  locked?: boolean;
}

export interface ActionBarPage {
  slug: string;
  title: string;
  folderId: string | null;
  pinned: boolean;
  visibility: string;
  /** ISO timestamp of the last write, for "what happened recently" */
  updatedAt?: string;
}

/** Home's "Needs you" strip. Null means that count couldn't be read. */
export interface NeedsYouCounts {
  /** Pages never approved, or whose latest edit is past the approved version. */
  review: number | null;
  /** Open cleanup flags (pending, or snoozes that have lapsed). */
  flagged: number | null;
  /** Content-map items whose source moved since they were last checked. */
  stale: number | null;
}

/** One phrasing for every search box: the top bar, its overlay and Home. */
export const SEARCH_PLACEHOLDER = "Search pages and actions…";
