import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

async function dockerComposeUp(): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", ["compose", "up", "-d"], {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    proc.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`docker compose up exited with code ${code}`));
    });
    proc.on("error", reject);
  });
}

async function waitForHealthy(maxAttempts = 30, intervalMs = 3000): Promise<void> {
  console.log("Waiting for containers to be healthy...");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { stdout } = await execFileAsync("docker", [
        "compose",
        "ps",
        "--format",
        "json",
      ]);

      // docker compose ps --format json outputs one JSON object per line
      const lines = stdout.trim().split("\n").filter(Boolean);
      const services = lines.map(line => {
        try {
          return JSON.parse(line) as { Service: string; Health: string; State: string };
        } catch {
          return null;
        }
      }).filter(Boolean) as { Service: string; Health: string; State: string }[];

      if (services.length === 0) {
        process.stdout.write(`\r  Attempt ${attempt}/${maxAttempts}: waiting for services...`);
      } else {
        const allHealthy = services.every(s =>
          s.Health === "healthy" || (s.State === "running" && s.Health === "")
        );
        const postgresService = services.find(s => s.Service === "postgres");
        const postgresHealthy = postgresService?.Health === "healthy";

        if (allHealthy && postgresHealthy) {
          process.stdout.write("\n");
          return;
        }

        const statuses = services.map(s => `${s.Service}:${s.Health || s.State}`).join(", ");
        process.stdout.write(`\r  Attempt ${attempt}/${maxAttempts}: ${statuses}    `);
      }
    } catch {
      process.stdout.write(`\r  Attempt ${attempt}/${maxAttempts}: waiting...`);
    }

    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  process.stdout.write("\n");
  throw new Error(
    `Containers did not become healthy after ${maxAttempts * intervalMs / 1000}s. ` +
    "Check logs with: docker compose logs"
  );
}

export async function runUp(): Promise<void> {
  console.log("Starting curata containers...");

  await dockerComposeUp();
  await waitForHealthy();

  console.log("\nAll containers are healthy.");
  console.log("\nNext steps:");
  console.log("  - Generate an API key: curata api-key");
  console.log("  - Open the app:        http://localhost:3000");
  console.log("  - View logs:           docker compose logs -f");
}
