import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 2026-08-25 deploy failure: `cspReport` shipped with `memory: "128MiB"` and the
 * deploy failed it with
 *
 *   Could not create or update Cloud Run service cspreport, Container
 *   Healthcheck failed. The user-provided container failed to start and listen
 *   on the port defined provided by the PORT=8080 environment variable within
 *   the allocated timeout.
 *
 * while all ~190 other functions in the same deploy succeeded.
 *
 * WHY 128MiB CANNOT WORK HERE, EVEN FOR A HANDLER THAT ONLY COUNTS. Every
 * function in this codebase is served from ONE container image, and that image
 * loads the whole `index.ts` module graph on cold start — firebase-admin,
 * stripe, the schemas, all of it — before the handler is ever reached. The
 * memory floor is therefore set by the BUNDLE, not by what an individual
 * handler does. Sizing a function from the handler's own workload is the exact
 * reasoning that produced the failure, and it looks correct right up until the
 * deploy.
 *
 * The floor is 256MiB because that is what every other HTTP endpoint in this
 * repo already uses and boots on: joinPreview, readiness, emailUnsubscribeHttp,
 * emailPrefsPage, revenueAggregates. It is also the Gen-2 default, so a function
 * with no `memory` option at all is already above the floor and needs no entry.
 *
 * This guard is a source scan rather than a runtime check because the failure
 * happens at DEPLOY time, in Cloud Run, where no test runs.
 */
const SRC = join(__dirname, "..");

/** Every `memory: "<value>"` in a non-test source file, with its file. */
function memoryOptions(dir: string, out: { file: string; value: string }[] = []) {
    for (const entry of readdirSync(dir)) {
        if (entry === "__tests__" || entry === "node_modules" || entry === "shared") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            memoryOptions(full, out);
            continue;
        }
        if (!entry.endsWith(".ts")) continue;
        const text = readFileSync(full, "utf8");
        // BOTH quote styles. codex r1 [P2]: the first version of this matched
        // only double quotes, and four live options in this repo are
        // single-quoted (nflSchedule.ts x2, nflAutoScore.ts, backfillProfileData.ts).
        // A future `memory: '128MiB'` would have sailed past a guard that
        // claimed a GLOBAL floor — a guard that looks like it guards and does not.
        for (const m of text.matchAll(/memory:\s*(["'])(\d+)(MiB|GiB)\1/g)) {
            out.push({ file: entry, value: `${m[2]}${m[3]}` });
        }
    }
    return out;
}

/** MiB, so GiB and MiB are comparable. */
function toMiB(value: string): number {
    const m = /^(\d+)(MiB|GiB)$/.exec(value);
    if (!m) throw new Error(`unparsable memory value: ${value}`);
    return m[2] === "GiB" ? Number(m[1]) * 1024 : Number(m[1]);
}

const FLOOR_MIB = 256;

describe("Cloud Functions memory floor", () => {
    it("the scanner finds the memory options that exist", () => {
        // Without this the suite passes vacuously if the scan or the regex breaks,
        // which is how a guard quietly stops guarding.
        const found = memoryOptions(SRC);
        expect(found.length, "no memory: options found — this guard is inert").toBeGreaterThan(10);
        expect(found.some((f) => f.file === "cspReport.ts")).toBe(true);
        // The single-quoted hole codex found, pinned so it cannot reopen: if the
        // regex regresses to double-quotes-only, these files vanish from the scan
        // and the floor check silently stops covering them.
        for (const f of ["nflSchedule.ts", "nflAutoScore.ts", "backfillProfileData.ts"]) {
            expect(
                found.some((x) => x.file === f),
                `${f} has a single-quoted memory option — the scanner must see it`,
            ).toBe(true);
        }
    });

    it("no function is sized below the 256MiB bundle floor", () => {
        const under = memoryOptions(SRC)
            .filter((f) => toMiB(f.value) < FLOOR_MIB)
            .map((f) => `${f.file}: ${f.value}`);
        expect(
            under,
            `Sized below ${FLOOR_MIB}MiB. Every function shares one container image ` +
                "that loads the entire index.ts module graph on cold start, so the floor " +
                "is set by the bundle, not by the handler. 128MiB failed the 2026-08-25 " +
                'deploy with "Container Healthcheck failed … failed to start and listen ' +
                'on … PORT=8080". Raise it, or move the handler out of this codebase.',
        ).toEqual([]);
    });

    it("toMiB compares GiB against MiB rather than string-sorting them", () => {
        // 1GiB must not read as smaller than 256MiB just because "1" < "2".
        expect(toMiB("1GiB")).toBe(1024);
        expect(toMiB("256MiB")).toBe(256);
        expect(toMiB("1GiB")).toBeGreaterThan(toMiB("512MiB"));
        expect(() => toMiB("128")).toThrow();
    });
});
