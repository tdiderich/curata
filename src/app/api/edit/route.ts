import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { readPage, readPageYaml, writePageJson, writePage } from "@/lib/pages";
import { db } from "@/lib/db";

function replaceInValue(
  obj: unknown,
  target: string,
  replacement: string,
  caseInsensitive: boolean,
): { result: unknown; count: number } {
  if (typeof obj === "string") {
    if (caseInsensitive) {
      const idx = obj.toLowerCase().indexOf(target.toLowerCase());
      if (idx === -1) return { result: obj, count: 0 };
      const actual = obj.slice(idx, idx + target.length);
      const parts = obj.split(actual);
      const count = parts.length - 1;
      return { result: parts.join(replacement), count };
    }
    const parts = obj.split(target);
    return { result: parts.join(replacement), count: parts.length - 1 };
  }
  if (Array.isArray(obj)) {
    let total = 0;
    const arr = obj.map((item) => {
      const { result, count } = replaceInValue(item, target, replacement, caseInsensitive);
      total += count;
      return result;
    });
    return { result: arr, count: total };
  }
  if (obj && typeof obj === "object") {
    let total = 0;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const { result, count } = replaceInValue(v, target, replacement, caseInsensitive);
      out[k] = result;
      total += count;
    }
    return { result: out, count: total };
  }
  return { result: obj, count: 0 };
}

export async function POST(request: NextRequest) {
  const ctx = await resolveOrg();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { slug, target, replacement, componentId } = body;

    if (!slug || !target || replacement === undefined || replacement === null) {
      return NextResponse.json(
        { error: "slug, target, and replacement are required" },
        { status: 400 }
      );
    }

    const pageMeta = await db.page.findUnique({
      where: { orgId_slug: { orgId: ctx.orgId, slug } },
      select: { createdBy: true },
    });

    const isOwner = pageMeta?.createdBy === ctx.userId;
    if (!can(ctx.role, "page:edit", isOwner)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // If componentId provided, use JSON-based scoped replacement
    if (componentId) {
      const page = await readPage(ctx.orgId, slug);
      if (!page) {
        return NextResponse.json({ error: "page not found" }, { status: 404 });
      }

      const components = (page.json.components ?? []) as Array<Record<string, unknown>>;
      const idx = components.findIndex((c) => c.id === componentId);
      if (idx === -1) {
        return NextResponse.json(
          { error: `component ${componentId} not found` },
          { status: 404 }
        );
      }

      // Try exact match first, then case-insensitive
      let { result, count } = replaceInValue(components[idx], target, replacement, false);
      if (count === 0) {
        ({ result, count } = replaceInValue(components[idx], target, replacement, true));
      }

      if (count === 0) {
        return NextResponse.json(
          { error: "target text not found in component" },
          { status: 404 }
        );
      }

      if (count > 1) {
        return NextResponse.json(
          { error: `target text is ambiguous within component — found ${count} occurrences` },
          { status: 409 }
        );
      }

      const newComponents = [...components];
      newComponents[idx] = result as Record<string, unknown>;
      const newJson = { ...page.json, components: newComponents };
      const writeResult = await writePageJson(ctx.orgId, ctx.orgSlug, slug, newJson, "web", page.contentHash);
      if (!writeResult.ok) {
        return NextResponse.json({ error: writeResult.error }, { status: 409 });
      }

      return NextResponse.json({ ok: true });
    }

    // Fallback: YAML string replacement (no componentId — legacy / MCP path)
    const page = await readPageYaml(ctx.orgId, slug);
    if (!page) {
      return NextResponse.json({ error: "page not found" }, { status: 404 });
    }

    let yamlTarget = target;
    if (!page.yaml.includes(target)) {
      // Try case-insensitive
      const lowerYaml = page.yaml.toLowerCase();
      const lowerTarget = target.toLowerCase();
      const ciIdx = lowerYaml.indexOf(lowerTarget);
      if (ciIdx !== -1) {
        yamlTarget = page.yaml.slice(ciIdx, ciIdx + target.length);
      } else {
        // Try multiline flexible whitespace match
        const lines = target.split("\n");
        if (lines.length > 1) {
          const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const pattern = new RegExp(
            lines.map((l: string) => escapeRegex(l.trimStart())).join("\\n\\s*"),
            "i"
          );
          const m = page.yaml.match(pattern);
          if (m) yamlTarget = m[0];
          else return NextResponse.json({ error: "target text not found in page source" }, { status: 404 });
        } else {
          return NextResponse.json({ error: "target text not found in page source" }, { status: 404 });
        }
      }
    }

    const occurrences = page.yaml.split(yamlTarget).length - 1;
    if (occurrences > 1) {
      return NextResponse.json(
        { error: `target text is ambiguous — found ${occurrences} occurrences` },
        { status: 409 }
      );
    }

    const newContent = page.yaml.replace(yamlTarget, replacement);
    const result = await writePage(ctx.orgId, ctx.orgSlug, slug, newContent, "web", page.contentHash);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("edit error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
