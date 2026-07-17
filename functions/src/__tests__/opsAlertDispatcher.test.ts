import { describe, it, expect, vi, beforeEach } from "vitest";

const secretValue = vi.fn(() => "fake-courier-token");
vi.mock("firebase-functions/params", () => ({
    defineSecret: () => ({ value: secretValue }),
}));

const fetchMock = vi.fn(async (_url?: string, _init?: unknown) => ({ ok: true, status: 200, text: async () => "{}" }));
vi.stubGlobal("fetch", fetchMock);

function fakeDb(configDoc: Record<string, unknown> | undefined, addSpy: (col: string, doc: unknown) => void) {
    return {
        doc: (path: string) => ({
            get: async () => ({ data: () => configDoc }),
        }),
        collection: (name: string) => ({
            add: async (doc: unknown) => {
                addSpy(name, doc);
                return { id: "fake" };
            },
        }),
    } as any;
}

describe("dispatchOpsAlert", () => {
    beforeEach(() => {
        fetchMock.mockClear();
        secretValue.mockClear();
        secretValue.mockReturnValue("fake-courier-token");
    });

    it("no-ops when system/config has no opsAlerts field", async () => {
        const { dispatchOpsAlert } = await import("../lib/opsAlertDispatcher");
        const addSpy = vi.fn();
        const db = fakeDb({}, addSpy);
        await dispatchOpsAlert(db, { type: "WEBHOOK_FAILED", title: "t", message: "m" });
        expect(addSpy).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("no-ops (fail-safe) when the config read throws", async () => {
        const { dispatchOpsAlert } = await import("../lib/opsAlertDispatcher");
        const db = {
            doc: () => ({ get: async () => { throw new Error("firestore down"); } }),
        } as any;
        await expect(
            dispatchOpsAlert(db, { type: "PAYMENT_FAILED", title: "t", message: "m" })
        ).resolves.toBeUndefined();
    });

    it("emails all configured recipients regardless of alert type", async () => {
        const { dispatchOpsAlert } = await import("../lib/opsAlertDispatcher");
        const addSpy = vi.fn();
        const db = fakeDb(
            { opsAlerts: { emailRecipients: ["ops@example.com", "kevin@example.com"], smsRecipients: [] } },
            addSpy
        );
        await dispatchOpsAlert(db, { type: "REFUND", title: "Refund", message: "refunded" });
        expect(addSpy).toHaveBeenCalledTimes(2);
        expect(addSpy.mock.calls[0][0]).toBe("mail");
        expect(fetchMock).not.toHaveBeenCalled(); // REFUND is not high-priority — no SMS
    });

    it("SMS-pages only for the high-priority alert set", async () => {
        const { dispatchOpsAlert } = await import("../lib/opsAlertDispatcher");
        const addSpy = vi.fn();
        const db = fakeDb(
            { opsAlerts: { emailRecipients: ["ops@example.com"], smsRecipients: ["+15551234567"] } },
            addSpy
        );
        await dispatchOpsAlert(db, { type: "WEBHOOK_FAILED", title: "Webhook down", message: "failing" });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe("https://api.courier.com/send");

        fetchMock.mockClear();
        await dispatchOpsAlert(db, { type: "DOUBLE_CHARGE_REVIEW", title: "Double charge", message: "review" });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("never throws even if the Courier fetch itself throws", async () => {
        const { dispatchOpsAlert } = await import("../lib/opsAlertDispatcher");
        fetchMock.mockImplementationOnce(async () => { throw new Error("network down"); });
        const addSpy = vi.fn();
        const db = fakeDb(
            { opsAlerts: { emailRecipients: [], smsRecipients: ["+15551234567"] } },
            addSpy
        );
        await expect(
            dispatchOpsAlert(db, { type: "SITE_DOWN", title: "Down", message: "down" })
        ).resolves.toBeUndefined();
    });
});
