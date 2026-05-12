import { NextResponse } from "next/server";

export async function GET() {
  const reconciled = globalThis.__reconciled ?? false;

  if (!reconciled) {
    return NextResponse.json(
      { status: "starting", reconciled: false },
      { status: 503 }
    );
  }

  return NextResponse.json({ status: "ok", reconciled: true });
}
