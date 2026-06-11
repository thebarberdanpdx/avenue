/* gesture.test.js — locks the calendar touch rule (calendar-gesture-rev1).
   Reads the live decideCalendarGesture() out of App.jsx and proves the behavior
   that keeps regressing. Run as part of the ship ritual:  node gesture.test.js
   Exits non-zero on any failure so a bad ship is blocked. */
const fs = require("fs");
const path = require("path");
const candidates = [
  path.join(__dirname, "App.jsx"),
  path.join(__dirname, "src", "App.jsx"),
  path.join(process.cwd(), "src", "App.jsx"),
  path.join(process.cwd(), "App.jsx"),
];
const appPath = candidates.find((p) => fs.existsSync(p));
if (!appPath) { console.error("FAIL: could not find App.jsx near", __dirname); process.exit(1); }
const src = fs.readFileSync(appPath, "utf8");

const start = src.indexOf("const GESTURE_HOLD_MS");
const end = src.indexOf("/* ===== /CALENDAR-GESTURE-DECISION");
if (start === -1 || end === -1 || end < start) {
  console.error("FAIL: calendar-gesture-rev1 sentinel block not found in App.jsx");
  process.exit(1);
}
const block = src.slice(start, end);
let decideCalendarGesture, GESTURE_HOLD_MS, GESTURE_MOVE_PX;
try {
  ({ decideCalendarGesture, GESTURE_HOLD_MS, GESTURE_MOVE_PX } =
    new Function(block + "\nreturn { decideCalendarGesture, GESTURE_HOLD_MS, GESTURE_MOVE_PX };")());
} catch (e) {
  console.error("FAIL: could not evaluate the gesture rule:", e.message);
  process.exit(1);
}

let failed = 0;
const check = (label, got, want) => {
  if (got === want) { console.log("  PASS  " + label); }
  else { console.error(`  FAIL  ${label}  (got "${got}", expected "${want}")`); failed++; };
};

console.log("calendar-gesture-rev1 — touch rule");
check("swipe over a block (moved early) -> scroll", decideCalendarGesture({ movedPx: 30, heldMs: 60 }), "scroll");
check("big swipe, almost no hold -> scroll",        decideCalendarGesture({ movedPx: 80, heldMs: 5 }),  "scroll");
check("held still past the hold -> drag",           decideCalendarGesture({ movedPx: 0,  heldMs: GESTURE_HOLD_MS + 50 }), "drag");
check("move AFTER the hold completes -> drag",      decideCalendarGesture({ movedPx: 40, heldMs: GESTURE_HOLD_MS + 50 }), "drag");
check("tiny jitter, still holding -> pending",      decideCalendarGesture({ movedPx: 3,  heldMs: 60 }), "pending");
check("HOLD_MS is sane (150-600ms)", GESTURE_HOLD_MS >= 150 && GESTURE_HOLD_MS <= 600, true);
check("MOVE_PX is sane (4-20px)",    GESTURE_MOVE_PX >= 4 && GESTURE_MOVE_PX <= 20, true);

if (failed) { console.error(`\n${failed} gesture check(s) FAILED — do not ship.`); process.exit(1); }
console.log("\nAll gesture checks passed.");
