import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import pg from "pg";

const { Client } = pg;

function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  const key = `ck_${raw}`;
  const prefix = key.slice(0, 8);
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  return { key, prefix, hash };
}

/**
 * Generate a CUID-like ID using crypto.randomUUID() as the source of randomness.
 * Format: c + timestamp-based chars + random chars (simplified).
 */
function generateId(): string {
  // Use a simplified CUID-like format: c + hex timestamp + random hex
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(12).toString("hex");
  return `c${ts}${rand}`.slice(0, 25);
}

async function readDatabaseUrl(): Promise<string> {
  const envPath = path.join(process.cwd(), ".env");
  let envContent: string;

  try {
    envContent = await fs.readFile(envPath, "utf8");
  } catch {
    // Fall back to environment variable
    const envVar = process.env["DATABASE_URL"];
    if (envVar) return envVar;
    throw new Error(
      "No .env file found in current directory and DATABASE_URL is not set.\n" +
      "Run `curata init` first, or set DATABASE_URL in your environment."
    );
  }

  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("DATABASE_URL=")) {
      return trimmed.slice("DATABASE_URL=".length).trim();
    }
  }

  // Fall back to environment variable
  const envVar = process.env["DATABASE_URL"];
  if (envVar) return envVar;

  throw new Error(
    "DATABASE_URL not found in .env file and not set in environment.\n" +
    "Run `curata init` first, or add DATABASE_URL to your .env file."
  );
}

async function ensureSchema(client: pg.Client): Promise<void> {
  // Verify the api_keys table exists
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'api_keys'
    ) AS exists`
  );

  if (!result.rows[0]?.exists) {
    throw new Error(
      "The api_keys table does not exist. Schema may not be migrated yet.\n" +
      "Ensure the app container has started (it runs migrations on boot).\n" +
      "Check logs with: docker compose logs app"
    );
  }
}

async function findOrCreateOrg(client: pg.Client): Promise<{ id: string; slug: string }> {
  const existing = await client.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM organizations LIMIT 1`
  );

  if (existing.rows.length > 0) {
    return existing.rows[0]!;
  }

  const id = generateId();
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO organizations (id, name, slug, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)`,
    [id, "curata", "curata", now]
  );

  return { id, slug: "curata" };
}

export async function runApiKey(): Promise<void> {
  const databaseUrl = await readDatabaseUrl();

  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    await ensureSchema(client);

    const org = await findOrCreateOrg(client);

    const { key, prefix, hash } = generateApiKey();
    const id = generateId();
    const now = new Date().toISOString();

    await client.query(
      `INSERT INTO api_keys (id, org_id, name, key_hash, prefix, scopes, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, org.id, "cli-generated", hash, prefix, "{read,write}", "system", now]
    );

    const mcpConfig = {
      mcpServers: {
        curata: {
          command: "npx",
          args: ["-y", "@curata/mcp-server"],
          env: {
            CURATA_API_KEY: key,
            CURATA_URL: "http://localhost:3000",
          },
        },
      },
    };

    console.log("\nAPI key generated successfully!");
    console.log("\n--- Your API Key (save this — it will not be shown again) ---");
    console.log(`\n  ${key}\n`);
    console.log("--- Claude MCP Config (add to ~/Library/Application Support/Claude/claude_desktop_config.json) ---");
    console.log(JSON.stringify(mcpConfig, null, 2));
    console.log("\nOrg slug:", org.slug);
    console.log("App URL:  http://localhost:3000");
  } finally {
    await client.end();
  }
}
