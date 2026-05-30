import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from './supabaseClient'
import {
  Calendar, Phone, Check, ChevronRight, ChevronLeft, ChevronDown, MessageSquare, Bell, User, Camera,
  Send, Edit2, CheckCircle2, AlertCircle, Sparkles, ArrowLeft, Plus, X, Clock,
  Settings, Image as ImageIcon, Trash2, Upload, GripVertical, DollarSign,
  MoreHorizontal, Mail, CreditCard, RefreshCw, Copy, Repeat, Users, Sun, Moon, MapPin as MapPinIcon,
  BarChart3, TrendingUp
} from "lucide-react";

// ============================================================
// PHOTO LIBRARY — curated "looks" baked in for the prototype.
// In the live product this becomes a live Unsplash/Pexels feed.
// (Using Unsplash CDN URLs as stand-ins for the curated set.)
// ============================================================
const PHOTO_LIBRARY = {
  Haircuts: [
    "photo-1503951914875-452162b0f3f1", "photo-1599351431202-1e0f0137899a",
    "photo-1622286342621-4bd786c2447c", "photo-1605497788044-5a32c7078486",
  ],
  Beard: [
    "photo-1621607512214-68297480165e", "photo-1517832606299-7ae9b720a186",
    "photo-1635273051937-a0cc8b6e8e8e", "photo-1582893561942-d61adcb2e534",
  ],
  Shave: [
    "photo-1503951914875-452162b0f3f1", "photo-1493256338651-d82f7acb2b38",
    "photo-1599351431613-18ef1fdd09e3", "photo-1596728325488-58c87691e9af",
  ],
  Spa: [
    "photo-1570172619644-dfd03ed5d881", "photo-1596755389378-c31d21fd1273",
    "photo-1512290923902-8a9f81dc236c", "photo-1519823551278-64ac92734fb1",
  ],
};
const imgUrl = (id, w = 400) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=70`;
// Portrait/headshot stand-ins for staff profile pictures.
const STAFF_PORTRAITS = [
  "photo-1622286342621-4bd786c2447c", "photo-1595959183082-7b570b7e08e2",
  "photo-1500648767791-00dcc994a43e", "photo-1494790108377-be9c29b29330",
  "photo-1607990281513-2c110a25bd8c", "photo-1544005313-94ddf0286df2",
  "photo-1568602471122-7832951cc4c5", "photo-1438761681033-6461ffad8d80",
  "photo-1507003211169-0a1dd7228f2d", "photo-1599566150163-29194dcaad36",
  "photo-1580489944761-15a19d654956", "photo-1534528741775-53994a69daeb",
];
// Guarantees a profile photo for any staff member: their own if set,
// otherwise a stable portrait derived from their id (never blank).
const hashStr = (str) => { let h = 0; const s = String(str || ""); for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return Math.abs(h); };
const staffPhoto = (p) => (p && p.photo) ? p.photo : STAFF_PORTRAITS[hashStr(p && p.id) % STAFF_PORTRAITS.length];
// Clients keep their colored initial unless a photo has been set explicitly.
const clientPhoto = (c) => (c && c.photo) ? c.photo : null;
// Reusable circular avatar — edge-to-edge photo or centered initial.
// Renders identically everywhere so staff/client avatars never break.
function Avatar({ size = 42, photo = null, initial = "", color = "var(--gold)", fontSize, style = {}, children }) {
  const fs = fontSize || Math.round(size * 0.44);
  const base = color || "var(--gold)";
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", overflow: "hidden", flexShrink: 0, position: "relative", background: photo ? "var(--panel2)" : base, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: fs, ...style }}>
      {photo
        ? <img src={imgUrl(photo, Math.max(120, size * 3))} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        : (initial || null)}
      {children}
    </div>
  );
}
const ALL_LIBRARY = Object.entries(PHOTO_LIBRARY).flatMap(([cat, ids]) => ids.map((id) => ({ id, cat })));

// ============================================================
// SERVICE COLOR PALETTE — muted, premium tones (editable per service)
// Plus the status colors that OVERRIDE service color on the calendar.
// ============================================================
const SERVICE_PALETTE = [
  { id: "sage", name: "Sage", hex: "#7A9E9F" },
  { id: "gold", name: "Gold", hex: "var(--gold)" },
  { id: "clay", name: "Clay", hex: "#C2703D" },
  { id: "slate", name: "Slate", hex: "#6B7A99" },
  { id: "olive", name: "Olive", hex: "#8A8A5C" },
  { id: "mauve", name: "Mauve", hex: "#9C7A8E" },
  { id: "teal", name: "Teal", hex: "#5E8C8C" },
  { id: "sand", name: "Sand", hex: "#A89878" },
];
const STATUS_COLORS = {
  "checked-in": "#8B6FB0", // purple — client has arrived
  "in-service": "#D98BA0", // reddish/pink — in the chair
  done: "var(--border2)",         // muted/greyed — finished, recedes
};
const hexById = (id) => (SERVICE_PALETTE.find((c) => c.id === id) || SERVICE_PALETTE[0]).hex;

// ============================================================
// DEFAULT BUSINESS CONFIG — fully editable in Settings
// ============================================================
const DEFAULT_BUSINESS = {
  name: "MERIDIAN",
  legalName: "Meridian Studio",
  address: "2077 NE Town Center Dr",
  address2: "Suite 120",
  cityZip: "Beaverton, OR 97006",
  email: "hello@meridianstudio.com",
  phones: [{ id: "ph1", label: "Main", number: "(503) 555-0142" }],
  logoText: "", // optional custom logo wordmark (falls back to business name)
  showAddonPhotos: true, // owner preference toggle
  aiCutHelper: false, // when ON, shows "Show us a photo" + "I'm not sure" on Pick Your Cut (needs reference photos uploaded first)
  weekStartsOn: 0, // 0=Sunday … 6=Saturday — first day of the calendar week
  // Shop open hours per weekday (0=Sun … 6=Sat), times in minutes from midnight
  hours: { 0: { on: true, start: 600, end: 900 }, 1: { on: true, start: 540, end: 1020 }, 2: { on: false, start: 540, end: 1020 }, 3: { on: false, start: 540, end: 1020 }, 4: { on: true, start: 540, end: 1020 }, 5: { on: true, start: 540, end: 1020 }, 6: { on: true, start: 540, end: 1020 } },
  // Waitlist auto-notify behavior when a slot frees up
  waitlist: { mode: "ask", order: "longest", delayMin: 30, photoNudge: true, askAnyProvider: true }, // mode: ask|silent · order: longest|all · photoNudge: prompt for a photo · askAnyProvider: ask if open to any provider
  // Softened, neutral default policy — every business edits this freely
  policy: "We kindly ask for at least 24 hours' notice to cancel or reschedule so we can offer the time to someone else. A card is required to reserve your appointment; you won't be charged unless you miss it without notice. Thank you for understanding.",
  // ---- Online booking rules ----
  booking: {
    enabled: true,
    leadTimeMin: 120,        // minimum notice before an appointment, in minutes
    horizonDays: 60,         // how far out clients can book
    sameDayCutoff: "",       // e.g. "14:00" — no same-day bookings after this (blank = off)
    allowMultiple: true,     // multiple services per booking
    clientType: "all",       // all | returning | new
    requireCard: true,
    deposit: { mode: "none", amount: 0 }, // none | fixed | percent
    bufferBefore: 0,         // minutes pad before each appt
    bufferAfter: 5,          // minutes pad after each appt
    dailyCap: 0,             // 0 = unlimited online bookings per day
    fillGapsFirst: true,     // Boulevard-style: offer gap-filling slots first
    rebookNudgeWeeks: 4,     // suggest rebooking after N weeks (0 = off)
    guidedConsult: true,     // new-client guided consultation (true) vs. simple cut list (false)
    // Gap avoidance — strict back-to-back booking to eliminate dead time
    avoidGaps: true,         // when true, only offer times flush with existing appts (or day start)
    maxGapMin: 0,            // don't offer a slot if it would leave a gap LARGER than this on either side (0 = no max)
    minGapMin: 0,            // don't offer a slot that would leave a gap SMALLER than this (0 = no min)
    emptyDayMode: "all",     // "all" = offer all increments on empty days; "anchored" = only earliest of each shift
  },
  // ---- Waiting Room / check-in behavior (Calendar & Appointments → Waiting Room) ----
  waitingRoom: {
    selfCheckIn: false,        // (needs link/QR) clients can check themselves in
    autoReadyMessage: true,    // send a "we're ready for you" notice on Notify·Ready
    readyMessage: "{provider} is ready for you and will meet you in front.",
    showWaitingList: true,     // show a live "who's waiting" panel
    notifyOnArrival: true,     // ping the provider when a client checks in
  },
  // ---- Running-late alert: prompt to notify the next client when wrapping up ----
  runningLate: {
    enabled: true,
    thresholdMin: 5,                 // show the prompt when this many minutes are left
    ranges: ["5–10", "10–15"],       // delay options offered to choose from
    message: "Hi {client}, it's {provider} at {shop} — I'm just wrapping up and running about {range} min behind. Thanks so much for your patience, see you soon!",
  },
  // ---- "It's been a while" buffer: add time for clients overdue past a threshold ----
  overdueBuffer: {
    enabled: true,
    thresholdWeeks: 8,   // if last visit was longer ago than this, add buffer
    addMinutes: 10,      // how much time to add
    charge: false,       // false = free bonus (perceived value); true = charge for it
    chargeAmount: 5,     // $ added when charge = true
    message: "Welcome back! Since it's been a little while, we've added some extra time to your appointment so we can take care of everything properly.",
  },
  // ---- Tipping shown at checkout ----
  tipping: {
    enabled: true,
    presets: [18, 20, 25],   // percentage buttons clients see
    allowCustom: true,        // let them enter a custom amount
    allowNoTip: true,         // show a "No tip" option
    smartDefault: 20,         // pre-highlighted suggestion
  },
  // ---- Checkout / payment behavior (Payments & Checkout → Checkout Settings) ----
  checkout: {
    customMethods: ["Cash", "Card", "Venmo"], // accepted payment method labels
    requireSignature: "over",  // never | always | over (over a threshold)
    signatureThreshold: 25,    // $ amount above which a signature is asked
    changeCalculator: true,    // show change-due calculator on cash payments
    requireStaffAssignment: true, // every line item must have a staff member
    clientSelfCheckout: false, // (needs payment backend) let clients pay on their own device
    receiptDefault: "ask",     // ask | email | text | print | none
    receiptFooter: "Thank you for visiting!",
  },
  // ---- Rebooking offer at end of checkout (customizable) ----
  rebook: {
    enabled: true,               // show the rebook screen at checkout at all
    discountEnabled: true,       // offer a discount as the incentive (vs. just prompting to rebook)
    discountType: "amount",      // "amount" ($) or "percent" (%)
    discount: 5,                 // value: dollars off, or percent off, per discountType
    weeks: [2, 3, 4, 6, 8],      // quick-jump options offered
  },
  // ---- Automated messages: editable wording per event ----
  // Merge tags {client} {provider} {service} {date} {time} {business} get filled in automatically.
  messages: [
    { id: "booked", label: "Appointment Booked", channel: "both", timing: "Right after booking", enabled: true,
      body: "You're all set, {client}! Your {service} with {provider} at {business} is confirmed for {date} at {time}. Need to change it? Reply or tap the link in your confirmation." },
    { id: "remind2d", label: "Reminder — 2 days before", channel: "email", timing: "2 days before", enabled: true,
      body: "Hi {client}, just a reminder of your upcoming {service} with {provider} at {business} on {date} at {time}. See you soon!" },
    { id: "remind24h", label: "Reminder — 24 hours before", channel: "text", timing: "24 hours before", enabled: true,
      body: "Reminder: {service} with {provider} tomorrow at {time}. Reply C to confirm, or tap to reschedule." },
    { id: "remind3h", label: "Reminder — 3 hours before", channel: "text", timing: "3 hours before", enabled: true,
      body: "See you today at {time}, {client}! {provider} has you down for a {service}. {business}" },
    { id: "checkin", label: "Check-in / Ready", channel: "text", timing: "When you tap \u201cready\u201d", enabled: true,
      body: "{provider} is ready for you, {client}! Come on back whenever you're set." },
    { id: "canceled", label: "Appointment Canceled", channel: "both", timing: "When canceled", enabled: true,
      body: "Your {service} on {date} at {time} has been canceled, {client}. We'd love to see you again — book anytime at {business}." },
    { id: "rescheduled", label: "Appointment Rescheduled", channel: "both", timing: "When rescheduled", enabled: true,
      body: "Updated! Your {service} with {provider} is now {date} at {time}. See you then, {client}." },
    { id: "waitlist", label: "Waitlist — Slot Opened", channel: "text", timing: "When a slot opens", enabled: true,
      body: "Good news {client} — a spot opened for your {service} with {provider} on {date} at {time}. Reply YES to grab it before someone else does!" },
  ],
  // ---- Locations: off by default; turns on for multi-location businesses ----
  multiLocation: false,
  locations: [
    { id: "loc1", name: "Main Studio", address: "2077 NE Town Center Dr, Suite 120", cityZip: "Beaverton, OR 97006", phone: "(503) 555-0142", hours: "Mon, Thu–Sun · 9–5" },
  ],
};

// Each working day: { on: bool, start: minutes, end: minutes }. Keyed 0(Sun)–6(Sat).
const DEFAULT_HOURS = {
  0: { on: true, start: 600, end: 900 },   // Sun 10–3
  1: { on: true, start: 540, end: 1020 },  // Mon 9–5
  2: { on: false, start: 540, end: 1020 }, // Tue off
  3: { on: false, start: 540, end: 1020 }, // Wed off
  4: { on: true, start: 540, end: 1020 },  // Thu 9–5
  5: { on: true, start: 540, end: 1020 },  // Fri 9–5
  6: { on: true, start: 540, end: 1020 },  // Sat 9–5
};
const defaultStaffNotifications = () => ({ smsOnlineBooking: true, smsOtherBooking: true, emailOnlineBooking: false, appNewText: true, appNewChat: true, appMissedCall: true });
const defaultComp = () => ({
  service: { on: false, type: "basic", basicPct: 0, tiers: [{ upTo: 500, pct: 30 }, { upTo: null, pct: 40 }] },
  product: { on: false, defaultPct: 0, overridesOn: false },
  hourly: { on: false, rate: 0, greaterOf: false },
});

// ============================================================
// PERMISSIONS — Mangomint-style access toggles, grouped by area.
// Each item: { key, label, desc }. defaultPermissions(userType)
// returns every key on for Admins, off for everyone else.
// ============================================================
const PERMISSION_SECTIONS = [
  { group: "Setup & Management", items: [
    { key: "manageStaff", label: "Can manage staff members", desc: "Add staff members, change work hours and service assignments, etc. Does not grant access to the Permissions and Compensation tabs." },
    { key: "manageServices", label: "Can manage service settings", desc: "Create and change services, service assignments, online booking service settings, etc." },
    { key: "managePaymentAccounts", label: "Can manage payment accounts", desc: "Grants access to the Payment Accounts tab to review transactions, payouts, etc." },
  ] },
  { group: "User Profile", items: [
    { key: "ownWorkSchedule", label: "Can change own work schedule", desc: "Set, modify, and override own work schedule via their User Profile menu." },
    { key: "ownServiceAssignments", label: "Can change own service assignments", desc: "Assign/unassign themselves to services via their User Profile menu. Grants overriding of their own default service prices and durations." },
    { key: "ownTotals", label: "Can view own daily/weekly totals", desc: "Grants access to Daily Totals and Weekly Totals (i.e. number of services, service revenue, tips, etc.) from the mobile app menu." },
  ] },
  { group: "Calendar", items: [
    { key: "manageWaitlist", label: "Can manage waitlist", desc: "Add, change, and remove waitlist entries." },
  ] },
  { group: "Clients", items: [
    { key: "accessAllClients", label: "Can access everybody's clients", desc: "Grants access to all clients, regardless of who is set as the client owner." },
    { key: "viewClientLastNames", label: "Can view clients' last names", desc: "Disable this permission to hide clients' last names from this staff member and remove access to the clients list." },
    { key: "accessClientContact", label: "Can access clients' contact details", desc: "Disable this permission to hide any client contact details (i.e. phone number, email address) from this staff member." },
    { key: "deleteMergeClients", label: "Can delete and merge clients", desc: "Allows deleting or merging any clients this staff member can access. Does not affect client visibility." },
  ] },
  { group: "Sales", items: [
    { key: "adjustClientBalances", label: "Can manually adjust client account balances", desc: "Manually increase or decrease a client's account balance." },
    { key: "viewIndividualSales", label: "Can view individual sales on calendar", desc: "View the attached sale for appointments that are visible to this person. Does not grant access to the Sales app." },
    { key: "viewOwnSales", label: "Can view list of own sales", desc: "Grants access to the list of their own sales." },
    { key: "viewAllSales", label: "Can view all sales", desc: "Viewing only. Grants access to the Sales app. Does not allow modifying of sales." },
    { key: "checkoutModifySales", label: "Can start a checkout and modify sales", desc: "Take payments, reopen closed sales, make changes to services and products in a sale, etc." },
    { key: "sellNonRetail", label: "Can sell non-retail products", desc: "Add products from \"non-retail\" categories during checkout. Can be helpful for tracking internal product usage (professional-use items)." },
    { key: "refundClosedSales", label: "Can refund sales (open and closed)", desc: "Allow refunding items or entire sales, whether they are open or closed. Grants full refund capabilities." },
    { key: "refundOpenSales", label: "Can refund open sales", desc: "Allow refunding payments during checkout or on a re-opened sale." },
  ] },
  { group: "Messages", items: [
    { key: "viewIndividualConversations", label: "Can view individual conversations", desc: "View conversations and message history for clients that are visible to this person. Does not allow sending messages." },
    { key: "viewAllConversations", label: "Can view all conversations", desc: "Viewing only. Grants access to the Messages app. Does not allow sending messages." },
    { key: "sendMessages", label: "Can send messages", desc: "Send messages to clients in the conversations that are visible to this person." },
  ] },
  { group: "Reports", items: [
    { key: "companyReports", label: "Can access company reports", desc: "Grants access to all available reports." },
  ] },
  { group: "Products", items: [
    { key: "manageProducts", label: "Can manage products", desc: "Create, change, and delete products. Allows manual inventory changes. Not required to add products during checkout." },
  ] },
  { group: "Gift Cards", items: [
    { key: "manageGiftCards", label: "Can manage gift cards", desc: "Manually create, adjust, and delete gift cards. Not required to sell or redeem gift cards during checkout." },
  ] },
  { group: "Packages", items: [
    { key: "managePackages", label: "Can manage packages", desc: "Manually create, adjust, and delete packages. Not required to sell or use packages during checkout." },
    { key: "managePackageSetups", label: "Can manage package setups", desc: "Create and modify package setups." },
  ] },
  { group: "Memberships", items: [
    { key: "manageMemberships", label: "Can manage memberships", desc: "Start, change, and cancel client memberships. Includes pausing client memberships and renewing client memberships early." },
    { key: "bypassMembershipAgreements", label: "Can bypass membership agreements", desc: "Skip agreement requirement when starting memberships." },
    { key: "manageMembershipPlans", label: "Can manage membership plans", desc: "Create and modify membership plans." },
  ] },
  { group: "Cash Drawer", items: [
    { key: "manageCashDrawer", label: "Can manage cash drawer", desc: "Grants access to the Cash Drawer app. Perform counts and add manual pay-ins and pay-outs." },
  ] },
  { group: "Time Clock", items: [
    { key: "viewTimeClock", label: "Can view Time Clock app", desc: "Grants access to the Time Clock app. Allows clocking in on any device where this user is logged in. Note that this permission is not required to clock in. Staff can still clock in using their pin under another user account where the Time Clock app is visible." },
    { key: "manageTimeCards", label: "Can manage time cards", desc: "View, edit, and delete time cards for all staff members." },
  ] },
  { group: "Payroll", items: [
    { key: "viewPayroll", label: "Can view Payroll app", desc: "Grants access to the Payroll app. Allows viewing of payroll reports and exporting of payroll data." },
    { key: "managePayrollAdjustments", label: "Can manage payroll adjustments", desc: "Grants access to create and delete payroll adjustments." },
  ] },
  { group: "Forms", items: [
    { key: "viewIndividualForms", label: "Can view individual form submissions", desc: "View form submissions attached to appointments that are visible to this person. Does not grant access to the Forms app." },
    { key: "viewAllForms", label: "Can view all form submissions", desc: "Grants access to the Forms app." },
    { key: "manageFormTemplates", label: "Can manage form templates", desc: "Create and modify form templates." },
  ] },
  { group: "Resources", items: [
    { key: "manageResources", label: "Can manage resources", desc: "Create and modify resources and resource groups." },
    { key: "viewResourcesCalendar", label: "Can view resources on calendar", desc: "View resources such as rooms or chairs as separate columns on the calendar." },
  ] },
  { group: "Campaigns", items: [
    { key: "editCampaigns", label: "Can edit campaigns", desc: "Create and modify marketing campaigns." },
    { key: "sendCampaigns", label: "Can send campaigns", desc: "Send marketing campaigns or schedule them for sending." },
  ] },
  { group: "Flows", items: [
    { key: "manageFlows", label: "Can manage flows", desc: "Create and modify flows and flow runs." },
  ] },
  { group: "Offers", items: [
    { key: "manageOffers", label: "Can manage offers", desc: "Create and modify offers." },
  ] },
];
const ALL_PERMISSION_KEYS = PERMISSION_SECTIONS.flatMap((s) => s.items.map((i) => i.key));
const defaultPermissions = (userType) => {
  const on = userType === "Admin";
  const m = {};
  ALL_PERMISSION_KEYS.forEach((k) => { m[k] = on; });
  return m;
};
const countPermsOn = (perms) => ALL_PERMISSION_KEYS.reduce((n, k) => n + ((perms && perms[k]) ? 1 : 0), 0);

const DEFAULT_PROVIDERS = [
  { id: "anyone", name: "Anyone", role: "First available", color: "var(--sub)", hours: DEFAULT_HOURS },
  { id: "dan", name: "Dan", role: "Master Barber", color: "var(--gold)", hours: DEFAULT_HOURS,
    email: "sanctuarybarberco@gmail.com", phone: "+1 503 840 2389", userType: "Admin", isProvider: true, onlineBooking: true, archived: false, photo: "photo-1622286342621-4bd786c2447c",
    notifications: defaultStaffNotifications(), comp: { ...defaultComp(), hourly: { on: true, rate: 0, greaterOf: false } }, permissions: defaultPermissions("Admin"),
    // Pulse 2.0 fields — "owner" can see other barbers + shop totals; "barber" only sees their own chair.
    pulseRole: "owner", dailyGoal: 0, weeklyGoal: 0 },
  { id: "heather", name: "Heather", role: "Stylist", color: "#7A9E9F", hours: { ...DEFAULT_HOURS, 1: { on: false, start: 540, end: 1020 }, 6: { on: true, start: 600, end: 840 } },
    email: "sanctuarybarberco@gmail.com", phone: "+1 503 840 2390", userType: "Admin", isProvider: true, onlineBooking: true, archived: false, photo: "photo-1595959183082-7b570b7e08e2",
    notifications: defaultStaffNotifications(), comp: { ...defaultComp(), service: { on: true, type: "basic", basicPct: 40, tiers: [{ upTo: 500, pct: 30 }, { upTo: null, pct: 40 }] } }, permissions: defaultPermissions("Admin"),
    pulseRole: "barber", dailyGoal: 0, weeklyGoal: 0 },
];
// human-readable summary of which days a provider works
const DAY_ABBR = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const daysSummary = (hours) => {
  const on = [0, 1, 2, 3, 4, 5, 6].filter((d) => hours[d]?.on);
  if (on.length === 0) return "No days set";
  if (on.length === 7) return "Every day";
  return on.map((d) => DAY_ABBR[d]).join(", ");
};

const DEFAULT_SERVICES = [
  {
    id: "cut", name: "Haircut", category: "Services", price: 42, duration: 45, color: "sage", photo: "photo-1503951914875-452162b0f3f1",
    staff: { dan: { on: true, duration: 35, price: null }, heather: { on: true, duration: 45, price: null } },
    cutTypes: [
      { id: "standard", label: "Standard Haircut", desc: "Sides and back have at least SOME hair visible all the way down — even very short stubble or fuzz counts as hair. This is the right pick if you can see hair anywhere on the sides, no matter how short, even faded down close. Includes any taper, low fade, mid fade, or high fade where some hair remains at the bottom edge. The DEFAULT pick unless you can see truly bald scalp.", price: 42, min: 0, images: ["photo-1503951914875-452162b0f3f1", "photo-1622286342621-4bd786c2447c"] },
      { id: "skinfade", label: "Skin Fade", desc: "ONLY pick this if the bottom of the sides/back is shaved COMPLETELY BALD with zero hair — no stubble, no fuzz, just smooth bare scalp like a clean shave. The skin should look the same as a shaved face. If you can see ANY hair stubble or short fuzz at the bottom edge (even very short), it is NOT a skin fade — pick Standard Haircut instead. When in doubt, do not pick this one.", price: 47, min: 5, images: ["photo-1605497788044-5a32c7078486", "photo-1599351431202-1e0f0137899a"] },
      { id: "scissor", label: "Precision Scissor Cut", desc: "Hair is cut with scissors ONLY — no clippers used anywhere. No fading, no tapering, no buzzed sections. The sides have hair of similar length/density to the top, just shaped shorter with scissors. Looks soft and textured throughout, never sharply faded or buzzed.", price: 45, min: 5, images: ["photo-1621607512214-68297480165e", "photo-1503951914875-452162b0f3f1"] },
    ],
    addonGroups: [
      { id: "facial", label: "Want a facial?", type: "addon", photo: "photo-1570172619644-dfd03ed5d881", item: {
        name: "The Gentleman's Facial", price: 30, min: 20,
        desc: "A rejuvenating facial featuring steam, deep cleansing, exfoliation, and hydration, finished with a 24K Gold Collagen mask.",
      }},
    ],
  },
  {
    id: "cutbeard", name: "Haircut + Beard", category: "Services", price: 58, duration: 60, color: "gold", photo: "photo-1621607512214-68297480165e",
    staff: { dan: { on: true, duration: 50, price: null }, heather: { on: true, duration: 60, price: null } },
    cutTypes: [
      { id: "standard", label: "Standard Haircut", desc: "Sides and back have at least SOME hair visible all the way down — even very short stubble or fuzz counts. This is the right pick if you can see hair anywhere on the sides, even faded down close. Includes any taper, low fade, mid fade, or high fade where some hair remains at the bottom edge. The DEFAULT pick unless truly bald scalp is visible. Beard is shaped to match.", price: 58, min: 0, images: ["photo-1503951914875-452162b0f3f1", "photo-1622286342621-4bd786c2447c"] },
      { id: "skinfade", label: "Skin Fade", desc: "ONLY pick this if the bottom of the sides/back is shaved COMPLETELY BALD with zero hair — no stubble, no fuzz, just smooth bare scalp like a clean shave. If you can see ANY hair stubble or short fuzz at the bottom edge, it is NOT a skin fade — pick Standard Haircut instead. When in doubt, do not pick this one. Beard is shaped to match.", price: 63, min: 5, images: ["photo-1605497788044-5a32c7078486", "photo-1599351431202-1e0f0137899a"] },
      { id: "scissor", label: "Precision Scissor Cut", desc: "Hair is cut with scissors ONLY — no clippers used anywhere. No fading, no tapering, no buzzed sections. Sides have similar density to the top, just scissor-shaped shorter. Beard is shaped naturally.", price: 61, min: 5, images: ["photo-1621607512214-68297480165e", "photo-1503951914875-452162b0f3f1"] },
    ],
    addonGroups: [
      { id: "hottowel", label: "Hot Towel / Straight Razor Finish", type: "addon", photo: "photo-1493256338651-d82f7acb2b38", item: {
        name: "Hot Towel & Straight Razor", price: 5, min: 10,
        desc: "A hot towel treatment finished with a straight-razor line-up.",
      }},
    ],
    beardTypes: [
      { id: "standard", label: "Standard beard", desc: "Full or short, kept neat.", min: 0, images: ["photo-1517832606299-7ae9b720a186"] },
      { id: "big", label: "Big beard", desc: "Long, needs shaping — a little more time.", min: 10, images: ["photo-1522556189639-b150ed9c4330"] },
    ],
  },
  { id: "beard", name: "Beard Trim", category: "Services", price: 35, duration: 30, color: "clay", photo: "photo-1517832606299-7ae9b720a186", staff: { dan: { on: true, duration: null, price: null }, heather: { on: true, duration: null, price: null } }, addonGroups: [] },
  { id: "shave", name: "Straight Razor Shave", category: "Services", price: 30, duration: 30, color: "slate", photo: "photo-1596728325488-58c87691e9af", staff: { dan: { on: true, duration: null, price: null }, heather: { on: false, duration: null, price: null } }, addonGroups: [] },
];

const CLIENTS = [
  { id: "c1", name: "Marcus Webb", phone: "503-555-0142", provider: "dan", visits: 14, cadenceDays: 21, lastVisit: (() => { const d = new Date(); d.setDate(d.getDate() - 28); return d.toISOString(); })(), photo: "photo-1500648767791-00dcc994a43e", gallery: [{ id: "g1", photo: "photo-1503951914875-452162b0f3f1", note: "Skin fade #2, scissor top", date: (() => { const d = new Date(); d.setDate(d.getDate() - 28); return d.toISOString(); })() }, { id: "g2", photo: "photo-1605497788044-5a32c7078486", note: "Tighter on the sides this time", date: (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString(); })() }], customDurations: { cut: 35, cutbeard: 50 }, notes: "Skin fade #2 on sides, scissor on top. Black coffee.", messages: [{ from: "client", text: "Running about 5 min late!", time: "11:42 AM" }, { from: "shop", text: "No problem Marcus, see you soon.", time: "11:43 AM" }] },
  { id: "c2", name: "Tariq Allen", phone: "503-555-0188", provider: "dan", visits: 6, cadenceDays: 28, lastVisit: (() => { const d = new Date(); d.setDate(d.getDate() - 10); return d.toISOString(); })(), gallery: [{ id: "g3", photo: "photo-1621607512214-68297480165e", note: "Tight taper + beard line-up", date: (() => { const d = new Date(); d.setDate(d.getDate() - 14); return d.toISOString(); })() }], customDurations: { cut: 45 }, notes: "Tight taper. Prefers minimal small talk.", messages: [] },
  { id: "c3", name: "Jordan Ellis", phone: "503-555-0210", provider: "heather", visits: 3, cadenceDays: 14, lastVisit: (() => { const d = new Date(); d.setDate(d.getDate() - 25); return d.toISOString(); })(), customDurations: {}, notes: "Growing out a textured crop.", messages: [] },
];

// start/end in minutes-from-midnight. vip = flagged, hasPhotos = uploaded refs,
// hasNote = client note, detail = add-on answers shown on the block.
const TODAY_APPTS = [
  // Dan's column
  { id: 1, providerId: "dan", clientId: "c1", serviceId: "cutbeard", start: 540, end: 590, status: "in-service", vip: true, name: "Marcus Webb", title: "Cut & Beard", detail: "Hot Towel & Straight Razor", phone: "503-555-0142", photos: 2, hasPhotos: true, bookedFor: (() => { const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(9, 0, 0, 0); return d.toISOString(); })() },
  { id: 2, providerId: "dan", clientId: "c2", serviceId: "cut", start: 590, end: 625, status: "checked-in", vip: true, name: "Tariq Allen", title: "Haircut", detail: "Standard Cut" },
  { id: 3, providerId: "dan", clientId: "guest", serviceId: "cut", start: 625, end: 670, status: "confirmed", hasPhotos: true, vip: true, name: "Jay Espe", title: "Haircut", detail: "Skinfade" },
  { id: 4, providerId: "dan", clientId: "guest", serviceId: "cut", start: 670, end: 705, status: "confirmed", vip: true, name: "Mark Inada", title: "Haircut", detail: "Standard Cut" },
  { id: 5, providerId: "dan", clientId: "guest", serviceId: "cutbeard", start: 705, end: 745, status: "confirmed", name: "Josh Kegler", title: "Cut & Beard", detail: "Skinfade, Hot Towel" },
  // Heather's column
  { id: 6, providerId: "heather", clientId: "guest", serviceId: "cut", start: 545, end: 590, status: "confirmed", name: "Michael Victory", title: "Haircut", detail: "Standard Cut" },
  { id: 7, providerId: "heather", clientId: "guest", serviceId: "cut", start: 590, end: 630, status: "confirmed", hasNote: true, name: "Justin Heintz", title: "Rebooked Haircut", detail: "Skinfade" },
  { id: 8, providerId: "heather", clientId: "c3", serviceId: "cut", start: 630, end: 705, status: "confirmed", name: "Eric Espinoza", title: "Standard Cut", detail: "No Skinfade" },
  { id: 9, providerId: "heather", clientId: "guest", serviceId: "cutbeard", start: 705, end: 765, status: "confirmed", vip: true, name: "Patrick D.", title: "Skin Fade & Specialty", detail: "Skinfade, Transformation" },
];

const FONT_DISPLAY = "var(--font-disp, 'Fraunces', Georgia, serif)";
const FONT_BODY = "var(--font-body, 'Inter', -apple-system, sans-serif)";

// ============================================================
// THEME GALLERY — 8 dramatically distinct looks. Each is a complete
// palette PLUS its own font pairing (display + body) so themes read
// and feel different, not just recolored.
// ============================================================
const THEMES = [
  // GlossGenius-inspired. Default = airy editorial serif on white (Energy/Zen).
  { id: "snow", name: "Atelier", tagline: "Airy editorial · serif on white", group: "Light", dark: false,
    disp: "'Cormorant Garamond', serif", body: "'Jost', sans-serif",
    t: { bg:"#FCFBF9", panel:"#FFFFFF", panel2:"#F5F3EF", line:"#EDEAE4", border:"#E4E0D8", border2:"#CBC6BB", text:"#211F1B", text2:"#46443E", sub:"#7C766B", faint:"#B0AB9F", gold:"#1F1D19", onGold:"#FFFFFF", shadow:"rgba(20,18,12,.05)", overlay:"rgba(20,18,14,0.28)" } },
  { id: "sagespa", name: "Northside", tagline: "Cream & forest green", group: "Light", dark: false,
    disp: "'Fraunces', serif", body: "'Inter', sans-serif",
    t: { bg:"#F6F1E7", panel:"#FFFDF7", panel2:"#EEE7D6", line:"#E5DCC6", border:"#DBD0B6", border2:"#C2B695", text:"#1E2A20", text2:"#39463B", sub:"#6C7464", faint:"#A6A088", gold:"#1F5138", onGold:"#F8F4EA", shadow:"rgba(60,50,20,.08)", overlay:"rgba(30,42,32,0.34)" } },
  { id: "blossom", name: "Bloom", tagline: "Soft blush & rose", group: "Light", dark: false,
    disp: "'Playfair Display', serif", body: "'Poppins', sans-serif",
    t: { bg:"#FBF3F2", panel:"#FFFAFA", panel2:"#F6E6E4", line:"#F0DAD8", border:"#E8CCC9", border2:"#D6ABA7", text:"#241419", text2:"#46292F", sub:"#8A6B6F", faint:"#C4A6A8", gold:"#B14A63", onGold:"#FFF7F6", shadow:"rgba(120,50,60,.08)", overlay:"rgba(36,20,25,0.34)" } },
  { id: "sunset", name: "Canvas", tagline: "Warm sand & charcoal", group: "Light", dark: false,
    disp: "'Fraunces', serif", body: "'Jost', sans-serif",
    t: { bg:"#F4F1EC", panel:"#FCFAF6", panel2:"#EAE4D9", line:"#E0D8C9", border:"#D5CBB8", border2:"#BBAE96", text:"#222019", text2:"#403B30", sub:"#736C5C", faint:"#ADA48E", gold:"#2B2823", onGold:"#FAF8F3", shadow:"rgba(60,50,30,.07)", overlay:"rgba(34,32,25,0.32)" } },
  { id: "midnight", name: "Onyx", tagline: "Black & warm ivory", group: "Dark", dark: true,
    disp: "'Cormorant Garamond', serif", body: "'Jost', sans-serif",
    t: { bg:"#100F0D", panel:"#1A1916", panel2:"#22201C", line:"#2E2B26", border:"#3A372F", border2:"#524E43", text:"#F4F1E9", text2:"#D4CFC2", sub:"#969080", faint:"#5C5749", gold:"#E8E3D6", onGold:"#100F0D", shadow:"rgba(0,0,0,.55)", overlay:"rgba(0,0,0,0.78)" } },
  { id: "plum", name: "Velvet", tagline: "Aubergine & lilac", group: "Dark", dark: true,
    disp: "'Playfair Display', serif", body: "'Jost', sans-serif",
    t: { bg:"#16101A", panel:"#211826", panel2:"#2B2032", line:"#392B41", border:"#473551", border2:"#62496E", text:"#F1E9F2", text2:"#D4C4D9", sub:"#A48FAA", faint:"#67546D", gold:"#C9A0E0", onGold:"#170F1B", shadow:"rgba(0,0,0,.55)", overlay:"rgba(10,4,14,0.78)" } },
  { id: "steel", name: "Deep Teal", tagline: "Teal & seafoam", group: "Dark", dark: true,
    disp: "'Fraunces', serif", body: "'Inter', sans-serif",
    t: { bg:"#0B1819", panel:"#122324", panel2:"#182E2F", line:"#223C3D", border:"#2D4B4D", border2:"#406A6C", text:"#E6F2F1", text2:"#BFD7D5", sub:"#7C9A98", faint:"#496765", gold:"#5FD0BE", onGold:"#04201C", shadow:"rgba(0,0,0,.5)", overlay:"rgba(4,16,16,0.78)" } },
  { id: "barber", name: "Espresso", tagline: "Mocha & brass", group: "Dark", dark: true,
    disp: "'Oswald', sans-serif", body: "'Jost', sans-serif",
    t: { bg:"#181310", panel:"#221A15", panel2:"#2C221B", line:"#382C23", border:"#45372E", border2:"#5D4B3E", text:"#F3E9DD", text2:"#D6C6B4", sub:"#9C8B78", faint:"#615142", gold:"#CD9551", onGold:"#1A120A", shadow:"rgba(0,0,0,.55)", overlay:"rgba(0,0,0,0.76)" } },
];
const THEME_IDS = THEMES.map((t) => t.id);
const buildThemeCSS = () => THEMES.map((th) => {
  const v = th.t;
  return `.theme-${th.id}{--bg:${v.bg};--panel:${v.panel};--panel2:${v.panel2};--line:${v.line};--border:${v.border};--border2:${v.border2};--text:${v.text};--text2:${v.text2};--sub:${v.sub};--faint:${v.faint};--gold:${v.gold};--on-gold:${v.onGold};--shadow:${v.shadow};--overlay:${v.overlay};--font-disp:${th.disp};--font-body:${th.body};}`;
}).join("\n");

// Portal: render full-screen overlays. Without react-dom we can't truly portal,
// so we render inline but pin to the viewport with position:fixed + max z-index.
// The overlay wrapper itself carries NO transform (so it anchors to the viewport,
// not a transformed ancestor); inner content keeps the drop animation.
function Portal({ children }) {
  return <>{children}</>;
}

// Sheet: a popup that opens centered in the viewport, never off-screen.
function Sheet({ open, onClose, children, align = "top", maxWidth = 520 }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  const justify = align === "bottom" ? "flex-end" : align === "top" ? "flex-start" : "center";
  // The outer flex container fills the screen; the inner box is capped and its body scrolls.
  // Rendered through a portal to document.body so a transformed ancestor (animations) can't
  // trap the position:fixed overlay and cut off scrolling.
  return createPortal((
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "var(--overlay)", zIndex: 2000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: justify, padding: align === "center" ? "20px" : "0", boxSizing: "border-box" }}>
      <div onClick={(e) => e.stopPropagation()} className="appt-drop" style={{
        width: "100%", maxWidth, background: "var(--bg)",
        borderRadius: align === "top" ? "0 0 22px 22px" : (align === "center" ? 22 : "22px 22px 0 0"),
        paddingTop: align === "top" ? "calc(env(safe-area-inset-top) + 16px)" : 20,
        maxHeight: align === "center" ? "85vh" : "92vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)", boxSizing: "border-box", overflow: "hidden",
      }}>
        <div style={{
          overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain",
          padding: "0 20px calc(24px + env(safe-area-inset-bottom))",
          minHeight: 0, flex: 1,
        }}>
          {children}
        </div>
      </div>
    </div>
  ), document.body);
}

// Tap-to-call / Tap-to-text: render a phone number as a subtle button that opens a Sheet with Call + Text options.
// Both buttons use native `tel:` and `sms:` URIs so mobile opens the dialer / Messages directly.
function PhoneLink({ number, style }) {
  const [open, setOpen] = useState(false);
  if (!number) return null;
  const clean = String(number);
  const digits = clean.replace(/\D/g, "");
  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} style={{ background: "none", border: "none", color: "inherit", textDecoration: "underline", textDecorationStyle: "dotted", textDecorationColor: "var(--faint)", textUnderlineOffset: 3, padding: 0, cursor: "pointer", font: "inherit", display: "inline", ...style }}>{clean}</button>
      <Sheet open={open} onClose={() => setOpen(false)} align="bottom" maxWidth={420}>
        <div style={{ padding: "6px 4px 8px" }}>
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--gold)", fontWeight: 600, marginBottom: 6 }}>CONTACT</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500 }}>{clean}</div>
          </div>
          <a href={`tel:${digits}`} onClick={() => setOpen(false)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "var(--gold)", color: "var(--on-gold)", padding: 16, fontSize: 14, fontWeight: 600, letterSpacing: 1.5, borderRadius: 14, textDecoration: "none", marginBottom: 10 }}>
            <Phone size={17} /> CALL
          </a>
          <a href={`sms:${digits}`} onClick={() => setOpen(false)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)", padding: 16, fontSize: 14, fontWeight: 600, letterSpacing: 1.5, borderRadius: 14, textDecoration: "none" }}>
            <MessageSquare size={17} /> TEXT
          </a>
          <button onClick={() => setOpen(false)} style={{ width: "100%", background: "none", border: "none", color: "var(--sub)", fontSize: 14.5, padding: "12px 0 4px", marginTop: 6 }}>Cancel</button>
        </div>
      </Sheet>
    </>
  );
}

// Tap-to-email: simple mailto: anchor. Opens the user's default mail app.
function EmailLink({ email, style }) {
  if (!email) return null;
  return (
    <a href={`mailto:${email}`} onClick={(e) => e.stopPropagation()} style={{ background: "none", border: "none", color: "inherit", textDecoration: "underline", textDecorationStyle: "dotted", textDecorationColor: "var(--faint)", textUnderlineOffset: 3, padding: 0, cursor: "pointer", font: "inherit", display: "inline", ...style }}>{email}</a>
  );
}

const fmtTime = (mins) => { const h = Math.floor(mins / 60), m = mins % 60; const ampm = h >= 12 ? "PM" : "AM"; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`; };
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const relativeDate = (date) => { const today = new Date(); today.setHours(0,0,0,0); const d = new Date(date); d.setHours(0,0,0,0); const diff = Math.round((d - today) / 86400000); if (diff === 0) return "Today"; if (diff === 1) return "Tomorrow"; if (diff > 1 && diff < 7) return DAYS[d.getDay()]; return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const daysFromNow = (date) => { const today = new Date(); today.setHours(0,0,0,0); const d = new Date(date); d.setHours(0,0,0,0); const diff = Math.round((d - today) / 86400000); if (diff === 0) return "Today"; if (diff === 1) return "Tomorrow"; if (diff < 7) return `in ${diff} days`; if (diff === 7) return "1 week away — next " + DAYS[d.getDay()]; if (diff < 14) return `${diff} days away — next week`; const wks = Math.round(diff / 7); return `about ${wks} weeks away`; };
const DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const apptDateLabel = () => { const d = new Date(); return `${DAYS_SHORT[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; };
// Duration cascade: per-client override → per-staff default → service default.
const getStaffEntry = (service, providerId) => (service && service.staff && providerId && service.staff[providerId]) || null;
const getDuration = (client, service, providerId) => {
  if (client && client.customDurations && client.customDurations[service.id]) return client.customDurations[service.id];
  const se = getStaffEntry(service, providerId);
  if (se && se.duration != null) return se.duration;
  return service.duration;
};
// Price cascade: per-staff price → service default. (No per-client price.)
const getPrice = (service, providerId) => {
  const se = getStaffEntry(service, providerId);
  if (se && se.price != null) return se.price;
  return service.price;
};
const inputStyle = { width: "100%", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", color: "var(--text)", fontSize: 15, fontFamily: FONT_BODY };

// ============================================================
export default function App() {
  const [view, setView] = useState("landing");
  const [shopUnlocked, setShopUnlocked] = useState(true);
  const [shopPwPrompt, setShopPwPrompt] = useState(false);
  const [pwEntry, setPwEntry] = useState("");
  const [pwError, setPwError] = useState(false);
  const SHOP_PASSWORD = "avenue2026"; // change this to whatever you want
  // Staff reach the dashboard via a hidden URL: add #staff to the web address.
  // Clients never see anything about staff — the app opens straight into booking.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const h = window.location.hash.toLowerCase();
    if (h === "#staff") {
      // No password until we go live — opens dashboard directly. (Re-enable the prompt before launch.)
      setShopUnlocked(true);
      setView("shop");
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } else if (h === "#terms") {
      setView("terms");
    } else if (h === "#privacy") {
      setView("privacy");
    } else if (h === "#book" || h === "#client") {
      setView("client");
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);
  const goView = (v) => {
    if (v === "shop" && !shopUnlocked) { setPwEntry(""); setPwError(false); setShopPwPrompt(true); return; }
    setView(v);
  };
  const tryUnlock = () => {
    if (pwEntry === SHOP_PASSWORD) { setShopUnlocked(true); setShopPwPrompt(false); setView("shop"); }
    else { setPwError(true); }
  };
  const [clients, setClients] = useState(CLIENTS);
  const [appts, setAppts] = useState(TODAY_APPTS);
  const [waitlist, setWaitlist] = useState([
    { id: "w1", name: "Andre Foster", phone: "503-555-0277", provider: "Dan", day: "This week", when: "midday", service: "Haircut", photos: 0, at: new Date(Date.now() - 3 * 3600e3).toLocaleString() },
    { id: "w2", name: "Sam Rivera", phone: "503-555-0291", provider: "Dan", day: "Any day", when: "midday", service: "Haircut", photos: 0, at: new Date(Date.now() - 1 * 3600e3).toLocaleString() },
  ]);
  const [business, setBusiness] = useState(DEFAULT_BUSINESS);
  const [services, setServices] = useState(DEFAULT_SERVICES);
  const [categories, setCategories] = useState(["Services"]); // ordered list of category names
  const [providers, setProviders] = useState(DEFAULT_PROVIDERS);
  // Theme: stored on business.theme so it syncs across devices via Supabase. Fallback "snow" until loaded/set.
  const theme = business?.theme || "snow";
  const setTheme = (newTheme) => setBusiness((b) => ({ ...(b || {}), theme: newTheme }));

  // ---- Supabase load + save (debounced) — shop-scoped tables (multi-tenant ready) ----
  // Every row is stamped with shop_id so additional shops never collide. For now there's
  // one shop: 'sanctuary'. Lists (clients/appointments/waitlist/providers/services) live
  // as one row per item; settings live on the shops row. Messages are stored inside each
  // client, so saving clients covers messages too.
  // SAFETY DESIGN (added to prevent silent data loss):
  //   1. syncList upserts FIRST, then deletes only rows we no longer have. We never start
  //      by deleting, so a mid-save failure cannot wipe data — it leaves the prior state
  //      on the server and the next save reconciles it.
  //   2. loadedRef stays FALSE if ANY load failed, which blocks all saves until reload.
  //      That prevents the in-memory seed defaults from overwriting real data when a load
  //      hits a transient error.
  //   3. savingRef serializes saves per table — if a save is in flight when another fires,
  //      we just store the latest items and re-run after; older writes can't land on top
  //      of newer ones.
  const SHOP_ID = 'sanctuary';
  const loadedRef = useRef(false); // blocks saves until the first load finishes (so seed data can't overwrite real data)
  const savingRef = useRef({});    // per-table { running, queued } — guarantees in-order saves

  // Save a whole in-memory list to its shop-scoped table.
  // Strategy: upsert current items first (never destroys data), then delete rows that aren't in the list.
  // If anything fails, we log it and bail — existing server data is still intact, and the next save reconciles.
  const syncList = async (table, items) => {
    // Serialize: if a save for this table is already running, remember the latest items and return.
    const slot = savingRef.current[table] || { running: false, queued: null };
    if (slot.running) { slot.queued = items; savingRef.current[table] = slot; return; }
    slot.running = true; slot.queued = null; savingRef.current[table] = slot;
    try {
      const list = items || [];
      const rows = list.map((it, i) => ({ id: String(it.id ?? `${table}_${i}`), shop_id: SHOP_ID, data: it }));
      // 1. Upsert what we currently have — adds new rows, updates existing ones, destroys nothing.
      if (rows.length) {
        const { error: upErr } = await supabase.from(table).upsert(rows);
        if (upErr) throw upErr;
      }
      // 2. Find any server rows we no longer have in memory and delete only those.
      const keepIds = new Set(rows.map((r) => r.id));
      const { data: existing, error: selErr } = await supabase.from(table).select('id').eq('shop_id', SHOP_ID);
      if (selErr) throw selErr;
      const toDelete = (existing || []).filter((r) => !keepIds.has(r.id)).map((r) => r.id);
      if (toDelete.length) {
        const { error: delErr } = await supabase.from(table).delete().eq('shop_id', SHOP_ID).in('id', toDelete);
        if (delErr) throw delErr;
      }
    } catch (err) {
      console.error(`[vero] save '${table}' failed (data on server unchanged):`, err);
    } finally {
      // Drain the queue: if more changes arrived while we were saving, run once more with the latest.
      const next = savingRef.current[table].queued;
      savingRef.current[table].running = false;
      savingRef.current[table].queued = null;
      if (next !== null && next !== undefined) syncList(table, next);
    }
  };

  useEffect(() => {
    (async () => {
      let allLoaded = true; // flipped to false on ANY real error — blocks saves so seeds can't overwrite real data

      // Settings (business) live on the shops row. maybeSingle returns null (not error) when no row exists yet.
      const { data: shopRow, error: shopErr } = await supabase.from('shops').select('settings').eq('id', SHOP_ID).maybeSingle();
      if (shopErr) { allLoaded = false; console.error('[vero] load shops failed:', shopErr); }
      else if (shopRow && shopRow.settings && Object.keys(shopRow.settings).length) setBusiness(shopRow.settings);

      // Load a list table → array of stored item objects. Returns null ONLY on a real DB error (so we can skip and refuse saves).
      const loadList = async (table) => {
        const { data, error } = await supabase.from(table).select('data').eq('shop_id', SHOP_ID);
        if (error) { allLoaded = false; console.error(`[vero] load ${table} failed:`, error); return null; }
        return data ? data.map((r) => r.data) : [];
      };

      // Client data: use whatever's saved, including empty (fresh start = empty lists). Skip only on real error.
      const cl = await loadList('clients');      if (cl !== null) setClients(cl);
      const ap = await loadList('appointments'); if (ap !== null) setAppts(ap);
      const wl = await loadList('waitlist');     if (wl !== null) setWaitlist(wl);
      // Providers & services: keep the in-code defaults if nothing's saved yet (the app needs them to function).
      const pr = await loadList('providers');    if (pr && pr.length) setProviders(pr);
      const sv = await loadList('services');     if (sv && sv.length) setServices(sv);

      // ONLY enable saves if every load succeeded — otherwise the in-memory seed defaults could overwrite real server data.
      if (allLoaded) loadedRef.current = true;
      else console.error('[vero] one or more loads failed — saves are blocked until the next page reload to protect existing data');
    })();
  }, []);

  useEffect(() => { if (!loadedRef.current) return; const t = setTimeout(() => { supabase.from('shops').upsert({ id: SHOP_ID, name: business?.name || 'Sanctuary Barber Co', settings: business }).then(({ error }) => { if (error) console.error('[vero] save shops failed:', error); }); }, 800); return () => clearTimeout(t); }, [business]);
  useEffect(() => { if (!loadedRef.current) return; const t = setTimeout(() => { syncList('clients', clients); }, 800); return () => clearTimeout(t); }, [clients]);
  useEffect(() => { if (!loadedRef.current) return; const t = setTimeout(() => { syncList('appointments', appts); }, 800); return () => clearTimeout(t); }, [appts]);
  useEffect(() => { if (!loadedRef.current) return; const t = setTimeout(() => { syncList('waitlist', waitlist); }, 800); return () => clearTimeout(t); }, [waitlist]);
  useEffect(() => { if (!loadedRef.current) return; const t = setTimeout(() => { syncList('services', services); }, 800); return () => clearTimeout(t); }, [services]);
  useEffect(() => { if (!loadedRef.current) return; const t = setTimeout(() => { syncList('providers', providers); }, 800); return () => clearTimeout(t); }, [providers]);

  return (
    <div id="app-root" className={`theme-${theme}`} style={{ fontFamily: FONT_BODY, minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Jost:wght@300;400;500&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600&family=Inter:wght@400;500;600&family=Playfair+Display:wght@500;600;700&family=Poppins:wght@400;500;600&family=Oswald:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        #app-root { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; line-height: 1.5; letter-spacing: 0.1px; }
        #app-root h1, #app-root h2, #app-root h3 { letter-spacing: -0.2px; }
        #app-root a, #app-root button { color: inherit; }
        a[x-apple-data-detectors], a[href^="tel"] { color: inherit !important; text-decoration: none !important; }
        body, button, input, textarea { font-family: var(--font-body, 'Jost', sans-serif); }
        ${buildThemeCSS()}
        :root {
          --ease: cubic-bezier(.16,.84,.44,1);
          --spring: cubic-bezier(.34,1.56,.64,1);
          --shadow-sm: 0 1px 3px var(--shadow), 0 1px 2px rgba(0,0,0,0.03);
          --shadow-md: 0 6px 20px -6px var(--shadow), 0 2px 8px -3px var(--shadow);
          --shadow-lg: 0 24px 60px -16px var(--shadow), 0 8px 20px -8px var(--shadow);
          --radius: 16px;
        }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(14px);} to {opacity:1; transform:none;} }
        @keyframes screenIn { from { opacity: 0; transform: translateY(10px) scale(0.992);} to {opacity:1; transform:none;} }
        @keyframes pulse { 0% { transform: scale(0.92); opacity: 0.7; } 50% { transform: scale(1.06); opacity: 0.3; } 100% { transform: scale(0.92); opacity: 0.7; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes popIn { 0% { transform: scale(0); } 60% { transform: scale(1.15); } 100% { transform: scale(1); } }
        @keyframes dropDown { from { opacity: 0; transform: translateY(-24px);} to {opacity:1; transform:none;} }
        .appt-drop { animation: dropDown .32s var(--ease) both; }
        @keyframes fadeIn { from { opacity: 0;} to {opacity:1;} }
        @keyframes slideInRight { from { opacity:0; transform: translateX(28px);} to {opacity:1; transform:none;} }
        /* Screen container eases in as a whole (move-through-space feel) */
        .fade-up { animation: screenIn .42s var(--ease) both; }
        .fade-in { animation: fadeIn .4s var(--ease) both; }
        /* Keyed screen swaps: deliberately OBVIOUS so motion is easy to confirm.
           Once verified working, the distance (28px) and duration can be dialed back to taste. */
        @keyframes screenSwap { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: none; } }
        .screen-swap { animation: screenSwap .52s var(--spring) both; }
        /* Direct children cascade in with a gentle stagger + spring */
        .fade-up > * { animation: fadeUp .5s var(--spring) both; }
        .screen-swap > * > * { animation: fadeUp .55s var(--spring) both; }
        .fade-up > *:nth-child(1){animation-delay:.02s} .fade-up > *:nth-child(2){animation-delay:.06s}
        .fade-up > *:nth-child(3){animation-delay:.10s} .fade-up > *:nth-child(4){animation-delay:.14s}
        .fade-up > *:nth-child(5){animation-delay:.18s} .fade-up > *:nth-child(6){animation-delay:.22s}
        .fade-up > *:nth-child(7){animation-delay:.26s} .fade-up > *:nth-child(8){animation-delay:.30s}
        .screen-swap > * > *:nth-child(1){animation-delay:.06s} .screen-swap > * > *:nth-child(2){animation-delay:.12s}
        .screen-swap > * > *:nth-child(3){animation-delay:.18s} .screen-swap > * > *:nth-child(4){animation-delay:.24s}
        .screen-swap > * > *:nth-child(5){animation-delay:.30s} .screen-swap > * > *:nth-child(6){animation-delay:.36s}
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
        /* Stop iOS Safari from rubber-band overscrolling past the top/bottom of the page,
           which was dragging the fixed bottom tab bar halfway up the viewport.
           overscroll-behavior:contain stops scroll chaining; -webkit-overflow-scrolling:auto
           turns off the elastic touch-scroll on iOS that was the visible glitch. */
        html { overscroll-behavior: none; }
        html, body { overscroll-behavior-y: contain; -webkit-overflow-scrolling: auto; }
        body { position: relative; min-height: 100dvh; }
        .appt-screen { animation: slideInRight .3s var(--ease) both; }
        @keyframes fadeInFixed { from { opacity:0; } to { opacity:1; } }
        .appt-screen-fixed { animation: fadeInFixed .25s var(--ease) both; }
        /* Success bloom — used on the "You're in" check circle */
        @keyframes successBloom { 0% { transform: scale(0.4); opacity: 0; } 60% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
        .success-bloom { animation: successBloom .65s var(--spring) both; }
        /* Soft gold pulse — used on selected/active items to confirm */
        @keyframes goldPulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--gold) 50%, transparent); } 100% { box-shadow: 0 0 0 12px color-mix(in srgb, var(--gold) 0%, transparent); } }
        .gold-pulse { animation: goldPulse .8s var(--ease) both; }
        /* Subtle drift-in — for the confirmation card */
        @keyframes driftIn { from { opacity: 0; transform: translateY(14px) scale(0.98); } to { opacity: 1; transform: none; } }
        .drift-in { animation: driftIn .55s var(--spring) both; animation-delay: .15s; }
        .scrub-lock, .scrub-lock * { touch-action: none !important; overflow: hidden !important; overscroll-behavior: none !important; -webkit-user-select: none !important; user-select: none !important; }
        button { font-family: ${FONT_BODY}; cursor: pointer; border: none; transition: transform .18s var(--ease), box-shadow .25s var(--ease), background .2s var(--ease), border-color .2s var(--ease), opacity .2s var(--ease); }
        button:active { transform: scale(0.96); }
        input, textarea, select { outline: none; font-family: ${FONT_BODY}; transition: border-color .2s var(--ease), box-shadow .2s var(--ease); }
        input:focus, textarea:focus, select:focus { border-color: var(--gold) !important; box-shadow: 0 0 0 3px color-mix(in srgb, var(--gold) 18%, transparent); }
        .lift { transition: transform .25s var(--spring), box-shadow .25s var(--ease), border-color .2s var(--ease), background .2s var(--ease); }
        .lift-row { transition: background .15s var(--ease), padding-left .15s var(--ease); }
        .lift-row:active { background: color-mix(in srgb, var(--gold) 7%, transparent); padding-left: 12px; }
        .lift:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
        .lift:active { transform: scale(0.96); box-shadow: 0 1px 4px rgba(0,0,0,0.15); }
        .card { box-shadow: var(--shadow-sm); }
        ::-webkit-scrollbar { width: 8px; height: 8px; } ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 8px; } ::-webkit-scrollbar-track { background: transparent; }
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>

      {view === "landing" && <Landing business={business} onPick={goView} />}

      {shopPwPrompt && (
        <div onClick={() => { setShopPwPrompt(false); setPwEntry(""); setPwError(false); }} style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 360, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 18, padding: 26, boxShadow: "0 24px 60px rgba(0,0,0,0.4)" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 500, marginBottom: 6 }}>Staff access</div>
            <p style={{ color: "var(--sub)", fontSize: 14, marginBottom: 18, fontWeight: 300, lineHeight: 1.5 }}>Enter the shop password to open the dashboard.</p>
            <input autoFocus type="password" value={pwEntry} onChange={(e) => { setPwEntry(e.target.value); setPwError(false); }} onKeyDown={(e) => { if (e.key === "Enter") tryUnlock(); }} placeholder="Password" style={{ width: "100%", boxSizing: "border-box", background: "var(--panel2)", border: `1px solid ${pwError ? "#c0392b" : "var(--border)"}`, borderRadius: 12, padding: "14px 16px", color: "var(--text)", fontSize: 16, fontFamily: FONT_BODY, marginBottom: pwError ? 8 : 16 }} />
            {pwError && <p style={{ color: "#c0392b", fontSize: 13.5, marginBottom: 14 }}>Wrong password — try again.</p>}
            <button className="lift" onClick={tryUnlock} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 15, fontSize: 14, letterSpacing: 1.5, fontWeight: 600, borderRadius: 12, border: "none", marginBottom: 10 }}>UNLOCK</button>
            <button onClick={() => { setShopPwPrompt(false); setPwEntry(""); setPwError(false); }} style={{ width: "100%", background: "none", border: "none", color: "var(--sub)", fontSize: 14, padding: 6 }}>Cancel</button>
          </div>
        </div>
      )}
      {view === "terms" && <TermsPage onExit={() => { setView("client"); if (typeof window !== "undefined") window.history.replaceState(null, "", window.location.pathname + window.location.search); }} />}
      {view === "privacy" && <PrivacyPage onExit={() => { setView("client"); if (typeof window !== "undefined") window.history.replaceState(null, "", window.location.pathname + window.location.search); }} />}
      {view === "client" && <ClientFlow business={business} services={services} providers={providers} clients={clients} setClients={setClients} appts={appts} setAppts={setAppts} waitlist={waitlist} setWaitlist={setWaitlist} onExit={() => setView("landing")} />}
      {view === "manage" && <ManageStandalone business={business} appts={appts} setAppts={setAppts} providers={providers} services={services} onExit={() => setView("landing")} />}
      {view === "shop" && <ShopDashboard business={business} setBusiness={setBusiness} services={services} setServices={setServices} categories={categories} setCategories={setCategories} providers={providers} setProviders={setProviders} clients={clients} setClients={setClients} appts={appts} setAppts={setAppts} waitlist={waitlist} setWaitlist={setWaitlist} theme={theme} setTheme={setTheme} onExit={() => { setView("landing"); }} />}
    </div>
  );
}

function PrivacyPage({ onExit }) {
  const updated = "May 2026";
  const H = ({ children }) => <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500, margin: "26px 0 10px" }}>{children}</h2>;
  const P = ({ children }) => <p style={{ fontSize: 15.5, color: "var(--text2)", lineHeight: 1.65, marginBottom: 12 }}>{children}</p>;
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: FONT_BODY }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 22px 80px" }}>
        <button onClick={onExit} style={{ background: "none", color: "var(--sub)", display: "flex", alignItems: "center", gap: 6, fontSize: 15, marginBottom: 24 }}><ArrowLeft size={16} /> Back</button>
        <div style={{ fontSize: 12.5, letterSpacing: 2, color: "var(--gold)", fontWeight: 600, marginBottom: 10 }}>SANCTUARY BARBER CO</div>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 500, lineHeight: 1.1, marginBottom: 8 }}>Privacy Policy</h1>
        <p style={{ fontSize: 14, color: "var(--sub)", marginBottom: 8 }}>Last updated: {updated}</p>

        <P>This policy explains what information Sanctuary Barber Co ("we," "us," "our") collects when you book an appointment with us, and how we use and protect it.</P>

        <H>What we collect</H>
        <P>When you book an appointment, we collect your name, mobile phone number, email address (optional), and any preferences, notes, or photos you choose to share. We also keep a record of your visit history with us.</P>

        <H>How we use it</H>
        <P>We use your information solely to provide our services:</P>
        <ul style={{ fontSize: 15.5, color: "var(--text2)", lineHeight: 1.65, marginBottom: 12, paddingLeft: 22 }}>
          <li style={{ marginBottom: 6 }}>To schedule, confirm, and manage your appointments</li>
          <li style={{ marginBottom: 6 }}>To send appointment confirmations, reminders, and scheduling updates by text message and email</li>
          <li style={{ marginBottom: 6 }}>To remember your preferences and visit history so we can serve you better next time</li>
          <li style={{ marginBottom: 6 }}>To send one-time verification codes when you log in</li>
        </ul>

        <H>Text messages (SMS)</H>
        <P>If you provide your phone number, you may receive text messages from Sanctuary Barber Co related to your appointments — including booking confirmations, reminders, scheduling updates, and one-time login verification codes. Message and data rates may apply. Message frequency varies based on your appointment activity.</P>
        <P>You can opt out of text messages at any time by replying STOP. For help, reply HELP. We do not sell or share your phone number with third parties for marketing purposes. Mobile information will not be shared with third parties for marketing or promotional purposes.</P>

        <H>Who can see your information</H>
        <P>Your information is visible to Sanctuary Barber Co staff who need it to serve you. We use trusted service providers (such as our hosting platform, database, and SMS provider) to operate the booking app — they handle data only as needed to provide their services to us and are bound by confidentiality.</P>
        <P>We do not sell your personal information to anyone.</P>

        <H>How long we keep it</H>
        <P>We keep your information for as long as you are an active client, and for a reasonable period after to handle returning visits or required record-keeping. You may request deletion at any time.</P>

        <H>Your choices</H>
        <P>You may request access to, correction of, or deletion of your personal information by contacting us at the email below. You can opt out of text messages at any time by replying STOP.</P>

        <H>Children</H>
        <P>Our booking service is for adults. If a parent or guardian books on behalf of a minor (e.g. a child's haircut), the parent or guardian is responsible for providing the contact information.</P>

        <H>Changes</H>
        <P>We may update this policy from time to time. The "last updated" date at the top of this page tells you when it was most recently changed.</P>

        <H>Contact</H>
        <P>Questions, requests, or concerns about your information? Reach us at sanctuarybarberco@gmail.com.</P>
      </div>
    </div>
  );
}

function TermsPage({ onExit }) {
  const updated = "May 2026";
  const H = ({ children }) => <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500, margin: "26px 0 10px" }}>{children}</h2>;
  const P = ({ children }) => <p style={{ fontSize: 15.5, color: "var(--text2)", lineHeight: 1.65, marginBottom: 12 }}>{children}</p>;
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: FONT_BODY }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 22px 80px" }}>
        <button onClick={onExit} style={{ background: "none", color: "var(--sub)", display: "flex", alignItems: "center", gap: 6, fontSize: 15, marginBottom: 24 }}><ArrowLeft size={16} /> Back</button>
        <div style={{ fontSize: 12.5, letterSpacing: 2, color: "var(--gold)", fontWeight: 600, marginBottom: 10 }}>SANCTUARY BARBER CO</div>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 500, lineHeight: 1.1, marginBottom: 8 }}>Terms &amp; Conditions</h1>
        <p style={{ fontSize: 14, color: "var(--sub)", marginBottom: 8 }}>Last updated: {updated}</p>

        <P>These terms govern your use of the booking and messaging services provided by Sanctuary Barber Co ("we," "us," "our"). By booking an appointment or providing your phone number, you agree to these terms.</P>

        <H>Booking &amp; Appointments</H>
        <P>When you book an appointment, you agree to provide accurate contact information. Appointments are subject to availability. We may contact you to confirm, remind, or update you about your appointment.</P>

        <H>SMS / Text Messaging</H>
        <P>By providing your mobile phone number, you consent to receive text messages from Sanctuary Barber Co related to your appointments — including booking confirmations, reminders, schedule changes, waitlist openings, and one-time login verification codes.</P>
        <P>Message frequency varies based on your activity. Message and data rates may apply. You can opt out of non-essential texts at any time by replying STOP. For help, reply HELP. Opting out of verification codes may prevent you from logging in.</P>
        <P>We do not sell or share your phone number with third parties for marketing. Your number is used only to provide and improve our services.</P>

        <H>Cancellations &amp; No-Shows</H>
        <P>We ask that you give reasonable notice if you need to cancel or reschedule. Repeated no-shows may affect your ability to book online.</P>

        <H>Privacy</H>
        <P>We collect only the information needed to provide our services — your name, contact details, appointment history, and any preferences or photos you choose to share. This information is stored securely and used only to serve you. We do not sell your personal information.</P>

        <H>Changes</H>
        <P>We may update these terms from time to time. Continued use of our booking and messaging services means you accept any changes.</P>

        <H>Contact</H>
        <P>Questions about these terms? Reach us at sanctuarybarberco@gmail.com.</P>
      </div>
    </div>
  );
}

function Landing({ business, onPick }) {
  const tiles = [
    { key: "client", label: "Book an appointment", desc: "The client booking experience", primary: true },
    { key: "manage", label: "Manage my appointment", desc: "Reschedule, cancel, or check in" },
    { key: "shop", label: "Business dashboard", desc: "Calendar, clients, menu & settings" },
  ];
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 22px", background: "var(--bg)", color: "var(--text)", fontFamily: FONT_BODY }}>
      <div className="fade-up" style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: "clamp(40px, 13vw, 60px)", fontWeight: 500, lineHeight: 1, letterSpacing: 1 }}>{business.name}</h1>
          <div style={{ width: 34, height: 1, background: "var(--gold)", margin: "18px auto 0", opacity: 0.5 }} />
        </div>
        <div style={{ display: "grid", gap: 13 }}>
          {tiles.map((t) => (
            <button key={t.key} className="lift" onClick={() => onPick(t.key)} style={{ width: "100%", textAlign: "left", background: t.primary ? "var(--gold)" : "var(--panel)", color: t.primary ? "var(--on-gold)" : "var(--text)", border: t.primary ? "none" : "1px solid var(--border)", borderRadius: 18, padding: "22px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, boxShadow: t.primary ? "var(--shadow-md)" : "var(--shadow-sm)" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500, lineHeight: 1.1 }}>{t.label}</span>
                <span style={{ fontSize: 14, opacity: t.primary ? 0.85 : 1, color: t.primary ? "inherit" : "var(--sub)", fontWeight: 300 }}>{t.desc}</span>
              </span>
              <ChevronRight size={22} style={{ flexShrink: 0, opacity: 0.7 }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PHOTO PICKER MODAL — library + "upload your own"
// ============================================================
function PhotoPicker({ onClose, onPick }) {
  const [cat, setCat] = useState("Haircuts");
  const [tab, setTab] = useState("library");
  return (
    <Sheet open={true} onClose={onClose} maxWidth={560}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24 }}>Choose a photo</div>
          <button onClick={onClose} style={{ background: "none", color: "var(--sub)" }}><X size={22} /></button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <button onClick={() => setTab("library")} style={{ flex: 1, padding: 12, borderRadius: 12, background: tab === "library" ? "var(--gold)" : "var(--panel2)", color: tab === "library" ? "var(--on-gold)" : "var(--text)", fontSize: 15, letterSpacing: 1 }}>FROM LIBRARY</button>
          <button onClick={() => setTab("upload")} style={{ flex: 1, padding: 12, borderRadius: 12, background: tab === "upload" ? "var(--gold)" : "var(--panel2)", color: tab === "upload" ? "var(--on-gold)" : "var(--text)", fontSize: 15, letterSpacing: 1 }}>UPLOAD YOUR OWN</button>
        </div>

        {tab === "library" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {Object.keys(PHOTO_LIBRARY).map((c) => (
                <button key={c} onClick={() => setCat(c)} style={{ padding: "7px 14px", borderRadius: 20, fontSize: 15, background: cat === c ? "var(--border)" : "transparent", color: cat === c ? "var(--text)" : "var(--sub)", border: "1px solid var(--border)" }}>{c}</button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
              {PHOTO_LIBRARY[cat].map((id) => (
                <button key={id} className="lift" onClick={() => { onPick(id); onClose(); }} style={{ padding: 0, borderRadius: 14, overflow: "hidden", border: "1px solid var(--border)", aspectRatio: "4/3", background: "var(--panel2)" }}>
                  <img src={imgUrl(id)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </button>
              ))}
            </div>
            <p style={{ color: "var(--faint)", fontSize: 14, marginTop: 16, lineHeight: 1.5 }}>In the live product this is a searchable feed of free professional photos. Here it's a curated sample set.</p>
          </>
        )}
        {tab === "upload" && (
          <div style={{ textAlign: "center", padding: "30px 0" }}>
            <div style={{ border: "1px dashed var(--border2)", borderRadius: 8, padding: 40, marginBottom: 16 }}>
              <Upload size={32} style={{ color: "var(--faint)", marginBottom: 12 }} />
              <div style={{ fontSize: 15, marginBottom: 6 }}>Upload your own photo</div>
              <p style={{ color: "var(--sub)", fontSize: 15, fontWeight: 300 }}>Your photos always take priority over the library.</p>
            </div>
            <button className="lift" onClick={() => { onPick(ALL_LIBRARY[Math.floor(Math.random() * ALL_LIBRARY.length)].id); onClose(); }} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 14, fontSize: 15, letterSpacing: 1, fontWeight: 500, borderRadius: 10 }}>CHOOSE FILE (SIMULATED)</button>
            <p style={{ color: "var(--faint)", fontSize: 14, marginTop: 14, lineHeight: 1.5 }}>Real uploads work in the live product. Here we'll drop in a sample so you can see the result.</p>
          </div>
        )}
      </Sheet>
  );
}

// Profile-picture picker for staff members: portrait grid + simulated upload.
function StaffPhotoPicker({ onClose, onPick, onRemove, hasPhoto }) {
  const [tab, setTab] = useState("library");
  return (
    <Sheet open={true} onClose={onClose} maxWidth={560}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24 }}>Profile picture</div>
        <button onClick={onClose} style={{ background: "none", color: "var(--sub)" }}><X size={22} /></button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <button onClick={() => setTab("library")} style={{ flex: 1, padding: 12, borderRadius: 12, background: tab === "library" ? "var(--gold)" : "var(--panel2)", color: tab === "library" ? "var(--on-gold)" : "var(--text)", fontSize: 15, letterSpacing: 1 }}>FROM LIBRARY</button>
        <button onClick={() => setTab("upload")} style={{ flex: 1, padding: 12, borderRadius: 12, background: tab === "upload" ? "var(--gold)" : "var(--panel2)", color: tab === "upload" ? "var(--on-gold)" : "var(--text)", fontSize: 15, letterSpacing: 1 }}>UPLOAD YOUR OWN</button>
      </div>

      {tab === "library" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {STAFF_PORTRAITS.map((id) => (
              <button key={id} className="lift" onClick={() => { onPick(id); onClose(); }} style={{ padding: 0, borderRadius: "50%", overflow: "hidden", border: "1px solid var(--border)", aspectRatio: "1", background: "var(--panel2)" }}>
                <img src={imgUrl(id, 240)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              </button>
            ))}
          </div>
          <p style={{ color: "var(--faint)", fontSize: 14, marginTop: 16, lineHeight: 1.5 }}>In the live product this is where you'd upload a real headshot. Here it's a curated sample set.</p>
        </>
      )}
      {tab === "upload" && (
        <div style={{ textAlign: "center", padding: "30px 0" }}>
          <div style={{ border: "1px dashed var(--border2)", borderRadius: 8, padding: 40, marginBottom: 16 }}>
            <Upload size={32} style={{ color: "var(--faint)", marginBottom: 12 }} />
            <div style={{ fontSize: 15, marginBottom: 6 }}>Upload a profile picture</div>
            <p style={{ color: "var(--sub)", fontSize: 15, fontWeight: 300 }}>A clear, front-facing headshot works best.</p>
          </div>
          <button className="lift" onClick={() => { onPick(STAFF_PORTRAITS[Math.floor(Math.random() * STAFF_PORTRAITS.length)]); onClose(); }} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 14, fontSize: 15, letterSpacing: 1, fontWeight: 500, borderRadius: 10 }}>CHOOSE FILE (SIMULATED)</button>
          <p style={{ color: "var(--faint)", fontSize: 14, marginTop: 14, lineHeight: 1.5 }}>Real uploads work in the live product. Here we'll drop in a sample so you can see the result.</p>
        </div>
      )}
      {hasPhoto && (
        <button onClick={() => { onRemove(); onClose(); }} style={{ width: "100%", marginTop: 14, background: "transparent", border: "1px solid var(--border)", color: "var(--sub)", padding: 12, fontSize: 14, letterSpacing: 1, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><RefreshCw size={16} /> RESET TO DEFAULT</button>
      )}
    </Sheet>
  );
}

// ============================================================
// CLIENT BOOKING FLOW
// ============================================================
function ClientFlow({ business, services, providers, clients, setClients, appts, setAppts, waitlist, setWaitlist, onExit }) {
  const [step, setStep] = useState(0);
  const [bookingFor, setBookingFor] = useState(null); // null until chosen: "self" or "other"
  const [showWhoFor, setShowWhoFor] = useState(false); // who's-it-for screen for a matched returning client
  const [showUsual, setShowUsual] = useState(false); // book-my-usual one-tap screen
  const [activeMember, setActiveMember] = useState(null); // family member being booked for (their record)
  const [addingMember, setAddingMember] = useState(false); // showing the add-new-person form
  // ---- Guided multi-person wizard ----
  const [groupPeople, setGroupPeople] = useState([]);   // [{ id|null, name, isMember }] people being booked for
  const [groupMode, setGroupMode] = useState(null);     // "together" | "separate"
  const [wizardIdx, setWizardIdx] = useState(0);         // which person we're choosing a service for
  const [showSchedChoice, setShowSchedChoice] = useState(false); // the together/separate screen
  const [showWizardIntro, setShowWizardIntro] = useState(false); // "Let's start with X" screen
  const [expandUsual, setExpandUsual] = useState(false); // expand the usual card to show details
  const [cameFromUsual, setCameFromUsual] = useState(false); // true when step 6/7 was reached via the welcome-back front door (so Back returns there)
  const [newClientCategory, setNewClientCategory] = useState(null); // "hair" | "hairBeard" | "beard" — chosen on the editorial category screen

  // ---- Guided consultation (auto-launches for brand-new clients) ----
  const [consult, setConsult] = useState(null); // null = off; otherwise { step, sides, bottom, condition } answers
  const [consultResult, setConsultResult] = useState(null); // resolved cut type id once finished
  const [cutHelperOpen, setCutHelperOpen] = useState(null); // "photo" | "notSure" | null — opens the helper sheet on Pick Your Cut
  const [helperPhotoUrl, setHelperPhotoUrl] = useState(null); // data URL of uploaded photo (held for later attaching to booking)
  const helperPhotoInputRef = useRef(null);
  const [notSureText, setNotSureText] = useState("");
  const [notSureLoading, setNotSureLoading] = useState(false);
  const [notSureResult, setNotSureResult] = useState(null); // { matchId, matchLabel, reason } | null
  const [notSureError, setNotSureError] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoResult, setPhotoResult] = useState(null); // { matchId, matchLabel, reason } | null
  const [photoError, setPhotoError] = useState(null);
  const [bookingPhoto, setBookingPhoto] = useState(null); // { dataUrl, mediaType } — attaches to the appointment
  // ---- SMS login verification (wired to Twilio/Supabase when approved; accepts any 6-digit code for now) ----
  const [showCodeEntry, setShowCodeEntry] = useState(false);
  const [codeEntry, setCodeEntry] = useState("");
  const [codeError, setCodeError] = useState(false);
  const [pendingMatch, setPendingMatch] = useState(null); // the client we found, awaiting code verify
  const [blockedNotice, setBlockedNotice] = useState(false); // shown when a blocked client tries to book
  const [clientTypeBlock, setClientTypeBlock] = useState(null); // "returning_only" | "new_only" | null — set when shop's online booking is restricted to one type and this client is the other
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberNote, setNewMemberNote] = useState("");
  const [cart, setCart] = useState([]);
  const [intakeFor, setIntakeFor] = useState(null); // service object when running first-time intake
  const [draft, setDraft] = useState(null);
  const [draftAddons, setDraftAddons] = useState({});
  const [cutType, setCutType] = useState(null); // chosen cut-type id (for services with cutTypes)
  const [beardType, setBeardType] = useState(null); // chosen beard-type id (for services with beardTypes)
  const [cutPhase, setCutPhase] = useState("type"); // within step 2: "type" -> "beard" -> "addons"
  const [cutCarousel, setCutCarousel] = useState({}); // per-cut-type image index
  const [phone, setPhone] = useState("");
  const [newFirst, setNewFirst] = useState("");  // first-timer first name collected at the end
  const [newLast, setNewLast] = useState("");    // first-timer last name collected at the end
  const [newEmail, setNewEmail] = useState(""); // first-timer email collected at the end (optional)
  // Derived full name — keeps older call sites that read `newName` working without rewrites.
  const newName = `${newFirst.trim()} ${newLast.trim()}`.trim();
  const [matched, setMatched] = useState(null);
  useEffect(() => {
    if (!matched) return;
    // Prefer the stored firstName/lastName if present; otherwise split the legacy `name` field on whitespace.
    if (matched.firstName || matched.lastName) {
      setNewFirst(matched.firstName || "");
      setNewLast(matched.lastName || "");
    } else if (matched.name) {
      const parts = matched.name.trim().split(/\s+/);
      setNewFirst(parts[0] || "");
      setNewLast(parts.slice(1).join(" "));
    }
    setNewEmail(matched.email || "");
    if (matched.phone) setPhone(matched.phone);
  }, [matched]);
  // Returning-client contact-info conflict — when matched and the user changes phone or email,
  // open a confirmation sheet asking which to keep on file. Defaults to the just-typed value.
  const [contactConfirm, setContactConfirm] = useState(null); // null or { phone: bool, email: bool } — which fields differ
  const [keepPhone, setKeepPhone] = useState("new"); // "file" | "new"
  const [keepEmail, setKeepEmail] = useState("new"); // "file" | "new"
  const [selectedDate, setSelectedDate] = useState(null);
  const [slot, setSlot] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [waitlistDone, setWaitlistDone] = useState(false);
  const [photos, setPhotos] = useState(0);       // 0–3 uploaded at booking
  const [bookedId, setBookedId] = useState(null); // id of the appointment just created
  // waitlist join form
  const [wlName, setWlName] = useState("");
  const [wlDay, setWlDay] = useState("");          // preferred day label
  const [wlWhen, setWlWhen] = useState("");         // early | midday | afternoon
  const [wlPhotos, setWlPhotos] = useState(0);
  const [wlAnyProvider, setWlAnyProvider] = useState(false); // false = only their provider (the respectful default)
  const [wlService, setWlService] = useState("");

  const lineTotal = (entry) => {
    const dc = activeMember || matched; // duration/notes come from the person being booked for
    let p = entry.service.price, m = getDuration(dc, entry.service);
    // cut type overrides the base price/time when present
    if (entry.service.cutTypes && entry.cutType) {
      const ct = entry.service.cutTypes.find((c) => c.id === entry.cutType);
      if (ct) { p = ct.price; m = getDuration(dc, entry.service) + (ct.min || 0); }
    }
    if (entry.service.beardTypes && entry.beardType) {
      const bt = entry.service.beardTypes.find((b) => b.id === entry.beardType);
      if (bt) { m += (bt.min || 0); }
    }
    entry.service.addonGroups.forEach((g) => {
      const sel = entry.addons[g.id];
      if (g.type === "choice" && sel) { const opt = g.options.find((o) => o.id === sel); if (opt) { p += opt.price; m += opt.min; } }
      if (g.type === "addon" && sel) { p += g.item.price; m += g.item.min; }
    });
    return { price: p, min: m };
  };
  const cartPrice = cart.reduce((s, e) => s + lineTotal(e).price, 0);
  const cartMin = cart.reduce((s, e) => s + lineTotal(e).min, 0);
  const describeEntry = (entry) => {
    // First-time intake answers (if present) read as the meaningful description
    if (entry.intakeAnswers && entry.service.intake) {
      const ik = entry.service.intake; const a = entry.intakeAnswers; const parts = [];
      if (ik.service && a.service) parts.push(ik.service.options.find((o) => o.id === a.service)?.label);
      if (ik.style && a.style) parts.push(ik.style.options.find((o) => o.id === a.style)?.label);
      const clean = parts.filter(Boolean);
      return clean.length ? `First visit — ${clean.join(", ")}` : entry.service.name;
    }
    const picks = [];
    if (entry.service.cutTypes && entry.cutType) { const ct = entry.service.cutTypes.find((c) => c.id === entry.cutType); if (ct) picks.push(ct.label); }
    if (entry.service.beardTypes && entry.beardType) { const bt = entry.service.beardTypes.find((b) => b.id === entry.beardType); if (bt) picks.push(bt.label); }
    entry.service.addonGroups.forEach((g) => {
      const sel = entry.addons[g.id];
      if (g.type === "choice" && sel) picks.push(g.options.find((o) => o.id === sel)?.label);
      if (g.type === "addon" && sel) picks.push(g.item.name);
    });
    return picks.length ? `${entry.service.name} (${picks.join(", ")})` : entry.service.name;
  };
  const provider = cart[0]?.provider || providers[0];

  // ---------- REAL AVAILABILITY ENGINE ----------
  // For a barber on a given date, return free start-times that fit `durMin`,
  // based on their working hours minus appointments already booked that day.
  const dayKey = (d) => d.toDateString();
  const apptsOnDate = (provId, d) => (appts || []).filter((a) => {
    if (a.status === "cancelled") return false;
    if (a.providerId !== provId) return false;
    const ad = a.bookedFor ? new Date(a.bookedFor) : null;
    return ad && dayKey(ad) === dayKey(d);
  }).map((a) => { const s = a.start; const dur = (a.end != null ? a.end - a.start : 30); return [s, s + (dur > 0 ? dur : 30)]; });

  const freeSlotsFor = (prov, d, durMin) => {
    if (!prov || prov.id === "anyone") prov = providers.find((p) => p.id === "dan") || providers[1];
    const dow = d.getDay();
    const h = prov.hours?.[dow];
    if (!h || !h.on) return [];
    const busy = apptsOnDate(prov.id, d).slice().sort((a, b) => a[0] - b[0]); // [[start,end], ...] sorted
    const isToday = d.toDateString() === new Date().toDateString();
    const bk = business?.booking || {};
    const leadMin = bk.leadTimeMin || 0;
    const earliest = isToday ? (new Date().getHours() * 60 + new Date().getMinutes() + leadMin) : 0;

    // Buffers: padding held open around each appointment (setup before / cleanup after).
    const bufBefore = Math.max(0, Number(bk.bufferBefore) || 0);
    const bufAfter = Math.max(0, Number(bk.bufferAfter) || 0);

    const packTheDay = bk.avoidGaps !== false; // default ON
    // Per-barber: allow ending after closing time (up to N minutes), only if it fits flush
    const overrunMin = Math.max(0, Number(prov.overrunMin) || 0);
    const dayEnd = h.end + overrunMin;

    // Helper: a time t with duration durMin doesn't clash with any existing busy (accounting for buffers around the busy block).
    const noClash = (t) => !busy.some(([bs, be]) => t < (be + bufAfter) && (t + durMin) > (bs - bufBefore));

    let candidates = new Set();

    if (!packTheDay) {
      // Loose: every 15-min increment from start to end of day
      for (let t = h.start; t + durMin <= dayEnd; t += 15) candidates.add(t);
    } else {
      // Pack-the-day mode. Build a list of open runs (continuous blocks between busy appts).
      const runs = []; // each: [runStart, runEnd]
      let cursor = h.start;
      busy.forEach(([bs, be]) => {
        if (cursor < bs) runs.push([cursor, bs]);
        cursor = Math.max(cursor, be);
      });
      if (cursor < dayEnd) runs.push([cursor, dayEnd]);

      runs.forEach(([rs, re]) => {
        const runLen = re - rs;
        if (runLen < durMin) return; // service doesn't fit at all
        // Always anchor the first slot at the start of the run (flush with whatever came before)
        candidates.add(rs);
        // If this run sits at the end of the day, also offer the last possible slot
        // (so the day fills from both ends on empty days)
        const lastFit = re - durMin;
        if (lastFit > rs && Math.abs(re - dayEnd) < 1) {
          candidates.add(lastFit);
        }
        // Smart middle anchor: only if the open run is at least 3× the service length.
        // Snap to the nearest 30-min mark so the time looks clean (e.g. 1:00, 1:30, not 1:13).
        if (runLen >= durMin * 3) {
          let mid = rs + Math.floor(runLen / 2);
          mid = Math.round(mid / 30) * 30;
          if (mid >= rs && mid + durMin <= re && noClash(mid)) candidates.add(mid);
        }
      });
    }

    const out = [];
    candidates.forEach((t) => {
      if (t < earliest) return;
      if (t < h.start) return;
      if (t + durMin > dayEnd) return;
      if (!noClash(t)) return;
      out.push(t);
    });
    return out.sort((a, b) => a - b);
  };

  // Multi-person: given a list of { prov, durMin }, find combined options.
  // Returns { sameTime: [startMin...], backToBack: [{ order:[{prov,start,dur}] }] }
  const findGroupSlots = (people, d) => {
    if (!people.length) return { sameTime: [], sequential: [] };
    // same-time: a start where EVERY person's barber is free for their duration at that start
    const perFree = people.map((p) => new Set(freeSlotsFor(p.prov, d, p.durMin)));
    const first = freeSlotsFor(people[0].prov, d, people[0].durMin);
    const sameTime = first.filter((t) => people.every((p, i) => perFree[i].has(t)));
    // sequential (back-to-back, can be same barber): place person0, then person1 right after, etc.
    const sequential = [];
    const startCandidates = freeSlotsFor(people[0].prov, d, people[0].durMin);
    for (const start of startCandidates) {
      let cursor = start; const order = []; let ok = true;
      for (const p of people) {
        const free = new Set(freeSlotsFor(p.prov, d, p.durMin));
        if (!free.has(cursor)) { ok = false; break; }
        order.push({ provId: p.prov.id, start: cursor, dur: p.durMin });
        cursor += p.durMin;
      }
      if (ok) sequential.push({ start, order });
      if (sequential.length >= 6) break;
    }
    return { sameTime, sequential };
  };

  const dateOptions = useMemo(() => {
    const arr = [];
    const base = new Date();
    const worksOn = (dow) => providers.some((p) => p.id !== "anyone" && p.hours?.[dow]?.on);
    // Booking window: how far out clients can book. 0 = no cutoff (capped at 730 days for rendering sanity).
    const horizon = (business?.booking?.horizonDays === 0) ? 730 : (Math.max(1, business?.booking?.horizonDays || 60));
    for (let i = 0; i < horizon; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      if (!worksOn(d.getDay())) continue;
      arr.push(d);
    }
    return arr;
  }, [providers, business]);

  // --- Regular front-door helpers (Piece 1) ---
  // Soonest open { date, slot } for a given barber across the next 14 working days.
  // slot is minutes-from-midnight (matches freeSlotsFor). Returns null if nothing open.
  const findNextAvailable = (prov, durMin) => {
    if (!prov) return null;
    for (const d of dateOptions) {
      const slots = freeSlotsFor(prov, d, durMin || 30, 15);
      if (slots.length) return { date: d, slot: slots[0] };
    }
    return null;
  };
  // Soonest open slot with ANY OTHER barber, but only if it genuinely beats the
  // usual barber's soonest (earlier date, or same date + earlier time). Returns
  // { date, slot, provider } or null. Used for the gentle "sooner with someone else" line.
  const findSoonerWithOther = (usualProv, durMin, usualResult) => {
    let best = null;
    for (const p of providers) {
      if (!p || p.id === "anyone" || (usualProv && p.id === usualProv.id)) continue;
      const r = findNextAvailable(p, durMin);
      if (!r) continue;
      if (!best || r.date < best.date || (+r.date === +best.date && r.slot < best.slot)) best = { ...r, provider: p };
    }
    if (!best) return null;
    if (usualResult) {
      const beatsDate = best.date < usualResult.date;
      const sameDay = +best.date === +usualResult.date;
      const beatsTime = sameDay && best.slot < usualResult.slot;
      if (!beatsDate && !beatsTime) return null; // not actually sooner — don't show it
    }
    return best;
  };

  // Group the cart by who each service is for → a "person" with their barber + total duration.
  const people = useMemo(() => {
    const groups = {};
    cart.forEach((e) => {
      const key = e.forMemberId || "self";
      const dur = lineTotal(e).min;
      if (!groups[key]) groups[key] = { key, name: e.forName || "Me", prov: e.provider && e.provider.id !== "anyone" ? e.provider : (providers.find((p) => p.id === "dan") || providers[1]), durMin: 0, items: [] };
      groups[key].durMin += dur;
      groups[key].items.push(e);
    });
    return Object.values(groups);
  }, [cart, providers]);
  const isMultiPerson = people.length > 1;

  const allSlots = useMemo(() => { if (!cartMin) return []; const out = []; for (let t = 9 * 60; t + cartMin <= 17 * 60; t += cartMin) out.push(t); return out; }, [cartMin]);
  // Real availability. Single person → their free slots. Multiple people → group solve.
  const groupSlots = useMemo(() => {
    if (!selectedDate || !isMultiPerson) return null;
    return findGroupSlots(people.map((p) => ({ prov: p.prov, durMin: p.durMin })), selectedDate);
  }, [selectedDate, isMultiPerson, people, appts]);
  const openSlots = useMemo(() => {
    if (!selectedDate) return [];
    if (isMultiPerson && groupSlots) {
      // prefer same-time starts; fall back to the start of each back-to-back option
      if (groupSlots.sameTime.length) return groupSlots.sameTime;
      return groupSlots.sequential.map((s) => s.start);
    }
    const prov = provider && provider.id !== "anyone" ? provider : (providers.find((p) => p.id === "dan") || providers[1]);
    return freeSlotsFor(prov, selectedDate, cartMin || 30, 15);
  }, [selectedDate, provider, providers, cartMin, appts, isMultiPerson, groupSlots]);
  const slotIsSameTime = isMultiPerson && groupSlots && slot != null && groupSlots.sameTime.includes(slot);
  const dateIsFull = selectedDate && openSlots.length === 0;

  const back = () => { setShowWaitlist(false); if (consult) { if (consult.step === "sides") { setConsult(null); setDraft(null); setCutType(null); setCutPhase("type"); setStep(1); return; } if (consult.step === "sidesHelp") { setConsult({ ...consult, step: "sides" }); return; } if (consult.step === "bottom") { setConsult({ ...consult, step: "sides", sides: null }); return; } if (consult.step === "condition") { setConsult({ ...consult, step: "bottom", bottom: null }); return; } if (consult.step === "reveal") { setConsult({ ...consult, step: "condition" }); setConsultResult(null); return; } } if (showCodeEntry) { setShowCodeEntry(false); setCodeEntry(""); return; } if (showWizardIntro) { if (wizardIdx > 0) { setWizardIdx(wizardIdx - 1); return; } setShowWizardIntro(false); if (groupPeople.length > 1) { setShowSchedChoice(true); } else { setShowWhoFor(true); } return; } if (showSchedChoice) { setShowSchedChoice(false); setShowWhoFor(true); return; } if (addingMember) { setAddingMember(false); return; } if (showUsual) { setShowUsual(false); setCameFromUsual(false); if (business?.familyBooking?.enabled !== false && matched && (matched.family || []).length >= 0) { setShowWhoFor(true); } else { setStep(5); } return; } if (showWhoFor) { setShowWhoFor(false); setStep(5); return; } if (step <= 0) return onExit(); if (step === 1) { setStep(0); return; } if (step === 2) { if (draft && draft.beardTypes && draft.beardTypes.length && cutPhase === "addons") { setCutPhase("beard"); setBeardType(null); return; } if (draft && draft.cutTypes && draft.cutTypes.length && (cutPhase === "addons" || cutPhase === "beard")) { setCutPhase("type"); setCutType(null); setBeardType(null); return; } setDraft(null); setDraftAddons({}); setCutType(null); setBeardType(null); setCutPhase("type"); setStep(1); return; } if (step === 5) { setShowCodeEntry(false); setStep(0); return; } if (step === 6) { if (cameFromUsual) { setStep(5); setShowUsual(true); return; } setStep(4); return; } if (step === 7) { if (cameFromUsual) { setStep(5); setShowUsual(true); return; } setStep(6); return; } setStep(step - 1); };

  const Stepper = ({ active }) => { const labels = ["Service", "Date", "Confirm"]; return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, padding: "14px 0", borderBottom: "1px solid var(--line)", marginBottom: 22 }}>
      {labels.map((l, i) => (<React.Fragment key={l}><span style={{ fontSize: 14, padding: "6px 16px", borderRadius: 20, background: active === i ? "var(--panel2)" : "transparent", color: active === i ? "var(--text)" : "var(--faint)", border: active === i ? "1px solid var(--border)" : "1px solid transparent" }}>{l}</span>{i < labels.length - 1 && <ChevronRight size={14} style={{ color: "var(--border2)" }} />}</React.Fragment>))}
    </div>); };

  // A signature of whichever screen is currently visible. When it changes, the
  // keyed wrapper below remounts the screen region, which RE-FIRES the entry
  // animation every time (without a changing key, React reuses the same DOM
  // node between steps and the animation only plays once, on first load).
  const screenKey = [
    "s" + step,
    cutPhase,
    showWhoFor ? "who" : "",
    showUsual ? "usual" : "",
    showSchedChoice ? "sched" : "",
    showWizardIntro ? "wiz" + wizardIdx : "",
    showCodeEntry ? "code" : "",
    addingMember ? "addmem" : "",
    intakeFor ? "intake" : "",
  ].join("|");

  // Scroll to top whenever the user navigates to a new screen so the back button & business name stay visible
  useEffect(() => { try { window.scrollTo({ top: 0, behavior: "instant" }); } catch (e) { window.scrollTo(0, 0); } }, [screenKey]);

  // Commits the booking with the resolved phone and email. Called either directly from LOCK IT IN
  // (no conflict) or from the conflict-confirmation sheet (after the user picks which to keep).
  const commitBooking = (finalPhone, finalEmail) => {
    const baseId = Date.now();
    let clientId = matched?.id || null;
    if (!matched && !activeMember) {
      clientId = "c" + baseId + Math.floor(Math.random() * 1000);
      const newClient = { id: clientId, name: newName, firstName: newFirst.trim(), lastName: newLast.trim(), email: (finalEmail || "").trim(), phone: (finalPhone || "").trim(), provider: provider.id === "anyone" ? "dan" : provider.id, visits: 0, customDurations: {}, notes: "", messages: [], gallery: [], timeline: [], family: [] };
      setClients((cur) => [newClient, ...cur]);
    } else if (matched) {
      // Returning client confirmed/updated their info — write the chosen values to their profile
      // so a barber-added record gets an email, a corrected name persists, etc.
      setClients((cur) => cur.map((c) => c.id === matched.id ? { ...c, firstName: newFirst.trim(), lastName: newLast.trim(), name: newName, email: (finalEmail || "").trim(), phone: (finalPhone || "").trim() } : c));
    }
    const newAppts = [];
    const isSame = isMultiPerson && groupSlots && groupSlots.sameTime.includes(slot);
    let cursor = slot;
    people.forEach((person, pi) => {
      const startMin = isMultiPerson ? (isSame ? slot : cursor) : slot;
      const bookedFor = new Date(selectedDate); bookedFor.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
      const prov = person.prov;
      const title = person.items.map(describeEntry).join(", ");
      newAppts.push({
        id: baseId + pi,
        providerId: prov.id === "anyone" ? "dan" : prov.id,
        clientId: person.key === "self" ? (clientId || "guest") : (clientId || "guest"),
        familyMemberId: person.key === "self" ? null : person.key,
        bookedByName: person.key === "self" ? null : (matched?.name || newName.trim()),
        serviceId: person.items[0].service.id,
        lineItems: person.items.map((e) => ({ serviceId: e.service.id, cutType: e.cutType || null, beardType: e.beardType || null, addons: e.addons || {} })),
        start: startMin,
        end: startMin + person.durMin,
        status: "confirmed",
        name: person.name,
        title,
        bookedFor: bookedFor.toISOString(),
        photos: pi === 0 ? photos : 0,
        hasPhotos: pi === 0 && photos > 0,
        phone: finalPhone,
        groupId: isMultiPerson ? baseId : null,
      });
      if (!isSame) cursor += person.durMin;
    });
    setAppts([...appts, ...newAppts]);
    setBookedId(baseId); setStep(8);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 480, padding: "24px 22px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          {step > 0 ? <button onClick={back} style={{ background: "none", color: "var(--sub)", display: "flex", alignItems: "center", gap: 6, fontSize: 15 }}><ArrowLeft size={16} /> Back</button> : <div style={{ width: 50 }} />}
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, letterSpacing: 3 }}>{business.name}</div>
          <div style={{ width: 50 }} />
        </div>
        {step >= 3 && step <= 5 && <Stepper active={0} />}
        {step === 6 && <Stepper active={1} />}
        {step >= 7 && <Stepper active={2} />}

        <div key={screenKey} className="screen-swap">
        {/* STEP 0 — WELCOME / front door */}
        {step === 0 && (
          <div className="fade-up" style={{ minHeight: "62vh", display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center", padding: "10px 4px 0" }}>
            <div style={{ fontSize: 13, letterSpacing: 3, color: "var(--faint)", marginBottom: 14 }}>WELCOME TO</div>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 46, fontWeight: 500, lineHeight: 1.05, margin: "0 0 14px" }}>{business.name}</h1>
            <p style={{ color: "var(--sub)", fontSize: 15, fontWeight: 300, margin: "0 auto 38px", maxWidth: 280 }}>Glad you're here. Let's find you a time.</p>
            <button className="lift" onClick={() => { setBookingFor("self"); setActiveMember(null); setAddingMember(false); setStep(5); }} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: "20px 18px", fontSize: 16, fontWeight: 500, borderRadius: 14, border: "none", marginBottom: 13, textAlign: "left", display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 17 }}>I've been here before</span>
              <span style={{ fontSize: 13, opacity: 0.8, fontWeight: 300 }}>We'll pull up your details</span>
            </button>
            <button className="lift" onClick={() => { setBookingFor(null); setMatched(null); setStep(1); }} style={{ width: "100%", background: "var(--panel)", color: "var(--text)", padding: "20px 18px", fontSize: 16, borderRadius: 14, border: "1px solid var(--border)", textAlign: "left", display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 17 }}>It's my first time</span>
              <span style={{ fontSize: 13, color: "var(--sub)", fontWeight: 300 }}>Welcome — let's take a look</span>
            </button>
          </div>
        )}

        {/* STEP 1 — EDITORIAL CATEGORY SCREEN (new client) */}
        {step === 1 && (
          <div className="fade-up" style={{ margin: "0 -22px" }}>
            {/* Editorial masthead — no photo, type carries the page */}
            <div style={{ padding: "36px 24px 28px", textAlign: "center", marginBottom: 8 }}>
              <div style={{ width: 36, height: 1.5, background: "var(--gold)", margin: "0 auto 22px" }} />
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 42, fontWeight: 500, color: "var(--text)", lineHeight: 1.02, letterSpacing: "-0.5px", marginBottom: 14 }}>Welcome in.</div>
              <div style={{ fontSize: 17, color: "var(--text)", lineHeight: 1.5, fontWeight: 400, maxWidth: 320, margin: "0 auto" }}>Glad you're here. What are we doing today?</div>
            </div>
            {/* Magazine-cover cards — tall photo with overlaid text */}
            <div style={{ padding: "0 22px", display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { key: "hair", label: "Hair", sub: "JUST THE CUT", photo: "photo-1605497788044-5a32c7078486" },
                { key: "hairBeard", label: "Hair + Beard", sub: "THE FULL RESET", photo: "photo-1621607512214-68297480165e" },
                { key: "beard", label: "Beard", sub: "JUST A TIDY-UP", photo: "photo-1503951914875-452162b0f3f1" },
              ].map((cat) => (
                <button key={cat.key} className="lift" onClick={() => {
                  setNewClientCategory(cat.key);
                  const lower = (s) => (s.name || "").toLowerCase();
                  let match = null;
                  if (cat.key === "hairBeard") match = services.find((s) => /haircut.*beard|cut.*beard|beard.*cut/.test(lower(s)));
                  if (cat.key === "beard" && !match) match = services.find((s) => lower(s).includes("beard") && !lower(s).includes("cut"));
                  if (cat.key === "hair" && !match) match = services.find((s) => /haircut|cut/.test(lower(s)) && !lower(s).includes("beard"));
                  if (!match) match = services[0];
                  if (match.firstTime && match.intake) { setIntakeFor(match); return; }
                  setDraft(match); setDraftAddons({}); setCutType(null); setCutPhase("type");
                  // For hair-based services with cut types, launch the guided consultation.
                  const hasCutTypes = match.cutTypes && match.cutTypes.length > 0;
                  if ((cat.key === "hair" || cat.key === "hairBeard") && hasCutTypes && business?.booking?.guidedConsult !== false) {
                    setConsult({ step: "sides", sides: null, bottom: null, condition: null });
                    setConsultResult(null);
                    setStep(2);
                  } else {
                    setStep(2);
                  }
                }} style={{ position: "relative", height: 130, width: "100%", border: "none", borderRadius: 16, padding: 0, overflow: "hidden", color: "#fff", textAlign: "left", boxShadow: "var(--shadow-md)", background: "var(--panel2)" }}>
                  <img src={imgUrl(cat.photo, 700)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.20) 100%)" }} />
                  <div style={{ position: "absolute", left: 22, top: 0, bottom: 0, right: 56, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ width: 22, height: 1.5, background: "var(--gold)", marginBottom: 10 }} />
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 500, lineHeight: 1.05 }}>{cat.label}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.78)", letterSpacing: 1.8, marginTop: 6 }}>{cat.sub}</div>
                  </div>
                  <div style={{ position: "absolute", right: 18, top: "50%", transform: "translateY(-50%)", width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.14)", backdropFilter: "blur(6px)", border: "0.5px solid rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <ChevronRight size={18} style={{ color: "#fff" }} />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {intakeFor && (
          <FirstTimeIntake
            service={intakeFor}
            onCancel={() => setIntakeFor(null)}
            onDone={(answers) => {
              // attach the captured answers to the service draft, then go pick a provider
              const labeled = { ...intakeFor, intakeAnswers: answers };
              setDraft(labeled); setDraftAddons({}); setIntakeFor(null); setStep(3);
            }}
          />
        )}

        {/* GUIDED CONSULTATION — minimalist, typographic, no images */}
        {step === 2 && consult && draft && draft.cutTypes && draft.cutTypes.length > 0 && (() => {
          const finish = (cutId, extraMin) => {
            setCutType(cutId);
            setConsultResult({ cutId, transformation: !!extraMin });
            setConsult({ ...consult, step: "reveal", _extraMin: extraMin || 0 });
          };
          // Reusable header: gold rule + step label + big question + readable sub
          const Head = ({ step: s, q, sub }) => (
            <div style={{ padding: "8px 2px 30px" }}>
              <div style={{ width: 34, height: 1.5, background: "var(--gold)", marginBottom: 18 }} />
              <div style={{ fontSize: 12, letterSpacing: 3, color: "var(--gold)", fontWeight: 700, marginBottom: 18 }}>{s}</div>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 40, fontWeight: 500, color: "var(--text)", lineHeight: 1.04, letterSpacing: "-0.5px", marginBottom: sub ? 16 : 0 }}>{q}</h2>
              {sub && <p style={{ color: "var(--text)", fontSize: 18, lineHeight: 1.45, fontWeight: 400, opacity: 0.78 }}>{sub}</p>}
            </div>
          );
          // Reusable option list: thin dividers, big serif title, readable description
          const OptionList = ({ items }) => (
            <div style={{ borderTop: "1px solid var(--line)" }}>
              {items.map((it, i) => (
                <button key={i} className="lift-row" onClick={it.onTap} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, background: "none", border: "none", borderBottom: "1px solid var(--line)", padding: "22px 4px", textAlign: "left", color: "var(--text)" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 25, fontWeight: 500, lineHeight: 1.1, marginBottom: it.sub ? 6 : 0, color: it.gold ? "var(--gold)" : "var(--text)" }}>{it.title}</div>
                    {it.sub && <div style={{ fontSize: 17, color: "var(--sub)", lineHeight: 1.45 }}>{it.sub}</div>}
                  </div>
                  <ChevronRight size={22} style={{ color: "var(--gold)", flexShrink: 0 }} />
                </button>
              ))}
            </div>
          );

          // ---- SIDES ----
          if (consult.step === "sides") {
            return (
              <div className="fade-up">
                <Head s="STEP 1 OF 3" q="How should we cut the sides?" sub="This sets the whole shape of your cut." />
                <OptionList items={[
                  { title: "Clippers", sub: "Short on the sides, trimmed on top. What most guys get.", onTap: () => setConsult({ ...consult, sides: "tight", step: "bottom" }) },
                  { title: "Scissors only", sub: "No clippers — softer and longer all over.", onTap: () => finish("scissor") },
                ]} />
              </div>
            );
          }
          // ---- BOTTOM ----
          if (consult.step === "bottom") {
            return (
              <div className="fade-up">
                <Head s="STEP 2 OF 3" q="How short at the bottom?" sub="The one thing that separates a regular cut from a skin fade." />
                <OptionList items={[
                  { title: "Short, but not bald", sub: "A little hair stays at the edges. The classic look.", onTap: () => setConsult({ ...consult, bottom: "short", step: "condition" }) },
                  { title: "All the way to skin", sub: "Smooth and bare at the edges. The sharpest, cleanest finish.", onTap: () => setConsult({ ...consult, bottom: "skin", step: "condition" }) },
                ]} />
              </div>
            );
          }
          // ---- CONDITION ----
          if (consult.step === "condition") {
            const cutId = consult.bottom === "skin" ? "skinfade" : "standard";
            return (
              <div className="fade-up">
                <Head s="STEP 3 OF 3" q="How long since your last cut?" sub="So we save the right amount of time for you." />
                <OptionList items={[
                  { title: "3–6 weeks", sub: "The usual time between cuts.", onTap: () => finish(cutId, 0) },
                  { title: "It's been a while", sub: "Grown out — we'll be taking off a good amount.", gold: true, onTap: () => finish(cutId, 10) },
                ]} />
              </div>
            );
          }
          // ---- REVEAL ----
          if (consult.step === "reveal") {
            const ct = draft.cutTypes.find((c) => c.id === (consultResult?.cutId));
            const extra = consult._extraMin || 0;
            const heroImg = ct && (ct.images || [])[0];
            return (
              <div className="fade-up">
                <div style={{ textAlign: "center", paddingTop: 6, marginBottom: 22 }}>
                  <div className="success-bloom" style={{ width: 46, height: 46, borderRadius: "50%", background: "color-mix(in srgb, var(--gold) 16%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><Check size={22} style={{ color: "var(--gold)" }} strokeWidth={2.5} /></div>
                  <div style={{ fontSize: 12, letterSpacing: 3, color: "var(--gold)", fontWeight: 700 }}>YOUR MATCH</div>
                </div>

                {/* Hero card — image if available, gorgeous typographic fallback if not */}
                <div className="drift-in" style={{ borderRadius: 22, overflow: "hidden", marginBottom: 22, boxShadow: "var(--shadow-md)", position: "relative", minHeight: 320 }}>
                  {heroImg ? (
                    <>
                      <img src={imgUrl(heroImg, 900)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0.12) 100%)" }} />
                    </>
                  ) : (
                    // Fallback: layered warm gradient with a giant ghosted serif initial
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(145deg, #1a1714 0%, #2a2420 55%, #0f0d0b 100%)" }}>
                      <div style={{ position: "absolute", top: -40, right: -20, fontFamily: FONT_DISPLAY, fontSize: 320, lineHeight: 1, color: "color-mix(in srgb, var(--gold) 14%, transparent)", fontWeight: 500, userSelect: "none" }}>{ct?.label?.charAt(0)}</div>
                      <div style={{ position: "absolute", top: 22, left: 24, width: 40, height: 1.5, background: "var(--gold)" }} />
                    </div>
                  )}
                  <div style={{ position: "absolute", left: 24, right: 24, bottom: 24, color: "#fff" }}>
                    <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--gold)", fontWeight: 700, marginBottom: 10 }}>WE'D SET YOU UP WITH</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 42, fontWeight: 500, lineHeight: 1.0, letterSpacing: "-0.5px", marginBottom: 14 }}>{ct?.label}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 26, color: "#fff" }}>${ct?.price}</span>
                      <span style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(255,255,255,0.5)" }} />
                      <span style={{ fontSize: 14, color: "rgba(255,255,255,0.8)" }}>with {provider.name}</span>
                    </div>
                  </div>
                </div>

                {extra > 0 && (
                  <div style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", padding: "18px 2px", marginBottom: 24 }}>
                    <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--gold)", fontWeight: 700, marginBottom: 8 }}>A LITTLE EXTRA TIME</div>
                    <p style={{ fontSize: 16, color: "var(--text)", lineHeight: 1.5 }}>We'll set aside 10 more minutes to do it right. No extra charge — it's part of the cut.</p>
                  </div>
                )}

                <button className="lift" onClick={() => { setConsult(null); setCutPhase(draft.beardTypes && draft.beardTypes.length ? "beard" : "addons"); }} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 18, fontSize: 14, letterSpacing: 2.5, fontWeight: 600, borderRadius: 14, marginBottom: 12, boxShadow: "var(--shadow-md)" }}>BOOK IT</button>
                <button onClick={() => { setConsult(null); setCutType(null); setCutPhase("type"); }} style={{ width: "100%", background: "transparent", color: "var(--sub)", padding: 12, fontSize: 14.5, fontWeight: 500, borderRadius: 12 }}>Let me choose myself</button>
              </div>
            );
          }
          return null;
        })()}

        {/* STEP 2 — cut type: clean, minimal cards. Tap the whole card to select. */}
        {step === 2 && !consult && draft && draft.cutTypes && draft.cutTypes.length > 0 && cutPhase === "type" && (
          <div className="fade-up">
            {/* Editorial masthead — matches screen 1 (centered, no photo) */}
            <div style={{ padding: "8px 4px 26px", textAlign: "center", marginBottom: 8 }}>
              <div style={{ width: 36, height: 1.5, background: "var(--gold)", margin: "0 auto 18px" }} />
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 38, fontWeight: 500, color: "var(--text)", lineHeight: 1.02, letterSpacing: "-0.5px", marginBottom: 12 }}>Pick your cut</h2>
              <p style={{ color: "var(--text)", fontSize: 16, lineHeight: 1.5, fontWeight: 400, maxWidth: 320, margin: "0 auto" }}>Tap whichever's closest — your barber dials it in in the chair.</p>
            </div>
            {/* Cut cards — equal-height, photo forced to consistent ratio */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 26 }}>
              {draft.cutTypes.map((ct) => {
                const img = (ct.images || [])[0];
                return (
                  <button key={ct.id} className="lift" onClick={() => { setCutType(ct.id); setCutPhase(draft.beardTypes && draft.beardTypes.length ? "beard" : "addons"); }} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 0, overflow: "hidden", display: "flex", alignItems: "stretch", color: "var(--text)", textAlign: "left", height: 92, boxShadow: "var(--shadow-sm)" }}>
                    <div style={{ width: 92, height: 92, flexShrink: 0, overflow: "hidden", background: "var(--panel2)", position: "relative" }}>
                      {img && <img src={imgUrl(img, 280)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                    </div>
                    <div style={{ flex: 1, padding: "16px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 500, lineHeight: 1.15, marginBottom: 3 }}>{ct.label}</div>
                        <div style={{ fontSize: 13, color: "var(--gold)", fontWeight: 500 }}>${ct.price}</div>
                      </div>
                      <ChevronRight size={20} style={{ color: "var(--gold)", flexShrink: 0 }} />
                    </div>
                  </button>
                );
              })}
            </div>
            {/* Helper options — only render when AI cut helper is enabled in shop settings */}
            {business.aiCutHelper && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input ref={helperPhotoInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                // Resize photo before upload: max 1024px on the long side, JPEG 85%
                const resize = (fileObj) => new Promise((resolve, reject) => {
                  const fr = new FileReader();
                  fr.onload = (ev) => {
                    const img = new Image();
                    img.onload = () => {
                      const max = 1024;
                      let w = img.width, h = img.height;
                      if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
                      else if (h >= w && h > max) { w = Math.round(w * max / h); h = max; }
                      const canvas = document.createElement("canvas");
                      canvas.width = w; canvas.height = h;
                      const ctx = canvas.getContext("2d");
                      ctx.drawImage(img, 0, 0, w, h);
                      const out = canvas.toDataURL("image/jpeg", 0.85);
                      resolve({ dataUrl: out, mediaType: "image/jpeg" });
                    };
                    img.onerror = reject;
                    img.src = ev.target.result;
                  };
                  fr.onerror = reject;
                  fr.readAsDataURL(fileObj);
                });
                setCutHelperOpen("photo");
                setPhotoResult(null);
                setPhotoError(null);
                setPhotoLoading(true);
                resize(file).then(async ({ dataUrl, mediaType }) => {
                  setHelperPhotoUrl(dataUrl);
                  setBookingPhoto({ dataUrl, mediaType });
                  const base64 = String(dataUrl).split(",")[1] || "";
                  const cutList = draft.cutTypes.map((c) => ({ id: c.id, label: c.label, desc: c.desc || "" }));
                  const callAI = async () => {
                    const { data, error } = await supabase.functions.invoke("ai-suggest-cut", {
                      body: { photoBase64: base64, photoMediaType: mediaType, services: cutList },
                    });
                    if (error) throw error;
                    if (data && data.error) throw new Error(data.error);
                    if (!data || !data.matchId) throw new Error("No match found");
                    return data;
                  };
                  try {
                    let data;
                    try { data = await callAI(); }
                    catch (firstErr) {
                      console.warn("First AI attempt failed, retrying:", firstErr);
                      await new Promise((r) => setTimeout(r, 800));
                      data = await callAI();
                    }
                    setPhotoResult(data);
                  } catch (err) {
                    console.error("Photo AI failed after retry:", err);
                    setPhotoError("Couldn't read the photo right now — pick whichever cut looks closest below and we'll save the photo for your barber.");
                  } finally {
                    setPhotoLoading(false);
                  }
                }).catch((err) => {
                  console.error("Resize failed:", err);
                  setPhotoError("Couldn't open that photo — try a different one.");
                  setPhotoLoading(false);
                });
              }} />
              <button onClick={() => helperPhotoInputRef.current && helperPhotoInputRef.current.click()} style={{ width: "100%", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 13, color: "var(--text)", textAlign: "left", fontSize: 14 }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", background: "color-mix(in srgb, var(--gold) 14%, var(--panel2))", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Camera size={17} style={{ color: "var(--gold)" }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                  <span style={{ fontWeight: 500, fontSize: 15 }}>Show us a photo</span>
                  <span style={{ fontSize: 13, color: "var(--sub)" }}>Upload the look you want — we'll match it</span>
                </div>
                <ChevronRight size={18} style={{ color: "var(--faint)", flexShrink: 0 }} />
              </button>
              <button onClick={() => setCutHelperOpen("notSure")} style={{ width: "100%", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 13, color: "var(--text)", textAlign: "left", fontSize: 14 }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", background: "color-mix(in srgb, var(--gold) 14%, var(--panel2))", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 19, color: "var(--gold)", fontWeight: 500 }}>?</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                  <span style={{ fontWeight: 500, fontSize: 15 }}>I'm not sure</span>
                  <span style={{ fontSize: 13, color: "var(--sub)" }}>Help me pick — a couple quick questions</span>
                </div>
                <ChevronRight size={18} style={{ color: "var(--faint)", flexShrink: 0 }} />
              </button>
            </div>
            )}
            {/* Helper sheet — opens when they upload a photo or tap "I'm not sure" */}
            {business.aiCutHelper && cutHelperOpen && (
              <div onClick={() => setCutHelperOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 2000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg)", width: "100%", maxWidth: 480, borderRadius: "20px 20px 0 0", padding: "22px 22px 30px", maxHeight: "85vh", overflowY: "auto" }}>
                  <div style={{ width: 36, height: 4, background: "var(--border2)", borderRadius: 2, margin: "0 auto 18px" }} />
                  {cutHelperOpen === "photo" && (
                    <>
                      <div style={{ width: 28, height: 1.5, background: "var(--gold)", marginBottom: 12 }} />
                      <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 500, lineHeight: 1.1, marginBottom: 10 }}>Here's the look</h3>
                      <p style={{ color: "var(--text)", fontSize: 15, marginBottom: 18, lineHeight: 1.5 }}>We'll save this photo to your appointment so your barber sees it before you sit down.</p>
                      {helperPhotoUrl && (
                        <div style={{ width: "100%", aspectRatio: "4/3", borderRadius: 14, overflow: "hidden", background: "var(--panel2)", marginBottom: 18 }}>
                          <img src={helperPhotoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        </div>
                      )}
                      {photoLoading && (
                        <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", marginBottom: 14, fontSize: 14, color: "var(--sub)", display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid var(--line)", borderTopColor: "var(--gold)", animation: "spin .8s linear infinite", flexShrink: 0 }} />
                          <span>Finding your match…</span>
                        </div>
                      )}
                      {photoError && (
                        <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px 14px", fontSize: 13.5, color: "var(--sub)", marginBottom: 14, lineHeight: 1.5 }}>{photoError}</div>
                      )}
                      {photoResult && (() => {
                        const match = draft.cutTypes.find((c) => c.id === photoResult.matchId);
                        if (!match) return null;
                        return (
                          <div style={{ marginBottom: 14 }}>
                            <div style={{ background: "color-mix(in srgb, var(--gold) 10%, var(--panel))", border: "1.5px solid var(--gold)", borderRadius: 16, overflow: "hidden", marginBottom: 12 }}>
                              <div style={{ display: "flex", alignItems: "stretch", height: 90 }}>
                                <div style={{ width: 90, height: 90, flexShrink: 0, background: "var(--panel2)", position: "relative", overflow: "hidden" }}>
                                  {match.images && match.images[0] && <img src={imgUrl(match.images[0], 240)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
                                </div>
                                <div style={{ flex: 1, padding: "14px 16px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                                  <div style={{ fontSize: 11, letterSpacing: 1.5, color: "var(--gold)", fontWeight: 600, marginBottom: 4 }}>YOUR MATCH</div>
                                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 500, lineHeight: 1.1 }}>{photoResult.matchLabel}</div>
                                </div>
                              </div>
                              {photoResult.reason && (
                                <div style={{ padding: "12px 16px", borderTop: "1px solid color-mix(in srgb, var(--gold) 25%, transparent)", fontSize: 13.5, color: "var(--text)", lineHeight: 1.5 }}>{photoResult.reason}</div>
                              )}
                            </div>
                            <button className="lift" onClick={() => { setCutType(match.id); setCutHelperOpen(null); setPhotoResult(null); setCutPhase(draft.beardTypes && draft.beardTypes.length ? "beard" : "addons"); }} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 14, fontSize: 14, letterSpacing: 1.5, fontWeight: 600, borderRadius: 12, border: "none", marginBottom: 9 }}>Sounds right — book this</button>
                            <button onClick={() => helperPhotoInputRef.current && helperPhotoInputRef.current.click()} style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", borderRadius: 12, padding: "12px", color: "var(--sub)", fontSize: 14 }}>Try a different photo</button>
                          </div>
                        );
                      })()}
                      {!photoLoading && !photoResult && (
                        <>
                          <div style={{ fontSize: 12, letterSpacing: 1.5, color: "var(--faint)", marginBottom: 10 }}>OR PICK FROM THE LIST</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 14 }}>
                            {draft.cutTypes.map((ct) => (
                              <button key={ct.id} className="lift" onClick={() => { setCutType(ct.id); setCutHelperOpen(null); setCutPhase(draft.beardTypes && draft.beardTypes.length ? "beard" : "addons"); }} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "13px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--text)", textAlign: "left" }}>
                                <span style={{ fontSize: 15, fontWeight: 500 }}>{ct.label}</span>
                                <ChevronRight size={18} style={{ color: "var(--gold)" }} />
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                      <button onClick={() => { setHelperPhotoUrl(null); setBookingPhoto(null); setPhotoResult(null); setPhotoError(null); setCutHelperOpen(null); }} style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", borderRadius: 12, padding: "12px", color: "var(--sub)", fontSize: 14 }}>Cancel</button>
                    </>
                  )}
                  {cutHelperOpen === "notSure" && (
                    <>
                      <div style={{ width: 28, height: 1.5, background: "var(--gold)", marginBottom: 12 }} />
                      <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 500, lineHeight: 1.1, marginBottom: 10 }}>No worries — describe what you want</h3>
                      <p style={{ color: "var(--text)", fontSize: 15, marginBottom: 18, lineHeight: 1.5 }}>Just type it in your own words. We'll match it to the right cut.</p>
                      <textarea
                        value={notSureText}
                        onChange={(e) => { setNotSureText(e.target.value); setNotSureResult(null); setNotSureError(null); }}
                        placeholder="e.g. short on the sides, longer on top, no skin showing"
                        rows={3}
                        style={{ ...inputStyle, marginBottom: 12, resize: "vertical", minHeight: 80, fontFamily: FONT_BODY }}
                      />
                      {!notSureResult && (
                        <button
                          className="lift"
                          disabled={!notSureText.trim() || notSureLoading}
                          onClick={async () => {
                            setNotSureLoading(true); setNotSureError(null); setNotSureResult(null);
                            const cutList = draft.cutTypes.map((c) => ({ id: c.id, label: c.label, desc: c.desc || "" }));
                            const callAI = async () => {
                              const { data, error } = await supabase.functions.invoke("ai-suggest-cut", {
                                body: { description: notSureText.trim(), services: cutList },
                              });
                              if (error) throw error;
                              if (data && data.error) throw new Error(data.error);
                              if (!data || !data.matchId) throw new Error("No match found");
                              return data;
                            };
                            try {
                              let data;
                              try { data = await callAI(); }
                              catch (firstErr) {
                                console.warn("First AI attempt failed, retrying:", firstErr);
                                await new Promise((r) => setTimeout(r, 800));
                                data = await callAI();
                              }
                              setNotSureResult(data);
                            } catch (e) {
                              console.error("Text AI failed after retry:", e);
                              setNotSureError("Couldn't get a suggestion right now — just pick whichever sounds closest below.");
                            } finally {
                              setNotSureLoading(false);
                            }
                          }}
                          style={{ width: "100%", background: (notSureText.trim() && !notSureLoading) ? "var(--gold)" : "var(--border)", color: (notSureText.trim() && !notSureLoading) ? "var(--on-gold)" : "var(--faint)", padding: 14, fontSize: 14, letterSpacing: 1.5, fontWeight: 600, borderRadius: 12, border: "none", marginBottom: 16 }}
                        >
                          {notSureLoading ? "One sec…" : "Find my match"}
                        </button>
                      )}
                      {notSureError && (
                        <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px 14px", fontSize: 13.5, color: "var(--sub)", marginBottom: 14, lineHeight: 1.5 }}>{notSureError}</div>
                      )}
                      {notSureResult && (() => {
                        const match = draft.cutTypes.find((c) => c.id === notSureResult.matchId);
                        if (!match) return null;
                        return (
                          <div style={{ marginBottom: 14 }}>
                            <div style={{ background: "color-mix(in srgb, var(--gold) 10%, var(--panel))", border: "1.5px solid var(--gold)", borderRadius: 16, overflow: "hidden", marginBottom: 12 }}>
                              <div style={{ display: "flex", alignItems: "stretch", height: 90 }}>
                                <div style={{ width: 90, height: 90, flexShrink: 0, background: "var(--panel2)", position: "relative", overflow: "hidden" }}>
                                  {match.images && match.images[0] && <img src={imgUrl(match.images[0], 240)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
                                </div>
                                <div style={{ flex: 1, padding: "14px 16px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                                  <div style={{ fontSize: 11, letterSpacing: 1.5, color: "var(--gold)", fontWeight: 600, marginBottom: 4 }}>BEST MATCH</div>
                                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 500, lineHeight: 1.1 }}>{notSureResult.matchLabel}</div>
                                </div>
                              </div>
                              {notSureResult.reason && (
                                <div style={{ padding: "12px 16px", borderTop: "1px solid color-mix(in srgb, var(--gold) 25%, transparent)", fontSize: 13.5, color: "var(--text)", lineHeight: 1.5 }}>{notSureResult.reason}</div>
                              )}
                            </div>
                            <button className="lift" onClick={() => { setCutType(match.id); setCutHelperOpen(null); setNotSureText(""); setNotSureResult(null); setCutPhase(draft.beardTypes && draft.beardTypes.length ? "beard" : "addons"); }} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 14, fontSize: 14, letterSpacing: 1.5, fontWeight: 600, borderRadius: 12, border: "none", marginBottom: 9 }}>Sounds right — book this</button>
                            <button onClick={() => { setNotSureResult(null); setNotSureText(""); }} style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", borderRadius: 12, padding: "12px", color: "var(--sub)", fontSize: 14 }}>Try a different description</button>
                          </div>
                        );
                      })()}
                      {!notSureResult && notSureError && (
                        <>
                          <div style={{ fontSize: 12, letterSpacing: 1.5, color: "var(--faint)", marginBottom: 10, marginTop: 4 }}>OR PICK FROM THE LIST</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                            {draft.cutTypes.map((ct) => (
                              <button key={ct.id} className="lift" onClick={() => { setCutType(ct.id); setCutHelperOpen(null); setNotSureText(""); setNotSureResult(null); setCutPhase(draft.beardTypes && draft.beardTypes.length ? "beard" : "addons"); }} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: 0, overflow: "hidden", display: "flex", alignItems: "stretch", color: "var(--text)", textAlign: "left", height: 80 }}>
                                <div style={{ width: 80, height: 80, flexShrink: 0, overflow: "hidden", background: "var(--panel2)", position: "relative" }}>
                                  {ct.images && ct.images[0] && <img src={imgUrl(ct.images[0], 240)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
                                </div>
                                <div style={{ flex: 1, padding: "12px 16px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 3 }}>
                                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 500 }}>{ct.label}</div>
                                  <div style={{ fontSize: 12.5, color: "var(--sub)", lineHeight: 1.4 }}>{ct.desc || `$${ct.price}`}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                      <button onClick={() => { setCutHelperOpen(null); setNotSureText(""); setNotSureResult(null); setNotSureError(null); }} style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", borderRadius: 12, padding: "12px", color: "var(--sub)", fontSize: 14 }}>Never mind</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 2 — beard type (own screen, for services with beardTypes) */}
        {step === 2 && draft && draft.beardTypes && draft.beardTypes.length > 0 && cutPhase === "beard" && (
          <div className="fade-up">
            {/* Editorial masthead matches Pick Your Cut */}
            <div style={{ padding: "8px 4px 26px", textAlign: "center", marginBottom: 8 }}>
              <div style={{ width: 36, height: 1.5, background: "var(--gold)", margin: "0 auto 18px" }} />
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 38, fontWeight: 500, color: "var(--text)", lineHeight: 1.02, letterSpacing: "-0.5px", marginBottom: 12 }}>Now the beard</h2>
              <p style={{ color: "var(--text)", fontSize: 16, lineHeight: 1.5, fontWeight: 400, maxWidth: 320, margin: "0 auto" }}>Tap the one that's closest — we'll set aside the right amount of time.</p>
            </div>
            {/* Beard cards — equal-height, single tap to select */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 26 }}>
              {draft.beardTypes.map((bt) => {
                const img = (bt.images || [])[0];
                return (
                  <button key={bt.id} className="lift" onClick={() => { setBeardType(bt.id); setCutPhase("addons"); }} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 0, overflow: "hidden", display: "flex", alignItems: "stretch", color: "var(--text)", textAlign: "left", height: 92, boxShadow: "var(--shadow-sm)" }}>
                    <div style={{ width: 92, height: 92, flexShrink: 0, overflow: "hidden", background: "var(--panel2)", position: "relative" }}>
                      {img && <img src={imgUrl(img, 280)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                    </div>
                    <div style={{ flex: 1, padding: "14px 18px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 4, minWidth: 0 }}>
                      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 500, lineHeight: 1.15 }}>{bt.label}</div>
                      {bt.desc && <div style={{ fontSize: 13, color: "var(--sub)", lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{bt.desc}</div>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", padding: "0 16px" }}>
                      <ChevronRight size={20} style={{ color: "var(--gold)", flexShrink: 0 }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 2 — add-ons screen (after cut type, or directly if no cut types) */}
        {step === 2 && draft && (!draft.cutTypes || draft.cutTypes.length === 0 || cutPhase === "addons") && (
          <div className="fade-up">
            <div style={{ background: "var(--panel)", borderRadius: 12, padding: "14px 18px", marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 16 }}>{draft.name}{draft.cutTypes && cutType ? ` · ${draft.cutTypes.find((c) => c.id === cutType)?.label}` : ""}</div>
                <button onClick={() => { if (draft.beardTypes && draft.beardTypes.length) { setCutPhase("beard"); setBeardType(null); } else if (draft.cutTypes && draft.cutTypes.length) { setCutPhase("type"); setCutType(null); } else { setDraft(null); setStep(1); } }} style={{ background: "none", color: "var(--sub)", fontSize: 15, textDecoration: "underline", padding: 0, marginTop: 2 }}>Change</button>
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: "var(--gold)" }}>${draft.cutTypes && cutType ? draft.cutTypes.find((c) => c.id === cutType)?.price : draft.price}</div>
            </div>
            {draft.addonGroups.length > 0 && <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 500, marginBottom: 18 }}>Any add-ons?</h2>}
            {draft.addonGroups.length === 0 && <p style={{ color: "var(--sub)", fontSize: 14, marginBottom: 24, fontWeight: 300 }}>No add-ons for this service. Continue when ready.</p>}
            {draft.addonGroups.map((g) => (
              <div key={g.id} style={{ marginBottom: 28 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
                  {business.showAddonPhotos && g.photo && <img src={imgUrl(g.photo, 280)} alt="" style={{ width: 96, height: 96, borderRadius: 10, objectFit: "cover" }} />}
                  <div style={{ fontSize: 17 }}>{g.label}</div>
                </div>
                {g.type === "choice" && g.options.map((o) => { const on = draftAddons[g.id] === o.id; return (
                  <button key={o.id} onClick={() => setDraftAddons({ ...draftAddons, [g.id]: o.id })} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", padding: "14px 0", borderBottom: "1px solid var(--line)", color: "var(--text)", textAlign: "left" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}><span style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${on ? "var(--gold)" : "var(--faint)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{on && <span style={{ width: 11, height: 11, borderRadius: "50%", background: "var(--gold)" }} />}</span><span style={{ fontSize: 15 }}>{o.label}</span></div>
                    <span style={{ color: "var(--sub)", fontSize: 14, textAlign: "right" }}>{o.price > 0 ? `+ $${o.price}` : ""}{o.min > 0 ? <div style={{ fontSize: 14, color: "var(--faint)" }}>+ {o.min}min</div> : null}</span>
                  </button>); })}
                {g.type === "addon" && (
                  <button onClick={() => setDraftAddons({ ...draftAddons, [g.id]: draftAddons[g.id] ? false : true })} style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 14, background: draftAddons[g.id] ? "rgba(176,141,87,0.08)" : "none", border: `1px solid ${draftAddons[g.id] ? "rgba(176,141,87,0.3)" : "var(--border)"}`, borderRadius: 6, padding: 14, color: "var(--text)", textAlign: "left", overflow: "hidden" }}>
                    {business.showAddonPhotos && g.photo && <img src={imgUrl(g.photo, 360)} alt="" style={{ width: 128, height: 128, borderRadius: 16, objectFit: "cover", flexShrink: 0 }} />}
                    <div style={{ flex: 1 }}><div style={{ fontSize: 15, marginBottom: 4 }}>{g.item.name}</div><div style={{ fontSize: 15, color: "var(--sub)", lineHeight: 1.5, fontWeight: 300 }}>{g.item.desc}</div></div>
                    <span style={{ color: "var(--sub)", fontSize: 14, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>+ ${g.item.price} {draftAddons[g.id] ? <Check size={16} style={{ color: "var(--gold)" }} /> : <Plus size={16} />}</span>
                  </button>
                )}
              </div>
            ))}
            <button className="lift" disabled={draft.addonGroups.some((g) => g.type === "choice" && !draftAddons[g.id])} onClick={() => setStep(3)} style={{ width: "100%", marginTop: 8, background: draft.addonGroups.some((g) => g.type === "choice" && !draftAddons[g.id]) ? "var(--border)" : "var(--gold)", color: draft.addonGroups.some((g) => g.type === "choice" && !draftAddons[g.id]) ? "var(--faint)" : "var(--on-gold)", padding: 16, fontSize: 14, letterSpacing: 2, fontWeight: 500, borderRadius: 10 }}>Continue</button>
          </div>
        )}

        {/* STEP 3 — BARBER + TIME, TOGETHER. Each barber's card shows their soonest opening. One tap = who AND when. */}
        {step === 3 && draft && (() => {
          const who = activeMember || matched;
          const ct = cutType && draft.cutTypes ? draft.cutTypes.find((c) => c.id === cutType) : null;
          const bt = beardType && draft.beardTypes ? draft.beardTypes.find((b) => b.id === beardType) : null;
          const draftDur = getDuration(who, draft) + (ct?.min || 0) + (bt?.min || 0);
          const realProviders = providers.filter((p) => p.id !== "anyone");
          // Compute each real barber's soonest opening
          const cards = realProviders.map((p) => ({ p, next: findNextAvailable(p, draftDur) }));
          // Soonest across all barbers (powers "Anyone")
          const anyoneNext = cards
            .filter((c) => c.next)
            .reduce((best, c) => !best || c.next.date < best.next.date || (+c.next.date === +best.next.date && c.next.slot < best.next.slot) ? c : best, null);
          const fmtNext = (next) => {
            const d = next.date;
            const day = relativeDate(d);
            const lbl = day.includes(",") ? day : `${day}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
            return `${lbl} · ${fmtTime(next.slot)}`;
          };
          const commitWith = (prov, next) => {
            const entry = { service: draft, addons: draftAddons, cutType, beardType, provider: prov, forMemberId: activeMember?.id || null, forName: activeMember ? activeMember.name : (matched?.name || newName || "Me") };
            setCart([...cart, entry]);
            setDraft(null); setDraftAddons({}); setCutType(null); setBeardType(null); setCutPhase("type");
            // Multi-person flow: advance to next person, or go to time once everyone's picked
            if (groupPeople.length > 1) {
              if (wizardIdx < groupPeople.length - 1) { setWizardIdx(wizardIdx + 1); setShowWizardIntro(true); }
              else { setStep(6); }
              return;
            }
            // Single-person: skip step 4 (add-another), jump to confirm or calendar
            if (next) { setSelectedDate(next.date); setSlot(next.slot); setStep(7); }
            else { setStep(6); }
          };
          const openCalendarWith = (prov) => {
            const entry = { service: draft, addons: draftAddons, cutType, beardType, provider: prov, forMemberId: activeMember?.id || null, forName: activeMember ? activeMember.name : (matched?.name || newName || "Me") };
            setCart([...cart, entry]);
            setDraft(null); setDraftAddons({}); setCutType(null); setBeardType(null); setCutPhase("type");
            setSelectedDate(null); setSlot(null); setStep(6);
          };
          return (
            <div className="fade-up">
              <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: 500, marginBottom: 10, lineHeight: 1.05, letterSpacing: "-0.3px" }}>Who and when</h2>
              <p style={{ color: "var(--text)", fontSize: 16, marginBottom: 26, fontWeight: 400, lineHeight: 1.5 }}>Tap a barber to lock in their next opening.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {cards.map(({ p, next }) => (
                  <div key={p.id} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
                    <button className="lift" onClick={() => commitWith(p, next)} style={{ width: "100%", display: "flex", alignItems: "stretch", background: "transparent", border: "none", padding: 0, color: "var(--text)", textAlign: "left" }}>
                      <div style={{ width: 92, flexShrink: 0, overflow: "hidden", background: "var(--panel2)", position: "relative" }}>
                        <img src={imgUrl(staffPhoto(p), 280)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      </div>
                      <div style={{ flex: 1, padding: "16px 18px", display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0, gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500, lineHeight: 1.1 }}>{p.name}</div>
                            {p.role && <div style={{ fontSize: 12, color: "var(--faint)", letterSpacing: 1.5, marginTop: 3, textTransform: "uppercase" }}>{p.role}</div>}
                          </div>
                          <ChevronRight size={22} style={{ color: "var(--gold)", flexShrink: 0 }} />
                        </div>
                        {next ? (
                          <div style={{ fontSize: 14, color: "var(--text)", marginTop: 4, display: "flex", alignItems: "center", gap: 7 }}>
                            <Clock size={14} style={{ color: "var(--gold)", flexShrink: 0 }} />
                            <span style={{ fontWeight: 500 }}>{fmtNext(next)}</span>
                          </div>
                        ) : (
                          <div style={{ fontSize: 13.5, color: "var(--faint)", marginTop: 4 }}>No openings in the next 2 weeks</div>
                        )}
                      </div>
                    </button>
                    {next && (
                      <button onClick={() => openCalendarWith(p)} style={{ width: "100%", background: "transparent", border: "none", borderTop: "1px solid var(--line)", padding: "12px 18px", textAlign: "left", color: "var(--sub)", fontSize: 13.5, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span>See other times</span>
                        <span style={{ color: "var(--gold)" }}>→</span>
                      </button>
                    )}
                  </div>
                ))}
                {realProviders.length > 1 && anyoneNext && (
                  <button className="lift" onClick={() => commitWith(anyoneNext.p, anyoneNext.next)} style={{ background: "var(--panel2)", border: "1px dashed var(--border2)", borderRadius: 16, padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--text)", textAlign: "left", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 50, height: 50, borderRadius: "50%", background: "var(--panel)", color: "var(--sub)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "1px solid var(--border)" }}><Users size={22} /></div>
                      <div>
                        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 500, lineHeight: 1.1 }}>Anyone</div>
                        <div style={{ fontSize: 13.5, color: "var(--text)", marginTop: 5, display: "flex", alignItems: "center", gap: 6 }}>
                          <Clock size={13} style={{ color: "var(--gold)" }} />
                          <span style={{ fontWeight: 500 }}>{fmtNext(anyoneNext.next)}</span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={22} style={{ color: "var(--gold)", flexShrink: 0 }} />
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {/* STEP 4 — add another */}
        {step === 4 && (
          <div className="fade-up">
            <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 500, marginBottom: 10, lineHeight: 1.05, letterSpacing: "-0.3px" }}>Your visit so far</h2>
            <p style={{ color: "var(--text)", fontSize: 16, fontWeight: 400, marginBottom: 24, lineHeight: 1.5 }}>Add anything else, or carry on to pick a time.</p>
            <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "8px 18px", marginBottom: 24 }}>
              {cart.map((e, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0", borderBottom: i < cart.length - 1 ? "1px solid var(--line)" : "none", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                    <div style={{ width: 38, height: 38, borderRadius: "50%", background: "color-mix(in srgb, var(--gold) 14%, var(--panel2))", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Check size={18} style={{ color: "var(--gold)" }} /></div>
                    <div><div style={{ fontSize: 15.5, fontWeight: 500 }}>{describeEntry(e)}</div><div style={{ fontSize: 13.5, color: "var(--sub)" }}>{e.forName ? `for ${e.forName.split(" ")[0]} · ` : ""}with {e.provider.name}</div></div>
                  </div>
                  <button onClick={() => setCart(cart.filter((_, idx) => idx !== i))} style={{ background: "none", color: "var(--faint)", fontSize: 13.5 }}>Remove</button>
                </div>
              ))}
            </div>
            {(business?.booking?.allowMultiple !== false || (matched && (matched.family || []).length > 0)) && (
              <button className="lift" onClick={() => { if (matched && (matched.family || []).length > 0) { setShowWhoFor(true); } else { setStep(1); } }} style={{ width: "100%", background: "var(--panel)", border: "1px dashed var(--border2)", color: "var(--gold)", padding: 16, fontSize: 15, fontWeight: 500, borderRadius: 14, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}><Plus size={18} /> Add another{matched && (matched.family || []).length > 0 ? " (you or someone else)" : " service"}</button>
            )}
            <button className="lift" onClick={() => setStep(6)} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 17, fontSize: 14, letterSpacing: 1.5, fontWeight: 600, borderRadius: 14 }}>That's everything — pick a time →</button>
          </div>
        )}

        {/* WELCOME BACK — regular front door: one-tap next available, or pick a different time */}
        {showUsual && matched && (() => {
          const who = activeMember || matched;
          const mine = activeMember
            ? (appts || []).filter((a) => a.familyMemberId === activeMember.id && a.serviceId && a.status !== "block")
            : (appts || []).filter((a) => a.clientId === matched.id && !a.familyMemberId && a.serviceId && a.status !== "block");
          const lastAppt = mine.length ? mine[mine.length - 1] : null;
          const usualSvc = lastAppt ? services.find((s) => s.id === lastAppt.serviceId) : null;
          const usualProv = providers.find((p) => p.id === (lastAppt?.providerId || who.provider)) || providers[1];
          if (!usualSvc) { setShowUsual(false); setStep(1); return null; }
          const dur = getDuration(who, usualSvc);
          const usualLine2 = lastAppt && lastAppt.lineItems && lastAppt.lineItems[0] ? lastAppt.lineItems[0] : null;
          const lastPhoto = (who.gallery && who.gallery.length) ? who.gallery[who.gallery.length - 1].photo : null;
          // Build the cart entry for their usual (used by both actions).
          const usualEntry = { service: usualSvc, addons: usualLine2?.addons || {}, cutType: usualLine2?.cutType || null, beardType: usualLine2?.beardType || null, provider: usualProv };
          // Soonest opening with THEIR barber (any day/time).
          const nextAvail = findNextAvailable(usualProv, dur);
          // Warm rhythm line: how long since their last visit, vs their known cadence.
          let rhythmLine = "Good to have you back.";
          const lastVisitIso = who.lastVisit || (lastAppt && lastAppt.bookedFor);
          if (lastVisitIso) {
            const days = Math.round((Date.now() - new Date(lastVisitIso)) / 86400000);
            const cad = who.cadenceDays || 0;
            if (days >= 0) {
              if (cad && days >= cad - 3) rhythmLine = `It's been ${days < 14 ? days + " days" : Math.round(days / 7) + " weeks"} — you're about due.`;
              else if (days < 14) rhythmLine = `It's been ${days} day${days === 1 ? "" : "s"}.`;
              else rhythmLine = `It's been ${Math.round(days / 7)} weeks.`;
            }
          }
          const nextLabel = nextAvail ? (() => { const d = nextAvail.date; const day = relativeDate(d); const lbl = day.includes(",") ? day : `${day}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; return `${lbl} · ${fmtTime(nextAvail.slot)}`; })() : null;
          return (
            <div className="fade-up">
              <div style={{ fontSize: 12, letterSpacing: 2, color: "var(--gold)", fontWeight: 600, marginBottom: 12 }}>WELCOME BACK</div>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 500, marginBottom: 8, lineHeight: 1.08 }}>Good to see you,<br/>{who.name.split(" ")[0]}.</h2>
              <p style={{ color: "var(--sub)", fontSize: 15, marginBottom: 26, fontWeight: 300, lineHeight: 1.55 }}>{rhythmLine}</p>

              {/* Their usual (service + barber, no duration) with last-cut photo */}
              <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 20, overflow: "hidden", marginBottom: 18, boxShadow: "var(--shadow-sm)" }}>
                {lastPhoto && (
                  <div style={{ width: "100%", height: 150, overflow: "hidden", position: "relative" }}>
                    <img src={imgUrl(lastPhoto, 600)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    <div style={{ position: "absolute", top: 12, left: 12, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", color: "#fff", fontSize: 11, letterSpacing: 1.5, fontWeight: 600, padding: "5px 11px", borderRadius: 20 }}>YOUR LAST CUT</div>
                  </div>
                )}
                <div style={{ padding: "16px 20px" }}>
                  <div style={{ fontSize: 11.5, letterSpacing: 1.5, color: "var(--gold)", fontWeight: 600, marginBottom: 6 }}>YOUR USUAL</div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 23, fontWeight: 500, lineHeight: 1.1 }}>{usualSvc.name}{usualProv && usualProv.id !== "anyone" ? ` with ${usualProv.name}` : ""}</div>
                </div>
              </div>

              {/* Primary action — book the next available with their barber */}
              {nextAvail ? (
                <button className="lift" onClick={() => { setCart([usualEntry]); setSelectedDate(nextAvail.date); setSlot(nextAvail.slot); setCameFromUsual(true); setShowUsual(false); setStep(7); }} style={{ width: "100%", textAlign: "left", background: "var(--gold)", color: "var(--on-gold)", border: "none", borderRadius: 16, padding: "16px 18px", marginBottom: 13, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 15.5, fontWeight: 600 }}>Book next available{usualProv && usualProv.id !== "anyone" ? ` with ${usualProv.name}` : ""}</span>
                    <span style={{ fontSize: 13, opacity: 0.85 }}>{nextLabel}</span>
                  </span>
                  <ChevronRight size={22} style={{ flexShrink: 0 }} />
                </button>
              ) : (
                <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "16px 18px", marginBottom: 13, fontSize: 14, color: "var(--sub)", lineHeight: 1.5 }}>No open times with {usualProv.name} in the next two weeks — pick a different time below.</div>
              )}

              {/* Secondary action — open the calendar */}
              <button className="lift" onClick={() => { setCart([usualEntry]); setCameFromUsual(true); setShowUsual(false); setStep(6); }} style={{ width: "100%", textAlign: "center", background: "transparent", border: "1px solid var(--border2)", color: "var(--text)", borderRadius: 16, padding: "15px", fontSize: 15, fontWeight: 500 }}>Pick a different time</button>

              {/* Quiet third option — browse the full menu (try something new) */}
              <button onClick={() => { setShowUsual(false); setStep(1); }} style={{ width: "100%", textAlign: "center", background: "none", color: "var(--sub)", padding: "16px 0 4px", fontSize: 14, textDecoration: "underline", textUnderlineOffset: 3 }}>Book something different</button>
            </div>
          );
        })()}

        {/* STEP 5 — phone */}
        {step === 5 && !showWhoFor && !showUsual && !showSchedChoice && !showWizardIntro && !showCodeEntry && (
          <div className="fade-up">
            <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 500, marginBottom: 10, lineHeight: 1.05, letterSpacing: "-0.3px" }}>Your number</h2>
            <p style={{ color: "var(--text)", fontSize: 16, marginBottom: 24, fontWeight: 400, lineHeight: 1.5 }}>We'll text you a quick code to confirm it's you.</p>
            <div style={{ position: "relative", marginBottom: 18 }}><Phone size={18} style={{ position: "absolute", left: 16, top: 16, color: "var(--faint)" }} /><input autoFocus value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="503-555-0142" style={{ ...inputStyle, paddingLeft: 46 }} /></div>
            {/* SMS opt-in disclosure — required by carriers (A2P 10DLC) so Twilio's reviewer can verify on the public booking page. */}
            <p style={{ color: "var(--faint)", fontSize: 12.5, marginBottom: 14, lineHeight: 1.5 }}>
              By providing your number, you agree to receive booking confirmations and reminders from {business?.name || "this shop"}. Message and data rates may apply. Reply STOP to opt out. See our <a href="#privacy" style={{ color: "var(--gold)", textDecoration: "underline" }}>privacy policy</a> and <a href="#terms" style={{ color: "var(--gold)", textDecoration: "underline" }}>terms</a>.
            </p>
            <p style={{ color: "var(--faint)", fontSize: 14, marginBottom: 22 }}>Try <span style={{ color: "var(--gold)", cursor: "pointer" }} onClick={() => setPhone("503-555-0142")}>503-555-0142</span> (returning client Marcus).</p>
            <button className="lift" disabled={phone.replace(/\D/g, "").length < 10} onClick={() => { const digits = phone.replace(/\D/g, ""); const found = clients.find((c) => c.phone.replace(/\D/g, "") === digits) || null; if (found && found.blocked) { setBlockedNotice(true); return; } setPendingMatch(found); setCodeEntry(""); setCodeError(false); setShowCodeEntry(true); }} style={{ width: "100%", background: phone.replace(/\D/g, "").length < 10 ? "var(--border)" : "var(--gold)", color: phone.replace(/\D/g, "").length < 10 ? "var(--faint)" : "var(--on-gold)", padding: 16, fontSize: 14, letterSpacing: 2, fontWeight: 500, borderRadius: 10 }}>Text me a code →</button>
          </div>
        )}

        {/* CODE VERIFICATION — confirms the texted code (accepts any 6 digits until Twilio is live) */}
        <Sheet open={blockedNotice} onClose={() => setBlockedNotice(false)} align="top">
          <div style={{ width: 28, height: 1.5, background: "var(--gold)", marginBottom: 12 }} />
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 500, marginBottom: 8 }}>Online booking unavailable</h2>
          <p style={{ fontSize: 15, color: "var(--sub)", lineHeight: 1.55, marginBottom: 20 }}>We're not able to accept new appointments online at this time. Please check back later.</p>
          <button onClick={() => setBlockedNotice(false)} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 15, fontSize: 14, letterSpacing: 1.5, fontWeight: 600, borderRadius: 12, border: "none" }}>OK</button>
        </Sheet>
        {/* Client-type gate — fires when the shop's "Who can book" setting blocks this client type. */}
        <Sheet open={!!clientTypeBlock} onClose={() => setClientTypeBlock(null)} align="top">
          <div style={{ width: 28, height: 1.5, background: "var(--gold)", marginBottom: 12 }} />
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 500, marginBottom: 8 }}>{clientTypeBlock === "returning_only" ? "Returning clients only" : "New clients only"}</h2>
          <p style={{ fontSize: 15, color: "var(--sub)", lineHeight: 1.55, marginBottom: 20 }}>{clientTypeBlock === "returning_only" ? "Online booking at this shop is currently open to returning clients only. Please give us a call to book your first visit." : "Online booking at this shop is currently for new clients only. Please give us a call to book your next visit."}{business?.phones?.[0]?.number ? ` Phone: ${business.phones[0].number}.` : ""}</p>
          <button onClick={() => setClientTypeBlock(null)} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 15, fontSize: 14, letterSpacing: 1.5, fontWeight: 600, borderRadius: 12, border: "none" }}>OK</button>
        </Sheet>
        {step === 5 && showCodeEntry && (
          <div className="fade-up">
            <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 500, marginBottom: 10, lineHeight: 1.05, letterSpacing: "-0.3px" }}>Enter your code</h2>
            <p style={{ color: "var(--text)", fontSize: 16, marginBottom: 8, fontWeight: 400, lineHeight: 1.5 }}>We sent a 6-digit code to <strong>{phone}</strong>.</p>
            <p style={{ color: "var(--faint)", fontSize: 13, marginBottom: 24, fontWeight: 300, fontStyle: "italic" }}>Texting isn't live yet — enter any 6 digits to continue for now.</p>
            <input autoFocus inputMode="numeric" value={codeEntry} onChange={(e) => { setCodeEntry(e.target.value.replace(/\D/g, "").slice(0, 6)); setCodeError(false); }} placeholder="• • • • • •" style={{ ...inputStyle, textAlign: "center", fontSize: 28, letterSpacing: 8, marginBottom: codeError ? 8 : 18 }} />
            {codeError && <p style={{ color: "#c0392b", fontSize: 13.5, marginBottom: 14 }}>Enter all 6 digits.</p>}
            <button className="lift" onClick={() => { if (codeEntry.length < 6) { setCodeError(true); return; } const found = pendingMatch; const ct = business?.booking?.clientType || "all"; if (ct === "returning" && !found) { setShowCodeEntry(false); setClientTypeBlock("returning_only"); return; } if (ct === "new" && found) { setShowCodeEntry(false); setClientTypeBlock("new_only"); return; } setMatched(found); setShowCodeEntry(false); if (found) { setGroupPeople([]); setGroupMode(null); setWizardIdx(0); setShowSchedChoice(false); setShowWizardIntro(false); if (business?.familyBooking?.enabled !== false) { setShowWhoFor(true); } else { setBookingFor("self"); setActiveMember(null); const mine = (appts || []).filter((a) => a.clientId === found.id && !a.familyMemberId && a.serviceId && a.status !== "block"); if (mine.length && business?.bookUsual?.enabled !== false) setShowUsual(true); else setStep(1); } } else { setStep(cart.length === 0 ? 1 : 6); } }} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 16, fontSize: 14, letterSpacing: 2, fontWeight: 500, borderRadius: 10, marginBottom: 12 }}>Verify →</button>
            <button onClick={() => { setShowCodeEntry(false); setCodeEntry(""); }} style={{ width: "100%", background: "none", border: "none", color: "var(--sub)", fontSize: 14.5, padding: 6 }}>Use a different number</button>
          </div>
        )}

        {/* WHO'S IT FOR — shown after a returning client is recognized */}
        {showWhoFor && matched && !addingMember && (() => {
          const isSel = (key) => groupPeople.some((g) => (g.id || "self") === key);
          const toggle = (person) => { const key = person.id || "self"; setGroupPeople((cur) => cur.some((g) => (g.id || "self") === key) ? cur.filter((g) => (g.id || "self") !== key) : [...cur, person]); };
          const selfPerson = { id: null, name: matched.name, isMember: false };
          const continueGroup = () => {
            if (groupPeople.length === 0) return;
            setShowWhoFor(false);
            setWizardIdx(0);
            if (groupPeople.length === 1) {
              // single person → existing flow
              const only = groupPeople[0];
              if (only.id) { setBookingFor("member"); setActiveMember(only.isMember ? (matched.family || []).find((m) => m.id === only.id) : null); }
              else { setBookingFor("self"); setActiveMember(null); }
              const apptsFor = only.id ? (appts || []).filter((a) => a.familyMemberId === only.id && a.serviceId && a.status !== "block") : (appts || []).filter((a) => a.clientId === matched.id && !a.familyMemberId && a.serviceId && a.status !== "block");
              if (apptsFor.length && business?.bookUsual?.enabled !== false) setShowUsual(true); else setStep(1);
            } else {
              // multiple → ask together vs separate
              setShowSchedChoice(true);
            }
          };
          return (
            <div className="fade-up">
              <div style={{ fontSize: 11, letterSpacing: 3, color: "var(--gold)", fontWeight: 600, marginBottom: 14 }}>HI {matched.name.split(" ")[0].toUpperCase()}</div>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 500, marginBottom: 10, lineHeight: 1.05, letterSpacing: "-0.3px" }}>Who are we taking care of?</h2>
              <p style={{ color: "var(--text)", fontSize: 16, marginBottom: 24, fontWeight: 400, lineHeight: 1.5 }}>Pick one or more — tap everyone you're booking today.</p>
              {[selfPerson, ...(matched.family || []).map((m) => ({ id: m.id, name: m.name, note: m.note, isMember: true }))].map((person) => {
                const key = person.id || "self"; const on = isSel(key);
                return (
                  <button key={key} className="lift" onClick={() => toggle(person)} style={{ width: "100%", background: on ? "color-mix(in srgb, var(--gold) 14%, var(--panel))" : "var(--panel)", color: "var(--text)", padding: "18px", fontSize: 16, borderRadius: 14, border: `1.5px solid ${on ? "var(--gold)" : "var(--border)"}`, marginBottom: 11, textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 17 }}>{person.id ? person.name : "Myself"}</span>
                      <span style={{ fontSize: 13, color: "var(--sub)", fontWeight: 300 }}>{person.id ? (person.note || "") : matched.name}</span>
                    </span>
                    <span style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, border: `2px solid ${on ? "var(--gold)" : "var(--border2)"}`, background: on ? "var(--gold)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{on && <Check size={14} style={{ color: "var(--on-gold)" }} />}</span>
                  </button>
                );
              })}
              <button className="lift" onClick={() => { setNewMemberName(""); setNewMemberNote(""); setAddingMember(true); }} style={{ width: "100%", background: "transparent", color: "var(--gold)", padding: "18px", fontSize: 16, borderRadius: 14, border: "1px dashed var(--border2)", textAlign: "left", display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
                <Plus size={18} /> <span>Someone new</span>
              </button>
              <button className="lift" disabled={groupPeople.length === 0} onClick={continueGroup} style={{ width: "100%", background: groupPeople.length ? "var(--gold)" : "var(--border)", color: groupPeople.length ? "var(--on-gold)" : "var(--faint)", padding: 16, fontSize: 14, letterSpacing: 2, fontWeight: 600, borderRadius: 10 }}>
                {groupPeople.length > 1 ? `CONTINUE — ${groupPeople.length} PEOPLE →` : "CONTINUE →"}
              </button>
            </div>
          );
        })()}

        {/* ADD A FAMILY MEMBER */}
        {showWhoFor && matched && addingMember && (
          <div className="fade-up">
            <div style={{ fontSize: 11, letterSpacing: 3, color: "var(--gold)", fontWeight: 600, marginBottom: 14 }}>NEW PERSON</div>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 500, marginBottom: 10, lineHeight: 1.05, letterSpacing: "-0.3px" }}>Who are we adding?</h2>
            <p style={{ color: "var(--text)", fontSize: 16, marginBottom: 22, fontWeight: 400, lineHeight: 1.5 }}>They'll be saved under your account for next time.</p>
            <label style={{ fontSize: 13, color: "var(--faint)", display: "block", marginBottom: 6 }}>First name</label>
            <input autoFocus value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} placeholder="e.g. Leo" style={{ ...inputStyle, marginBottom: 16 }} />
            <label style={{ fontSize: 13, color: "var(--faint)", display: "block", marginBottom: 6 }}>Note (optional)</label>
            <input value={newMemberNote} onChange={(e) => setNewMemberNote(e.target.value)} placeholder="e.g. son, age 8" style={{ ...inputStyle, marginBottom: 22 }} />
            <button className="lift" disabled={!newMemberName.trim()} onClick={() => {
              const member = { id: "fm" + Date.now(), name: newMemberName.trim(), note: newMemberNote.trim(), customDurations: {}, gallery: [], timeline: [] };
              setClients(clients.map((c) => c.id === matched.id ? { ...c, family: [...(c.family || []), member] } : c));
              setMatched({ ...matched, family: [...(matched.family || []), member] });
              setGroupPeople((cur) => [...cur, { id: member.id, name: member.name, note: member.note, isMember: true }]);
              setAddingMember(false); // back to the multi-select, now with this person added & selected
            }} style={{ width: "100%", background: newMemberName.trim() ? "var(--gold)" : "var(--border)", color: newMemberName.trim() ? "var(--on-gold)" : "var(--faint)", padding: 16, fontSize: 14, letterSpacing: 2, fontWeight: 500, borderRadius: 10, border: "none" }}>ADD &amp; CONTINUE →</button>
          </div>
        )}

        {/* TOGETHER vs SEPARATE — only for multiple people */}
        {showSchedChoice && (
          <div className="fade-up">
            <div style={{ fontSize: 11, letterSpacing: 3, color: "var(--gold)", fontWeight: 600, marginBottom: 14 }}>{groupPeople.map((p) => (p.id ? p.name : "You")).map((n) => n.split(" ")[0]).join(" & ").toUpperCase()}</div>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 500, marginBottom: 10, lineHeight: 1.05, letterSpacing: "-0.3px" }}>How do you want to book?</h2>
            <p style={{ color: "var(--text)", fontSize: 16, marginBottom: 24, fontWeight: 400, lineHeight: 1.5 }}>We can get everyone in on the same visit, or just find the soonest opening for each.</p>
            <button className="lift" onClick={() => { setGroupMode("together"); setShowSchedChoice(false); setShowWizardIntro(true); setWizardIdx(0); }} style={{ width: "100%", background: "var(--panel)", color: "var(--text)", padding: "20px 18px", fontSize: 16, borderRadius: 14, border: "1px solid var(--border)", marginBottom: 13, textAlign: "left", display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 17, fontWeight: 500 }}>Together — same visit</span>
              <span style={{ fontSize: 13.5, color: "var(--sub)", fontWeight: 300, lineHeight: 1.45 }}>Same day, at the same time with different barbers — or back-to-back if needed.</span>
            </button>
            <button className="lift" onClick={() => { setGroupMode("separate"); setShowSchedChoice(false); setShowWizardIntro(true); setWizardIdx(0); }} style={{ width: "100%", background: "var(--panel)", color: "var(--text)", padding: "20px 18px", fontSize: 16, borderRadius: 14, border: "1px solid var(--border)", textAlign: "left", display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 17, fontWeight: 500 }}>Separate — soonest for each</span>
              <span style={{ fontSize: 13.5, color: "var(--sub)", fontWeight: 300, lineHeight: 1.45 }}>Book each person their own day &amp; time, even if that's different days.</span>
            </button>
          </div>
        )}

        {/* WIZARD INTRO — "Let's start with Marcus" then their usual / something else */}
        {showWizardIntro && groupPeople[wizardIdx] && (() => {
          const person = groupPeople[wizardIdx];
          const fm = person.id ? (matched.family || []).find((m) => m.id === person.id) : null;
          const who = person.id ? fm : matched;
          const theirAppts = person.id
            ? (appts || []).filter((a) => a.familyMemberId === person.id && a.serviceId && a.status !== "block")
            : (appts || []).filter((a) => a.clientId === matched.id && !a.familyMemberId && a.serviceId && a.status !== "block");
          const lastAppt = theirAppts.length ? theirAppts[theirAppts.length - 1] : null;
          const usualSvc = lastAppt ? services.find((s) => s.id === lastAppt.serviceId) : null;
          const usualProv = lastAppt ? (providers.find((p) => p.id === lastAppt.providerId) || providers[1]) : (providers.find((p) => p.id === (who?.provider)) || providers[1]);
          const first = person.id ? person.name.split(" ")[0] : matched.name.split(" ")[0];
          const isFirst = wizardIdx === 0;
          const goPickService = () => { if (person.id) { setBookingFor("member"); setActiveMember(fm); } else { setBookingFor("self"); setActiveMember(null); } setShowWizardIntro(false); setStep(1); };
          // Reconstruct the FULL usual from the last appointment's saved detail
          const usualLine = lastAppt && lastAppt.lineItems && lastAppt.lineItems[0] ? lastAppt.lineItems[0] : null;
          const usualCutType = usualLine?.cutType || null;
          const usualBeardType = usualLine?.beardType || null;
          const usualAddons = usualLine?.addons || {};
          // Build a readable list of what's included
          const usualDetails = [];
          if (usualSvc) {
            if (usualSvc.cutTypes && usualCutType) { const ct = usualSvc.cutTypes.find((c) => c.id === usualCutType); if (ct) usualDetails.push({ label: ct.label, desc: ct.desc }); }
            if (usualSvc.beardTypes && usualBeardType) { const bt = usualSvc.beardTypes.find((b) => b.id === usualBeardType); if (bt) usualDetails.push({ label: bt.label, desc: bt.desc }); }
            (usualSvc.addonGroups || []).forEach((g) => { const sel = usualAddons[g.id]; if (g.type === "choice" && sel) { const o = g.options.find((x) => x.id === sel); if (o) usualDetails.push({ label: o.label, desc: o.desc }); } if (g.type === "addon" && sel) usualDetails.push({ label: g.item.name, desc: g.item.desc }); });
          }
          const advanceAfterAdd = () => { if (wizardIdx < groupPeople.length - 1) { setWizardIdx(wizardIdx + 1); setExpandUsual(false); } else { setShowWizardIntro(false); setStep(6); } };
          const bookUsual = () => {
            if (!usualSvc) { goPickService(); return; }
            if (person.id) { setBookingFor("member"); setActiveMember(fm); } else { setBookingFor("self"); setActiveMember(null); }
            setCart((cur) => [...cur, { service: usualSvc, addons: usualAddons, cutType: usualCutType, beardType: usualBeardType, provider: usualProv, forMemberId: person.id || null, forName: person.id ? person.name : matched.name }]);
            advanceAfterAdd();
          };
          const tweakUsual = () => {
            // Load the usual into the editor so they can drop/change add-ons, then land on the add-on step
            if (person.id) { setBookingFor("member"); setActiveMember(fm); } else { setBookingFor("self"); setActiveMember(null); }
            setDraft(usualSvc); setDraftAddons({ ...usualAddons }); setCutType(usualCutType); setBeardType(usualBeardType);
            setCutPhase("addons"); setShowWizardIntro(false); setExpandUsual(false); setStep(2);
          };
          return (
            <div className="fade-up">
              <div style={{ fontSize: 11, letterSpacing: 3, color: "var(--gold)", fontWeight: 600, marginBottom: 14 }}>{isFirst ? "LET'S START WITH" : "NEXT UP"} · {first.toUpperCase()}</div>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 500, marginBottom: 10, lineHeight: 1.05, letterSpacing: "-0.3px" }}>{isFirst ? `Let's start with ${first}` : `Now let's get ${first} taken care of`}</h2>
              <p style={{ color: "var(--text)", fontSize: 16, marginBottom: 24, fontWeight: 400, lineHeight: 1.5 }}>Person {wizardIdx + 1} of {groupPeople.length}.</p>
              {usualSvc && (
                <div style={{ border: "1.5px solid var(--gold)", borderRadius: 16, overflow: "hidden", marginBottom: 13 }}>
                  <button onClick={() => setExpandUsual(!expandUsual)} style={{ width: "100%", background: "color-mix(in srgb, var(--gold) 10%, var(--panel))", color: "var(--text)", padding: "16px 18px", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, border: "none" }}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 17, fontWeight: 500 }}>{first}'s usual</span>
                      <span style={{ fontSize: 13.5, color: "var(--sub)", fontWeight: 300 }}>{usualSvc.name} · {getDuration(who, usualSvc)} min{usualProv && usualProv.id !== "anyone" ? ` · with ${usualProv.name}` : ""}</span>
                    </span>
                    <ChevronRight size={18} style={{ color: "var(--gold)", flexShrink: 0, transform: expandUsual ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
                  </button>
                  {expandUsual && (
                    <div style={{ padding: "4px 18px 16px", background: "var(--panel)" }}>
                      {usualDetails.length > 0 ? (
                        <div style={{ display: "grid", gap: 10, margin: "12px 0 16px" }}>
                          {usualDetails.map((d, i) => (
                            <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                              <Check size={15} style={{ color: "var(--gold)", marginTop: 3, flexShrink: 0 }} />
                              <div><div style={{ fontSize: 14.5 }}>{d.label}</div>{d.desc && <div style={{ fontSize: 13, color: "var(--sub)", lineHeight: 1.45 }}>{d.desc}</div>}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ fontSize: 13.5, color: "var(--sub)", margin: "12px 0 16px", lineHeight: 1.5 }}>Just the {usualSvc.name.toLowerCase()} — no extras last time.</p>
                      )}
                      <button className="lift" onClick={bookUsual} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 14, fontSize: 14, letterSpacing: 1.5, fontWeight: 600, borderRadius: 10, border: "none", marginBottom: 9 }}>Book this →</button>
                      <button onClick={tweakUsual} style={{ width: "100%", background: "transparent", color: "var(--gold)", padding: 12, fontSize: 14.5, border: "1px solid var(--border2)", borderRadius: 10 }}>Tweak it — change add-ons</button>
                    </div>
                  )}
                </div>
              )}
              <button className="lift" onClick={goPickService} style={{ width: "100%", background: "var(--panel)", color: "var(--text)", padding: "18px", fontSize: 16, borderRadius: 14, border: "1px solid var(--border)", textAlign: "left", display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 17 }}>{usualSvc ? "Something else" : "Pick a service"}</span>
                <span style={{ fontSize: 13.5, color: "var(--sub)", fontWeight: 300 }}>Browse the full menu</span>
              </button>
            </div>
          );
        })()}

        {/* STEP 6 — date/time + waitlist */}
        {step === 6 && !showUsual && (
          <div className="fade-up">
            {matched && matched.lastVisit && business.overdueBuffer && business.overdueBuffer.enabled !== false && (() => {
              const ob = business.overdueBuffer;
              const weeksAgo = (Date.now() - new Date(matched.lastVisit)) / (7 * 86400000);
              if (weeksAgo < (ob.thresholdWeeks || 8)) return null;
              return (
                <div style={{ background: "rgba(122,158,159,0.10)", border: "1px solid rgba(122,158,159,0.30)", borderRadius: 12, padding: "14px 16px", marginBottom: 20, display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <Clock size={18} style={{ color: "#5E8C8C", flexShrink: 0, marginTop: 2 }} />
                  <div style={{ fontSize: 14.5, lineHeight: 1.5 }}>
                    {ob.message || "Since it's been a while, we've added a little extra time."}
                    <div style={{ fontSize: 13, color: "var(--sub)", marginTop: 6 }}>+{ob.addMinutes || 10} min added{ob.charge ? ` · +$${ob.chargeAmount || 5}` : " · no extra charge"}</div>
                  </div>
                </div>
              );
            })()}
            <div style={{ marginBottom: 18 }}>
              <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 500, marginBottom: 10, lineHeight: 1.05, letterSpacing: "-0.3px" }}>Let's find a time</h2>
              <p style={{ color: "var(--text)", fontSize: 16, fontWeight: 400, lineHeight: 1.5 }}>Grab the soonest opening, or pick a day that works for you.</p>
            </div>
            {/* soonest available shortcut */}
            {(() => {
              const firstOpen = dateOptions.find((d) => freeSlotsFor(provider && provider.id !== "anyone" ? provider : (providers.find((p) => p.id === "dan") || providers[1]), d, cartMin || 30, 15).length > 0);
              if (!firstOpen) return null;
              const isFirstToday = firstOpen.toDateString() === new Date().toDateString();
              const already = selectedDate && firstOpen.toDateString() === selectedDate.toDateString();
              return (
                <button className="lift" onClick={() => { setSelectedDate(firstOpen); setSlot(null); }} style={{ width: "100%", textAlign: "left", background: already ? "color-mix(in srgb, var(--gold) 10%, var(--panel))" : "var(--panel)", border: `1.5px solid ${already ? "var(--gold)" : "var(--border)"}`, borderRadius: 14, padding: "15px 17px", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 11.5, letterSpacing: 1.5, color: "var(--gold)", fontWeight: 600 }}>SOONEST OPENING</span>
                    <span style={{ fontSize: 16.5, fontWeight: 500 }}>{DAYS[firstOpen.getDay()]}, {MONTHS[firstOpen.getMonth()]} {firstOpen.getDate()}</span>
                    <span style={{ fontSize: 13, color: "var(--sub)" }}>{isFirstToday ? "Today" : daysFromNow(firstOpen)}</span>
                  </span>
                  <ChevronRight size={20} style={{ color: "var(--gold)", flexShrink: 0 }} />
                </button>
              );
            })()}
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12, fontFamily: FONT_DISPLAY }}>Or pick another day</div>
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, marginBottom: 22 }}>
              {dateOptions.map((d, i) => {
                const on = selectedDate && d.toDateString() === selectedDate.toDateString();
                const isToday = d.toDateString() === new Date().toDateString();
                return (
                  <button key={i} onClick={() => { setSelectedDate(d); setSlot(null); }} style={{ flexShrink: 0, width: 60, padding: "10px 0", borderRadius: 12, background: on ? "var(--gold)" : "var(--panel2)", border: "1px solid", borderColor: on ? "var(--gold)" : (isToday ? "var(--gold)" : "var(--border)"), color: on ? "var(--on-gold)" : "var(--text)", textAlign: "center" }}>
                    <div style={{ fontSize: 12, letterSpacing: 1, opacity: 0.7 }}>{DAYS[d.getDay()].slice(0, 3).toUpperCase()}</div>
                    {isToday
                      ? <div style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 600, color: on ? "var(--on-gold)" : "var(--gold)", lineHeight: "24px" }}>Today</div>
                      : <div style={{ fontFamily: FONT_DISPLAY, fontSize: 21, lineHeight: "24px" }}>{d.getDate()}</div>}
                    <div style={{ fontSize: 10.5, letterSpacing: 0.5, opacity: 0.6, marginTop: 1 }}>{MONTHS[d.getMonth()].slice(0, 3)}</div>
                  </button>
                );
              })}
            </div>
            {selectedDate && !dateIsFull && (<>
              {/* Selected day as a clean heading — keeps day-of-week + date + days-away phrasing for clarity */}
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>{DAYS[selectedDate.getDay()]}, {MONTHS[selectedDate.getMonth()]} {selectedDate.getDate()}</div>
              <div style={{ fontSize: 13.5, color: "var(--gold)", fontWeight: 500, marginBottom: 14 }}>{daysFromNow(selectedDate)}</div>
              {isMultiPerson && (<div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 12, lineHeight: 1.5, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 13px" }}>Booking for {people.map((p) => p.name.split(" ")[0]).join(" & ")}. {groupSlots && groupSlots.sameTime.length ? "Times shown fit everyone at once." : "No same-time openings — times shown run back-to-back."}</div>)}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 26 }}>{openSlots.map((t) => (<button key={t} className="lift" onClick={() => setSlot(t)} style={{ background: slot === t ? "var(--gold)" : "var(--panel2)", border: "1px solid", borderColor: slot === t ? "var(--gold)" : "var(--border)", borderRadius: 10, padding: "13px 4px", color: slot === t ? "var(--on-gold)" : "var(--text)", fontSize: 14 }}>{fmtTime(t)}</button>))}</div>
              {slot != null && <button className="lift" onClick={() => setStep(7)} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 16, fontSize: 14, letterSpacing: 2, fontWeight: 500, borderRadius: 10, marginBottom: 24 }}>Continue →</button>}
            </>)}

            {/* date is fully booked → waitlist path */}
            {dateIsFull && !waitlistDone && (
              <div className="fade-up" style={{ marginBottom: 8 }}>
                <div style={{ background: "rgba(176,141,87,0.08)", border: "1px solid rgba(176,141,87,0.25)", borderRadius: 6, padding: "16px 18px", marginBottom: 20, display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <AlertCircle size={18} style={{ color: "var(--gold)", flexShrink: 0, marginTop: 1 }} />
                  <div style={{ fontSize: 14, lineHeight: 1.5 }}><strong>{relativeDate(selectedDate)}</strong> is fully booked. Join the waitlist and we'll text you the moment something opens.</div>
                </div>

                {!showWaitlist ? (
                  <button className="lift" onClick={() => { setShowWaitlist(true); setWlName(matched ? matched.name : ""); setWlDay(relativeDate(selectedDate).includes(",") ? relativeDate(selectedDate) : `${relativeDate(selectedDate)}, ${MONTHS[selectedDate.getMonth()]} ${selectedDate.getDate()}`); setWlService(cart.map(describeEntry).join(", ")); }} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 16, fontSize: 14, letterSpacing: 2, fontWeight: 500, borderRadius: 10 }}>Join the waitlist →</button>
                ) : (
                  <div style={{ background: "var(--panel)", borderRadius: 8, padding: 20, textAlign: "left" }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, marginBottom: 16 }}>Join the waitlist</div>

                    <label style={{ fontSize: 13, color: "var(--faint)", display: "block", marginBottom: 6 }}>Your name</label>
                    <input value={wlName} onChange={(e) => setWlName(e.target.value)} placeholder="First and last name" style={{ ...inputStyle, marginBottom: 16 }} />

                    <label style={{ fontSize: 13, color: "var(--faint)", display: "block", marginBottom: 6 }}>Phone</label>
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" style={{ ...inputStyle, marginBottom: 16 }} />

                    <label style={{ fontSize: 13, color: "var(--faint)", display: "block", marginBottom: 6 }}>Preferred day</label>
                    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 16 }}>
                      {dateOptions.slice(0, 10).map((d, i) => { const lbl = relativeDate(d).includes(",") ? relativeDate(d) : `${relativeDate(d)}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; const on = wlDay === lbl; return (
                        <button key={i} onClick={() => setWlDay(lbl)} style={{ flexShrink: 0, minWidth: 52, padding: "10px 0", borderRadius: 8, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "var(--gold)" : "transparent", color: on ? "var(--on-gold)" : "var(--text)", textAlign: "center" }}>
                          <div style={{ fontSize: 12, letterSpacing: 1, opacity: 0.7 }}>{["SUN","MON","TUE","WED","THU","FRI","SAT"][d.getDay()]}</div>
                          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18 }}>{d.getDate()}</div>
                        </button>
                      ); })}
                    </div>

                    <label style={{ fontSize: 13, color: "var(--faint)", display: "block", marginBottom: 6 }}>Time of day that works</label>
                    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                      {(() => {
                        const isToday = selectedDate && selectedDate.toDateString() === new Date().toDateString();
                        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
                        // each window: [id, label, sub, endMinute] — hide if today and the window has already ended
                        const windows = [["early", "Early", "Open–11a", 11 * 60], ["midday", "Midday", "11a–2p", 14 * 60], ["afternoon", "Afternoon", "2p–close", 24 * 60]];
                        const avail = windows.filter(([id, label, sub, end]) => !isToday || nowMin < end);
                        if (avail.length === 0) return <div style={{ fontSize: 13.5, color: "var(--sub)", lineHeight: 1.5 }}>Today's about wrapped up — try picking another day above.</div>;
                        return avail.map(([id, label, sub]) => { const on = wlWhen === id; return (
                          <button key={id} onClick={() => setWlWhen(id)} style={{ flex: 1, padding: "12px 6px", borderRadius: 8, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "rgba(176,141,87,0.12)" : "transparent", color: "var(--text)" }}>
                            <div style={{ fontSize: 14, fontWeight: on ? 600 : 400 }}>{label}</div>
                            <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>{sub}</div>
                          </button>
                        ); });
                      })()}
                    </div>

                    <label style={{ fontSize: 13, color: "var(--faint)", display: "block", marginBottom: 6 }}>Service</label>
                    <div style={{ position: "relative", marginBottom: 16 }}>
                      <select value={wlService} onChange={(e) => setWlService(e.target.value)} style={{ width: "100%", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: "13px 40px 13px 15px", color: "var(--text)", fontSize: 15, fontFamily: FONT_BODY, appearance: "none", WebkitAppearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 15px center" }}>
                        {cart.length > 0 && <option value={cart.map(describeEntry).join(", ")}>{cart.map(describeEntry).join(", ")}</option>}
                        {services.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                      </select>
                      <ChevronRight size={16} style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%) rotate(90deg)", color: "var(--faint)", pointerEvents: "none" }} />
                    </div>

                    {(business?.waitlist?.askAnyProvider !== false) && provider.name !== "Anyone" && (
                      <>
                        <label style={{ fontSize: 13, color: "var(--faint)", display: "block", marginBottom: 8 }}>If a spot opens with another barber, want it?</label>
                        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                          <button onClick={() => setWlAnyProvider(false)} style={{ flex: 1, padding: "13px 8px", borderRadius: 10, border: `1.5px solid ${!wlAnyProvider ? "var(--gold)" : "var(--border)"}`, background: !wlAnyProvider ? "color-mix(in srgb, var(--gold) 10%, var(--panel))" : "transparent", color: "var(--text)", fontSize: 14, fontWeight: !wlAnyProvider ? 600 : 400 }}>Only {provider.name}</button>
                          <button onClick={() => setWlAnyProvider(true)} style={{ flex: 1, padding: "13px 8px", borderRadius: 10, border: `1.5px solid ${wlAnyProvider ? "var(--gold)" : "var(--border)"}`, background: wlAnyProvider ? "color-mix(in srgb, var(--gold) 10%, var(--panel))" : "transparent", color: "var(--text)", fontSize: 14, fontWeight: wlAnyProvider ? 600 : 400 }}>Anyone available</button>
                        </div>
                      </>
                    )}

                    {(business?.waitlist?.photoNudge !== false) && (<>
                    <div style={{ background: "color-mix(in srgb, var(--gold) 9%, var(--panel))", border: "1px solid rgba(176,141,87,0.3)", borderRadius: 12, padding: "13px 15px", marginBottom: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <Camera size={17} style={{ color: "var(--gold)", flexShrink: 0, marginTop: 2 }} />
                      <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--text2)" }}>This day's full — but add a quick photo of what you're after and {provider.name === "Anyone" ? "the team" : provider.name} can see if it's a fit to squeeze you in. A quick touch-up is easier to slot than a big change.</div>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>{[0, 1, 2].map((i) => (<div key={i} style={{ flex: 1, aspectRatio: "1", borderRadius: 6, border: "1px dashed var(--border2)", display: "flex", alignItems: "center", justifyContent: "center", background: i < wlPhotos ? "rgba(176,141,87,0.12)" : "transparent" }}>{i < wlPhotos ? <Check size={18} style={{ color: "var(--gold)" }} /> : <Camera size={16} style={{ color: "var(--faint)" }} />}</div>))}</div>
                    <button onClick={() => setWlPhotos(Math.min(3, wlPhotos + 1))} disabled={wlPhotos >= 3} style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", color: wlPhotos >= 3 ? "var(--faint)" : "var(--text)", padding: 11, fontSize: 13, letterSpacing: 1, borderRadius: 6, marginBottom: 20 }}>{wlPhotos >= 3 ? "MAXIMUM REACHED" : `ADD PHOTO (${wlPhotos}/3)`}</button>
                    </>)}

                    <button className="lift" disabled={!wlName || phone.replace(/\D/g, "").length < 10 || !wlWhen} onClick={() => {
                      const ready = wlName && phone.replace(/\D/g, "").length >= 10 && wlWhen;
                      if (!ready) return;
                      setWaitlist([...waitlist, { name: wlName, phone, provider: provider.name, anyProvider: provider.name === "Anyone" ? true : wlAnyProvider, day: wlDay, when: wlWhen, service: wlService || cart.map(describeEntry).join(", "), photos: wlPhotos, at: new Date().toLocaleString() }]);
                      setWaitlistDone(true); setShowWaitlist(false);
                    }} style={{ width: "100%", background: (wlName && phone.replace(/\D/g, "").length >= 10 && wlWhen) ? "var(--gold)" : "var(--border)", color: (wlName && phone.replace(/\D/g, "").length >= 10 && wlWhen) ? "var(--on-gold)" : "var(--faint)", padding: 15, fontSize: 14, letterSpacing: 1, fontWeight: 600, borderRadius: 6 }}>Add me to the waitlist</button>
                  </div>
                )}
              </div>
            )}

            {waitlistDone && <div style={{ background: "var(--panel)", borderRadius: 8, padding: 24, textAlign: "center" }}><CheckCircle2 size={32} style={{ color: "#7A9E9F", marginBottom: 12 }} /><div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, marginBottom: 6 }}>You're on the list</div><p style={{ color: "var(--sub)", fontSize: 14, lineHeight: 1.5 }}>We'll text {wlName ? wlName.split(" ")[0] : "you"} the moment a {wlWhen || ""} slot opens up. No need to check back.</p></div>}

            {!dateIsFull && !waitlistDone && (
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 22, textAlign: "center", marginTop: 8 }}>
                <p style={{ color: "var(--sub)", fontSize: 14 }}>Fully booked days show a waitlist option here.</p>
              </div>
            )}
          </div>
        )}

        {/* STEP 7 — contact + EDITABLE policy */}
        {step === 7 && !showUsual && (
          <div className="fade-up">
            <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 500, marginBottom: 10, lineHeight: 1.05, letterSpacing: "-0.3px" }}>{matched ? "Almost there" : "Last thing — your details"}</h2>
            <p style={{ color: "var(--text)", fontSize: 16, marginBottom: 24, fontWeight: 400, lineHeight: 1.5 }}>{matched ? "Quick check before we lock this in." : "We'll text you a reminder before your visit."}</p>

            {/* Editorial summary card with gold accent — the booking at a glance */}
            <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 18, padding: "20px 22px", marginBottom: 22, boxShadow: "var(--shadow-sm)" }}>
              <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--gold)", fontWeight: 600, marginBottom: 10 }}>YOUR APPOINTMENT</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 500, lineHeight: 1.1, marginBottom: 6 }}>{relativeDate(selectedDate)}{relativeDate(selectedDate).includes(",") ? "" : `, ${MONTHS[selectedDate.getMonth()]} ${selectedDate.getDate()}`}</div>
              <div style={{ fontSize: 15.5, color: "var(--text)", marginBottom: 14, lineHeight: 1.4 }}>{fmtTime(slot)} · with {provider.name}</div>
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                {cart.map((e, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: i < cart.length - 1 ? 8 : 0, gap: 10 }}>
                    <div style={{ fontSize: 14.5, color: "var(--text)", lineHeight: 1.4 }}>{describeEntry(e)}</div>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                  <span style={{ fontSize: 13, letterSpacing: 1.5, color: "var(--faint)", fontWeight: 500 }}>TOTAL</span>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 24, color: "var(--gold)", fontWeight: 500 }}>${cartPrice}</span>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--faint)", fontWeight: 600, marginBottom: 12 }}>{matched ? "CONFIRM YOUR INFO" : "YOUR DETAILS"}</div>
            <div style={{ display: "grid", gap: 11, marginBottom: 20 }}>
              <div style={{ display: "flex", gap: 11 }}>
                <input placeholder="First name" style={{ ...inputStyle, flex: 1 }} value={newFirst} onChange={(e) => setNewFirst(e.target.value)} />
                <input placeholder="Last name" style={{ ...inputStyle, flex: 1 }} value={newLast} onChange={(e) => setNewLast(e.target.value)} />
              </div>
              <input placeholder="Email" type="email" style={inputStyle} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              <input placeholder="Phone number" type="tel" style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>

            {/* photo upload — controlled by business.bookingPhotos.mode (off/optional/required) */}
            {business?.bookingPhotos?.mode !== "off" && (
            <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "18px 18px", marginBottom: 18 }}>
              <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--gold)", fontWeight: 600, marginBottom: 6 }}>PHOTOS {business?.bookingPhotos?.mode === "required" ? "· REQUIRED" : "· OPTIONAL"}</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 500, lineHeight: 1.15, marginBottom: 4 }}>Help us nail it</div>
              <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.5, marginBottom: 14 }}>Up to 3 — a style you want, how your hair looks now, or anything that helps {provider.name === "Anyone" ? "your barber" : provider.name}.</p>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>{[0, 1, 2].map((i) => (<div key={i} style={{ flex: 1, aspectRatio: "1", borderRadius: 14, border: `1px dashed ${i < photos ? "var(--gold)" : "var(--border2)"}`, display: "flex", alignItems: "center", justifyContent: "center", background: i < photos ? "color-mix(in srgb, var(--gold) 12%, transparent)" : "transparent" }}>{i < photos ? <Check size={20} style={{ color: "var(--gold)" }} /> : <Camera size={18} style={{ color: "var(--faint)" }} />}</div>))}</div>
              <button onClick={() => setPhotos(Math.min(3, photos + 1))} disabled={photos >= 3} style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", color: photos >= 3 ? "var(--faint)" : "var(--text)", padding: 12, fontSize: 13.5, letterSpacing: 1.5, fontWeight: 500, borderRadius: 11 }}>{photos >= 3 ? "MAXIMUM REACHED" : `ADD PHOTO (${photos}/3)`}</button>
            </div>
            )}

            {/* Policy + agreement */}
            <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
              <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--faint)", fontWeight: 600, marginBottom: 8 }}>CANCELLATION POLICY</div>
              <p style={{ fontSize: 13.5, color: "var(--sub)", lineHeight: 1.55 }}>{business.policy}</p>
            </div>
            <button onClick={() => setAgreed(!agreed)} style={{ display: "flex", alignItems: "center", gap: 14, background: "none", color: "var(--text)", marginBottom: 26, fontSize: 14.5, padding: "4px 2px", width: "100%", textAlign: "left" }}>
              <span style={{ width: 44, height: 26, borderRadius: 13, background: agreed ? "var(--gold)" : "var(--border)", position: "relative", flexShrink: 0 }}><span style={{ position: "absolute", top: 3, left: agreed ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} /></span>
              <span>I agree to the cancellation policy</span>
            </button>

            <button className="lift" disabled={!agreed || !newFirst.trim() || !newLast.trim() || !newEmail.trim() || phone.replace(/\D/g, "").length < 10} onClick={() => {
              const digits = (s) => (s || "").replace(/\D/g, "");
              // Conflict only if matched and they CHANGED an existing value (not just adding a missing email).
              const phoneChanged = !!matched && digits(phone) !== digits(matched.phone);
              const emailChanged = !!matched && !!(matched.email && matched.email.trim()) && newEmail.trim() !== matched.email.trim();
              if (phoneChanged || emailChanged) {
                setKeepPhone("new"); setKeepEmail("new");
                setContactConfirm({ phone: phoneChanged, email: emailChanged });
                return;
              }
              commitBooking(phone, newEmail);
            }} style={{ width: "100%", background: (agreed && newFirst.trim() && newLast.trim() && newEmail.trim() && phone.replace(/\D/g, "").length >= 10) ? "var(--gold)" : "var(--border)", color: (agreed && newFirst.trim() && newLast.trim() && newEmail.trim() && phone.replace(/\D/g, "").length >= 10) ? "var(--on-gold)" : "var(--faint)", padding: 17, fontSize: 14, letterSpacing: 2.5, fontWeight: 600, borderRadius: 14, boxShadow: (agreed && newFirst.trim() && newLast.trim() && newEmail.trim() && phone.replace(/\D/g, "").length >= 10) ? "var(--shadow-md)" : "none" }}>LOCK IT IN</button>

            {/* Contact-info conflict — only opens when matched and the user changed an existing phone or email. */}
            <Sheet open={!!contactConfirm && !!matched} onClose={() => setContactConfirm(null)} align="top" maxWidth={460}>
              <div style={{ padding: "20px 4px 12px" }}>
                <div style={{ width: 28, height: 1.5, background: "var(--gold)", marginBottom: 12 }} />
                <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 500, marginBottom: 6 }}>Confirm your info</h2>
                <p style={{ color: "var(--sub)", fontSize: 14.5, lineHeight: 1.5, marginBottom: 22 }}>
                  Reminders go to whatever you keep on file. Pick which to save.
                </p>

                {contactConfirm?.phone && matched && (
                  <div style={{ marginBottom: 22 }}>
                    <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--faint)", fontWeight: 600, marginBottom: 10 }}>PHONE</div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {[
                        { id: "file", topLabel: "ON FILE", topColor: "var(--faint)", value: matched.phone },
                        { id: "new", topLabel: "NEW", topColor: "var(--gold)", value: phone },
                      ].map((opt) => {
                        const on = keepPhone === opt.id;
                        return (
                          <button key={opt.id} onClick={() => setKeepPhone(opt.id)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: on ? "color-mix(in srgb, var(--gold) 10%, var(--panel))" : "var(--panel)", border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, borderRadius: 12, padding: "13px 16px", color: "var(--text)", textAlign: "left", cursor: "pointer", width: "100%" }}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 11, letterSpacing: 1.5, color: opt.topColor, fontWeight: 600, marginBottom: 4 }}>{opt.topLabel}</div>
                              <div style={{ fontSize: 16 }}>{opt.value}</div>
                            </div>
                            {on && <Check size={18} style={{ color: "var(--gold)", flexShrink: 0, marginLeft: 8 }} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {contactConfirm?.email && matched && (
                  <div style={{ marginBottom: 22 }}>
                    <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--faint)", fontWeight: 600, marginBottom: 10 }}>EMAIL</div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {[
                        { id: "file", topLabel: "ON FILE", topColor: "var(--faint)", value: matched.email },
                        { id: "new", topLabel: "NEW", topColor: "var(--gold)", value: newEmail.trim() },
                      ].map((opt) => {
                        const on = keepEmail === opt.id;
                        return (
                          <button key={opt.id} onClick={() => setKeepEmail(opt.id)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: on ? "color-mix(in srgb, var(--gold) 10%, var(--panel))" : "var(--panel)", border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, borderRadius: 12, padding: "13px 16px", color: "var(--text)", textAlign: "left", cursor: "pointer", width: "100%" }}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 11, letterSpacing: 1.5, color: opt.topColor, fontWeight: 600, marginBottom: 4 }}>{opt.topLabel}</div>
                              <div style={{ fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.value}</div>
                            </div>
                            {on && <Check size={18} style={{ color: "var(--gold)", flexShrink: 0, marginLeft: 8 }} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button className="lift" onClick={() => {
                  const finalPhone = (contactConfirm?.phone && keepPhone === "file") ? matched.phone : phone;
                  const finalEmail = (contactConfirm?.email && keepEmail === "file") ? matched.email : newEmail.trim();
                  setContactConfirm(null);
                  commitBooking(finalPhone, finalEmail);
                }} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 16, fontSize: 13.5, letterSpacing: 2.5, fontWeight: 600, borderRadius: 14, border: "none", marginTop: 6 }}>SAVE & BOOK</button>
                <button onClick={() => setContactConfirm(null)} style={{ width: "100%", background: "none", border: "none", color: "var(--sub)", fontSize: 14.5, padding: "12px 0 4px" }}>Cancel</button>
              </div>
            </Sheet>
          </div>
        )}

        {step === 8 && <ConfirmationScreen business={business} cart={cart} describeEntry={describeEntry} cartPrice={cartPrice} provider={provider} selectedDate={selectedDate} slot={slot} photos={photos} onManage={() => setStep(9)} onExit={onExit} />}

        {step === 9 && <ManageAppointment business={business} appts={appts} setAppts={setAppts} providers={providers} services={services} initialPhone={phone} dateOptions={dateOptions} onExit={onExit} showToast={(m) => {}} />}
        </div>
      </div>
    </div>
  );
}

// Guided intake for first-time clients — walks through the configured questions
// (service, then cut style with example galleries) so the shop knows exactly
// what's wanted and can reserve the right amount of time.
function FirstTimeIntake({ service, onCancel, onDone }) {
  const cfg = service.intake || {};
  const steps = [];
  if (cfg.service) steps.push({ key: "service", ...cfg.service, kind: "list" });
  if (cfg.style) steps.push({ key: "style", ...cfg.style, kind: "gallery" });
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState({});
  const [lightbox, setLightbox] = useState(null);
  const [carousel, setCarousel] = useState({}); // { [optionId]: currentImageIndex }
  const cur = steps[i];
  const choose = (optId) => {
    const next = { ...answers, [cur.key]: optId };
    setAnswers(next);
    if (i < steps.length - 1) setI(i + 1);
    else onDone(next);
  };
  const back = () => { if (i === 0) onCancel(); else setI(i - 1); };
  const stepImage = (optId, total, dir) => setCarousel((c) => { const cur = c[optId] || 0; let n = cur + dir; if (n < 0) n = total - 1; if (n >= total) n = 0; return { ...c, [optId]: n }; });

  return (
    <div className="fade-up">
      <button onClick={back} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", color: "var(--sub)", fontSize: 15, marginBottom: 18 }}><ArrowLeft size={18} /> Back</button>
      <div style={{ fontSize: 12.5, letterSpacing: 1.5, color: "var(--gold)", fontWeight: 600, marginBottom: 10 }}>FIRST VISIT · STEP {i + 1} OF {steps.length}</div>
      <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 500, marginBottom: 8, lineHeight: 1.1 }}>{cur.label}</h2>
      <p style={{ color: "var(--sub)", fontSize: 14, marginBottom: 24, fontWeight: 300, lineHeight: 1.55 }}>Pick the look closest to what you want — it helps us reserve exactly the right time for you.</p>

      {cur.kind === "list" && (
        <div style={{ display: "grid", gap: 12 }}>
          {cur.options.map((o) => (
            <button key={o.id} className="lift card" onClick={() => choose(o.id)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "18px 20px", color: "var(--text)", textAlign: "left" }}>
              <span style={{ fontSize: 17 }}>{o.label}</span>
              <ChevronRight size={18} style={{ color: "var(--faint)" }} />
            </button>
          ))}
        </div>
      )}

      {cur.kind === "gallery" && (
        <div style={{ display: "grid", gap: 24 }}>
          {cur.options.map((o) => {
            const imgs = o.images || [];
            const idx = carousel[o.id] || 0;
            const img = imgs[idx];
            return (
              <div key={o.id}>
                {/* medium image with side arrows */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {imgs.length > 1 && (
                    <button aria-label="Previous example" onClick={() => stepImage(o.id, imgs.length, -1)} style={{ width: 34, height: 34, flexShrink: 0, borderRadius: "50%", border: "1px solid var(--border2)", background: "var(--panel)", color: "var(--sub)", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}><ChevronLeft size={18} /></button>
                  )}
                  <button onClick={() => img && setLightbox(img)} style={{ flex: 1, position: "relative", aspectRatio: "1/1", borderRadius: 16, overflow: "hidden", border: "1px solid var(--border)", background: "var(--panel2)", padding: 0 }}>
                    {img && <img src={imgUrl(img, 400)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                    {imgs.length > 1 && (
                      <div style={{ position: "absolute", bottom: 10, left: 0, right: 0, display: "flex", gap: 5, justifyContent: "center" }}>
                        {imgs.map((_, di) => (<span key={di} style={{ width: 6, height: 6, borderRadius: "50%", background: di === idx ? "#fff" : "rgba(255,255,255,0.5)" }} />))}
                      </div>
                    )}
                  </button>
                  {imgs.length > 1 && (
                    <button aria-label="Next example" onClick={() => stepImage(o.id, imgs.length, 1)} style={{ width: 34, height: 34, flexShrink: 0, borderRadius: "50%", border: "1px solid var(--border2)", background: "var(--panel)", color: "var(--sub)", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}><ChevronRight size={18} /></button>
                  )}
                </div>
                <div style={{ margin: "14px 2px 12px" }}>
                  <div style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.2 }}>{o.label}</div>
                  {o.desc && <div style={{ fontSize: 14, color: "var(--sub)", marginTop: 2, lineHeight: 1.4 }}>{o.desc}</div>}
                </div>
                <button className="lift" onClick={() => choose(o.id)} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 14, fontSize: 13, letterSpacing: 1.5, fontWeight: 600, borderRadius: 10, border: "none" }}>Choose this</button>
              </div>
            );
          })}
          <p style={{ fontSize: 13, color: "var(--faint)", textAlign: "center", lineHeight: 1.5 }}>Use the arrows to see more examples. Not sure? Pick the closest — your barber will confirm in the chair.</p>
        </div>
      )}

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <img src={imgUrl(lightbox, 900)} alt="" style={{ maxWidth: "100%", maxHeight: "85vh", borderRadius: 14, display: "block" }} />
          <button onClick={() => setLightbox(null)} style={{ position: "absolute", top: 20, right: 20, background: "rgba(255,255,255,0.15)", color: "#fff", width: 40, height: 40, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={22} /></button>
        </div>
      )}
    </div>
  );
}

function ConfirmationScreen({ business, cart, describeEntry, cartPrice, provider, selectedDate, slot, photos, onManage, onExit }) {
  const relDate = relativeDate(selectedDate);
  const relPlus = relDate.includes(",") ? relDate : `${relDate}, ${MONTHS[selectedDate.getMonth()]} ${selectedDate.getDate()}`;
  return (
    <div className="fade-up" style={{ paddingTop: 8 }}>
      {/* Warm celebration moment — centered, big, no clinical icon */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div className="success-bloom" style={{ width: 56, height: 56, borderRadius: "50%", background: "color-mix(in srgb, var(--gold) 14%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
          <Check size={26} style={{ color: "var(--gold)" }} strokeWidth={2.5} />
        </div>
        <div style={{ width: 36, height: 1.5, background: "var(--gold)", margin: "0 auto 14px" }} />
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 40, fontWeight: 500, lineHeight: 1.02, letterSpacing: "-0.5px", marginBottom: 12 }}>You're in.</h2>
        <p style={{ color: "var(--text)", fontSize: 16, lineHeight: 1.5, maxWidth: 340, margin: "0 auto", fontWeight: 400 }}>We'll text you a reminder closer to the day. See you soon.</p>
      </div>

      {/* The appointment card — editorial, with hierarchy */}
      <div className="drift-in" style={{ background: "var(--panel)", border: "1.5px solid var(--gold)", borderRadius: 20, padding: "22px 24px", marginBottom: 18, boxShadow: "var(--shadow-md)" }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--gold)", fontWeight: 600, marginBottom: 12 }}>YOUR APPOINTMENT</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 500, lineHeight: 1.08, marginBottom: 4 }}>{relPlus}</div>
        <div style={{ fontSize: 16, color: "var(--text)", marginBottom: 16 }}>{fmtTime(slot)} · with {provider.name}</div>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          {cart.map((e, i) => (
            <div key={i} style={{ fontSize: 14.5, color: "var(--text)", marginBottom: i < cart.length - 1 ? 6 : 0, lineHeight: 1.4 }}>{describeEntry(e)}</div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
            <span style={{ fontSize: 12, letterSpacing: 1.5, color: "var(--faint)", fontWeight: 500 }}>TOTAL</span>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 24, color: "var(--gold)", fontWeight: 500 }}>${cartPrice}</span>
          </div>
          {photos > 0 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)", fontSize: 13.5, color: "var(--sub)", display: "flex", alignItems: "center", gap: 8 }}>
              <ImageIcon size={14} style={{ color: "var(--gold)" }} />
              <span>{photos} photo{photos > 1 ? "s" : ""} attached for your barber</span>
            </div>
          )}
        </div>
      </div>

      {/* What happens next — sets expectations warmly */}
      <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--faint)", fontWeight: 600, marginBottom: 8 }}>WHAT'S NEXT</div>
        <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.55 }}>
          A confirmation is on its way to your phone and email. We'll send a reminder the day before. If anything changes, you can always reschedule or cancel below.
        </div>
      </div>

      <button className="lift" onClick={onManage} style={{ width: "100%", background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)", padding: 15, fontSize: 14, letterSpacing: 1.5, fontWeight: 500, borderRadius: 14, marginBottom: 11 }}>Manage my appointment</button>
      <button className="lift" onClick={onExit} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 17, fontSize: 14, letterSpacing: 2.5, fontWeight: 600, borderRadius: 14, marginBottom: 28, boxShadow: "var(--shadow-md)" }}>BOOK ANOTHER</button>

      {/* Shop footer — subtle, branded */}
      <div style={{ textAlign: "center", color: "var(--faint)", fontSize: 13.5, lineHeight: 1.7, paddingBottom: 8 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, color: "var(--sub)", marginBottom: 4, letterSpacing: 0.3 }}>{business.legalName}</div>
        {business.address}{business.address2 ? `, ${business.address2}` : ""}<br />{business.cityZip}
      </div>
    </div>
  );
}

// ============================================================
// MANAGE — standalone wrapper (from landing page), supplies chrome + dates
// ============================================================
function ManageStandalone({ business, appts, setAppts, providers, services, onExit }) {
  const dateOptions = useMemo(() => {
    const arr = [];
    const base = new Date();
    const worksOn = (dow) => providers.some((p) => p.id !== "anyone" && p.hours?.[dow]?.on);
    const horizon = (business?.booking?.horizonDays === 0) ? 730 : (Math.max(1, business?.booking?.horizonDays || 60));
    for (let i = 0; i < horizon; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      if (!worksOn(d.getDay())) continue;
      arr.push(d);
    }
    return arr;
  }, [providers, business]);
  return (
    <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 480, padding: "24px 22px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <button onClick={onExit} style={{ background: "none", color: "var(--sub)", display: "flex", alignItems: "center", gap: 6, fontSize: 15 }}><ArrowLeft size={16} /> Back</button>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, letterSpacing: 3 }}>{business.name}</div>
          <div style={{ width: 50 }} />
        </div>
        <ManageAppointment business={business} appts={appts} setAppts={setAppts} providers={providers} services={services} initialPhone={null} dateOptions={dateOptions} onExit={onExit} showToast={() => {}} />
      </div>
    </div>
  );
}

// ============================================================
// MANAGE APPOINTMENT — client self-service (phone confirm, no login)
// Reschedule / cancel allowed only before the policy deadline.
// ============================================================
function ManageAppointment({ business, appts, setAppts, providers, services, initialPhone, dateOptions, onExit, showToast }) {
  const [phone, setPhone] = useState(initialPhone || "");
  const [confirmed, setConfirmed] = useState(!!initialPhone); // if we came from a fresh booking, skip the lookup
  const [reschedId, setReschedId] = useState(null);  // appt being rescheduled
  const [newDate, setNewDate] = useState(null);
  const [newSlot, setNewSlot] = useState(null);
  const [cancelId, setCancelId] = useState(null);    // appt pending cancel confirm

  const windowHrs = business.cancelWindowHrs || 24;
  const digits = (s) => (s || "").replace(/\D/g, "");
  const mine = appts.filter((a) => digits(a.phone) === digits(phone) && a.status !== "cancelled" && a.bookedFor);
  // sort soonest first
  mine.sort((a, b) => new Date(a.bookedFor) - new Date(b.bookedFor));

  const fmtWhen = (iso) => { const d = new Date(iso); const day = relativeDate(d); const lbl = day.includes(",") ? day : `${day}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; return `${lbl} at ${fmtTime(d.getHours() * 60 + d.getMinutes())}`; };
  const hoursUntil = (iso) => (new Date(iso) - new Date()) / 36e5;
  const canChange = (iso) => hoursUntil(iso) >= windowHrs;

  const slots = useMemo(() => { const out = []; for (let t = 9 * 60; t + 45 <= 17 * 60; t += 45) out.push(t); return out; }, []);

  const doReschedule = (a) => {
    if (newDate == null || newSlot == null) return;
    const when = new Date(newDate); when.setHours(Math.floor(newSlot / 60), newSlot % 60, 0, 0);
    const losesDiscount = a.rebookDiscount > 0;
    setAppts(appts.map((x) => x.id === a.id ? { ...x, start: newSlot, bookedFor: when.toISOString(), rebookDiscount: 0, discountForfeited: losesDiscount || x.discountForfeited } : x));
    setReschedId(null); setNewDate(null); setNewSlot(null);
    if (showToast) showToast(losesDiscount ? "Rescheduled — rebooking discount no longer applies." : "Appointment rescheduled.");
  };
  const doCancel = (a) => {
    setAppts(appts.map((x) => x.id === a.id ? { ...x, status: "cancelled" } : x));
    setCancelId(null);
  };

  // ---- phone confirmation gate ----
  if (!confirmed) {
    return (
      <div className="fade-up">
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 500, marginBottom: 6 }}>Manage your appointment</h2>
        <p style={{ color: "var(--sub)", fontSize: 14, marginBottom: 22, fontWeight: 300, lineHeight: 1.5 }}>Enter the phone number you booked with. We'll text you a code — confirm it to see your appointments.</p>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" style={{ ...inputStyle, marginBottom: 14 }} />
        <button className="lift" disabled={digits(phone).length < 10} onClick={() => setConfirmed(true)} style={{ width: "100%", background: digits(phone).length < 10 ? "var(--border)" : "var(--gold)", color: digits(phone).length < 10 ? "var(--faint)" : "var(--on-gold)", padding: 15, fontSize: 14, letterSpacing: 2, fontWeight: 500, borderRadius: 10 }}>That's me →</button>
        <p style={{ color: "var(--faint)", fontSize: 14, marginTop: 14, lineHeight: 1.5 }}>In the live product a 6-digit code is texted to verify it's really you. No password needed.</p>
      </div>
    );
  }

  return (
    <div className="fade-up">
      <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 500, marginBottom: 6 }}>Your appointments</h2>
      <p style={{ color: "var(--sub)", fontSize: 15, marginBottom: 22, fontWeight: 300 }}>{digits(phone).length === 10 ? `(${digits(phone).slice(0, 3)}) ${digits(phone).slice(3, 6)}-${digits(phone).slice(6)}` : phone}</p>

      {mine.length === 0 && <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 6, padding: 24, textAlign: "center", color: "var(--sub)", fontSize: 14 }}>No upcoming appointments found for this number.</div>}

      <div style={{ display: "grid", gap: 14 }}>
        {mine.map((a) => {
          const prov = providers.find((p) => p.id === a.providerId);
          const changeable = canChange(a.bookedFor);
          const hrs = Math.max(0, Math.round(hoursUntil(a.bookedFor)));
          return (
            <div key={a.id} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 18 }}>
              <div style={{ fontSize: 17, marginBottom: 4 }}>{fmtWhen(a.bookedFor)}</div>
              <div style={{ fontSize: 14, color: "var(--sub)", marginBottom: 2 }}>{a.title}</div>
              <div style={{ fontSize: 14, color: "var(--sub)" }}>with {prov ? prov.name : "your stylist"}</div>
              {a.photos > 0 && <div style={{ fontSize: 15, color: "var(--sub)", marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}><ImageIcon size={14} style={{ color: "var(--gold)" }} /> {a.photos} photo{a.photos > 1 ? "s" : ""} attached</div>}

              {/* reschedule picker inline */}
              {reschedId === a.id ? (
                <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                  <div style={{ fontSize: 15, color: "var(--faint)", letterSpacing: 1, marginBottom: 8 }}>Pick a new day</div>
                  <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 14 }}>
                    {dateOptions.slice(0, 10).map((d, i) => { const on = newDate && d.toDateString() === newDate.toDateString(); return (
                      <button key={i} onClick={() => { setNewDate(d); setNewSlot(null); }} style={{ flexShrink: 0, minWidth: 52, padding: "10px 0", borderRadius: 8, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "var(--gold)" : "transparent", color: on ? "var(--on-gold)" : "var(--text)", textAlign: "center" }}>
                        <div style={{ fontSize: 12, letterSpacing: 1, opacity: 0.7 }}>{["SUN","MON","TUE","WED","THU","FRI","SAT"][d.getDay()]}</div>
                        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18 }}>{d.getDate()}</div>
                      </button>
                    ); })}
                  </div>
                  {newDate && (<>
                    <div style={{ fontSize: 15, color: "var(--faint)", letterSpacing: 1, marginBottom: 8 }}>Pick a time</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                      {slots.map((t) => { const on = newSlot === t; return (<button key={t} onClick={() => setNewSlot(t)} style={{ padding: "9px 14px", borderRadius: 20, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "var(--gold)" : "transparent", color: on ? "var(--on-gold)" : "var(--text)", fontSize: 15 }}>{fmtTime(t)}</button>); })}
                    </div>
                  </>)}
                  {a.rebookDiscount > 0 && (
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "rgba(176,141,87,0.08)", border: "1px solid rgba(176,141,87,0.25)", borderRadius: 10, padding: "11px 13px", marginBottom: 14 }}>
                      <AlertCircle size={16} style={{ color: "var(--gold)", flexShrink: 0, marginTop: 1 }} />
                      <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--text2)" }}>Heads up — the {money(a.rebookDiscount)} rebooking discount applies to this time. Moving it means that comes off.</div>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={() => { setReschedId(null); setNewDate(null); setNewSlot(null); }} style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", color: "var(--text)", padding: 13, fontSize: 15, letterSpacing: 1, borderRadius: 8 }}>BACK</button>
                    <button className="lift" disabled={newDate == null || newSlot == null} onClick={() => doReschedule(a)} style={{ flex: 1, background: (newDate != null && newSlot != null) ? "var(--gold)" : "var(--border)", color: (newDate != null && newSlot != null) ? "var(--on-gold)" : "var(--faint)", padding: 13, fontSize: 15, letterSpacing: 1, fontWeight: 600, borderRadius: 8 }}>Confirm new time</button>
                  </div>
                </div>
              ) : cancelId === a.id ? (
                <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                  <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.5, marginBottom: 14 }}>Cancel this appointment? Per the policy, you're within the {windowHrs}-hour window, so there's no charge.</p>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={() => setCancelId(null)} style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", color: "var(--text)", padding: 13, fontSize: 15, letterSpacing: 1, borderRadius: 8 }}>Keep it</button>
                    <button className="lift" onClick={() => doCancel(a)} style={{ flex: 1, background: "#C2563F", color: "#fff", padding: 13, fontSize: 15, letterSpacing: 1, fontWeight: 600, borderRadius: 8 }}>Cancel appointment</button>
                  </div>
                </div>
              ) : changeable ? (
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="lift" onClick={() => { setReschedId(a.id); setNewDate(null); setNewSlot(null); }} style={{ flex: 1, background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text)", padding: 13, fontSize: 15, letterSpacing: 1, fontWeight: 500, borderRadius: 8 }}>Reschedule</button>
                  <button className="lift" onClick={() => setCancelId(a.id)} style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", color: "var(--sub)", padding: 13, fontSize: 15, letterSpacing: 1, borderRadius: 8 }}>Cancel</button>
                </div>
              ) : (
                <div style={{ marginTop: 16, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, padding: "13px 15px", fontSize: 15, color: "var(--sub)", lineHeight: 1.5 }}>
                  This appointment is less than {windowHrs} hours away, so it can no longer be changed online. Please call us at {business.phone || "the studio"} and we'll help.
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button onClick={onExit} style={{ width: "100%", background: "transparent", color: "var(--sub)", padding: 16, fontSize: 15, letterSpacing: 1, marginTop: 22 }}>DONE</button>
    </div>
  );
}

// ============================================================
// PULSE 2.0 — the heartbeat of the shop. Per-barber by default.
// Greeting + today's YOUR money + "right now" status + day timeline
// + daily/weekly goal progress + the report drill-ins below.
// Owners get a "viewing as" picker to flip between barbers or shop totals.
// Barbers only see their own chair, period.
// ============================================================
function PulseView({ business, appts, clients, services, providers, me, isOwner, pulseView, setPulseView, onNavigate, onOpenRevenue, onOpenAppointments, onOpenClients, onOpenServices, onOpenBarbers, onSignOut }) {
  const now = new Date();
  const realProviders = providers.filter((p) => p.id !== "anyone");

  // Resolve who/what we're showing:
  // - "me" → just the signed-in provider's chair
  // - "shop" → combined across all barbers (owner only)
  // - "<providerId>" → another specific barber (owner only)
  let viewedProvider = me;
  let isShopView = false;
  if (isOwner && pulseView === "shop") {
    isShopView = true;
    viewedProvider = null;
  } else if (isOwner && pulseView !== "me" && pulseView !== "shop") {
    viewedProvider = providers.find((p) => p.id === pulseView) || me;
  }

  // --- Time window helpers ---
  const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const sow = (d) => { const x = sod(d); const day = x.getDay(); const diff = day === 0 ? -6 : 1 - day; x.setDate(x.getDate() + diff); return x; };

  const todayStart = sod(now);
  const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = sow(now);
  const nextWeekStart = new Date(weekStart); nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const lastWeekStart = new Date(weekStart); lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  // --- Price-per-appt ---
  const apptPrice = (a) => {
    if (a.lineItems && a.lineItems.length) {
      return a.lineItems.reduce((sum, li) => {
        const s = services.find((x) => x.id === li.serviceId);
        return sum + (s ? getPrice(s, a.providerId) : 0);
      }, 0);
    }
    const s = services.find((x) => x.id === a.serviceId);
    return s ? getPrice(s, a.providerId) : 0;
  };

  const isBlock = (a) => a.status === "block";
  const isRevenue = (a) => a.status === "done";
  const inRange = (a, start, end) => {
    if (!a.bookedFor) return false;
    const t = new Date(a.bookedFor).getTime();
    return t >= start.getTime() && t < end.getTime();
  };
  // Filter to the viewed scope (my chair / a specific barber / shop-wide)
  const scopeFilter = (a) => {
    if (isShopView) return !isBlock(a);
    if (!viewedProvider) return false;
    return !isBlock(a) && a.providerId === viewedProvider.id;
  };

  // --- Money totals (revenue = status "done") ---
  const sumRevenue = (start, end) => appts
    .filter((a) => scopeFilter(a) && isRevenue(a) && inRange(a, start, end))
    .reduce((sum, a) => sum + apptPrice(a), 0);

  const todayMoney = sumRevenue(todayStart, tomorrowStart);
  const yesterdayMoney = sumRevenue(yesterdayStart, todayStart);
  const thisWeekMoney = sumRevenue(weekStart, nextWeekStart);
  const lastWeekMoney = sumRevenue(lastWeekStart, weekStart);

  // --- Today's appointments in scope, time-sorted ---
  const todayApptsAll = appts
    .filter((a) => scopeFilter(a) && a.status !== "cancelled" && inRange(a, todayStart, tomorrowStart))
    .sort((a, b) => a.start - b.start);

  // --- "Right now" detection — what's on the chair, what's next, or when free until ---
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // In-chair: an appt whose start is in the past and end is in the future today, not cancelled/done
  const inChair = todayApptsAll.find((a) => a.start <= nowMin && a.end > nowMin && a.status !== "done");
  const nextAppt = todayApptsAll.find((a) => a.start > nowMin && a.status !== "done");
  const minutesUntil = nextAppt ? (nextAppt.start - nowMin) : null;
  const minutesLeft = inChair ? (inChair.end - nowMin) : null;
  const minutesInChair = inChair ? (nowMin - inChair.start) : null;

  // --- "Free until" calc — only meaningful if not currently in chair and there's a next appt ---
  const fmtTime = (m) => { const h = Math.floor(m / 60); const mm = m % 60; const ampm = h >= 12 ? "PM" : "AM"; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}:${mm.toString().padStart(2, "0")} ${ampm}`; };

  // --- Goals — only meaningful in per-person view, never shop-wide (different scales) ---
  const dailyGoal = !isShopView && viewedProvider ? (viewedProvider.dailyGoal || 0) : 0;
  const weeklyGoal = !isShopView && viewedProvider ? (viewedProvider.weeklyGoal || 0) : 0;
  const dailyPct = dailyGoal > 0 ? Math.min(100, Math.round((todayMoney / dailyGoal) * 100)) : 0;
  const weeklyPct = weeklyGoal > 0 ? Math.min(100, Math.round((thisWeekMoney / weeklyGoal) * 100)) : 0;

  // --- Day timeline geometry — show the working hours for the viewed provider (or 9-7 fallback) ---
  let timelineStart = 9 * 60, timelineEnd = 19 * 60;
  if (!isShopView && viewedProvider) {
    const h = viewedProvider.hours?.[now.getDay()];
    if (h?.on) { timelineStart = h.start; timelineEnd = h.end; }
  } else if (isShopView) {
    let minS = 24 * 60, maxE = 0;
    realProviders.forEach((p) => {
      const h = p.hours?.[now.getDay()];
      if (h?.on) { if (h.start < minS) minS = h.start; if (h.end > maxE) maxE = h.end; }
    });
    if (maxE > 0) { timelineStart = minS; timelineEnd = maxE; }
  }
  const timelineSpan = Math.max(60, timelineEnd - timelineStart);
  const pctFor = (mins) => Math.max(0, Math.min(100, ((mins - timelineStart) / timelineSpan) * 100));

  // --- Cockpit stat tiles: today's completed cuts, chair occupancy %, average ticket ---
  const todayDone = todayApptsAll.filter((a) => a.status === "done");
  const cutsToday = todayDone.length;
  const avgTicket = cutsToday > 0 ? Math.round(todayMoney / cutsToday) : 0;
  // Occupancy = booked minutes today / bookable minutes today (for the viewed scope)
  const bookableTodayMin = (() => {
    if (isShopView) {
      let total = 0;
      realProviders.forEach((p) => { const h = p.hours?.[now.getDay()]; if (h?.on) total += (h.end - h.start); });
      return total;
    }
    const h = viewedProvider?.hours?.[now.getDay()];
    return h?.on ? (h.end - h.start) : 0;
  })();
  const bookedTodayMin = todayApptsAll.reduce((sum, a) => sum + (a.end - a.start), 0);
  const occupancyToday = bookableTodayMin > 0 ? Math.round((bookedTodayMin / bookableTodayMin) * 100) : 0;
  // Goal ring geometry (daily goal) — circumference for r=34
  const ringCirc = 2 * Math.PI * 34;
  const ringOffset = ringCirc * (1 - (dailyPct / 100));

  // --- Greeting based on time of day ---
  const greeting = (() => {
    const h = now.getHours();
    if (h < 5) return "Late night";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    if (h < 22) return "Good evening";
    return "Late night";
  })();
  const displayName = isShopView ? business?.name || "the shop" : (viewedProvider?.name || "");
  const headerName = isShopView ? `${business?.name || "Shop"} · combined` : (pulseView !== "me" ? `Viewing ${viewedProvider?.name}` : `${greeting}, ${viewedProvider?.name || ""}`);

  // --- Overdue clients (for the CTA at the bottom) — owner sees overall, barber sees their own ---
  const overdueCount = clients.filter((c) => {
    if (!c.cadenceDays || !c.lastVisit) return false;
    if (c.nudgeDismissedAt && new Date(c.nudgeDismissedAt) > new Date(c.lastVisit)) return false;
    if (!isOwner && c.provider && c.provider !== viewedProvider?.id) return false;
    const days = Math.round((Date.now() - new Date(c.lastVisit)) / 86400000);
    return (days - c.cadenceDays) > 0;
  }).length;

  // --- Formatters ---
  const fmtMoney = (n) => `$${Math.round(n).toLocaleString()}`;
  const todayLabel = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;

  // --- "Vs yesterday / last week" deltas ---
  const todayVsYesterday = (() => {
    if (yesterdayMoney === 0 && todayMoney === 0) return null;
    if (yesterdayMoney === 0) return null;
    const diff = todayMoney - yesterdayMoney;
    return { diff, up: diff >= 0, abs: Math.abs(diff) };
  })();
  const weekDelta = (() => {
    if (lastWeekMoney === 0 && thisWeekMoney === 0) return null;
    if (lastWeekMoney === 0) return null;
    const pct = Math.round(((thisWeekMoney - lastWeekMoney) / lastWeekMoney) * 100);
    return { up: pct >= 0, pct: Math.abs(pct), prior: lastWeekMoney };
  })();

  // --- Picker state for the owner's "viewing as" dropdown ---
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="fade-up">
      {/* MASTHEAD — greeting + owner view picker */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
          <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginTop: 12 }} />
          {/* Owner-only "viewing as" picker. Barbers see only their avatar + name (no toggle). */}
          {isOwner && realProviders.length > 1 ? (
            <div style={{ position: "relative" }}>
              <button onClick={() => setPickerOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 24, padding: "6px 12px 6px 6px", cursor: "pointer" }}>
                {isShopView ? (
                  <div style={{ width: 26, height: 26, borderRadius: "50%", background: "color-mix(in srgb, var(--gold) 20%, var(--panel2))", display: "flex", alignItems: "center", justifyContent: "center" }}><Users size={13} style={{ color: "var(--gold)" }} /></div>
                ) : (
                  <Avatar size={26} initial={viewedProvider?.name?.charAt(0)} color={viewedProvider?.color} photo={viewedProvider?.photo} />
                )}
                <span style={{ fontSize: 13, color: "var(--text)", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isShopView ? "All shop" : (pulseView === "me" ? viewedProvider?.name : viewedProvider?.name)}</span>
                <ChevronDown size={14} style={{ color: "var(--faint)" }} />
              </button>
              {pickerOpen && (
                <>
                  <div onClick={() => setPickerOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50 }} />
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, minWidth: 200, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 18px 40px rgba(0,0,0,0.25)", zIndex: 51, padding: 6, overflow: "hidden" }}>
                    <button onClick={() => { setPulseView("me"); setPickerOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: pulseView === "me" ? "color-mix(in srgb, var(--gold) 10%, transparent)" : "none", color: "var(--text)", border: "none", borderRadius: 10, fontSize: 14, textAlign: "left" }}>
                      <Avatar size={26} initial={me?.name?.charAt(0)} color={me?.color} photo={me?.photo} />
                      <span style={{ flex: 1 }}>{me?.name} (you)</span>
                    </button>
                    {realProviders.filter((p) => p.id !== me?.id).map((p) => (
                      <button key={p.id} onClick={() => { setPulseView(p.id); setPickerOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: pulseView === p.id ? "color-mix(in srgb, var(--gold) 10%, transparent)" : "none", color: "var(--text)", border: "none", borderRadius: 10, fontSize: 14, textAlign: "left" }}>
                        <Avatar size={26} initial={p.name.charAt(0)} color={p.color} photo={p.photo} />
                        <span style={{ flex: 1 }}>{p.name}</span>
                      </button>
                    ))}
                    <div style={{ height: 1, background: "var(--line)", margin: "4px 6px" }} />
                    <button onClick={() => { setPulseView("shop"); setPickerOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: pulseView === "shop" ? "color-mix(in srgb, var(--gold) 10%, transparent)" : "none", color: "var(--text)", border: "none", borderRadius: 10, fontSize: 14, textAlign: "left" }}>
                      <div style={{ width: 26, height: 26, borderRadius: "50%", background: "color-mix(in srgb, var(--gold) 20%, var(--panel2))", display: "flex", alignItems: "center", justifyContent: "center" }}><Users size={13} style={{ color: "var(--gold)" }} /></div>
                      <span style={{ flex: 1 }}>All shop (combined)</span>
                    </button>
                    {onSignOut && (
                      <>
                        <div style={{ height: 1, background: "var(--line)", margin: "4px 6px" }} />
                        <button onClick={() => { setPickerOpen(false); onSignOut(); }} style={{ width: "100%", padding: "10px 12px", background: "none", color: "var(--sub)", border: "none", borderRadius: 10, fontSize: 13, textAlign: "left" }}>Sign in as someone else…</button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            /* Barber view — small avatar + name, no toggle */
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 24, padding: "6px 12px 6px 6px" }}>
              <Avatar size={26} initial={viewedProvider?.name?.charAt(0)} color={viewedProvider?.color} photo={viewedProvider?.photo} />
              <span style={{ fontSize: 13, color: "var(--text)" }}>{viewedProvider?.name}</span>
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--gold)", marginBottom: 8, fontWeight: 600 }}>{todayLabel.toUpperCase()}</div>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: 500, letterSpacing: -0.5, lineHeight: 0.98 }}>{headerName}</h2>
      </div>

      {/* TODAY — money + goal ring side by side (the cockpit hero) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 24 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--faint)", marginBottom: 5, fontWeight: 600 }}>{isShopView ? "TODAY · SHOP" : "TODAY · YOU"}</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 52, fontWeight: 500, color: "var(--text)", lineHeight: 0.95, letterSpacing: -1.3, marginBottom: 6 }}>
            {fmtMoney(todayMoney)}
          </div>
          {todayVsYesterday ? (
            <div style={{ fontSize: 13, color: todayVsYesterday.up ? "var(--gold)" : "var(--sub)", lineHeight: 1.4 }}>
              {todayVsYesterday.up ? "+" : "−"}{fmtMoney(todayVsYesterday.abs)} vs {fmtMoney(yesterdayMoney)} yesterday
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--sub)", lineHeight: 1.4 }}>
              {todayApptsAll.length === 0 ? "Nothing booked today yet." : `${todayApptsAll.length} ${todayApptsAll.length === 1 ? "visit" : "visits"} booked`}
            </div>
          )}
        </div>
        {/* Goal ring — only in per-person view with a daily goal set */}
        {!isShopView && dailyGoal > 0 && (
          <div style={{ textAlign: "center", flexShrink: 0 }}>
            <svg width="92" height="92" viewBox="0 0 92 92">
              <circle cx="46" cy="46" r="34" fill="none" stroke="var(--panel2)" strokeWidth="7" />
              <circle cx="46" cy="46" r="34" fill="none" stroke="var(--gold)" strokeWidth="7" strokeLinecap="round" strokeDasharray={ringCirc} strokeDashoffset={ringOffset} transform="rotate(-90 46 46)" style={{ transition: "stroke-dashoffset .4s ease" }} />
              <text x="46" y="51" textAnchor="middle" fill="var(--text)" fontSize="21" fontFamily={FONT_DISPLAY} fontWeight="500">{dailyPct}%</text>
            </svg>
            <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 1 }}>{fmtMoney(todayMoney)} / {fmtMoney(dailyGoal)}</div>
          </div>
        )}
      </div>

      {/* STAT TILES — cuts, chair occupancy, avg ticket */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 9, marginBottom: 26 }}>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 13, padding: "13px 10px", textAlign: "center" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 23, fontWeight: 500, color: "var(--text)", lineHeight: 1 }}>{cutsToday}</div>
          <div style={{ fontSize: 10, letterSpacing: 1.2, color: "var(--sub)", marginTop: 4, fontWeight: 600 }}>CUTS</div>
        </div>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 13, padding: "13px 10px", textAlign: "center" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 23, fontWeight: 500, color: "var(--text)", lineHeight: 1 }}>{occupancyToday}%</div>
          <div style={{ fontSize: 10, letterSpacing: 1.2, color: "var(--sub)", marginTop: 4, fontWeight: 600 }}>CHAIR FULL</div>
        </div>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 13, padding: "13px 10px", textAlign: "center" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 23, fontWeight: 500, color: "var(--text)", lineHeight: 1 }}>{fmtMoney(avgTicket)}</div>
          <div style={{ fontSize: 10, letterSpacing: 1.2, color: "var(--sub)", marginTop: 4, fontWeight: 600 }}>AVG TICKET</div>
        </div>
      </div>

      {/* RIGHT NOW — what's happening on the chair */}
      <div style={{ marginBottom: 30, background: "color-mix(in srgb, var(--gold) 8%, var(--panel))", border: "1px solid color-mix(in srgb, var(--gold) 25%, var(--border))", borderRadius: 16, padding: "18px 20px" }}>
        <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--gold)", marginBottom: 10, fontWeight: 600 }}>RIGHT NOW</div>
        {inChair ? (
          <>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500, marginBottom: 4, lineHeight: 1.2 }}>{inChair.name}</div>
            <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.5 }}>
              {inChair.title} · <span style={{ color: "var(--gold)", fontWeight: 600 }}>{minutesLeft} min left</span> · started {minutesInChair} min ago
            </div>
          </>
        ) : nextAppt ? (
          <>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500, marginBottom: 4, lineHeight: 1.2 }}>Up next: {nextAppt.name}</div>
            <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.5 }}>
              {nextAppt.title} at {fmtTime(nextAppt.start)} · <span style={{ color: "var(--gold)", fontWeight: 600 }}>in {minutesUntil} min</span>
            </div>
          </>
        ) : todayApptsAll.length > 0 ? (
          <>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500, marginBottom: 4, lineHeight: 1.2 }}>Day's done</div>
            <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.5 }}>No more bookings today. {fmtMoney(todayMoney)} in.</div>
          </>
        ) : (
          <>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500, marginBottom: 4, lineHeight: 1.2 }}>Open chair</div>
            <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.5 }}>No appointments booked today.</div>
          </>
        )}
      </div>

      {/* DAY TIMELINE — horizontal bar showing today's bookings */}
      {todayApptsAll.length > 0 && (
        <div style={{ marginBottom: 30 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--faint)", fontWeight: 600 }}>TODAY AT A GLANCE</div>
            <div style={{ fontSize: 11, color: "var(--faint)" }}>{fmtTime(timelineStart)} → {fmtTime(timelineEnd)}</div>
          </div>
          <button onClick={() => onNavigate && onNavigate("calendar")} style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
            <div style={{ position: "relative", height: 30, background: "var(--panel2)", borderRadius: 6, overflow: "hidden" }}>
              {todayApptsAll.map((a) => {
                const left = pctFor(a.start);
                const width = pctFor(a.end) - left;
                if (width <= 0) return null;
                return (
                  <div key={a.id} title={`${a.name} · ${fmtTime(a.start)}`} style={{ position: "absolute", left: `${left}%`, width: `${width}%`, top: 3, bottom: 3, background: "var(--gold)", borderRadius: 3, opacity: a.status === "done" ? 0.5 : 1 }} />
                );
              })}
              {/* "Now" line — only show if we're within the timeline range */}
              {nowMin >= timelineStart && nowMin <= timelineEnd && (
                <div style={{ position: "absolute", left: `${pctFor(nowMin)}%`, top: 0, bottom: 0, width: 2, background: "var(--text)", boxShadow: "0 0 0 2px var(--bg)" }} />
              )}
            </div>
          </button>
          <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 6, lineHeight: 1.4 }}>
            {todayApptsAll.filter((a) => a.status === "done").length} done · {todayApptsAll.filter((a) => a.status !== "done").length} to go
          </div>
        </div>
      )}

      <div style={{ height: 1, background: "var(--line)", margin: "0 0 30px" }} />

      {/* THIS WEEK */}
      <div style={{ marginBottom: 30 }}>
        <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--faint)", marginBottom: 6, fontWeight: 600 }}>THIS WEEK</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: 500, color: "var(--text)", lineHeight: 1, letterSpacing: -0.8, marginBottom: 6 }}>
          {fmtMoney(thisWeekMoney)}
        </div>
        {weekDelta && (
          <div style={{ fontSize: 13.5, color: weekDelta.up ? "var(--gold)" : "var(--sub)", marginBottom: 14, lineHeight: 1.5 }}>
            {weekDelta.up ? "+" : "−"}{weekDelta.pct}% vs {fmtMoney(weekDelta.prior)} last week
          </div>
        )}
        {/* WEEKLY GOAL — per-person only */}
        {!isShopView && weeklyGoal > 0 && (
          <div style={{ marginTop: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <div style={{ fontSize: 11, letterSpacing: 1.5, color: "var(--faint)", fontWeight: 600 }}>WEEKLY GOAL</div>
              <div style={{ fontSize: 12.5, color: weeklyPct >= 100 ? "var(--gold)" : "var(--sub)", fontWeight: weeklyPct >= 100 ? 600 : 400 }}>
                {weeklyPct >= 100 ? `🎯 ${fmtMoney(thisWeekMoney)} of ${fmtMoney(weeklyGoal)}` : `${fmtMoney(thisWeekMoney)} of ${fmtMoney(weeklyGoal)} · ${weeklyPct}%`}
              </div>
            </div>
            <div style={{ height: 6, background: "var(--panel2)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${weeklyPct}%`, height: "100%", background: weeklyPct >= 100 ? "var(--gold)" : "color-mix(in srgb, var(--gold) 70%, var(--panel2))", transition: "width .3s ease" }} />
            </div>
          </div>
        )}
        {/* Gentle empty-state for goals — only shown in per-person view when neither goal is set */}
        {!isShopView && dailyGoal === 0 && weeklyGoal === 0 && (
          <div style={{ fontSize: 13, color: "var(--faint)", fontStyle: "italic", marginTop: 10 }}>
            Set a daily or weekly goal in Settings → Staff to track progress.
          </div>
        )}
      </div>

      {/* OWNER-ONLY REPORTS — hidden for barbers */}
      {isOwner && (
        <>
          <div style={{ height: 1, background: "var(--line)", margin: "0 0 22px" }} />
          {onOpenRevenue && (
            <button onClick={onOpenRevenue} className="lift" style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", color: "var(--text)", cursor: "pointer", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <TrendingUp size={17} style={{ color: "var(--gold)" }} />
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>View revenue trend</div>
                  <div style={{ fontSize: 13, color: "var(--sub)" }}>Week, month, year — top services and clients</div>
                </div>
              </div>
              <ChevronRight size={18} style={{ color: "var(--faint)" }} />
            </button>
          )}
          {onOpenAppointments && (
            <button onClick={onOpenAppointments} className="lift" style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", color: "var(--text)", cursor: "pointer", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <BarChart3 size={17} style={{ color: "var(--gold)" }} />
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>View appointments</div>
                  <div style={{ fontSize: 13, color: "var(--sub)" }}>Counts, no-shows, busiest day &amp; hour</div>
                </div>
              </div>
              <ChevronRight size={18} style={{ color: "var(--faint)" }} />
            </button>
          )}
          {onOpenClients && (
            <button onClick={onOpenClients} className="lift" style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", color: "var(--text)", cursor: "pointer", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Users size={17} style={{ color: "var(--gold)" }} />
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>View clients</div>
                  <div style={{ fontSize: 13, color: "var(--sub)" }}>New vs returning, retention, top clients</div>
                </div>
              </div>
              <ChevronRight size={18} style={{ color: "var(--faint)" }} />
            </button>
          )}
          {onOpenServices && (
            <button onClick={onOpenServices} className="lift" style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", color: "var(--text)", cursor: "pointer", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Sparkles size={17} style={{ color: "var(--gold)" }} />
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>View service mix</div>
                  <div style={{ fontSize: 13, color: "var(--sub)" }}>What drives revenue · $ per hour</div>
                </div>
              </div>
              <ChevronRight size={18} style={{ color: "var(--faint)" }} />
            </button>
          )}
          {onOpenBarbers && realProviders.length > 1 && (
            <button onClick={onOpenBarbers} className="lift" style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", color: "var(--text)", cursor: "pointer", marginBottom: overdueCount > 0 ? 14 : 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Users size={17} style={{ color: "var(--gold)" }} />
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>View per barber</div>
                  <div style={{ fontSize: 13, color: "var(--sub)" }}>Each barber's revenue, occupancy &amp; retention</div>
                </div>
              </div>
              <ChevronRight size={18} style={{ color: "var(--faint)" }} />
            </button>
          )}
        </>
      )}

      {/* OVERDUE CTA — shown to everyone in their scope */}
      {overdueCount > 0 && (
        <button onClick={() => onNavigate && onNavigate("clients")} className="lift" style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "color-mix(in srgb, var(--gold) 10%, var(--panel))", border: "1px solid color-mix(in srgb, var(--gold) 30%, var(--border))", borderRadius: 14, padding: "16px 18px", color: "var(--text)", cursor: "pointer", marginTop: isOwner ? 0 : 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Bell size={17} style={{ color: "var(--gold)" }} />
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>{overdueCount} client{overdueCount > 1 ? "s" : ""} overdue to rebook</div>
              <div style={{ fontSize: 13, color: "var(--sub)" }}>Open the nudge folder</div>
            </div>
          </div>
          <ChevronRight size={18} style={{ color: "var(--faint)" }} />
        </button>
      )}
    </div>
  );
}

// ============================================================
// REVENUE — first Pulse drill-in. Period toggle (week/month/year),
// editorial bar chart, top services + top clients for the period.
// ============================================================
function RevenueView({ appts, clients, services, providers, onBack }) {
  const [period, setPeriod] = useState("month"); // "week" | "month" | "year"
  const now = new Date();

  // --- Same date helpers as PulseView (kept local for self-containment) ---
  const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const sow = (d) => {
    const x = sod(d);
    const day = x.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diff);
    return x;
  };
  const som = (d) => { const x = sod(d); x.setDate(1); return x; };

  // Price-per-appt — same as Pulse
  const apptPrice = (a) => {
    if (a.lineItems && a.lineItems.length) {
      return a.lineItems.reduce((sum, li) => {
        const s = services.find((x) => x.id === li.serviceId);
        return sum + (s ? getPrice(s, a.providerId) : 0);
      }, 0);
    }
    const s = services.find((x) => x.id === a.serviceId);
    return s ? getPrice(s, a.providerId) : 0;
  };

  const inRange = (a, start, end) => {
    if (!a.bookedFor) return false;
    const t = new Date(a.bookedFor).getTime();
    return t >= start.getTime() && t < end.getTime();
  };
  const isBlock = (a) => a.status === "block";
  const isRevenue = (a) => a.status === "done";

  const sumRevenue = (start, end) =>
    appts
      .filter((a) => !isBlock(a) && isRevenue(a) && inRange(a, start, end))
      .reduce((sum, a) => sum + apptPrice(a), 0);

  // --- Period boundaries (current + prior) ---
  let periodStart, periodEnd, priorStart, priorEnd, priorLabel;
  if (period === "week") {
    periodStart = sow(now);
    periodEnd = new Date(periodStart); periodEnd.setDate(periodEnd.getDate() + 7);
    priorStart = new Date(periodStart); priorStart.setDate(priorStart.getDate() - 7);
    priorEnd = new Date(periodStart);
    priorLabel = "last week";
  } else if (period === "month") {
    periodStart = som(now);
    periodEnd = new Date(periodStart); periodEnd.setMonth(periodEnd.getMonth() + 1);
    priorStart = new Date(periodStart); priorStart.setMonth(priorStart.getMonth() - 1);
    priorEnd = new Date(periodStart);
    priorLabel = "last month";
  } else {
    periodStart = new Date(now.getFullYear(), 0, 1);
    periodEnd = new Date(now.getFullYear() + 1, 0, 1);
    priorStart = new Date(now.getFullYear() - 1, 0, 1);
    priorEnd = new Date(now.getFullYear(), 0, 1);
    priorLabel = "last year";
  }

  const periodTotal = sumRevenue(periodStart, periodEnd);
  const priorTotal = sumRevenue(priorStart, priorEnd);
  const periodVisits = appts.filter((a) => !isBlock(a) && isRevenue(a) && inRange(a, periodStart, periodEnd));
  const visitCount = periodVisits.length;
  const avgTicket = visitCount > 0 ? Math.round(periodTotal / visitCount) : 0;

  // --- Bucket the chart depending on period ---
  const buckets = (() => {
    if (period === "week") {
      const start = sow(now);
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start); d.setDate(d.getDate() + i);
        const nd = new Date(d); nd.setDate(nd.getDate() + 1);
        return { start: d, end: nd, label: ["M", "T", "W", "T", "F", "S", "S"][i], isCurrent: d.toDateString() === now.toDateString() };
      });
    }
    if (period === "month") {
      const start = som(now);
      const monthEnd = new Date(start); monthEnd.setMonth(monthEnd.getMonth() + 1);
      const out = [];
      let cursor = new Date(start);
      let wkIdx = 1;
      while (cursor < monthEnd) {
        const wkEnd = new Date(cursor); wkEnd.setDate(wkEnd.getDate() + 7);
        const realEnd = wkEnd > monthEnd ? new Date(monthEnd) : wkEnd;
        out.push({ start: new Date(cursor), end: realEnd, label: `W${wkIdx}`, isCurrent: now >= cursor && now < realEnd });
        cursor = realEnd; wkIdx++;
      }
      return out;
    }
    // year
    return Array.from({ length: 12 }, (_, i) => {
      const start = new Date(now.getFullYear(), i, 1);
      const end = new Date(now.getFullYear(), i + 1, 1);
      return { start, end, label: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][i], isCurrent: i === now.getMonth() };
    });
  })();
  const bucketValues = buckets.map((b) => sumRevenue(b.start, b.end));
  const maxValue = Math.max(1, ...bucketValues);

  // --- Top services / top clients for this period ---
  const svcAgg = {};
  periodVisits.forEach((a) => {
    const sid = a.serviceId;
    if (!sid) return;
    svcAgg[sid] = svcAgg[sid] || { count: 0, revenue: 0 };
    svcAgg[sid].count += 1;
    svcAgg[sid].revenue += apptPrice(a);
  });
  const topServices = Object.entries(svcAgg)
    .map(([sid, agg]) => ({ svc: services.find((s) => s.id === sid), ...agg }))
    .filter((x) => x.svc)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);

  const clientAgg = {};
  periodVisits.forEach((a) => {
    const cid = a.clientId;
    if (!cid || cid === "guest") return;
    clientAgg[cid] = clientAgg[cid] || { count: 0, revenue: 0 };
    clientAgg[cid].count += 1;
    clientAgg[cid].revenue += apptPrice(a);
  });
  const topClients = Object.entries(clientAgg)
    .map(([cid, agg]) => ({ client: clients.find((c) => c.id === cid), ...agg }))
    .filter((x) => x.client)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);

  // --- Delta ---
  const delta = (() => {
    if (priorTotal === 0 && periodTotal === 0) return null;
    if (priorTotal === 0) return { label: `vs $0 ${priorLabel}` };
    const pct = Math.round(((periodTotal - priorTotal) / priorTotal) * 100);
    return { up: pct >= 0, pct: Math.abs(pct), prior: priorTotal };
  })();

  const fmtMoney = (n) => `$${Math.round(n).toLocaleString()}`;

  // --- Bar chart geometry ---
  const barWidth = period === "year" ? 18 : period === "month" ? 28 : 24;
  const gap = period === "year" ? 8 : period === "month" ? 14 : 14;
  const padX = 4;
  const chartH = 160;
  const labelY = chartH + 18;
  const svgW = padX * 2 + buckets.length * (barWidth + gap) - gap;
  const svgH = labelY + 10;

  return (
    <div className="fade-up">
      {/* Inner back button — matches the ClientProfile pattern */}
      <button onClick={onBack} style={{ background: "none", color: "var(--sub)", display: "flex", alignItems: "center", gap: 6, fontSize: 14.5, marginBottom: 18 }}><ArrowLeft size={16} /> Back to Pulse</button>

      {/* Masthead */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
        <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--gold)", marginBottom: 8, fontWeight: 600 }}>REVENUE</div>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 42, fontWeight: 500, letterSpacing: -0.6, lineHeight: 0.95 }}>{period === "week" ? "This week" : period === "month" ? "This month" : "This year"}</h2>
      </div>

      {/* Period toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        {[["week", "Week"], ["month", "Month"], ["year", "Year"]].map(([id, label]) => {
          const on = period === id;
          return (
            <button key={id} onClick={() => setPeriod(id)} style={{ flex: 1, padding: "10px 14px", borderRadius: 24, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "color-mix(in srgb, var(--gold) 12%, transparent)" : "transparent", color: on ? "var(--gold)" : "var(--sub)", fontSize: 13.5, fontWeight: on ? 600 : 400, letterSpacing: 0.5, cursor: "pointer" }}>{label}</button>
          );
        })}
      </div>

      {/* Hero number */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 54, fontWeight: 500, color: "var(--text)", lineHeight: 1, letterSpacing: -1.3, marginBottom: 8 }}>
          {fmtMoney(periodTotal)}
        </div>
        {delta && (
          <div style={{ fontSize: 13.5, color: delta.up !== undefined ? (delta.up ? "var(--gold)" : "var(--sub)") : "var(--sub)", lineHeight: 1.5, marginBottom: 6 }}>
            {delta.pct !== undefined ? <>{delta.up ? "+" : "−"}{delta.pct}% vs {fmtMoney(delta.prior)} {priorLabel}</> : delta.label}
          </div>
        )}
        <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.5 }}>
          {visitCount === 0 ? "No completed visits this period yet." : <><span style={{ fontWeight: 600 }}>{fmtMoney(avgTicket)}</span> avg per visit · <span style={{ fontWeight: 600 }}>{visitCount}</span> {visitCount === 1 ? "visit" : "visits"}</>}
        </div>
      </div>

      {/* Bar chart */}
      {visitCount > 0 && (
        <div style={{ marginBottom: 36, overflowX: "auto" }}>
          <svg viewBox={`0 0 ${svgW} ${svgH}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "auto", maxHeight: 200, display: "block" }}>
            {buckets.map((b, i) => {
              const v = bucketValues[i];
              const h = (v / maxValue) * chartH;
              const x = padX + i * (barWidth + gap);
              const y = chartH - h;
              const fill = b.isCurrent ? "var(--gold)" : "color-mix(in srgb, var(--gold) 28%, var(--panel2))";
              return (
                <g key={i}>
                  {h > 0 && <rect x={x} y={y} width={barWidth} height={h} rx="3" fill={fill} />}
                  {h === 0 && <rect x={x} y={chartH - 2} width={barWidth} height={2} rx="1" fill="var(--line)" />}
                  <text x={x + barWidth / 2} y={labelY} textAnchor="middle" fontSize="11" fill={b.isCurrent ? "var(--gold)" : "var(--faint)"} fontWeight={b.isCurrent ? 600 : 400}>{b.label}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* By service */}
      {topServices.length > 0 && (
        <>
          <div style={{ height: 1, background: "var(--line)", margin: "0 0 24px" }} />
          <div style={{ marginBottom: 30 }}>
            <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--faint)", marginBottom: 16, fontWeight: 600 }}>BY SERVICE</div>
            <div style={{ display: "grid", gap: 10 }}>
              {topServices.map((row) => (
                <div key={row.svc.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14 }}>
                  <div style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 500 }}>{row.svc.name}</span>
                    <span style={{ fontSize: 13, color: "var(--faint)", marginLeft: 8 }}>{row.count}×</span>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 500, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{fmtMoney(row.revenue)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Top clients */}
      {topClients.length > 0 && (
        <>
          <div style={{ height: 1, background: "var(--line)", margin: "0 0 24px" }} />
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--faint)", marginBottom: 16, fontWeight: 600 }}>TOP CLIENTS</div>
            <div style={{ display: "grid", gap: 10 }}>
              {topClients.map((row) => (
                <div key={row.client.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14 }}>
                  <div style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 500 }}>{row.client.name}</span>
                    <span style={{ fontSize: 13, color: "var(--faint)", marginLeft: 8 }}>{row.count}×</span>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 500, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{fmtMoney(row.revenue)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Empty period state */}
      {visitCount === 0 && (
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "28px 22px", textAlign: "center", marginTop: 10 }}>
          <p style={{ color: "var(--sub)", fontSize: 14.5, lineHeight: 1.55, maxWidth: 340, margin: "0 auto" }}>Once you start completing visits in this period, revenue, top services, and top clients show up here.</p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// APPOINTMENTS — second Pulse drill-in. Volumes, no-show + cancellation
// rates, and a heatmap of which day×hour combos are most booked.
// ============================================================
function AppointmentsView({ appts, providers, services, onBack }) {
  const [period, setPeriod] = useState("month"); // "week" | "month" | "year"
  const now = new Date();

  // --- Date helpers (kept local for self-containment, same as Pulse/Revenue) ---
  const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const sow = (d) => {
    const x = sod(d);
    const day = x.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diff);
    return x;
  };
  const som = (d) => { const x = sod(d); x.setDate(1); return x; };

  // --- Period boundaries ---
  let periodStart, periodEnd;
  if (period === "week") {
    periodStart = sow(now);
    periodEnd = new Date(periodStart); periodEnd.setDate(periodEnd.getDate() + 7);
  } else if (period === "month") {
    periodStart = som(now);
    periodEnd = new Date(periodStart); periodEnd.setMonth(periodEnd.getMonth() + 1);
  } else {
    periodStart = new Date(now.getFullYear(), 0, 1);
    periodEnd = new Date(now.getFullYear() + 1, 0, 1);
  }

  const inRange = (a, start, end) => {
    if (!a.bookedFor) return false;
    const t = new Date(a.bookedFor).getTime();
    return t >= start.getTime() && t < end.getTime();
  };
  const isBlock = (a) => a.status === "block";

  // --- Filter: all real appointments in range (excludes blocks) ---
  const periodAppts = appts.filter((a) => !isBlock(a) && inRange(a, periodStart, periodEnd));

  // --- Counts by status ---
  // Booked = everything that wasn't blocked and wasn't cancelled (so: done, no-show, confirmed, checked-in, in-service all count)
  const booked = periodAppts.filter((a) => a.status !== "cancelled").length;
  const done = periodAppts.filter((a) => a.status === "done").length;
  const cancelled = periodAppts.filter((a) => a.status === "cancelled").length;
  const noShow = periodAppts.filter((a) => a.status === "no-show").length;
  // Pending = future-dated, not cancelled, not yet completed
  const pending = periodAppts.filter((a) => {
    if (a.status === "cancelled" || a.status === "done" || a.status === "no-show") return false;
    return new Date(a.bookedFor).getTime() >= now.getTime();
  }).length;

  // --- Rates (% of finished bookings) ---
  const finished = done + noShow + cancelled;
  const noShowRate = finished > 0 ? Math.round((noShow / finished) * 100) : 0;
  const cancelRate = finished > 0 ? Math.round((cancelled / finished) * 100) : 0;

  // --- Day × hour heatmap (7 rows × N hours). Only counts non-cancelled bookings. ---
  // Determine the hour range from the providers' schedules so the heatmap is right-sized for this shop.
  let minHour = 24, maxHour = 0;
  providers.forEach((p) => {
    if (p.id === "anyone") return;
    Object.values(p.hours || {}).forEach((h) => {
      if (!h?.on) return;
      const startH = Math.floor(h.start / 60);
      const endH = Math.ceil(h.end / 60);
      if (startH < minHour) minHour = startH;
      if (endH > maxHour) maxHour = endH;
    });
  });
  if (minHour === 24) { minHour = 9; maxHour = 19; } // fallback
  const hourLabels = [];
  for (let h = minHour; h < maxHour; h++) hourLabels.push(h);
  // grid[dow][hourIdx] = count
  const grid = Array.from({ length: 7 }, () => Array(hourLabels.length).fill(0));
  periodAppts.filter((a) => a.status !== "cancelled" && a.bookedFor).forEach((a) => {
    const d = new Date(a.bookedFor);
    const dow = d.getDay();
    const hr = d.getHours();
    const hourIdx = hourLabels.indexOf(hr);
    if (hourIdx >= 0) grid[dow][hourIdx] += 1;
  });
  // Re-order so Monday is first column on the chart (matches "business week")
  const dowOrder = [1, 2, 3, 4, 5, 6, 0];
  const dowLabels = ["M", "T", "W", "T", "F", "S", "S"];
  const orderedGrid = dowOrder.map((d) => grid[d]);
  const maxCell = Math.max(1, ...orderedGrid.flat());

  // --- Busiest day & hour pulled straight from the grid ---
  const dayTotals = orderedGrid.map((row, i) => ({ dow: dowOrder[i], label: dowLabels[i], total: row.reduce((a, b) => a + b, 0) }));
  const busiestDay = dayTotals.slice().sort((a, b) => b.total - a.total)[0];
  const dayFull = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hourTotals = hourLabels.map((h, i) => ({ hour: h, total: orderedGrid.reduce((sum, row) => sum + row[i], 0) }));
  const busiestHour = hourTotals.slice().sort((a, b) => b.total - a.total)[0];
  const fmtHour = (h) => { const ap = h >= 12 ? "PM" : "AM"; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12} ${ap}`; };

  // --- Heatmap geometry ---
  const cellW = 28;
  const cellH = 22;
  const gap = 3;
  const leftLabel = 36;
  const topLabel = 22;
  const gridW = leftLabel + hourLabels.length * (cellW + gap) - gap;
  const gridH = topLabel + 7 * (cellH + gap) - gap;

  const heatmapHasData = orderedGrid.flat().some((v) => v > 0);

  return (
    <div className="fade-up">
      <button onClick={onBack} style={{ background: "none", color: "var(--sub)", display: "flex", alignItems: "center", gap: 6, fontSize: 14.5, marginBottom: 18 }}><ArrowLeft size={16} /> Back to Pulse</button>

      {/* Masthead */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
        <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--gold)", marginBottom: 8, fontWeight: 600 }}>APPOINTMENTS</div>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 42, fontWeight: 500, letterSpacing: -0.6, lineHeight: 0.95 }}>{period === "week" ? "This week" : period === "month" ? "This month" : "This year"}</h2>
      </div>

      {/* Period toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        {[["week", "Week"], ["month", "Month"], ["year", "Year"]].map(([id, label]) => {
          const on = period === id;
          return (
            <button key={id} onClick={() => setPeriod(id)} style={{ flex: 1, padding: "10px 14px", borderRadius: 24, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "color-mix(in srgb, var(--gold) 12%, transparent)" : "transparent", color: on ? "var(--gold)" : "var(--sub)", fontSize: 13.5, fontWeight: on ? 600 : 400, letterSpacing: 0.5, cursor: "pointer" }}>{label}</button>
          );
        })}
      </div>

      {/* Hero number — total booked */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 54, fontWeight: 500, color: "var(--text)", lineHeight: 1, letterSpacing: -1.3, marginBottom: 8 }}>
          {booked}
        </div>
        <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.5 }}>
          {booked === 0 ? "No appointments this period." : <>{booked === 1 ? "appointment booked" : "appointments booked"}{pending > 0 && <> · <span style={{ fontWeight: 600 }}>{pending}</span> still upcoming</>}</>}
        </div>
      </div>

      {/* Breakdown — quick row of counts */}
      {periodAppts.length > 0 && (
        <>
          <div style={{ height: 1, background: "var(--line)", margin: "0 0 24px" }} />
          <div style={{ marginBottom: 30 }}>
            <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--faint)", marginBottom: 16, fontWeight: 600 }}>BREAKDOWN</div>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 13.5, color: "var(--sub)", fontStyle: "italic" }}>Completed</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500 }}>{done}</span>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 13.5, color: "var(--sub)", fontStyle: "italic" }}>Cancelled</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500 }}>{cancelled}</span>
                  {cancelRate > 0 && <span style={{ fontSize: 12.5, color: "var(--faint)" }}>{cancelRate}% of finished</span>}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 13.5, color: "var(--sub)", fontStyle: "italic" }}>No-shows</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500, color: noShow > 0 ? "var(--gold)" : "var(--text)" }}>{noShow}</span>
                  {noShowRate > 0 && <span style={{ fontSize: 12.5, color: noShow > 0 ? "var(--gold)" : "var(--faint)", fontWeight: noShow > 0 ? 600 : 400 }}>{noShowRate}% of finished</span>}
                </div>
              </div>
              {pending > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontSize: 13.5, color: "var(--sub)", fontStyle: "italic" }}>Upcoming</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500 }}>{pending}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* When */}
      {heatmapHasData && (
        <>
          <div style={{ height: 1, background: "var(--line)", margin: "0 0 24px" }} />
          <div style={{ marginBottom: 26 }}>
            <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--faint)", marginBottom: 6, fontWeight: 600 }}>WHEN</div>
            <div style={{ fontSize: 14, color: "var(--text2)", marginBottom: 18, lineHeight: 1.5 }}>
              Busiest is <span style={{ fontWeight: 600 }}>{dayFull[busiestDay.dow]}</span>
              {busiestHour && busiestHour.total > 0 && <> around <span style={{ fontWeight: 600 }}>{fmtHour(busiestHour.hour)}</span></>}.
            </div>

            {/* Heatmap */}
            <div style={{ overflowX: "auto", paddingBottom: 6 }}>
              <svg viewBox={`0 0 ${gridW} ${gridH}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "auto", maxHeight: 240, display: "block", minWidth: 320 }}>
                {/* Hour labels along the top */}
                {hourLabels.map((h, i) => (
                  <text key={`h-${i}`} x={leftLabel + i * (cellW + gap) + cellW / 2} y={topLabel - 8} textAnchor="middle" fontSize="9" fill="var(--faint)">{h % 12 === 0 ? 12 : h % 12}{h >= 12 ? "p" : "a"}</text>
                ))}
                {/* Day labels along the left */}
                {dowLabels.map((lbl, i) => (
                  <text key={`d-${i}`} x={leftLabel - 10} y={topLabel + i * (cellH + gap) + cellH / 2 + 3} textAnchor="end" fontSize="11" fill="var(--faint)">{lbl}</text>
                ))}
                {/* Cells */}
                {orderedGrid.map((row, di) => row.map((v, hi) => {
                  const x = leftLabel + hi * (cellW + gap);
                  const y = topLabel + di * (cellH + gap);
                  // Color ramp: empty cells barely visible, busiest cells full gold.
                  const intensity = v === 0 ? 0 : Math.max(0.15, v / maxCell);
                  const fill = v === 0 ? "var(--panel2)" : `color-mix(in srgb, var(--gold) ${Math.round(intensity * 100)}%, var(--panel2))`;
                  return (
                    <g key={`c-${di}-${hi}`}>
                      <rect x={x} y={y} width={cellW} height={cellH} rx="3" fill={fill} />
                      {v > 0 && <text x={x + cellW / 2} y={y + cellH / 2 + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill={intensity > 0.55 ? "var(--on-gold)" : "var(--text)"}>{v}</text>}
                    </g>
                  );
                }))}
              </svg>
            </div>
          </div>
        </>
      )}

      {/* Empty period state */}
      {periodAppts.length === 0 && (
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "28px 22px", textAlign: "center", marginTop: 10 }}>
          <p style={{ color: "var(--sub)", fontSize: 14.5, lineHeight: 1.55, maxWidth: 340, margin: "0 auto" }}>Once you have appointments in this period, breakdowns and the busiest-times heatmap show up here.</p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// CLIENTS REPORT — third Pulse drill-in. Health metrics for the
// client base: new vs returning, retention, top by visits + revenue,
// lapsed list (with a direct path to the nudge folder).
// ============================================================
function ClientsReportView({ appts, clients, services, providers, onBack, onOpenNudge }) {
  const [period, setPeriod] = useState("month"); // "week" | "month" | "year"
  const now = new Date();

  // --- Same date helpers as the other reports ---
  const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const sow = (d) => {
    const x = sod(d);
    const day = x.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diff);
    return x;
  };
  const som = (d) => { const x = sod(d); x.setDate(1); return x; };

  // --- Price-per-appt for revenue rankings ---
  const apptPrice = (a) => {
    if (a.lineItems && a.lineItems.length) {
      return a.lineItems.reduce((sum, li) => {
        const s = services.find((x) => x.id === li.serviceId);
        return sum + (s ? getPrice(s, a.providerId) : 0);
      }, 0);
    }
    const s = services.find((x) => x.id === a.serviceId);
    return s ? getPrice(s, a.providerId) : 0;
  };

  // --- Period boundaries (this + prior) ---
  let periodStart, periodEnd, priorStart, priorEnd;
  if (period === "week") {
    periodStart = sow(now);
    periodEnd = new Date(periodStart); periodEnd.setDate(periodEnd.getDate() + 7);
    priorStart = new Date(periodStart); priorStart.setDate(priorStart.getDate() - 7);
    priorEnd = new Date(periodStart);
  } else if (period === "month") {
    periodStart = som(now);
    periodEnd = new Date(periodStart); periodEnd.setMonth(periodEnd.getMonth() + 1);
    priorStart = new Date(periodStart); priorStart.setMonth(priorStart.getMonth() - 1);
    priorEnd = new Date(periodStart);
  } else {
    periodStart = new Date(now.getFullYear(), 0, 1);
    periodEnd = new Date(now.getFullYear() + 1, 0, 1);
    priorStart = new Date(now.getFullYear() - 1, 0, 1);
    priorEnd = new Date(now.getFullYear(), 0, 1);
  }

  const inRange = (a, start, end) => {
    if (!a.bookedFor) return false;
    const t = new Date(a.bookedFor).getTime();
    return t >= start.getTime() && t < end.getTime();
  };
  const isCountable = (a) => a.status !== "block" && a.status !== "cancelled" && a.status !== "no-show";

  // --- Appointments grouped by client across all history (needed for "first visit ever" + retention) ---
  const apptsByClient = {};
  appts.forEach((a) => {
    if (a.status === "block" || !a.clientId || a.clientId === "guest") return;
    apptsByClient[a.clientId] = apptsByClient[a.clientId] || [];
    apptsByClient[a.clientId].push(a);
  });
  Object.keys(apptsByClient).forEach((cid) => {
    apptsByClient[cid].sort((a, b) => new Date(a.bookedFor) - new Date(b.bookedFor));
  });

  // --- New vs returning for this period ---
  // A client is "new this period" if their FIRST appointment ever falls within this period.
  // Otherwise they're "returning" (had any prior appointment before the period).
  const periodAppts = appts.filter((a) => isCountable(a) && inRange(a, periodStart, periodEnd) && a.clientId && a.clientId !== "guest");
  const seenClientsThisPeriod = new Set(periodAppts.map((a) => a.clientId));
  let newThisPeriod = 0;
  let returningThisPeriod = 0;
  seenClientsThisPeriod.forEach((cid) => {
    const list = apptsByClient[cid] || [];
    const first = list[0];
    if (!first) return;
    const firstTime = new Date(first.bookedFor).getTime();
    if (firstTime >= periodStart.getTime() && firstTime < periodEnd.getTime()) {
      newThisPeriod += 1;
    } else {
      returningThisPeriod += 1;
    }
  });
  const totalActive = newThisPeriod + returningThisPeriod;

  // --- 60-day retention: of clients whose first-ever visit was 60-180 days ago,
  //     what % came back within 60 days of that first visit? Window is rolling. ---
  const sixtyDays = 60 * 24 * 60 * 60 * 1000;
  const cohortEnd = new Date(now.getTime() - sixtyDays); // first visit must be at least 60d ago
  const cohortStart = new Date(now.getTime() - 3 * sixtyDays); // and not older than 180d (so the metric stays current)
  let cohortSize = 0;
  let cohortReturned = 0;
  Object.keys(apptsByClient).forEach((cid) => {
    const list = apptsByClient[cid];
    if (!list.length) return;
    const first = new Date(list[0].bookedFor).getTime();
    if (first < cohortStart.getTime() || first >= cohortEnd.getTime()) return;
    cohortSize += 1;
    // Did they have any other appt within 60 days of the first?
    const within = list.slice(1).some((a) => {
      const t = new Date(a.bookedFor).getTime();
      return t > first && (t - first) <= sixtyDays;
    });
    if (within) cohortReturned += 1;
  });
  const retentionPct = cohortSize > 0 ? Math.round((cohortReturned / cohortSize) * 100) : null;

  // --- Total clients on file (excludes blocked) ---
  const totalClients = clients.filter((c) => !c.blocked).length;

  // --- Top by visits (lifetime) and by revenue this period ---
  const visitCounts = {};
  Object.keys(apptsByClient).forEach((cid) => {
    visitCounts[cid] = apptsByClient[cid].filter((a) => a.status === "done").length;
  });
  const topByVisits = Object.entries(visitCounts)
    .map(([cid, count]) => ({ client: clients.find((c) => c.id === cid), count }))
    .filter((x) => x.client && x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const revByClient = {};
  periodAppts.filter((a) => a.status === "done").forEach((a) => {
    revByClient[a.clientId] = (revByClient[a.clientId] || 0) + apptPrice(a);
  });
  const topByRevenue = Object.entries(revByClient)
    .map(([cid, revenue]) => ({ client: clients.find((c) => c.id === cid), revenue }))
    .filter((x) => x.client && x.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);

  // --- Lapsed (overdue-to-rebook) — same logic as the nudge folder for consistency ---
  const lapsed = clients.filter((c) => {
    if (c.blocked) return false;
    if (!c.cadenceDays || !c.lastVisit) return false;
    if (c.nudgeDismissedAt && new Date(c.nudgeDismissedAt) > new Date(c.lastVisit)) return false;
    const days = Math.round((Date.now() - new Date(c.lastVisit)) / 86400000);
    return (days - c.cadenceDays) > 0;
  });

  const fmtMoney = (n) => `$${Math.round(n).toLocaleString()}`;

  return (
    <div className="fade-up">
      <button onClick={onBack} style={{ background: "none", color: "var(--sub)", display: "flex", alignItems: "center", gap: 6, fontSize: 14.5, marginBottom: 18 }}><ArrowLeft size={16} /> Back to Pulse</button>

      {/* Masthead */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
        <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--gold)", marginBottom: 8, fontWeight: 600 }}>CLIENTS</div>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 42, fontWeight: 500, letterSpacing: -0.6, lineHeight: 0.95 }}>{period === "week" ? "This week" : period === "month" ? "This month" : "This year"}</h2>
      </div>

      {/* Period toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        {[["week", "Week"], ["month", "Month"], ["year", "Year"]].map(([id, label]) => {
          const on = period === id;
          return (
            <button key={id} onClick={() => setPeriod(id)} style={{ flex: 1, padding: "10px 14px", borderRadius: 24, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "color-mix(in srgb, var(--gold) 12%, transparent)" : "transparent", color: on ? "var(--gold)" : "var(--sub)", fontSize: 13.5, fontWeight: on ? 600 : 400, letterSpacing: 0.5, cursor: "pointer" }}>{label}</button>
          );
        })}
      </div>

      {/* Hero — clients seen this period */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 54, fontWeight: 500, color: "var(--text)", lineHeight: 1, letterSpacing: -1.3, marginBottom: 8 }}>
          {totalActive}
        </div>
        <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.5 }}>
          {totalActive === 0 ? "No client visits this period yet." : <>{totalActive === 1 ? "client seen" : "clients seen"} · <span style={{ fontWeight: 600 }}>{totalClients}</span> total on file</>}
        </div>
      </div>

      {/* NEW vs RETURNING bar */}
      {totalActive > 0 && (
        <>
          <div style={{ height: 1, background: "var(--line)", margin: "0 0 24px" }} />
          <div style={{ marginBottom: 30 }}>
            <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--faint)", marginBottom: 16, fontWeight: 600 }}>NEW vs RETURNING</div>
            {/* Visual split bar */}
            <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--panel2)", marginBottom: 16 }}>
              {newThisPeriod > 0 && <div style={{ flex: newThisPeriod, background: "var(--gold)" }} />}
              {returningThisPeriod > 0 && <div style={{ flex: returningThisPeriod, background: "color-mix(in srgb, var(--gold) 35%, var(--panel2))" }} />}
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--gold)" }} />
                  <span style={{ fontSize: 13.5, color: "var(--sub)", fontStyle: "italic" }}>New</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500 }}>{newThisPeriod}</span>
                  <span style={{ fontSize: 12.5, color: "var(--faint)" }}>{Math.round((newThisPeriod / totalActive) * 100)}%</span>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: "color-mix(in srgb, var(--gold) 35%, var(--panel2))" }} />
                  <span style={{ fontSize: 13.5, color: "var(--sub)", fontStyle: "italic" }}>Returning</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500 }}>{returningThisPeriod}</span>
                  <span style={{ fontSize: 12.5, color: "var(--faint)" }}>{Math.round((returningThisPeriod / totalActive) * 100)}%</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* RETENTION */}
      {retentionPct !== null && (
        <>
          <div style={{ height: 1, background: "var(--line)", margin: "0 0 24px" }} />
          <div style={{ marginBottom: 30 }}>
            <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--faint)", marginBottom: 16, fontWeight: 600 }}>RETENTION</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 8 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 42, fontWeight: 500, lineHeight: 1, letterSpacing: -1, color: retentionPct >= 60 ? "var(--gold)" : "var(--text)" }}>{retentionPct}%</div>
              <div style={{ fontSize: 13.5, color: "var(--sub)", lineHeight: 1.5 }}>of first-timers came back within 60 days</div>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--faint)", lineHeight: 1.5 }}>Based on {cohortSize} {cohortSize === 1 ? "client whose" : "clients whose"} first visit was 60–180 days ago.</div>
          </div>
        </>
      )}

      {/* LAPSED CTA */}
      {lapsed.length > 0 && (
        <>
          <div style={{ height: 1, background: "var(--line)", margin: "0 0 22px" }} />
          <button onClick={onOpenNudge} className="lift" style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "color-mix(in srgb, var(--gold) 10%, var(--panel))", border: "1px solid color-mix(in srgb, var(--gold) 30%, var(--border))", borderRadius: 14, padding: "16px 18px", color: "var(--text)", cursor: "pointer", marginBottom: 30 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Bell size={17} style={{ color: "var(--gold)" }} />
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{lapsed.length} client{lapsed.length > 1 ? "s" : ""} overdue to rebook</div>
                <div style={{ fontSize: 13, color: "var(--sub)" }}>Open the nudge folder</div>
              </div>
            </div>
            <ChevronRight size={18} style={{ color: "var(--faint)" }} />
          </button>
        </>
      )}

      {/* TOP BY VISITS */}
      {topByVisits.length > 0 && (
        <>
          <div style={{ height: 1, background: "var(--line)", margin: "0 0 24px" }} />
          <div style={{ marginBottom: 30 }}>
            <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--faint)", marginBottom: 16, fontWeight: 600 }}>MOST VISITS (LIFETIME)</div>
            <div style={{ display: "grid", gap: 10 }}>
              {topByVisits.map((row) => (
                <div key={row.client.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14 }}>
                  <div style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 500 }}>{row.client.name}</div>
                  <div style={{ fontSize: 15, fontWeight: 500, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{row.count} {row.count === 1 ? "visit" : "visits"}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* TOP BY REVENUE */}
      {topByRevenue.length > 0 && (
        <>
          <div style={{ height: 1, background: "var(--line)", margin: "0 0 24px" }} />
          <div style={{ marginBottom: 30 }}>
            <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--faint)", marginBottom: 16, fontWeight: 600 }}>HIGHEST SPEND ({period === "week" ? "THIS WEEK" : period === "month" ? "THIS MONTH" : "THIS YEAR"})</div>
            <div style={{ display: "grid", gap: 10 }}>
              {topByRevenue.map((row) => (
                <div key={row.client.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14 }}>
                  <div style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 500 }}>{row.client.name}</div>
                  <div style={{ fontSize: 15, fontWeight: 500, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{fmtMoney(row.revenue)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {totalActive === 0 && lapsed.length === 0 && topByVisits.length === 0 && (
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "28px 22px", textAlign: "center", marginTop: 10 }}>
          <p style={{ color: "var(--sub)", fontSize: 14.5, lineHeight: 1.55, maxWidth: 340, margin: "0 auto" }}>Once clients book and visit, you'll see new vs returning split, retention rate, and your top clients here.</p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SERVICE MIX — fourth Pulse drill-in. The "what to push" report:
// which services drive revenue, which are highest-margin by time
// (rev-per-hour), which run most often, and what's idle.
// ============================================================
function ServiceMixView({ appts, services, providers, onBack }) {
  const [period, setPeriod] = useState("month");
  const [sortBy, setSortBy] = useState("revenue"); // "revenue" | "visits" | "perhour"
  const now = new Date();

  const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const sow = (d) => {
    const x = sod(d);
    const day = x.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diff);
    return x;
  };
  const som = (d) => { const x = sod(d); x.setDate(1); return x; };

  const apptPrice = (a) => {
    if (a.lineItems && a.lineItems.length) {
      return a.lineItems.reduce((sum, li) => {
        const s = services.find((x) => x.id === li.serviceId);
        return sum + (s ? getPrice(s, a.providerId) : 0);
      }, 0);
    }
    const s = services.find((x) => x.id === a.serviceId);
    return s ? getPrice(s, a.providerId) : 0;
  };

  let periodStart, periodEnd;
  if (period === "week") {
    periodStart = sow(now);
    periodEnd = new Date(periodStart); periodEnd.setDate(periodEnd.getDate() + 7);
  } else if (period === "month") {
    periodStart = som(now);
    periodEnd = new Date(periodStart); periodEnd.setMonth(periodEnd.getMonth() + 1);
  } else {
    periodStart = new Date(now.getFullYear(), 0, 1);
    periodEnd = new Date(now.getFullYear() + 1, 0, 1);
  }

  const inRange = (a, start, end) => {
    if (!a.bookedFor) return false;
    const t = new Date(a.bookedFor).getTime();
    return t >= start.getTime() && t < end.getTime();
  };
  const isRevenue = (a) => a.status === "done";

  // Aggregate per-service: visits, revenue, minutes
  const agg = {};
  appts.filter((a) => isRevenue(a) && inRange(a, periodStart, periodEnd)).forEach((a) => {
    // Honor line items if present — splits the appt into its components.
    const items = (a.lineItems && a.lineItems.length) ? a.lineItems.map((li) => ({ sid: li.serviceId, mins: (li.duration != null ? li.duration : 0) })) : [{ sid: a.serviceId, mins: (a.end - a.start) }];
    items.forEach((it) => {
      if (!it.sid) return;
      const svc = services.find((s) => s.id === it.sid);
      if (!svc) return;
      const r = getPrice(svc, a.providerId) || 0;
      const m = it.mins || svc.duration || 0;
      agg[it.sid] = agg[it.sid] || { svc, visits: 0, revenue: 0, minutes: 0 };
      agg[it.sid].visits += 1;
      agg[it.sid].revenue += r;
      agg[it.sid].minutes += m;
    });
  });

  // Add idle services (real services with zero activity this period) so user can see what's NOT working too
  services.filter((s) => !s.hidden).forEach((s) => {
    if (!agg[s.id]) agg[s.id] = { svc: s, visits: 0, revenue: 0, minutes: 0 };
  });

  // Derive rev-per-hour for each
  const rows = Object.values(agg).map((row) => ({
    ...row,
    perHour: row.minutes > 0 ? (row.revenue / row.minutes) * 60 : 0,
  }));

  // Totals (only the active rows, not idle)
  const activeRows = rows.filter((r) => r.visits > 0);
  const totalRevenue = activeRows.reduce((sum, r) => sum + r.revenue, 0);
  const totalVisits = activeRows.reduce((sum, r) => sum + r.visits, 0);
  const totalMinutes = activeRows.reduce((sum, r) => sum + r.minutes, 0);
  const avgPerHour = totalMinutes > 0 ? (totalRevenue / totalMinutes) * 60 : 0;

  // Sort according to current toggle
  const sortedActive = activeRows.slice().sort((a, b) => {
    if (sortBy === "visits") return b.visits - a.visits;
    if (sortBy === "perhour") return b.perHour - a.perHour;
    return b.revenue - a.revenue;
  });
  const idleRows = rows.filter((r) => r.visits === 0).sort((a, b) => a.svc.name.localeCompare(b.svc.name));

  // Top service highlights (the "what to push" headline)
  const topByRevenue = activeRows.slice().sort((a, b) => b.revenue - a.revenue)[0];
  const topByPerHour = activeRows.slice().sort((a, b) => b.perHour - a.perHour)[0];

  const fmtMoney = (n) => `$${Math.round(n).toLocaleString()}`;
  const fmtMoneyDec = (n) => `$${n.toFixed(n < 10 ? 2 : 0)}`;
  const maxBarValue = sortedActive.length ? (
    sortBy === "visits" ? Math.max(...sortedActive.map((r) => r.visits)) :
    sortBy === "perhour" ? Math.max(...sortedActive.map((r) => r.perHour)) :
    Math.max(...sortedActive.map((r) => r.revenue))
  ) : 1;
  const valueFor = (r) => sortBy === "visits" ? r.visits : sortBy === "perhour" ? r.perHour : r.revenue;
  const labelFor = (r) => sortBy === "visits" ? `${r.visits}×` : sortBy === "perhour" ? `${fmtMoneyDec(r.perHour)}/hr` : fmtMoney(r.revenue);

  return (
    <div className="fade-up">
      <button onClick={onBack} style={{ background: "none", color: "var(--sub)", display: "flex", alignItems: "center", gap: 6, fontSize: 14.5, marginBottom: 18 }}><ArrowLeft size={16} /> Back to Pulse</button>

      {/* Masthead */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
        <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--gold)", marginBottom: 8, fontWeight: 600 }}>SERVICE MIX</div>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 42, fontWeight: 500, letterSpacing: -0.6, lineHeight: 0.95 }}>{period === "week" ? "This week" : period === "month" ? "This month" : "This year"}</h2>
      </div>

      {/* Period toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        {[["week", "Week"], ["month", "Month"], ["year", "Year"]].map(([id, label]) => {
          const on = period === id;
          return (
            <button key={id} onClick={() => setPeriod(id)} style={{ flex: 1, padding: "10px 14px", borderRadius: 24, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "color-mix(in srgb, var(--gold) 12%, transparent)" : "transparent", color: on ? "var(--gold)" : "var(--sub)", fontSize: 13.5, fontWeight: on ? 600 : 400, letterSpacing: 0.5, cursor: "pointer" }}>{label}</button>
          );
        })}
      </div>

      {/* Hero — total visits, total revenue, avg rev/hr */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 54, fontWeight: 500, color: "var(--text)", lineHeight: 1, letterSpacing: -1.3, marginBottom: 8 }}>
          {totalVisits}
        </div>
        <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.5 }}>
          {totalVisits === 0 ? "No completed services this period yet." : <>{totalVisits === 1 ? "service performed" : "services performed"} · <span style={{ fontWeight: 600 }}>{fmtMoney(totalRevenue)}</span> total{avgPerHour > 0 && <> · <span style={{ fontWeight: 600 }}>{fmtMoneyDec(avgPerHour)}/hr</span> avg</>}</>}
        </div>
      </div>

      {/* WHAT'S WORKING — editorial callouts for the standout services */}
      {(topByRevenue || topByPerHour) && (
        <>
          <div style={{ height: 1, background: "var(--line)", margin: "0 0 24px" }} />
          <div style={{ marginBottom: 30 }}>
            <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--faint)", marginBottom: 16, fontWeight: 600 }}>WHAT'S WORKING</div>
            <div style={{ display: "grid", gap: 14 }}>
              {topByRevenue && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14 }}>
                  <div style={{ fontSize: 13.5, color: "var(--sub)", fontStyle: "italic", flexShrink: 0 }}>Top earner</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{topByRevenue.svc.name}</div>
                    <div style={{ fontSize: 13, color: "var(--faint)", flexShrink: 0 }}>{fmtMoney(topByRevenue.revenue)}</div>
                  </div>
                </div>
              )}
              {topByPerHour && topByPerHour.svc.id !== (topByRevenue && topByRevenue.svc.id) && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14 }}>
                  <div style={{ fontSize: 13.5, color: "var(--sub)", fontStyle: "italic", flexShrink: 0 }}>Best per hour</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{topByPerHour.svc.name}</div>
                    <div style={{ fontSize: 13, color: "var(--faint)", flexShrink: 0 }}>{fmtMoneyDec(topByPerHour.perHour)}/hr</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Sort toggle + ranked list */}
      {sortedActive.length > 0 && (
        <>
          <div style={{ height: 1, background: "var(--line)", margin: "0 0 18px" }} />
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--faint)", marginBottom: 12, fontWeight: 600 }}>RANKED BY</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              {[["revenue", "Revenue"], ["visits", "Visits"], ["perhour", "$ per hour"]].map(([id, label]) => {
                const on = sortBy === id;
                return (
                  <button key={id} onClick={() => setSortBy(id)} style={{ flex: 1, padding: "9px 10px", borderRadius: 20, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "color-mix(in srgb, var(--gold) 12%, transparent)" : "transparent", color: on ? "var(--gold)" : "var(--sub)", fontSize: 12.5, fontWeight: on ? 600 : 400, letterSpacing: 0.3, cursor: "pointer" }}>{label}</button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "grid", gap: 14, marginBottom: 32 }}>
            {sortedActive.map((row) => {
              const pct = maxBarValue > 0 ? (valueFor(row) / maxBarValue) * 100 : 0;
              return (
                <div key={row.svc.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, marginBottom: 6 }}>
                    <div style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 500 }}>{row.svc.name}</div>
                    <div style={{ fontSize: 14, fontWeight: 500, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{labelFor(row)}</div>
                  </div>
                  <div style={{ height: 5, background: "var(--panel2)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: "var(--gold)" }} />
                  </div>
                  {/* Secondary line — shows the other two metrics for context */}
                  <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 5 }}>
                    {sortBy !== "revenue" && <>{fmtMoney(row.revenue)} · </>}
                    {sortBy !== "visits" && <>{row.visits}×{row.perHour > 0 && sortBy !== "perhour" && " · "}</>}
                    {sortBy !== "perhour" && row.perHour > 0 && <>{fmtMoneyDec(row.perHour)}/hr</>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* IDLE — services with zero activity this period (only shown if there are any) */}
      {idleRows.length > 0 && sortedActive.length > 0 && (
        <>
          <div style={{ height: 1, background: "var(--line)", margin: "0 0 24px" }} />
          <div style={{ marginBottom: 30 }}>
            <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--faint)", marginBottom: 8, fontWeight: 600 }}>IDLE THIS PERIOD</div>
            <div style={{ fontSize: 12.5, color: "var(--faint)", marginBottom: 14, lineHeight: 1.5 }}>Services on your menu that haven't been booked.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {idleRows.map((row) => (
                <span key={row.svc.id} style={{ fontSize: 13, color: "var(--sub)", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: "5px 11px" }}>{row.svc.name}</span>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {sortedActive.length === 0 && (
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "28px 22px", textAlign: "center", marginTop: 10 }}>
          <p style={{ color: "var(--sub)", fontSize: 14.5, lineHeight: 1.55, maxWidth: 340, margin: "0 auto" }}>Once services are completed (marked done) this period, you'll see which ones drive revenue, visits, and the highest dollar-per-hour here.</p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// PER-BARBER — fifth Pulse drill-in. Each provider's revenue,
// occupancy, no-show rate, top service, and 60-day retention.
// Useful from day one if you've got more than one person on the chair.
// ============================================================
function PerBarberView({ appts, clients, services, providers, onBack }) {
  const [period, setPeriod] = useState("month");
  const now = new Date();

  const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const sow = (d) => {
    const x = sod(d);
    const day = x.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diff);
    return x;
  };
  const som = (d) => { const x = sod(d); x.setDate(1); return x; };

  const apptPrice = (a) => {
    if (a.lineItems && a.lineItems.length) {
      return a.lineItems.reduce((sum, li) => {
        const s = services.find((x) => x.id === li.serviceId);
        return sum + (s ? getPrice(s, a.providerId) : 0);
      }, 0);
    }
    const s = services.find((x) => x.id === a.serviceId);
    return s ? getPrice(s, a.providerId) : 0;
  };

  let periodStart, periodEnd;
  if (period === "week") {
    periodStart = sow(now);
    periodEnd = new Date(periodStart); periodEnd.setDate(periodEnd.getDate() + 7);
  } else if (period === "month") {
    periodStart = som(now);
    periodEnd = new Date(periodStart); periodEnd.setMonth(periodEnd.getMonth() + 1);
  } else {
    periodStart = new Date(now.getFullYear(), 0, 1);
    periodEnd = new Date(now.getFullYear() + 1, 0, 1);
  }

  const inRange = (a, start, end) => {
    if (!a.bookedFor) return false;
    const t = new Date(a.bookedFor).getTime();
    return t >= start.getTime() && t < end.getTime();
  };

  // Bookable minutes for a provider in the period — from their schedule
  const bookableMinutes = (prov, start, end) => {
    if (prov.id === "anyone") return 0;
    let total = 0;
    const cursor = new Date(start);
    while (cursor < end) {
      const dow = cursor.getDay();
      const h = prov.hours?.[dow];
      if (h?.on) total += (h.end - h.start);
      cursor.setDate(cursor.getDate() + 1);
    }
    return total;
  };

  // Real barbers only — skip the "Anyone" placeholder which routes to whoever
  const realProviders = providers.filter((p) => p.id !== "anyone");

  // Build per-provider stats
  const rows = realProviders.map((prov) => {
    const myAppts = appts.filter((a) => a.providerId === prov.id && a.status !== "block" && inRange(a, periodStart, periodEnd));
    const done = myAppts.filter((a) => a.status === "done");
    const cancelled = myAppts.filter((a) => a.status === "cancelled").length;
    const noShow = myAppts.filter((a) => a.status === "no-show").length;
    const finished = done.length + noShow + cancelled;
    const noShowRate = finished > 0 ? Math.round((noShow / finished) * 100) : 0;

    const revenue = done.reduce((sum, a) => sum + apptPrice(a), 0);
    const bookedMin = myAppts.filter((a) => a.status !== "cancelled").reduce((sum, a) => sum + (a.end - a.start), 0);
    const totalBookableMin = bookableMinutes(prov, periodStart, periodEnd);
    const occupancyPct = totalBookableMin > 0 ? Math.round((bookedMin / totalBookableMin) * 100) : 0;

    // Top service for this provider
    const svcCount = {};
    done.forEach((a) => {
      if (!a.serviceId) return;
      svcCount[a.serviceId] = (svcCount[a.serviceId] || 0) + 1;
    });
    const topSvcEntry = Object.entries(svcCount).sort(([, x], [, y]) => y - x)[0];
    const topService = topSvcEntry ? { svc: services.find((s) => s.id === topSvcEntry[0]), count: topSvcEntry[1] } : null;

    // 60-day retention for THIS provider's clients only:
    // of clients whose first visit with this barber was 60–180 days ago,
    // what % came back to this barber within 60 days of that first visit?
    const sixtyDays = 60 * 24 * 60 * 60 * 1000;
    const cohortEnd = new Date(now.getTime() - sixtyDays);
    const cohortStart = new Date(now.getTime() - 3 * sixtyDays);
    // Group THIS provider's appointments by client
    const apptsByClient = {};
    appts.filter((a) => a.providerId === prov.id && a.status !== "block" && a.clientId && a.clientId !== "guest").forEach((a) => {
      apptsByClient[a.clientId] = apptsByClient[a.clientId] || [];
      apptsByClient[a.clientId].push(a);
    });
    Object.keys(apptsByClient).forEach((cid) => {
      apptsByClient[cid].sort((a, b) => new Date(a.bookedFor) - new Date(b.bookedFor));
    });
    let cohortSize = 0;
    let cohortReturned = 0;
    Object.keys(apptsByClient).forEach((cid) => {
      const list = apptsByClient[cid];
      if (!list.length) return;
      const first = new Date(list[0].bookedFor).getTime();
      if (first < cohortStart.getTime() || first >= cohortEnd.getTime()) return;
      cohortSize += 1;
      const within = list.slice(1).some((a) => {
        const t = new Date(a.bookedFor).getTime();
        return t > first && (t - first) <= sixtyDays;
      });
      if (within) cohortReturned += 1;
    });
    const retentionPct = cohortSize > 0 ? Math.round((cohortReturned / cohortSize) * 100) : null;

    return {
      prov,
      visits: done.length,
      revenue,
      occupancyPct,
      noShow,
      noShowRate,
      cancelled,
      topService,
      retentionPct,
      cohortSize,
    };
  });

  // Sort by revenue desc
  rows.sort((a, b) => b.revenue - a.revenue);

  // Totals across the team
  const teamRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
  const teamVisits = rows.reduce((sum, r) => sum + r.visits, 0);

  const fmtMoney = (n) => `$${Math.round(n).toLocaleString()}`;
  const maxRevenue = Math.max(1, ...rows.map((r) => r.revenue));

  return (
    <div className="fade-up">
      <button onClick={onBack} style={{ background: "none", color: "var(--sub)", display: "flex", alignItems: "center", gap: 6, fontSize: 14.5, marginBottom: 18 }}><ArrowLeft size={16} /> Back to Pulse</button>

      {/* Masthead */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
        <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--gold)", marginBottom: 8, fontWeight: 600 }}>PER BARBER</div>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 42, fontWeight: 500, letterSpacing: -0.6, lineHeight: 0.95 }}>{period === "week" ? "This week" : period === "month" ? "This month" : "This year"}</h2>
      </div>

      {/* Period toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        {[["week", "Week"], ["month", "Month"], ["year", "Year"]].map(([id, label]) => {
          const on = period === id;
          return (
            <button key={id} onClick={() => setPeriod(id)} style={{ flex: 1, padding: "10px 14px", borderRadius: 24, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "color-mix(in srgb, var(--gold) 12%, transparent)" : "transparent", color: on ? "var(--gold)" : "var(--sub)", fontSize: 13.5, fontWeight: on ? 600 : 400, letterSpacing: 0.5, cursor: "pointer" }}>{label}</button>
          );
        })}
      </div>

      {/* Team total — hero */}
      {realProviders.length > 1 && teamVisits > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 54, fontWeight: 500, color: "var(--text)", lineHeight: 1, letterSpacing: -1.3, marginBottom: 8 }}>
            {fmtMoney(teamRevenue)}
          </div>
          <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.5 }}>
            team total · <span style={{ fontWeight: 600 }}>{teamVisits}</span> {teamVisits === 1 ? "visit" : "visits"} across {realProviders.length} {realProviders.length === 1 ? "barber" : "barbers"}
          </div>
        </div>
      )}

      {/* Per-barber cards */}
      {rows.length > 0 ? (
        <div style={{ display: "grid", gap: 18 }}>
          {rows.map((r) => {
            const pct = maxRevenue > 0 ? (r.revenue / maxRevenue) * 100 : 0;
            return (
              <div key={r.prov.id} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "18px 18px 20px" }}>
                {/* Barber row */}
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                  <Avatar size={42} initial={r.prov.name.charAt(0)} color={r.prov.color} photo={r.prov.photo} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 500, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.prov.name}</div>
                    {r.prov.role && <div style={{ fontSize: 13, color: "var(--sub)" }}>{r.prov.role}</div>}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 500, lineHeight: 1 }}>{fmtMoney(r.revenue)}</div>
                    <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 3 }}>{r.visits} {r.visits === 1 ? "visit" : "visits"}</div>
                  </div>
                </div>

                {/* Revenue bar — relative to top earner */}
                {r.revenue > 0 && (
                  <div style={{ height: 4, background: "var(--panel2)", borderRadius: 2, overflow: "hidden", marginBottom: 18 }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: "var(--gold)" }} />
                  </div>
                )}

                {/* Stats grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 18px" }}>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, color: "var(--faint)", marginBottom: 4, fontWeight: 600 }}>OCCUPANCY</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 500 }}>{r.occupancyPct}%</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, color: "var(--faint)", marginBottom: 4, fontWeight: 600 }}>NO-SHOW RATE</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 500, color: r.noShow > 0 ? "var(--gold)" : "var(--text)" }}>{r.noShowRate}%</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, color: "var(--faint)", marginBottom: 4, fontWeight: 600 }}>TOP SERVICE</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.topService ? r.topService.svc.name : "—"}</div>
                    {r.topService && <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 1 }}>{r.topService.count}×</div>}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, color: "var(--faint)", marginBottom: 4, fontWeight: 600 }}>60-DAY RETENTION</div>
                    {r.retentionPct !== null ? (
                      <>
                        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 500, color: r.retentionPct >= 60 ? "var(--gold)" : "var(--text)" }}>{r.retentionPct}%</div>
                        <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 1 }}>of {r.cohortSize}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 14, color: "var(--faint)", fontStyle: "italic" }}>not enough data yet</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "28px 22px", textAlign: "center" }}>
          <p style={{ color: "var(--sub)", fontSize: 14.5, lineHeight: 1.55, maxWidth: 340, margin: "0 auto" }}>Add barbers in Settings → Staff to see per-barber breakdowns here.</p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SHOP DASHBOARD — adds Menu editor + Settings
// ============================================================
function ShopDashboard({ business, setBusiness, services, setServices, categories, setCategories, providers, setProviders, clients, setClients, appts, setAppts, waitlist, setWaitlist, theme, setTheme, onExit }) {
  const [tab, setTab] = useState("pulse");
  const [activeClient, setActiveClient] = useState(null);
  const [pulseDetail, setPulseDetail] = useState(null); // null | "revenue" — drill-in from Pulse
  const [toast, setToast] = useState(null);
  const [msgTarget, setMsgTarget] = useState(null); // { clientId, draft } — opens a convo prefilled
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3400); };

  // --- Pulse 2.0: "signed in as" picker. Until real auth, each device remembers which
  // barber is using it (localStorage). Owners can also pick "All shop" for a combined view.
  const realProviders = providers.filter((p) => p.id !== "anyone");
  const [signedInAs, setSignedInAs] = useState(() => {
    if (typeof window === "undefined") return realProviders[0]?.id || null;
    const saved = window.localStorage.getItem("vero_signed_in_as");
    if (saved && providers.some((p) => p.id === saved)) return saved;
    // Default: first owner, falling back to first provider
    const firstOwner = realProviders.find((p) => p.pulseRole === "owner") || realProviders[0];
    return firstOwner?.id || null;
  });
  useEffect(() => {
    if (typeof window !== "undefined" && signedInAs) {
      window.localStorage.setItem("vero_signed_in_as", signedInAs);
    }
  }, [signedInAs]);
  // If the currently-signed-in provider gets deleted, fall back gracefully
  useEffect(() => {
    if (signedInAs && !providers.some((p) => p.id === signedInAs)) {
      setSignedInAs(realProviders[0]?.id || null);
    }
  }, [providers, signedInAs]);
  const me = providers.find((p) => p.id === signedInAs);
  const isOwner = me?.pulseRole === "owner";
  // Pulse 2.0: owners can also "view as" another barber or "shop" totals. Barbers can't.
  const [pulseView, setPulseView] = useState("me"); // "me" | "shop" | <providerId>
  // Reset pulseView whenever the signed-in user changes
  useEffect(() => { setPulseView("me"); }, [signedInAs]);
  // Modal picker for switching the signed-in barber (shown via Pulse owner menu)
  const [showSignInPicker, setShowSignInPicker] = useState(false);
  // First-load: if no provider has ever been "signed in" before, prompt the user
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.localStorage.getItem("vero_signed_in_as") && realProviders.length > 1) {
      setShowSignInPicker(true);
    }
  }, []);

  // Always land at the top of the screen when changing tabs, opening a profile, or drilling into a Pulse detail.
  useEffect(() => {
    try { window.scrollTo({ top: 0, behavior: "instant" }); } catch { window.scrollTo(0, 0); }
  }, [tab, activeClient, pulseDetail]);

  // open a conversation (creating a lightweight client if needed) with a prefilled draft
  const textPerson = ({ name, phone, provider, draft }) => {
    const digits = (s) => (s || "").replace(/\D/g, "");
    let target = clients.find((c) => digits(c.phone) === digits(phone));
    if (!target) {
      const provId = (providers.find((p) => p.name === provider) || {}).id || "dan";
      target = { id: "wl-" + digits(phone), name: name || "Waitlist Client", phone, provider: provId, visits: 0, customDurations: {}, notes: "Added from the waitlist.", messages: [] };
      setClients([...clients, target]);
    }
    setMsgTarget({ clientId: target.id, draft });
    setTab("messages");
  };

  return (
    <div style={{ position: "relative", minHeight: "100dvh" }}>
      <div style={{ borderBottom: "1px solid var(--line)", padding: "15px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "color-mix(in srgb, var(--bg) 80%, transparent)", backdropFilter: "blur(20px) saturate(1.4)", WebkitBackdropFilter: "blur(20px) saturate(1.4)", zIndex: 10, position: "sticky", top: 0 }}>
        <button onClick={() => { if (pulseDetail) { setPulseDetail(null); return; } if (tab === "pulse" && !activeClient) { onExit(); return; } setActiveClient(null); setTab("pulse"); }} style={{ background: "none", color: "var(--sub)", display: "flex", alignItems: "center", gap: 6, fontSize: 15 }}><ArrowLeft size={16} /> {pulseDetail ? "Pulse" : (tab === "pulse" && !activeClient ? "Home" : "Pulse")}</button>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, letterSpacing: 1.5, fontWeight: 500 }}>{business.name}</div>
        <div style={{ width: 50 }} />
      </div>
      <div style={{ maxWidth: 900, width: "100%", margin: "0 auto", padding: "24px 20px 120px" }}>
        {tab === "pulse" && !pulseDetail && <PulseView business={business} appts={appts} clients={clients} services={services} providers={providers} me={me} isOwner={isOwner} pulseView={pulseView} setPulseView={setPulseView} onSignOut={() => setShowSignInPicker(true)} onNavigate={(t) => setTab(t)} onOpenRevenue={() => setPulseDetail("revenue")} onOpenAppointments={() => setPulseDetail("appointments")} onOpenClients={() => setPulseDetail("clients")} onOpenServices={() => setPulseDetail("services")} onOpenBarbers={() => setPulseDetail("barbers")} />}
        {tab === "pulse" && pulseDetail === "revenue" && <RevenueView appts={appts} clients={clients} services={services} providers={providers} onBack={() => setPulseDetail(null)} />}
        {tab === "pulse" && pulseDetail === "appointments" && <AppointmentsView appts={appts} providers={providers} services={services} onBack={() => setPulseDetail(null)} />}
        {tab === "pulse" && pulseDetail === "clients" && <ClientsReportView appts={appts} clients={clients} services={services} providers={providers} onBack={() => setPulseDetail(null)} onOpenNudge={() => { setPulseDetail(null); setTab("clients"); }} />}
        {tab === "pulse" && pulseDetail === "services" && <ServiceMixView appts={appts} services={services} providers={providers} onBack={() => setPulseDetail(null)} />}
        {tab === "pulse" && pulseDetail === "barbers" && <PerBarberView appts={appts} clients={clients} services={services} providers={providers} onBack={() => setPulseDetail(null)} />}
        {tab === "calendar" && <CalendarView appts={appts} setAppts={setAppts} clients={clients} setClients={setClients} providers={providers} services={services} business={business} theme={theme} showToast={showToast} waitlist={waitlist} setWaitlist={setWaitlist} />}
        {tab === "clients" && !activeClient && <ClientList clients={clients} setClients={setClients} providers={providers} onOpen={setActiveClient} showToast={showToast} />}
        {tab === "clients" && activeClient && <ClientProfile client={activeClient} clients={clients} setClients={setClients} services={services} setServices={setServices} providers={providers} appts={appts} onBack={() => setActiveClient(null)} showToast={showToast} />}
        {tab === "messages" && <MessagesView clients={clients} setClients={setClients} providers={providers} msgTarget={msgTarget} clearTarget={() => setMsgTarget(null)} onOpenClient={(c) => { setActiveClient(c); setTab("clients"); }} />}
        {tab === "waitlist" && <WaitlistView waitlist={waitlist} setWaitlist={setWaitlist} onText={textPerson} showToast={showToast} />}
        {tab === "menu" && <MenuEditor services={services} setServices={setServices} categories={categories} setCategories={setCategories} providers={providers} business={business} showToast={showToast} />}
        {tab === "settings" && <SettingsView business={business} setBusiness={setBusiness} providers={providers} setProviders={setProviders} services={services} setServices={setServices} categories={categories} setCategories={setCategories} appts={appts} clients={clients} theme={theme} setTheme={setTheme} showToast={showToast} />}
      </div>

      {/* fixed bottom tab bar — anchors to viewport bottom. transform:translateZ(0) puts it on its own GPU layer so iOS Safari doesn't let it drift during scroll/overscroll. */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "color-mix(in srgb, var(--bg) 82%, transparent)", backdropFilter: "blur(20px) saturate(1.4)", WebkitBackdropFilter: "blur(20px) saturate(1.4)", borderTop: "1px solid var(--line)", boxShadow: "0 -8px 30px -12px var(--shadow)", display: "flex", justifyContent: "space-around", alignItems: "stretch", padding: "10px 4px calc(10px + env(safe-area-inset-bottom))", zIndex: 20, transform: "translateZ(0)", WebkitTransform: "translateZ(0)", willChange: "transform" }}>
        {[["pulse", "Pulse", TrendingUp], ["calendar", "Calendar", Calendar], ["clients", "Clients", User], ["messages", "Messages", MessageSquare], ["settings", "Settings", Settings]].map(([id, label, Icon]) => (
          <button key={id} onClick={() => { setTab(id); setActiveClient(null); setPulseDetail(null); }} style={{ background: "none", flex: 1, padding: "6px 2px", color: tab === id ? "var(--gold)" : "var(--faint)", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, position: "relative" }}>
            <div style={{ position: "relative" }}>
              <Icon size={21} />
              {id === "waitlist" && waitlist.length > 0 && <span style={{ position: "absolute", top: -5, right: -9, background: "var(--gold)", color: "var(--on-gold)", fontSize: 12, fontWeight: 600, borderRadius: 8, minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{waitlist.length}</span>}
            </div>
            <span style={{ fontSize: 14.5, letterSpacing: 0.3 }}>{label}</span>
          </button>
        ))}
      </div>

      {/* SIGN-IN PICKER — appears on first load (if multiple providers), or when user picks "Sign in as someone else" from Pulse menu. Pre-auth honor-system version. */}
      {showSignInPicker && (
        <div onClick={() => signedInAs && setShowSignInPicker(false)} style={{ position: "fixed", inset: 0, background: "var(--overlay)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 380, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 20, padding: "26px 22px", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
            <div style={{ width: 28, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 500, marginBottom: 6 }}>Who's at the chair?</h2>
            <p style={{ color: "var(--sub)", fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>Tap your name. This device remembers, so you only see this once.</p>
            <div style={{ display: "grid", gap: 8 }}>
              {realProviders.map((p) => (
                <button key={p.id} onClick={() => { setSignedInAs(p.id); setShowSignInPicker(false); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: signedInAs === p.id ? "color-mix(in srgb, var(--gold) 10%, var(--panel2))" : "var(--panel2)", border: `1px solid ${signedInAs === p.id ? "var(--gold)" : "var(--border)"}`, color: "var(--text)", borderRadius: 12, fontSize: 15, textAlign: "left", cursor: "pointer" }}>
                  <Avatar size={36} initial={p.name.charAt(0)} color={p.color} photo={p.photo} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15.5, fontWeight: 500 }}>{p.name}</div>
                    <div style={{ fontSize: 12.5, color: "var(--sub)" }}>{p.role}{p.pulseRole === "owner" ? " · Owner" : ""}</div>
                  </div>
                </button>
              ))}
            </div>
            {signedInAs && <button onClick={() => setShowSignInPicker(false)} style={{ width: "100%", marginTop: 16, background: "none", color: "var(--sub)", border: "none", padding: 10, fontSize: 14 }}>Cancel</button>}
          </div>
        </div>
      )}

      {toast && <div className="fade-in" style={{ position: "fixed", bottom: 92, left: "50%", transform: "translateX(-50%)", background: "var(--gold)", color: "var(--on-gold)", padding: "14px 22px", borderRadius: 12, fontSize: 14, fontWeight: 500, boxShadow: "0 8px 30px rgba(0,0,0,.5)", maxWidth: "90%", textAlign: "center", zIndex: 30 }}>{toast}</div>}
    </div>
  );
}

// ---------- MENU EDITOR (add/edit/remove + photos) ----------
function MenuEditor({ services, setServices, categories, setCategories, providers, business, showToast }) {
  const [editing, setEditing] = useState(null); // service id or "new"
  const [section, setSection] = useState(null); // null = hub, else "details"|"staff"|"customizations"|"booking"
  const [picker, setPicker] = useState(null); // {target}
  const cats = (categories && categories.length) ? categories : ["Services"];
  const staffList = (providers || []).filter((p) => p.id !== "anyone");
  // build a default staff map: everyone ON, no overrides (null = use service default)
  const defaultStaffMap = () => { const m = {}; staffList.forEach((p) => { m[p.id] = { on: true, duration: null, price: null }; }); return m; };
  const defaultBooking = () => ({ available: true, description: "", customPrice: false, promptToCall: false, requireAddress: false, requireCard: true, requirePayment: false });
  const blank = { id: "", name: "", price: "", duration: "", color: "sage", photo: "", category: cats[0], addonGroups: [], staff: {}, booking: defaultBooking() };
  const [form, setForm] = useState(blank);
  const dragId = useRef(null);

  // ensure the form always has an entry for every current staff member
  const ensureStaff = (s) => { const m = { ...(s.staff || {}) }; staffList.forEach((p) => { if (!m[p.id]) m[p.id] = { on: true, duration: null, price: null }; }); return m; };
  const setStaff = (pid, patch) => setForm((f) => ({ ...f, staff: { ...f.staff, [pid]: { ...f.staff[pid], ...patch } } }));
  const setBooking = (patch) => setForm((f) => ({ ...f, booking: { ...(f.booking || defaultBooking()), ...patch } }));

  const openNew = () => { setForm({ ...blank, id: "svc-" + Date.now(), staff: defaultStaffMap(), booking: defaultBooking() }); setSection(null); setEditing("new"); };
  const openEdit = (s) => { const copy = JSON.parse(JSON.stringify(s)); copy.staff = ensureStaff(copy); copy.booking = { ...defaultBooking(), ...(copy.booking || {}) }; setForm(copy); setSection(null); setEditing(s.id); };
  const save = () => {
    if (!form.name || !form.price) { showToast("Name and price are required."); return; }
    // clean staff overrides: blank → null (use default), else Number
    const cleanStaff = {};
    Object.keys(form.staff || {}).forEach((pid) => {
      const e = form.staff[pid];
      cleanStaff[pid] = {
        on: e.on !== false,
        duration: (e.duration === null || e.duration === "" || e.duration === undefined) ? null : Number(e.duration),
        price: (e.price === null || e.price === "" || e.price === undefined) ? null : Number(e.price),
      };
    });
    const clean = { ...form, price: Number(form.price), duration: Number(form.duration) || 30, staff: cleanStaff, booking: { ...defaultBooking(), ...(form.booking || {}) } };
    if (editing === "new") setServices([...services, clean]);
    else setServices(services.map((s) => (s.id === editing ? clean : s)));
    setEditing(null); setSection(null); showToast(`Saved "${form.name}".`);
  };
  const remove = (id) => { setServices(services.filter((s) => s.id !== id)); showToast("Service removed."); };

  // ---- shared building blocks ----
  const SectionHeader = ({ title }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20 }}>
      <button onClick={() => setSection(null)} style={{ background: "none", color: "var(--gold)", display: "flex", alignItems: "center", gap: 4, fontSize: 16 }}><ChevronLeft size={20} /></button>
      <div><div style={{ fontSize: 12, letterSpacing: 2, color: "var(--faint)", fontWeight: 500 }}>{form.name || "SERVICE"}</div><h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 500, lineHeight: 1 }}>{title}</h2></div>
    </div>
  );
  const SaveBar = () => (
    <button className="lift" onClick={save} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 16, fontSize: 14, letterSpacing: 2, fontWeight: 600, borderRadius: 13, boxShadow: "var(--shadow-md)", marginTop: 26 }}>SAVE SERVICE</button>
  );
  const Toggle = ({ on, onClick }) => (
    <button onClick={onClick} style={{ width: 48, height: 28, borderRadius: 16, background: on ? "var(--gold)" : "var(--border2)", position: "relative", transition: "background .2s", flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
    </button>
  );

  // ---- DETAILS section ----
  const detailsSection = (
    <>
      <SectionHeader title="Details" />
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 14, letterSpacing: 2, color: "var(--faint)", marginBottom: 8 }}>SERVICE PHOTO</div>
        <button onClick={() => setPicker({ target: "service" })} className="lift" style={{ width: "100%", height: 160, borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden", background: "var(--panel2)", color: "var(--sub)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, padding: 0 }}>
          {form.photo ? <img src={imgUrl(form.photo, 600)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <><ImageIcon size={28} /><span style={{ fontSize: 15 }}>Choose photo (library or upload)</span></>}
        </button>
        {form.photo && <button onClick={() => setPicker({ target: "service" })} style={{ background: "none", color: "var(--gold)", fontSize: 15, marginTop: 8 }}>Change photo</button>}
      </div>
      <div style={{ display: "grid", gap: 12, marginBottom: 18 }}>
        <div><div style={{ fontSize: 14, letterSpacing: 2, color: "var(--faint)", marginBottom: 6 }}>NAME</div><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Signature Cut" style={inputStyle} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><div style={{ fontSize: 14, letterSpacing: 2, color: "var(--faint)", marginBottom: 6 }}>PRICE ($)</div><input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="42" style={inputStyle} /></div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 14, letterSpacing: 2, color: "var(--faint)", marginBottom: 6 }}>DURATION (MIN)</div><input type="number" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="45" style={inputStyle} /></div>
        </div>
        <div>
          <div style={{ fontSize: 14, letterSpacing: 2, color: "var(--faint)", marginBottom: 6 }}>CATEGORY</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {cats.map((c) => { const on = (form.category || cats[0]) === c; return (
              <button key={c} onClick={() => setForm({ ...form, category: c })} style={{ background: on ? "color-mix(in srgb, var(--gold) 12%, var(--panel))" : "var(--panel)", border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, color: on ? "var(--gold)" : "var(--text)", padding: "8px 14px", borderRadius: 20, fontSize: 14, fontWeight: on ? 600 : 400 }}>{c}</button>
            ); })}
          </div>
        </div>
      </div>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 14, letterSpacing: 2, color: "var(--faint)", marginBottom: 8 }}>CALENDAR COLOR</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {SERVICE_PALETTE.map((c) => { const on = (form.color || "sage") === c.id; return (
            <button key={c.id} onClick={() => setForm({ ...form, color: c.id })} title={c.name} style={{ width: 34, height: 34, borderRadius: "50%", background: c.hex, border: on ? "2px solid var(--text)" : "2px solid transparent", boxShadow: on ? "0 0 0 2px var(--bg) inset" : "none", display: "flex", alignItems: "center", justifyContent: "center" }}>{on && <Check size={15} style={{ color: "var(--on-gold)" }} />}</button>
          ); })}
        </div>
        <p style={{ fontSize: 14, color: "var(--faint)", marginTop: 10, lineHeight: 1.5 }}>Shows on the calendar before a client checks in. Once they're checked in or in service, the block switches to the status color.</p>
      </div>
      <SaveBar />
    </>
  );

  // ---- STAFF section ----
  const staffSection = (
    <>
      <SectionHeader title="Staff" />
      <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.5, marginBottom: 16 }}>Everyone offers this by default. Turn someone off if they don't, or set their own time and price. Blank means they use the service default ({form.duration || "—"} min · ${form.price || "—"}).</p>
      <div style={{ display: "grid", gap: 12 }}>
        {staffList.map((p) => {
          const e = form.staff[p.id] || { on: true, duration: null, price: null };
          const on = e.on !== false;
          return (
            <div key={p.id} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: 16, opacity: on ? 1 : 0.55 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: on ? 16 : 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 30, height: 30, borderRadius: "50%", background: (p.color || "var(--gold)") + "22", color: p.color || "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontSize: 14 }}>{p.name.charAt(0)}</span>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{p.name}</span>
                </div>
                <Toggle on={on} onClick={() => setStaff(p.id, { on: !on })} />
              </div>
              {on && (
                <div style={{ display: "grid", gap: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--line)" }}>
                    <span style={{ fontSize: 15, color: "var(--text2)" }}>Duration</span>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                        <input type="number" value={e.duration ?? ""} onChange={(ev) => setStaff(p.id, { duration: ev.target.value })} placeholder={String(form.duration || "—")} style={{ width: 60, background: "transparent", border: "none", color: "var(--gold)", fontSize: 17, fontWeight: 700, textAlign: "right", fontFamily: FONT_BODY }} />
                        <span style={{ fontSize: 15, color: "var(--gold)", fontWeight: 700 }}>min</span>
                      </div>
                      {e.duration != null && e.duration !== "" && <button onClick={() => setStaff(p.id, { duration: null })} style={{ background: "none", color: "var(--sub)", fontSize: 12.5 }}>Reset to default</button>}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--line)" }}>
                    <span style={{ fontSize: 15, color: "var(--text2)" }}>Price</span>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 2, justifyContent: "flex-end" }}>
                        <span style={{ fontSize: 17, color: "var(--text)" }}>$</span>
                        <input type="number" value={e.price ?? ""} onChange={(ev) => setStaff(p.id, { price: ev.target.value })} placeholder={String(form.price || "—")} style={{ width: 70, background: "transparent", border: "none", color: "var(--text)", fontSize: 17, textAlign: "right", fontFamily: FONT_BODY }} />
                      </div>
                      {e.price != null && e.price !== "" && <button onClick={() => setStaff(p.id, { price: null })} style={{ background: "none", color: "var(--sub)", fontSize: 12.5 }}>Reset to default</button>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 14, color: "var(--faint)", marginTop: 16 }}>To add a service provider, go to Staff & Hours in Settings.</p>
      <SaveBar />
    </>
  );

  // ---- CUSTOMIZATIONS section (add-on groups) ----
  const customizationsSection = (
    <>
      <SectionHeader title="Add-ons &amp; Customizations" />
      <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.5, marginBottom: 16 }}>Option groups clients can pick when booking — a yes/no choice (like a skin fade) or an optional add-on (like a facial).</p>
      {form.addonGroups.map((g, i) => (
        <div key={i} style={{ background: "var(--panel)", borderRadius: 14, padding: 14, marginBottom: 10, border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
            {business.showAddonPhotos && <button onClick={() => setPicker({ target: i })} style={{ width: 44, height: 44, borderRadius: 14, overflow: "hidden", border: "1px solid var(--border)", background: "var(--panel2)", color: "var(--faint)", flexShrink: 0, padding: 0 }}>{g.photo ? <img src={imgUrl(g.photo, 120)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <ImageIcon size={16} />}</button>}
            <input value={g.label} onChange={(e) => setForm({ ...form, addonGroups: form.addonGroups.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x) })} placeholder="Add-on question (e.g. Skinfade?)" style={{ ...inputStyle, padding: "10px 12px" }} />
            <button onClick={() => setForm({ ...form, addonGroups: form.addonGroups.filter((_, idx) => idx !== i) })} style={{ background: "none", color: "#C2703D", flexShrink: 0 }}><Trash2 size={16} /></button>
          </div>
          <div style={{ fontSize: 14, color: "var(--faint)" }}>{g.type === "addon" ? "Optional tappable add-on" : "Yes/No choice"}</div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
        <button onClick={() => setForm({ ...form, addonGroups: [...form.addonGroups, { id: "g" + Date.now(), label: "", type: "choice", photo: "", options: [{ id: "yes", label: "Yes", price: 5, min: 0 }, { id: "no", label: "No", price: 0, min: 0 }] }] })} style={{ flex: 1, background: "transparent", border: "1px dashed var(--border2)", color: "var(--sub)", padding: 12, fontSize: 15, borderRadius: 12 }}>+ Yes/No add-on</button>
        <button onClick={() => setForm({ ...form, addonGroups: [...form.addonGroups, { id: "g" + Date.now(), label: "Want an extra?", type: "addon", photo: "", item: { name: "New add-on", price: 20, min: 15, desc: "Description here." } }] })} style={{ flex: 1, background: "transparent", border: "1px dashed var(--border2)", color: "var(--sub)", padding: 12, fontSize: 15, borderRadius: 12 }}>+ Tappable add-on</button>
      </div>
      <SaveBar />
    </>
  );

  // ---- ONLINE BOOKING section ----
  const b = form.booking || defaultBooking();
  const bookingRow = (label, key, help) => (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "16px 0", borderTop: "1px solid var(--line)", gap: 16 }}>
      <div style={{ flex: 1 }}><div style={{ fontSize: 15.5, color: "var(--text)" }}>{label}</div>{help && <div style={{ fontSize: 13, color: "var(--faint)", marginTop: 3, lineHeight: 1.4 }}>{help}</div>}</div>
      <Toggle on={!!b[key]} onClick={() => setBooking({ [key]: !b[key] })} />
    </div>
  );
  const bookingSection = (
    <>
      <SectionHeader title="Online Booking" />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0 16px" }}>
        <div><div style={{ fontSize: 15.5, color: "var(--text)" }}>Available in online booking</div><div style={{ fontSize: 13, color: "var(--faint)", marginTop: 3 }}>Clients can book this service themselves.</div></div>
        <Toggle on={!!b.available} onClick={() => setBooking({ available: !b.available })} />
      </div>
      <div style={{ padding: "16px 0", borderTop: "1px solid var(--line)" }}>
        <div style={{ fontSize: 13, letterSpacing: 1.5, color: "var(--faint)", marginBottom: 6 }}>DIRECT LINK</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--panel2)", borderRadius: 10, padding: "11px 13px" }}>
          <span style={{ flex: 1, fontSize: 14, color: "var(--gold)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>booking.meridian.app/{(business.name || "studio").toLowerCase().replace(/\s+/g, "")}/{form.id}</span>
          <button onClick={() => showToast("Link copied.")} style={{ background: "none", color: "var(--sub)" }}><Copy size={16} /></button>
        </div>
      </div>
      <div style={{ padding: "16px 0", borderTop: "1px solid var(--line)" }}>
        <div style={{ fontSize: 13, letterSpacing: 1.5, color: "var(--faint)", marginBottom: 8 }}>DESCRIPTION</div>
        <textarea value={b.description} onChange={(e) => setBooking({ description: e.target.value })} rows={4} placeholder="Describe this service for clients booking online…" style={{ ...inputStyle, resize: "vertical", lineHeight: 1.55 }} />
      </div>
      {bookingRow("Customize price display", "customPrice", "Show a custom label instead of the exact price (e.g. “from $42”).")}
      {bookingRow("Show prompt-to-call", "promptToCall", "Ask clients to call instead of booking this online.")}
      {bookingRow("Require home address", "requireAddress", "For in-home or mobile services.")}
      {bookingRow("Require a credit card", "requireCard", "Hold a card on file to book.")}
      {bookingRow("Require payment at booking", "requirePayment", "Charge the full amount when booking online.")}
      <SaveBar />
    </>
  );

  // ---- REFERENCE PHOTOS section (AI training) ----
  // Picker for which target gets the next picked photo: { kind: 'service' } or { kind: 'cutType', id }
  const [refPickTarget, setRefPickTarget] = useState(null);
  const addRefPhoto = (target, photoId) => {
    if (!photoId) return;
    if (target.kind === "service") {
      const list = form.referencePhotos || [];
      if (list.includes(photoId)) return;
      setForm({ ...form, referencePhotos: [...list, photoId] });
    } else if (target.kind === "cutType") {
      const cuts = (form.cutTypes || []).map((c) => {
        if (c.id !== target.id) return c;
        const list = c.referencePhotos || [];
        if (list.includes(photoId)) return c;
        return { ...c, referencePhotos: [...list, photoId] };
      });
      setForm({ ...form, cutTypes: cuts });
    }
  };
  const removeRefPhoto = (target, photoId) => {
    if (target.kind === "service") {
      setForm({ ...form, referencePhotos: (form.referencePhotos || []).filter((p) => p !== photoId) });
    } else if (target.kind === "cutType") {
      const cuts = (form.cutTypes || []).map((c) => c.id === target.id ? { ...c, referencePhotos: (c.referencePhotos || []).filter((p) => p !== photoId) } : c);
      setForm({ ...form, cutTypes: cuts });
    }
  };
  const refTile = ({ photoId, target }) => (
    <div key={photoId} style={{ position: "relative", aspectRatio: "1/1", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}>
      <img src={imgUrl(photoId, 300)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      <button onClick={() => removeRefPhoto(target, photoId)} style={{ position: "absolute", top: 6, right: 6, width: 26, height: 26, borderRadius: "50%", background: "rgba(0,0,0,0.65)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", border: "none", padding: 0 }} aria-label="Remove from training"><Trash2 size={13} /></button>
    </div>
  );
  const referencePhotosSection = (
    <>
      <SectionHeader title="Reference Photos for AI" />
      <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.55, marginBottom: 18 }}>Upload examples of what this cut looks like in real life. The AI uses these to match a client's photo to the right service. You can keep adding as you work — every photo makes future matches sharper.</p>

      {form.cutTypes && form.cutTypes.length > 0 ? (
        form.cutTypes.map((ct) => {
          const list = ct.referencePhotos || [];
          const target = { kind: "cutType", id: ct.id };
          return (
            <div key={ct.id} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 16, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 500, lineHeight: 1.15 }}>{ct.label}</div>
                <div style={{ fontSize: 12, letterSpacing: 1.5, color: "var(--faint)", fontWeight: 600 }}>{list.length} PHOTO{list.length === 1 ? "" : "S"}</div>
              </div>
              {ct.desc && <p style={{ fontSize: 13, color: "var(--sub)", lineHeight: 1.45, marginBottom: 12 }}>{ct.desc}</p>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {list.map((pid) => refTile({ photoId: pid, target }))}
                <button onClick={() => setRefPickTarget(target)} style={{ aspectRatio: "1/1", borderRadius: 12, border: "1.5px dashed var(--border2)", background: "transparent", color: "var(--sub)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 4, padding: 0 }}>
                  <Plus size={20} />
                  <span style={{ fontSize: 11, letterSpacing: 1.5, fontWeight: 600 }}>ADD</span>
                </button>
              </div>
            </div>
          );
        })
      ) : (
        (() => {
          const list = form.referencePhotos || [];
          const target = { kind: "service" };
          return (
            <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 16, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 500 }}>{form.name || "This service"}</div>
                <div style={{ fontSize: 12, letterSpacing: 1.5, color: "var(--faint)", fontWeight: 600 }}>{list.length} PHOTO{list.length === 1 ? "" : "S"}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {list.map((pid) => refTile({ photoId: pid, target }))}
                <button onClick={() => setRefPickTarget(target)} style={{ aspectRatio: "1/1", borderRadius: 12, border: "1.5px dashed var(--border2)", background: "transparent", color: "var(--sub)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 4, padding: 0 }}>
                  <Plus size={20} />
                  <span style={{ fontSize: 11, letterSpacing: 1.5, fontWeight: 600 }}>ADD</span>
                </button>
              </div>
            </div>
          );
        })()
      )}

      <div style={{ background: "color-mix(in srgb, var(--gold) 8%, var(--panel))", border: "1px solid color-mix(in srgb, var(--gold) 35%, var(--border))", borderRadius: 14, padding: "14px 16px", fontSize: 13, color: "var(--text)", lineHeight: 1.5, marginTop: 10 }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--gold)", fontWeight: 600, marginBottom: 6 }}>HOW IT LEARNS</div>
        Every time you finish a client and add their final photo, Vero automatically adds it here too. Over time, your library grows and the AI's matches get sharper. You can remove any photo with the trash icon if it shouldn't train future matches.
      </div>

      <SaveBar />
    </>
  );

  const refPhotoCount = (() => {
    if (form.cutTypes && form.cutTypes.length) {
      return form.cutTypes.reduce((sum, ct) => sum + (ct.referencePhotos || []).length, 0);
    }
    return (form.referencePhotos || []).length;
  })();
  const hubRows = [
    { id: "details", label: "Details", sub: `$${form.price || "—"} · ${form.duration || "—"} min` },
    { id: "staff", label: "Staff", sub: `${staffList.filter((p) => form.staff[p.id]?.on !== false).length} of ${staffList.length} offering` },
    { id: "customizations", label: "Add-ons & Customizations", sub: `${form.addonGroups.length} option group${form.addonGroups.length !== 1 ? "s" : ""}` },
    { id: "refphotos", label: "Reference Photos for AI", sub: refPhotoCount === 0 ? "None yet" : `${refPhotoCount} photo${refPhotoCount === 1 ? "" : "s"}` },
    { id: "booking", label: "Online Booking", sub: b.available ? "Available" : "Off" },
  ];

  // ---- full-page service editor ----
  if (editing) {
    return (
      <div className="appt-screen" style={{ paddingBottom: 40 }}>
        {picker && <PhotoPicker onClose={() => setPicker(null)} onPick={(id) => {
          if (picker.target === "service") setForm({ ...form, photo: id });
          else setForm({ ...form, addonGroups: form.addonGroups.map((g, i) => i === picker.target ? { ...g, photo: id } : g) });
        }} />}
        {refPickTarget && <PhotoPicker onClose={() => setRefPickTarget(null)} onPick={(id) => { addRefPhoto(refPickTarget, id); setRefPickTarget(null); }} />}
        {section === "details" ? detailsSection
          : section === "staff" ? staffSection
          : section === "customizations" ? customizationsSection
          : section === "refphotos" ? referencePhotosSection
          : section === "booking" ? bookingSection
          : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <button onClick={() => setEditing(null)} style={{ background: "none", color: "var(--gold)", display: "flex", alignItems: "center", fontSize: 16 }}><ChevronLeft size={20} /></button>
                <span style={{ fontSize: 12, letterSpacing: 2.5, color: "var(--faint)", fontWeight: 500 }}>SERVICES</span>
              </div>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 500, letterSpacing: -0.3, marginBottom: 22, paddingLeft: 26 }}>{form.name || (editing === "new" ? "New service" : "Service")}</h2>
              <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
                {hubRows.map((r, i) => (
                  <button key={r.id} onClick={() => setSection(r.id)} className="lift" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 18px", background: "var(--panel)", color: "var(--text)", textAlign: "left", borderTop: i ? "1px solid var(--line)" : "none" }}>
                    <div><div style={{ fontSize: 17 }}>{r.label}</div><div style={{ fontSize: 13.5, color: "var(--sub)", marginTop: 2 }}>{r.sub}</div></div>
                    <ChevronRight size={20} style={{ color: "var(--faint)" }} />
                  </button>
                ))}
              </div>
              {editing === "new" && <p style={{ fontSize: 13.5, color: "var(--faint)", marginTop: 14, lineHeight: 1.5 }}>Fill in Details and tap Save Service to add it to your menu.</p>}
            </>
          )}
      </div>
    );
  }

  // ---- reorder + category helpers ----
  const moveService = (id, dir) => {
    // reorder within the SAME category (dir: -1 up, +1 down)
    const arr = [...services];
    const idx = arr.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const cat = arr[idx].category || cats[0];
    // indices of services in this category, in order
    const group = arr.map((s, i) => ({ s, i })).filter((x) => (x.s.category || cats[0]) === cat);
    const posInGroup = group.findIndex((x) => x.s.id === id);
    const swapWith = group[posInGroup + dir];
    if (!swapWith) return;
    const a = idx, b = swapWith.i;
    [arr[a], arr[b]] = [arr[b], arr[a]];
    setServices(arr);
  };
  const moveCategory = (name, dir) => {
    const arr = [...cats]; const i = arr.indexOf(name); const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]]; setCategories(arr);
  };
  const addCategory = () => {
    const name = (prompt("New category name") || "").trim();
    if (!name) return;
    if (cats.includes(name)) { showToast("That category already exists."); return; }
    setCategories([...cats, name]); showToast(`Added category "${name}".`);
  };
  const renameCategory = (oldName) => {
    const name = (prompt("Rename category", oldName) || "").trim();
    if (!name || name === oldName) return;
    if (cats.includes(name)) { showToast("That category already exists."); return; }
    setCategories(cats.map((c) => c === oldName ? name : c));
    setServices(services.map((s) => (s.category || cats[0]) === oldName ? { ...s, category: name } : s));
    showToast("Category renamed.");
  };
  const deleteCategory = (name) => {
    if (cats.length <= 1) { showToast("Keep at least one category."); return; }
    const fallback = cats.find((c) => c !== name);
    setServices(services.map((s) => (s.category || cats[0]) === name ? { ...s, category: fallback } : s));
    setCategories(cats.filter((c) => c !== name));
    showToast(`Category "${name}" removed; its services moved to "${fallback}".`);
  };
  // drag-and-drop (works in the artifact frame; arrows are the mobile-safe fallback)
  const onDragStart = (id) => (e) => { dragId.current = id; e.dataTransfer && (e.dataTransfer.effectAllowed = "move"); };
  const onDropOn = (targetId, targetCat) => (e) => {
    e.preventDefault();
    const from = dragId.current; dragId.current = null;
    if (!from || from === targetId) return;
    const arr = [...services];
    const fi = arr.findIndex((s) => s.id === from);
    if (fi < 0) return;
    const moved = { ...arr[fi], category: targetCat };
    arr.splice(fi, 1);
    const ti = arr.findIndex((s) => s.id === targetId);
    arr.splice(ti < 0 ? arr.length : ti, 0, moved);
    setServices(arr);
  };

  return (
    <div className="fade-up">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 500 }}>Menu</h2>
        <button className="lift" onClick={openNew} style={{ background: "var(--gold)", color: "var(--on-gold)", padding: "10px 16px", borderRadius: 12, fontSize: 15, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}><Plus size={16} /> Add service</button>
      </div>
      <p style={{ color: "var(--sub)", fontSize: 14, marginBottom: 20, fontWeight: 300 }}>Group services into categories, drag the handle (or use the arrows) to reorder. Changes show instantly on the client side.</p>

      {cats.map((cat, ci) => {
        const inCat = services.filter((s) => (s.category || cats[0]) === cat);
        return (
          <div key={cat} style={{ marginBottom: 26 }}>
            {/* category header */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <GripVertical size={16} style={{ color: "var(--faint)" }} />
              <span style={{ fontSize: 13, letterSpacing: 2, color: "var(--text2)", fontWeight: 700, flex: 1 }}>{cat.toUpperCase()}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                <button onClick={() => moveCategory(cat, -1)} disabled={ci === 0} style={{ background: "none", color: ci === 0 ? "var(--faint)" : "var(--sub)", padding: 4, opacity: ci === 0 ? 0.4 : 1 }}><ChevronRight size={16} style={{ transform: "rotate(-90deg)" }} /></button>
                <button onClick={() => moveCategory(cat, 1)} disabled={ci === cats.length - 1} style={{ background: "none", color: ci === cats.length - 1 ? "var(--faint)" : "var(--sub)", padding: 4, opacity: ci === cats.length - 1 ? 0.4 : 1 }}><ChevronRight size={16} style={{ transform: "rotate(90deg)" }} /></button>
                <button onClick={() => renameCategory(cat)} style={{ background: "none", color: "var(--sub)", padding: 4 }}><Edit2 size={14} /></button>
                <button onClick={() => deleteCategory(cat)} style={{ background: "none", color: "#C2703D", padding: 4 }}><Trash2 size={14} /></button>
              </div>
            </div>
            {/* services in this category */}
            <div style={{ display: "grid", gap: 10 }}>
              {inCat.length === 0 && <div style={{ fontSize: 14, color: "var(--faint)", fontStyle: "italic", padding: "6px 2px" }}>No services in this category yet.</div>}
              {inCat.map((s, si) => (
                <div key={s.id} draggable onDragStart={onDragStart(s.id)} onDragOver={(e) => e.preventDefault()} onDrop={onDropOn(s.id, cat)} className="card" style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 12 }}>
                  <GripVertical size={18} style={{ color: "var(--border2)", cursor: "grab", flexShrink: 0 }} />
                  <div style={{ width: 56, height: 56, borderRadius: 12, overflow: "hidden", background: "var(--panel2)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>{s.photo ? <img src={imgUrl(s.photo, 200)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <ImageIcon size={18} style={{ color: "var(--faint)" }} />}</div>
                  <button onClick={() => openEdit(s)} style={{ flex: 1, background: "none", textAlign: "left", color: "var(--text)" }}>
                    <div style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: hexById(s.color), flexShrink: 0 }} />{s.name}</div>
                    <div style={{ fontSize: 14, color: "var(--sub)" }}>${s.price} · {s.duration} min · {s.addonGroups.length} add-on{s.addonGroups.length !== 1 ? "s" : ""}</div>
                  </button>
                  {/* up/down reorder (mobile-safe) */}
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <button onClick={() => moveService(s.id, -1)} disabled={si === 0} style={{ background: "none", color: si === 0 ? "var(--faint)" : "var(--sub)", padding: "2px 4px", opacity: si === 0 ? 0.4 : 1 }}><ChevronRight size={16} style={{ transform: "rotate(-90deg)" }} /></button>
                    <button onClick={() => moveService(s.id, 1)} disabled={si === inCat.length - 1} style={{ background: "none", color: si === inCat.length - 1 ? "var(--faint)" : "var(--sub)", padding: "2px 4px", opacity: si === inCat.length - 1 ? 0.4 : 1 }}><ChevronRight size={16} style={{ transform: "rotate(90deg)" }} /></button>
                  </div>
                  <button onClick={() => remove(s.id)} style={{ background: "none", color: "#C2703D", padding: 6, flexShrink: 0 }}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <button onClick={addCategory} className="lift" style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "1px dashed var(--border2)", color: "var(--gold)", padding: "13px 16px", borderRadius: 12, fontSize: 15, width: "100%", justifyContent: "center", fontWeight: 500 }}><Plus size={17} /> Add category</button>
    </div>
  );
}

// ---------- Online Booking rules: deep, fully-interactive editor ----------
function fmtDur(totalMin) {
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function bookingStatus(b) {
  if (!b.enabled) return "Turned off";
  const bits = [];
  bits.push(b.requireCard ? "Card required" : "No card");
  if (b.deposit?.mode && b.deposit.mode !== "none") bits.push(b.deposit.mode === "fixed" ? `$${b.deposit.amount} deposit` : `${b.deposit.amount}% deposit`);
  if (b.leadTimeMin) bits.push(`${fmtDur(b.leadTimeMin)} notice`);
  return bits.join(" · ");
}

// Two-column hours + minutes picker (minutes in 5-min increments)
function HourMinutePicker({ totalMin, onChange, maxHours = 72 }) {
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  const setH = (nh) => onChange(Math.max(0, nh) * 60 + m);
  const setM = (nm) => { let v = nm; if (v < 0) v = 55; if (v > 55) v = 0; onChange(h * 60 + v); };
  const col = (label, val, dec, inc, display) => (
    <div style={{ flex: 1, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 8px" }}>
      <div style={{ fontSize: 12, letterSpacing: 1.5, color: "var(--faint)", textAlign: "center", marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <button onClick={dec} style={{ width: 30, height: 30, borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 17, lineHeight: 1 }}>−</button>
        <span style={{ fontSize: 19, color: "var(--text)", minWidth: 34, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{display}</span>
        <button onClick={inc} style={{ width: 30, height: 30, borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 17, lineHeight: 1 }}>+</button>
      </div>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 10, width: 220 }}>
      {col("HOURS", h, () => setH(h - 1), () => setH(Math.min(maxHours, h + 1)), h)}
      {col("MINUTES", m, () => setM(m - 5), () => setM(m + 5), String(m).padStart(2, "0"))}
    </div>
  );
}


function Toggle({ on, onClick }) {
  return (
    <button onClick={onClick} style={{ width: 44, height: 26, borderRadius: 13, background: on ? "var(--gold)" : "var(--border)", position: "relative", flexShrink: 0, border: "none" }}>
      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
    </button>
  );
}

function Stepper({ value, onChange, min = 0, max = 999, step = 1, suffix }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button onClick={() => onChange(Math.max(min, value - step))} style={{ width: 32, height: 32, borderRadius: 6, background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 18, lineHeight: 1 }}>−</button>
      <span style={{ minWidth: 64, textAlign: "center", fontSize: 15, color: "var(--text)" }}>{value}{suffix ? ` ${suffix}` : ""}</span>
      <button onClick={() => onChange(Math.min(max, value + step))} style={{ width: 32, height: 32, borderRadius: 6, background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 18, lineHeight: 1 }}>+</button>
    </div>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", background: "var(--panel2)", borderRadius: 6, padding: 3, gap: 2 }}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 14, fontSize: 15, background: value === o.value ? "var(--gold)" : "transparent", color: value === o.value ? "var(--on-gold)" : "var(--sub)", fontWeight: value === o.value ? 500 : 400, whiteSpace: "nowrap" }}>{o.label}</button>
      ))}
    </div>
  );
}

function Row({ title, desc, children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15 }}>{title}</div>
        {desc && <div style={{ fontSize: 14.5, color: "var(--sub)", fontWeight: 300, marginTop: 2, lineHeight: 1.4 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function BookingRulesEditor({ b, onChange }) {
  const set = (patch) => onChange({ ...b, ...patch });
  const setDep = (patch) => onChange({ ...b, deposit: { ...b.deposit, ...patch } });

  const preview = () => {
    if (!b.enabled) return "Online booking is currently turned off — clients can't book themselves.";
    const horizonLabel = b.horizonDays === 0 ? "no cutoff" : (b.horizonDays >= 90 ? `${Math.round(b.horizonDays / 30)} months` : `${b.horizonDays || 60} days`);
    let s = `Clients can book online (${horizonLabel} ahead)`;
    s += `. ${b.clientType === "all" ? "Open to everyone" : b.clientType === "returning" ? "Returning clients only" : "New clients only"}.`;
    if (b.allowMultiple === false) s += " One service per booking.";
    if (b.requireCard) s += " A card is required.";
    if (b.deposit?.mode === "fixed") s += ` $${b.deposit.amount} deposit taken at booking.`;
    if (b.deposit?.mode === "percent") s += ` ${b.deposit.amount}% deposit taken at booking.`;
    return s;
  };

  return (
    <div>
      <Row title="Online booking" desc="Let clients book themselves through your page.">
        <Toggle on={b.enabled} onClick={() => set({ enabled: !b.enabled })} />
      </Row>

      <div style={{ opacity: b.enabled ? 1 : 0.4, pointerEvents: b.enabled ? "auto" : "none" }}>
        <Row title="Multiple services per booking" desc="Allow more than one service in a single appointment.">
          <Toggle on={b.allowMultiple !== false} onClick={() => set({ allowMultiple: b.allowMultiple === false ? true : false })} />
        </Row>

        <Row title="Who can book" desc="Limit online booking by client type.">
          <Segmented options={[{ value: "all", label: "All" }, { value: "returning", label: "Returning" }, { value: "new", label: "New" }]} value={b.clientType || "all"} onChange={(v) => set({ clientType: v })} />
        </Row>

        <Row title="Require a card" desc="Hold a card to reserve (your no-show protection).">
          <Toggle on={b.requireCard} onClick={() => set({ requireCard: !b.requireCard })} />
        </Row>

        <Row title="Deposit" desc="Take a deposit at the time of booking.">
          <Segmented options={[{ value: "none", label: "None" }, { value: "fixed", label: "$ Fixed" }, { value: "percent", label: "%" }]} value={b.deposit?.mode || "none"} onChange={(v) => setDep({ mode: v })} />
        </Row>
        {b.deposit?.mode && b.deposit.mode !== "none" && (
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 0 14px", borderBottom: "1px solid var(--line)" }}>
            <Stepper value={b.deposit.amount} onChange={(v) => setDep({ amount: v })} min={0} max={b.deposit.mode === "percent" ? 100 : 500} step={5} suffix={b.deposit.mode === "percent" ? "%" : "$"} />
          </div>
        )}

        <p style={{ fontSize: 13, color: "var(--faint)", lineHeight: 1.5, marginTop: 18, fontStyle: "italic" }}>
          Buffer, minimum notice, and booking window live in Settings → Scheduling Options.
        </p>
      </div>

      <div style={{ marginTop: 18, background: "rgba(176,141,87,0.08)", border: "1px solid rgba(176,141,87,0.25)", borderRadius: 6, padding: "14px 16px" }}>
        <div style={{ fontSize: 13, letterSpacing: 1, color: "var(--gold)", marginBottom: 6 }}>HOW THIS READS TO CLIENTS</div>
        <div style={{ fontSize: 15, color: "var(--text2)", lineHeight: 1.6, fontWeight: 300 }}>{preview()}</div>
      </div>
    </div>
  );
}

// ============================================================
// LOCATIONS EDITOR — optional; off by default for solo shops
// ============================================================
function LocationsEditor({ business, setForm }) {
  const [openId, setOpenId] = useState(null);
  const locations = business.locations || [];
  const setLoc = (id, patch) => setForm({ ...business, locations: locations.map((l) => l.id === id ? { ...l, ...patch } : l) });
  const addLoc = () => { const id = "loc" + Date.now(); setForm({ ...business, locations: [...locations, { id, name: "New Location", address: "", cityZip: "", phone: "", hours: "Mon–Fri · 9–5" }] }); setOpenId(id); };
  const removeLoc = (id) => setForm({ ...business, locations: locations.filter((l) => l.id !== id) });
  const F = ({ label, val, on }) => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 13, color: "var(--faint)", display: "block", marginBottom: 6 }}>{label}</label>
      <input value={val} onChange={(e) => on(e.target.value)} style={inputStyle} />
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: business.multiLocation ? 18 : 0 }}>
        <div style={{ paddingRight: 16 }}><div style={{ fontSize: 15 }}>Multiple locations</div><div style={{ fontSize: 13, color: "var(--sub)", marginTop: 2, lineHeight: 1.5 }}>Turn on if you run more than one shop. Each location can have its own address, hours, and staff.</div></div>
        <button onClick={() => setForm({ ...business, multiLocation: !business.multiLocation })} style={{ width: 44, height: 26, borderRadius: 13, background: business.multiLocation ? "var(--gold)" : "var(--border)", position: "relative", flexShrink: 0 }}><span style={{ position: "absolute", top: 3, left: business.multiLocation ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} /></button>
      </div>

      {business.multiLocation && (
        <>
          <div style={{ display: "grid", gap: 10 }}>
            {locations.map((l) => {
              const expanded = openId === l.id;
              return (
                <div key={l.id} style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                  <button onClick={() => setOpenId(expanded ? null : l.id)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "none", color: "var(--text)", textAlign: "left" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <MapPinIcon size={18} style={{ color: "var(--gold)", flexShrink: 0 }} />
                      <div><div style={{ fontSize: 15.5, fontWeight: 500 }}>{l.name}</div><div style={{ fontSize: 13, color: "var(--sub)" }}>{l.cityZip || "No address yet"}</div></div>
                    </div>
                    <ChevronRight size={18} style={{ color: "var(--faint)", transform: expanded ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
                  </button>
                  {expanded && (
                    <div style={{ padding: "4px 16px 18px", borderTop: "1px solid var(--line)" }}>
                      <div style={{ height: 14 }} />
                      <F label="Location name" val={l.name} on={(v) => setLoc(l.id, { name: v })} />
                      <F label="Address" val={l.address} on={(v) => setLoc(l.id, { address: v })} />
                      <F label="City, State ZIP" val={l.cityZip} on={(v) => setLoc(l.id, { cityZip: v })} />
                      <F label="Phone" val={l.phone} on={(v) => setLoc(l.id, { phone: v })} />
                      <F label="Hours (summary)" val={l.hours} on={(v) => setLoc(l.id, { hours: v })} />
                      {locations.length > 1 && <button onClick={() => removeLoc(l.id)} style={{ marginTop: 4, background: "none", color: "#C2563F", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}><Trash2 size={14} /> Remove location</button>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button className="lift" onClick={addLoc} style={{ width: "100%", marginTop: 12, background: "var(--panel2)", border: "1px dashed var(--border2)", color: "var(--text)", padding: 14, borderRadius: 10, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Plus size={16} /> Add location</button>
        </>
      )}
    </div>
  );
}

// ============================================================
// MESSAGES EDITOR — edit the wording of each automated text/email
// ============================================================
const MERGE_TAGS = ["{client}", "{provider}", "{service}", "{date}", "{time}", "{business}"];
const fillSample = (body, business) => body
  .replace(/\{client\}/g, "Marcus")
  .replace(/\{provider\}/g, "Dan")
  .replace(/\{service\}/g, "Cut & Beard")
  .replace(/\{date\}/g, "Thu, May 28")
  .replace(/\{time\}/g, "12:50 PM")
  .replace(/\{business\}/g, business?.legalName || "the studio");

function MessagesEditor({ messages, onChange, business }) {
  const [openId, setOpenId] = useState(null);
  const update = (id, patch) => onChange(messages.map((m) => m.id === id ? { ...m, ...patch } : m));
  const insertTag = (m, tag) => update(m.id, { body: (m.body || "") + (m.body && !m.body.endsWith(" ") ? " " : "") + tag });
  const channelBadge = (ch) => {
    const map = { text: ["Text", "#0A84FF"], email: ["Email", "var(--gold)"], both: ["Text + Email", "var(--sub)"] };
    const [label, color] = map[ch] || map.text;
    return <span style={{ fontSize: 11.5, letterSpacing: 0.5, color, border: `1px solid ${color}`, borderRadius: 20, padding: "2px 9px" }}>{label}</span>;
  };
  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.6, fontWeight: 300, marginBottom: 16 }}>Edit exactly what each automated message says. Tap a tag like {"{client}"} to drop in info the system fills automatically.</p>
      <div style={{ display: "grid", gap: 10 }}>
        {messages.map((m) => {
          const expanded = openId === m.id;
          return (
            <div key={m.id} style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", opacity: m.enabled ? 1 : 0.6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px" }}>
                <button onClick={() => setOpenId(expanded ? null : m.id)} style={{ background: "none", color: "var(--text)", textAlign: "left", flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>{m.label}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{channelBadge(m.channel)}<span style={{ fontSize: 12.5, color: "var(--sub)" }}>{m.timing}</span></div>
                </button>
                <button onClick={() => update(m.id, { enabled: !m.enabled })} style={{ width: 44, height: 26, borderRadius: 13, background: m.enabled ? "var(--gold)" : "var(--border)", position: "relative", flexShrink: 0, marginLeft: 12 }}><span style={{ position: "absolute", top: 3, left: m.enabled ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} /></button>
              </div>
              {expanded && (
                <div style={{ padding: "4px 16px 18px", borderTop: "1px solid var(--line)" }}>
                  <label style={{ fontSize: 13, color: "var(--faint)", display: "block", margin: "14px 0 8px" }}>Send as</label>
                  <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                    {[["text", "Text"], ["email", "Email"], ["both", "Both"]].map(([id, label]) => { const on = m.channel === id; return (
                      <button key={id} onClick={() => update(m.id, { channel: id })} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "rgba(176,141,87,0.12)" : "transparent", color: on ? "var(--gold)" : "var(--text)", fontSize: 14, fontWeight: on ? 600 : 400 }}>{label}</button>
                    ); })}
                  </div>

                  <label style={{ fontSize: 13, color: "var(--faint)", display: "block", marginBottom: 8 }}>Message</label>
                  <textarea value={m.body} onChange={(e) => update(m.id, { body: e.target.value })} rows={4} style={{ width: "100%", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", color: "var(--text)", fontSize: 15, fontFamily: FONT_BODY, lineHeight: 1.5, resize: "vertical", outline: "none", marginBottom: 10 }} />

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                    {MERGE_TAGS.map((tag) => (
                      <button key={tag} onClick={() => insertTag(m, tag)} style={{ fontSize: 12.5, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 20, padding: "5px 11px", color: "var(--gold)" }}>{tag}</button>
                    ))}
                  </div>

                  <div style={{ fontSize: 12, letterSpacing: 1.5, color: "var(--faint)", marginBottom: 8 }}>PREVIEW</div>
                  <div style={{ background: m.channel === "email" ? "var(--panel)" : "#0A84FF", color: m.channel === "email" ? "var(--text)" : "#fff", border: m.channel === "email" ? "1px solid var(--border)" : "none", borderRadius: 16, borderBottomLeftRadius: m.channel === "email" ? 16 : 16, padding: "12px 15px", fontSize: 15, lineHeight: 1.45 }}>{fillSample(m.body, business)}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// TIPPING EDITOR — preset % options clients see at checkout
// ============================================================
function TippingEditor({ t, onChange }) {
  const set = (patch) => onChange({ ...t, ...patch });
  const setPreset = (i, val) => { const presets = [...t.presets]; presets[i] = Math.max(0, Math.min(100, parseInt(val) || 0)); onChange({ ...t, presets }); };
  const sampleTotal = 50; // preview on a $50 ticket
  const Toggle = ({ on, onClick }) => (
    <button onClick={onClick} style={{ width: 44, height: 26, borderRadius: 13, background: on ? "var(--gold)" : "var(--border)", position: "relative", flexShrink: 0 }}><span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} /></button>
  );
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div><div style={{ fontSize: 15 }}>Show tipping at checkout</div><div style={{ fontSize: 13, color: "var(--sub)", marginTop: 2 }}>Clients pick a tip after their service.</div></div>
        <Toggle on={t.enabled} onClick={() => set({ enabled: !t.enabled })} />
      </div>

      {t.enabled && (<>
        <label style={{ fontSize: 13, color: "var(--faint)", display: "block", marginBottom: 8 }}>Preset percentages</label>
        <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
          {t.presets.map((p, i) => (
            <div key={i} style={{ flex: 1, position: "relative" }}>
              <input type="number" value={p} onChange={(e) => setPreset(i, e.target.value)} style={{ width: "100%", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, padding: "13px 26px 13px 14px", color: "var(--text)", fontSize: 16, textAlign: "center", fontFamily: FONT_BODY }} />
              <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--sub)", fontSize: 15, pointerEvents: "none" }}>%</span>
            </div>
          ))}
        </div>

        <label style={{ fontSize: 13, color: "var(--faint)", display: "block", marginBottom: 8 }}>Pre-highlighted suggestion</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {t.presets.map((p, i) => { const on = t.smartDefault === p; return (
            <button key={i} onClick={() => set({ smartDefault: p })} style={{ flex: 1, padding: "11px 0", borderRadius: 8, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "rgba(176,141,87,0.12)" : "transparent", color: on ? "var(--gold)" : "var(--text)", fontSize: 14, fontWeight: on ? 600 : 400 }}>{p}%</button>
          ); })}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--line)" }}>
          <span style={{ fontSize: 14.5 }}>Allow custom amount</span>
          <Toggle on={t.allowCustom} onClick={() => set({ allowCustom: !t.allowCustom })} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--line)", marginBottom: 18 }}>
          <span style={{ fontSize: 14.5 }}>Show "No tip" option</span>
          <Toggle on={t.allowNoTip} onClick={() => set({ allowNoTip: !t.allowNoTip })} />
        </div>

        {/* live preview */}
        <div style={{ fontSize: 12, letterSpacing: 1.5, color: "var(--faint)", marginBottom: 10 }}>WHAT CLIENTS SEE (on a ${sampleTotal} ticket)</div>
        <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: t.allowNoTip || t.allowCustom ? 10 : 0 }}>
            {t.presets.map((p, i) => { const on = t.smartDefault === p; return (
              <div key={i} style={{ flex: 1, textAlign: "center", padding: "10px 4px", borderRadius: 8, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "var(--gold)" : "var(--panel)", color: on ? "var(--on-gold)" : "var(--text)" }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{p}%</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>${(sampleTotal * p / 100).toFixed(0)}</div>
              </div>
            ); })}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {t.allowCustom && <div style={{ flex: 1, textAlign: "center", padding: "9px 4px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", fontSize: 13, color: "var(--sub)" }}>Custom</div>}
            {t.allowNoTip && <div style={{ flex: 1, textAlign: "center", padding: "9px 4px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", fontSize: 13, color: "var(--sub)" }}>No tip</div>}
          </div>
        </div>
      </>)}
    </div>
  );
}

// Waitlist auto-notify rules — how the system reaches out when a slot frees up.
function WaitlistRulesEditor({ w, onChange }) {
  const set = (patch) => onChange({ ...w, ...patch });
  const Opt = ({ active, title, sub, onClick }) => (
    <button onClick={onClick} style={{ width: "100%", textAlign: "left", background: active ? "color-mix(in srgb, var(--gold) 12%, var(--panel2))" : "var(--panel2)", border: `1px solid ${active ? "var(--gold)" : "var(--border)"}`, borderRadius: 14, padding: 16, marginBottom: 10, display: "flex", alignItems: "flex-start", gap: 12 }}>
      <span style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${active ? "var(--gold)" : "var(--border2)"}`, flexShrink: 0, marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>{active && <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--gold)" }} />}</span>
      <span><span style={{ fontSize: 15.5, fontWeight: 600, color: "var(--text)", display: "block" }}>{title}</span><span style={{ fontSize: 13.5, color: "var(--sub)", lineHeight: 1.45 }}>{sub}</span></span>
    </button>
  );
  const delays = [15, 30, 45, 60];
  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.5, marginBottom: 22 }}>When an appointment is cancelled, the system finds waitlisted clients whose preferred time and barber match the open slot, and reaches out with a link to book.</p>

      <div style={{ fontSize: 12.5, letterSpacing: 1.5, color: "var(--faint)", marginBottom: 10 }}>HOW IT SENDS</div>
      <Opt active={w.mode === "ask"} title="Ask me first" sub="Show a confirmation listing who matches, and I send it." onClick={() => set({ mode: "ask" })} />
      <Opt active={w.mode === "silent"} title="Send automatically (silent)" sub="The system notifies matching clients on its own — no prompt." onClick={() => set({ mode: "silent" })} />

      <div style={{ fontSize: 12.5, letterSpacing: 1.5, color: "var(--faint)", margin: "20px 0 10px" }}>WHO IT REACHES</div>
      <Opt active={w.order === "longest"} title="Longest waiting first — one at a time" sub="Offer the slot to whoever has waited longest. If they don't book in time, it moves to the next person in line." onClick={() => set({ order: "longest" })} />
      <Opt active={w.order === "all"} title="First come, first serve — notify all at once" sub="Notify every matching client at the same time. Whoever books first gets the slot." onClick={() => set({ order: "all" })} />

      {w.order === "longest" && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12.5, letterSpacing: 1.5, color: "var(--faint)", marginBottom: 10 }}>WAIT BEFORE OFFERING TO THE NEXT PERSON</div>
          <div style={{ display: "flex", gap: 8 }}>
            {delays.map((d) => { const on = (w.delayMin || 30) === d; return (
              <button key={d} onClick={() => set({ delayMin: d })} style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "rgba(176,141,87,0.12)" : "transparent", color: on ? "var(--gold)" : "var(--text)", fontSize: 14.5, fontWeight: on ? 600 : 400 }}>{d} min</button>
            ); })}
          </div>
          <p style={{ fontSize: 13, color: "var(--faint)", lineHeight: 1.45, marginTop: 10 }}>Each client gets {w.delayMin || 30} minutes to claim the slot before it's offered to the next person in line.</p>
        </div>
      )}
      <div style={{ borderTop: "1px solid var(--line)", marginTop: 22, paddingTop: 8 }}>
        <div style={{ fontSize: 12.5, letterSpacing: 1.5, color: "var(--faint)", margin: "8px 0 4px" }}>ON THE CLIENT'S WAITLIST FORM</div>
        <ToggleSetting label="Ask for a reference photo" desc="Warmly nudge clients to add a photo of what they want, so you can judge whether you can squeeze them in." on={w.photoNudge !== false} onToggle={(v) => set({ photoNudge: v })} />
        <div style={{ height: 8 }} />
        <ToggleSetting label="Ask if they'd take any barber" desc="If they picked a specific barber, ask whether they'd accept any open chair — fills cancellations faster. (Defaults to their chosen barber.)" on={w.askAnyProvider !== false} onToggle={(v) => set({ askAnyProvider: v })} />
      </div>
    </div>
  );
}
function BusinessHoursEditor({ hours, onChange }) {
  const DAYNAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const h = hours || {};
  const setDay = (d, patch) => onChange({ ...h, [d]: { ...(h[d] || { on: false, start: 540, end: 1020 }), ...patch } });
  const Toggle = ({ on, onClick }) => (
    <button onClick={onClick} style={{ width: 44, height: 26, borderRadius: 13, background: on ? "var(--gold)" : "var(--border)", position: "relative", flexShrink: 0 }}><span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} /></button>
  );
  // time options every 30 min from 6:00 to 22:00
  const opts = []; for (let t = 360; t <= 1320; t += 30) opts.push(t);
  const TimeSel = ({ value, onPick }) => (
    <select value={value} onChange={(e) => onPick(parseInt(e.target.value))} style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 14, fontFamily: FONT_BODY }}>
      {opts.map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
    </select>
  );
  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.5, marginBottom: 18 }}>Set the days and hours the shop is open. This drives the times clients can book and what shows on your calendar.</p>
      {DAYNAMES.map((name, d) => {
        const day = h[d] || { on: false, start: 540, end: 1020 };
        return (
          <div key={d} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 0", borderTop: d === 0 ? "none" : "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
              <Toggle on={day.on} onClick={() => setDay(d, { on: !day.on })} />
              <span style={{ fontSize: 15.5, fontWeight: 500, color: day.on ? "var(--text)" : "var(--faint)", minWidth: 84 }}>{name}</span>
            </div>
            {day.on ? (
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <TimeSel value={day.start} onPick={(t) => setDay(d, { start: t })} />
                <span style={{ color: "var(--faint)", fontSize: 14 }}>–</span>
                <TimeSel value={day.end} onPick={(t) => setDay(d, { end: t })} />
              </div>
            ) : <span style={{ fontSize: 14.5, color: "var(--faint)" }}>Closed</span>}
          </div>
        );
      })}
    </div>
  );
}

function weekRange(ref = new Date()) {
  const start = new Date(ref); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - start.getDay()); // Sunday
  const end = new Date(start); end.setDate(start.getDate() + 7);
  return { start, end };
}

// Scheduling Options — buffers, booking window, and minimum notice. These read
// and write the same settings as Online Booking, so the two stay in sync.
function AvoidGapsEditor({ b, onChange }) {
  const set = (patch) => onChange({ ...b, ...patch });
  const enabled = b.avoidGaps !== false;
  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.5, marginBottom: 20 }}>Vero packs your day for you. No gaps, no fragmented time, no babysitting your calendar.</p>

      {/* Master toggle */}
      <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, marginBottom: 14 }}>
        <button onClick={() => set({ avoidGaps: !enabled })} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", color: "var(--text)", textAlign: "left" }}>
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 4 }}>Pack the day</div>
            <div style={{ fontSize: 13.5, color: "var(--sub)", lineHeight: 1.45 }}>Clients only see times that fill your day end-to-end. Empty days show a few smart anchor times so your calendar fills from multiple points at once.</div>
          </div>
          <span style={{ width: 44, height: 26, borderRadius: 13, background: enabled ? "var(--gold)" : "var(--border)", position: "relative", flexShrink: 0, marginLeft: 14 }}><span style={{ position: "absolute", top: 3, left: enabled ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} /></span>
        </button>
      </div>

      {enabled && (
        <div style={{ background: "color-mix(in srgb, var(--gold) 8%, var(--panel))", border: "1px solid color-mix(in srgb, var(--gold) 35%, var(--border))", borderRadius: 14, padding: "14px 16px", fontSize: 13.5, color: "var(--text)", lineHeight: 1.5 }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--gold)", fontWeight: 600, marginBottom: 6 }}>HOW IT WORKS</div>
          On empty days, Vero shows clients a morning, midday, and end-of-day slot so the day fills from multiple points. After that, every new opening sits flush against an existing booking. No dead time, ever.
        </div>
      )}
    </div>
  );
}

function SchedulingOptionsEditor({ b, onChange }) {
  const set = (patch) => onChange({ ...b, ...patch });
  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.5, marginBottom: 20 }}>Control the spacing and timing of appointments. Every value here is adjustable.</p>

      <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 4 }}>Buffer before each appointment</div>
        <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 12, lineHeight: 1.4 }}>Padding held open before a visit — for setup or greeting.</div>
        <Stepper value={b.bufferBefore || 0} onChange={(v) => set({ bufferBefore: v })} min={0} max={60} step={5} suffix="min" />
      </div>

      <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 4 }}>Buffer after each appointment</div>
        <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 12, lineHeight: 1.4 }}>Cleanup / turnover time before the next client.</div>
        <Stepper value={b.bufferAfter || 0} onChange={(v) => set({ bufferAfter: v })} min={0} max={60} step={5} suffix="min" />
      </div>

      <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 4 }}>Minimum notice</div>
        <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 12, lineHeight: 1.4 }}>How far ahead a client must book. Set to any hours and minutes.</div>
        <HourMinutePicker totalMin={b.leadTimeMin || 0} onChange={(v) => set({ leadTimeMin: v })} />
      </div>

      <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18 }}>
        <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 4 }}>Booking window</div>
        <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 12, lineHeight: 1.4 }}>How far in advance clients can book. Up to 90 days shows in days; beyond that, in months. Or pick no cutoff.</div>
        {(() => {
          const days = b.horizonDays === 0 ? 0 : (b.horizonDays || 60);
          const noCutoff = days === 0;
          const fmt = (d) => d >= 90 ? `${Math.round(d / 30)} months` : `${d} ${d === 1 ? "day" : "days"}`;
          const step = (n) => Math.abs(n) >= 30 ? 30 : 1;
          const dec = () => { const cur = days || 60; const s = cur > 90 ? 30 : 1; set({ horizonDays: Math.max(1, cur - s) }); };
          const inc = () => { const cur = days || 60; const s = cur >= 90 ? 30 : 1; set({ horizonDays: cur + s }); };
          const btn = (label, onClick, disabled) => (
            <button onClick={onClick} disabled={disabled} style={{ width: 38, height: 38, borderRadius: 11, border: "1px solid var(--border)", background: "var(--panel)", color: disabled ? "var(--faint)" : "var(--text)", fontSize: 20, fontWeight: 500, cursor: disabled ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>{label}</button>
          );
          return (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ fontSize: 14.5 }}>No cutoff (any future date)</span>
                <Toggle on={noCutoff} onClick={() => set({ horizonDays: noCutoff ? 60 : 0 })} />
              </div>
              {!noCutoff && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>{fmt(days || 60)}</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    {btn("−", dec, (days || 60) <= 1)}
                    {btn("+", inc, false)}
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

// Phone Numbers — add, label, edit, and remove the shop's numbers.
function PhoneNumbersEditor({ phones, onChange }) {
  const list = phones || [];
  const setPhone = (id, patch) => onChange(list.map((p) => p.id === id ? { ...p, ...patch } : p));
  const addPhone = () => onChange([...list, { id: "ph" + Date.now(), label: "", number: "" }]);
  const removePhone = (id) => onChange(list.filter((p) => p.id !== id));
  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.5, marginBottom: 18 }}>Numbers clients can reach you at. Label them however you like (Main, Booking, Texts).</p>
      {list.map((p) => (
        <div key={p.id} style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 14, padding: 14, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <input value={p.label} onChange={(e) => setPhone(p.id, { label: e.target.value })} placeholder="Label (e.g. Main)" style={{ flex: 1, background: "transparent", border: "none", color: "var(--text)", fontSize: 14, letterSpacing: 1, fontFamily: FONT_BODY, fontWeight: 600 }} />
            <button onClick={() => removePhone(p.id)} style={{ background: "none", color: "var(--faint)" }}><Trash2 size={16} /></button>
          </div>
          <input value={p.number} onChange={(e) => setPhone(p.id, { number: e.target.value })} placeholder="(555) 000-0000" style={{ width: "100%", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", color: "var(--text)", fontSize: 16, fontFamily: FONT_BODY, boxSizing: "border-box" }} />
        </div>
      ))}
      <button className="lift" onClick={addPhone} style={{ width: "100%", background: "transparent", border: "1px dashed var(--border2)", color: "var(--gold)", borderRadius: 12, padding: 14, fontSize: 14.5, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Plus size={16} /> Add phone number</button>
    </div>
  );
}

// Staff Selection — which staff appear as bookable in online booking.
function StaffSelectionEditor({ providers, setProviders }) {
  const staff = providers.filter((p) => p.id !== "anyone");
  const toggle = (pid) => setProviders(providers.map((p) => p.id === pid ? { ...p, onlineBooking: !p.onlineBooking } : p));
  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.5, marginBottom: 18 }}>Choose who clients can book online. Turning someone off keeps them on your calendar but hides them from the public booking page.</p>
      {staff.map((p, i) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 0", borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Avatar size={40} photo={staffPhoto(p)} initial={p.name.charAt(0)} color={p.color} />
            <div><div style={{ fontSize: 15.5, fontWeight: 500 }}>{p.name}</div><div style={{ fontSize: 13.5, color: "var(--sub)" }}>{p.role}</div></div>
          </div>
          <button onClick={() => toggle(p.id)} style={{ width: 44, height: 26, borderRadius: 13, background: p.onlineBooking ? "var(--gold)" : "var(--border)", position: "relative", flexShrink: 0 }}><span style={{ position: "absolute", top: 3, left: p.onlineBooking ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} /></button>
        </div>
      ))}
    </div>
  );
}

// Checkout Settings — payment methods, signatures, receipts, and checkout behavior.
function CheckoutSettingsEditor({ c, onChange }) {
  const set = (patch) => onChange({ ...c, ...patch });
  const methods = c.customMethods || [];
  const setMethod = (i, val) => { const m = [...methods]; m[i] = val; set({ customMethods: m }); };
  const addMethod = () => set({ customMethods: [...methods, ""] });
  const removeMethod = (i) => set({ customMethods: methods.filter((_, j) => j !== i) });
  const Toggle = ({ on, onClick }) => (
    <button onClick={onClick} style={{ width: 44, height: 26, borderRadius: 13, background: on ? "var(--gold)" : "var(--border)", position: "relative", flexShrink: 0 }}><span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} /></button>
  );
  const Card = ({ title, desc, children }) => (
    <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: desc ? 4 : 12 }}>{title}</div>
      {desc && <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 12, lineHeight: 1.4 }}>{desc}</div>}
      {children}
    </div>
  );
  const RowToggle = ({ title, desc, on, onClick, soon }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, marginBottom: 14, opacity: soon ? 0.7 : 1 }}>
      <div><div style={{ fontSize: 15.5, fontWeight: 600 }}>{title} {soon && <span style={{ fontSize: 11, letterSpacing: 1, color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: 20, padding: "1px 7px", marginLeft: 6 }}>WHEN LIVE</span>}</div><div style={{ fontSize: 13.5, color: "var(--sub)", marginTop: 3, lineHeight: 1.4 }}>{desc}</div></div>
      <Toggle on={on} onClick={onClick} />
    </div>
  );
  const sigOpts = [["never", "Never"], ["over", "Over an amount"], ["always", "Always"]];
  const rcptOpts = [["ask", "Ask the client"], ["email", "Email"], ["text", "Text"], ["print", "Print"], ["none", "No receipt"]];
  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.5, marginBottom: 18 }}>How checkout and payments behave. Items marked “when live” turn on once payment processing is connected.</p>

      <Card title="Custom payment methods" desc="The payment types that appear at checkout.">
        {methods.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input value={m} onChange={(e) => setMethod(i, e.target.value)} placeholder="e.g. Cash, Venmo, Zelle" style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px 13px", color: "var(--text)", fontSize: 15, fontFamily: FONT_BODY, boxSizing: "border-box" }} />
            <button onClick={() => removeMethod(i)} style={{ background: "none", color: "var(--faint)", padding: "0 4px" }}><Trash2 size={16} /></button>
          </div>
        ))}
        <button className="lift" onClick={addMethod} style={{ width: "100%", background: "transparent", border: "1px dashed var(--border2)", color: "var(--gold)", borderRadius: 10, padding: 11, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 4 }}><Plus size={15} /> Add method</button>
      </Card>

      <div style={{ fontSize: 13, color: "var(--faint)", lineHeight: 1.5, marginBottom: 14, padding: "0 4px" }}>Tip buttons & options are set in <strong style={{ color: "var(--sub)" }}>Payments & Checkout → Tipping</strong>.</div>

      <Card title="Signature required" desc="When to ask the client for a signature at checkout.">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {sigOpts.map(([v, label]) => { const on = c.requireSignature === v; return (
            <button key={v} onClick={() => set({ requireSignature: v })} style={{ flex: "1 1 30%", padding: "11px 8px", borderRadius: 10, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "rgba(176,141,87,0.12)" : "transparent", color: on ? "var(--gold)" : "var(--text)", fontSize: 14, fontWeight: on ? 600 : 400 }}>{label}</button>
          ); })}
        </div>
        {c.requireSignature === "over" && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 8 }}>Ask for a signature on totals above:</div>
            <Stepper value={c.signatureThreshold || 0} onChange={(v) => set({ signatureThreshold: v })} min={0} max={500} step={5} suffix="$" />
          </div>
        )}
      </Card>

      <RowToggle title="Change calculator for cash" desc="Show change-due math when a client pays cash." on={c.changeCalculator} onClick={() => set({ changeCalculator: !c.changeCalculator })} />
      <RowToggle title="Require staff assignments" desc="Every item in a sale must be assigned to a staff member before checkout." on={c.requireStaffAssignment} onClick={() => set({ requireStaffAssignment: !c.requireStaffAssignment })} />
      <RowToggle title="Client self-checkout" desc="Let clients review and pay on their own device." on={c.clientSelfCheckout} onClick={() => set({ clientSelfCheckout: !c.clientSelfCheckout })} soon />

      <Card title="Default receipt" desc="What happens with the receipt after a sale.">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {rcptOpts.map(([v, label]) => { const on = c.receiptDefault === v; return (
            <button key={v} onClick={() => set({ receiptDefault: v })} style={{ flex: "1 1 30%", padding: "11px 8px", borderRadius: 10, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "rgba(176,141,87,0.12)" : "transparent", color: on ? "var(--gold)" : "var(--text)", fontSize: 13.5, fontWeight: on ? 600 : 400 }}>{label}</button>
          ); })}
        </div>
        <div style={{ fontSize: 13.5, color: "var(--sub)", margin: "14px 0 8px" }}>Receipt footer message</div>
        <input value={c.receiptFooter || ""} onChange={(e) => set({ receiptFooter: e.target.value })} placeholder="Thank you for visiting!" style={{ width: "100%", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", color: "var(--text)", fontSize: 15, fontFamily: FONT_BODY, boxSizing: "border-box" }} />
      </Card>
    </div>
  );
}

// Waiting Room — how client check-in behaves (arrival → waiting → ready).
function WaitingRoomEditor({ w, onChange }) {
  const set = (patch) => onChange({ ...w, ...patch });
  const Toggle = ({ on, onClick }) => (
    <button onClick={onClick} style={{ width: 44, height: 26, borderRadius: 13, background: on ? "var(--gold)" : "var(--border)", position: "relative", flexShrink: 0 }}><span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} /></button>
  );
  const RowToggle = ({ title, desc, on, onClick, soon }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, marginBottom: 14, opacity: soon ? 0.7 : 1 }}>
      <div><div style={{ fontSize: 15.5, fontWeight: 600 }}>{title} {soon && <span style={{ fontSize: 11, letterSpacing: 1, color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: 20, padding: "1px 7px", marginLeft: 6 }}>WHEN LIVE</span>}</div><div style={{ fontSize: 13.5, color: "var(--sub)", marginTop: 3, lineHeight: 1.4 }}>{desc}</div></div>
      <Toggle on={on} onClick={onClick} />
    </div>
  );
  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.5, marginBottom: 18 }}>Controls how clients are checked in when they arrive, and how they're told you're ready for them.</p>

      <RowToggle title="Notify staff on arrival" desc="Ping the barber when a client is checked in and waiting." on={w.notifyOnArrival} onClick={() => set({ notifyOnArrival: !w.notifyOnArrival })} />
      <RowToggle title="Show waiting list" desc="Display a live list of clients who've checked in and are waiting." on={w.showWaitingList} onClick={() => set({ showWaitingList: !w.showWaitingList })} />
      <RowToggle title="Client self check-in" desc="Let clients check themselves in from a link or QR code on arrival." on={w.selfCheckIn} onClick={() => set({ selfCheckIn: !w.selfCheckIn })} soon />

      <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: w.autoReadyMessage ? 14 : 0 }}>
          <div><div style={{ fontSize: 15.5, fontWeight: 600 }}>Send "ready" message</div><div style={{ fontSize: 13.5, color: "var(--sub)", marginTop: 3, lineHeight: 1.4 }}>When you tap Notify · Ready, let the client know you're ready for them.</div></div>
          <Toggle on={w.autoReadyMessage} onClick={() => set({ autoReadyMessage: !w.autoReadyMessage })} />
        </div>
        {w.autoReadyMessage && (<>
          <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 8 }}>Message wording</div>
          <textarea value={w.readyMessage || ""} onChange={(e) => set({ readyMessage: e.target.value })} rows={3} style={{ width: "100%", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", color: "var(--text)", fontSize: 15, fontFamily: FONT_BODY, boxSizing: "border-box", resize: "vertical", lineHeight: 1.5 }} />
          <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 8, lineHeight: 1.4 }}>Use <strong style={{ color: "var(--sub)" }}>{"{provider}"}</strong> to drop in the barber's name automatically.</div>
        </>)}
      </div>
    </div>
  );
}

// Running Late Alerts — the "5 min left, want to tell your next client?" prompt.
function RunningLateEditor({ r, onChange }) {
  const set = (patch) => onChange({ ...r, ...patch });
  const ranges = r.ranges || ["5–10", "10–15"];
  const setRange = (i, val) => { const a = [...ranges]; a[i] = val; set({ ranges: a }); };
  const addRange = () => set({ ranges: [...ranges, ""] });
  const removeRange = (i) => set({ ranges: ranges.filter((_, j) => j !== i) });
  const Toggle = ({ on, onClick }) => (
    <button onClick={onClick} style={{ width: 44, height: 26, borderRadius: 13, background: on ? "var(--gold)" : "var(--border)", position: "relative", flexShrink: 0 }}><span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} /></button>
  );
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, marginBottom: 14 }}>
        <div><div style={{ fontSize: 15.5, fontWeight: 600 }}>Running-late alerts</div><div style={{ fontSize: 13.5, color: "var(--sub)", marginTop: 3, lineHeight: 1.4 }}>As you near the end of an appointment, get a prompt to let your next client know you're running a little behind.</div></div>
        <Toggle on={r.enabled} onClick={() => set({ enabled: !r.enabled })} />
      </div>

      {r.enabled && (<>
        <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 4 }}>Remind me when this much time is left</div>
          <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 12, lineHeight: 1.4 }}>How early in the appointment the prompt appears.</div>
          <Stepper value={r.thresholdMin || 5} onChange={(v) => set({ thresholdMin: v })} min={1} max={30} step={1} suffix="min" />
        </div>

        <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 4 }}>Delay options to offer</div>
          <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 12, lineHeight: 1.4 }}>The "how far behind" choices you tap when sending the notice.</div>
          {ranges.map((rg, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input value={rg} onChange={(e) => setRange(i, e.target.value)} placeholder="e.g. 5–10" style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px 13px", color: "var(--text)", fontSize: 15, fontFamily: FONT_BODY, boxSizing: "border-box" }} />
              <button onClick={() => removeRange(i)} style={{ background: "none", color: "var(--faint)", padding: "0 4px" }}><Trash2 size={16} /></button>
            </div>
          ))}
          <button className="lift" onClick={addRange} style={{ width: "100%", background: "transparent", border: "1px dashed var(--border2)", color: "var(--gold)", borderRadius: 10, padding: 11, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 4 }}><Plus size={15} /> Add option</button>
        </div>

        <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 4 }}>Message to the client</div>
          <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 12, lineHeight: 1.4 }}>Sent as an in-app notification — no text message.</div>
          <textarea value={r.message || ""} onChange={(e) => set({ message: e.target.value })} rows={4} style={{ width: "100%", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", color: "var(--text)", fontSize: 15, fontFamily: FONT_BODY, boxSizing: "border-box", resize: "vertical", lineHeight: 1.5 }} />
          <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 8, lineHeight: 1.5 }}>Tags you can use: <strong style={{ color: "var(--sub)" }}>{"{client}"}</strong> name, <strong style={{ color: "var(--sub)" }}>{"{provider}"}</strong> barber, <strong style={{ color: "var(--sub)" }}>{"{shop}"}</strong>, <strong style={{ color: "var(--sub)" }}>{"{range}"}</strong> minutes behind.</div>
        </div>
      </>)}
    </div>
  );
}

// "It's been a while" buffer — add time for overdue clients; charge or gift it.
function OverdueBufferEditor({ b, onChange }) {
  const set = (patch) => onChange({ ...b, ...patch });
  const Toggle = ({ on, onClick }) => (
    <button onClick={onClick} style={{ width: 44, height: 26, borderRadius: 13, background: on ? "var(--gold)" : "var(--border)", position: "relative", flexShrink: 0 }}><span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} /></button>
  );
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, marginBottom: 14 }}>
        <div><div style={{ fontSize: 15.5, fontWeight: 600 }}>Add time for overdue clients</div><div style={{ fontSize: 13.5, color: "var(--sub)", marginTop: 3, lineHeight: 1.4 }}>When someone hasn't visited in a while, automatically pad their appointment so there's enough time.</div></div>
        <Toggle on={b.enabled} onClick={() => set({ enabled: !b.enabled })} />
      </div>

      {b.enabled && (<>
        <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 4 }}>Counts as "a while" after</div>
          <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 12, lineHeight: 1.4 }}>How long since their last visit before time gets added.</div>
          <Stepper value={b.thresholdWeeks || 8} onChange={(v) => set({ thresholdWeeks: v })} min={1} max={52} step={1} suffix="weeks" />
        </div>

        <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 4 }}>Extra time to add</div>
          <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 12, lineHeight: 1.4 }}>How many minutes to pad the appointment.</div>
          <Stepper value={b.addMinutes || 10} onChange={(v) => set({ addMinutes: v })} min={5} max={60} step={5} suffix="min" />
        </div>

        <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 10 }}>How to handle it</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => set({ charge: false })} style={{ flex: 1, padding: "12px 8px", borderRadius: 10, border: `1px solid ${!b.charge ? "var(--gold)" : "var(--border)"}`, background: !b.charge ? "rgba(176,141,87,0.12)" : "transparent", color: !b.charge ? "var(--gold)" : "var(--text)", fontSize: 14, fontWeight: !b.charge ? 600 : 400 }}>Free bonus</button>
            <button onClick={() => set({ charge: true })} style={{ flex: 1, padding: "12px 8px", borderRadius: 10, border: `1px solid ${b.charge ? "var(--gold)" : "var(--border)"}`, background: b.charge ? "rgba(176,141,87,0.12)" : "transparent", color: b.charge ? "var(--gold)" : "var(--text)", fontSize: 14, fontWeight: b.charge ? 600 : 400 }}>Charge for it</button>
          </div>
          {b.charge && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 8 }}>Amount to add</div>
              <Stepper value={b.chargeAmount || 5} onChange={(v) => set({ chargeAmount: v })} min={0} max={100} step={5} suffix="$" />
            </div>
          )}
          <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 12, lineHeight: 1.5 }}>{b.charge ? "The client sees the added time and small fee, framed as a more thorough visit." : "The client is told the extra time is on the house — they feel looked-after, and your schedule stays protected."}</p>
        </div>

        <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 18 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 4 }}>Message to the client</div>
          <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 12, lineHeight: 1.4 }}>Shown at booking when extra time is added.</div>
          <textarea value={b.message || ""} onChange={(e) => set({ message: e.target.value })} rows={4} style={{ width: "100%", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", color: "var(--text)", fontSize: 15, fontFamily: FONT_BODY, boxSizing: "border-box", resize: "vertical", lineHeight: 1.5 }} />
        </div>
      </>)}
    </div>
  );
}

// Import Data — demo flow for bringing clients/appointments from another system.
// (Visual prototype: a real import runs once the app has a backend database.)
function ImportDataEditor({ showToast }) {
  const SYSTEMS = ["Square", "GlossGenius", "Vagaro", "Boulevard", "Booksy", "Acuity", "Other / CSV file"];
  const [system, setSystem] = useState(null);
  const [stage, setStage] = useState("pick"); // pick | upload | running | done
  const [pct, setPct] = useState(0);
  const startImport = () => {
    setStage("running"); setPct(0);
    const iv = setInterval(() => setPct((p) => {
      const next = p + Math.random() * 18 + 6;
      if (next >= 100) { clearInterval(iv); setStage("done"); if (showToast) showToast("Import complete (demo)."); return 100; }
      return next;
    }), 280);
  };
  const reset = () => { setSystem(null); setStage("pick"); setPct(0); };

  return (
    <div>
      <div style={{ background: "color-mix(in srgb, var(--gold) 8%, var(--panel2))", border: "1px solid color-mix(in srgb, var(--gold) 25%, var(--border))", borderRadius: 14, padding: 14, marginBottom: 18, fontSize: 13.5, color: "var(--sub)", lineHeight: 1.5 }}>Bring your clients, appointment history, and notes over from your old system. This is a preview — live importing turns on once your account is fully set up.</div>

      {stage === "pick" && (<>
        <div style={{ fontSize: 12.5, letterSpacing: 1.5, color: "var(--faint)", marginBottom: 10 }}>WHERE ARE YOU COMING FROM?</div>
        <div style={{ display: "grid", gap: 8 }}>
          {SYSTEMS.map((s) => { const on = system === s; return (
            <button key={s} onClick={() => setSystem(s)} style={{ textAlign: "left", background: on ? "color-mix(in srgb, var(--gold) 12%, var(--panel2))" : "var(--panel2)", border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, borderRadius: 12, padding: "14px 16px", color: "var(--text)", fontSize: 15.5, fontWeight: on ? 600 : 400, display: "flex", justifyContent: "space-between", alignItems: "center" }}>{s}{on && <Check size={17} style={{ color: "var(--gold)" }} />}</button>
          ); })}
        </div>
        <button className="lift" disabled={!system} onClick={() => setStage("upload")} style={{ width: "100%", marginTop: 16, background: system ? "var(--gold)" : "var(--border)", color: system ? "var(--on-gold)" : "var(--faint)", padding: 15, fontSize: 15, fontWeight: 600, borderRadius: 12, border: "none" }}>Continue</button>
      </>)}

      {stage === "upload" && (<>
        <div style={{ fontSize: 14.5, color: "var(--sub)", marginBottom: 14, lineHeight: 1.5 }}>Export your data from <strong style={{ color: "var(--text)" }}>{system}</strong> (usually Settings → Export, which gives you a spreadsheet/CSV file), then upload it here.</div>
        <button className="lift" onClick={startImport} style={{ width: "100%", border: "1px dashed var(--border2)", background: "var(--panel2)", borderRadius: 14, padding: "34px 16px", color: "var(--sub)", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <Upload size={30} style={{ color: "var(--faint)" }} />
          <span style={{ fontSize: 15, color: "var(--text)" }}>Upload export file</span>
          <span style={{ fontSize: 13, color: "var(--faint)" }}>.csv or .xlsx — drag here or tap to choose (simulated)</span>
        </button>
        <button onClick={reset} style={{ width: "100%", marginTop: 12, background: "none", border: "none", color: "var(--sub)", fontSize: 14.5, padding: 8 }}>Back</button>
      </>)}

      {stage === "running" && (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 14 }}>Importing from {system}…</div>
          <div style={{ height: 10, borderRadius: 6, background: "var(--panel2)", border: "1px solid var(--border)", overflow: "hidden", marginBottom: 10 }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "var(--gold)", transition: "width .25s var(--ease)" }} />
          </div>
          <div style={{ fontSize: 13.5, color: "var(--sub)" }}>{Math.round(pct)}% — matching clients, appointments, and notes</div>
        </div>
      )}

      {stage === "done" && (
        <div style={{ textAlign: "center", padding: "10px 0" }}>
          <CheckCircle2 size={40} style={{ color: "#5E8C61", marginBottom: 12 }} />
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, marginBottom: 6 }}>Import complete</div>
          <div style={{ fontSize: 14.5, color: "var(--sub)", lineHeight: 1.5, marginBottom: 18 }}>Brought over from {system}:</div>
          <div style={{ display: "grid", gap: 8, marginBottom: 20, textAlign: "left" }}>
            {[["1,240", "clients"], ["3,580", "past appointments"], ["612", "client notes"], ["48", "gift card balances"]].map(([n, label]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px" }}>
                <span style={{ fontSize: 14.5, color: "var(--sub)" }}>{label}</span><span style={{ fontSize: 15, fontWeight: 600 }}>{n}</span>
              </div>
            ))}
          </div>
          <button className="lift" onClick={reset} style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", color: "var(--text)", padding: 13, fontSize: 14, letterSpacing: 1, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><RefreshCw size={16} /> IMPORT ANOTHER FILE</button>
        </div>
      )}
    </div>
  );
}
function serviceCommissionFor(comp, serviceSales) {
  const sc = comp.service;
  if (!sc || !sc.on) return 0;
  if (sc.type === "basic") return serviceSales * (Number(sc.basicPct) || 0) / 100;
  // sliding scale: tiers are [{upTo, pct}], last upTo === null means "and above"
  // We apply the bracket the TOTAL falls into (whole-amount style, matching Mangomint's simple sliding scale).
  const tiers = [...(sc.tiers || [])].sort((a, b) => (a.upTo == null ? 1 : b.upTo == null ? -1 : a.upTo - b.upTo));
  let pct = 0;
  for (const t of tiers) { pct = Number(t.pct) || 0; if (t.upTo == null || serviceSales <= t.upTo) break; }
  return serviceSales * pct / 100;
}
function estimateEarnings(provider, appts, services, ref = new Date()) {
  const comp = provider.comp || {};
  const { start, end } = weekRange(ref);
  // completed appointments for this provider this week
  const mine = (appts || []).filter((a) => a.providerId === provider.id && (a.status === "done" || a.paid));
  // Without real timestamps in the prototype, treat all completed appts as "this week" sample.
  const serviceSales = mine.reduce((sum, a) => sum + (Number(a.price) || 0), 0);
  const productSales = 0; // no product sales in prototype
  const svcCommission = serviceCommissionFor(comp, serviceSales);
  const prodCommission = (comp.product && comp.product.on) ? productSales * (Number(comp.product.defaultPct) || 0) / 100 : 0;
  // hours worked from the provider's weekly schedule
  let minutes = 0;
  Object.values(provider.hours || {}).forEach((h) => { if (h && h.on) minutes += (h.end - h.start); });
  const hours = minutes / 60;
  const hourlyPay = (comp.hourly && comp.hourly.on) ? hours * (Number(comp.hourly.rate) || 0) : 0;
  const commissionTotal = svcCommission + prodCommission;
  // greater-of: pay the higher of hourly vs commission (only when hourly + greaterOf are on)
  let total, basis;
  if (comp.hourly && comp.hourly.on && comp.hourly.greaterOf) {
    if (hourlyPay >= commissionTotal) { total = hourlyPay; basis = "Hourly (greater of)"; }
    else { total = commissionTotal; basis = "Commission (greater of)"; }
  } else {
    total = hourlyPay + commissionTotal;
    basis = "Hourly + commission";
  }
  return { serviceSales, productSales, svcCommission, prodCommission, hours, hourlyPay, commissionTotal, total, basis, count: mine.length, start, end };
}

// ============================================================
// STAFF MEMBERS — Mangomint-style hub: list → member → sections
// ============================================================
function StaffMembersView({ providers, setProviders, services, setServices, appts, showToast }) {
  const [openId, setOpenId] = useState(null);   // selected staff id (null = list)
  const [section, setSection] = useState(null); // null = hub, else section key
  const [showArchived, setShowArchived] = useState(false);
  const [picker, setPicker] = useState(false);  // photo picker open
  const [editingDetails, setEditingDetails] = useState(false);
  const [workWeekRef, setWorkWeekRef] = useState(new Date());

  const staff = providers.filter((p) => p.id !== "anyone");
  const active = staff.filter((p) => !p.archived);
  const archived = staff.filter((p) => p.archived);
  const person = providers.find((p) => p.id === openId);

  const patch = (pid, obj) => setProviders(providers.map((p) => p.id === pid ? { ...p, ...obj } : p));
  const patchComp = (pid, branch, obj) => setProviders(providers.map((p) => p.id === pid ? { ...p, comp: { ...defaultComp(), ...(p.comp || {}), [branch]: { ...defaultComp()[branch], ...((p.comp || {})[branch] || {}), ...obj } } } : p));
  const patchNotif = (pid, obj) => setProviders(providers.map((p) => p.id === pid ? { ...p, notifications: { ...defaultStaffNotifications(), ...(p.notifications || {}), ...obj } } : p));
  const patchDay = (pid, dow, obj) => setProviders(providers.map((p) => p.id === pid ? { ...p, hours: { ...p.hours, [dow]: { ...p.hours[dow], ...obj } } } : p));
  const patchPerm = (pid, key) => setProviders(providers.map((p) => { if (p.id !== pid) return p; const cur = { ...defaultPermissions(p.userType), ...(p.permissions || {}) }; return { ...p, permissions: { ...cur, [key]: !cur[key] } }; }));

  const addStaff = () => {
    const colors = ["#C2703D", "#5E8C72", "#8064B5", "#3D9BE9", "#B14A5E"];
    const id = "s" + Date.now();
    setProviders([...providers, { id, name: "New Staff Member", role: "Stylist", color: colors[providers.length % colors.length], photo: STAFF_PORTRAITS[providers.length % STAFF_PORTRAITS.length], hours: { ...DEFAULT_HOURS }, email: "", phone: "", userType: "Staff", isProvider: true, onlineBooking: true, archived: false, notifications: defaultStaffNotifications(), comp: defaultComp(), permissions: defaultPermissions("Staff") }]);
    setOpenId(id); setSection(null); showToast("Staff member added.");
  };
  const archive = (pid) => { patch(pid, { archived: true }); setOpenId(null); showToast("Staff member archived."); };
  const restore = (pid) => { patch(pid, { archived: false }); showToast("Staff member restored."); };

  // shared UI
  const Toggle = ({ on, onClick, dim }) => (
    <button onClick={onClick} style={{ width: 48, height: 28, borderRadius: 16, background: on ? "var(--gold)" : "var(--border2)", position: "relative", transition: "background .2s", flexShrink: 0, opacity: dim ? 0.5 : 1 }}>
      <span style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
    </button>
  );
  const SecHeader = ({ title, onBack, right }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20 }}>
      <button onClick={onBack} style={{ background: "none", color: "var(--gold)", display: "flex", alignItems: "center", fontSize: 16 }}><ChevronLeft size={20} /></button>
      <div style={{ flex: 1 }}><div style={{ fontSize: 12, letterSpacing: 2, color: "var(--faint)", fontWeight: 500 }}>{person ? person.name.toUpperCase() : "STAFF"}</div><h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 500, lineHeight: 1 }}>{title}</h2></div>
      {right}
    </div>
  );

  // ---------- LIST ----------
  if (!person) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.6, fontWeight: 300, margin: 0, flex: 1 }}>Manage your team — details, notifications, services, hours, and compensation.</p>
          <button onClick={addStaff} className="lift" style={{ background: "var(--gold)", color: "var(--on-gold)", width: 38, height: 38, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: 12 }}><Plus size={20} /></button>
        </div>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
          {active.map((p, i) => (
            <button key={p.id} onClick={() => { setOpenId(p.id); setSection(null); }} className="lift" style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "var(--panel)", color: "var(--text)", textAlign: "left", borderTop: i ? "1px solid var(--line)" : "none" }}>
              <Avatar size={46} photo={p.id === "anyone" ? null : staffPhoto(p)} initial={p.name.charAt(0)} color={p.color || "var(--gold)"} />
              <div style={{ flex: 1 }}><div style={{ fontSize: 16.5, fontWeight: 600 }}>{p.name}</div><div style={{ fontSize: 13.5, color: "var(--sub)" }}>{p.role}</div></div>
              <ChevronRight size={20} style={{ color: "var(--faint)" }} />
            </button>
          ))}
        </div>

        {archived.length > 0 && (
          <button onClick={() => setShowArchived(!showArchived)} className="lift" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "16px 18px", color: "var(--text)" }}>
            <span style={{ fontSize: 15.5, fontWeight: 600 }}>Show Archived Staff</span>
            <ChevronRight size={18} style={{ color: "var(--faint)", transform: showArchived ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
          </button>
        )}
        {showArchived && archived.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 14, padding: "12px 16px" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--panel)", color: "var(--sub)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY }}>{p.name.charAt(0)}</div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 500 }}>{p.name}</div><div style={{ fontSize: 13, color: "var(--faint)" }}>Archived</div></div>
            <button onClick={() => restore(p.id)} style={{ background: "none", color: "var(--gold)", fontSize: 14, fontWeight: 500 }}>Restore</button>
          </div>
        ))}
      </div>
    );
  }

  // ---------- DETAILS ----------
  if (section === "details") {
    const ut = person.userType || "Staff";
    return (
      <div className="appt-screen" style={{ paddingBottom: 40 }}>
        {picker && <StaffPhotoPicker hasPhoto={!!person.photo} onClose={() => setPicker(false)} onPick={(id) => { patch(person.id, { photo: id }); setPicker(false); }} onRemove={() => { patch(person.id, { photo: null }); setPicker(false); }} />}
        <SecHeader title="Details" onBack={() => setSection(null)} right={<button onClick={() => setEditingDetails(!editingDetails)} style={{ background: "none", color: "var(--gold)", fontSize: 16, fontWeight: 500 }}>{editingDetails ? "Done" : "Edit"}</button>} />
        {/* avatar */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
          <button onClick={() => setPicker(true)} style={{ position: "relative", width: 96, height: 96, borderRadius: "50%", background: "none", border: "none", padding: 0 }}>
            <Avatar size={96} photo={person.id === "anyone" ? null : staffPhoto(person)} initial={person.name.charAt(0)} color={person.color || "var(--gold)"} />
            <span style={{ position: "absolute", bottom: 2, right: 2, width: 30, height: 30, borderRadius: "50%", background: "var(--gold)", color: "var(--on-gold)", display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid var(--bg)" }}><Camera size={14} /></span>
          </button>
        </div>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "6px 18px" }}>
          {editingDetails ? (
            <div style={{ display: "grid", gap: 14, padding: "14px 0" }}>
              <div><div style={{ fontSize: 13, color: "var(--faint)", marginBottom: 5 }}>Name</div><input value={person.name} onChange={(e) => patch(person.id, { name: e.target.value })} style={inputStyle} /></div>
              <div><div style={{ fontSize: 13, color: "var(--faint)", marginBottom: 5 }}>Role / title</div><input value={person.role} onChange={(e) => patch(person.id, { role: e.target.value })} style={inputStyle} /></div>
              <div><div style={{ fontSize: 13, color: "var(--faint)", marginBottom: 5 }}>Email</div><input value={person.email || ""} onChange={(e) => patch(person.id, { email: e.target.value })} style={inputStyle} /></div>
              <div><div style={{ fontSize: 13, color: "var(--faint)", marginBottom: 5 }}>Phone</div><input value={person.phone || ""} onChange={(e) => patch(person.id, { phone: e.target.value })} style={inputStyle} /></div>
              <div><div style={{ fontSize: 13, color: "var(--faint)", marginBottom: 5 }}>User type</div>
                <div style={{ display: "flex", gap: 8 }}>{["Admin", "Staff", "Front Desk"].map((t) => (
                  <button key={t} onClick={() => patch(person.id, { userType: t })} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${ut === t ? "var(--gold)" : "var(--border)"}`, background: ut === t ? "color-mix(in srgb, var(--gold) 12%, var(--panel))" : "var(--panel2)", color: ut === t ? "var(--gold)" : "var(--text)", fontSize: 14, fontWeight: ut === t ? 600 : 400 }}>{t}</button>
                ))}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><span style={{ fontSize: 15 }}>Is service provider</span><Toggle on={person.isProvider !== false} onClick={() => patch(person.id, { isProvider: !(person.isProvider !== false) })} /></div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><span style={{ fontSize: 15 }}>Enable in online booking</span><Toggle on={!!person.onlineBooking} onClick={() => patch(person.id, { onlineBooking: !person.onlineBooking })} /></div>
            </div>
          ) : (
            <div>
              {[["Email", person.email || "—"], ["Phone", person.phone || "—"], ["User type", ut], ["Is service provider", person.isProvider !== false ? "Yes" : "No"], ["Enable in online booking", person.onlineBooking ? "Yes" : "No"]].map(([k, v], i) => (
                <div key={k} style={{ padding: "16px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                  <div style={{ fontSize: 14, color: "var(--faint)", marginBottom: 3 }}>{k}</div>
                  <div style={{ fontSize: 16, color: k === "Email" ? "var(--gold)" : "var(--text)" }}>{v}</div>
                </div>
              ))}
              <div style={{ padding: "16px 0", borderTop: "1px solid var(--line)" }}>
                <button onClick={() => showToast("iCal calendar URL copied.")} style={{ background: "none", color: "var(--gold)", fontSize: 15 }}>View iCal Calendar URL</button>
              </div>
              <div style={{ padding: "16px 0", borderTop: "1px solid var(--line)" }}>
                <div style={{ fontSize: 14, color: "var(--faint)", marginBottom: 6 }}>Online booking direct link</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 14, color: "var(--gold)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>booking.meridian.app/{person.id}</span>
                  <button onClick={() => showToast("Link copied.")} style={{ background: "none", color: "var(--sub)" }}><Copy size={16} /></button>
                </div>
              </div>
            </div>
          )}
        </div>
        <button onClick={() => archive(person.id)} style={{ marginTop: 18, background: "none", color: "#C2563F", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}><Trash2 size={14} /> Archive {person.name}</button>
      </div>
    );
  }

  // ---------- NOTIFICATIONS ----------
  if (section === "notifications") {
    const n = { ...defaultStaffNotifications(), ...(person.notifications || {}) };
    const Row = ({ label, k }) => (
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, padding: "14px 0" }}>
        <span style={{ fontSize: 15.5, flex: 1, lineHeight: 1.4 }}>{label}</span>
        <Toggle on={!!n[k]} onClick={() => patchNotif(person.id, { [k]: !n[k] })} />
      </div>
    );
    const Group = ({ title, children }) => (
      <div style={{ marginBottom: 8 }}><div style={{ fontSize: 17, fontWeight: 700, margin: "18px 0 4px", fontFamily: FONT_DISPLAY }}>{title}</div>{children}</div>
    );
    return (
      <div className="appt-screen" style={{ paddingBottom: 40 }}>
        <SecHeader title="Notifications" onBack={() => setSection(null)} />
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "8px 18px 18px" }}>
          <Group title="Send SMS when:"><Row label="Online bookings are created, changed, or removed" k="smsOnlineBooking" /><Row label="Other bookings are created, changed, or removed" k="smsOtherBooking" /></Group>
          <Group title="Send email when:"><Row label="Online bookings are created" k="emailOnlineBooking" /></Group>
          <Group title="Send mobile app notification when:"><Row label="New text message is received" k="appNewText" /><Row label="New web chat message is received" k="appNewChat" /><Row label="Missed call or voicemail is received" k="appMissedCall" /></Group>
        </div>
      </div>
    );
  }

  // ---------- SERVICES (per-staff) — reads/writes the SAME service.staff store as the service editor ----------
  if (section === "services") {
    const entryFor = (s) => (s.staff && s.staff[person.id]) || { on: true, duration: null, price: null };
    const setSvc = (sid, obj) => setServices(services.map((s) => {
      if (s.id !== sid) return s;
      const cur = (s.staff && s.staff[person.id]) || { on: true, duration: null, price: null };
      return { ...s, staff: { ...(s.staff || {}), [person.id]: { ...cur, ...obj } } };
    }));
    const allOff = services.every((s) => entryFor(s).on === false);
    return (
      <div className="appt-screen" style={{ paddingBottom: 40 }}>
        <SecHeader title="Services" onBack={() => setSection(null)} right={
          <button onClick={() => { const next = !!allOff; services.forEach((s) => setSvc(s.id, { on: next })); }} style={{ background: "none", color: "var(--gold)", fontSize: 15, fontWeight: 500 }}>{allOff ? "Enable all" : "Disable all"}</button>
        } />
        <p style={{ fontSize: 13.5, color: "var(--faint)", lineHeight: 1.5, marginBottom: 14 }}>Same settings as each service's Staff tab — edit here or there, they stay in sync.</p>
        <div style={{ display: "grid", gap: 14 }}>
          {services.map((s) => {
            const e = entryFor(s); const on = e.on !== false;
            return (
              <div key={s.id} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 16, opacity: on ? 1 : 0.55 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: on ? 14 : 0 }}>
                  <span style={{ fontSize: 16.5, fontWeight: 700 }}>{s.name}</span>
                  <Toggle on={on} onClick={() => setSvc(s.id, { on: !on })} />
                </div>
                {on && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--line)" }}>
                      <span style={{ fontSize: 15, color: "var(--text2)" }}>Duration</span>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                          <input type="number" value={e.duration ?? ""} onChange={(ev) => setSvc(s.id, { duration: ev.target.value === "" ? null : Number(ev.target.value) })} placeholder={String(s.duration)} style={{ width: 56, background: "transparent", border: "none", color: "var(--gold)", fontSize: 17, fontWeight: 700, textAlign: "right", fontFamily: FONT_BODY }} />
                          <span style={{ fontSize: 15, color: "var(--gold)", fontWeight: 700 }}>min</span>
                        </div>
                        {e.duration != null && <button onClick={() => setSvc(s.id, { duration: null })} style={{ background: "none", color: "var(--sub)", fontSize: 12.5 }}>Reset to default</button>}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--line)" }}>
                      <span style={{ fontSize: 15, color: "var(--text2)" }}>Price</span>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 2, justifyContent: "flex-end" }}>
                          <span style={{ fontSize: 17 }}>$</span>
                          <input type="number" value={e.price ?? ""} onChange={(ev) => setSvc(s.id, { price: ev.target.value === "" ? null : Number(ev.target.value) })} placeholder={String(s.price)} style={{ width: 70, background: "transparent", border: "none", color: "var(--text)", fontSize: 17, textAlign: "right", fontFamily: FONT_BODY }} />
                        </div>
                        {e.price != null && <button onClick={() => setSvc(s.id, { price: null })} style={{ background: "none", color: "var(--sub)", fontSize: 12.5 }}>Reset to default</button>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------- WORK HOURS ----------
  if (section === "hours") {
    const { start } = weekRange(workWeekRef);
    const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    const fmtRange = (h) => `${fmtTime(h.start)} – ${fmtTime(h.end)}`;
    const label = `${MONTHS[days[0].getMonth()].slice(0,3)} ${days[0].getDate()} – ${days[6].getDate()}, ${days[6].getFullYear()}`;
    const shift = (delta) => { const d = new Date(workWeekRef); d.setDate(d.getDate() + delta * 7); setWorkWeekRef(d); };
    return (
      <div className="appt-screen" style={{ paddingBottom: 40 }}>
        <SecHeader title="Work Hours" onBack={() => setSection(null)} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ fontSize: 15, color: "var(--sub)" }}>{label}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => shift(-1)} style={{ width: 38, height: 38, borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", display: "flex", alignItems: "center", justifyContent: "center" }}><ChevronLeft size={18} /></button>
            <button onClick={() => shift(1)} style={{ width: 38, height: 38, borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", display: "flex", alignItems: "center", justifyContent: "center" }}><ChevronRight size={18} /></button>
          </div>
        </div>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "8px 14px" }}>
          {days.map((d, i) => { const dow = d.getDay(); const h = person.hours[dow] || { on: false, start: 540, end: 1020 }; return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", borderTop: i ? "1px solid var(--line)" : "none" }}>
              <div style={{ width: 52, flexShrink: 0 }}><div style={{ fontSize: 14.5, fontWeight: 700 }}>{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dow]}</div><div style={{ fontSize: 12.5, color: "var(--faint)" }}>{d.getMonth()+1}/{d.getDate()}</div></div>
              <button onClick={() => patchDay(person.id, dow, { on: !h.on })} style={{ flex: 1, textAlign: "left", background: h.on ? "color-mix(in srgb, var(--gold) 8%, var(--panel2))" : "var(--panel2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", color: h.on ? "var(--text)" : "var(--faint)", fontSize: 15, fontStyle: h.on ? "normal" : "italic" }}>{h.on ? fmtRange(h) : "No shifts"}</button>
              {h.on && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => patchDay(person.id, dow, { start: Math.max(0, h.start - 15) })} style={{ width: 26, height: 24, borderRadius: 6, background: "var(--panel2)", border: "1px solid var(--border)", fontSize: 13, color: "var(--text)" }}>−</button>
                    <button onClick={() => patchDay(person.id, dow, { start: h.start + 15 })} style={{ width: 26, height: 24, borderRadius: 6, background: "var(--panel2)", border: "1px solid var(--border)", fontSize: 13, color: "var(--text)" }}>+</button>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => patchDay(person.id, dow, { end: Math.max(h.start + 15, h.end - 15) })} style={{ width: 26, height: 24, borderRadius: 6, background: "var(--panel2)", border: "1px solid var(--border)", fontSize: 13, color: "var(--text)" }}>−</button>
                    <button onClick={() => patchDay(person.id, dow, { end: h.end + 15 })} style={{ width: 26, height: 24, borderRadius: 6, background: "var(--panel2)", border: "1px solid var(--border)", fontSize: 13, color: "var(--text)" }}>+</button>
                  </div>
                </div>
              )}
            </div>
          ); })}
        </div>
        <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 12, lineHeight: 1.5 }}>The − / + buttons nudge each shift's start (top row) and end (bottom row) by 15 minutes. These hours drive the calendar and online booking availability.</p>
      </div>
    );
  }

  // ---------- COMPENSATION ----------
  if (section === "comp") {
    const comp = { ...defaultComp(), ...(person.comp || {}) };
    const sc = { ...defaultComp().service, ...comp.service };
    const pc = { ...defaultComp().product, ...comp.product };
    const hr = { ...defaultComp().hourly, ...comp.hourly };
    const est = estimateEarnings(person, appts, services, new Date());
    const Card = ({ title, desc, on, onToggle, children }) => (
      <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
          <div style={{ flex: 1 }}><div style={{ fontSize: 18, fontWeight: 700, fontFamily: FONT_DISPLAY }}>{title}</div><div style={{ fontSize: 14, color: "var(--sub)", marginTop: 4, lineHeight: 1.45 }}>{desc}</div></div>
          <Toggle on={on} onClick={onToggle} />
        </div>
        {on && children}
      </div>
    );
    return (
      <div className="appt-screen" style={{ paddingBottom: 40 }}>
        <SecHeader title="Compensation" onBack={() => setSection(null)} />

        {/* Service Commission */}
        <Card title="Service Commission" desc="Compensation is calculated as a percentage of service sales" on={sc.on} onToggle={() => patchComp(person.id, "service", { on: !sc.on })}>
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            <button onClick={() => patchComp(person.id, "service", { type: "basic" })} style={{ display: "flex", alignItems: "center", gap: 12, background: "none", textAlign: "left", color: "var(--text)" }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${sc.type === "basic" ? "var(--gold)" : "var(--border2)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{sc.type === "basic" && <span style={{ width: 11, height: 11, borderRadius: "50%", background: "var(--gold)" }} />}</span>
              <span><span style={{ fontSize: 15.5, fontWeight: 600 }}>Basic Service Commission</span><br /><span style={{ fontSize: 13.5, color: "var(--sub)" }}>A flat percentage of total sales</span></span>
            </button>
            {sc.type === "basic" && (
              <div style={{ paddingLeft: 34 }}>
                <div style={{ fontSize: 13, color: "var(--faint)", marginBottom: 5 }}>Default percentage</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px 14px", maxWidth: 140 }}>
                  <input type="number" value={sc.basicPct} onChange={(e) => patchComp(person.id, "service", { basicPct: Number(e.target.value) })} style={{ width: 50, background: "transparent", border: "none", color: "var(--text)", fontSize: 16, fontFamily: FONT_BODY }} /><span style={{ fontSize: 16, color: "var(--sub)" }}>%</span>
                </div>
              </div>
            )}
            <button onClick={() => patchComp(person.id, "service", { type: "sliding" })} style={{ display: "flex", alignItems: "center", gap: 12, background: "none", textAlign: "left", color: "var(--text)" }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${sc.type === "sliding" ? "var(--gold)" : "var(--border2)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{sc.type === "sliding" && <span style={{ width: 11, height: 11, borderRadius: "50%", background: "var(--gold)" }} />}</span>
              <span><span style={{ fontSize: 15.5, fontWeight: 600 }}>Sliding Scale Service Commission</span><br /><span style={{ fontSize: 13.5, color: "var(--sub)" }}>Percentage depends on amount sold</span></span>
            </button>
            {sc.type === "sliding" && (
              <div style={{ paddingLeft: 34, display: "grid", gap: 8 }}>
                {sc.tiers.map((t, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13.5, color: "var(--sub)", width: 54 }}>{i === 0 ? "Up to" : t.upTo == null ? "Above" : "Up to"}</span>
                    {t.upTo == null ? <span style={{ flex: 1, fontSize: 14, color: "var(--faint)" }}>(remaining)</span> : (
                      <div style={{ display: "flex", alignItems: "center", gap: 3, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", flex: 1 }}>
                        <span style={{ fontSize: 14, color: "var(--sub)" }}>$</span>
                        <input type="number" value={t.upTo} onChange={(e) => { const tiers = sc.tiers.map((x, idx) => idx === i ? { ...x, upTo: Number(e.target.value) } : x); patchComp(person.id, "service", { tiers }); }} style={{ width: "100%", background: "transparent", border: "none", color: "var(--text)", fontSize: 14, fontFamily: FONT_BODY }} />
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 3, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", width: 76 }}>
                      <input type="number" value={t.pct} onChange={(e) => { const tiers = sc.tiers.map((x, idx) => idx === i ? { ...x, pct: Number(e.target.value) } : x); patchComp(person.id, "service", { tiers }); }} style={{ width: "100%", background: "transparent", border: "none", color: "var(--text)", fontSize: 14, fontFamily: FONT_BODY }} /><span style={{ fontSize: 14, color: "var(--sub)" }}>%</span>
                    </div>
                  </div>
                ))}
                <p style={{ fontSize: 13, color: "var(--faint)", lineHeight: 1.5 }}>Whichever bracket the week's service sales fall into sets the rate.</p>
              </div>
            )}
          </div>
        </Card>

        {/* Product Commission */}
        <Card title="Product Commission" desc="Compensation is calculated as a percentage of product sales" on={pc.on} onToggle={() => patchComp(person.id, "product", { on: !pc.on })}>
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, color: "var(--faint)", marginBottom: 5 }}>Default percentage</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px 14px", maxWidth: 140, marginBottom: 16 }}>
              <input type="number" value={pc.defaultPct} onChange={(e) => patchComp(person.id, "product", { defaultPct: Number(e.target.value) })} style={{ width: 50, background: "transparent", border: "none", color: "var(--text)", fontSize: 16, fontFamily: FONT_BODY }} /><span style={{ fontSize: 16, color: "var(--sub)" }}>%</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Toggle on={!!pc.overridesOn} onClick={() => patchComp(person.id, "product", { overridesOn: !pc.overridesOn })} /><span style={{ fontSize: 15 }}>Enable commission overrides</span></div>
            <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 10, lineHeight: 1.5 }}>Override the default rate for specific products or categories. The most specific rate applies.</p>
          </div>
        </Card>

        {/* Hourly */}
        <Card title="Hourly" desc="Compensation is calculated using a flat rate per hour" on={hr.on} onToggle={() => patchComp(person.id, "hourly", { on: !hr.on })}>
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, color: "var(--faint)", marginBottom: 5 }}>Amount per hour</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px 14px", marginBottom: 16 }}>
              <span style={{ fontSize: 16, color: "var(--sub)" }}>$</span><input type="number" value={hr.rate || ""} placeholder="e.g. 20" onChange={(e) => patchComp(person.id, "hourly", { rate: Number(e.target.value) })} style={{ flex: 1, background: "transparent", border: "none", color: "var(--text)", fontSize: 16, fontFamily: FONT_BODY }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Toggle on={!!hr.greaterOf} onClick={() => patchComp(person.id, "hourly", { greaterOf: !hr.greaterOf })} /><span style={{ fontSize: 15 }}>Enable greater-of calculation</span></div>
            <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 10, lineHeight: 1.5 }}>Staff member is paid the higher value between their hourly rate and commission earnings.</p>
          </div>
        </Card>

        {/* Live earnings readout */}
        <div style={{ background: "color-mix(in srgb, var(--gold) 8%, var(--panel))", border: "1px solid var(--gold)", borderRadius: 16, padding: 18, marginTop: 6 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: "var(--gold)", fontWeight: 600, marginBottom: 8 }}>ESTIMATED EARNINGS · THIS WEEK</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 600, marginBottom: 4 }}>${est.total.toFixed(2)}</div>
          <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 14 }}>{est.basis} · {est.count} completed appt{est.count !== 1 ? "s" : ""}</div>
          {[["Service sales", `$${est.serviceSales.toFixed(2)}`], ["Service commission", `$${est.svcCommission.toFixed(2)}`], ["Hours scheduled", `${est.hours.toFixed(1)} h`], ["Hourly pay", `$${est.hourlyPay.toFixed(2)}`]].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", fontSize: 14.5, borderTop: "1px solid color-mix(in srgb, var(--gold) 20%, transparent)" }}><span style={{ color: "var(--sub)" }}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span></div>
          ))}
          <p style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 12, lineHeight: 1.5 }}>Live estimate from completed appointments using the settings above. Real payroll (taxes, tips, time clock, pay periods) requires the backend.</p>
        </div>
      </div>
    );
  }

  // ---------- PERMISSIONS ----------
  if (section === "permissions") {
    const perms = { ...defaultPermissions(person.userType), ...(person.permissions || {}) };
    return (
      <div className="appt-screen" style={{ paddingBottom: 40 }}>
        <SecHeader title="Permissions" onBack={() => setSection(null)} />
        <p style={{ fontSize: 13.5, color: "var(--faint)", lineHeight: 1.5, marginBottom: 16 }}>Control exactly what {person.name.split(" ")[0]} can see and do. Admins start with everything on; other roles start with everything off.</p>
        <div style={{ display: "grid", gap: 14 }}>
          {PERMISSION_SECTIONS.map((sec) => (
            <div key={sec.group} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "18px 18px 6px" }}>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: FONT_DISPLAY, marginBottom: 4 }}>{sec.group}</div>
              {sec.items.map((it, i) => (
                <div key={it.key} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, padding: "16px 0", borderTop: i ? "1px solid var(--line)" : "1px solid var(--line)" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15.5, color: "var(--text)" }}>{it.label}</div>
                    <div style={{ fontSize: 13.5, color: "var(--sub)", marginTop: 3, lineHeight: 1.45 }}>{it.desc}</div>
                  </div>
                  <Toggle on={!!perms[it.key]} onClick={() => patchPerm(person.id, it.key)} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---------- MEMBER HUB ----------
  const hubRows = [
    { id: "details", label: "Details" },
    { id: "notifications", label: "Notifications" },
    { id: "services", label: "Services" },
    { id: "hours", label: "Work Hours" },
    { id: "comp", label: "Compensation" },
    { id: "permissions", label: "Permissions" },
  ];
  return (
    <div className="appt-screen" style={{ paddingBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18 }}>
        <button onClick={() => setOpenId(null)} style={{ background: "none", color: "var(--gold)", display: "flex", alignItems: "center", fontSize: 16 }}><ChevronLeft size={20} /> <span style={{ fontSize: 15 }}>Staff</span></button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 24 }}>
        <div style={{ marginBottom: 12 }}><Avatar size={92} photo={person.id === "anyone" ? null : staffPhoto(person)} initial={person.name.charAt(0)} color={person.color || "var(--gold)"} /></div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600 }}>{person.name}</div>
        <div style={{ fontSize: 14, color: "var(--sub)" }}>{person.role}</div>
      </div>
      <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
        {hubRows.map((r, i) => (
          <button key={r.id} onClick={() => { setSection(r.id); setEditingDetails(false); }} className="lift" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 18px", background: "var(--panel)", color: "var(--text)", textAlign: "left", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <span style={{ fontSize: 17 }}>{r.label}</span>
            <ChevronRight size={20} style={{ color: "var(--faint)" }} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// STAFF EDITOR — per-person working hours and days off
// ============================================================
function StaffEditor({ providers, setProviders, showToast }) {
  const [openId, setOpenId] = useState(null);
  const staff = providers.filter((p) => p.id !== "anyone");
  const setDay = (pid, dow, patch) => {
    setProviders(providers.map((p) => p.id === pid ? { ...p, hours: { ...p.hours, [dow]: { ...p.hours[dow], ...patch } } } : p));
  };
  const addStaff = () => {
    const colors = ["#C2703D", "#5E8C72", "#8064B5", "#3D9BE9", "#B14A5E"];
    const id = "s" + Date.now();
    setProviders([...providers, { id, name: "New Staff", role: "Stylist", color: colors[providers.length % colors.length], photo: STAFF_PORTRAITS[providers.length % STAFF_PORTRAITS.length], hours: { ...DEFAULT_HOURS } }]);
    setOpenId(id);
  };
  const removeStaff = (pid) => { setProviders(providers.filter((p) => p.id !== pid)); setOpenId(null); showToast("Staff member removed."); };
  const rename = (pid, name) => setProviders(providers.map((p) => p.id === pid ? { ...p, name } : p));
  const setRole = (pid, role) => setProviders(providers.map((p) => p.id === pid ? { ...p, role } : p));
  const TimeStep = ({ value, onChange }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button onClick={() => onChange(Math.max(0, value - 30))} style={{ width: 28, height: 28, borderRadius: 6, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 16 }}>–</button>
      <span style={{ fontSize: 14, minWidth: 64, textAlign: "center" }}>{fmtTime(value)}</span>
      <button onClick={() => onChange(Math.min(1440, value + 30))} style={{ width: 28, height: 28, borderRadius: 6, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 16 }}>+</button>
    </div>
  );
  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.6, fontWeight: 300, marginBottom: 16 }}>Set who works and when. Each person's days and hours drive the calendar's open times and what clients can book online.</p>
      <div style={{ display: "grid", gap: 10 }}>
        {staff.map((p) => {
          const expanded = openId === p.id;
          return (
            <div key={p.id} style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              <button onClick={() => setOpenId(expanded ? null : p.id)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "none", color: "var(--text)", textAlign: "left" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: p.color }} />
                  <div>
                    <div style={{ fontSize: 15.5, fontWeight: 500 }}>{p.name}</div>
                    <div style={{ fontSize: 13, color: "var(--sub)" }}>{p.role} · {daysSummary(p.hours)}</div>
                  </div>
                </div>
                <ChevronRight size={18} style={{ color: "var(--faint)", transform: expanded ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
              </button>
              {expanded && (
                <div style={{ padding: "4px 16px 18px", borderTop: "1px solid var(--line)" }}>
                  <label style={{ fontSize: 13, color: "var(--faint)", display: "block", margin: "14px 0 6px" }}>Name</label>
                  <input value={p.name} onChange={(e) => rename(p.id, e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} />
                  <label style={{ fontSize: 13, color: "var(--faint)", display: "block", marginBottom: 6 }}>Role / title</label>
                  <input value={p.role} onChange={(e) => setRole(p.id, e.target.value)} style={{ ...inputStyle, marginBottom: 18 }} />

                  {/* Pulse permissions — Owner sees everyone's numbers + shop totals; Barber sees only their own chair. */}
                  <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 14px", marginBottom: 14 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>Pulse access</div>
                    <div style={{ fontSize: 12.5, color: "var(--sub)", lineHeight: 1.45, marginBottom: 12 }}>Owners see all barbers and shop totals. Barbers see only their own chair.</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {[["barber", "Barber"], ["owner", "Owner"]].map(([id, label]) => {
                        const on = (p.pulseRole || "barber") === id;
                        return (
                          <button key={id} onClick={() => setProviders(providers.map((x) => x.id === p.id ? { ...x, pulseRole: id } : x))} style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "color-mix(in srgb, var(--gold) 12%, transparent)" : "transparent", color: on ? "var(--gold)" : "var(--sub)", fontSize: 13.5, fontWeight: on ? 600 : 400, cursor: "pointer" }}>{label}</button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Earnings goals — drive the Pulse goal progress bars */}
                  <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 14px", marginBottom: 18 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>Earnings goals</div>
                    <div style={{ fontSize: 12.5, color: "var(--sub)", lineHeight: 1.45, marginBottom: 14 }}>Personal targets that show as progress bars on Pulse. Set to 0 to hide. Only {p.name} sees these.</div>
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <label style={{ fontSize: 13, color: "var(--sub)" }}>Daily</label>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 14, color: "var(--faint)" }}>$</span>
                          <input type="number" min="0" step="25" value={p.dailyGoal || 0} onChange={(e) => setProviders(providers.map((x) => x.id === p.id ? { ...x, dailyGoal: Math.max(0, parseInt(e.target.value || "0", 10)) } : x))} style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 14, fontFamily: FONT_BODY, width: 90, textAlign: "right" }} />
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <label style={{ fontSize: 13, color: "var(--sub)" }}>Weekly</label>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 14, color: "var(--faint)" }}>$</span>
                          <input type="number" min="0" step="50" value={p.weeklyGoal || 0} onChange={(e) => setProviders(providers.map((x) => x.id === p.id ? { ...x, weeklyGoal: Math.max(0, parseInt(e.target.value || "0", 10)) } : x))} style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 14, fontFamily: FONT_BODY, width: 90, textAlign: "right" }} />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 14px", marginBottom: 18 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: (p.overrunMin || 0) > 0 ? 12 : 0 }}>
                      <div>
                        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 2 }}>Allow end-of-day overrun</div>
                        <div style={{ fontSize: 12.5, color: "var(--sub)", lineHeight: 1.45 }}>Let clients book past your closing time if the slot fits flush against your last appointment. Good for catching after-work bookings.</div>
                      </div>
                      <button onClick={() => setProviders(providers.map((x) => x.id === p.id ? { ...x, overrunMin: (x.overrunMin || 0) > 0 ? 0 : 30 } : x))} style={{ width: 44, height: 26, borderRadius: 13, background: (p.overrunMin || 0) > 0 ? "var(--gold)" : "var(--border)", position: "relative", flexShrink: 0, padding: 0, border: "none" }}><span style={{ position: "absolute", top: 3, left: (p.overrunMin || 0) > 0 ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} /></button>
                    </div>
                    {(p.overrunMin || 0) > 0 && (
                      <div>
                        <div style={{ fontSize: 12.5, color: "var(--faint)", marginBottom: 6, letterSpacing: 1, fontWeight: 600 }}>UP TO</div>
                        <Stepper value={p.overrunMin || 30} onChange={(v) => setProviders(providers.map((x) => x.id === p.id ? { ...x, overrunMin: v } : x))} min={15} max={120} step={15} suffix="min past closing" />
                      </div>
                    )}
                  </div>

                  <label style={{ fontSize: 13, color: "var(--faint)", display: "block", marginBottom: 10 }}>Working hours</label>
                  <div style={{ display: "grid", gap: 8 }}>
                    {[1, 2, 3, 4, 5, 6, 0].map((dow) => { const h = p.hours[dow] || { on: false, start: 540, end: 1020 }; return (
                      <div key={dow} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
                        <button onClick={() => setDay(p.id, dow, { on: !h.on })} style={{ display: "flex", alignItems: "center", gap: 9, background: "none", color: "var(--text)", flexShrink: 0 }}>
                          <span style={{ width: 38, height: 22, borderRadius: 11, background: h.on ? "var(--gold)" : "var(--border)", position: "relative", flexShrink: 0 }}><span style={{ position: "absolute", top: 2, left: h.on ? 18 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .2s" }} /></span>
                          <span style={{ fontSize: 13.5, width: 34 }}>{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dow]}</span>
                        </button>
                        {h.on ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <TimeStep value={h.start} onChange={(v) => setDay(p.id, dow, { start: v })} />
                            <span style={{ color: "var(--faint)", fontSize: 13 }}>–</span>
                            <TimeStep value={h.end} onChange={(v) => setDay(p.id, dow, { end: v })} />
                          </div>
                        ) : <span style={{ fontSize: 13, color: "var(--faint)" }}>Day off</span>}
                      </div>
                    ); })}
                  </div>

                  <button onClick={() => removeStaff(p.id)} style={{ marginTop: 16, background: "none", color: "#C2563F", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}><Trash2 size={14} /> Remove {p.name}</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button className="lift" onClick={addStaff} style={{ width: "100%", marginTop: 12, background: "var(--panel2)", border: "1px dashed var(--border2)", color: "var(--text)", padding: 14, borderRadius: 10, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Plus size={16} /> Add staff member</button>
    </div>
  );
}

// ---------- APPEARANCE PICKER (GlossGenius-style: Themes / Palette / Accent / Font) ----------
const ACCENTS = [
  { id: "ink", name: "Ink", hex: "#1A1A18" }, { id: "forest", name: "Forest", hex: "#1F5138" },
  { id: "rose", name: "Rose", hex: "#B14A63" }, { id: "clay", name: "Clay", hex: "#B65A33" },
  { id: "teal", name: "Teal", hex: "#2E7D74" }, { id: "plum", name: "Plum", hex: "#7A4E86" },
  { id: "brass", name: "Brass", hex: "#B98740" }, { id: "navy", name: "Navy", hex: "#28406B" },
];
const FONT_PAIRS = [
  { id: "atelier", name: "Atelier", disp: "'Cormorant Garamond', serif", body: "'Jost', sans-serif", note: "Editorial serif" },
  { id: "fraunces", name: "Fraunces", disp: "'Fraunces', serif", body: "'Inter', sans-serif", note: "Modern serif" },
  { id: "playfair", name: "Playfair", disp: "'Playfair Display', serif", body: "'Poppins', sans-serif", note: "High-contrast" },
  { id: "oswald", name: "Oswald", disp: "'Oswald', sans-serif", body: "'Jost', sans-serif", note: "Bold condensed" },
];

function AppearancePicker({ theme, setTheme }) {
  const [tab, setTab] = useState("themes");
  const [accent, setAccent] = useState(null); // hex override or null
  const [fontPair, setFontPair] = useState(null);

  // apply accent / font overrides live on the themed root (inline beats the .theme- class)
  useEffect(() => {
    const root = document.getElementById("app-root"); if (!root) return;
    if (accent) root.style.setProperty("--gold", accent);
    else root.style.removeProperty("--gold");
    return () => { const r = document.getElementById("app-root"); if (r) r.style.removeProperty("--gold"); };
  }, [accent]);
  useEffect(() => {
    const root = document.getElementById("app-root"); if (!root) return;
    if (fontPair) { root.style.setProperty("--font-disp", fontPair.disp); root.style.setProperty("--font-body", fontPair.body); }
    else { root.style.removeProperty("--font-disp"); root.style.removeProperty("--font-body"); }
    return () => { const r = document.getElementById("app-root"); if (r) { r.style.removeProperty("--font-disp"); r.style.removeProperty("--font-body"); } };
  }, [fontPair]);

  const TABS = [["themes","Themes"],["palette","Palette"],["accent","Accent"],["font","Font"]];

  // a small realistic mini-mockup of the app painted in a given theme's palette
  const Mock = ({ th, accentHex }) => {
    const v = th.t; const acc = accentHex || v.gold;
    const tint = (pct) => `color-mix(in srgb, ${acc} ${pct}%, ${v.panel})`;
    return (
      <div style={{ background: v.bg, padding: "20px 20px 22px", position: "relative", minHeight: 200 }}>
        <div style={{ fontFamily: th.body, fontSize: 9.5, letterSpacing: 3, color: v.faint, marginBottom: 6, fontWeight: 600 }}>FRIDAY · TODAY</div>
        <div style={{ fontFamily: th.disp, color: v.text, fontSize: 38, fontWeight: 500, letterSpacing: th.disp.includes("Oswald") ? 1 : -0.5, lineHeight: 0.95, marginBottom: 18 }}>Sanctuary</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 18 }}>
          <div style={{ background: tint(12), borderLeft: `3px solid ${acc}`, border: `1px solid color-mix(in srgb, ${acc} 26%, ${v.border})`, borderRadius: 12, padding: "11px 13px" }}>
            <div style={{ fontFamily: th.body, fontSize: 13, fontWeight: 600, color: v.text, marginBottom: 4 }}>Marcus Webb</div>
            <div style={{ fontFamily: th.body, fontSize: 11, color: v.sub }}>9:00 AM · Cut &amp; Beard</div>
          </div>
          <div style={{ background: v.panel, border: `1px solid ${v.border}`, borderRadius: 12, padding: "11px 13px" }}>
            <div style={{ fontFamily: th.body, fontSize: 13, fontWeight: 600, color: v.text2, marginBottom: 4 }}>Tariq Allen</div>
            <div style={{ fontFamily: th.body, fontSize: 11, color: v.faint }}>10:30 AM · Skin Fade</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, background: acc, color: v.onGold, fontFamily: th.body, fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textAlign: "center", padding: "12px 0", borderRadius: 30 }}>Book it</div>
          <div style={{ fontFamily: th.disp, color: acc, fontSize: 30, fontWeight: 600, lineHeight: 1 }}>Aa</div>
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 20 }}>
        {TABS.map(([id, label]) => { const on = tab === id; return (
          <button key={id} onClick={() => setTab(id)} style={{ position: "relative", background: "none", color: on ? "var(--text)" : "var(--sub)", fontSize: 15, fontWeight: on ? 600 : 400, padding: "8px 14px 12px" }}>
            {label}
            {on && <span style={{ position: "absolute", left: 10, right: 10, bottom: -1, height: 2, background: "var(--gold)", borderRadius: 2 }} />}
          </button>
        ); })}
      </div>

      {tab === "themes" && (
        <div style={{ display: "grid", gap: 18 }}>
          <div style={{ fontSize: 14.5, color: "var(--sub)", lineHeight: 1.6 }}>Each theme is a complete look — palette and fonts together. Tap to apply it everywhere.</div>
          {THEMES.map((th) => { const on = theme === th.id; return (
            <button key={th.id} className="lift" onClick={() => { setTheme(th.id); setAccent(null); setFontPair(null); }} style={{ padding: 0, borderRadius: 20, border: on ? "2px solid var(--gold)" : "1px solid var(--border)", overflow: "hidden", textAlign: "left", background: th.t.bg, boxShadow: on ? "var(--shadow-lg)" : "var(--shadow-sm)", display: "block", width: "100%" }}>
              <div style={{ position: "relative" }}>
                <Mock th={th} />
                {on && <div style={{ position: "absolute", top: 16, right: 16, width: 26, height: 26, borderRadius: "50%", background: th.t.gold, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 3px 10px rgba(0,0,0,0.3)" }}><Check size={15} style={{ color: th.t.onGold }} strokeWidth={3} /></div>}
              </div>
              <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--panel)", borderTop: "1px solid var(--line)" }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: on ? "var(--gold)" : "var(--text)", letterSpacing: -0.2 }}>{th.name}</div>
                  <div style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 2 }}>{th.tagline}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, letterSpacing: 1, color: "var(--faint)", border: "1px solid var(--border)", borderRadius: 20, padding: "3px 9px" }}>{th.dark ? "DARK" : "LIGHT"}</span>
                  {on && <span style={{ fontSize: 11, letterSpacing: 1, color: "var(--gold)", fontWeight: 600 }}>ACTIVE</span>}
                </div>
              </div>
            </button>
          ); })}
        </div>
      )}

      {tab === "palette" && (
        <div>
          <div style={{ fontSize: 14.5, color: "var(--sub)", lineHeight: 1.6, marginBottom: 18 }}>Light or dark — pick the canvas. These are the same palettes grouped by mood.</div>
          {["Light","Dark"].map((grp) => (
            <div key={grp} style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 13, letterSpacing: 2, color: "var(--faint)", marginBottom: 12 }}>{grp.toUpperCase()}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {THEMES.filter((t) => t.group === grp).map((th) => { const on = theme === th.id; const v = th.t; return (
                  <button key={th.id} className="lift" onClick={() => { setTheme(th.id); setAccent(null); setFontPair(null); }} style={{ padding: 0, borderRadius: 16, overflow: "hidden", border: on ? "2px solid var(--gold)" : "1px solid var(--border)", background: v.bg, textAlign: "left" }}>
                    <div style={{ height: 64, background: v.bg, display: "flex", alignItems: "center", padding: "0 12px", gap: 6 }}>
                      <span style={{ width: 22, height: 22, borderRadius: "50%", background: v.gold }} />
                      <span style={{ width: 16, height: 16, borderRadius: "50%", background: v.panel2, border: `1px solid ${v.border2}` }} />
                      <span style={{ fontFamily: th.disp, color: v.text, fontSize: 20, marginLeft: "auto" }}>Aa</span>
                    </div>
                    <div style={{ padding: "9px 12px", background: "var(--panel)", borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: on ? "var(--gold)" : "var(--text)" }}>{th.name}</span>
                      {on && <Check size={15} style={{ color: "var(--gold)" }} strokeWidth={3} />}
                    </div>
                  </button>
                ); })}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "accent" && (
        <div>
          <div style={{ fontSize: 14.5, color: "var(--sub)", lineHeight: 1.6, marginBottom: 18 }}>Override just the accent color used for buttons and highlights, keeping your current theme.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 22 }}>
            <button onClick={() => setAccent(null)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, background: "none" }}>
              <span style={{ width: 52, height: 52, borderRadius: "50%", border: accent ? "1px solid var(--border)" : "2px solid var(--gold)", background: "var(--panel2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--sub)", fontSize: 11 }}>Theme</span>
              <span style={{ fontSize: 12, color: !accent ? "var(--gold)" : "var(--sub)", fontWeight: !accent ? 600 : 400 }}>Default</span>
            </button>
            {ACCENTS.map((a) => { const on = accent === a.hex; return (
              <button key={a.id} onClick={() => setAccent(a.hex)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, background: "none" }}>
                <span style={{ width: 52, height: 52, borderRadius: "50%", background: a.hex, border: on ? "2px solid var(--text)" : "1px solid rgba(0,0,0,0.1)", boxShadow: on ? "0 0 0 3px var(--bg), 0 0 0 5px " + a.hex : "none", display: "flex", alignItems: "center", justifyContent: "center" }}>{on && <Check size={18} style={{ color: "#fff" }} strokeWidth={3} />}</span>
                <span style={{ fontSize: 12, color: on ? "var(--text)" : "var(--sub)", fontWeight: on ? 600 : 400 }}>{a.name}</span>
              </button>
            ); })}
          </div>
          {/* live preview */}
          <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid var(--border)" }}>
            <Mock th={THEMES.find((t) => t.id === theme)} accentHex={accent} />
          </div>
        </div>
      )}

      {tab === "font" && (
        <div>
          <div style={{ fontSize: 14.5, color: "var(--sub)", lineHeight: 1.6, marginBottom: 18 }}>Swap the typeface pairing while keeping your colors.</div>
          <div style={{ display: "grid", gap: 12 }}>
            <button onClick={() => setFontPair(null)} className="lift" style={{ textAlign: "left", padding: "16px 18px", borderRadius: 14, border: !fontPair ? "2px solid var(--gold)" : "1px solid var(--border)", background: "var(--panel)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div><div style={{ fontSize: 15, fontWeight: 600, color: !fontPair ? "var(--gold)" : "var(--text)" }}>Theme default</div><div style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 2 }}>Use the font that ships with this theme</div></div>
              {!fontPair && <Check size={17} style={{ color: "var(--gold)" }} strokeWidth={3} />}
            </button>
            {FONT_PAIRS.map((f) => { const on = fontPair && fontPair.id === f.id; return (
              <button key={f.id} onClick={() => setFontPair(f)} className="lift" style={{ textAlign: "left", padding: "16px 18px", borderRadius: 14, border: on ? "2px solid var(--gold)" : "1px solid var(--border)", background: "var(--panel)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontFamily: f.disp, fontSize: 26, color: "var(--text)", lineHeight: 1 }}>Sanctuary</div>
                  <div style={{ fontFamily: f.body, fontSize: 12.5, color: "var(--sub)", marginTop: 4 }}>{f.name} · {f.note}</div>
                </div>
                {on && <Check size={17} style={{ color: "var(--gold)" }} strokeWidth={3} />}
              </button>
            ); })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- SETTINGS ----------
function RebookCheckoutEditor({ r, onChange }) {
  const set = (patch) => onChange({ ...r, ...patch });
  const discountOn = r.discountEnabled !== false;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <ToggleSetting label="Show the rebook screen at checkout" desc="After each visit, offer to book the client's next appointment before they leave." on={r.enabled !== false} onToggle={(v) => set({ enabled: v })} />
      {r.enabled !== false && (
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 12, paddingTop: 14 }}>
          <ToggleSetting label="Offer a discount as the incentive" desc="Sweeten rebooking with a discount. Turn off to simply prompt the next booking with no discount." on={discountOn} onToggle={(v) => set({ discountEnabled: v })} />
          {discountOn && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>Discount</div>
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <button onClick={() => set({ discountType: "amount" })} style={{ flex: 1, padding: "12px", borderRadius: 12, border: `1.5px solid ${r.discountType !== "percent" ? "var(--gold)" : "var(--border)"}`, background: r.discountType !== "percent" ? "color-mix(in srgb, var(--gold) 10%, var(--panel))" : "var(--panel2)", color: "var(--text)", fontSize: 15, fontWeight: 500 }}>Dollar ($)</button>
                <button onClick={() => set({ discountType: "percent" })} style={{ flex: 1, padding: "12px", borderRadius: 12, border: `1.5px solid ${r.discountType === "percent" ? "var(--gold)" : "var(--border)"}`, background: r.discountType === "percent" ? "color-mix(in srgb, var(--gold) 10%, var(--panel))" : "var(--panel2)", color: "var(--text)", fontSize: 15, fontWeight: 500 }}>Percent (%)</button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px" }}>
                <span style={{ fontSize: 18, color: "var(--sub)" }}>{r.discountType === "percent" ? "%" : "$"}</span>
                <input type="number" min={0} value={r.discount ?? 0} onChange={(e) => set({ discount: Math.max(0, parseFloat(e.target.value) || 0) })} style={{ flex: 1, background: "transparent", border: "none", color: "var(--text)", fontSize: 20, fontWeight: 600, outline: "none" }} />
                <span style={{ fontSize: 14, color: "var(--faint)" }}>off the next visit</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToggleSetting({ label, desc, on, onToggle }) {
  return (
    <div style={{ padding: "4px 2px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 5 }}>{label}</div>
          <div style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.5 }}>{desc}</div>
        </div>
        <button onClick={() => onToggle(!on)} style={{ width: 52, height: 30, borderRadius: 30, border: "none", flexShrink: 0, background: on ? "var(--gold)" : "var(--border2)", position: "relative", transition: "background .2s", marginTop: 2 }}>
          <span style={{ position: "absolute", top: 3, left: on ? 25 : 3, width: 24, height: 24, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
        </button>
      </div>
    </div>
  );
}

function PhotoModeSetting({ mode, onChange }) {
  const opts = [["off", "Off", "Don't ask for photos"], ["optional", "Optional", "Clients can add a reference photo"], ["required", "Required", "Clients must add at least one photo"]];
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {opts.map(([val, label, desc]) => { const on = mode === val; return (
        <button key={val} onClick={() => onChange(val)} style={{ width: "100%", textAlign: "left", background: on ? "color-mix(in srgb, var(--gold) 10%, var(--panel))" : "var(--panel2)", border: `1.5px solid ${on ? "var(--gold)" : "var(--border)"}`, borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span><span style={{ fontSize: 15.5, fontWeight: 500, display: "block" }}>{label}</span><span style={{ fontSize: 13.5, color: "var(--sub)" }}>{desc}</span></span>
          <span style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${on ? "var(--gold)" : "var(--border2)"}`, background: on ? "var(--gold)" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>{on && <Check size={13} style={{ color: "var(--on-gold)" }} />}</span>
        </button>
      ); })}
    </div>
  );
}

function SettingsView({ business, setBusiness, providers, setProviders, services, setServices, categories, setCategories, appts, clients, theme, setTheme, showToast }) {
  const [form, setForm] = useState(business);
  const [openCard, setOpenCard] = useState(null);
  const [query, setQuery] = useState("");

  // When opening a setting card, reset the working form to the current saved business state
  // so previous unsaved edits don't carry over.
  useEffect(() => { if (openCard) setForm(business); }, [openCard]);

  // Detect if the user has actually changed anything (so we only show DONE when needed)
  const hasChanges = JSON.stringify(form) !== JSON.stringify(business);

  const save = (msg) => { setBusiness(form); showToast(msg || "Settings saved."); setOpenCard(null); };
  const cancel = () => { setForm(business); setOpenCard(null); };

  const field = (label, key, multiline) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 14, letterSpacing: 2, color: "var(--faint)", marginBottom: 6 }}>{label}</div>
      {multiline
        ? <textarea value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} rows={5} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
        : <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} style={inputStyle} />}
    </div>
  );

  // Each card: status line (live) + the editor shown when expanded. Grouped by category.
  const cards = [
    {
      id: "business", title: "Business Details", icon: User, category: "Business Setup",
      status: form.legalName, keywords: "name address logo branding contact email business details",
      editor: (<>
        {field("BUSINESS NAME (LOGO)", "name")}
        {field("DISPLAY NAME", "legalName")}
        {field("ADDRESS", "address")}
        {field("ADDRESS LINE 2", "address2")}
        {field("CITY, STATE ZIP", "cityZip")}
        {field("CONTACT EMAIL", "email")}
      </>),
    },
    {
      id: "hours", title: "Business Hours", icon: Clock, category: "Business Setup",
      status: (() => { const days = ["Su","Mo","Tu","We","Th","Fr","Sa"]; const openDays = days.filter((_, d) => form.hours?.[d]?.on); return openDays.length ? `${openDays.length} days open` : "Closed"; })(),
      keywords: "business hours open close days week schedule times when open availability",
      editor: <BusinessHoursEditor hours={form.hours} onChange={(h) => setForm({ ...form, hours: h })} />,
    },
    {
      id: "locations", title: "Locations", icon: MapPinIcon, category: "Business Setup",
      status: form.multiLocation ? `${(form.locations || []).length} locations` : "Single location", keywords: "location locations multi multiple branch shop store address chain franchise",
      editor: <LocationsEditor business={form} setForm={setForm} />,
    },
    {
      id: "phones", title: "Phone Numbers", icon: Phone, category: "Business Setup",
      status: `${(form.phones || []).length} number${(form.phones || []).length === 1 ? "" : "s"}`,
      keywords: "phone numbers contact call text main booking line",
      editor: <PhoneNumbersEditor phones={form.phones || []} onChange={(ph) => setForm({ ...form, phones: ph })} />,
    },
    {
      id: "import", title: "Import Data", icon: Upload, category: "Business Setup",
      status: "Bring clients & history over",
      keywords: "import data migrate transfer clients appointments notes history switch from square glossgenius vagaro boulevard booksy csv export upload move",
      editor: <ImportDataEditor showToast={showToast} />,
    },
    {
      id: "staff", title: "Staff Members", icon: Users, category: "Business Setup",
      status: `${providers.filter((p) => p.id !== "anyone").length} staff`, keywords: "staff team employees hours days off schedule availability who works barber stylist",
      editor: (<StaffMembersView providers={providers} setProviders={setProviders} services={services} setServices={setServices} appts={appts} showToast={showToast} />),
    },
    {
      id: "appearance", title: "Logo & Branding", icon: (THEMES.find((x) => x.id === theme)?.dark) ? Moon : Sun, category: "Business Setup",
      status: THEMES.find((x) => x.id === theme)?.name || "Theme", keywords: "theme appearance light dark mode color display look style vibe palette logo branding font accent wordmark",
      editor: (<>
        {field("LOGO WORDMARK (blank = business name)", "logoText")}
        <p style={{ fontSize: 13.5, color: "var(--faint)", lineHeight: 1.5, marginTop: -6, marginBottom: 18 }}>Shown as your logo across the app. Leave blank to use the business name.</p>
        <div style={{ fontSize: 12.5, letterSpacing: 1.5, color: "var(--faint)", marginBottom: 12 }}>THEME</div>
        <AppearancePicker theme={theme} setTheme={setTheme} />
      </>),
    },
    {
      id: "aicuthelper", title: "AI Cut Helper", icon: Sparkles, category: "Client Experience",
      status: form.aiCutHelper ? "On" : "Off",
      keywords: "ai cut helper photo upload not sure show us a photo i'm not sure match suggest",
      editor: (
        <>
        <button onClick={() => setForm({ ...form, aiCutHelper: !form.aiCutHelper })} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 14, padding: 16, color: "var(--text)", marginBottom: 14 }}>
          <div style={{ textAlign: "left" }}><div style={{ fontSize: 15, marginBottom: 2 }}>Photo + description matching</div><div style={{ fontSize: 14, color: "var(--sub)", fontWeight: 300, lineHeight: 1.4 }}>Lets new clients upload a photo or describe what they want — we suggest a matching cut from your menu.</div></div>
          <span style={{ width: 44, height: 26, borderRadius: 13, background: form.aiCutHelper ? "var(--gold)" : "var(--border)", position: "relative", flexShrink: 0 }}><span style={{ position: "absolute", top: 3, left: form.aiCutHelper ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} /></span>
        </button>
        <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", fontSize: 13, color: "var(--sub)", lineHeight: 1.5 }}>For best results, upload 3 reference photos per cut showing what each style looks like at your shop. The matcher uses these to learn your work. <em>Reference photo upload is coming soon.</em></div>
        </>
      ),
    },
    {
      id: "photos", title: "Display Preferences", icon: ImageIcon, category: "Calendar & Appointments",
      status: (() => { const bits = []; const rs = form.calendarRowSize || "L"; bits.push(`Row size ${rs}`); if (form.showAddonPhotos) bits.push("photos on"); return bits.join(" · "); })(),
      keywords: "photos images add-ons menu pictures display preferences calendar week start day begins sunday monday first day row size height calendar large small zoom",
      editor: (
        <>
        {/* Row size — pinned at top */}
        <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--faint)", fontWeight: 600, marginBottom: 10 }}>CALENDAR ROW SIZE</div>
        <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 12, lineHeight: 1.45 }}>How tall each hour appears on your calendar. Larger rows give appointments room to breathe.</div>
        <div style={{ display: "flex", background: "var(--panel2)", borderRadius: 12, padding: 4, gap: 4, marginBottom: 22, border: "1px solid var(--border)" }}>
          {["S","M","L","XL"].map((s) => { const on = (form.calendarRowSize || "L") === s; return (
            <button key={s} onClick={() => setForm({ ...form, calendarRowSize: s })} style={{ flex: 1, padding: "11px 0", borderRadius: 8, fontSize: 14, background: on ? "var(--gold)" : "transparent", color: on ? "var(--on-gold)" : "var(--sub)", fontWeight: on ? 700 : 500, letterSpacing: 0.5 }}>{s}</button>
          ); })}
        </div>

        <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--faint)", fontWeight: 600, marginBottom: 10 }}>WEEK STARTS ON</div>
        <div style={{ fontSize: 13.5, color: "var(--sub)", marginBottom: 12, lineHeight: 1.45 }}>The first day shown on your calendar's week strip.</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 22 }}>
          {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((day, i) => { const on = (form.weekStartsOn ?? 0) === i; return (
            <button key={i} onClick={() => setForm({ ...form, weekStartsOn: i })} style={{ flex: "1 1 30%", padding: "11px 4px", borderRadius: 10, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "rgba(176,141,87,0.12)" : "transparent", color: on ? "var(--gold)" : "var(--text)", fontSize: 13.5, fontWeight: on ? 600 : 400 }}>{day}</button>
          ); })}
        </div>

        <button onClick={() => setForm({ ...form, showAddonPhotos: !form.showAddonPhotos })} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 14, padding: 16, color: "var(--text)" }}>
          <div style={{ textAlign: "left" }}><div style={{ fontSize: 15, marginBottom: 2 }}>Show photos on add-ons</div><div style={{ fontSize: 13.5, color: "var(--sub)" }}>Display images next to add-on options for clients.</div></div>
          <span style={{ width: 44, height: 26, borderRadius: 13, background: form.showAddonPhotos ? "var(--gold)" : "var(--border)", position: "relative", flexShrink: 0 }}><span style={{ position: "absolute", top: 3, left: form.showAddonPhotos ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} /></span>
        </button>
        </>
      ),
    },
    {
      id: "scheduling", title: "Scheduling Options", icon: Clock, category: "Calendar & Appointments",
      status: (() => { const bk = form.booking || {}; const parts = []; if (bk.bufferBefore || bk.bufferAfter) parts.push(`${bk.bufferBefore || 0}/${bk.bufferAfter || 0}m buffer`); const hd = bk.horizonDays; const winLabel = hd === 0 ? "no cutoff" : (hd >= 90 ? `${Math.round(hd / 30)}mo window` : `${hd || 60}d window`); parts.push(winLabel); return parts.join(" · "); })(),
      keywords: "scheduling buffer before after turnover cleanup gap minimum notice lead time booking window advance ahead days how far",
      editor: <SchedulingOptionsEditor b={form.booking || defaultBooking()} onChange={(bk) => setForm({ ...form, booking: { ...(form.booking || {}), ...bk } })} />,
    },
    {
      id: "avoidgaps", title: "Avoid Gaps Between Appointments", icon: Clock, category: "Calendar & Appointments",
      status: (() => { const bk = form.booking || {}; if (bk.avoidGaps === false) return "Off"; const bits = ["On"]; if (bk.maxGapMin > 0) bits.push(`max ${bk.maxGapMin}m`); if (bk.minGapMin > 0) bits.push(`min ${bk.minGapMin}m`); if (bk.emptyDayMode === "anchored") bits.push("empty: first only"); return bits.join(" · "); })(),
      keywords: "avoid gaps back to back fill no dead time tight schedule revenue optimize cluster anchor max min empty day first last",
      editor: <AvoidGapsEditor b={form.booking || defaultBooking()} onChange={(bk) => setForm({ ...form, booking: { ...(form.booking || {}), ...bk } })} />,
    },
    {
      id: "waitingroom", title: "Waiting Room", icon: Users, category: "Calendar & Appointments",
      status: (form.waitingRoom?.selfCheckIn ? "Self check-in" : "Staff check-in") + (form.waitingRoom?.autoReadyMessage ? " · ready msg on" : ""),
      keywords: "waiting room check in checkin arrival ready notify waiting list self check-in front desk client arrived",
      editor: <WaitingRoomEditor w={form.waitingRoom || {}} onChange={(wr) => setForm({ ...form, waitingRoom: { ...(form.waitingRoom || {}), ...wr } })} />,
    },
    {
      id: "runninglate", title: "Running Late Alerts", icon: Clock, category: "Calendar & Appointments",
      status: form.runningLate?.enabled === false ? "Off" : `On · ${form.runningLate?.thresholdMin || 5} min warning`,
      keywords: "running late behind next client wrapping up notify prompt delay minutes message schedule overrun",
      editor: <RunningLateEditor r={form.runningLate || {}} onChange={(rl) => setForm({ ...form, runningLate: { ...(form.runningLate || {}), ...rl } })} />,
    },
    {
      id: "overduebuffer", title: "It's Been a While", icon: Clock, category: "Calendar & Appointments",
      status: form.overdueBuffer?.enabled === false ? "Off" : `+${form.overdueBuffer?.addMinutes || 10} min after ${form.overdueBuffer?.thresholdWeeks || 8} wks`,
      keywords: "overdue buffer been a while extra time add minutes long time since last visit haircut more to cut charge free bonus perceived value lapsed returning",
      editor: <OverdueBufferEditor b={form.overdueBuffer || {}} onChange={(ob) => setForm({ ...form, overdueBuffer: { ...(form.overdueBuffer || {}), ...ob } })} />,
    },
    {
      id: "policy", title: "Cancel & Reschedule", icon: AlertCircle, category: "Calendar & Appointments",
      status: form.policy ? "Set" : "Not set", keywords: "cancellation no-show policy refund rules deposit charge reschedule",
      editor: (<>
        {field("CANCELLATION / NO-SHOW POLICY", "policy", true)}
        <p style={{ fontSize: 14, color: "var(--faint)", lineHeight: 1.5 }}>Write this to match your own rules and your state's regulations. Shows on the booking screen.</p>
      </>),
    },
    {
      id: "waitlist", title: "Waitlist", icon: Clock, category: "Calendar & Appointments",
      status: (form.waitlist?.mode === "silent" ? "Auto" : "Ask first") + (form.waitlist?.order === "longest" ? " · longest first" : " · first come"),
      keywords: "waitlist auto notify automatic slot opened cancellation longest waiting queue order delay minutes silent ask first link book",
      editor: <WaitlistRulesEditor w={form.waitlist || { mode: "ask", order: "longest", delayMin: 30 }} onChange={(wl) => setForm({ ...form, waitlist: wl })} />,
    },
    {
      id: "autotiming", title: "Smart Timing", icon: Clock, category: "Calendar & Appointments",
      status: (form.autoTiming?.enabled === false) ? "Off" : "On — suggests durations",
      keywords: "auto timing smart duration clock service time measure suggest save remembered learn how long takes",
      editor: <ToggleSetting label="Suggest saving service times" desc="After checkout, offer to save how long the service actually took as that client's time, so future bookings get more accurate." on={form.autoTiming?.enabled !== false} onToggle={(v) => setForm({ ...form, autoTiming: { ...(form.autoTiming || {}), enabled: v } })} />,
    },
    {
      id: "rebook_usual", title: "Book the Usual", icon: Repeat, category: "Online Booking",
      status: (form.bookUsual?.enabled === false) ? "Off" : "On",
      keywords: "usual same as last time rebook repeat returning client one tap quick book",
      editor: <ToggleSetting label="Offer 'the usual' to returning clients" desc="When a returning client books, show their last service for one-tap rebooking before the full menu." on={form.bookUsual?.enabled !== false} onToggle={(v) => setForm({ ...form, bookUsual: { ...(form.bookUsual || {}), enabled: v } })} />,
    },
    {
      id: "family", title: "Family & Group Booking", icon: User, category: "Online Booking",
      status: (form.familyBooking?.enabled === false) ? "Off" : "On",
      keywords: "family group multiple people kids children book for someone else who is this for partner",
      editor: <ToggleSetting label="Let clients book for family / multiple people" desc="Recognized clients can save family members and book several people in one visit (together or back-to-back)." on={form.familyBooking?.enabled !== false} onToggle={(v) => setForm({ ...form, familyBooking: { ...(form.familyBooking || {}), enabled: v } })} />,
    },
    {
      id: "photos", title: "Reference Photos", icon: Camera, category: "Online Booking",
      status: form.bookingPhotos?.mode === "off" ? "Off" : (form.bookingPhotos?.mode === "required" ? "Required" : "Optional"),
      keywords: "photo photos reference picture inspiration upload booking required optional off image",
      editor: <PhotoModeSetting mode={form.bookingPhotos?.mode || "optional"} onChange={(m) => setForm({ ...form, bookingPhotos: { ...(form.bookingPhotos || {}), mode: m } })} />,
    },
    {
      id: "tipping", title: "Tipping", icon: DollarSign, category: "Payments & Checkout",
      status: form.tipping?.enabled ? `${(form.tipping.presets || []).join("/")}%` : "Off", keywords: "tip tipping gratuity percent checkout payment",
      editor: <TippingEditor t={form.tipping || { enabled: true, presets: [18, 20, 25], allowCustom: true, allowNoTip: true, smartDefault: 20 }} onChange={(tp) => setForm({ ...form, tipping: tp })} />,
    },
    {
      id: "checkout", title: "Checkout Settings", icon: CreditCard, category: "Payments & Checkout",
      status: `${(form.checkout?.customMethods || []).length} payment methods`,
      keywords: "checkout payment methods custom tip buttons signature change calculator cash receipt staff assignment self checkout checks advanced",
      editor: <CheckoutSettingsEditor c={form.checkout || {}} onChange={(ck) => setForm({ ...form, checkout: { ...(form.checkout || {}), ...ck } })} />,
    },
    {
      id: "servicesmenu", title: "Services & Menu", icon: ImageIcon, category: "Services & Menu",
      status: `${(services || []).length} services`,
      keywords: "menu services service list edit add price duration photo category haircut beard add-ons addons cut types",
      editor: <MenuEditor services={services} setServices={setServices} categories={categories} setCategories={setCategories} providers={providers} business={business} showToast={showToast} />,
    },
    {
      id: "rebookco", title: "Rebooking at Checkout", icon: Repeat, category: "Payments & Checkout",
      status: (form.rebook?.enabled === false) ? "Off" : ((form.rebook?.discountEnabled !== false && (form.rebook?.discount || 0) > 0) ? `On · ${form.rebook?.discountType === "percent" ? form.rebook?.discount + "% off" : "$" + form.rebook?.discount + " off"}` : "On · no discount"),
      keywords: "rebook rebooking checkout discount percent dollar amount incentive next visit prompt save offer",
      editor: <RebookCheckoutEditor r={form.rebook || { enabled: true, discountEnabled: true, discountType: "amount", discount: 5, weeks: [2,3,4,6,8] }} onChange={(rb) => setForm({ ...form, rebook: { ...(form.rebook || {}), ...rb } })} />,
    },
    {
      id: "booking", title: "Online Booking", icon: Calendar, category: "Online Booking",
      status: bookingStatus(form.booking), keywords: "online booking link card required deposit lead time buffer cap gaps rebook setup",
      editor: <BookingRulesEditor b={form.booking} onChange={(bk) => setForm({ ...form, booking: bk })} />,
    },
    {
      id: "staffselection", title: "Staff Selection", icon: Users, category: "Online Booking",
      status: `${providers.filter((p) => p.id !== "anyone" && p.onlineBooking).length} bookable online`,
      keywords: "staff selection online booking bookable show hide who clients book provider barber availability public page",
      editor: <StaffSelectionEditor providers={providers} setProviders={setProviders} />,
    },
    {
      id: "newclient", title: "New Client Experience", icon: Sparkles, category: "Online Booking",
      status: (form.booking?.guidedConsult !== false) ? "Guided" : "Simple list",
      keywords: "new client experience guided consultation walkthrough cut finder quiz simple list first time onboarding help choose",
      editor: (
        <>
          <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.55, marginBottom: 20 }}>How brand-new clients pick their cut. Returning clients always skip straight to "the usual."</p>
          <button onClick={() => setForm({ ...form, booking: { ...form.booking, guidedConsult: true } })} style={{ width: "100%", textAlign: "left", background: (form.booking?.guidedConsult !== false) ? "color-mix(in srgb, var(--gold) 12%, var(--panel))" : "var(--panel)", border: `1.5px solid ${(form.booking?.guidedConsult !== false) ? "var(--gold)" : "var(--border)"}`, borderRadius: 16, padding: "18px 20px", marginBottom: 12, color: "var(--text)" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 21, fontWeight: 500, marginBottom: 4 }}>Guided consultation</div>
            <div style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.45 }}>A few simple questions walk them to the right cut. Feels personal, teaches them, prevents wrong picks.</div>
          </button>
          <button onClick={() => setForm({ ...form, booking: { ...form.booking, guidedConsult: false } })} style={{ width: "100%", textAlign: "left", background: (form.booking?.guidedConsult === false) ? "color-mix(in srgb, var(--gold) 12%, var(--panel))" : "var(--panel)", border: `1.5px solid ${(form.booking?.guidedConsult === false) ? "var(--gold)" : "var(--border)"}`, borderRadius: 16, padding: "18px 20px", color: "var(--text)" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 21, fontWeight: 500, marginBottom: 4 }}>Simple list</div>
            <div style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.45 }}>Show all the cuts in a clean list. Fastest for clients who already know what they want.</div>
          </button>
        </>
      ),
    },
    {
      id: "messages", title: "Automated Messages", icon: MessageSquare, category: "Automated Messages",
      status: `${(form.messages || []).filter((m) => m.enabled).length} active`, keywords: "automated messages reminders texts email confirmation check-in waitlist booked canceled rescheduled wording edit",
      editor: <MessagesEditor messages={form.messages || []} onChange={(msgs) => setForm({ ...form, messages: msgs })} business={form} />,
    },
    {
      id: "reports", title: "Reports", icon: BarChart3, category: "Reporting",
      status: "Revenue, staff, retention",
      keywords: "reports reporting analytics revenue sales staff performance retention average ticket dashboard insights numbers trends",
      editor: <ReportsView appts={appts} clients={clients} providers={providers} services={services} business={form} />,
    },
  ];
  const CATEGORY_ORDER = ["Business Setup", "Services & Menu", "Calendar & Appointments", "Payments & Checkout", "Online Booking", "Automated Messages", "Reporting"];

  // ---- New editorial settings landing ----
  // Five focused, intent-driven sections. Each shows its current status inline so
  // you don't drill in just to check what's set. Order = how often a typical shop
  // owner touches each one.
  const SECTIONS = [
    {
      id: "setup",
      title: "Setup",
      desc: "Set these once and forget. Your shop's identity, your team, your menu.",
      defaultOpen: true,
      settings: ["business", "hours", "staff", "servicesmenu", "appearance", "phones", "locations"],
    },
    {
      id: "booking",
      title: "Online booking",
      desc: "What clients see and how they book — rules, who can book, the new-client flow.",
      defaultOpen: false,
      settings: ["booking", "policy", "staffselection", "newclient", "family"],
    },
    {
      id: "calendar",
      title: "Your calendar",
      desc: "How the day behaves — buffers, gap-filling, smart timing, waitlist, alerts.",
      defaultOpen: false,
      settings: ["scheduling", "avoidgaps", "autotiming", "waitlist", "waitingroom", "runninglate", "overduebuffer", "photos"],
    },
    {
      id: "money",
      title: "Payments & messages",
      desc: "Tipping, checkout, rebooking prompts, and the messages clients receive.",
      defaultOpen: false,
      settings: ["tipping", "checkout", "rebookco", "messages"],
    },
    {
      id: "smart",
      title: "Smart & data",
      desc: "AI helpers, analytics, and getting your existing client list in.",
      defaultOpen: false,
      settings: ["aicuthelper", "reports", "import"],
    },
  ];

  // Track which sections are expanded. Initialize from each section's defaultOpen.
  const [openSections, setOpenSections] = useState(() => {
    const init = {};
    SECTIONS.forEach((s) => { init[s.id] = s.defaultOpen; });
    return init;
  });
  const toggleSection = (sid) => setOpenSections((cur) => ({ ...cur, [sid]: !cur[sid] }));

  const q = query.trim().toLowerCase();
  const filtered = q ? cards.filter((c) => (c.title + " " + c.keywords).toLowerCase().includes(q)) : cards;
  const active = cards.find((c) => c.id === openCard);

  // ---- full-page editor for the selected setting ----
  if (active) {
    const Icon = active.icon;
    return (
      <div className="appt-screen" style={{ maxWidth: 640, margin: "0 auto", padding: "12px 4px 40px" }}>
        <button onClick={cancel} style={{ background: "none", color: "var(--sub)", display: "flex", alignItems: "center", gap: 6, fontSize: 14.5, marginBottom: 20, padding: 0 }}><ArrowLeft size={16} /> All settings</button>
        <div style={{ marginBottom: 26 }}>
          <div style={{ width: 36, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 500, lineHeight: 1.02, letterSpacing: "-0.4px", marginBottom: 6 }}>{active.title}</h2>
          {active.status && <div style={{ fontSize: 14.5, color: "var(--sub)", lineHeight: 1.4 }}>{active.status}</div>}
        </div>

        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 18, padding: "20px 18px", boxShadow: "var(--shadow-sm)" }}>
          {active.editor}
        </div>

        {hasChanges && (
          <button className="lift" onClick={() => save(`${active.title} saved.`)} style={{ width: "100%", marginTop: 24, background: "var(--gold)", color: "var(--on-gold)", padding: 17, fontSize: 13.5, letterSpacing: 2.5, fontWeight: 600, borderRadius: 14, boxShadow: "var(--shadow-md)" }}>SAVE CHANGES</button>
        )}
      </div>
    );
  }

  return (
    <div className="fade-up" style={{ maxWidth: 720, margin: "0 auto", padding: "12px 4px" }}>
      {/* Masthead — matches the editorial language of Pulse and Client profile */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
        <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--gold)", marginBottom: 8, fontWeight: 600 }}>SETTINGS</div>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 42, fontWeight: 500, lineHeight: 0.95, letterSpacing: "-0.6px", marginBottom: 12 }}>How the shop runs</h2>
        <p style={{ color: "var(--sub)", fontSize: 15, fontWeight: 300, lineHeight: 1.5, maxWidth: 460 }}>Everything that shapes how Vero looks, behaves, and speaks to clients.</p>
      </div>

      {/* Search — works the same as before, but stays out of the way when not used */}
      <div style={{ position: "relative", marginBottom: 24 }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search settings" style={{ width: "100%", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: "13px 16px 13px 44px", color: "var(--text)", fontSize: 15, fontFamily: FONT_BODY, boxSizing: "border-box" }} />
        <Settings size={17} style={{ position: "absolute", left: 15, top: "50%", transform: "translateY(-50%)", color: "var(--faint)", pointerEvents: "none" }} />
      </div>

      {/* SEARCHING — flat list of matching settings */}
      {q ? (
        <div>
          {filtered.length === 0 ? (
            <p style={{ color: "var(--faint)", fontSize: 15, textAlign: "center", padding: "40px 0", fontStyle: "italic" }}>No settings match "{query}".</p>
          ) : (
            <div style={{ display: "grid", gap: 1, background: "var(--line)", borderRadius: 14, overflow: "hidden", border: "1px solid var(--border)" }}>
              {filtered.map((c) => {
                const Icon = c.icon;
                return (
                  <button key={c.id} onClick={() => setOpenCard(c.id)} style={{ width: "100%", background: "var(--panel)", textAlign: "left", color: "var(--text)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "16px 18px", border: "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: 1 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: "color-mix(in srgb, var(--gold) 12%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon size={16} style={{ color: "var(--gold)" }} /></div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 15.5, fontWeight: 500 }}>{c.title}</div>
                        <div style={{ fontSize: 13, color: "var(--sub)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.status}</div>
                      </div>
                    </div>
                    <ChevronRight size={18} style={{ color: "var(--faint)", flexShrink: 0 }} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        // NOT SEARCHING — three editorial sections, each collapsible
        <div style={{ display: "grid", gap: 24 }}>
          {SECTIONS.map((section) => {
            const sectionCards = section.settings.map((sid) => cards.find((c) => c.id === sid)).filter(Boolean);
            if (sectionCards.length === 0) return null;
            const isOpen = openSections[section.id];
            return (
              <div key={section.id}>
                {/* Section header — tap to collapse/expand */}
                <button onClick={() => toggleSection(section.id)} style={{ width: "100%", background: "none", border: "none", textAlign: "left", padding: "0 0 14px", color: "var(--text)", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 500, letterSpacing: -0.3 }}>{section.title}</div>
                      <div style={{ fontSize: 12, color: "var(--faint)", fontWeight: 500 }}>{sectionCards.length}</div>
                    </div>
                    <ChevronDown size={18} style={{ color: "var(--faint)", transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .2s ease" }} />
                  </div>
                  <div style={{ fontSize: 13.5, color: "var(--sub)", lineHeight: 1.45, fontWeight: 300 }}>{section.desc}</div>
                </button>

                {/* Settings rows — only render when expanded */}
                {isOpen && (
                  <div style={{ display: "grid", gap: 1, background: "var(--line)", borderRadius: 14, overflow: "hidden", border: "1px solid var(--border)", marginTop: 4 }}>
                    {sectionCards.map((c) => {
                      const Icon = c.icon;
                      return (
                        <button key={c.id} onClick={() => setOpenCard(c.id)} style={{ width: "100%", background: "var(--panel)", textAlign: "left", color: "var(--text)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "16px 18px", border: "none" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: 1 }}>
                            <div style={{ width: 36, height: 36, borderRadius: 10, background: "color-mix(in srgb, var(--gold) 12%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon size={16} style={{ color: "var(--gold)" }} /></div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 15.5, fontWeight: 500 }}>{c.title}</div>
                              <div style={{ fontSize: 13, color: "var(--sub)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.status}</div>
                            </div>
                          </div>
                          <ChevronRight size={18} style={{ color: "var(--faint)", flexShrink: 0 }} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- shared dashboard pieces ----------
function WaitlistView({ waitlist, setWaitlist, onText, showToast }) {
  const whenLabel = { early: "Early — open to 11am", midday: "Midday — 11am to 2pm", afternoon: "Afternoon — 2pm to close" };
  const whenWord = { early: "morning", midday: "midday", afternoon: "afternoon" };
  const [openId, setOpenId] = useState(null);
  const open = waitlist.find((w, i) => (w.id || i) === openId);

  // Send the client an in-app notification that a slot opened, including a booking link.
  const notifyOpening = (w) => {
    if (showToast) showToast(`In-app notification sent to ${(w.name || "client").split(" ")[0]} with a link to book.`);
    setOpenId(null);
  };
  const removeEntry = (w, i) => { setWaitlist(waitlist.filter((x, j) => (x.id || j) !== (w.id || i))); setOpenId(null); };

  return (
    <>
    <div className="fade-up">
      <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 500, marginBottom: 6 }}>Waitlist</h2>
      <p style={{ color: "var(--sub)", fontSize: 14, marginBottom: 20, fontWeight: 300 }}>Clients hoping for an opening. Tap one to see their preferred time and notify them when a space frees up.</p>
      {waitlist.length === 0 ? <div style={{ color: "var(--faint)", fontSize: 14, textAlign: "center", padding: "40px 0" }}>No one waiting right now. When a day's full, clients can hop on here — and you'll be the first to know.</div> : (
        <div style={{ display: "grid", gap: 12 }}>{waitlist.map((w, i) => (
          <button key={w.id || i} className="lift" onClick={() => setOpenId(w.id || i)} style={{ textAlign: "left", width: "100%", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 500 }}>{w.name || "Client"}</div>
              <div style={{ fontSize: 14, color: "var(--sub)", marginTop: 2 }}>{w.service}{w.provider ? ` · prefers ${w.provider}` : ""}</div>
              {w.when && <div style={{ display: "inline-block", marginTop: 8, fontSize: 12.5, background: "rgba(176,141,87,0.12)", border: "1px solid rgba(176,141,87,0.3)", borderRadius: 20, padding: "4px 11px", color: "var(--gold)" }}>{whenLabel[w.when] || w.when}</div>}
            </div>
            <ChevronRight size={20} style={{ color: "var(--faint)", flexShrink: 0 }} />
          </button>
        ))}</div>
      )}
    </div>

      {/* DETAIL — preferred time + notify with booking link */}
      {open && (
        <div className="fade-in" onClick={() => setOpenId(null)} style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--overlay)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, maxHeight: "85vh", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 20, padding: 22, boxShadow: "0 18px 50px var(--shadow)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26 }}>{open.name || "Client"}</div>
                  <div style={{ fontSize: 14.5, color: "var(--sub)", marginTop: 2 }}><PhoneLink number={open.phone} /></div>
                </div>
                <button onClick={() => setOpenId(null)} style={{ background: "none", color: "var(--sub)" }}><X size={22} /></button>
              </div>

              <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15 }}><Clock size={17} style={{ color: "var(--gold)", flexShrink: 0 }} /><span style={{ color: "var(--sub)" }}>Preferred time:</span> <span style={{ fontWeight: 600 }}>{whenLabel[open.when] || open.when || "Any time"}</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15 }}><Sparkles size={17} style={{ color: "var(--gold)", flexShrink: 0 }} /><span style={{ color: "var(--sub)" }}>Service:</span> <span style={{ fontWeight: 600 }}>{open.service}</span></div>
                {open.provider && <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15 }}><User size={17} style={{ color: "var(--gold)", flexShrink: 0 }} /><span style={{ color: "var(--sub)" }}>Prefers:</span> <span style={{ fontWeight: 600 }}>{open.provider}</span></div>}
                {open.day && <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15 }}><Calendar size={17} style={{ color: "var(--gold)", flexShrink: 0 }} /><span style={{ color: "var(--sub)" }}>Day:</span> <span style={{ fontWeight: 600 }}>{open.day}</span></div>}
                {open.at && <div style={{ fontSize: 13, color: "var(--faint)", marginTop: 2 }}>Added {open.at}</div>}
              </div>

              <button className="lift" onClick={() => notifyOpening(open)} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 15, fontSize: 15, fontWeight: 600, borderRadius: 12, border: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10 }}><Bell size={17} /> Notify a space opened up</button>
              <p style={{ fontSize: 13, color: "var(--faint)", textAlign: "center", lineHeight: 1.45, marginBottom: 16 }}>Sends {(open.name || "the client").split(" ")[0]} an in-app notification with a link to book the open slot.</p>

              <button onClick={() => removeEntry(open, waitlist.indexOf(open))} style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", color: "var(--sub)", padding: 12, fontSize: 14, letterSpacing: 1, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Trash2 size={16} /> REMOVE FROM WAITLIST</button>
            </div>
        </div>
      )}
    </>
  );
}

// ---------- DAY CALENDAR: labeled hour rows, 15-min subdivisions ----------
// Row-height control (Mangomint-style S/M/L/XL). Value = pixels PER HOUR.
const ROW_SIZES = [
  { id: "S", label: "S", pxPerHour: 80 },
  { id: "M", label: "M", pxPerHour: 130 },
  { id: "L", label: "L", pxPerHour: 200 },
  { id: "XL", label: "XL", pxPerHour: 300 },
];
const DAY_START = 9 * 60;   // 9 AM
const DAY_END = 15 * 60;    // 3 PM (scrolls)

// ============================================================
// CREATE POPOVER — appears at the long-press point, always on-screen
// ============================================================
function CreatePopover({ slot, providerName, onAppt, onBlock, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999, ready: false });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const M = 10;
    const px = slot.x ?? vw / 2, py = slot.y ?? vh / 2;
    let left = px - 16;
    if (left + w > vw - M) left = vw - w - M;   // clamp right edge
    if (left < M) left = M;                      // clamp left edge
    let top = py + 14;
    if (top + h > vh - M) top = py - h - 14;     // flip above if no room below
    if (top < M) top = M;
    setPos({ left, top, ready: true });
  }, [slot]);
  return (
    <>
      <div className="fade-in" onClick={onClose} style={{ position: "fixed", inset: 0, background: "transparent", zIndex: 55 }} />
      <div ref={ref} style={{ position: "fixed", left: pos.left, top: pos.top, width: 240, maxWidth: "calc(100vw - 20px)", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 18, padding: 14, zIndex: 56, boxShadow: "var(--shadow-lg)", transformOrigin: "top left", animation: "popIn .2s var(--ease) both", opacity: pos.ready ? 1 : 0, boxSizing: "border-box" }}>
        <div style={{ padding: "2px 4px 12px" }}>
          <div style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: -0.2 }}>{fmtTime(slot.start)}</div>
          <div style={{ fontSize: 13, color: "var(--sub)" }}>with {providerName}</div>
        </div>
        <button className="lift" onClick={onAppt} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, background: "var(--gold)", color: "var(--on-gold)", padding: "12px 14px", borderRadius: 12, fontSize: 14.5, fontWeight: 600, marginBottom: 8, boxSizing: "border-box" }}><Calendar size={17} /> New appointment</button>
        <button className="lift" onClick={onBlock} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text)", padding: "12px 14px", borderRadius: 12, fontSize: 14.5, fontWeight: 500, boxSizing: "border-box" }}><Clock size={17} style={{ color: "var(--sub)" }} /> Block off time</button>
      </div>
    </>
  );
}

// ============================================================
// NEW APPOINTMENT — pick client + service, then book (full page)
// ============================================================
function NewAppointmentForm({ slot, providers, clients, services, onClose, onBook, onBlock }) {
  const [provId, setProvId] = useState(slot.providerId);
  const staff = providers.filter((p) => p.role !== "owner-nonstaff");
  const [client, setClient] = useState(null);
  const [walkIn, setWalkIn] = useState(false);
  const [walkInFirst, setWalkInFirst] = useState("");
  const [walkInLast, setWalkInLast] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [walkInEmail, setWalkInEmail] = useState("");
  const [service, setService] = useState(null);
  const [note, setNote] = useState("");
  const [startMin, setStartMin] = useState(slot.start);
  const [q, setQ] = useState("");
  const [openSvc, setOpenSvc] = useState(false);
  // if the chosen service isn't offered by the current provider, switch to one who offers it
  useEffect(() => {
    if (!service || !service.staff) return;
    if (provId === "anyone") return;
    if (service.staff[provId]?.on === false) {
      const firstOffering = staff.find((p) => p.id !== "anyone" && service.staff[p.id]?.on !== false);
      if (firstOffering) setProvId(firstOffering.id);
    }
  }, [service]);
  const fmtHM = (m) => fmtTime(m);
  const dur = service ? getDuration(client, service, provId) : 0;
  const price = service ? getPrice(service, provId) : 0;
  const canBook = service && (client || (walkIn && walkInFirst.trim() && walkInLast.trim() && walkInPhone.replace(/\D/g, "").length >= 10));
  const dateLabel = (() => { const d = new Date(); return `${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()]}, ${MONTHS[d.getMonth()].slice(0,3)} ${d.getDate()}`; })();
  const stepTime = (delta) => setStartMin((m) => Math.max(6 * 60, Math.min(21 * 60, m + delta)));

  const [showTimePick, setShowTimePick] = useState(false);
  const scrollRef = useRef(null);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    try { window.scrollTo(0, 0); } catch (e) {}
  }, []);
  // search by first name, last name, OR any part of the phone number (digits only)
  const qd = q.replace(/\D/g, "");
  const matches = q.trim() ? clients.filter((c) => {
    const nameHit = c.name.toLowerCase().includes(q.trim().toLowerCase());
    const phoneHit = qd.length > 0 && (c.phone || "").replace(/\D/g, "").includes(qd);
    return nameHit || phoneHit;
  }) : clients;

  // generate selectable times (every 15 min across the working day)
  const timeOptions = [];
  for (let m = 6 * 60; m <= 21 * 60; m += 15) timeOptions.push(m);

  const fieldWrap = { padding: "26px 0", borderBottom: "1px solid var(--line)" };

  return (
    <div className="fade-in" style={{ position: "fixed", inset: 0, background: "var(--bg)", zIndex: 800, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* header bar — Cancel / title / Book */}
      <div style={{ background: "var(--gold)", color: "var(--on-gold)", padding: "17px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: "none", color: "var(--on-gold)", fontSize: 16, opacity: 0.9 }}>Cancel</button>
        <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.2 }}>New Appointment</span>
        <button onClick={() => canBook && onBook({ providerId: provId, start: startMin, client, service, walkInFirst, walkInLast, walkInPhone, walkInEmail, note })} style={{ background: "none", color: "var(--on-gold)", fontSize: 16, fontWeight: 700, opacity: canBook ? 1 : 0.45 }}>Book</button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "0 22px 60px" }}>
          {/* On [date] | At [time] split */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--line)" }}>
            <div style={{ flex: 1, padding: "26px 0", borderRight: "1px solid var(--line)" }}>
              <span style={{ fontSize: 17, color: "var(--faint)" }}>On </span>
              <span style={{ fontSize: 19, fontWeight: 600 }}>{dateLabel}</span>
            </div>
            <button onClick={() => setShowTimePick(true)} style={{ flex: 1, padding: "26px 0", paddingLeft: 24, background: "none", textAlign: "left", color: "var(--text)" }}>
              <span style={{ fontSize: 17, color: "var(--faint)" }}>At </span>
              <span style={{ fontSize: 19, fontWeight: 600 }}>{fmtHM(startMin)}</span>
            </button>
          </div>

          {/* provider chips — only those who offer the chosen service */}
          {(() => {
            const offering = service ? staff.filter((p) => !service.staff || service.staff[p.id]?.on !== false) : staff;
            return offering.length > 1 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "22px 0 0" }}>
              {offering.map((p) => { const on = p.id === provId; return (
                <button key={p.id} onClick={() => setProvId(p.id)} style={{ display: "flex", alignItems: "center", gap: 7, background: on ? "color-mix(in srgb, var(--gold) 12%, var(--panel))" : "var(--panel)", border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, color: "var(--text)", padding: "9px 16px", borderRadius: 22, fontSize: 14.5, fontWeight: on ? 600 : 400 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color || "var(--gold)" }} />{p.name}</button>
              ); })}
            </div>
            );
          })()}

          {/* CLIENT */}
          {client ? (
            <div style={{ ...fieldWrap, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--gold)", color: "var(--on-gold)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontSize: 17 }}>{client.name.charAt(0)}</div>
                <div><div style={{ fontSize: 17, fontWeight: 500 }}>{client.name}</div><div style={{ fontSize: 14, color: "var(--sub)" }}>{client.phone || `${client.visits} visits`}</div></div>
              </div>
              <button onClick={() => setClient(null)} style={{ background: "none", color: "var(--gold)", fontSize: 14.5 }}>Change</button>
            </div>
          ) : walkIn ? (
            <div style={fieldWrap}>
              <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                <input autoFocus value={walkInFirst} onChange={(e) => setWalkInFirst(e.target.value)} placeholder="First name" style={{ flex: 1, background: "transparent", border: "none", color: "var(--text)", fontSize: 18, fontFamily: FONT_BODY }} />
                <input value={walkInLast} onChange={(e) => setWalkInLast(e.target.value)} placeholder="Last name" style={{ flex: 1, background: "transparent", border: "none", color: "var(--text)", fontSize: 18, fontFamily: FONT_BODY }} />
              </div>
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
                <input value={walkInPhone} onChange={(e) => setWalkInPhone(e.target.value)} placeholder="Phone number (required)" inputMode="tel" style={{ width: "100%", background: "transparent", border: "none", color: "var(--text)", fontSize: 16, fontFamily: FONT_BODY }} />
              </div>
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <input value={walkInEmail} onChange={(e) => setWalkInEmail(e.target.value)} placeholder="Email (optional)" inputMode="email" style={{ width: "100%", background: "transparent", border: "none", color: "var(--text)", fontSize: 16, fontFamily: FONT_BODY }} />
              </div>
              <button onClick={() => setWalkIn(false)} style={{ background: "none", color: "var(--sub)", fontSize: 13.5, marginTop: 12 }}>← Choose an existing client instead</button>
            </div>
          ) : (
            <div style={fieldWrap}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or create client" style={{ flex: 1, background: "transparent", border: "none", color: "var(--text)", fontSize: 18, fontFamily: FONT_BODY }} />
                <button onClick={() => { setWalkIn(true); setClient(null); }} title="Walk-in / new" style={{ width: 30, height: 30, borderRadius: "50%", border: "1px solid var(--border2)", background: "none", color: "var(--sub)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Plus size={17} /></button>
              </div>
              {q.trim() && (
                <div style={{ display: "grid", gap: 6, maxHeight: 280, overflowY: "auto", marginTop: 16 }}>
                  {matches.map((c) => (
                    <button key={c.id} onClick={() => { setClient(c); setQ(""); }} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "11px 14px", color: "var(--text)", textAlign: "left" }}>
                      <div style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--panel2)", color: "var(--sub)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontSize: 14 }}>{c.name.charAt(0)}</div>
                      <div style={{ flex: 1 }}><div style={{ fontSize: 15 }}>{c.name}</div><div style={{ fontSize: 13, color: "var(--sub)" }}>{c.phone || `${c.visits} visits`}</div></div>
                    </button>
                  ))}
                  {matches.length === 0 && (
                    <button onClick={() => { setWalkIn(true); const parts = q.trim().split(/\s+/); setWalkInFirst(parts[0] || ""); setWalkInLast(parts.slice(1).join(" ")); }} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--panel2)", border: "1px dashed var(--border2)", borderRadius: 12, padding: "12px 14px", color: "var(--text)", fontSize: 14.5 }}><Plus size={16} style={{ color: "var(--gold)" }} /> Create “{q}” as a new client</button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* SERVICE — inline dropdown */}
          <div style={{ borderBottom: "1px solid var(--line)" }}>
            <button onClick={() => setOpenSvc(!openSvc)} style={{ width: "100%", background: "none", display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--text)", textAlign: "left", padding: "26px 0" }}>
              {service ? (
                <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                  <span style={{ width: 11, height: 11, borderRadius: "50%", background: hexById(service.color) }} />
                  <div><div style={{ fontSize: 17, fontWeight: 500 }}>{service.name}</div><div style={{ fontSize: 14, color: "var(--sub)" }}>${price} · {dur} min</div></div>
                </div>
              ) : (
                <span style={{ color: "var(--faint)", fontSize: 18 }}>Select a service</span>
              )}
              <ChevronRight size={20} style={{ color: "var(--faint)", transform: openSvc ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
            </button>
            {openSvc && (
              <div style={{ display: "grid", gap: 8, paddingBottom: 22 }}>
                {services.map((s) => { const on = service && service.id === s.id; return (
                  <button key={s.id} onClick={() => { setService(s); setOpenSvc(false); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: on ? "color-mix(in srgb, var(--gold) 10%, var(--panel))" : "var(--panel)", border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, borderRadius: 12, padding: "13px 16px", color: "var(--text)", textAlign: "left" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: hexById(s.color), flexShrink: 0 }} />
                      <div><div style={{ fontSize: 15.5, fontWeight: on ? 600 : 500 }}>{s.name}</div><div style={{ fontSize: 13, color: "var(--sub)" }}>${getPrice(s, provId)} · {getDuration(client, s, provId)} min</div></div>
                    </div>
                    {on && <Check size={18} style={{ color: "var(--gold)" }} />}
                  </button>
                ); })}
              </div>
            )}
          </div>

          {/* NOTE */}
          <div style={fieldWrap}>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" style={{ width: "100%", background: "transparent", border: "none", color: "var(--text)", fontSize: 18, fontFamily: FONT_BODY }} />
          </div>

          {/* bottom action row */}
          <button onClick={() => onBlock({ providerId: provId, start: startMin })} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", color: "var(--text)", padding: "26px 0", fontSize: 17 }}>
            <span>Create time block</span>
            <ChevronRight size={20} style={{ color: "var(--faint)" }} />
          </button>
        </div>
      </div>

      {/* time picker — fills the form from the top, always in view */}
      {showTimePick && (
        <div style={{ position: "absolute", inset: 0, background: "var(--bg)", zIndex: 5, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "17px 18px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
            <button onClick={() => setShowTimePick(false)} style={{ background: "none", color: "var(--gold)", fontSize: 16 }}>Cancel</button>
            <span style={{ fontSize: 17, fontWeight: 600 }}>Start time</span>
            <span style={{ width: 50 }} />
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "18px 18px 40px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, maxWidth: 460, margin: "0 auto" }}>
              {timeOptions.map((m) => { const on = m === startMin; return (
                <button key={m} onClick={() => { setStartMin(m); setShowTimePick(false); }} style={{ padding: "14px 0", borderRadius: 10, background: on ? "var(--gold)" : "var(--panel)", color: on ? "var(--on-gold)" : "var(--text)", border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, fontSize: 14.5, fontWeight: on ? 600 : 400 }}>{fmtHM(m)}</button>
              ); })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- DATE PICKER SHEET ----------
// Editorial month-grid picker used by the calendar's date header. Tapping a date calls onPick
// with that JS Date; the caller converts to dayOffset. "Today" shortcut at the bottom.
function DatePickerSheet({ selectedDate, onPick, onClose }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [viewMonth, setViewMonth] = useState(() => {
    const base = selectedDate ? new Date(selectedDate) : today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const year = viewMonth.getFullYear();
  const monthIdx = viewMonth.getMonth();
  const firstDow = new Date(year, monthIdx, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

  // Build a 6-row x 7-col grid (42 cells) so the layout doesn't shift between months.
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, monthIdx, day));
  while (cells.length < 42) cells.push(null);

  const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const stepMonth = (delta) => { const m = new Date(viewMonth); m.setMonth(m.getMonth() + delta); setViewMonth(m); };

  const navBtn = { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 11, width: 40, height: 40, color: "var(--text)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };

  return (
    <div style={{ padding: "10px 4px 8px" }}>
      {/* Month nav row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <button onClick={() => stepMonth(-1)} aria-label="Previous month" style={navBtn}><ChevronLeft size={17} /></button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--gold)", fontWeight: 600, marginBottom: 4 }}>{year}</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 500, letterSpacing: -0.3 }}>{MONTHS[monthIdx]}</div>
        </div>
        <button onClick={() => stepMonth(1)} aria-label="Next month" style={navBtn}><ChevronRight size={17} /></button>
      </div>
      {/* Day-of-week header */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 6 }}>
        {["S","M","T","W","T","F","S"].map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10.5, letterSpacing: 1.5, color: "var(--faint)", fontWeight: 600, padding: "6px 0" }}>{d}</div>
        ))}
      </div>
      {/* Date grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} />;
          const isToday = sameDay(d, today);
          const isSelected = sameDay(d, selectedDate);
          return (
            <button key={d.toISOString()} onClick={() => onPick(d)} style={{
              aspectRatio: "1",
              minHeight: 40,
              border: isToday && !isSelected ? "1px solid var(--gold)" : "1px solid transparent",
              background: isSelected ? "var(--text)" : "transparent",
              color: isSelected ? "var(--bg)" : "var(--text)",
              borderRadius: 10,
              fontSize: 15,
              fontFamily: FONT_BODY,
              fontWeight: isSelected ? 600 : 400,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "background .15s, color .15s",
            }}>{d.getDate()}</button>
          );
        })}
      </div>
      {/* Bottom actions */}
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button onClick={() => { setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1)); onPick(today); }} className="lift" style={{ flex: 1, background: "var(--gold)", color: "var(--on-gold)", padding: 14, fontSize: 13, letterSpacing: 2, fontWeight: 600, borderRadius: 12, border: "none" }}>JUMP TO TODAY</button>
        <button onClick={onClose} style={{ background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)", padding: "0 18px", borderRadius: 12, fontSize: 14, fontWeight: 500 }}>Cancel</button>
      </div>
    </div>
  );
}

function CalendarView({ appts, setAppts, clients, setClients, providers, services, business, theme, showToast, waitlist = [], setWaitlist }) {
  const sizeId = business?.calendarRowSize || "L";
  const [showWaitlistPanel, setShowWaitlistPanel] = useState(false);
  const [showCalendarOptions, setShowCalendarOptions] = useState(false);
  const [open, setOpen] = useState(null);
  const [dayOffset, setDayOffset] = useState(0);
  const [drag, setDrag] = useState(null);     // { id, deltaMin } while dragging
  const [pending, setPending] = useState(null); // { appt, newStart, newEnd } awaiting confirm
  const [createSlot, setCreateSlot] = useState(null); // { providerId, start } long-press to create
  const [newApptSlot, setNewApptSlot] = useState(null); // { providerId, start } → opens the pick-client+service form
  const [pressInd, setPressInd] = useState(null); // { providerId, start, y } live indicator while holding
  const [checkout, setCheckout] = useState(null); // appt being checked out
  const [showDatePicker, setShowDatePicker] = useState(false); // month-grid date jumper triggered by tapping the date header
  const dragRef = useRef(null);                // mutable: { id, startY, origStart, dur, moved }
  const holdTimerRef = useRef(null);           // press-and-hold timer for drag-to-reschedule
  const pressRef = useRef(null);               // mutable: long-press timer + start info
  const blockScrollRef = useRef((e) => { if (e.cancelable) e.preventDefault(); });
  const dayStripRef = useRef(null);            // ref on the horizontal day strip — used to scroll "today" into view on first mount
  // On first render, position the day strip so today's button is the leftmost visible one.
  // Without this, adding past-day buttons would leave the strip parked 14 days in the past on open.
  // useLayoutEffect runs after DOM commit but before paint, so the user never sees the strip jump.
  useLayoutEffect(() => {
    const strip = dayStripRef.current;
    if (!strip) return;
    const todayBtn = strip.querySelector('[data-today="1"]');
    if (todayBtn) strip.scrollLeft = todayBtn.offsetLeft - strip.offsetLeft;
  }, []);

  const setStatus = (id, status, msg) => { const freed = appts.find((a) => a.id === id); setAppts(appts.map((a) => (a.id === id ? { ...a, status, ...(status === "in-service" && !a.serviceStartedAt ? { serviceStartedAt: Date.now() } : {}) } : a))); if (msg) showToast(msg); setOpen((o) => o && o.id === id ? { ...o, status, ...(status === "in-service" && !o.serviceStartedAt ? { serviceStartedAt: Date.now() } : {}) } : o); if (status === "cancelled" && freed) setTimeout(() => handleFreedSlot(freed), 350); };
  // open checkout instead of silently completing
  const startCheckout = (appt) => { setOpen(null); setCheckout(appt); };
  const finishCheckout = (id, summary) => {
    setAppts((cur) => {
      const done = cur.map((a) => a.id === id ? { ...a, status: "done", paid: summary } : a);
      // if they rebooked, drop a real future appointment on the calendar — confirmed, NOT prepaid
      if (summary && (summary.rebookWeeks != null || summary.rebookDate)) {
        const src = cur.find((a) => a.id === id);
        if (src) {
          const nd = summary.rebookDate ? new Date(summary.rebookDate + "T00:00:00") : (() => { const d = new Date(); d.setDate(d.getDate() + summary.rebookWeeks * 7); return d; })();
          const dur = src.end - src.start;
          const newAppt = { ...src, id: "rb" + Date.now() + Math.floor(Math.random() * 1000), status: "confirmed", paid: null, prepaid: false, rebookDiscount: (business?.rebook?.discountEnabled !== false ? (business?.rebook?.discount || 0) : 0), rebookDiscountType: business?.rebook?.discountType || "amount", bookedFor: nd.toISOString(), start: src.start, end: src.start + dur, photos: 0, hasPhotos: false, hasNote: false };
          done.push(newAppt);
        }
      }
      return done;
    });
    setCheckout(null);
  };
  const updateAppt = (id, patch) => { setAppts((cur) => cur.map((a) => a.id === id ? { ...a, ...patch } : a)); setOpen((o) => o && o.id === id ? { ...o, ...patch } : o); };
  // When a slot frees up, find waitlisted clients whose requested window + barber
  // match it, then act per the shop's Waitlist settings (Settings → Waitlist).
  const WINDOW = { early: [DAY_START, 11 * 60], midday: [11 * 60, 14 * 60], afternoon: [14 * 60, DAY_END] };
  const wlRules = (business && business.waitlist) || { mode: "ask", order: "longest", delayMin: 30 };
  const [waitlistMatch, setWaitlistMatch] = useState(null); // { freed, matches } awaiting confirm
  // parse the "at" timestamp so we can order by who's waited longest
  const waitedSince = (w) => { const t = Date.parse(w.at); return isNaN(t) ? 0 : t; };
  const findWaitlistMatches = (freed) => {
    if (!freed) return [];
    const prov = providers.find((p) => p.id === freed.providerId);
    return (waitlist || []).filter((w) => {
      const provOk = !w.provider || w.provider === "Any" || (prov && w.provider === prov.name);
      let timeOk = true;
      if (w.when && WINDOW[w.when]) { const [a, b] = WINDOW[w.when]; timeOk = freed.start < b && freed.end > a; }
      return provOk && timeOk;
    }).sort((a, b) => {
      const ap = (a.photos || 0) > 0 ? 1 : 0;
      const bp = (b.photos || 0) > 0 ? 1 : 0;
      if (ap !== bp) return bp - ap;            // attached a reference photo = higher priority
      return waitedSince(a) - waitedSince(b);   // tie-break: longest-waiting first
    });
  };
  // send the in-app notification (+ booking link). For "longest" order we notify
  // one person; the rest are queued, each offered after delayMin if unclaimed.
  const sendWaitlistNotices = (matches, freed) => {
    if (!matches.length) return;
    if (wlRules.order === "longest") {
      const first = matches[0];
      const rest = matches.length - 1;
      showToast(rest > 0
        ? `Sent ${first.name.split(" ")[0]} a booking link. ${rest} other${rest > 1 ? "s" : ""} queued — each offered after ${wlRules.delayMin || 30} min if unclaimed.`
        : `Sent ${first.name.split(" ")[0]} an in-app notification with a booking link.`);
    } else {
      const names = matches.map((m) => (m.name || "client").split(" ")[0]).join(", ");
      showToast(`Sent ${matches.length} in-app notification${matches.length > 1 ? "s" : ""} with a booking link: ${names}.`);
    }
    setWaitlistMatch(null);
  };
  const handleFreedSlot = (freed) => {
    if (!freed || freed.status === "done" || freed.status === "block") return;
    const matches = findWaitlistMatches(freed);
    if (!matches.length) return;
    if (wlRules.mode === "silent") sendWaitlistNotices(matches, freed); // auto-send, no prompt
    else setWaitlistMatch({ freed, matches }); // ask first
  };

  const deleteAppt = (id) => {
    const freed = appts.find((a) => a.id === id);
    setAppts((cur) => cur.filter((a) => a.id !== id));
    setOpen(null);
    showToast("Appointment removed.");
    if (freed) setTimeout(() => handleFreedSlot(freed), 350);
  };

  const pxPerHour = (ROW_SIZES.find((s) => s.id === sizeId) || ROW_SIZES[2]).pxPerHour;
  const PPM = pxPerHour / 60; // pixels per minute
  const totalMin = DAY_END - DAY_START;
  const gridHeight = totalMin * PPM;

  const snap5 = (min) => Math.round(min / 5) * 5;

  // begin dragging a block
  const startDrag = (e, a) => {
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    // Only arm a long-press. Do NOT capture the touch — scrolling stays completely normal.
    // Tapping is handled separately by onClick. Dragging only starts after a long hold.
    dragRef.current = { id: a.id, startY: y, startX: x, origStart: a.start, dur: a.end - a.start, didDrag: false, armed: false };
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      const d = dragRef.current;
      if (d && d.id === a.id && !d.armed) {
        d.armed = true;
        setDrag({ id: a.id, deltaMin: 0, armed: true });
        if (navigator.vibrate) navigator.vibrate(12);
      }
    }, 650);
  };

  useEffect(() => {
    // Always watch for early movement so a scroll cancels the pending long-press.
    const watchMove = (e) => {
      const d = dragRef.current; if (!d || d.armed) return;
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      if (Math.abs(y - d.startY) > 3 || Math.abs(x - (d.startX || 0)) > 3) {
        d.scrolled = true;
        if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
      }
    };
    const watchEnd = () => {
      const d = dragRef.current;
      if (d && !d.armed) {
        if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
        setTimeout(() => { if (dragRef.current && !dragRef.current.armed) dragRef.current = null; }, 300);
      }
    };
    window.addEventListener("touchmove", watchMove, { passive: true });
    window.addEventListener("mousemove", watchMove);
    window.addEventListener("touchend", watchEnd);
    window.addEventListener("mouseup", watchEnd);
    return () => {
      window.removeEventListener("touchmove", watchMove);
      window.removeEventListener("mousemove", watchMove);
      window.removeEventListener("touchend", watchEnd);
      window.removeEventListener("mouseup", watchEnd);
    };
  }, []);

  useEffect(() => {
    if (!drag) return;
    const move = (e) => {
      const d = dragRef.current; if (!d || !d.armed) return;
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      if (e.cancelable) e.preventDefault();   // only now, while actively dragging, block scroll
      const rawDelta = (y - d.startY) / PPM;
      let newStart = snap5(d.origStart + rawDelta);
      newStart = Math.max(DAY_START, Math.min(DAY_END - d.dur, newStart));
      const deltaMin = newStart - d.origStart;
      d.deltaMin = deltaMin;
      d.didDrag = true;
      setDrag({ id: d.id, deltaMin, armed: true });
    };
    const up = () => {
      if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      const appt = appts.find((a) => a.id === d.id);
      if (appt && d.armed && d.deltaMin && d.deltaMin !== 0) {
        const newStart = appt.start + d.deltaMin;
        setPending({ appt, newStart, newEnd: newStart + (appt.end - appt.start) });
      }
      // clear shortly after so the onClick handler can see didDrag and suppress opening
      setTimeout(() => { dragRef.current = null; }, 300);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
  }, [drag, appts, PPM]);

  const confirmMove = () => {
    if (!pending) return;
    setAppts(appts.map((a) => a.id === pending.appt.id ? { ...a, start: pending.newStart, end: pending.newEnd } : a));
    showToast(`${pending.appt.name} moved to ${fmtTime(pending.newStart)}.`);
    setPending(null);
  };

  // ---- Mangomint-style: long-press → beige block appears → drag to scrub time → release opens form ----
  const clampStart = (clientY, rect) => {
    const min = DAY_START + (clientY - rect.top) / PPM;
    return Math.max(DAY_START, Math.min(DAY_END - 15, snap5(min)));
  };
  const NEW_DUR = 30; // default block length shown while scrubbing
  const onSlotClick = (e, providerId, colEl) => {
    // a plain tap (no long-press) still works as a quick shortcut
    if (e.target.closest("[data-appt]")) return;
    if (pressRef.current && pressRef.current.consumed) { pressRef.current = null; return; } // long-press already handled it
    const rect = colEl.getBoundingClientRect();
    const start = clampStart(e.clientY != null ? e.clientY : rect.top, rect);
    setNewApptSlot({ providerId, start });
  };
  const onSlotDown = (e, providerId, colEl) => {
    if (e.target.closest("[data-appt]")) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = colEl.getBoundingClientRect();
    const start = clampStart(y, rect);
    pressRef.current = { providerId, rect, start, y, scrubbing: false, consumed: false };
    pressRef.current.timer = setTimeout(() => {
      const p = pressRef.current; if (!p) return;
      p.scrubbing = true; p.consumed = true;
      if (navigator.vibrate) navigator.vibrate(15);
      document.body.classList.add("scrub-lock");
      // hard block: stop ALL page scrolling natively while scrubbing
      document.addEventListener("touchmove", blockScrollRef.current, { passive: false });
      setPressInd({ providerId: p.providerId, start: p.start });
    }, 300);
  };
  const onSlotMove = (e) => {
    const p = pressRef.current; if (!p) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    if (!p.scrubbing) {
      if (Math.abs(y - p.y) > 14) { clearTimeout(p.timer); pressRef.current = null; } // moved before hold = scroll
      return;
    }
    if (e.cancelable) e.preventDefault();
    const start = clampStart(y, p.rect);
    p.start = start;
    setPressInd({ providerId: p.providerId, start });
  };
  const onSlotUp = () => {
    const p = pressRef.current;
    if (p) clearTimeout(p.timer);
    document.body.classList.remove("scrub-lock");
    document.removeEventListener("touchmove", blockScrollRef.current, { passive: false });
    if (p && p.scrubbing) {
      setNewApptSlot({ providerId: p.providerId, start: p.start }); // release → open the form at that time
      setPressInd(null);
      // keep p.consumed so the click that follows is ignored
      setTimeout(() => { pressRef.current = null; }, 50);
    } else {
      setPressInd(null);
    }
  };
  const startPress = () => {};
  const cancelPress = () => {};
  const endPress = () => {};
  const onColMove = () => {};

  // build a new appointment or time block at the chosen slot
  const createAt = (kind) => {
    if (!createSlot) return;
    const { providerId, start } = createSlot;
    if (kind === "appt") {
      // open the full booking form to pick client + service
      setNewApptSlot({ providerId, start });
      setCreateSlot(null);
      return;
    }
    const dur = 30;
    const id = "b" + Date.now() + Math.floor(Math.random() * 1000);
    const bookedFor = new Date(selectedDate); bookedFor.setHours(Math.floor(start / 60), start % 60, 0, 0);
    const newAppt = { id, providerId, clientId: null, serviceId: null, start, end: start + dur, bookedFor: bookedFor.toISOString(), status: "block", vip: false, name: "Time Block", title: "Blocked", detail: "" };
    setAppts([...appts, newAppt]);
    setCreateSlot(null);
    showToast(`Time block added at ${fmtTime(start)}.`);
  };

  // commit a fully-formed appointment from the booking form
  const bookAppt = ({ providerId, start, client, service, walkInFirst, walkInLast, walkInPhone, walkInEmail, note }) => {
    const id = "a" + Date.now() + Math.floor(Math.random() * 1000); // collision-proof string id
    const dur = getDuration(client, service, providerId);
    const price = getPrice(service, providerId);
    // Stamp the appointment with the day currently shown on the calendar, or it can't be placed on any date.
    const bookedFor = new Date(selectedDate); bookedFor.setHours(Math.floor(start / 60), start % 60, 0, 0);

    // If this is a brand-new person (not an existing client), save them as a real client too.
    let bookClient = client;
    const firstTrim = (walkInFirst || "").trim();
    const lastTrim = (walkInLast || "").trim();
    const walkInName = `${firstTrim} ${lastTrim}`.trim();
    if (!client && walkInName) {
      const newClient = { id: "c" + Date.now() + Math.floor(Math.random() * 1000), name: walkInName, firstName: firstTrim, lastName: lastTrim, phone: (walkInPhone || "").trim(), email: (walkInEmail || "").trim(), provider: providerId === "anyone" ? "dan" : providerId, visits: 0, customDurations: {}, notes: "", messages: [], gallery: [], timeline: [], family: [] };
      setClients([newClient, ...clients]);
      bookClient = newClient;
    }

    const newAppt = { id, providerId, clientId: bookClient ? bookClient.id : null, serviceId: service.id, start, end: start + dur, bookedFor: bookedFor.toISOString(), status: "confirmed", vip: false, name: bookClient ? bookClient.name : (walkInName || "Walk-in"), title: service.name, detail: note || "", hasNote: !!(note && note.trim()), price, phone: bookClient ? bookClient.phone : (walkInPhone || ""), hasPhotos: false, photos: 0 };
    setAppts([...appts, newAppt]);
    setNewApptSlot(null);
    showToast(`${newAppt.name} booked at ${fmtTime(start)}.`);
  };

  const allStaff = providers.filter((p) => p.id !== "anyone");
  const [hidden, setHidden] = useState([]); // provider ids hidden from view
  const staff = allStaff.filter((p) => !hidden.includes(p.id));
  const toggleStaff = (id) => setHidden((h) => h.includes(id) ? h.filter((x) => x !== id) : (allStaff.length - h.length > 1 ? [...h, id] : h));

  // hour rows + 15-min subdivision lines
  const hours = [];
  for (let t = DAY_START; t < DAY_END; t += 60) hours.push(t);
  const quarterLines = [];
  for (let t = DAY_START; t <= DAY_END; t += 15) quarterLines.push(t);

  const weekStartsOn = (business && business.weekStartsOn != null) ? business.weekStartsOn : 0;
  const week = useMemo(() => { const arr = []; const base = new Date(); const shift = (base.getDay() - weekStartsOn + 7) % 7; base.setDate(base.getDate() + dayOffset - shift); for (let i = 0; i < 7; i++) { const d = new Date(base); d.setDate(base.getDate() + i); arr.push(d); } return arr; }, [dayOffset, weekStartsOn]);
  const today = new Date();
  // The day currently being shown on the calendar (controlled by dayOffset)
  const selectedDate = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(0, 0, 0, 0); return d; }, [dayOffset]);
  const sameDay = (iso, refDate) => { if (!iso) return false; const a = new Date(iso); return a.getFullYear() === refDate.getFullYear() && a.getMonth() === refDate.getMonth() && a.getDate() === refDate.getDate(); };

  // find the first open 15-min slot for a provider today (falls back to DAY_START)
  const nextFreeSlot = (providerId) => {
    const booked = appts.filter((a) => a.providerId === providerId && a.status !== "done").sort((a, b) => a.start - b.start);
    let t = DAY_START;
    for (const a of booked) {
      if (a.start >= t + 15) break;     // found a gap before this appt
      if (a.end > t) t = a.end;          // push past this appt
    }
    return Math.min(t, DAY_END - 15);
  };

  return (
    <div className="fade-up">
      {showWaitlistPanel && (
        <div onClick={() => setShowWaitlistPanel(false)} style={{ position: "fixed", inset: 0, background: "var(--overlay)", zIndex: 60, display: "flex", flexDirection: "column", justifyContent: "flex-start" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg)", borderBottomLeftRadius: 22, borderBottomRightRadius: 22, maxHeight: "85vh", overflowY: "auto", padding: "calc(20px + env(safe-area-inset-top)) 22px 30px", boxShadow: "0 20px 40px rgba(0,0,0,0.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ width: 28, height: 1.5, background: "var(--gold)", marginBottom: 10 }} />
                <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 500, lineHeight: 1 }}>Waitlist</h2>
              </div>
              <button onClick={() => setShowWaitlistPanel(false)} style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "50%", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--sub)" }}><X size={18} /></button>
            </div>
            <WaitlistView waitlist={waitlist} setWaitlist={setWaitlist} onText={(p) => showToast && showToast(`Texting ${p.name || "client"}…`)} showToast={showToast} />
          </div>
        </div>
      )}
      {showCalendarOptions && (
        <div onClick={() => setShowCalendarOptions(false)} style={{ position: "fixed", inset: 0, background: "var(--overlay)", zIndex: 60, display: "flex", flexDirection: "column", justifyContent: "flex-start" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg)", borderBottomLeftRadius: 22, borderBottomRightRadius: 22, maxHeight: "85vh", overflowY: "auto", padding: "calc(20px + env(safe-area-inset-top)) 22px 30px", boxShadow: "0 20px 40px rgba(0,0,0,0.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <div style={{ width: 28, height: 1.5, background: "var(--gold)", marginBottom: 10 }} />
                <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 500, lineHeight: 1 }}>Calendar view</h2>
              </div>
              <button onClick={() => setShowCalendarOptions(false)} style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "50%", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--sub)" }}><X size={18} /></button>
            </div>

            {/* Row size */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--faint)", fontWeight: 600, marginBottom: 10 }}>ROW HEIGHT</div>
              <div style={{ display: "flex", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: 4, gap: 4 }}>
                {ROW_SIZES.map((s) => { const on = sizeId === s.id; return (
                  <button key={s.id} onClick={() => setBusiness({ ...business, calendarRowSize: s.id })} style={{ flex: 1, padding: "11px 0", borderRadius: 8, fontSize: 14, background: on ? "var(--gold)" : "transparent", color: on ? "var(--on-gold)" : "var(--sub)", fontWeight: on ? 700 : 500, letterSpacing: 0.5 }}>{s.label}</button>
                ); })}
              </div>
            </div>

            {/* Staff filter */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--faint)", fontWeight: 600, marginBottom: 10 }}>SHOWING</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {allStaff.map((p) => {
                  const on = !hidden.includes(p.id);
                  return (
                    <button key={p.id} onClick={() => toggleStaff(p.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: 20, border: `1px solid ${on ? p.color : "var(--border)"}`, background: on ? p.color + "1F" : "transparent", color: on ? "var(--text)" : "var(--faint)", fontSize: 14 }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: on ? p.color : "var(--border2)" }} /> {p.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Legend */}
            <div>
              <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--faint)", fontWeight: 600, marginBottom: 10 }}>STATUS COLORS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 14, color: "var(--text)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 12, height: 12, borderRadius: 12, background: STATUS_COLORS["checked-in"] }} /> Checked in</span>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 12, height: 12, borderRadius: 12, background: STATUS_COLORS["in-service"] }} /> In service</span>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 12, height: 12, borderRadius: 12, border: "1px solid var(--border2)", background: "var(--panel2)" }} /> Done</span>
              </div>
            </div>
          </div>
        </div>
      )}
      <Sheet open={showDatePicker} onClose={() => setShowDatePicker(false)} align="top" maxWidth={420}>
        <DatePickerSheet
          selectedDate={selectedDate}
          onClose={() => setShowDatePicker(false)}
          onPick={(d) => {
            const t = new Date(); t.setHours(0, 0, 0, 0);
            const target = new Date(d); target.setHours(0, 0, 0, 0);
            const diffDays = Math.round((target - t) / 86400000);
            setDayOffset(diffDays);
            setShowDatePicker(false);
          }}
        />
      </Sheet>
      {/* Editorial calendar header — two lines, no cramping. The date cluster is tappable to open the month picker. */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
        <button onClick={() => setShowDatePicker(true)} aria-label="Pick a date" style={{ background: "none", border: "none", padding: 0, margin: 0, textAlign: "left", color: "inherit", cursor: "pointer", display: "block", width: "auto" }}>
          <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--gold)", marginBottom: 8, fontWeight: 600 }}>{`${DAYS[selectedDate.getDay()]}, ${MONTHS[selectedDate.getMonth()]} ${selectedDate.getDate()}`.toUpperCase()}</div>
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 46, fontWeight: 500, letterSpacing: -0.7, lineHeight: 0.95, marginBottom: 16, display: "flex", alignItems: "baseline", gap: 10 }}>
            <span>{relativeDate(selectedDate)}</span>
            <ChevronDown size={22} style={{ color: "var(--faint)", flexShrink: 0, alignSelf: "center", marginTop: 6 }} />
          </h2>
        </button>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setShowCalendarOptions(true)} title="Calendar view" style={{ background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)", width: 40, height: 40, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center" }}><Settings size={15} /></button>
          <button className="lift" onClick={() => { const pid = (staff[0] || allStaff[0] || providers[0]).id; setNewApptSlot({ providerId: pid, start: nextFreeSlot(pid) }); }} style={{ background: "var(--gold)", color: "var(--on-gold)", padding: "0 18px", height: 40, borderRadius: 11, fontSize: 13.5, fontWeight: 600, letterSpacing: 1.5, display: "flex", alignItems: "center", gap: 7, boxShadow: "var(--shadow-md)" }}><Plus size={15} strokeWidth={2.5} /> NEW</button>
          <div style={{ flex: 1 }} />
          <button onClick={() => setShowWaitlistPanel(true)} style={{ background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)", padding: "0 14px", height: 40, borderRadius: 11, fontSize: 13.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 7, position: "relative", letterSpacing: 0.3 }}><Clock size={14} style={{ color: "var(--gold)" }} /> Waitlist{waitlist.length > 0 && <span style={{ background: "var(--gold)", color: "var(--on-gold)", fontSize: 11, fontWeight: 700, borderRadius: 8, minWidth: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", marginLeft: 2 }}>{waitlist.length}</span>}</button>
        </div>
      </div>

      {/* Scrollable multi-week day strip — swipe horizontally, tap to pick. Includes 14 days back so barbers can look up past visits. */}
      <div ref={dayStripRef} style={{ display: "flex", gap: 6, marginBottom: 24, padding: "4px 2px", overflowX: "auto", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}>
        {Array.from({ length: 14 + 28 }, (_, i) => { // 14 days back + 28 days ahead; today sits at index 14 and is pre-scrolled into view on mount
          const offset = i - 14;
          const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + offset);
          const isSelected = d.toDateString() === selectedDate.toDateString();
          const isToday = offset === 0;
          return (
            <button key={offset} data-today={isToday ? "1" : undefined} onClick={() => setDayOffset(offset)} style={{ flex: "0 0 14.2%", minWidth: 48, scrollSnapAlign: "start", textAlign: "center", padding: "12px 4px 14px", borderRadius: 14, background: isSelected ? "var(--text)" : "transparent", color: isSelected ? "var(--bg)" : "var(--sub)", border: "none", cursor: "pointer", position: "relative", transition: "background .2s, color .2s" }}>
              <div style={{ fontSize: 10.5, letterSpacing: 1.5, fontWeight: 500, marginBottom: 5, opacity: isSelected ? 0.8 : 0.55 }}>{["S","M","T","W","T","F","S"][d.getDay()]}</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 500, lineHeight: 1 }}>{d.getDate()}</div>
              {!isSelected && isToday && <div style={{ position: "absolute", bottom: 6, left: "50%", transform: "translateX(-50%)", width: 4, height: 4, borderRadius: "50%", background: "var(--gold)" }} />}
            </button>
          );
        })}
      </div>

      {/* staff column headers */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--line)" }}>
        <div style={{ width: 56, flexShrink: 0 }} />
        {staff.map((p) => (
          <div key={p.id} style={{ flex: 1, textAlign: "center", padding: "10px 0", fontSize: 15, color: p.color, fontFamily: FONT_DISPLAY, borderLeft: "1px solid var(--line)" }}>{p.name}</div>
        ))}
      </div>

      {/* the timeline grid */}
      <div style={{ display: "flex", position: "relative" }}>
        {/* time gutter — every 15 min; hours bold, quarters lighter */}
        <div style={{ width: 56, flexShrink: 0, position: "relative", height: gridHeight }}>
          {quarterLines.filter((t) => t < DAY_END).map((t) => { const isHour = t % 60 === 0; return (
            <div key={t} style={{ position: "absolute", top: (t - DAY_START) * PPM, right: 8, fontSize: isHour ? 14 : 11, color: isHour ? "var(--sub)" : "var(--faint)", fontWeight: isHour ? 600 : 400, transform: "translateY(-1px)" }}>
              {isHour ? fmtTime(t).replace(":00", "") : fmtTime(t).replace(/\s?[AP]M/, "")}
            </div>
          ); })}
        </div>

        {/* columns */}
        {staff.map((p) => {
          const col = appts.filter((a) => a.providerId === p.id && sameDay(a.bookedFor, selectedDate));
          return (
            <div key={p.id}
              style={{ flex: 1, position: "relative", height: gridHeight, borderLeft: "1px solid var(--line)" }}>
              {/* tap/long-press layer: tap opens form; long-press shows beige block to scrub time */}
              <div
                onClick={(e) => onSlotClick(e, p.id, e.currentTarget.parentElement)}
                onMouseDown={(e) => onSlotDown(e, p.id, e.currentTarget.parentElement)}
                onMouseMove={onSlotMove}
                onMouseUp={onSlotUp}
                onTouchStart={(e) => onSlotDown(e, p.id, e.currentTarget.parentElement)}
                onTouchMove={onSlotMove}
                onTouchEnd={onSlotUp}
                style={{ position: "absolute", inset: 0, zIndex: 1 }}
              />
              {/* beige "New Appointment" block shown while long-pressing / scrubbing */}
              {pressInd && pressInd.providerId === p.id && (
                <div style={{ position: "absolute", top: (pressInd.start - DAY_START) * PPM, left: 3, right: 3, height: NEW_DUR * PPM - 2, background: "color-mix(in srgb, var(--gold) 14%, var(--panel))", border: "1.5px solid var(--gold)", borderRadius: 12, padding: "8px 11px", zIndex: 30, pointerEvents: "none", boxShadow: "var(--shadow-md)" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--gold)" }}>{fmtTime(pressInd.start)}</div>
                  <div style={{ fontSize: 13, color: "var(--text2)", fontWeight: 500 }}>New Appointment</div>
                </div>
              )}
              {/* 15-min subdivision lines (faint) + bold hour lines */}
              {quarterLines.map((t) => { const isHour = t % 60 === 0; return (
                <div key={t} style={{ position: "absolute", top: (t - DAY_START) * PPM, left: 0, right: 0, borderTop: isHour ? "1px solid var(--line)" : "1px solid color-mix(in srgb, var(--line) 50%, transparent)", height: 0, pointerEvents: "none" }} />
              ); })}
              {/* appointment blocks */}
              {col.map((a) => {
                const isDragging = drag && drag.id === a.id && drag.armed;
                const liveStart = isDragging ? a.start + drag.deltaMin : a.start;
                const top = (liveStart - DAY_START) * PPM;
                const height = (a.end - a.start) * PPM - 2;
                const service = services.find((s) => s.id === a.serviceId);
                const isBlock = a.status === "block";
                let accent = hexById(service?.color);
                if (a.status === "checked-in") accent = STATUS_COLORS["checked-in"];
                else if (a.status === "in-service") accent = STATUS_COLORS["in-service"];
                const isDone = a.status === "done";
                // soft tinted background with a colored accent bar — clean & legible
                const tint = `color-mix(in srgb, ${accent} 14%, var(--panel))`;
                const onColor = "var(--text)";
                const blockBg = "repeating-linear-gradient(45deg, var(--panel2), var(--panel2) 7px, var(--line) 7px, var(--line) 14px)";
                return (
                  <div key={a.id} data-appt
                    onClick={() => { const d = dragRef.current; if (d && (d.didDrag || d.scrolled)) return; setOpen(a); }}
                    onMouseDown={(e) => startDrag(e, a)} onTouchStart={(e) => startDrag(e, a)}
                    className={isDragging ? "" : "lift"}
                    style={{ position: "absolute", top, left: 3, right: 3, height, background: isBlock ? blockBg : (isDone ? "var(--panel2)" : tint), opacity: isDone ? 0.7 : 1, border: `1px solid ${isBlock ? "var(--border)" : `color-mix(in srgb, ${accent} 30%, var(--border))`}`, borderLeft: `4px solid ${isBlock ? "var(--border2)" : (isDone ? "var(--border2)" : accent)}`, borderRadius: 12, padding: height > 40 ? "7px 10px" : "4px 10px", color: onColor, textAlign: "left", overflow: "hidden", display: "flex", flexDirection: "column", gap: 2, cursor: "grab", touchAction: "pan-y", userSelect: "none", zIndex: isDragging ? 40 : 1, boxShadow: isDragging ? "var(--shadow-lg)" : "none", transition: isDragging ? "none" : "box-shadow .15s var(--ease)" }}>
                    {/* name — always one line, never wraps or collides */}
                    <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 18 }}>{a.name}</span>
                    {/* time range — shown once room exists */}
                    {height > 34 && <span style={{ fontSize: 12, color: "var(--sub)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fmtTime(liveStart)} – {fmtTime(liveStart + (a.end - a.start))}</span>}
                    {/* service name */}
                    {height > 58 && <div style={{ fontSize: 12.5, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.title}</div>}
                    {/* add-on detail only on tall blocks */}
                    {height > 84 && a.detail && <div style={{ fontSize: 12, color: "var(--sub)", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{a.detail}</div>}
                    <div style={{ position: "absolute", bottom: 5, right: 6, display: "flex", gap: 5, alignItems: "center", color: "var(--sub)" }}>
                      {a.hasNote && <Edit2 size={11} style={{ opacity: 0.7 }} />}
                      {a.hasPhotos && <ImageIcon size={12} style={{ opacity: 0.7 }} />}
                      {a.vip && <span style={{ fontSize: 13, color: accent }}>★</span>}
                    </div>
                    {/* subtle end-of-appointment marker: hairline at the bottom edge + end time */}
                    {!isBlock && height > 28 && (
                      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, borderBottom: `1.5px solid color-mix(in srgb, ${accent} 55%, transparent)`, pointerEvents: "none" }}>
                        <span style={{ position: "absolute", right: 6, bottom: 2, fontSize: 9.5, fontWeight: 600, letterSpacing: 0.3, color: `color-mix(in srgb, ${accent} 75%, var(--text))`, opacity: 0.75 }}>{fmtTime(liveStart + (a.end - a.start)).replace(/\s?[AP]M/, "")}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <p style={{ color: "var(--faint)", fontSize: 14, marginTop: 16, textAlign: "center" }}>Tap an appointment to check in, notify, or complete · drag it up or down to move it. ★ regular · ✎ note · ▱ photos.</p>

      {/* drag-to-move confirmation — pinned so it's always visible on drop */}
      {/* WAITLIST MATCH — a freed slot matches waitlisted clients; confirm to notify */}
      {waitlistMatch && (
        <div className="fade-in" onClick={() => setWaitlistMatch(null)} style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--overlay)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 440, maxHeight: "85vh", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 20, padding: 22, boxShadow: "0 18px 50px var(--shadow)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><Bell size={20} style={{ color: "var(--gold)" }} /><div style={{ fontFamily: FONT_DISPLAY, fontSize: 22 }}>A slot just opened</div></div>
            <div style={{ fontSize: 14.5, color: "var(--sub)", marginBottom: 18, lineHeight: 1.45 }}>{fmtTime(waitlistMatch.freed.start)} – {fmtTime(waitlistMatch.freed.end)} is now free. {wlRules.order === "longest" ? "Offer it to the longest-waiting match first?" : `These waitlisted client${waitlistMatch.matches.length > 1 ? "s" : ""} asked for this window — notify them with a link to book?`}</div>
            <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
              {waitlistMatch.matches.map((m, i) => {
                const queued = wlRules.order === "longest" && i > 0;
                return (
                <div key={m.id || i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--panel2)", border: `1px solid ${queued ? "var(--border)" : "var(--gold)"}`, borderRadius: 12, padding: "11px 14px", opacity: queued ? 0.6 : 1 }}>
                  <div><div style={{ fontSize: 15, fontWeight: 600 }}>{m.name}</div><div style={{ fontSize: 13, color: "var(--sub)" }}>{m.service}{m.provider ? ` · ${m.provider}` : ""}</div></div>
                  {wlRules.order === "longest"
                    ? (i === 0 ? <span style={{ fontSize: 12, fontWeight: 600, color: "var(--gold)" }}>FIRST UP</span> : <span style={{ fontSize: 12, color: "var(--faint)" }}>in {(wlRules.delayMin || 30) * i} min</span>)
                    : <Check size={16} style={{ color: "var(--gold)" }} />}
                </div>
              ); })}
            </div>
            <button className="lift" onClick={() => sendWaitlistNotices(waitlistMatch.matches, waitlistMatch.freed)} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 15, fontSize: 15, fontWeight: 600, borderRadius: 12, border: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10 }}><Bell size={17} /> {wlRules.order === "longest" ? `Notify ${waitlistMatch.matches[0].name.split(" ")[0]}` : `Notify ${waitlistMatch.matches.length > 1 ? `all ${waitlistMatch.matches.length}` : waitlistMatch.matches[0].name.split(" ")[0]}`}</button>
            <button onClick={() => setWaitlistMatch(null)} style={{ width: "100%", background: "none", border: "none", color: "var(--sub)", fontSize: 14.5, padding: "10px 0 2px" }}>Not now</button>
          </div>
        </div>
      )}

      {pending && (
        <>
          <div className="fade-in" onClick={() => setPending(null)} style={{ position: "fixed", inset: 0, background: "var(--overlay)", zIndex: 55 }} />
          <div className="fade-in" style={{ position: "fixed", left: 0, right: 0, top: 24, display: "flex", justifyContent: "center", padding: "0 16px", zIndex: 56, boxSizing: "border-box" }}>
            <div style={{ width: "100%", maxWidth: 400, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 18, padding: 22, textAlign: "center", boxShadow: "0 18px 50px var(--shadow)" }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, marginBottom: 6 }}>Move appointment?</div>
              <div style={{ fontSize: 14.5, color: "var(--text2)", lineHeight: 1.5, fontWeight: 300, marginBottom: 4 }}>{pending.appt.name} — {pending.appt.title}</div>
              <div style={{ fontSize: 15, color: "var(--sub)", marginBottom: 18 }}>
                <span style={{ textDecoration: "line-through", opacity: 0.6 }}>{fmtTime(pending.appt.start)}</span>
                <span style={{ margin: "0 8px", color: "var(--gold)" }}>→</span>
                <span style={{ color: "var(--text)", fontWeight: 600 }}>{fmtTime(pending.newStart)} – {fmtTime(pending.newEnd)}</span>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setPending(null)} style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", color: "var(--text)", padding: 14, fontSize: 15, letterSpacing: 1, borderRadius: 12 }}>CANCEL</button>
                <button className="lift" onClick={confirmMove} style={{ flex: 1, background: "var(--gold)", color: "var(--on-gold)", padding: 14, fontSize: 15, letterSpacing: 1, fontWeight: 600, borderRadius: 12 }}>CONFIRM</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* tap-to-create: menu anchored right under the tapped time/spot */}
      {createSlot && (() => {
        const MW = 230;
        const vw = (document.documentElement.clientWidth || window.innerWidth || 390);
        const vh = (document.documentElement.clientHeight || window.innerHeight || 800);
        const tx = (createSlot.x != null ? createSlot.x : vw / 2);
        const ty = (createSlot.y != null ? createSlot.y : vh / 2);
        let left = tx - MW / 2;
        if (left < 8) left = 8;
        if (left + MW > vw - 8) left = Math.max(8, vw - MW - 8);
        const approxH = 190;
        let top = ty + 12;
        if (top + approxH > vh - 8) top = Math.max(8, ty - approxH - 12);
        if (top < 8) top = 8;
        return (
          <>
            <div className="fade-in" onClick={() => setCreateSlot(null)} style={{ position: "fixed", inset: 0, background: "var(--overlay)", zIndex: 55 }} />
            <div style={{ position: "fixed", left, top, width: MW, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 16, padding: 12, zIndex: 56, boxShadow: "var(--shadow-lg)", boxSizing: "border-box", transformOrigin: "top center", animation: "popIn .18s var(--ease) both" }}>
              <div style={{ padding: "2px 4px 10px" }}>
                <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.2 }}>{fmtTime(createSlot.start)}</div>
                <div style={{ fontSize: 12.5, color: "var(--sub)" }}>with {(providers.find((p) => p.id === createSlot.providerId) || {}).name}</div>
              </div>
              <button className="lift" onClick={() => createAt("appt")} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: "var(--gold)", color: "var(--on-gold)", padding: "12px 13px", borderRadius: 11, fontSize: 14, fontWeight: 600, marginBottom: 7, boxSizing: "border-box" }}><Calendar size={16} /> New appointment</button>
              <button className="lift" onClick={() => createAt("block")} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text)", padding: "12px 13px", borderRadius: 11, fontSize: 14, fontWeight: 500, boxSizing: "border-box" }}><Clock size={16} style={{ color: "var(--sub)" }} /> Block off time</button>
            </div>
          </>
        );
      })()}

      {newApptSlot && (
        <NewAppointmentForm
          slot={newApptSlot}
          providers={providers}
          clients={clients}
          services={services}
          onClose={() => setNewApptSlot(null)}
          onBook={bookAppt}
          onBlock={({ providerId, start }) => {
            const id = Math.max(0, ...appts.map((a) => a.id)) + 1;
            setAppts([...appts, { id, providerId, clientId: null, serviceId: null, start, end: start + 30, status: "block", vip: false, name: "Time Block", title: "Blocked", detail: "" }]);
            setNewApptSlot(null);
            showToast(`Time block added at ${fmtTime(start)}.`);
          }}
        />
      )}

      {/* full appointment experience: detail · ••• menu · edit */}
      {open && (
        <AppointmentSheet
          appt={open}
          providers={providers}
          clients={clients}
          services={services}
          business={business}
          onClose={() => setOpen(null)}
          appts={appts}
          onSetStatus={setStatus}
          onCheckout={startCheckout}
          onUpdate={updateAppt}
          onDelete={deleteAppt}
          showToast={showToast}
        />
      )}

      {checkout && (
        <Checkout
          appt={checkout}
          service={services.find((s) => s.id === checkout.serviceId)}
          provider={providers.find((p) => p.id === checkout.providerId)}
          business={business}
          clients={clients}
          setClients={setClients}
          showToast={showToast}
          onClose={() => setCheckout(null)}
          onDone={finishCheckout}
        />
      )}
    </div>
  );
}

// ============================================================
// APPOINTMENT SHEET — full-screen detail · ••• menu · edit
// Bright/clean by default with a light↔dark toggle. Charcoal accent.
// ============================================================
const APPT_STATUSES = [
  { id: "confirmed", label: "Confirmed", dot: "#3FB8AF" },
  { id: "checked-in", label: "Waiting", dot: "#A78BC8" },
  { id: "in-service", label: "In Service", dot: "#E59BB3" },
  { id: "done", label: "Done", dot: "#6FAE72" },
  { id: "unconfirmed", label: "Unconfirmed", dot: "#E0A45E" },
  { id: "no-show", label: "No-show", dot: "#C66B5C" },
  { id: "cancelled", label: "Cancelled", dot: "#888" },
];

// ============================================================
// CHECKOUT — staged card-reader flow: charge → tap → tip → approved → rebook
// ============================================================
function Checkout({ appt, service, provider, business, clients, setClients, showToast, onClose, onDone }) {
  // ---- auto-timing: measure actual service time, round UP to next 5 ----
  const measuredMin = appt.serviceStartedAt ? Math.round((Date.now() - appt.serviceStartedAt) / 60000) : null;
  const roundUp5 = (m) => Math.max(5, Math.ceil(m / 5) * 5);
  const suggestedMin = measuredMin != null ? roundUp5(measuredMin) : null;
  const liveClient = clients ? clients.find((c) => c.id === appt.clientId) : null;
  const currentDur = liveClient && service ? (liveClient.customDurations && liveClient.customDurations[service.id] != null ? liveClient.customDurations[service.id] : service.duration) : null;
  // only worth suggesting if we measured something sane and it differs from what's stored
  const tooLong = measuredMin != null && measuredMin > 180; // likely forgot to check out
  const showDurationSuggest = (business?.autoTiming?.enabled !== false) && suggestedMin != null && !tooLong && liveClient && service && suggestedMin !== currentDur;
  const [adjustMin, setAdjustMin] = useState(suggestedMin);
  const saveDuration = (val) => {
    if (!liveClient || !service) return;
    setClients(clients.map((c) => c.id === liveClient.id ? { ...c, customDurations: { ...(c.customDurations || {}), [service.id]: val } } : c));
    if (showToast) showToast(`Saved — ${service.name} now books at ${val} min for ${liveClient.name.split(" ")[0]}.`);
  };
  const tipCfg = business?.tipping || { enabled: true, presets: [18, 20, 25], allowCustom: true, allowNoTip: true, smartDefault: 20 };
  const rebookCfg = business?.rebook || { enabled: true, discountEnabled: true, discountType: "amount", discount: 5, weeks: [2, 3, 4, 6, 8] };
  // Rhythm intelligence: the client's real cadence → recommended rebook week (nearest offered option).
  const cadenceDays = liveClient?.cadenceDays || null;
  const rhythmWeek = cadenceDays ? rebookCfg.weeks.reduce((best, w) => Math.abs(w * 7 - cadenceDays) < Math.abs(best * 7 - cadenceDays) ? w : best, rebookCfg.weeks[0]) : null;
  const base = service?.price || appt.price || 0;
  const [stage, setStage] = useState("review"); // review → reader → tip → approving → approved → rebook → done
  const [tipPct, setTipPct] = useState(tipCfg.smartDefault ?? tipCfg.presets[0]);
  const [customTip, setCustomTip] = useState(null);
  const [rebookWeeks, setRebookWeeks] = useState(null);
  const [customDate, setCustomDate] = useState(null); // ISO date string when picked manually
  const tipAmt = customTip != null ? customTip : +(base * tipPct / 100).toFixed(2);
  const total = +(base + tipAmt).toFixed(2);
  const money = (n) => `$${n.toFixed(2)}`;
  const discountOn = rebookCfg.discountEnabled !== false && (rebookCfg.discount || 0) > 0;
  const discLabel = rebookCfg.discountType === "percent" ? `${rebookCfg.discount}%` : money(rebookCfg.discount);

  const tapCard = () => { setStage("reader"); setTimeout(() => setStage(tipCfg.enabled ? "tip" : "approving"), 1700); };
  const confirmTip = () => { setStage("approving"); setTimeout(() => setStage("approved"), 1400); };
  useEffect(() => {
    if (stage === "approved") { const t = setTimeout(() => setStage(showDurationSuggest ? "duration" : (rebookCfg.enabled ? "rebook" : "done")), 1300); return () => clearTimeout(t); }
    if (stage === "rebook" && rhythmWeek != null && rebookWeeks == null && !customDate) { setRebookWeeks(rhythmWeek); }
    if (stage === "done") { const t = setTimeout(() => onDone(appt.id, { total, totalLabel: money(total), tip: tipAmt, rebookWeeks, rebookDate: customDate, rebookLabel: hasSelection ? selectionLabel : null }), 1200); return () => clearTimeout(t); }
  }, [stage]);

  const rebookDate = (weeks) => { const d = new Date(); d.setDate(d.getDate() + weeks * 7); return d; };
  const fmtRebook = (weeks) => { const d = rebookDate(weeks); return `${DAYS_SHORT[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; };
  const fmtCustom = (iso) => { const d = new Date(iso + "T00:00:00"); return `${DAYS_SHORT[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; };
  const hasSelection = rebookWeeks != null || customDate != null;
  const selectionLabel = customDate ? fmtCustom(customDate) : (rebookWeeks != null ? fmtRebook(rebookWeeks) : "");

  const sheet = (inner, dismissable, top = true) => (
    <div className="fade-in" onClick={dismissable ? onClose : undefined} style={{ position: "fixed", inset: 0, background: "var(--overlay)", zIndex: 60, display: "flex", alignItems: top ? "flex-start" : "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className={top ? "appt-drop" : ""} style={{ background: "var(--bg)", borderBottomLeftRadius: 24, borderBottomRightRadius: 24, borderTopLeftRadius: top ? 0 : 24, borderTopRightRadius: top ? 0 : 24, width: "100%", maxWidth: 480, maxHeight: "92vh", overflowY: "auto", boxShadow: top ? "0 20px 60px var(--shadow)" : "0 -20px 60px var(--shadow)" }}>
        {!top && <div style={{ display: "flex", justifyContent: "center", paddingTop: 10 }}><div style={{ width: 38, height: 4, borderRadius: 4, background: "var(--border2)" }} /></div>}
        {inner}
        {top && <div style={{ display: "flex", justifyContent: "center", paddingBottom: 10 }}><div style={{ width: 38, height: 4, borderRadius: 4, background: "var(--border2)" }} /></div>}
      </div>
    </div>
  );

  if (stage === "review") return sheet(
    <div style={{ padding: "20px 24px 32px" }}>
      <div style={{ fontSize: 12, letterSpacing: 2.5, color: "var(--faint)", marginBottom: 8, fontWeight: 500 }}>CHECKOUT</div>
      <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 500, letterSpacing: -0.5, marginBottom: 4 }}>{appt.name || "Walk-in"}</h2>
      <p style={{ color: "var(--sub)", fontSize: 15, marginBottom: 24, fontWeight: 300 }}>{service?.name || appt.title} with {provider?.name}</p>
      <div style={{ background: "var(--panel)", borderRadius: 18, border: "1px solid var(--line)", boxShadow: "var(--shadow-sm)", padding: "6px 18px", marginBottom: 24 }}>
        <CheckoutRow label={service?.name || appt.title} val={money(base)} />
        <div style={{ borderTop: "1px solid var(--line)" }}><CheckoutRow label="Total due" val={money(base)} bold /></div>
      </div>
      <button className="lift" onClick={tapCard} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "var(--gold)", color: "var(--on-gold)", padding: 17, fontSize: 15, letterSpacing: 1, fontWeight: 600, borderRadius: 14, boxShadow: "var(--shadow-md)" }}><CreditCard size={18} /> CHARGE CARD</button>
      <button onClick={onClose} style={{ width: "100%", background: "transparent", color: "var(--sub)", padding: 14, fontSize: 14, letterSpacing: 1, marginTop: 6 }}>CANCEL</button>
    </div>
  , true, true);

  if (stage === "reader") return sheet(
    <div style={{ padding: "56px 28px 64px", textAlign: "center" }}>
      <div style={{ position: "relative", width: 96, height: 96, margin: "0 auto 28px" }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "color-mix(in srgb, var(--gold) 14%, transparent)", animation: "pulse 1.6s var(--ease) infinite" }} />
        <div style={{ position: "absolute", inset: 16, borderRadius: "50%", background: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center" }}><CreditCard size={32} style={{ color: "var(--on-gold)" }} /></div>
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 500, marginBottom: 8 }}>Insert or tap card</div>
      <p style={{ color: "var(--sub)", fontSize: 15.5, fontWeight: 300, marginBottom: 4 }}>{money(base)} — waiting for card…</p>
      <p style={{ color: "var(--faint)", fontSize: 13, marginTop: 18 }}>Simulated reader · advancing automatically</p>
    </div>
  , false, true);

  if (stage === "tip") return sheet(
    <div style={{ padding: "24px 24px 32px" }}>
      <div style={{ fontSize: 12, letterSpacing: 2.5, color: "var(--faint)", marginBottom: 8, fontWeight: 500, textAlign: "center" }}>CARD READ · ADD A TIP</div>
      <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 500, textAlign: "center", marginBottom: 4 }}>Add a tip?</h2>
      <p style={{ color: "var(--sub)", fontSize: 15, textAlign: "center", marginBottom: 24, fontWeight: 300 }}>{service?.name || appt.title} · {money(base)}</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {tipCfg.presets.map((p) => { const on = customTip == null && tipPct === p; return (
          <button key={p} onClick={() => { setCustomTip(null); setTipPct(p); }} style={{ flex: 1, padding: "18px 4px", borderRadius: 16, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "var(--gold)" : "var(--panel)", color: on ? "var(--on-gold)" : "var(--text)", textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{p}%</div>
            <div style={{ fontSize: 13, color: on ? "var(--on-gold)" : "var(--sub)", marginTop: 3 }}>{money(+(base * p / 100).toFixed(2))}</div>
          </button>
        ); })}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {tipCfg.allowCustom && <button onClick={() => { const v = prompt("Custom tip amount ($)"); if (v != null) setCustomTip(Math.max(0, parseFloat(v) || 0)); }} style={{ flex: 1, padding: "13px 4px", borderRadius: 12, border: `1px solid ${customTip != null && customTip !== 0 ? "var(--gold)" : "var(--border)"}`, background: customTip != null && customTip !== 0 ? "color-mix(in srgb, var(--gold) 12%, transparent)" : "var(--panel)", color: customTip != null && customTip !== 0 ? "var(--gold)" : "var(--text)", fontSize: 14 }}>{customTip != null && customTip !== 0 ? `Custom · ${money(customTip)}` : "Custom"}</button>}
        {tipCfg.allowNoTip && <button onClick={() => setCustomTip(0)} style={{ flex: 1, padding: "13px 4px", borderRadius: 12, border: `1px solid ${customTip === 0 ? "var(--gold)" : "var(--border)"}`, background: customTip === 0 ? "color-mix(in srgb, var(--gold) 12%, transparent)" : "var(--panel)", color: customTip === 0 ? "var(--gold)" : "var(--sub)", fontSize: 14 }}>No tip</button>}
      </div>
      <button className="lift" onClick={confirmTip} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 17, fontSize: 15, letterSpacing: 1, fontWeight: 600, borderRadius: 14, boxShadow: "var(--shadow-md)" }}>{tipAmt > 0 ? `TIP ${money(tipAmt)} · TOTAL ${money(total)}` : `CONTINUE · ${money(total)}`}</button>
    </div>
  );

  if (stage === "approving" || stage === "approved") return sheet(
    <div style={{ padding: "64px 28px 72px", textAlign: "center" }}>
      {stage === "approving" ? (
        <>
          <div style={{ width: 72, height: 72, borderRadius: "50%", border: "3px solid var(--line)", borderTopColor: "var(--gold)", margin: "0 auto 24px", animation: "spin .8s linear infinite" }} />
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 500 }}>Approving…</div>
        </>
      ) : (
        <div className="fade-in">
          <div style={{ width: 88, height: 88, borderRadius: "50%", background: "#3FA968", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px", animation: "popIn .4s var(--ease) both" }}><Check size={44} style={{ color: "#fff" }} strokeWidth={3} /></div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 500, marginBottom: 6 }}>Approved</div>
          <p style={{ color: "var(--sub)", fontSize: 16, fontWeight: 300 }}>{money(total)} charged</p>
        </div>
      )}
    </div>
  );

  if (stage === "duration") return sheet(
    <div style={{ padding: "28px 24px 32px" }}>
      <div style={{ textAlign: "center", marginBottom: 22 }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "color-mix(in srgb, var(--gold) 14%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><Clock size={26} style={{ color: "var(--gold)" }} /></div>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 500, letterSpacing: -0.3, marginBottom: 8, lineHeight: 1.15 }}>That took {measuredMin} min</h2>
        <p style={{ color: "var(--sub)", fontSize: 15, fontWeight: 300, lineHeight: 1.5 }}>Save <strong style={{ color: "var(--gold)" }}>{adjustMin} min</strong> as {(liveClient?.name || "this client").split(" ")[0]}'s time for {service?.name}? It books faster next time.</p>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 24 }}>
        <button onClick={() => setAdjustMin((m) => Math.max(5, m - 5))} style={{ width: 44, height: 44, borderRadius: "50%", border: "1px solid var(--border2)", background: "var(--panel)", color: "var(--text)", fontSize: 22 }}>−</button>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 34, minWidth: 90, textAlign: "center" }}>{adjustMin} min</div>
        <button onClick={() => setAdjustMin((m) => m + 5)} style={{ width: 44, height: 44, borderRadius: "50%", border: "1px solid var(--border2)", background: "var(--panel)", color: "var(--text)", fontSize: 22 }}>+</button>
      </div>
      <button className="lift" onClick={() => { saveDuration(adjustMin); setStage(rebookCfg.enabled ? "rebook" : "done"); }} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 16, fontSize: 14, letterSpacing: 1.5, fontWeight: 600, borderRadius: 12, border: "none", marginBottom: 12 }}>SAVE {adjustMin} MIN</button>
      <button onClick={() => setStage(rebookCfg.enabled ? "rebook" : "done")} style={{ width: "100%", background: "none", border: "none", color: "var(--sub)", fontSize: 15, padding: 6 }}>Discard — keep current time</button>
    </div>
  , false);

  if (stage === "rebook") return sheet(
    <div style={{ padding: "28px 24px 32px" }}>
      <div style={{ textAlign: "center", marginBottom: 26 }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "color-mix(in srgb, var(--gold) 14%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><Repeat size={26} style={{ color: "var(--gold)" }} /></div>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 27, fontWeight: 500, letterSpacing: -0.3, marginBottom: 8, lineHeight: 1.15 }}>{discountOn ? `Save ${discLabel} by rebooking now?` : "Book the next visit?"}</h2>
        <p style={{ color: "var(--sub)", fontSize: 15, fontWeight: 300 }}>{discountOn ? `Lock in ${appt.name ? appt.name.split(" ")[0] : "the next visit"}'s next ${service?.name || "appointment"} and take ${discLabel} off.` : `Lock in ${appt.name ? appt.name.split(" ")[0] : "the next visit"}'s next ${service?.name || "appointment"} before they head out.`}</p>
      </div>
      <div style={{ fontSize: 12, letterSpacing: 1.5, color: "var(--faint)", marginBottom: 10 }}>WHEN?</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 12 }}>
        {rebookCfg.weeks.map((w) => { const on = rebookWeeks === w && !customDate; const isRhythm = w === rhythmWeek; return (
          <button key={w} onClick={() => { setRebookWeeks(w); setCustomDate(null); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px", borderRadius: 14, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "color-mix(in srgb, var(--gold) 10%, transparent)" : "var(--panel)", color: "var(--text)", textAlign: "left" }}>
            <div><div style={{ fontSize: 16, fontWeight: 600 }}>{w} weeks</div><div style={{ fontSize: 13, color: isRhythm ? "var(--gold)" : "var(--sub)", marginTop: 2 }}>{isRhythm ? `${appt.name ? appt.name.split(" ")[0] + "'s" : "their"} usual rhythm` : fmtRebook(w)}</div></div>
            {on && <Check size={18} style={{ color: "var(--gold)" }} />}
          </button>
        ); })}
      </div>
      {/* custom date — opens the device calendar/date picker */}
      <label style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px", borderRadius: 14, border: `1px solid ${customDate ? "var(--gold)" : "var(--border)"}`, background: customDate ? "color-mix(in srgb, var(--gold) 10%, transparent)" : "var(--panel)", color: "var(--text)", marginBottom: 22, cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Calendar size={19} style={{ color: "var(--gold)" }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{customDate ? fmtCustom(customDate) : "Pick a custom date"}</div>
            <div style={{ fontSize: 13, color: "var(--sub)", marginTop: 2 }}>{customDate ? "Tap to change" : "Open the calendar"}</div>
          </div>
        </div>
        {customDate ? <Check size={18} style={{ color: "var(--gold)" }} /> : <ChevronRight size={18} style={{ color: "var(--faint)" }} />}
        <input type="date" value={customDate || ""} min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} onChange={(e) => { if (e.target.value) { setCustomDate(e.target.value); setRebookWeeks(null); } }} style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
      </label>
      <button className="lift" disabled={!hasSelection} onClick={() => setStage("done")} style={{ width: "100%", background: !hasSelection ? "var(--panel2)" : "var(--gold)", color: !hasSelection ? "var(--faint)" : "var(--on-gold)", padding: 16, fontSize: 15, letterSpacing: 1, fontWeight: 600, borderRadius: 14, boxShadow: !hasSelection ? "none" : "var(--shadow-md)" }}>{!hasSelection ? "PICK A TIME" : (discountOn ? `BOOK ${selectionLabel} · SAVE ${discLabel}` : `BOOK ${selectionLabel}`)}</button>
      {hasSelection && <p style={{ color: "var(--faint)", fontSize: 12.5, lineHeight: 1.5, textAlign: "center", marginTop: 10 }}>{discountOn ? `Nothing is charged today — the ${discLabel} is taken off when they come in. ` : "Nothing is charged today. "}We'll send the confirmation and reminders automatically.</p>}
      <button onClick={() => { setRebookWeeks(null); setCustomDate(null); setStage("done"); }} style={{ width: "100%", background: "transparent", color: "var(--sub)", padding: 14, fontSize: 14, letterSpacing: 1, marginTop: 4 }}>NO THANKS</button>
    </div>
  );

  return sheet(
    <div className="fade-in" style={{ padding: "56px 28px 64px", textAlign: "center" }}>
      <div style={{ width: 72, height: 72, borderRadius: "50%", background: "color-mix(in srgb, var(--gold) 16%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px" }}><Check size={34} style={{ color: "var(--gold)" }} /></div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 500, marginBottom: 8 }}>All done</div>
      <p style={{ color: "var(--sub)", fontSize: 15.5, fontWeight: 300 }}>{money(total)} charged for today’s visit · receipt sent to {appt.name || "the client"}.</p>

      {hasSelection && (
        <div style={{ marginTop: 24, textAlign: "left", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 18, boxShadow: "var(--shadow-sm)", padding: "18px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <Repeat size={18} style={{ color: "var(--gold)" }} />
            <div style={{ fontSize: 15.5, fontWeight: 600 }}>Rebooked · {selectionLabel}</div>
          </div>
          {[
            [Check, `Confirmation sent to ${appt.name ? appt.name.split(" ")[0] : "client"} now`],
            [Bell, "Reminders will go out automatically before the visit"],
            [DollarSign, `${money(rebookCfg.discount)} comes off at that visit — nothing charged today`],
          ].map(([Ico, txt], i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "6px 0" }}>
              <Ico size={15} style={{ color: "var(--sub)", marginTop: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.45 }}>{txt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function CheckoutRow({ label, val, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0" }}>
      <span style={{ fontSize: bold ? 17 : 15, fontWeight: bold ? 600 : 400, color: bold ? "var(--text)" : "var(--text2)" }}>{label}</span>
      <span style={{ fontSize: bold ? 19 : 15, fontWeight: bold ? 700 : 500, fontFamily: bold ? FONT_DISPLAY : FONT_BODY }}>{val}</span>
    </div>
  );
}

function AppointmentSheet({ appt, appts, providers, clients, services, business, onClose, onSetStatus, onCheckout, onUpdate, onDelete, showToast }) {
  const [mode, setMode] = useState("detail"); // detail | edit
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollTopRef = useRef(null);
  useEffect(() => {
    let raf1, raf2;
    const reset = () => { if (scrollTopRef.current) scrollTopRef.current.scrollTop = 0; };
    raf1 = requestAnimationFrame(() => { reset(); raf2 = requestAnimationFrame(reset); });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [appt.id, mode]);
  // Lock the page behind to the top so the fixed full-screen sheet sits at the very top (mobile Safari fix)
  useEffect(() => {
    const y = window.scrollY;
    window.scrollTo(0, 0);
    document.body.style.position = "fixed";
    document.body.style.top = "0";
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    return () => {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";
      window.scrollTo(0, y);
    };
  }, []);
  const provider = providers.find((p) => p.id === appt.providerId) || providers[1];
  const client = clients.find((c) => c.id === appt.clientId);
  const service = services.find((s) => s.id === appt.serviceId);
  const dur = appt.end - appt.start;

  // ---- theme tokens: read straight from the active app theme ----
  const T = {
    bg: "var(--bg)", panel: "var(--panel)", line: "var(--line)", text: "var(--text)", sub: "var(--sub)",
    faint: "var(--faint)", chip: "var(--panel2)", accent: "var(--gold)", accentText: "var(--on-gold)",
    topbar: "var(--panel)", overlay: "var(--overlay)", danger: "#C2563F",
  };

  const status = APPT_STATUSES.find((s) => s.id === appt.status) || APPT_STATUSES[0];
  const initials = appt.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const fmtBookDate = "Booked online · confirmed by text";

  // edit-mode local draft
  const [draftStart, setDraftStart] = useState(appt.start);
  const [draftDur, setDraftDur] = useState(dur);
  const [draftProvider, setDraftProvider] = useState(appt.providerId);
  const [draftNote, setDraftNote] = useState(appt.note || "");
  const startEdit = () => { setDraftStart(appt.start); setDraftDur(appt.end - appt.start); setDraftProvider(appt.providerId); setDraftNote(appt.note || ""); setMode("edit"); setMenuOpen(false); };
  const saveEdit = () => { onUpdate(appt.id, { start: draftStart, end: draftStart + draftDur, providerId: draftProvider, note: draftNote }); showToast("Appointment updated."); setMode("detail"); };

  const staff = providers.filter((p) => p.id !== "anyone");

  // ---- "running late" prompt ----
  // The next client for this provider: the soonest later appointment that's
  // still upcoming (confirmed) or already waiting (checked-in).
  const nextClient = (appts || [])
    .filter((a) => a.providerId === appt.providerId && a.id !== appt.id && a.start >= appt.start && (a.status === "confirmed" || a.status === "checked-in") && a.status !== "block")
    .sort((a, b) => a.start - b.start)[0];
  const nextIsWaiting = nextClient && nextClient.status === "checked-in";
  const [lateOpen, setLateOpen] = useState(false);
  const sendRunningLate = (range) => {
    if (nextClient) onUpdate(nextClient.id, { lateNotified: range });
    setLateOpen(false);
    const rl = (business && business.runningLate) || {};
    if (rl.message && nextClient) {
      const filled = rl.message
        .replace(/\{client\}/g, (nextClient.name || "there").split(" ")[0])
        .replace(/\{provider\}/g, provider.name)
        .replace(/\{shop\}/g, (business && business.name) || "the shop")
        .replace(/\{range\}/g, range);
      showToast(`Sent to ${nextClient.name}: "${filled}"`);
    } else {
      showToast(nextClient ? `In-app notice sent to ${nextClient.name}: running ${range} min behind.` : `Running-late notice sent.`);
    }
  };

  // small building blocks
  const TopBar = ({ left, title, right }) => (
    <div style={{ background: T.topbar, borderBottom: `1px solid ${T.line}`, padding: "16px 18px calc(16px)", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 5 }}>
      <div style={{ minWidth: 70 }}>{left}</div>
      <div style={{ fontSize: 17, fontWeight: 600, color: T.text }}>{title}</div>
      <div style={{ minWidth: 70, display: "flex", justifyContent: "flex-end", gap: 14, alignItems: "center" }}>{right}</div>
    </div>
  );

  const Cell = ({ label, value }) => (
    <div style={{ flex: 1, padding: "16px 18px" }}>
      <span style={{ fontSize: 14, color: T.sub, fontStyle: "italic", marginRight: 8 }}>{label}</span>
      <span style={{ fontSize: 17, color: T.text, fontWeight: 500 }}>{value}</span>
    </div>
  );

  return (
    <Portal>
    <div className="appt-screen-fixed" style={{ position: "fixed", inset: 0, zIndex: 800, background: T.bg, display: "flex", flexDirection: "column", color: T.text, fontFamily: FONT_BODY }}>
      <div style={{ width: "100%", maxWidth: 540, margin: "0 auto", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {mode === "detail" ? (
          <>
            <TopBar
              left={<button onClick={onClose} style={{ background: "none", color: T.text, display: "flex", alignItems: "center", gap: 2, fontSize: 15 }}><ChevronLeft size={22} /></button>}
              title="Appointment"
              right={<>
                <button onClick={() => setMenuOpen((v) => !v)} style={{ background: "none", color: T.text }}><MoreHorizontal size={22} /></button>
                <button onClick={startEdit} style={{ background: "none", color: T.sub, fontSize: 15, fontWeight: 600 }}>Edit</button>
              </>}
            />

            <div ref={scrollTopRef} style={{ overflowY: "auto", flex: 1 }}>
              {/* status + check-in */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px", borderBottom: `1px solid ${T.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 13, height: 13, borderRadius: "50%", background: status.dot }} />
                  <span style={{ fontSize: 18, fontWeight: 600 }}>{status.label}</span>
                </div>
                {appt.status === "confirmed" && <button className="lift" onClick={() => onSetStatus(appt.id, "checked-in", `${appt.name} checked in.`)} style={{ border: `1.5px solid ${T.line}`, color: T.text, background: "none", padding: "11px 22px", borderRadius: 30, fontSize: 15, letterSpacing: 1, fontWeight: 600 }}>CHECK-IN</button>}
                {appt.status === "checked-in" && <button className="lift" onClick={() => { const wr = (business && business.waitingRoom) || {}; const tmpl = wr.readyMessage || "{provider} is ready for you and will meet you in front."; const msg = wr.autoReadyMessage === false ? `${appt.name} marked in service.` : `Sent: "${tmpl.replace(/\{provider\}/g, provider.name)}"`; onSetStatus(appt.id, "in-service", msg); }} style={{ background: T.accent, color: T.accentText, padding: "11px 18px", borderRadius: 30, fontSize: 15, letterSpacing: 0.5, fontWeight: 600, border: "none" }}>NOTIFY · READY</button>}
                {appt.status === "in-service" && <button className="lift" onClick={() => onCheckout(appt)} style={{ background: T.accent, color: T.accentText, padding: "11px 22px", borderRadius: 30, fontSize: 15, letterSpacing: 1, fontWeight: 600, border: "none" }}>COMPLETE & CHECKOUT</button>}
              </div>

              {/* RUNNING LATE — shows when in service and there's a next client (moved up for visibility) */}
              {appt.status === "in-service" && nextClient && ((business && business.runningLate ? business.runningLate.enabled !== false : true)) && (
                <div style={{ padding: "16px 18px", borderBottom: `1px solid ${T.line}`, background: "rgba(176,141,87,0.08)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <Clock size={18} style={{ color: T.accent, marginTop: 2, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15.5, fontWeight: 600, color: T.text }}>{(business?.runningLate?.thresholdMin) || 5} min left in this appointment</div>
                      <div style={{ fontSize: 14, color: T.sub, marginTop: 2, lineHeight: 1.45 }}>{nextIsWaiting ? `${nextClient.name} has already checked in.` : `${nextClient.name} is up next at ${fmtTime(nextClient.start)}.`} Want to let them know you're running late?</div>
                      {nextClient.lateNotified ? (
                        <div style={{ marginTop: 10, fontSize: 13.5, color: T.accent, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}><Check size={15} /> Notified · running {nextClient.lateNotified} min behind</div>
                      ) : (
                        <button className="lift" onClick={() => setLateOpen(true)} style={{ marginTop: 10, background: T.accent, color: T.accentText, padding: "9px 18px", borderRadius: 24, fontSize: 14, letterSpacing: 0.5, fontWeight: 600, border: "none" }}>LET THEM KNOW</button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* CHAIR-SIDE BRIEFING — full client story on check-in/in-service */}
              {(appt.status === "checked-in" || appt.status === "in-service") && client && (() => {
                const g = (client.gallery || []);
                const lastCut = g.length ? g[g.length - 1] : null;
                const lastDur = client.customDurations && appt.serviceId ? client.customDurations[appt.serviceId] : null;
                const daysAgo = lastCut ? Math.round((Date.now() - new Date(lastCut.date)) / 86400000) : (client.lastVisit ? Math.round((Date.now() - new Date(client.lastVisit)) / 86400000) : null);
                const visits = client.visits || 0;
                const cadence = client.cadenceDays || null;
                const first = (client.name || "").split(" ")[0] || "They";
                // VIP / loyalty flags
                const flags = [];
                if (visits >= 10) flags.push("one of your regulars");
                if (client.tipsWell) flags.push("tips well");
                if (cadence && daysAgo != null && daysAgo > cadence + 7) flags.push("overdue — worth a rebook nudge");
                // Build a warm, natural briefing line from real data (template-based; AI layer is phase 2)
                const bits = [];
                bits.push(`${first} is in for ${appt.title || (service && service.name) || "a visit"}`);
                if (lastDur) bits.push(`usually runs about ${lastDur} min`);
                if (visits) bits.push(`${visits}${visits === 1 ? "st" : ""} visit${visits === 1 ? "" : "s"} with you`);
                if (flags.length) bits.push(flags.join(", "));
                const briefing = bits.join(" · ");
                if (!lastCut && !client.notes && !lastDur && !visits) return null;
                return (
                  <div style={{ padding: "16px 18px", borderBottom: `1px solid ${T.line}`, background: "rgba(122,158,159,0.08)" }}>
                    <div style={{ fontSize: 11.5, letterSpacing: 1.5, color: T.sub, fontWeight: 600, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}><Sparkles size={13} style={{ color: "var(--gold)" }} /> THE BRIEFING</div>
                    {/* the concierge whisper */}
                    <div style={{ fontSize: 14.5, color: T.text, lineHeight: 1.5, marginBottom: 14, fontStyle: "italic" }}>{briefing}.</div>
                    <div style={{ display: "flex", gap: 12 }}>
                      {lastCut && <div style={{ width: 64, height: 64, borderRadius: 12, overflow: "hidden", flexShrink: 0, background: T.chip }}><img src={imgUrl(lastCut.photo, 200)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /></div>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {lastCut && <div style={{ fontSize: 14.5, color: T.text, fontWeight: 500, marginBottom: 2 }}>{lastCut.note || "Last visit"}</div>}
                        {daysAgo != null && <div style={{ fontSize: 13, color: T.faint, marginBottom: client.notes ? 6 : 0 }}>{daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : `${daysAgo} days ago`}{cadence ? ` · comes every ~${cadence} days` : ""}</div>}
                        {client.notes && <div style={{ fontSize: 13.5, color: T.sub, lineHeight: 1.45 }}>{client.notes}</div>}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* on / at */}
              <div style={{ display: "flex", borderBottom: `1px solid ${T.line}` }}>
                <Cell label="On" value={apptDateLabel()} />
                <div style={{ width: 1, background: T.line }} />
                <Cell label="At" value={fmtTime(appt.start)} />
              </div>

              {/* client card */}
              <div style={{ padding: "22px 18px", borderBottom: `1px solid ${T.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 54, height: 54, borderRadius: "50%", background: "var(--border2)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 600, flexShrink: 0 }}>{initials}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, lineHeight: 1.1 }}>{appt.name} {appt.vip && <span style={{ color: status.dot }}>★</span>}</div>
                    <div style={{ fontSize: 15, color: T.sub }}>{client ? `${client.visits} visits` : "New client"}</div>
                  </div>
                  <button onClick={() => showToast("Opening message thread…")} style={{ width: 44, height: 44, borderRadius: 10, border: `1px solid ${T.line}`, background: "none", color: T.text, display: "flex", alignItems: "center", justifyContent: "center" }}><MessageSquare size={18} /></button>
                </div>
                {/* client's global note shows prominently when viewing an appointment */}
                {client && client.notes && (
                  <div style={{ marginTop: 14, background: "color-mix(in srgb, var(--gold) 10%, var(--panel))", border: "1px solid color-mix(in srgb, var(--gold) 30%, var(--border))", borderRadius: 12, padding: "12px 14px", display: "flex", gap: 10 }}>
                    <AlertCircle size={16} style={{ color: "var(--gold)", flexShrink: 0, marginTop: 1 }} />
                    <div style={{ fontSize: 14, color: T.text, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{client.notes}</div>
                  </div>
                )}
                <div style={{ marginTop: 16, display: "grid", gap: 9 }}>
                  <DetailRow T={T} label="Phone" value={client?.phone ? <PhoneLink number={client.phone} /> : "—"} accent />
                  <DetailRow T={T} label="Email" value={client?.email ? <EmailLink email={client.email} /> : "—"} />
                  <DetailRow T={T} label="Credit" value="Visa  ···7815   Exp 9/30" icon={<CreditCard size={13} style={{ color: T.faint }} />} />
                </div>
              </div>

              {/* service block */}
              <div style={{ padding: "22px 18px", borderBottom: `1px solid ${T.line}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22 }}>{service?.name || appt.title}</span>
                  <span style={{ fontSize: 20, fontWeight: 600 }}>${service?.price ?? "—"}</span>
                </div>
                {appt.detail && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                    {appt.detail.split(",").map((d, i) => (
                      <span key={i} style={{ background: T.chip, color: T.text, padding: "8px 14px", borderRadius: 8, fontSize: 15 }}>{d.trim()}</span>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 15, color: T.sub, lineHeight: 1.9 }}>
                  <span style={{ fontStyle: "italic" }}>with </span><span style={{ color: T.text, fontWeight: 500 }}>{provider.name}</span>
                  <span style={{ fontStyle: "italic" }}>   ·   at </span><span style={{ color: T.text, fontWeight: 500 }}>{fmtTime(appt.start)}</span>
                  <span style={{ fontStyle: "italic" }}>   for </span><span style={{ color: T.text, fontWeight: 500 }}>{dur} min</span>
                </div>
              </div>

              {/* client-uploaded photos */}
              {appt.photos > 0 && (
                <div style={{ padding: "0 18px 20px" }}>
                  <div style={{ fontSize: 15, color: T.sub, letterSpacing: 0.3, marginBottom: 12 }}>Client Photos</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {Array.from({ length: Math.min(3, appt.photos) }).map((_, i) => (
                      <div key={i} style={{ flex: 1, aspectRatio: "1", borderRadius: 8, overflow: "hidden", background: T.chip, border: `1px solid ${T.line}` }}>
                        <img src={imgUrl(ALL_LIBRARY[(appt.id + i) % ALL_LIBRARY.length].id)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: 14, color: T.faint, marginTop: 8 }}>Uploaded by the client when booking.</p>
                </div>
              )}

              {/* booking details */}
              <div style={{ padding: "20px 18px 30px" }}>
                <div style={{ fontSize: 15, color: T.sub, letterSpacing: 0.3, marginBottom: 12 }}>Booking Details</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14.5, color: T.text, marginBottom: 10 }}><Clock size={15} style={{ color: T.faint }} /> Booked Wed, May 20 at 9:02 AM</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14.5, color: T.text }}><User size={15} style={{ color: T.faint }} /> {fmtBookDate}</div>
              </div>
            </div>

            {/* ••• action menu popover */}
            {menuOpen && (
              <>
                <div onClick={() => setMenuOpen(false)} style={{ position: "absolute", inset: 0, zIndex: 8 }} />
                <div className="fade-in" style={{ position: "absolute", top: 56, right: 14, width: 250, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,0.28)", zIndex: 9, overflow: "hidden", padding: "6px 0" }}>
                  <MenuItem T={T} danger icon={<Trash2 size={17} />} label="Cancel / Delete" onClick={() => onDelete(appt.id)} />
                  <MenuItem T={T} icon={<DollarSign size={17} />} label="Checkout" onClick={() => { setMenuOpen(false); showToast("Checkout — coming in the Payments build."); }} />
                  <Divider T={T} />
                  <MenuItem T={T} icon={<Repeat size={17} />} label="Make Repeating" onClick={() => { setMenuOpen(false); showToast("Repeating appointment set up."); }} />
                  <MenuItem T={T} icon={<Copy size={17} />} label="Duplicate / Rebook" onClick={() => { setMenuOpen(false); showToast("Rebooked — duplicate created."); }} />
                  <MenuItem T={T} icon={<Bell size={17} />} label="Resend Notifications" onClick={() => { setMenuOpen(false); showToast("Confirmation re-sent to client."); }} />
                  <Divider T={T} />
                  <div style={{ padding: "6px 16px 4px", fontSize: 13, letterSpacing: 1.2, color: T.faint }}>SET STATUS</div>
                  {APPT_STATUSES.filter((s) => s.id !== "done").map((s) => (
                    <button key={s.id} onClick={() => { onSetStatus(appt.id, s.id, `Marked ${s.label.toLowerCase()}.`); setMenuOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", background: appt.status === s.id ? T.chip : "none", color: T.text, fontSize: 15.5, textAlign: "left" }}>
                      <span style={{ width: 12, height: 12, borderRadius: "50%", background: s.dot }} /> {s.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {lateOpen && (
              <>
                <div onClick={() => setLateOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 810, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "16px 20px 20px", boxSizing: "border-box" }}>
                  <div className="fade-in" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 380, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 18, boxShadow: "0 18px 50px rgba(0,0,0,0.3)", zIndex: 811, padding: 24 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 21, marginBottom: 4 }}>How far behind?</div>
                  <div style={{ fontSize: 14, color: T.sub, marginBottom: 16, lineHeight: 1.45 }}>We'll send {nextClient ? nextClient.name : "your next client"} an in-app notification — no text message.</div>
                  <div style={{ display: "flex", gap: 10 }}>
                    {((business?.runningLate?.ranges) || ["5–10", "10–15"]).map((r) => (
                      <button key={r} className="lift" onClick={() => sendRunningLate(r)} style={{ flex: 1, background: T.chip, border: `1px solid ${T.line}`, color: T.text, padding: "16px 0", borderRadius: 14, fontSize: 16, fontWeight: 600 }}>{r} min</button>
                    ))}
                  </div>
                  <button onClick={() => setLateOpen(false)} style={{ width: "100%", marginTop: 12, background: "none", border: "none", color: T.sub, fontSize: 14.5, padding: 8 }}>Cancel</button>
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          /* ---------- EDIT MODE ---------- */
          <>
            <TopBar
              left={<button onClick={() => setMode("detail")} style={{ background: "none", color: T.sub, fontSize: 15.5 }}>Cancel</button>}
              title="Edit Appointment"
              right={<button onClick={saveEdit} style={{ background: "none", color: T.text, fontSize: 15.5, fontWeight: 700 }}>Save</button>}
            />
            <div style={{ overflowY: "auto", flex: 1 }}>
              {/* on / at editable */}
              <div style={{ display: "flex", borderBottom: `1px solid ${T.line}` }}>
                <Cell label="On" value={apptDateLabel()} />
                <div style={{ width: 1, background: T.line }} />
                <div style={{ flex: 1, padding: "12px 18px" }}>
                  <div style={{ fontSize: 14, color: T.sub, fontStyle: "italic", marginBottom: 6 }}>At</div>
                  <EditStepperRow T={T} value={fmtTime(draftStart)} onDec={() => setDraftStart((v) => Math.max(DAY_START, v - 5))} onInc={() => setDraftStart((v) => Math.min(DAY_END - draftDur, v + 5))} />
                </div>
              </div>

              {/* client card with remove */}
              <div style={{ padding: "20px 18px", borderBottom: `1px solid ${T.line}`, display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 50, height: 50, borderRadius: "50%", background: "var(--border2)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 600 }}>{initials}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 21 }}>{appt.name}</div>
                  <div style={{ fontSize: 15, color: T.sub }}>{client?.phone || "New client"}</div>
                </div>
                <button onClick={() => showToast("Remove client — would clear the booking.")} style={{ background: "none", color: T.faint }}><Trash2 size={19} /></button>
              </div>

              {/* service editable */}
              <div style={{ padding: "20px 18px", borderBottom: `1px solid ${T.line}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 21 }}>{service?.name || appt.title}</span>
                  <button onClick={() => showToast("Remove service.")} style={{ background: "none", color: T.faint }}><Trash2 size={17} /></button>
                </div>
                {appt.detail && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                    {appt.detail.split(",").map((d, i) => (
                      <span key={i} style={{ background: T.chip, color: T.text, padding: "8px 13px", borderRadius: 8, fontSize: 15, display: "flex", alignItems: "center", gap: 7 }}>{d.trim()} <X size={13} style={{ color: T.faint }} /></span>
                    ))}
                    <button onClick={() => showToast("Add an add-on to this service.")} style={{ background: "none", color: T.text, fontSize: 14, fontWeight: 600, padding: "8px 4px" }}>+ Add-on</button>
                  </div>
                )}
                {/* provider picker */}
                <div style={{ fontSize: 15, color: T.sub, fontStyle: "italic", marginBottom: 8 }}>with</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                  {staff.map((p) => (
                    <button key={p.id} onClick={() => setDraftProvider(p.id)} style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: `1.5px solid ${draftProvider === p.id ? T.accent : T.line}`, background: draftProvider === p.id ? T.accent : "none", color: draftProvider === p.id ? T.accentText : T.text, fontSize: 15, fontWeight: draftProvider === p.id ? 600 : 400 }}>{p.name}</button>
                  ))}
                </div>
                {/* duration */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 15, color: T.sub, fontStyle: "italic" }}>for</span>
                  <EditStepperRow T={T} value={`${draftDur} min`} onDec={() => setDraftDur((v) => Math.max(5, v - 5))} onInc={() => setDraftDur((v) => Math.min(240, v + 5))} />
                </div>
              </div>

              {/* add service + note */}
              <button onClick={() => showToast("Add another service to this booking.")} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, padding: "20px", background: "none", color: T.sub, fontSize: 14, letterSpacing: 1, borderBottom: `1px solid ${T.line}` }}><Plus size={17} /> ADD SERVICE</button>
              <div style={{ padding: "18px" }}>
                <textarea value={draftNote} onChange={(e) => setDraftNote(e.target.value)} placeholder="Add a note" rows={3} style={{ width: "100%", background: "none", border: "none", color: T.text, fontSize: 16, fontFamily: FONT_BODY, resize: "vertical", outline: "none" }} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
    </Portal>
  );
}

function DetailRow({ T, label, value, accent, icon }) {
  return (
    <div style={{ display: "flex", gap: 14, fontSize: 15 }}>
      <span style={{ color: T.sub, fontStyle: "italic", minWidth: 58 }}>{label}</span>
      <span style={{ color: accent ? (T.text) : T.text, display: "flex", alignItems: "center", gap: 7, fontWeight: accent ? 500 : 400 }}>{icon}{value}</span>
    </div>
  );
}
function MenuItem({ T, icon, label, onClick, danger }) {
  return (
    <button onClick={onClick} style={{ width: "100%", display: "flex", alignItems: "center", gap: 13, padding: "12px 16px", background: "none", color: danger ? T.danger : T.text, fontSize: 15.5, textAlign: "left" }}>
      {icon} {label}
    </button>
  );
}
function Divider({ T }) { return <div style={{ height: 1, background: T.line, margin: "5px 14px" }} />; }
function EditStepperRow({ T, value, onDec, onInc }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button onClick={onDec} style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${T.line}`, background: "none", color: T.text, fontSize: 19, lineHeight: 1 }}>−</button>
      <span style={{ minWidth: 92, textAlign: "center", fontSize: 17, fontWeight: 500, color: T.text }}>{value}</span>
      <button onClick={onInc} style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${T.line}`, background: "none", color: T.text, fontSize: 19, lineHeight: 1 }}>+</button>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = { confirmed: ["var(--sub)", "rgba(154,149,140,0.12)", "Confirmed"], "checked-in": ["var(--gold)", "rgba(176,141,87,0.14)", "Checked in"], "in-service": ["#7A9E9F", "rgba(122,158,159,0.16)", "In service"], done: ["#5E8C61", "rgba(94,140,97,0.16)", "Done"] };
  const [color, bg, label] = map[status] || map.confirmed;
  return <span style={{ color, background: bg, padding: "5px 12px", borderRadius: 20, fontSize: 14, whiteSpace: "nowrap" }}>{label}</span>;
}
function ActionBtn({ children, onClick, primary }) { return <button className="lift" onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 7, background: primary ? "var(--gold)" : "transparent", color: primary ? "var(--on-gold)" : "var(--text)", border: primary ? "none" : "1px solid var(--border)", padding: "9px 14px", borderRadius: 12, fontSize: 15, fontWeight: primary ? 500 : 400 }}>{children}</button>; }

// Reports — owner dashboard. Computes live from real appointments + service
// prices where possible; trend/retention use representative sample data until
// the backend stores real sales history.
function ReportsView({ appts, clients, providers, services, business }) {
  const [range, setRange] = useState("week"); // today | week | month
  const staff = providers.filter((p) => p.id !== "anyone");
  const money = (n) => "$" + Math.round(n).toLocaleString();
  const priceOf = (a) => { const s = services.find((x) => x.id === a.serviceId); return s ? s.price : 45; };

  // ---- live figures from current appointments ----
  const active = appts.filter((a) => a.status !== "block" && a.status !== "cancelled");
  const todayRevenue = active.reduce((sum, a) => sum + priceOf(a), 0);
  const todayCount = active.length;
  const avgTicket = todayCount ? todayRevenue / todayCount : 0;
  const cancelled = appts.filter((a) => a.status === "cancelled").length;

  // per-staff (live)
  const byStaff = staff.map((p) => {
    const mine = active.filter((a) => a.providerId === p.id);
    return { name: p.name, color: p.color, count: mine.length, revenue: mine.reduce((s, a) => s + priceOf(a), 0) };
  }).sort((a, b) => b.revenue - a.revenue);

  // ---- representative trend (sample — real history needs the backend) ----
  const mult = range === "today" ? 1 : range === "week" ? 6 : 26;
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekTrend = [820, 640, 910, 1180, 1540, 1720, 0].map((v) => Math.round(v * (todayRevenue ? todayRevenue / 700 : 1)));
  const maxTrend = Math.max(...weekTrend, 1);
  const periodRevenue = Math.round(todayRevenue * mult);
  const periodAppts = todayCount * mult;
  const retention90 = 68; // % returning within 90 days (sample)
  const rebookRate = 54;  // % who rebooked on the spot (sample)
  const topServices = [...services].slice(0, 5).map((s, i) => ({ name: s.name, sold: [38, 27, 19, 12, 8][i] || 5, rev: ([38, 27, 19, 12, 8][i] || 5) * (s.price || 40) }));
  const maxSvc = Math.max(...topServices.map((s) => s.rev), 1);

  const Stat = ({ label, value, sub }) => (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "16px 18px", flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, letterSpacing: 1, color: "var(--faint)", marginBottom: 6, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 27, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 13, color: "var(--sub)", marginTop: 5 }}>{sub}</div>}
    </div>
  );

  return (
    <div className="fade-up" style={{ paddingBottom: 20 }}>
      <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 500, marginBottom: 4 }}>Reports</h2>
      <p style={{ color: "var(--sub)", fontSize: 14, marginBottom: 16, fontWeight: 300 }}>How the shop is performing at a glance.</p>

      {/* range toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {[["today", "Today"], ["week", "This week"], ["month", "This month"]].map(([v, label]) => { const on = range === v; return (
          <button key={v} onClick={() => setRange(v)} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "rgba(176,141,87,0.12)" : "transparent", color: on ? "var(--gold)" : "var(--text)", fontSize: 14, fontWeight: on ? 600 : 400 }}>{label}</button>
        ); })}
      </div>

      {/* headline stats */}
      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <Stat label="Revenue" value={money(periodRevenue)} sub={range === "today" ? "booked today" : "estimated"} />
        <Stat label="Appointments" value={periodAppts} sub={`${cancelled} cancelled`} />
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
        <Stat label="Avg ticket" value={money(avgTicket)} />
        <Stat label="Rebooked" value={rebookRate + "%"} sub="on the spot" />
      </div>

      {/* revenue trend */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 18, padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}><TrendingUp size={17} style={{ color: "var(--gold)" }} /><span style={{ fontSize: 15.5, fontWeight: 600 }}>Revenue this week</span></div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, height: 130 }}>
          {weekTrend.map((v, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}>
              <div style={{ width: "100%", maxWidth: 30, height: `${Math.max(4, (v / maxTrend) * 100)}%`, background: i === 5 ? "var(--gold)" : "color-mix(in srgb, var(--gold) 35%, var(--panel2))", borderRadius: "6px 6px 0 0", transition: "height .3s var(--ease)" }} />
              <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{dayLabels[i]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* by staff */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 18, padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}><Users size={17} style={{ color: "var(--gold)" }} /><span style={{ fontSize: 15.5, fontWeight: 600 }}>By staff member</span></div>
        {byStaff.map((s) => { const max = Math.max(...byStaff.map((x) => x.revenue), 1); return (
          <div key={s.name} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span style={{ fontSize: 14.5 }}>{s.name}</span><span style={{ fontSize: 14, color: "var(--sub)" }}>{money(s.revenue)} · {s.count} appts</span></div>
            <div style={{ height: 8, borderRadius: 4, background: "var(--panel2)", overflow: "hidden" }}><div style={{ height: "100%", width: `${(s.revenue / max) * 100}%`, background: s.color || "var(--gold)", borderRadius: 4 }} /></div>
          </div>
        ); })}
      </div>

      {/* top services */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 18, padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}><BarChart3 size={17} style={{ color: "var(--gold)" }} /><span style={{ fontSize: 15.5, fontWeight: 600 }}>Top services</span></div>
        {topServices.map((s) => (
          <div key={s.name} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span style={{ fontSize: 14.5 }}>{s.name}</span><span style={{ fontSize: 14, color: "var(--sub)" }}>{money(s.rev)} · {s.sold} sold</span></div>
            <div style={{ height: 8, borderRadius: 4, background: "var(--panel2)", overflow: "hidden" }}><div style={{ height: "100%", width: `${(s.rev / maxSvc) * 100}%`, background: "var(--gold)", borderRadius: 4 }} /></div>
          </div>
        ))}
      </div>

      {/* retention */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <Stat label="Client retention" value={retention90 + "%"} sub="returned in 90 days" />
        <Stat label="Total clients" value={clients.length.toLocaleString()} />
      </div>

      <p style={{ fontSize: 12.5, color: "var(--faint)", lineHeight: 1.5, textAlign: "center", padding: "4px 10px" }}>Headline numbers and staff breakdown are calculated from your live appointments. Weekly trends and retention show representative figures until sales history is being stored.</p>
    </div>
  );
}

function ClientList({ clients, setClients, providers, onOpen, showToast }) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const staff = providers.filter((p) => p.id !== "anyone");
  const blank = { firstName: "", lastName: "", name: "", phone: "", email: "", provider: staff[0]?.id || "dan", notes: "" };
  const [draft, setDraft] = useState(blank);

  const q = query.trim().toLowerCase();
  const shown = q ? clients.filter((c) => (c.name + " " + (c.phone || "") + " " + (c.email || "")).toLowerCase().includes(q)) : clients;

  // Rebooking-rhythm radar: clients past their usual interval, not already handled since their last visit.
  // A client gets a `nudgeDismissedAt` stamp when you either Nudge them or X them out. If that stamp is more
  // recent than their last visit, they're hidden from the folder. When they come in again, lastVisit jumps
  // forward and they become eligible again — no manual reset needed.
  const overdue = clients.map((c) => {
    if (!c.cadenceDays || !c.lastVisit) return null;
    if (c.nudgeDismissedAt && new Date(c.nudgeDismissedAt) > new Date(c.lastVisit)) return null;
    const days = Math.round((Date.now() - new Date(c.lastVisit)) / 86400000);
    const over = days - c.cadenceDays;
    return over > 0 ? { c, days, over } : null;
  }).filter(Boolean).sort((a, b) => b.over - a.over);
  const [showNudgeFolder, setShowNudgeFolder] = useState(false);
  // Both Nudge and X mark the client as handled — they fall out of the list until their next visit.
  const markHandled = (clientId) => {
    setClients((cur) => cur.map((c) => c.id === clientId ? { ...c, nudgeDismissedAt: new Date().toISOString() } : c));
  };
  const nudge = (o) => { if (showToast) showToast(`Nudge sent to ${o.c.name.split(" ")[0]} — "time for your next visit?" with a booking link.`); markHandled(o.c.id); };
  const dismiss = (o) => { markHandled(o.c.id); };

  const saveClient = () => {
    if (!draft.firstName || !draft.firstName.trim()) { if (showToast) showToast("Please enter a first name."); return; }
    if (!draft.lastName || !draft.lastName.trim()) { if (showToast) showToast("Please enter a last name."); return; }
    if (draft.phone.replace(/\D/g, "").length < 10) { if (showToast) showToast("Please enter a valid phone number."); return; }
    const id = "c" + Date.now() + Math.floor(Math.random() * 1000);
    const fullName = `${draft.firstName.trim()} ${draft.lastName.trim()}`;
    const newClient = { id, name: fullName, firstName: draft.firstName.trim(), lastName: draft.lastName.trim(), phone: draft.phone.trim(), email: draft.email.trim(), provider: draft.provider, visits: 0, customDurations: {}, notes: draft.notes.trim(), messages: [], gallery: [], timeline: [] };
    setClients([newClient, ...clients]);
    setAdding(false); setDraft(blank);
    if (showToast) showToast(`${newClient.name} added.`);
  };

  const inputS = { width: "100%", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "13px 15px", color: "var(--text)", fontSize: 16, fontFamily: FONT_BODY, boxSizing: "border-box" };

  return (
    <>
    <div className="fade-up">
      {/* Editorial masthead */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
        <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--gold)", marginBottom: 8, fontWeight: 600 }}>{clients.length} {clients.length === 1 ? "PERSON" : "PEOPLE"}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 14 }}>
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 42, fontWeight: 500, letterSpacing: -0.6, lineHeight: 0.95 }}>Clients</h2>
          <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "stretch" }}>
            <button onClick={() => setShowNudgeFolder(true)} aria-label="Rebooking nudges" style={{ position: "relative", background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)", height: 42, width: 42, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Bell size={17} style={{ color: overdue.length > 0 ? "var(--gold)" : "var(--sub)" }} />
              {overdue.length > 0 && <span style={{ position: "absolute", top: -5, right: -5, background: "var(--gold)", color: "var(--on-gold)", fontSize: 11, fontWeight: 700, borderRadius: 10, minWidth: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", lineHeight: 1 }}>{overdue.length}</span>}
            </button>
            <button className="lift" onClick={() => { setDraft(blank); setAdding(true); }} aria-label="Add client" style={{ background: "var(--gold)", color: "var(--on-gold)", border: "none", height: 42, padding: "0 16px", borderRadius: 12, display: "flex", alignItems: "center", gap: 7, boxShadow: "var(--shadow-md)", fontSize: 13.5, fontWeight: 600, letterSpacing: 1.5 }}><Plus size={16} strokeWidth={2.5} /> ADD</button>
          </div>
        </div>
      </div>

      <div style={{ position: "relative", marginBottom: 22 }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, phone, or email" style={{ ...inputS, paddingLeft: 44, borderRadius: 14 }} />
        <User size={17} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--faint)", pointerEvents: "none" }} />
      </div>

      <div style={{ display: "grid", gap: 10 }}>{shown.map((c) => { const provider = providers.find((p) => p.id === c.provider) || providers[1]; return (<button key={c.id} className="lift card" onClick={() => onOpen(c)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "16px 18px", color: "var(--text)", textAlign: "left" }}><div style={{ display: "flex", alignItems: "center", gap: 14 }}><Avatar size={42} photo={clientPhoto(c)} initial={c.name.charAt(0)} color={provider.color} /><div><div style={{ fontSize: 16 }}>{c.name}</div><div style={{ fontSize: 15, color: "var(--sub)" }}>{c.visits} visits · {provider.name}</div></div></div><ChevronRight size={18} style={{ color: "var(--faint)" }} /></button>); })}</div>
      {shown.length === 0 && <p style={{ color: "var(--faint)", fontSize: 14.5, textAlign: "center", padding: "36px 0" }}>{q ? `No clients match “${query}”.` : "No clients yet — tap + to add your first one."}</p>}
    </div>

    {adding && (
      <div className="fade-in" onClick={() => setAdding(false)} style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--overlay)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box" }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, maxHeight: "88vh", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 20, padding: 22, boxShadow: "0 18px 50px var(--shadow)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24 }}>New client</div>
            <button onClick={() => setAdding(false)} style={{ background: "none", color: "var(--sub)" }}><X size={22} /></button>
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12.5, letterSpacing: 1.5, color: "var(--faint)", display: "block", marginBottom: 7 }}>FIRST NAME</label>
              <input value={draft.firstName || ""} onChange={(e) => setDraft({ ...draft, firstName: e.target.value })} placeholder="First" style={inputS} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12.5, letterSpacing: 1.5, color: "var(--faint)", display: "block", marginBottom: 7 }}>LAST NAME</label>
              <input value={draft.lastName || ""} onChange={(e) => setDraft({ ...draft, lastName: e.target.value })} placeholder="Last" style={inputS} />
            </div>
          </div>

          <label style={{ fontSize: 12.5, letterSpacing: 1.5, color: "var(--faint)", display: "block", marginBottom: 7 }}>PHONE</label>
          <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="(555) 000-0000" inputMode="tel" style={{ ...inputS, marginBottom: 14 }} />

          <label style={{ fontSize: 12.5, letterSpacing: 1.5, color: "var(--faint)", display: "block", marginBottom: 7 }}>EMAIL (optional)</label>
          <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="name@email.com" inputMode="email" style={{ ...inputS, marginBottom: 14 }} />

          <label style={{ fontSize: 12.5, letterSpacing: 1.5, color: "var(--faint)", display: "block", marginBottom: 7 }}>PREFERRED BARBER</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {staff.map((p) => { const on = draft.provider === p.id; return (
              <button key={p.id} onClick={() => setDraft({ ...draft, provider: p.id })} style={{ padding: "10px 16px", borderRadius: 24, border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "rgba(176,141,87,0.12)" : "transparent", color: on ? "var(--gold)" : "var(--text)", fontSize: 14.5, fontWeight: on ? 600 : 400 }}>{p.name}</button>
            ); })}
          </div>

          <label style={{ fontSize: 12.5, letterSpacing: 1.5, color: "var(--faint)", display: "block", marginBottom: 7 }}>NOTES (optional)</label>
          <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={3} placeholder="Formula, preferences, anything to remember…" style={{ ...inputS, resize: "vertical", lineHeight: 1.5, marginBottom: 20 }} />

          <button className="lift" onClick={saveClient} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 15, fontSize: 15, fontWeight: 600, borderRadius: 12, border: "none" }}>Add client</button>
          <button onClick={() => setAdding(false)} style={{ width: "100%", background: "none", border: "none", color: "var(--sub)", fontSize: 14.5, padding: "12px 0 2px" }}>Cancel</button>
        </div>
      </div>
    )}

    {/* Rebooking nudges folder — opened by the bell button at the top of the Clients page. */}
    <Sheet open={showNudgeFolder} onClose={() => setShowNudgeFolder(false)} align="top" maxWidth={480}>
      <div style={{ padding: "18px 4px 12px" }}>
        <div style={{ width: 28, height: 1.5, background: "var(--gold)", marginBottom: 12 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 500 }}>Due to rebook</h2>
          {overdue.length > 0 && <span style={{ background: "var(--gold)", color: "var(--on-gold)", fontSize: 11, fontWeight: 700, borderRadius: 8, padding: "3px 8px", lineHeight: 1 }}>{overdue.length}</span>}
        </div>
        <p style={{ color: "var(--sub)", fontSize: 14, marginBottom: 18, lineHeight: 1.5 }}>Clients past their usual rebooking rhythm. Send a nudge — or skip them with ×.</p>
        {overdue.length === 0 ? (
          <p style={{ color: "var(--faint)", fontSize: 14, textAlign: "center", padding: "30px 0" }}>Nobody's overdue right now.</p>
        ) : (
          <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
            {overdue.map((o) => {
              const provider = providers.find((p) => p.id === o.c.provider) || providers[1];
              return (
                <div key={o.c.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "color-mix(in srgb, var(--gold) 7%, var(--panel))", border: "1px solid color-mix(in srgb, var(--gold) 25%, var(--border))", borderRadius: 16, padding: "12px 14px" }}>
                  <Avatar size={40} photo={clientPhoto(o.c)} initial={o.c.name.charAt(0)} color={provider.color} />
                  <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => { setShowNudgeFolder(false); onOpen(o.c); }}>
                    <div style={{ fontSize: 15.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.c.name}</div>
                    <div style={{ fontSize: 13, color: "var(--sub)" }}>Usually every {o.c.cadenceDays}d · <span style={{ color: "var(--gold)", fontWeight: 600 }}>{o.over}d overdue</span></div>
                  </div>
                  <button className="lift" onClick={() => nudge(o)} style={{ background: "var(--gold)", color: "var(--on-gold)", border: "none", borderRadius: 20, padding: "8px 14px", fontSize: 13.5, fontWeight: 600, flexShrink: 0 }}>Nudge</button>
                  <button onClick={() => dismiss(o)} aria-label="Skip" style={{ width: 36, height: 36, background: "var(--panel2)", color: "var(--sub)", border: "1px solid var(--border)", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer" }}><X size={16} /></button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Sheet>
    </>
  );
}

function ClientProfile({ client, clients, setClients, services, setServices, providers, appts, onBack, showToast }) {
  const live = clients.find((c) => c.id === client.id);
  const provider = providers.find((p) => p.id === live.provider) || providers[1];
  const [pfTab, setPfTab] = useState("overview"); // overview | timeline | photos | times | family
  const [openMember, setOpenMember] = useState(null); // family member mini-profile being viewed
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [mName, setMName] = useState("");
  const [mNote, setMNote] = useState("");
  const family = live.family || [];
  const addFamilyMember = () => {
    if (!mName.trim()) return;
    const member = { id: "fm" + Date.now(), name: mName.trim(), note: mNote.trim(), customDurations: {}, gallery: [], timeline: [] };
    setClients(clients.map((c) => c.id === live.id ? { ...c, family: [...(c.family || []), member] } : c));
    setMName(""); setMNote(""); setAddMemberOpen(false);
    showToast(`${member.name} added.`);
  };
  const removeFamilyMember = (id) => {
    setClients(clients.map((c) => c.id === live.id ? { ...c, family: (c.family || []).filter((m) => m.id !== id) } : c));
    setOpenMember(null);
  };
  const [selService, setSelService] = useState(services[0]?.id || "");

  // ---- Block from booking ----
  const [blockPrompt, setBlockPrompt] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const isBlocked = !!live.blocked;
  const confirmBlock = () => {
    setClients(clients.map((c) => c.id === live.id ? { ...c, blocked: true, blockReason: blockReason.trim(), blockedAt: new Date().toISOString() } : c));
    setBlockPrompt(false); setBlockReason("");
    showToast(`${live.name.split(" ")[0]} is blocked from booking.`);
  };
  const unblock = () => {
    setClients(clients.map((c) => c.id === live.id ? { ...c, blocked: false, blockReason: "", blockedAt: null } : c));
    showToast(`${live.name.split(" ")[0]} can book again.`);
  };
  const sel = services.find((s) => s.id === selService);
  // current value to prefill the time dropdowns: custom if set, else service default
  const curMin = (live.customDurations[selService] != null) ? live.customDurations[selService] : (sel?.duration || 30);
  const [selH, setSelH] = useState(Math.floor(curMin / 60));
  const [selM, setSelM] = useState(curMin % 60);
  // when the chosen service changes, reset the time dropdowns to that service's stored/default time
  useEffect(() => {
    const m = (live.customDurations[selService] != null) ? live.customDurations[selService] : (services.find((s) => s.id === selService)?.duration || 30);
    setSelH(Math.floor(m / 60)); setSelM(m % 60);
  }, [selService]);

  const saveDuration = () => {
    const val = selH * 60 + selM;
    if (val < 5) { showToast("Pick at least 5 minutes."); return; }
    setClients(clients.map((c) => c.id === client.id ? { ...c, customDurations: { ...c.customDurations, [selService]: val } } : c));
    showToast(`Saved — ${sel.name} now books at ${fmtDur(val)} for ${live.name.split(" ")[0]}.`);
  };
  const clearDuration = (sid) => {
    setClients(clients.map((c) => { if (c.id !== client.id) return c; const cd = { ...c.customDurations }; delete cd[sid]; return { ...c, customDurations: cd }; }));
    showToast("Reverted to the default time.");
  };
  const customList = services.filter((s) => live.customDurations[s.id] != null);
  const selectStyle = { flex: 1, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: "13px 40px 13px 15px", color: "var(--text)", fontSize: 15, fontFamily: FONT_BODY, appearance: "none", WebkitAppearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 15px center" };

  // ---- editable client note (Mangomint-style persistent profile note) ----
  const [noteDraft, setNoteDraft] = useState(live.notes || "");
  const [editingNote, setEditingNote] = useState(false);
  const noteDirty = noteDraft !== (live.notes || "");
  const saveNote = () => {
    setClients(clients.map((c) => c.id === client.id ? { ...c, notes: noteDraft } : c));
    setEditingNote(false);
    showToast("Client note saved.");
  };

  // ---- timeline notes (dated entries: color formulas, product recs, etc.) ----
  const [tlDraft, setTlDraft] = useState("");
  const addTimelineNote = () => {
    if (!tlDraft.trim()) return;
    const entry = { id: "tn" + Date.now(), text: tlDraft.trim(), date: new Date().toISOString() };
    setClients(clients.map((c) => c.id === client.id ? { ...c, timeline: [entry, ...(c.timeline || [])] } : c));
    setTlDraft("");
    showToast("Timeline note added.");
  };
  const removeTimelineNote = (id) => {
    setClients(clients.map((c) => c.id === client.id ? { ...c, timeline: (c.timeline || []).filter((t) => t.id !== id) } : c));
  };
  const [tlFilter, setTlFilter] = useState("all"); // all | appointments | notes

  // ---- profile photo + work gallery ----
  const [picker, setPicker] = useState(false);
  const setClientPhoto = (id) => { setClients(clients.map((c) => c.id === client.id ? { ...c, photo: id } : c)); setPicker(false); };
  const removeClientPhoto = () => { setClients(clients.map((c) => c.id === client.id ? { ...c, photo: null } : c)); setPicker(false); };
  const [galPicker, setGalPicker] = useState(false);
  const [lightbox, setLightbox] = useState(null); // gallery entry being viewed full-size
  const addGalleryPhoto = (id) => {
    const entry = { id: "g" + Date.now(), photo: id, note: "", date: new Date().toISOString() };
    setClients(clients.map((c) => c.id === client.id ? { ...c, gallery: [entry, ...(c.gallery || [])] } : c));
    setGalPicker(false);

    // Auto-train: add this photo to the AI reference library for the matching service / cut type.
    // We use the client's most recent confirmed appointment to figure out which service + cut type.
    let learned = false;
    try {
      const myAppts = (appts || []).filter((a) => a.clientId === client.id && a.status !== "block").sort((a, b) => (b.bookedFor || "").localeCompare(a.bookedFor || ""));
      const lastAppt = myAppts[0];
      const cutTypeId = lastAppt?.lineItems?.[0]?.cutType || null;
      const serviceId = lastAppt?.serviceId;
      if (serviceId && setServices) {
        setServices(services.map((s) => {
          if (s.id !== serviceId) return s;
          // If service has cut types and we know which one, add to that cut type's referencePhotos
          if (s.cutTypes && s.cutTypes.length && cutTypeId) {
            const cuts = s.cutTypes.map((ct) => {
              if (ct.id !== cutTypeId) return ct;
              const list = ct.referencePhotos || [];
              if (list.includes(id)) return ct;
              learned = true;
              return { ...ct, referencePhotos: [...list, id] };
            });
            return { ...s, cutTypes: cuts };
          }
          // Otherwise, add to the service's own referencePhotos
          const list = s.referencePhotos || [];
          if (list.includes(id)) return s;
          learned = true;
          return { ...s, referencePhotos: [...list, id] };
        }));
      }
    } catch (err) { /* silent — gallery still saves */ }

    showToast(learned ? "Photo saved — Vero just got a little smarter." : "Photo added to gallery.");
  };
  const removeGalleryPhoto = (gid) => {
    setClients(clients.map((c) => c.id === client.id ? { ...c, gallery: (c.gallery || []).filter((g) => g.id !== gid) } : c));
    setLightbox(null);
  };
  const setGalleryNote = (gid, note) => {
    setClients(clients.map((c) => c.id === client.id ? { ...c, gallery: (c.gallery || []).map((g) => g.id === gid ? { ...g, note } : g) } : c));
  };
  const gallery = live.gallery || [];

  // build a unified, date-sorted feed: appointments for this client + timeline notes
  const myAppts = (appts || []).filter((a) => a.clientId === client.id && a.status !== "block");
  const now = Date.now();
  // Upcoming = confirmed/checked-in appointments whose date is still in the future, soonest first.
  const upcomingAppts = myAppts
    .filter((a) => a.bookedFor && new Date(a.bookedFor).getTime() >= now && a.status !== "cancelled" && a.status !== "done")
    .sort((a, b) => new Date(a.bookedFor) - new Date(b.bookedFor));
  const nextAppt = upcomingAppts[0] || null;
  // Recent visits = past appointments (date in the past, or marked done), newest first. Used by the Overview snapshot.
  const pastAppts = myAppts
    .filter((a) => a.bookedFor && (new Date(a.bookedFor).getTime() < now || a.status === "done") && a.status !== "cancelled")
    .sort((a, b) => new Date(b.bookedFor) - new Date(a.bookedFor))
    .slice(0, 4);
  // Nudge handler for the Overview button — same persistence as the Clients-tab folder.
  const nudgeFromProfile = () => {
    setClients(clients.map((c) => c.id === client.id ? { ...c, nudgeDismissedAt: new Date().toISOString() } : c));
    showToast(`Nudge sent to ${live.name.split(" ")[0]} — "time for your next visit?" with a booking link.`);
  };
  const feed = [
    ...myAppts.map((a) => ({ kind: "appt", date: a.bookedFor || new Date().toISOString(), appt: a, sortKey: a.bookedFor ? new Date(a.bookedFor).getTime() : 0 })),
    ...(live.timeline || []).map((t) => ({ kind: "note", date: t.date, text: t.text, id: t.id, sortKey: t.date ? new Date(t.date).getTime() : 0 })),
  ].sort((a, b) => b.sortKey - a.sortKey); // most recent / soonest-future first
  const feedFiltered = feed.filter((f) => tlFilter === "all" || (tlFilter === "appointments" && f.kind === "appt") || (tlFilter === "notes" && f.kind === "note"));
  const niceDate = (iso) => { const d = new Date(iso); return `${MONTHS[d.getMonth()].slice(0,3)} ${d.getDate()}`; };
  const niceDateFull = (iso) => { const d = new Date(iso); return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()].slice(0,3)} ${d.getDate()}`; };

  return (
    <div className="fade-up">
      <button onClick={onBack} style={{ background: "none", color: "var(--sub)", display: "flex", alignItems: "center", gap: 6, fontSize: 14.5, marginBottom: 18 }}><ArrowLeft size={16} /> All clients</button>

      {/* Editorial profile header */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
          <button onClick={() => setPicker(true)} style={{ position: "relative", width: 64, height: 64, borderRadius: "50%", background: "none", border: "none", flexShrink: 0, padding: 0 }}>
            <Avatar size={64} photo={clientPhoto(live)} initial={live.name.charAt(0)} color={provider.color} />
            <span style={{ position: "absolute", bottom: -2, right: -2, width: 22, height: 22, borderRadius: "50%", background: "var(--gold)", color: "var(--on-gold)", display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid var(--bg)" }}><Camera size={11} /></span>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 500, lineHeight: 1.02, letterSpacing: "-0.3px", marginBottom: 4 }}>{live.name}</h2>
            <div style={{ color: "var(--sub)", fontSize: 13.5, lineHeight: 1.4 }}>
              {live.phone && <PhoneLink number={live.phone} />}
              {live.phone && live.email && " · "}
              {live.email && <EmailLink email={live.email} />}
              {!live.phone && !live.email && <span style={{ color: "var(--faint)", fontStyle: "italic" }}>No contact info on file</span>}
            </div>
          </div>
        </div>
      </div>

      {/* TAB BAR */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 22, overflowX: "auto" }}>
        {[["overview","Overview"],["timeline","Timeline"],["photos","Photos"],["times","Times"],["family","Family"]].map(([id, label]) => { const on = pfTab === id; return (
          <button key={id} onClick={() => { setPfTab(id); setOpenMember(null); }} style={{ flexShrink: 0, background: "none", border: "none", borderBottom: `2px solid ${on ? "var(--text)" : "transparent"}`, color: on ? "var(--text)" : "var(--faint)", fontWeight: on ? 600 : 400, fontSize: 14.5, padding: "10px 10px" }}>{label}{id === "family" && family.length > 0 ? ` (${family.length})` : ""}</button>
        ); })}
      </div>
      {picker && <StaffPhotoPicker hasPhoto={!!live.photo} onClose={() => setPicker(false)} onPick={setClientPhoto} onRemove={removeClientPhoto} />}
      {galPicker && <PhotoPicker onClose={() => setGalPicker(false)} onPick={addGalleryPhoto} />}
      {lightbox && (() => { const g = gallery.find((x) => x.id === lightbox); if (!g) return null; return (
        <Sheet open={true} onClose={() => setLightbox(null)} maxWidth={560}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22 }}>{niceDate(g.date)}</div>
            <button onClick={() => setLightbox(null)} style={{ background: "none", color: "var(--sub)" }}><X size={22} /></button>
          </div>
          <img src={imgUrl(g.photo, 800)} alt="" style={{ width: "100%", borderRadius: 14, marginBottom: 14, display: "block" }} />
          <input value={g.note || ""} onChange={(e) => setGalleryNote(g.id, e.target.value)} placeholder="Add a note (e.g. skin fade #2, product used)…" style={{ width: "100%", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: "13px 15px", color: "var(--text)", fontSize: 15, fontFamily: FONT_BODY, boxSizing: "border-box", marginBottom: 12 }} />
          <button onClick={() => removeGalleryPhoto(g.id)} style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", color: "var(--sub)", padding: 12, fontSize: 14, letterSpacing: 1, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Trash2 size={16} /> REMOVE FROM GALLERY</button>
        </Sheet>
      ); })()}

      {/* CLIENT NOTE — always-visible, editable */}
      {pfTab === "overview" && <div style={{ marginBottom: 28 }}>
        {/* Visit count + provider — moved down from the masthead. Plain text, no caps treatment. */}
        <div style={{ fontSize: 13.5, color: "var(--faint)", marginBottom: 18 }}>
          {live.visits === 0 ? "First visit" : live.visits === 1 ? "1 visit" : `${live.visits} visits`} with {provider.name}
        </div>
        {/* Upcoming appointment — the key thing to see at a glance */}
        {nextAppt && (
          <div style={{ background: "color-mix(in srgb, var(--gold) 10%, var(--panel))", border: "1px solid color-mix(in srgb, var(--gold) 35%, var(--border))", borderRadius: 14, padding: "16px 18px", marginBottom: 22 }}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--gold)", fontWeight: 700, marginBottom: 8 }}>UPCOMING APPOINTMENT</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "color-mix(in srgb, var(--gold) 18%, var(--panel))", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Calendar size={17} style={{ color: "var(--gold)" }} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.2 }}>{niceDateFull(nextAppt.bookedFor)}</div>
                <div style={{ fontSize: 13.5, color: "var(--sub)" }}>{fmtTime(nextAppt.start)} · {nextAppt.title}{nextAppt.providerId ? ` · ${(providers.find((p) => p.id === nextAppt.providerId) || {}).name || ""}` : ""}</div>
              </div>
            </div>
            {upcomingAppts.length > 1 && <div style={{ fontSize: 12.5, color: "var(--gold)", marginTop: 10, fontWeight: 500 }}>+{upcomingAppts.length - 1} more upcoming</div>}
          </div>
        )}

        {/* Nudge to rebook — shown when no upcoming visit but they've been in before */}
        {!nextAppt && pastAppts.length > 0 && (
          <button className="lift" onClick={nudgeFromProfile} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 14, fontSize: 13, fontWeight: 600, letterSpacing: 2, borderRadius: 12, border: "none", marginBottom: 22, display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
            <Bell size={15} /> NUDGE TO REBOOK
          </button>
        )}

        {/* Recent visits — last few past appointments */}
        {pastAppts.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 14, letterSpacing: 2, color: "var(--faint)", marginBottom: 12 }}>RECENT VISITS</div>
            <div style={{ display: "grid", gap: 8 }}>
              {pastAppts.map((a) => {
                const apptProv = providers.find((p) => p.id === a.providerId);
                return (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--panel2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Calendar size={14} style={{ color: "var(--sub)" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 500 }}>{niceDateFull(a.bookedFor)}</div>
                      <div style={{ fontSize: 13, color: "var(--sub)" }}>{a.title}{apptProv ? ` · ${apptProv.name}` : ""}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Client note — preferences, allergies, formulas */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 14, letterSpacing: 2, color: "var(--faint)" }}>CLIENT NOTE</div>
          {!editingNote && <button onClick={() => setEditingNote(true)} style={{ background: "none", color: "var(--gold)", fontSize: 14, display: "flex", alignItems: "center", gap: 5 }}><Edit2 size={13} /> {live.notes ? "Edit" : "Add note"}</button>}
        </div>
        {editingNote ? (
          <div>
            <textarea autoFocus value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Preferences, allergies, formulas, conversation topics — anything you want to remember about this client." rows={5} style={{ width: "100%", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: "13px 15px", color: "var(--text)", fontSize: 15, fontFamily: FONT_BODY, lineHeight: 1.55, resize: "vertical", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button onClick={() => { setNoteDraft(live.notes || ""); setEditingNote(false); }} style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", color: "var(--text)", padding: 12, borderRadius: 10, fontSize: 14 }}>Cancel</button>
              <button className="lift" onClick={saveNote} disabled={!noteDirty} style={{ flex: 1, background: noteDirty ? "var(--gold)" : "var(--panel2)", color: noteDirty ? "var(--on-gold)" : "var(--faint)", padding: 12, borderRadius: 10, fontSize: 14, fontWeight: 600 }}>Save note</button>
            </div>
          </div>
        ) : (
          <div onClick={() => setEditingNote(true)} style={{ background: live.notes ? "color-mix(in srgb, var(--gold) 7%, var(--panel))" : "var(--panel2)", border: `1px solid ${live.notes ? "color-mix(in srgb, var(--gold) 25%, var(--border))" : "var(--border)"}`, borderRadius: 12, padding: "14px 16px", cursor: "pointer", minHeight: 20 }}>
            {live.notes
              ? <p style={{ fontSize: 14.5, color: "var(--text2)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{live.notes}</p>
              : <p style={{ fontSize: 14.5, color: "var(--faint)", fontStyle: "italic" }}>Nothing noted yet — tap to jot down preferences, allergies, or anything worth remembering.</p>}
          </div>
        )}
      </div>}

      {/* GALLERY — photos of previous work */}
      {pfTab === "photos" && <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 14, letterSpacing: 2, color: "var(--faint)" }}>GALLERY</div>
          <button onClick={() => setGalPicker(true)} style={{ background: "none", color: "var(--gold)", fontSize: 14, display: "flex", alignItems: "center", gap: 5 }}><Plus size={14} /> Add photo</button>
        </div>
        {gallery.length === 0 ? (
          <button onClick={() => setGalPicker(true)} className="lift" style={{ width: "100%", background: "var(--panel2)", border: "1px dashed var(--border2)", borderRadius: 14, padding: "26px 16px", color: "var(--sub)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <Camera size={22} style={{ color: "var(--faint)" }} />
            <span style={{ fontSize: 14.5 }}>No photos yet — add a shot of your work so you can both look back next time.</span>
          </button>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {gallery.map((g) => (
              <button key={g.id} className="lift" onClick={() => setLightbox(g.id)} style={{ position: "relative", padding: 0, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", aspectRatio: "1", background: "var(--panel2)" }}>
                <img src={imgUrl(g.photo, 300)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "10px 6px 4px", fontSize: 10.5, color: "#fff", textAlign: "left", background: "linear-gradient(to top, rgba(0,0,0,0.55), transparent)" }}>{niceDate(g.date)}</span>
              </button>
            ))}
          </div>
        )}
      </div>}

      {/* TIMELINE — dated notes + appointment history (Mangomint-style) */}
      {pfTab === "timeline" && <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 14, letterSpacing: 2, color: "var(--faint)", marginBottom: 12 }}>TIMELINE</div>
        {/* add a dated note */}
        <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <textarea value={tlDraft} onChange={(e) => setTlDraft(e.target.value)} placeholder="Add an entry — color formula, product used, what you discussed…" rows={2} style={{ width: "100%", background: "transparent", border: "none", color: "var(--text)", fontSize: 14.5, fontFamily: FONT_BODY, lineHeight: 1.5, resize: "vertical", boxSizing: "border-box" }} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
            <button className="lift" onClick={addTimelineNote} disabled={!tlDraft.trim()} style={{ background: tlDraft.trim() ? "var(--gold)" : "var(--panel)", color: tlDraft.trim() ? "var(--on-gold)" : "var(--faint)", padding: "8px 18px", borderRadius: 10, fontSize: 13.5, fontWeight: 600, letterSpacing: 0.5 }}>ADD</button>
          </div>
        </div>
        {/* filter chips */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {[["all","All"],["appointments","Appointments"],["notes","Notes"]].map(([id, label]) => { const on = tlFilter === id; return (
            <button key={id} onClick={() => setTlFilter(id)} style={{ background: on ? "color-mix(in srgb, var(--gold) 12%, var(--panel))" : "transparent", border: `1px solid ${on ? "var(--gold)" : "var(--border)"}`, color: on ? "var(--gold)" : "var(--sub)", padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: on ? 600 : 400 }}>{label}</button>
          ); })}
        </div>
        {/* feed */}
        {feedFiltered.length === 0 ? (
          <p style={{ fontSize: 14, color: "var(--faint)", fontStyle: "italic", padding: "8px 2px" }}>Nothing here just yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {feedFiltered.map((f, i) => f.kind === "appt" ? (() => {
              const isUpcoming = f.appt.bookedFor && new Date(f.appt.bookedFor).getTime() >= now && f.appt.status !== "cancelled" && f.appt.status !== "done";
              const isCancelled = f.appt.status === "cancelled";
              return (
              <div key={"a"+f.appt.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: isUpcoming ? "color-mix(in srgb, var(--gold) 8%, var(--panel))" : "var(--panel)", border: `1px solid ${isUpcoming ? "color-mix(in srgb, var(--gold) 28%, var(--border))" : "var(--border)"}`, borderRadius: 12, padding: "12px 14px", opacity: isCancelled ? 0.55 : 1 }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: "color-mix(in srgb, var(--gold) 14%, var(--panel))", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Calendar size={14} style={{ color: "var(--gold)" }} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600, textDecoration: isCancelled ? "line-through" : "none" }}>{f.appt.title}</span>
                    {isUpcoming && <span style={{ fontSize: 10, letterSpacing: 1, color: "var(--gold)", fontWeight: 700, background: "color-mix(in srgb, var(--gold) 16%, transparent)", padding: "2px 7px", borderRadius: 10 }}>UPCOMING</span>}
                    {isCancelled && <span style={{ fontSize: 10, letterSpacing: 1, color: "var(--sub)", fontWeight: 600 }}>CANCELLED</span>}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--sub)", marginTop: 2 }}>{f.appt.bookedFor ? `${niceDate(f.appt.bookedFor)} · ` : ""}{fmtTime(f.appt.start)} – {fmtTime(f.appt.end)}{f.appt.detail ? ` · ${f.appt.detail}` : ""}</div>
                </div>
              </div>
              );
            })() : (
              <div key={f.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "color-mix(in srgb, var(--gold) 6%, var(--panel))", border: "1px solid color-mix(in srgb, var(--gold) 22%, var(--border))", borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: "color-mix(in srgb, var(--gold) 16%, var(--panel))", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Edit2 size={13} style={{ color: "var(--gold)" }} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 3 }}>{niceDate(f.date)}</div>
                  <div style={{ fontSize: 14.5, color: "var(--text2)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{f.text}</div>
                </div>
                <button onClick={() => removeTimelineNote(f.id)} style={{ background: "none", color: "var(--faint)", flexShrink: 0 }}><X size={15} /></button>
              </div>
            ))}
          </div>
        )}

        {/* Block from booking */}
        <div style={{ marginTop: 26, paddingTop: 22, borderTop: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 3, color: isBlocked ? "var(--danger, #c0392b)" : "var(--text)" }}>Block from booking</div>
              <div style={{ fontSize: 13.5, color: "var(--sub)", lineHeight: 1.45 }}>{isBlocked ? "This client can't book online. They can still be added manually." : "Prevent this client from booking online."}</div>
            </div>
            <button onClick={() => { if (isBlocked) { unblock(); } else { setBlockPrompt(true); } }} style={{ width: 44, height: 26, borderRadius: 13, background: isBlocked ? "var(--danger, #c0392b)" : "var(--border)", position: "relative", flexShrink: 0, border: "none", padding: 0, marginTop: 2 }}><span style={{ position: "absolute", top: 3, left: isBlocked ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} /></button>
          </div>
          {isBlocked && live.blockReason && (
            <div style={{ marginTop: 12, background: "color-mix(in srgb, #c0392b 8%, var(--panel))", border: "1px solid color-mix(in srgb, #c0392b 30%, var(--border))", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, letterSpacing: 1.5, color: "var(--danger, #c0392b)", fontWeight: 600, marginBottom: 4 }}>REASON</div>
              <div style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.45 }}>{live.blockReason}</div>
            </div>
          )}
        </div>
      </div>}

      {/* Block reason prompt */}
      <Sheet open={blockPrompt} onClose={() => setBlockPrompt(false)} align="top">
        <div style={{ width: 28, height: 1.5, background: "var(--gold)", marginBottom: 12 }} />
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 500, marginBottom: 6 }}>Block {live.name.split(" ")[0]}?</h2>
        <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.5, marginBottom: 16 }}>They won't be able to book online. Add a reason for your records — only you'll see it.</p>
        <textarea value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="e.g. Repeated no-shows, payment issue…" rows={3} style={{ width: "100%", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", color: "var(--text)", fontSize: 15, lineHeight: 1.5, resize: "none", marginBottom: 16, boxSizing: "border-box" }} />
        <button onClick={confirmBlock} disabled={!blockReason.trim()} style={{ width: "100%", background: blockReason.trim() ? "#c0392b" : "var(--border)", color: blockReason.trim() ? "#fff" : "var(--faint)", padding: 15, fontSize: 14, letterSpacing: 1.5, fontWeight: 600, borderRadius: 12, border: "none", marginBottom: 10 }}>BLOCK FROM BOOKING</button>
        <button onClick={() => setBlockPrompt(false)} style={{ width: "100%", background: "transparent", color: "var(--sub)", padding: 12, fontSize: 14, fontWeight: 500, borderRadius: 12, border: "none" }}>Cancel</button>
      </Sheet>

      {pfTab === "times" && <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 14, letterSpacing: 2, color: "var(--faint)", marginBottom: 12 }}>REMEMBERED TIMING</div>
        <p style={{ fontSize: 15, color: "var(--sub)", marginBottom: 16, fontWeight: 300, lineHeight: 1.5 }}>Set how long this client actually takes for a service. It overrides the default and tightens their future booking slots.</p>

        {/* service dropdown */}
        <label style={{ fontSize: 14, color: "var(--faint)", display: "block", marginBottom: 6 }}>Service</label>
        <div style={{ position: "relative", marginBottom: 14 }}>
          <select value={selService} onChange={(e) => setSelService(e.target.value)} style={{ ...selectStyle, width: "100%", paddingRight: 38 }}>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}{live.customDurations[s.id] != null ? "  ✓" : ""}</option>)}
          </select>
          <ChevronRight size={16} style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%) rotate(90deg)", color: "var(--faint)", pointerEvents: "none" }} />
        </div>

        {/* time dropdowns: hours + minutes (5-min steps) */}
        <label style={{ fontSize: 14, color: "var(--faint)", display: "block", marginBottom: 6 }}>Duration</label>
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <select value={selH} onChange={(e) => setSelH(parseInt(e.target.value))} style={{ ...selectStyle, width: "100%", paddingRight: 38 }}>
              {[0, 1, 2, 3].map((h) => <option key={h} value={h}>{h} hr</option>)}
            </select>
            <ChevronRight size={16} style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%) rotate(90deg)", color: "var(--faint)", pointerEvents: "none" }} />
          </div>
          <div style={{ position: "relative", flex: 1 }}>
            <select value={selM} onChange={(e) => setSelM(parseInt(e.target.value))} style={{ ...selectStyle, width: "100%", paddingRight: 38 }}>
              {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
            <ChevronRight size={16} style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%) rotate(90deg)", color: "var(--faint)", pointerEvents: "none" }} />
          </div>
        </div>

        <button className="lift" onClick={saveDuration} style={{ width: "100%", background: "var(--gold)", color: "var(--on-gold)", padding: 14, borderRadius: 8, fontSize: 14, fontWeight: 600, letterSpacing: 0.5, marginBottom: 18 }}>Save timing</button>

        {/* what's already customized */}
        {customList.length > 0 && (
          <div>
            <div style={{ fontSize: 13, letterSpacing: 1, color: "var(--faint)", marginBottom: 8 }}>CUSTOM TIMES SET</div>
            <div style={{ display: "grid", gap: 8 }}>
              {customList.map((s) => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, padding: "11px 14px" }}>
                  <span style={{ fontSize: 14 }}>{s.name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 14, color: "var(--gold)", fontWeight: 600 }}>{fmtDur(live.customDurations[s.id])}</span>
                    <button onClick={() => clearDuration(s.id)} style={{ background: "none", color: "var(--faint)", display: "flex", alignItems: "center" }}><X size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 14, color: "var(--faint)", marginTop: 8, fontWeight: 300 }}>Everything else uses the menu default. Tap ✕ to revert one.</p>
          </div>
        )}
      </div>}

      {/* FAMILY TAB */}
      {pfTab === "family" && !openMember && (
        <div style={{ marginBottom: 28 }}>
          <p style={{ fontSize: 14.5, color: "var(--sub)", marginBottom: 16, fontWeight: 300, lineHeight: 1.5 }}>People linked to {live.name.split(" ")[0]}'s account. Each keeps their own times, notes, and photos.</p>
          {family.length === 0 && <p style={{ fontSize: 14, color: "var(--faint)", fontStyle: "italic", marginBottom: 14 }}>No family members yet.</p>}
          <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
            {family.map((m) => (
              <button key={m.id} className="lift" onClick={() => setOpenMember(m.id)} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "13px 15px", textAlign: "left", color: "var(--text)" }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--panel2)", color: "var(--text)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontSize: 17, flexShrink: 0 }}>{m.name.charAt(0)}</div>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 15 }}>{m.name}</div>{m.note && <div style={{ fontSize: 13, color: "var(--sub)" }}>{m.note}</div>}</div>
                <ChevronRight size={16} style={{ color: "var(--faint)" }} />
              </button>
            ))}
          </div>
          {addMemberOpen ? (
            <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
              <input autoFocus value={mName} onChange={(e) => setMName(e.target.value)} placeholder="First name" style={{ width: "100%", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px 13px", color: "var(--text)", fontSize: 15, fontFamily: FONT_BODY, boxSizing: "border-box", marginBottom: 10 }} />
              <input value={mNote} onChange={(e) => setMNote(e.target.value)} placeholder="Note (e.g. son, age 8)" style={{ width: "100%", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px 13px", color: "var(--text)", fontSize: 15, fontFamily: FONT_BODY, boxSizing: "border-box", marginBottom: 12 }} />
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => { setAddMemberOpen(false); setMName(""); setMNote(""); }} style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", color: "var(--text)", padding: 11, borderRadius: 10, fontSize: 14 }}>Cancel</button>
                <button className="lift" onClick={addFamilyMember} disabled={!mName.trim()} style={{ flex: 1, background: mName.trim() ? "var(--gold)" : "var(--panel)", color: mName.trim() ? "var(--on-gold)" : "var(--faint)", padding: 11, borderRadius: 10, fontSize: 14, fontWeight: 600 }}>Add</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddMemberOpen(true)} className="lift" style={{ width: "100%", background: "transparent", border: "1px dashed var(--border2)", borderRadius: 12, padding: 14, color: "var(--text)", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Plus size={16} /> Add family member</button>
          )}
        </div>
      )}

      {/* FAMILY MEMBER MINI-PROFILE */}
      {pfTab === "family" && openMember && (() => {
        const m = family.find((x) => x.id === openMember);
        if (!m) { setOpenMember(null); return null; }
        const setMember = (patch) => setClients(clients.map((c) => c.id === live.id ? { ...c, family: (c.family || []).map((fm) => fm.id === m.id ? { ...fm, ...patch } : fm) } : c));
        return (
          <div style={{ marginBottom: 28 }}>
            <button onClick={() => setOpenMember(null)} style={{ background: "none", color: "var(--sub)", display: "flex", alignItems: "center", gap: 6, fontSize: 14.5, marginBottom: 18 }}><ArrowLeft size={15} /> Back to family</button>
            <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 20 }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--panel2)", color: "var(--text)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontSize: 20, flexShrink: 0 }}>{m.name.charAt(0)}</div>
              <div><div style={{ fontFamily: FONT_DISPLAY, fontSize: 23, fontWeight: 500, lineHeight: 1.1 }}>{m.name}</div>{m.note && <div style={{ fontSize: 13.5, color: "var(--sub)" }}>{m.note}</div>}</div>
            </div>
            <div style={{ fontSize: 13, letterSpacing: 2, color: "var(--faint)", marginBottom: 8 }}>NOTE</div>
            <textarea value={m.note || ""} onChange={(e) => setMember({ note: e.target.value })} placeholder="Anything to remember about this person…" rows={3} style={{ width: "100%", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", color: "var(--text)", fontSize: 14.5, fontFamily: FONT_BODY, lineHeight: 1.55, resize: "vertical", boxSizing: "border-box", marginBottom: 22 }} />
            <div style={{ fontSize: 13, letterSpacing: 2, color: "var(--faint)", marginBottom: 10 }}>PHOTOS</div>
            {(m.gallery || []).length === 0 ? (
              <p style={{ fontSize: 14, color: "var(--faint)", fontStyle: "italic", marginBottom: 22 }}>No photos yet for {m.name}.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 22 }}>
                {(m.gallery || []).map((g) => (
                  <div key={g.id} style={{ aspectRatio: "1", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}><img src={imgUrl(g.photo, 300)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /></div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 13, letterSpacing: 2, color: "var(--faint)", marginBottom: 8 }}>VISIT HISTORY</div>
            {(() => { const mh = (appts || []).filter((a) => a.familyMemberId === m.id && a.serviceId && a.status !== "block"); return mh.length === 0
              ? <p style={{ fontSize: 14, color: "var(--faint)", fontStyle: "italic", marginBottom: 22 }}>No visits just yet — their story starts here.</p>
              : <div style={{ display: "grid", gap: 8, marginBottom: 22 }}>{mh.map((a) => (<div key={a.id} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px 14px" }}><div style={{ fontSize: 14.5 }}>{a.title}</div><div style={{ fontSize: 13, color: "var(--sub)" }}>{fmtTime(a.start)} – {fmtTime(a.end)}</div></div>))}</div>; })()}
            <button onClick={() => removeFamilyMember(m.id)} style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", color: "var(--sub)", padding: 12, fontSize: 14, letterSpacing: 1, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Trash2 size={16} /> Remove {m.name}</button>
          </div>
        );
      })()}
    </div>
  );
}

function MessagesView({ clients, setClients, providers, msgTarget, clearTarget, onOpenClient }) {
  const [activeId, setActiveId] = useState(null); // null = list view
  const [draft, setDraft] = useState("");
  // jump straight into a conversation when sent from the waitlist
  useEffect(() => {
    if (msgTarget) { setActiveId(msgTarget.clientId); setDraft(msgTarget.draft || ""); if (clearTarget) clearTarget(); }
  }, [msgTarget]);
  const active = clients.find((c) => c.id === activeId);
  const send = () => { if (!draft.trim()) return; const now = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); setClients(clients.map((c) => c.id === activeId ? { ...c, messages: [...(c.messages || []), { from: "shop", text: draft, time: now }] } : c)); setDraft(""); };
  const provColor = (c) => (providers.find((p) => p.id === c.provider)?.color) || "var(--gold)";

  // ---- conversation list ----
  if (!active) {
    const totalUnread = clients.filter((c) => { const m = (c.messages || []); return m.length && m[m.length - 1].from === "client"; }).length;
    return (
      <div className="fade-up">
        <div style={{ marginBottom: 22 }}>
          <div style={{ width: 32, height: 1.5, background: "var(--gold)", marginBottom: 14 }} />
          <div style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--gold)", marginBottom: 8, fontWeight: 600 }}>{totalUnread > 0 ? `${totalUnread} UNREAD` : "ALL CAUGHT UP"}</div>
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 42, fontWeight: 500, letterSpacing: -0.6, lineHeight: 0.95, marginBottom: 8 }}>Messages</h2>
          <p style={{ color: "var(--sub)", fontSize: 14.5, fontWeight: 400, lineHeight: 1.5 }}>Your studio line. Tap a client to open the conversation.</p>
        </div>
        <div style={{ display: "grid", gap: 2, border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
          {clients.map((c) => {
            const msgs = c.messages || [];
            const last = msgs[msgs.length - 1];
            const unread = last && last.from === "client";
            return (
              <button key={c.id} className="lift" onClick={() => setActiveId(c.id)} style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--panel)", padding: "15px 16px", textAlign: "left", color: "var(--text)", borderBottom: "1px solid var(--line)" }}>
                <div onClick={(e) => { e.stopPropagation(); if (onOpenClient) onOpenClient(c); }} style={{ flexShrink: 0, cursor: "pointer" }} aria-label={`Open ${c.name}'s profile`}>
                  <Avatar size={46} photo={clientPhoto(c)} initial={c.name.charAt(0)} color={provColor(c)} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 15.5, fontWeight: unread ? 600 : 500 }}>{c.name}</span>
                    {last && <span style={{ fontSize: 15.5, color: "var(--faint)", flexShrink: 0 }}>{last.time}</span>}
                  </div>
                  <div style={{ fontSize: 15, color: unread ? "var(--text2)" : "var(--sub)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: unread ? 500 : 300, marginTop: 2 }}>{last ? (last.from === "shop" ? "You: " : "") + last.text : "No messages yet"}</div>
                </div>
                {unread && <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--gold)", flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ---- single conversation thread (full width) ----
  const msgs = active.messages || [];
  const lastMine = [...msgs].reverse().find((m) => m.from === "shop");
  return (
    <div className="fade-up" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 215px)", minHeight: 440, margin: "0 -20px", marginBottom: -96 }}>
      {/* iMessage-style centered header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 12px", borderBottom: "1px solid var(--line)", position: "relative" }}>
        <button onClick={() => setActiveId(null)} style={{ background: "none", color: "#0A84FF", display: "flex", alignItems: "center", fontSize: 15, position: "absolute", left: 6, top: 8, zIndex: 2 }}><ChevronLeft size={26} /></button>
        <button onClick={() => { if (onOpenClient) onOpenClient(active); }} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, background: "none", border: "none", color: "var(--text)", padding: 0, cursor: "pointer" }} aria-label={`Open ${active.name}'s profile`}>
          <Avatar size={50} photo={clientPhoto(active)} initial={active.name.charAt(0)} color={provColor(active)} />
          <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 14.5, color: "var(--text)" }}>{active.name.split(" ")[0]} <ChevronRight size={13} style={{ color: "var(--faint)" }} /></div>
        </button>
      </div>

      <div style={{ flex: 1, padding: "14px 14px 8px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", background: "var(--bg)" }}>
        <div style={{ textAlign: "center", fontSize: 13, color: "var(--faint)", margin: "4px 0 12px" }}><b style={{ color: "var(--sub)" }}>iMessage</b> · Today {msgs[0]?.time || ""}</div>
        {msgs.length === 0 && <div style={{ color: "var(--faint)", fontSize: 14, textAlign: "center", margin: "auto" }}>No messages yet. Say hello.</div>}
        {msgs.map((m, i) => {
          const mine = m.from === "shop";
          const prev = msgs[i - 1];
          const next = msgs[i + 1];
          const firstOfGroup = !prev || prev.from !== m.from;
          const lastOfGroup = !next || next.from !== m.from;
          const isLastMine = mine && m === lastMine;
          return (
            <div key={i} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "75%", marginTop: firstOfGroup ? 8 : 1 }}>
              <div style={{
                background: mine ? "#0A84FF" : "var(--panel2)", color: mine ? "#FFFFFF" : "var(--text)",
                border: mine ? "none" : "1px solid var(--border)", padding: "8px 14px", fontSize: 16, lineHeight: 1.3,
                borderRadius: 19,
                borderBottomRightRadius: mine ? (lastOfGroup ? 5 : 19) : 19,
                borderTopRightRadius: mine ? (firstOfGroup ? 19 : 5) : 19,
                borderBottomLeftRadius: mine ? 19 : (lastOfGroup ? 5 : 19),
                borderTopLeftRadius: mine ? 19 : (firstOfGroup ? 19 : 5),
              }}>{m.text}</div>
              {isLastMine && <div style={{ fontSize: 13, color: "var(--faint)", marginTop: 3, textAlign: "right", paddingInline: 4, fontWeight: 500 }}>Delivered</div>}
            </div>
          );
        })}
      </div>

      <div style={{ padding: "10px 12px calc(12px + env(safe-area-inset-bottom))", borderTop: "1px solid var(--line)", display: "flex", gap: 8, alignItems: "center", background: "var(--bg)" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: 20 }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="iMessage" style={{ flex: 1, background: "none", border: "none", padding: "9px 14px", color: "var(--text)", fontSize: 16 }} />
          {draft.trim() && <button className="lift" onClick={send} style={{ background: "#0A84FF", color: "#fff", width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginRight: 4 }}><Send size={15} /></button>}
        </div>
      </div>
    </div>
  );
}
