// 2026 NFL pool creation is OPEN. Flipped for the Monday 2026-08-25 invites
// (PLAN-WIZARD-BUYFLOW-FIXES G1 / D6). This is a BUILD-TIME constant: changing
// it needs a Coolify `www` rebuild to take effect, and rolling back is another
// commit plus another rebuild. Prerequisite, already merged: T6a's G2 fix, or a
// logged-out visitor clicking the now-enabled create CTA hits a silent bounce.
export const POOLS_OPEN = true;
