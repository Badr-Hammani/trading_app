import type { DataResult, InstrumentSpec } from '@xau/core';
import { ok, unavailable, XAUUSD_DEFAULT_SPEC } from '@xau/core';
import type { BrokerAccount, BrokerProvider, ProviderInfo } from '../types.js';

/**
 * Broker metadata, read-only.
 *
 * Version 1 has no order execution anywhere in the codebase. This provider
 * supplies the contract specification the risk calculator needs and nothing
 * more.
 */
export class ManualBrokerProvider implements BrokerProvider {
  readonly info: ProviderInfo = {
    id: 'manual',
    name: 'Manual account settings',
    configured: true,
    setupHint:
      'Balance and contract specification are entered under Settings → Account. Confirm the spec against your broker.',
  };

  constructor(
    private readonly account: { balance: number; currency: string } | null,
    private readonly specs: Record<string, InstrumentSpec> = { XAUUSD: XAUUSD_DEFAULT_SPEC },
  ) {}

  async getAccount(): Promise<DataResult<BrokerAccount>> {
    if (!this.account) {
      return unavailable('manual', 'not-configured', 'Set your account balance under Settings → Account.');
    }
    return ok(
      {
        id: 'manual',
        currency: this.account.currency,
        balance: this.account.balance,
        equity: null,
        marginAvailable: null,
        provider: 'manual',
      },
      'manual',
    );
  }

  async getInstrumentSpec(symbol: string): Promise<DataResult<InstrumentSpec>> {
    const spec = this.specs[symbol];
    if (!spec) {
      return unavailable(
        'manual',
        'no-data',
        `No contract specification stored for ${symbol}. Add one under Settings → Instruments.`,
      );
    }
    return ok(spec, 'manual');
  }
}
