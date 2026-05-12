import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

const THEME_COLORS: Record<string, string> = {
  red: "#BB7777",
  orange: "#BB8C66",
  yellow: "#B8A866",
  green: "#899878",
  blue: "#7897B8",
  indigo: "#8A7FBB",
  violet: "#AB7FBB",
};

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const title = searchParams.get("title") || "Untitled";
  const org = searchParams.get("org") || "curata";
  const theme = searchParams.get("theme") || "violet";
  const accent = THEME_COLORS[theme] || THEME_COLORS.violet;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "60px 80px",
          backgroundColor: "#121113",
          color: "#F7F7F2",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "4px",
            background: accent,
          }}
        />
        <div
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: accent,
            marginBottom: 16,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {org}
        </div>
        <div
          style={{
            fontSize: title.length > 40 ? 48 : 64,
            fontWeight: 700,
            lineHeight: 1.15,
            maxWidth: "90%",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 40,
            right: 60,
            fontSize: 16,
            color: "#6E726C",
          }}
        >
          curata.ai
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
