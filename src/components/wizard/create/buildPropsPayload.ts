import { writePaymentHandles, CLEAR } from '@shared/paymentHandles';

// Maps validated wizard values to the PROPS pool payload for dbService.createPool.
// Fee is props.cost. Questions with empty text are dropped; option lists are
// trimmed of blanks. The callable stamps server-only fields.
function dropUndefined<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function buildPropsPayload(values: Record<string, unknown>): Record<string, unknown> {
  const v = values as Record<string, any>;

  const hp = writePaymentHandles(v.paymentHandles);
  const legacyHandles: Record<string, string> = {};
  (['venmo', 'zelle', 'cashapp', 'paypal'] as const).forEach((k) => {
    const val = hp[k];
    if (val && val !== CLEAR) legacyHandles[k] = val as string;
  });

  const rawQuestions: any[] = Array.isArray(v.props?.questions) ? v.props.questions : [];
  const questions = rawQuestions
    .filter((q) => q && typeof q.text === 'string' && q.text.trim() !== '')
    .map((q) => ({
      text: String(q.text).trim(),
      options: (Array.isArray(q.options) ? q.options : []).map((o: unknown) => String(o).trim()).filter(Boolean),
    }));

  return dropUndefined({
    type: 'PROPS',
    name: v.name,
    props: {
      cost: Number(v.props?.cost ?? 0),
      maxCards: Number(v.props?.maxCards ?? 1),
      questions,
    },
    homeTeam: v.homeTeam || undefined,
    awayTeam: v.awayTeam || undefined,
    gameId: v.gameId || undefined,
    theme: v.theme || 'default',
    managerName: v.managerName || undefined,
    contactEmail: v.contactEmail || undefined,
    ...legacyHandles,
    paymentHandles: hp.paymentHandles,
    paymentInstructions: v.paymentInstructions || undefined,
    branding: v.branding,
    isPublic: v.isPublic ?? true,
  });
}
