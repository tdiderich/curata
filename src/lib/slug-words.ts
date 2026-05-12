/**
 * Fun random slug generator for org slugs.
 * Produces pairs like "funky-monkey", "cosmic-penguin", "jazzy-walrus".
 */

const ADJECTIVES = [
  "funky", "cosmic", "jazzy", "bouncy", "snappy", "crispy", "fluffy", "zesty",
  "groovy", "peppy", "quirky", "spiffy", "zippy", "nifty", "dandy", "jolly",
  "witty", "merry", "plucky", "spunky", "frisky", "feisty", "breezy", "cheery",
  "perky", "sunny", "lively", "vivid", "vibrant", "electric", "radiant", "bold",
  "swift", "nimble", "agile", "sleek", "sharp", "keen", "bright", "clever",
  "dapper", "fancy", "swanky", "classy", "snazzy", "flashy", "swish", "ritzy",
  "savvy", "sassy", "brash", "cheeky", "peppy", "racy", "spry", "wiry",
  "hardy", "sturdy", "brawny", "stout", "burly", "mighty", "epic", "grand",
  "noble", "regal", "royal", "prime", "peak", "apex", "ultra", "mega",
  "turbo", "hyper", "super", "stellar", "lunar", "solar", "astral", "orbital",
  "arctic", "polar", "tropical", "misty", "stormy", "breezy", "gusty", "balmy",
  "molten", "frozen", "blazing", "sparkling", "glowing", "shining", "dazzling",
  "mystical", "ancient", "mythic", "heroic", "brave", "bold", "daring", "fearless",
];

const NOUNS = [
  "monkey", "penguin", "walrus", "falcon", "jaguar", "panda", "koala", "lemur",
  "otter", "badger", "weasel", "ferret", "marmot", "capybara", "tapir", "sloth",
  "gecko", "iguana", "axolotl", "narwhal", "manatee", "dugong", "dolphin", "porpoise",
  "osprey", "condor", "macaw", "toucan", "hornbill", "pelican", "flamingo", "ibis",
  "quokka", "numbat", "bilby", "wombat", "dingo", "echidna", "cassowary", "kiwi",
  "meerkat", "caracal", "serval", "ocelot", "margay", "coati", "kinkajou", "binturong",
  "pangolin", "aardvark", "okapi", "bongo", "impala", "gerenuk", "addax", "oryx",
  "tarsier", "galago", "loris", "sifaka", "indri", "fossa", "tenrec", "aye-aye",
  "wolverine", "stoat", "polecat", "zorilla", "genet", "civet", "linsang", "fanaloka",
  "platypus", "quoll", "potoroo", "bandicoot", "dasyure", "thylacine", "cuscus", "possum",
  "vaquita", "baiji", "boutu", "boto", "tucuxi", "finless", "hector", "maui",
  "peacock", "quetzal", "kakapo", "kea", "lorikeet", "cockatoo", "galah", "rosella",
  "mudskipper", "archerfish", "blobfish", "sunfish", "oarfish", "coelacanth", "hagfish", "lamprey",
];

/**
 * Generates a fun slug like "funky-monkey".
 * If the generated slug is already taken, appends a random 3-digit number.
 *
 * @param existingSlugs - Optional set of slugs already in use. When provided,
 *   the function appends a numeric suffix if there's a collision.
 */
export function generateFunSlug(existingSlugs?: Set<string>): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const base = `${adj}-${noun}`;

  if (!existingSlugs || !existingSlugs.has(base)) {
    return base;
  }

  // Append a random 3-digit number on collision
  const suffix = Math.floor(100 + Math.random() * 900);
  return `${base}-${suffix}`;
}
