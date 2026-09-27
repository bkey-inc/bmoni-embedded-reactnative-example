/**
 * Pins each request to the documented contract (method, path, body) at
 * https://embedded-dev.bmoni.com/docs.
 */
import { ProxyApiClient } from '../src/proxyClient';

const client = new ProxyApiClient('https://proxy.test', 'k');

type Call = { method: string; path: string; body?: unknown; init: RequestInit };

async function capture(run: () => Promise<unknown>): Promise<Call> {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => '{}',
  }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await run();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  const body =
    typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
  return {
    method: init.method ?? 'GET',
    path: new URL(url).pathname,
    body,
    init,
  };
}

describe('documented request contracts', () => {
  it('workflow status', async () => {
    const c = await capture(() =>
      client.getWorkflowStatus({ userId: 'u', workflowId: 'wf' }),
    );
    expect([c.method, c.path]).toEqual([
      'GET',
      '/v1/users/u/wallets/workflows/wf',
    ]);
    expect((c.init.headers as Record<string, string>)['x-api-key']).toBe('k');
  });

  it('LATAM foreign bank payout', async () => {
    const c = await capture(() =>
      client.createLatamForeignPayout({
        userId: 'u',
        smartWalletId: 'w',
        usdcAmount: '25',
        targetCountry: 'MX',
        targetCurrency: 'MXN',
        description: 'rent',
      }),
    );
    expect([c.method, c.path]).toEqual([
      'POST',
      '/v1/users/u/latam/cash/payouts/foreign',
    ]);
    expect(c.body).toEqual({
      smartWalletId: 'w',
      usdcAmount: '25',
      targetCountry: 'MX',
      targetCurrency: 'MXN',
      description: 'rent',
    });
  });

  it('Mexico: launch, start-mexico, MXNe migration, offramp quote', async () => {
    expect((await capture(() => client.getMxKycLaunch('u'))).path).toBe(
      '/v1/users/u/latam/mx/kyc/launch/agreements',
    );
    const start = await capture(() =>
      client.startMexicoOnboarding({ userId: 'u', mxnWalletAddress: '0xa' }),
    );
    expect([start.method, start.path]).toEqual([
      'POST',
      '/v1/users/u/onboarding/start-mexico',
    ]);
    expect(start.body).toEqual({ mxnWalletAddress: '0xa', mxnWalletIndex: 0 });
    expect((await capture(() => client.getMxneMigrationStatus('u'))).path).toBe(
      '/v1/users/u/latam/mx/mxne-migration/status',
    );
    const prep = await capture(() => client.prepareMxneMigration('u'));
    expect([prep.method, prep.path]).toEqual([
      'POST',
      '/v1/users/u/latam/mx/mxne-migration/prepare',
    ]);
    const quote = await capture(() =>
      client.createMxOfframpQuote({ userId: 'u', sourceAmount: '500' }),
    );
    expect(quote.body).toEqual({ type: 'offramp', sourceAmount: '500' });
  });

  it('bank rails: USD wallet provision, VBA link, deposit accounts', async () => {
    const prov = await capture(() =>
      client.provisionSmartWalletUsdVba({ userId: 'u', smartWalletId: 'w' }),
    );
    expect([prov.method, prov.path]).toEqual([
      'POST',
      '/v1/users/u/smart-wallets/w/onramp/vba/usd/provision',
    ]);
    const link = await capture(() =>
      client.linkDepositVba({
        userId: 'u',
        smartWalletId: 'w',
        region: 'nigeria',
        bankAccountId: 'b',
      }),
    );
    expect(link.path).toBe('/v1/users/u/smart-wallets/w/onramp/vba/nigeria');
    expect(link.body).toEqual({ bankAccountId: 'b' });
    expect(
      (await capture(() => client.getDepositAccounts('u', 'MXN'))).path,
    ).toBe('/v1/users/u/bank-accounts/deposit-accounts/MXN');
  });

  it('exchange/convert sends a numeric amount', async () => {
    const c = await capture(() =>
      client.convertCurrency({
        userId: 'u',
        amount: 12.5,
        from: 'USD',
        to: 'NGN',
      }),
    );
    expect(c.body).toEqual({ amount: 12.5, from: 'USD', to: 'NGN' });
  });

  it('biometric upload sends `selfie` + type', async () => {
    const c = await capture(() =>
      client.uploadKycBiometric({
        userId: 'u',
        file: { uri: 'file:///s.jpg', name: 's.jpg', type: 'image/jpeg' },
      }),
    );
    expect(c.path).toBe('/v1/users/u/kyc/documents/biometric');
    const form = c.body as { get(key: string): unknown };
    expect(form.get('type')).toBe('selfie');
    expect(form.get('selfie')).toBeTruthy();
    expect(form.get('files')).toBeNull();
  });
});
