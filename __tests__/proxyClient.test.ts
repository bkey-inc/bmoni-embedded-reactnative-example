/**
 * The discovery endpoints and provider payloads are shaped differently by
 * different gateways, and the onboarding bodies differ per currency. These cover
 * the shapes the tolerant parsers are built for.
 */

import {
  currencyByKey,
  currencyFromSmartWalletCurrency,
  extractSignableHash,
  flattenDepositAssets,
  normalizeBaseUrl,
  onboardingStartBody,
  onboardingStatusFor,
  parseNigerianBanks,
  parseSupportedCurrencies,
  ProxyApiError,
  readProposalId,
  smartWalletFromPayload,
  sumsubLevelFor,
  usesGlobalKyc,
  WALLET_CURRENCIES,
  type SmartWallet,
} from '../src/proxyClient';

const wallet: SmartWallet = {
  id: 'wallet-1',
  currency: 'CNGN',
  status: 'active',
  isActive: true,
  walletAddress: '0xabc',
  smartAccountAddress: '0xabc',
};

describe('parseSupportedCurrencies', () => {
  it('reads a plain array', () => {
    expect(parseSupportedCurrencies(['USDB', 'CNGN', 'MEXe'])).toEqual([
      'USDB',
      'CNGN',
      'MEXe',
    ]);
  });

  it('reads a data envelope and object rows, de-duplicating', () => {
    expect(
      parseSupportedCurrencies({
        data: [{currency: 'USDB'}, {code: 'EURe'}, {currency: 'USDB'}],
      }),
    ).toEqual(['USDB', 'EURe']);
  });

  it('returns empty for unusable payloads', () => {
    expect(parseSupportedCurrencies(null)).toEqual([]);
    expect(parseSupportedCurrencies('USDB')).toEqual([]);
    expect(parseSupportedCurrencies({nope: 1})).toEqual([]);
  });
});

describe('flattenDepositAssets', () => {
  it('flattens chain groups with a currency list', () => {
    expect(
      flattenDepositAssets([
        {chain: 'Base', currencies: ['USDC', 'USDT']},
        {chain: 'Ethereum', currencies: ['DAI']},
      ]),
    ).toEqual([
      {chain: 'Base', currency: 'USDC'},
      {chain: 'Base', currency: 'USDT'},
      {chain: 'Ethereum', currency: 'DAI'},
    ]);
  });

  it('flattens flat chain+currency rows under a data envelope', () => {
    expect(
      flattenDepositAssets({
        data: [
          {chain: 'Base', currency: 'USDC'},
          {network: 'Polygon', currency: 'EURC'},
        ],
      }),
    ).toEqual([
      {chain: 'Base', currency: 'USDC'},
      {chain: 'Polygon', currency: 'EURC'},
    ]);
  });

  it('flattens a chain-keyed map and de-duplicates', () => {
    expect(
      flattenDepositAssets({Base: ['USDC', 'USDC'], Solana: [{symbol: 'USDT'}]}),
    ).toEqual([
      {chain: 'Base', currency: 'USDC'},
      {chain: 'Solana', currency: 'USDT'},
    ]);
  });

  it('drops rows missing a chain or a token', () => {
    expect(
      flattenDepositAssets([
        {currency: 'USDC'},
        {chain: 'Base'},
        {chain: '  ', currency: 'USDC'},
      ]),
    ).toEqual([]);
  });
});

describe('parseNigerianBanks', () => {
  it('accepts either field spelling', () => {
    expect(
      parseNigerianBanks({
        banks: [
          {name: 'Guaranty Trust Bank', code: '058'},
          {bankName: 'Access Bank', bankCode: '044'},
        ],
      }),
    ).toEqual([
      {name: 'Guaranty Trust Bank', code: '058'},
      {name: 'Access Bank', code: '044'},
    ]);
  });

  it('skips rows without both a name and a code', () => {
    expect(
      parseNigerianBanks([{name: 'No code bank'}, {code: '058'}]),
    ).toEqual([]);
  });
});

describe('extractSignableHash', () => {
  const hash =
    '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8';

  it('finds the digest at the top level and when nested', () => {
    expect(extractSignableHash({hashToSign: hash})).toBe(hash);
    expect(
      extractSignableHash({data: {signatureRequest: {hashToSign: hash}}}),
    ).toBe(hash);
    expect(extractSignableHash({signingPayloadHash: hash})).toBe(hash);
  });

  it('rejects anything that is not a 32-byte hex digest', () => {
    expect(extractSignableHash({hashToSign: '0x1234'})).toBeUndefined();
    expect(extractSignableHash({hashToSign: hash.slice(2)})).toBeUndefined();
    expect(extractSignableHash({other: hash})).toBeUndefined();
    expect(extractSignableHash(null)).toBeUndefined();
  });
});

