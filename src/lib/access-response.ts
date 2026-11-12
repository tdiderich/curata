import { NextResponse } from "next/server";
import { PageAccessError } from "./access";

/// The one mapping from a PageAccessError to a route response, so a hidden
/// page gets the same 404 and a view-only page the same 403 everywhere.
/// Returns null for any other error so the route keeps its own handling.
export function pageAccessErrorResponse(err: unknown): NextResponse | null {
  return err instanceof PageAccessError ? NextResponse.json({ error: err.message }, { status: err.status }) : null;
}
