#!/usr/bin/env node
// Parse args: curata init | curata up | curata api-key

const command = process.argv[2];

async function main() {
  switch (command) {
    case "init": {
      const { runInit } = await import("./init.js");
      await runInit();
      break;
    }
    case "up": {
      const { runUp } = await import("./up.js");
      await runUp();
      break;
    }
    case "api-key": {
      const { runApiKey } = await import("./api-key.js");
      await runApiKey();
      break;
    }
    default: {
      console.log("Usage: curata <command>");
      console.log("");
      console.log("Commands:");
      console.log("  init      Generate .env and docker-compose.yml for self-hosted setup");
      console.log("  up        Start containers and wait for healthy state");
      console.log("  api-key   Generate an API key and print MCP config snippet");
      if (command && command !== "--help" && command !== "-h") {
        console.error(`\nUnknown command: ${command}`);
        process.exit(1);
      }
      break;
    }
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
