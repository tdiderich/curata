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
