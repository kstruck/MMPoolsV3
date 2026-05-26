import { vi } from 'vitest';

export const mockCreateSession = vi.fn().mockResolvedValue({
    id: 'sess_123',
    url: 'https://checkout.stripe.com/pay/mock_session_123'
});

export class Stripe {
    constructor(key: string, config?: any) {}
    checkout = {
        sessions: {
            create: mockCreateSession
        }
    };
}

export default Stripe;
