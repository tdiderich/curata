export type Role = "owner" | "admin" | "member" | "viewer";
export type Action =
  | "page:create"
  | "page:edit"
  | "page:delete"
  | "page:share"
  | "page:manage-link"
  | "folder:manage"
  | "key:manage"
  | "member:manage"
  | "annotate";

export const VALID_PAGE_VISIBILITY = ["private", "org", "public"] as const;
export type PageVisibility = (typeof VALID_PAGE_VISIBILITY)[number];

export function can(role: Role, action: Action, isOwner?: boolean): boolean {
  switch (action) {
    case "annotate":
      return true;
    case "page:create":
    case "page:edit":
      return role !== "viewer";
    case "page:delete":
    case "folder:manage":
      return role === "owner" || role === "admin" || isOwner === true;
    case "page:share":
    case "page:manage-link":
      return role !== "viewer" || isOwner === true;
    case "key:manage":
    case "member:manage":
      return role === "owner" || role === "admin";
    default:
      return false;
  }
}
