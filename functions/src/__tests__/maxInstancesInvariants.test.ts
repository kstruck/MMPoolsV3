import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 2026-08-23 cloud audit: nothing capped function fan-out, so a retry storm
 * could scale to the project default with an unbounded bill. The cap lives in
 * lib/globalOptions.ts (v2) + inline runWith on the three v1 triggers.
 */
const SRC = join(__dirname, "..");

describe("maxInstances caps", () => {
    it("globalOptions sets a v2 maxInstances cap", () => {
        const text = readFileSync(join(SRC, "lib", "globalOptions.ts"), "utf8");
        expect(text).toMatch(/setGlobalOptions\(\s*\{[^}]*maxInstances:\s*\d+/);
    });

    it("index.ts loads globalOptions before anything else", () => {
        const text = readFileSync(join(SRC, "index.ts"), "utf8");
        const firstImport = text.match(/^import .*$/m)?.[0] ?? "";
        expect(firstImport).toContain("./lib/globalOptions");
    });

    it("every v1 trigger carries its own runWith maxInstances", () => {
        for (const f of ["userSync.ts", "announcements.ts", "participant.ts"]) {
            const text = readFileSync(join(SRC, f), "utf8");
            // Definition sites are `= functions.<...>` / `= v1.<...>`; a bare one
            // (no runWith between the namespace and the trigger builder) is uncapped.
            // Type references like `functions.firestore.QueryDocumentSnapshot`
            // never follow `= `, so they don't trip this.
            const bare = text.match(/= (functions|v1)\.(auth|firestore)[.\s]/g) ?? [];
            expect(bare, `${f}: v1 trigger without runWith maxInstances: ${bare.join(", ")}`).toEqual([]);
            expect(text, `${f}: expected at least one runWith maxInstances cap`).toMatch(/runWith\(\{ maxInstances: \d+ \}\)/);
        }
    });
});
