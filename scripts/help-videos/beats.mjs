// Load a beats file for one variant. Desktop is the file as written. Mobile
// (HELP_VIDEO_MOBILE=1) captures the same stories at phone width (390x624:
// a phone screen minus browser chrome, sized to fill a 1080x1920 frame under
// the caption band) and applies
// each beat's optional `mobile:` block on top, so a beat only spells out what
// differs on a phone (steps, ring, caption, seconds). `mobile: { skip: true }`
// drops the beat from the mobile cut.
import fs from "node:fs";
import yaml from "js-yaml";

export const MOBILE = process.env.HELP_VIDEO_MOBILE === "1";

export function loadBeats(beatsPath) {
  const spec = yaml.load(fs.readFileSync(beatsPath, "utf8"));
  if (!MOBILE) return { ...spec, size: spec.size ?? [1440, 900] };
  const beats = spec.beats
    .map(({ mobile, ...b }) => (mobile ? { ...b, ...mobile } : b))
    .filter((b) => !b.skip);
  return { ...spec, size: spec.mobile_size ?? [390, 624], beats };
}
