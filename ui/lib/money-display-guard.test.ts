import { it, expect } from 'vitest';
import { checkMoneyDisplay } from '@erplora/module-toolkit/money-display-guard';

// GUARD (pm#289, shared since pm#505/pm#508): money on screen is never formatted by hand in this
// module, and OutfitKit comes in by entry point, never as a value from the barrel.
//
// The rules live in `@erplora/module-toolkit/money-display-guard` (one piece for every module,
// tested there against its own positives); this test only says what is specific to Citas:
//
// * notDisplay — none: this module paints no amount today. `service_price` (INTEGER minor units in
//   migrations/) only travels to the charge, never to a screen; any future one goes through
//   `erplora().formatMoney(minor)` or `<ok-money>`.
// * witnesses — with no amount painted, an empty scan proves nothing by itself: the code the
//   detector reads (comments stripped) must still carry `service_price` in the two screens that
//   hold it (the appointments list and the customer's appointment history, where an amount would
//   be painted first) and the date/time formatters of `lib/`, where a shared money helper would
//   land first (rv-appointments-226, rv-taxes-78).
// * outfitkitImporters — each of the four screens imports OutfitKit (entry points + types), so the
//   barrel scan provably read all four.
it('money on screen goes through the shared formatter and OutfitKit by entry point (pm#289)', () => {
  expect(
    checkMoneyDisplay({
      from: import.meta.url,
      witnesses: {
        'components/erp-appointments-list/erp-appointments-list.ts': { text: 'service_price', atLeast: 2 },
        'components/erp-appointments-customer-history/erp-appointments-customer-history.ts': 'service_price',
        'lib/business-time.ts': 'export function formatWallTime(',
        'lib/typed-start.ts': 'export function formatTypedDate(',
      },
      notDisplay: {},
      outfitkitImporters: [
        'components/erp-appointments-list/erp-appointments-list.ts',
        'components/erp-appointments-customer-history/erp-appointments-customer-history.ts',
        'components/erp-appointments-history/erp-appointments-history.ts',
        'components/erp-appointments-series/erp-appointments-series.ts',
      ],
    }),
  ).toEqual([]);
});
