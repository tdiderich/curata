import { execSync } from "child_process";

export async function setup(): Promise<void> {
  // Start docker-compose test db
  execSync("docker compose -f docker-compose.test.yml up -d --wait", {
    stdio: "inherit",
  });

  // Wait for pg_isready
  let ready = false;
  const deadline = Date.now() + 30_000;
  while (!ready && Date.now() < deadline) {
    try {
      execSync(
        "docker compose -f docker-compose.test.yml exec -T test-db pg_isready -U test",
        { stdio: "pipe" }
      );
      ready = true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  if (!ready) {
    throw new Error("Timed out waiting for test-db to be ready");
  }

  // Set DATABASE_URL for all child processes
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5555/curata_test";

  // Push schema to ephemeral test db
  execSync("npx prisma db push --accept-data-loss", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://test:test@localhost:5555/curata_test",
    },
  });
}

export async function teardown(): Promise<void> {
  execSync("docker compose -f docker-compose.test.yml down", {
    stdio: "inherit",
  });
}
