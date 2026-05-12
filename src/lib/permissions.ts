export type Role = "owner" | "admin" | "member" | "viewer";
export type Action =
  | "page:create"
  | "page:edit"
  | "page:delete"
  | "folder:manage"
  | "key:manage"
  | "member:manage"
  | "annotate";

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
    case "key:manage":
    case "member:manage":
      return role === "owner" || role === "admin";
    default:
      return false;
  }
}