describe('readProposalId', () => {
  it('unwraps the data envelope', () => {
    expect(
      readProposalId({data: {proposalId: 'prop-1', status: 'PENDING_APPROVALS'}}),
    ).toBe('prop-1');
    expect(readProposalId({status: 'PENDING'})).toBeUndefined();
  });
});

describe('smartWalletFromPayload', () => {
  it('unwraps a nested wallet and derives the status', () => {
    expect(
      smartWalletFromPayload({
        smartWallet: {id: 'w1', currency: 'USDB', isActive: false},
      }),
    ).toMatchObject({id: 'w1', currency: 'USDB', status: 'preparing'});
  });

  it('keeps an explicit status and falls back across address fields', () => {
    expect(
      smartWalletFromPayload({
        id: 'w2',
        status: 'deploying',
        safeAddress: '0xdef',
      }),
    ).toMatchObject({status: 'deploying', walletAddress: '0xdef'});
  });
});

describe('normalizeBaseUrl', () => {
  it('strips a trailing /v1 so paths do not double up', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1', '/v1/users')).toBe(
      'https://api.example.com',
    );
    expect(normalizeBaseUrl('https://api.example.com/', '/v1/users')).toBe(
      'https://api.example.com',
    );
    expect(normalizeBaseUrl('https://api.example.com', '/v1/users')).toBe(
      'https://api.example.com',
    );
  });
});

describe('onboardingStartBody', () => {
  it('sends only the wallet id for USD', () => {
    expect(onboardingStartBody(currencyByKey('usd'), wallet)).toEqual({
      smartWalletId: 'wallet-1',
    });
  });

  it('sends no body for MXN', () => {
    expect(onboardingStartBody(currencyByKey('mxn'), wallet)).toEqual({});
  });

  it('binds the on-chain address for CAD and EUR', () => {
    expect(onboardingStartBody(currencyByKey('cad'), wallet)).toEqual({
      cadWalletAddress: '0xabc',
      cadWalletIndex: 0,
    });
    expect(onboardingStartBody(currencyByKey('eur'), wallet)).toEqual({
      eurWalletAddress: '0xabc',
      eurWalletIndex: 0,
    });
  });

  it('requires an 11-digit BVN for Nigeria', () => {
    expect(
      onboardingStartBody(currencyByKey('ngn'), wallet, '22222222222'),
    ).toEqual({
      bvn: '22222222222',
      ngnWalletAddress: '0xabc',
      ngnWalletIndex: 0,
    });
    expect(() =>
      onboardingStartBody(currencyByKey('ngn'), wallet, '123'),
    ).toThrow(ProxyApiError);
  });

  it('refuses a wallet with no on-chain address', () => {
    expect(() =>
      onboardingStartBody(currencyByKey('eur'), {...wallet, walletAddress: undefined, smartAccountAddress: undefined, safeAddress: undefined}),
    ).toThrow(ProxyApiError);
  });
});

describe('onboardingStatusFor', () => {
  it('maps each rail to its status key', () => {
    const status = {
      paytrieStatus: 'active',
      moneriumStatus: 'pending',
      anchorStatus: 'active',
    };
    expect(onboardingStatusFor(status, currencyByKey('cad'))).toBe('active');
    expect(onboardingStatusFor(status, currencyByKey('eur'))).toBe('pending');
    expect(onboardingStatusFor(status, currencyByKey('ngn'))).toBe('active');
  });

  it('reports nothing for USD and MXN, which have their own endpoints', () => {
    expect(onboardingStatusFor({}, currencyByKey('usd'))).toBeUndefined();
    expect(onboardingStatusFor({}, currencyByKey('mxn'))).toBeUndefined();
  });
});

describe('currencies', () => {
  it('runs the Global KYC path for USD, EUR and MXN only', () => {
    expect(WALLET_CURRENCIES.filter(usesGlobalKyc).map(c => c.key)).toEqual([
      'usd',
      'eur',
      'mxn',
    ]);
  });

  it('sends sumsubLevelName for every rail except CAD', () => {
    expect(WALLET_CURRENCIES.map(c => [c.key, sumsubLevelFor(c)])).toEqual([
      ['usd', 'id-and-liveness'],
      ['cad', undefined],
      ['eur', 'id-and-liveness'],
      ['ngn', 'id-only'],
      ['mxn', 'id-and-liveness'],
    ]);
  });

  it('resolves a wallet currency from its stablecoin code', () => {
    expect(currencyFromSmartWalletCurrency('mexe').key).toBe('mxn');
    expect(currencyFromSmartWalletCurrency('CNGN').key).toBe('ngn');
    // Unknown codes fall back to the first option rather than throwing.
    expect(currencyFromSmartWalletCurrency('GBPe').key).toBe('usd');
  });
});
