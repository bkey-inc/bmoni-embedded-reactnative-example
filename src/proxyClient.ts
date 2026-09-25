/**
 * A thin, typed client over every BMONI Embedded proxy endpoint the example
 * touches — the single source of truth for request/response shapes.
 *
 * Nothing here imports from React Native, so it is directly unit-testable.
 */

export type Json = Record<string, unknown>;

/** Every failure the example surfaces to the user. */
export class ProxyApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProxyApiError';
  }
}

// -----------------------------------------------------------------------------
// Currencies
// -----------------------------------------------------------------------------

export type CurrencyKey = 'usd' | 'cad' | 'eur' | 'ngn' | 'mxn';

export interface WalletCurrencyOption {
  key: CurrencyKey;
  label: string;
  /** ISO 4217 fiat code — used by exchange/convert. */
  fiatCode: string;
  /** Smart-wallet calls take the stablecoin code, never the fiat one. */
  smartWalletCurrency: string;
  kycProviderLabel: string;
}

export const WALLET_CURRENCIES: readonly WalletCurrencyOption[] = [
  {
    key: 'usd',
    label: 'US Dollar',
    fiatCode: 'USD',
    smartWalletCurrency: 'USDB',
    kycProviderLabel: 'US KYC',
  },
  {
    key: 'cad',
    label: 'Canadian Dollar',
    fiatCode: 'CAD',
    smartWalletCurrency: 'CADC',
    kycProviderLabel: 'PayTrie KYC',
  },
  {
    key: 'eur',
    label: 'Euro',
    fiatCode: 'EUR',
    smartWalletCurrency: 'EURe',
    kycProviderLabel: 'Monerium KYC',
  },
  {
    key: 'ngn',
    label: 'Naira',
    fiatCode: 'NGN',
    smartWalletCurrency: 'CNGN',
    kycProviderLabel: 'Anchor KYC',
  },
  {
    key: 'mxn',
    label: 'Mexican Peso',
    fiatCode: 'MXN',
    smartWalletCurrency: 'MEXe',
    kycProviderLabel: 'Etherfuse KYC',
  },
];

/**
 * The Global-KYC path (USD / EUR / MXN) requires a biometric selfie upload and
 * liveness at activation.
 */
export function usesGlobalKyc(option: WalletCurrencyOption): boolean {
  return option.key === 'usd' || option.key === 'eur' || option.key === 'mxn';
}

/**
 * `sumsubLevelName` for `POST …/kyc/activate`. Required for every country
 * except Canada, which routes to PayTrie and ignores it. NGN uploads no
 * selfie, so it uses the ID-only level.
 */
export function sumsubLevelFor(
  option: WalletCurrencyOption,
): string | undefined {
  switch (option.key) {
    case 'cad':
      return undefined;
    case 'ngn':
      return 'id-only';
    default:
      return 'id-and-liveness';
  }
}

export function currencyByKey(key: CurrencyKey): WalletCurrencyOption {
  return WALLET_CURRENCIES.find(c => c.key === key) ?? WALLET_CURRENCIES[0];
}

export function currencyFromSmartWalletCurrency(
  value: string,
): WalletCurrencyOption {
  const wanted = value.trim().toUpperCase();
  return (
    WALLET_CURRENCIES.find(
      c => c.smartWalletCurrency.toUpperCase() === wanted,
    ) ?? WALLET_CURRENCIES[0]
  );
}

/** Prisma `IdentificationDocumentType` — must match the upload DTO. */
export const KYC_IDENTIFICATION_TYPES = [
  'passport',
  'drivers_license',
  'national_id',
  'government_id',
  'other',
] as const;

/** Prisma `ProofOfAddressDocumentType`. */
export const KYC_PROOF_OF_ADDRESS_TYPES = [
  'utility_bill',
  'bank_statement',
  'rental_agreement',
  'tax_document',
  'other',
] as const;

// -----------------------------------------------------------------------------
// Models
// -----------------------------------------------------------------------------

export interface ProxyUser {
  id: string;
  company: string;
  bmoniUserId: string;
  firstName: string;
  lastName?: string;
  email: string;
  phoneNumber: string;
}

export interface OwnerProofChallenge {
  challengeId: string;
  groupId: string;
  message: string;
  expiresAt: string;
}

export interface SmartWallet {
  id: string;
  currency: string;
  /**
   * Derived display state. The proxy returns `isActive` rather than a `status`
   * string; it is mapped to `active` / `preparing` for the UI.
   */
  status: string;
  isActive: boolean;
  /** The deployed (or counterfactual) smart-account address. */
  walletAddress?: string;
  smartAccountAddress?: string;
  safeAddress?: string;
  createdAt?: string;
}

/** A chain + token pair from `GET /v1/deposit/supported-assets`. */
export interface DepositAsset {
  chain: string;
  currency: string;
}

/** A bank from `GET …/bank-accounts/nigerian-banks`. */
export interface NigerianBank {
  name: string;
  code: string;
}

/** RN multipart part: a picked file, not bytes. */
export interface UploadFile {
  uri: string;
  name: string;
  type: string;
}

export function mimeTypeForFilename(filename?: string): string {
  const name = (filename ?? '').toLowerCase();
  if (name.endsWith('.png')) {
    return 'image/png';
  }
  if (name.endsWith('.pdf')) {
    return 'application/pdf';
  }
  return 'image/jpeg';
}

// -----------------------------------------------------------------------------
// Unknown-JSON helpers
// -----------------------------------------------------------------------------

export function asRecord(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Unwraps a `data` / `value` envelope, or returns `raw` unchanged. */
function payload(raw: unknown, keys: string[] = ['data', 'value']): unknown {
  const record = asRecord(raw);
  if (!record) {
    return raw;
  }
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return raw;
}

export function proxyUserFromJson(json: Json): ProxyUser {
  return {
    id: asText(json.id) ?? '',
    company: asText(json.company) ?? '',
    bmoniUserId: asText(json.bmoniUserId) ?? '',
    firstName: asText(json.firstName) ?? '',
    lastName: asText(json.lastName),
    email: asText(json.email) ?? '',
    phoneNumber: asText(json.phoneNumber) ?? '',
  };
}

export function smartWalletFromJson(json: Json): SmartWallet {
  const id =
    asText(json.id) ??
    asText(json.smartWalletId) ??
    asText(json.walletId) ??
    asText(json.groupWalletId) ??
    '';
  const isActive = json.isActive === true;
  // The proxy returns `walletAddress`; upstream payloads used
  // `smartAccountAddress` / `safeAddress`. Treat them as the same address.
  const address =
    asText(json.walletAddress) ??
    asText(json.smartAccountAddress) ??
    asText(json.safeAddress);
  const explicitStatus = asText(json.status)?.trim();
  return {
    id,
    currency: asText(json.currency) ?? '',
    status: explicitStatus ?? (isActive ? 'active' : 'preparing'),
    isActive,
    walletAddress: address,
    smartAccountAddress: asText(json.smartAccountAddress) ?? address,
    safeAddress: asText(json.safeAddress),
    createdAt: asText(json.createdAt),
  };
}

/** Accepts a flat wallet object or `{ smartWallet: { … } }` / `{ groupWallet }`. */
export function smartWalletFromPayload(raw: Json): SmartWallet {
  const nested =
    asRecord(raw.smartWallet) ?? asRecord(raw.groupWallet) ?? undefined;
  return smartWalletFromJson(nested ?? raw);
}

export function walletReady(wallet: SmartWallet | null): boolean {
  return wallet !== null && wallet.id.trim() !== '';
}

export function walletAddressOf(wallet: SmartWallet): string | undefined {
  return (
    wallet.smartAccountAddress ?? wallet.safeAddress ?? wallet.walletAddress
  );
}

// -----------------------------------------------------------------------------
// Tolerant parsers for provider-shaped payloads
// -----------------------------------------------------------------------------

export function parseSupportedCurrencies(raw: unknown): string[] {
  const body = payload(raw, [
    'data',
    'value',
    'currencies',
    'supportedCurrencies',
  ]);
  const out: string[] = [];
  const add = (value: unknown) => {
    const code = asText(value)?.trim();
    if (code && !out.includes(code)) {
      out.push(code);
    }
  };
  if (Array.isArray(body)) {
    for (const item of body) {
      const record = asRecord(item);
      if (record) {
        add(record.currency ?? record.code ?? record.symbol);
      } else {
        add(item);
      }
    }
  }
  return out;
}

/**
 * Flattens `GET /v1/deposit/supported-assets` into `(chain, currency)` pairs.
 * The payload is grouped by chain and gateways differ on the exact shape, so
 * accept a list of `{chain, currencies[]}`, a list of `{chain, currency}`, or a
 * plain `{ "Base": ["USDC", …] }` map.
 */
export function flattenDepositAssets(raw: unknown): DepositAsset[] {
  const body = payload(raw, ['data', 'value', 'assets', 'chains']);
  const out: DepositAsset[] = [];

  const add = (chain: unknown, currency: unknown) => {
    const chainName = asText(chain)?.trim();
    if (!chainName) {
      return;
    }
    const record = asRecord(currency);
    const code = record
      ? asText(record.currency ?? record.code ?? record.symbol)?.trim()
      : asText(currency)?.trim();
    if (!code) {
      return;
    }
    if (!out.some(a => a.chain === chainName && a.currency === code)) {
      out.push({chain: chainName, currency: code});
    }
  };

  const addGroup = (chain: unknown, group: Json) => {
    const list = group.currencies ?? group.tokens ?? group.assets;
    if (Array.isArray(list)) {
      for (const currency of list) {
        add(chain, currency);
      }
      return;
    }
    add(chain, group.currency ?? group.code ?? group.symbol);
  };

  if (Array.isArray(body)) {
    for (const item of body) {
      const record = asRecord(item);
      if (record) {
        addGroup(record.chain ?? record.network ?? record.blockchain, record);
      }
    }
  } else {
    const record = asRecord(body);
    if (record) {
      for (const [chain, value] of Object.entries(record)) {
        if (Array.isArray(value)) {
          for (const currency of value) {
            add(chain, currency);
          }
        } else {
          const group = asRecord(value);
          if (group) {
            addGroup(chain, group);
          }
        }
      }
    }
  }
  return out;
}

export function parseNigerianBanks(raw: unknown): NigerianBank[] {
  const body = payload(raw, ['data', 'value', 'banks']);
  if (!Array.isArray(body)) {
    return [];
  }
  const out: NigerianBank[] = [];
  for (const item of body) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const name = asText(record.name ?? record.bankName)?.trim();
    const code = asText(
      record.code ?? record.bankCode ?? record.cbnCode,
    )?.trim();
    if (name && code) {
      out.push({name, code});
    }
  }
  return out;
}

export function readBankAccountId(account: Json): string | undefined {
  return asText(account.id)?.trim();
}

export function readProposalId(json: Json): string | undefined {
  const root = asRecord(payload(json));
  if (!root) {
    return undefined;
  }
  return asText(root.proposalId ?? root.id)?.trim();
}

const HASH_32 = /^0x[0-9a-fA-F]{64}$/;

/**
 * Digs the 32-byte digest out of a `sign-payload` / `signatureRequest` body.
 * Returns undefined when nothing 32-byte-shaped is present, so callers can show
 * the raw response instead of signing a guess.
 */
export function extractSignableHash(raw: unknown): string | undefined {
  const hashKeys = [
    'hashToSign',
    'signingPayloadHash',
    'payloadHash',
    'messageToSign',
    'digest',
    'hash',
  ];
  const walk = (node: unknown, depth: number): string | undefined => {
    if (typeof node === 'string') {
      const value = node.trim();
      return HASH_32.test(value) ? value : undefined;
    }
    const record = asRecord(node);
    if (!record || depth > 4) {
      return undefined;
    }
    for (const key of [
      ...hashKeys,
      'data',
      'value',
      'signatureRequest',
      'payload',
    ]) {
      const found = walk(record[key], depth + 1);
      if (found) {
        return found;
      }
    }
    return undefined;
  };
  return walk(raw, 0);
}

export function readWorkflowId(json: Json): string | undefined {
  const request = asRecord(json.signatureRequest);
  return asText(request?.workflowId) ?? asText(json.workflowId);
}

function bankAccountsRoot(json: Json): Json {
  const data = asRecord(json.data);
  if (data && ('depositAccounts' in data || 'withdrawalAccounts' in data)) {
    return data;
  }
  return json;
}

function depositAccountList(root: Json, keys: string[]): Json[] {
  const deposits = asRecord(bankAccountsRoot(root).depositAccounts);
  if (!deposits) {
    return [];
  }
  const out: Json[] = [];
  for (const key of keys) {
    const list = deposits[key];
    if (Array.isArray(list)) {
      for (const item of list) {
        const record = asRecord(item);
        if (record) {
          out.push(record);
        }
      }
    }
  }
  return out;
}

export function extractEuropeanDeposits(root: Json): Json[] {
  return depositAccountList(root, ['europeanAccounts']);
}

export function extractNigerianDeposits(root: Json): Json[] {
  return depositAccountList(root, ['nigerianAccounts', 'activationAccounts']);
}

/**
 * Proxy routes already include `/v1/…`. If the base URL ends with `/v1` (easy to
 * copy from the docs) concatenation would produce `/v1/v1/…` and 404.
 */
export function normalizeBaseUrl(raw: string, path: string): string {
  let base = raw.trim().replace(/\/$/, '');
  if (base === '') {
    return base;
  }
  if (path.startsWith('/v1/') && /\/v1$/.test(base)) {
    base = base.replace(/\/v1$/, '').replace(/\/$/, '');
  }
  return base;
}

// -----------------------------------------------------------------------------
// Client
// -----------------------------------------------------------------------------

type Method = 'GET' | 'POST' | 'PATCH';

export class ProxyApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  // --- Users, wallets ------------------------------------------------------

  async createUser(input: {
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
  }): Promise<ProxyUser> {
    const now = Date.now();
    const json = await this.request('POST', '/v1/users', {
      employeeId: `EMP-${now}`,
      identityId: `example-${now}`,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phoneNumber: input.phoneNumber,
      employerName: 'BKey Example Co',
      occupation: 'Mobile Engineer',
      monthlySalary: '450000.00',
      addressStreet: '15 Admiralty Way',
      addressCity: 'Lagos',
      addressState: 'Lagos',
      addressCountry: 'Nigeria',
      addressPostalCode: '101241',
    });
    const user = asRecord(json.user);
    if (!user) {
      throw new ProxyApiError('Expected a "user" object in the API response.');
    }
    return proxyUserFromJson(user);
  }

  async createOwnerProofChallenge(args: {
    userId: string;
    currency: string;
    userOwnerAddress: string;
  }): Promise<OwnerProofChallenge> {
    const json = this.unwrap(
      await this.request(
        'POST',
        `/v1/users/${args.userId}/smart-wallets/owner-proof-challenges`,
        {currency: args.currency, userOwnerAddress: args.userOwnerAddress},
      ),
    );
    return {
      challengeId: asText(json.challengeId) ?? '',
      groupId: asText(json.groupId) ?? '',
      message: asText(json.message) ?? '',
      expiresAt: asText(json.expiresAt) ?? '',
    };
  }

  async createManagedSmartWallet(args: {
    userId: string;
    currency: string;
    userOwnerAddress: string;
    ownerProofChallengeId: string;
    ownerProofSignature: string;
  }): Promise<SmartWallet> {
    const json = this.unwrap(
      await this.request(
        'POST',
        `/v1/users/${args.userId}/smart-wallets/create-managed`,
        {
          currency: args.currency,
          userOwnerAddress: args.userOwnerAddress,
          ownerProofChallengeId: args.ownerProofChallengeId,
          ownerProofSignature: args.ownerProofSignature,
        },
      ),
    );
    return smartWalletFromPayload(json);
  }

  /**
   * `account/wallets` returns a top-level array. Some gateways wrap it as
   * `{ data | value: { smartWallets | wallets: [...] } }`, so normalise every
   * shape to a list.
   */
  async listAccountSmartWallets(userId: string): Promise<SmartWallet[]> {
    const decoded = await this.requestRaw(
      'GET',
      `/v1/users/${userId}/smart-wallets/account/wallets`,
    );
    let rawList: unknown[] = [];
    if (Array.isArray(decoded)) {
      rawList = decoded;
    } else {
      const record = asRecord(decoded);
      if (record) {
        const data = record.data;
        if (Array.isArray(data)) {
          rawList = data;
        } else {
          const layer = asRecord(data) ?? record;
          let list = layer.smartWallets ?? layer.wallets;
          if (!Array.isArray(list)) {
            const inner = layer.value;
            if (Array.isArray(inner)) {
              list = inner;
            } else {
              const innerRecord = asRecord(inner);
              list = innerRecord?.smartWallets ?? innerRecord?.wallets;
            }
          }
          if (Array.isArray(list)) {
            rawList = list;
          }
        }
      }
    }
    const out: SmartWallet[] = [];
    for (const item of rawList) {
      const record = asRecord(item);
      if (!record) {
        continue;
      }
      const wallet = smartWalletFromPayload(record);
      if (wallet.id.trim() !== '') {
        out.push(wallet);
      }
    }
    return out;
  }

  async listAccountBalances(userId: string): Promise<Json> {
    return this.unwrap(
      await this.request(
        'GET',
        `/v1/users/${userId}/smart-wallets/account/balances`,
      ),
    );
  }

  async getSmartWallet(args: {
    userId: string;
    smartWalletId: string;
  }): Promise<SmartWallet> {
    const json = this.unwrap(
      await this.request(
        'GET',
        `/v1/users/${args.userId}/smart-wallets/${args.smartWalletId}`,
      ),
    );
    return smartWalletFromPayload(json);
  }

  // --- Onboarding & KYC ----------------------------------------------------

  async getOnboardingStatus(userId: string): Promise<Json> {
    return this.unwrap(
      await this.request('GET', `/v1/users/${userId}/onboarding/status`),
    );
  }

  async getKycOptions(userId: string): Promise<Json> {
    return this.unwrap(
      await this.request('GET', `/v1/users/${userId}/kyc/options`),
    );
  }

  async getKycOccupations(userId: string, search: string): Promise<Json[]> {
    const query = search.trim()
      ? `?search=${encodeURIComponent(search.trim())}`
      : '';
    const decoded = await this.requestRaw(
      'GET',
      `/v1/users/${userId}/kyc/occupations${query}`,
    );
    const body = Array.isArray(decoded) ? decoded : payload(decoded);
    if (!Array.isArray(body)) {
      return [];
    }
    return body.map(asRecord).filter((item): item is Json => item !== null);
  }

  patchKyc(userId: string, body: Json): Promise<Json> {
    return this.request('PATCH', `/v1/users/${userId}/kyc`, body);
  }

  getKycReadiness(userId: string): Promise<Json> {
    return this.request('GET', `/v1/users/${userId}/kyc/readiness`);
  }

  /** `sumsubLevelName` is omitted only for CAD (see `sumsubLevelFor()`). */
  activateKyc(userId: string, sumsubLevelName?: string): Promise<Json> {
    const body: Json = {};
    if (sumsubLevelName && sumsubLevelName.trim() !== '') {
      body.sumsubLevelName = sumsubLevelName.trim();
    }
    return this.request('POST', `/v1/users/${userId}/kyc/activate`, body);
  }

  uploadKycIdentification(args: {
    userId: string;
    files: UploadFile[];
    type: string;
    documentNumber: string;
    issuingCountry: string;
    expirationDate?: string;
    issueDate?: string;
  }): Promise<Json> {
    const fields: Record<string, string> = {
      type: args.type,
      documentNumber: args.documentNumber,
      issuingCountry: args.issuingCountry,
    };
    if (args.expirationDate) {
      fields.expirationDate = args.expirationDate;
    }
    if (args.issueDate) {
      fields.issueDate = args.issueDate;
    }
    return this.sendMultipart(
      `/v1/users/${args.userId}/kyc/documents/identification`,
      args.files,
      fields,
    );
  }

  uploadKycProofOfAddress(args: {
    userId: string;
    files: UploadFile[];
    type: string;
  }): Promise<Json> {
    return this.sendMultipart(
      `/v1/users/${args.userId}/kyc/documents/proof-of-address`,
      args.files,
      {type: args.type},
    );
  }

  /**
   * Biometric selfie upload. Required on the Global KYC path (USD / EUR / MXN)
   * and unused for CAD / NGN. The file field is `selfie`, not `files`.
   */
  uploadKycBiometric(args: {userId: string; file: UploadFile}): Promise<Json> {
    return this.sendMultipart(
      `/v1/users/${args.userId}/kyc/documents/biometric`,
      [args.file],
      {type: 'selfie'},
      'selfie',
    );
  }

  /**
   * The rail-specific onboarding call. Mexico is the exception: it activates
   * through Etherfuse (`/latam/mx/kyc/activate`) and takes no request body.
   */
  startOnboarding(args: {
    userId: string;
    currency: WalletCurrencyOption;
    wallet: SmartWallet;
    nigeriaBvn?: string;
  }): Promise<Json> {
    const {userId, currency, wallet} = args;
    const paths: Record<CurrencyKey, string> = {
      usd: `/v1/users/${userId}/onboarding/start-usa`,
      cad: `/v1/users/${userId}/onboarding/start-canada`,
      eur: `/v1/users/${userId}/onboarding/start-monerium`,
      ngn: `/v1/users/${userId}/onboarding/start-nigeria`,
      mxn: `/v1/users/${userId}/latam/mx/kyc/activate`,
    };
    return this.request(
      'POST',
      paths[currency.key],
      onboardingStartBody(currency, wallet, args.nigeriaBvn),
    );
  }

  getUsdReadiness(userId: string): Promise<Json> {
    return this.request('GET', `/v1/users/${userId}/kyc/usd-readiness`).then(
      json => this.unwrap(json),
    );
  }

  async startUsaOnboarding(args: {
    userId: string;
    smartWalletId: string;
  }): Promise<Json> {
    return this.unwrap(
      await this.request(
        'POST',
        `/v1/users/${args.userId}/onboarding/start-usa`,
        {smartWalletId: args.smartWalletId},
      ),
    );
  }

  async getUsdVba(userId: string): Promise<Json> {
    return this.unwrap(await this.request('GET', `/v1/users/${userId}/vba/usd`));
  }

  // --- Top up --------------------------------------------------------------

  /** Crypto top-up: returns a one-time on-chain deposit address. */
  async depositToWallet(args: {
    userId: string;
    smartWalletId: string;
    chain: string;
    currency: string;
  }): Promise<Json> {
    return this.unwrap(
      await this.request('POST', `/v1/users/${args.userId}/deposit/wallet`, {
        smartWalletId: args.smartWalletId,
        chain: args.chain,
        currency: args.currency,
      }),
    );
  }

  async getBankAccounts(userId: string): Promise<Json> {
    return bankAccountsRoot(
      this.unwrap(
        await this.request('GET', `/v1/users/${userId}/bank-accounts`),
      ),
    );
  }

  /**
   * Routes an existing deposit VBA to a smart wallet
   * (`POST …/smart-wallets/{id}/onramp/vba/{region}`): `nigeria` (NGN → cNGN)
   * or `eu` (IBAN → EURe). The account itself comes from the rail's
   * onboarding (`start-nigeria` / `start-monerium`).
   */
  async linkDepositVba(args: {
    userId: string;
    smartWalletId: string;
    region: 'nigeria' | 'eu';
    bankAccountId: string;
  }): Promise<Json> {
    return this.unwrap(
      await this.request(
        'POST',
        `/v1/users/${args.userId}/smart-wallets/${args.smartWalletId}/onramp/vba/${args.region}`,
        {bankAccountId: args.bankAccountId},
      ),
    );
  }

  /**
   * The account details the user transfers to (NGN NUBAN, MXN SPEI CLABE, …).
   */
  getDepositAccounts(userId: string, currency: string): Promise<unknown> {
    return this.requestRaw(
      'GET',
      `/v1/users/${userId}/bank-accounts/deposit-accounts/${currency}`,
    );
  }

  // --- Withdraw (Nigeria) --------------------------------------------------

  /** Every supported bank with its CBN code; send both back verbatim. */
  async getNigerianBanks(userId: string): Promise<NigerianBank[]> {
    return parseNigerianBanks(
      await this.requestRaw(
        'GET',
        `/v1/users/${userId}/bank-accounts/nigerian-banks`,
      ),
    );
  }

  async verifyNigerianAccount(args: {
    userId: string;
    bankCode: string;
    accountNumber: string;
  }): Promise<Json> {
    return this.unwrap(
      await this.request(
        'POST',
        `/v1/users/${args.userId}/bank-accounts/verify-nigerian-account`,
        {bankCode: args.bankCode, accountNumber: args.accountNumber},
      ),
    );
  }

  async getOrCreateNigerianWithdrawalAccount(args: {
    userId: string;
    body: Json;
  }): Promise<Json> {
    return this.unwrap(
      await this.request(
        'POST',
        `/v1/users/${args.userId}/bank-accounts/withdrawal-accounts/nigeria`,
        args.body,
      ),
    );
  }

  /**
   * Nigerian bank offramp. `fromAmount` is a **decimal** string (`"100.00"`) —
   * unlike `POST /payouts`, whose `amount` is USDB minor units. Returns a
   * proposal (`PENDING_APPROVALS` → `PENDING_SIGNATURES` → `COMPLETED`), not a
   * completed payout.
   */
  async offrampNigeriaBank(args: {
    userId: string;
    smartWalletId: string;
    bankAccountId: string;
    fromAmount: string;
  }): Promise<Json> {
    return this.unwrap(
      await this.request(
        'POST',
        `/v1/users/${args.userId}/smart-wallets/${args.smartWalletId}/offramp/nigeria`,
        {bankAccountId: args.bankAccountId, fromAmount: args.fromAmount},
      ),
    );
  }

  // --- Proposals -----------------------------------------------------------

  /** Returns 404/409 while the proposal is still `PENDING_APPROVALS`. */
  async getProposalSignPayload(args: {
    userId: string;
    proposalId: string;
  }): Promise<Json> {
    return this.unwrap(
      await this.request(
        'GET',
        `/v1/users/${args.userId}/smart-wallets/proposals/${args.proposalId}/sign-payload`,
      ),
    );
  }

  async signProposal(args: {
    userId: string;
    proposalId: string;
    signature: string;
  }): Promise<Json> {
    return this.unwrap(
      await this.request(
        'POST',
        `/v1/users/${args.userId}/smart-wallets/proposals/${args.proposalId}/sign`,
        {signature: args.signature},
      ),
    );
  }

  async getProposal(args: {
    userId: string;
    proposalId: string;
  }): Promise<Json> {
    return this.unwrap(
      await this.request(
        'GET',
        `/v1/users/${args.userId}/smart-wallets/proposals/${args.proposalId}`,
      ),
    );
  }

  // --- Exchange ------------------------------------------------------------

  convertCurrency(args: {
    userId: string;
    amount: number;
    from: string;
    to: string;
  }): Promise<Json> {
    return this.request('POST', `/v1/users/${args.userId}/exchange/convert`, {
      amount: args.amount,
      from: args.from,
      to: args.to,
    });
  }

  getExchangeRate(args: {
    userId: string;
    from: string;
    to: string;
  }): Promise<Json> {
    return this.request(
      'GET',
      `/v1/users/${args.userId}/exchange/rate/${args.from}/${args.to}`,
    );
  }

  /** Firm swap quote. `amountType` is `exactIn` or `exactOut`. */
  getSwapQuote(args: {
    userId: string;
    fromCurrency: string;
    toCurrency: string;
    amountType: 'exactIn' | 'exactOut';
    amount: string;
  }): Promise<Json> {
    const swapAmount: Json = {type: args.amountType};
    if (args.amountType === 'exactIn') {
      swapAmount.amountIn = args.amount;
    } else {
      swapAmount.amountOut = args.amount;
    }
    return this.request('POST', `/v1/users/${args.userId}/exchange/quote`, {
      swapAmount,
      fromCurrency: args.fromCurrency,
      toCurrency: args.toCurrency,
    });
  }

  // --- Runtime discovery (not user-scoped) --------------------------------

  /** Stablecoin codes a smart wallet can hold. Callable before onboarding. */
  async getSupportedSmartWalletCurrencies(): Promise<string[]> {
    return parseSupportedCurrencies(
      await this.requestRaw('GET', '/v1/smart-wallets/supported-currencies'),
    );
  }

  /** Chains and tokens accepted for crypto top-ups. */
  async getSupportedDepositAssets(): Promise<DepositAsset[]> {
    return flattenDepositAssets(
      await this.requestRaw('GET', '/v1/deposit/supported-assets'),
    );
  }

  // --- EU SEPA / Monerium --------------------------------------------------

  completeEuKyc(args: {
    userId: string;
    code: string;
    signature: string;
  }): Promise<Json> {
    return this.request('POST', `/v1/users/${args.userId}/eu/kyc`, {
      code: args.code,
      signature: args.signature,
    });
  }

  /**
   * Prepare a EUR SEPA payout. Returns `{ workflowId, messageToSign,
   * signatureRequest? }`; sign it, then call `completeEuOrder`.
   */
  prepareEuOrder(args: {
    userId: string;
    smartWalletId: string;
    amount: string;
    iban: string;
    firstName: string;
    lastName: string;
    country: string;
    memo?: string;
  }): Promise<Json> {
    const body: Json = {
      smartWalletId: args.smartWalletId,
      amount: args.amount,
      counterpart: {
        identifier: {standard: 'iban', iban: args.iban},
        details: {
          firstName: args.firstName,
          lastName: args.lastName,
          country: args.country,
        },
      },
    };
    if (args.memo && args.memo.trim() !== '') {
      body.memo = args.memo.trim();
    }
    return this.request(
      'POST',
      `/v1/users/${args.userId}/eu/orders/prepare`,
      body,
    );
  }

  completeEuOrder(args: {
    userId: string;
    workflowId: string;
    signature: string;
  }): Promise<Json> {
    return this.request('POST', `/v1/users/${args.userId}/eu/orders/complete`, {
      workflowId: args.workflowId,
      signature: args.signature,
    });
  }

  // --- LATAM cash (Pago46) -------------------------------------------------

  createCashOrder(args: {
    userId: string;
    kind: 'fund' | 'send';
    smartWalletId: string;
    country: string;
    price: string;
    priceCurrency: string;
    description: string;
  }): Promise<Json> {
    return this.request(
      'POST',
      `/v1/users/${args.userId}/latam/cash/orders/${args.kind}`,
      {
        smartWalletId: args.smartWalletId,
        country: args.country,
        price: args.price,
        priceCurrency: args.priceCurrency,
        description: args.description,
      },
    );
  }

  listCashOrders(userId: string, type?: string): Promise<unknown> {
    const query = type && type !== '' ? `?type=${type}` : '';
    return this.requestRaw(
      'GET',
      `/v1/users/${userId}/latam/cash/orders${query}`,
    );
  }

  getCashOrder(args: {userId: string; orderId: string}): Promise<Json> {
    return this.request(
      'GET',
      `/v1/users/${args.userId}/latam/cash/orders/${args.orderId}`,
    );
  }

  // --- LATAM Mexico (Etherfuse) -------------------------------------------

  async activateMxKyc(userId: string): Promise<Json> {
    return this.unwrap(
      await this.request(
        'POST',
        `/v1/users/${userId}/latam/mx/kyc/activate`,
        {},
      ),
    );
  }

  async getMxKycStatus(userId: string): Promise<Json> {
    return this.unwrap(
      await this.request('GET', `/v1/users/${userId}/latam/mx/kyc/status`),
    );
  }

  /**
   * MXN offramp quote. Returns a `signatureRequest` to sign and submit via
   * `submitSignature`. Onramps need no quote: depositing MXN to the user's
   * CLABE (`getDepositAccounts(userId, 'MXN')`) onramps automatically.
   */
  createMxOfframpQuote(args: {
    userId: string;
    sourceAmount: string;
    note?: string;
  }): Promise<Json> {
    const body: Json = {type: 'offramp', sourceAmount: args.sourceAmount};
    if (args.note && args.note !== '') {
      body.note = args.note;
    }
    return this.request('POST', `/v1/users/${args.userId}/latam/mx/quote`, body);
  }

  getMxOrder(args: {userId: string; orderId: string}): Promise<Json> {
    return this.request(
      'GET',
      `/v1/users/${args.userId}/latam/mx/orders/${args.orderId}`,
    );
  }

  // --- Bank payouts (Fin) --------------------------------------------------

  listPayoutCountries(userId: string): Promise<unknown> {
    return this.requestRaw('GET', `/v1/users/${userId}/payouts/countries`);
  }

  listPayoutBanks(args: {userId: string; country: string}): Promise<unknown> {
    return this.requestRaw(
      'GET',
      `/v1/users/${args.userId}/payouts/banks?country=${encodeURIComponent(
        args.country,
      )}`,
    );
  }

  listPayoutBankBranches(args: {
    userId: string;
    bankId: string;
  }): Promise<unknown> {
    return this.requestRaw(
      'GET',
      `/v1/users/${args.userId}/payouts/bank-branches?bankId=${encodeURIComponent(
        args.bankId,
      )}`,
    );
  }

  validatePayoutAccount(args: {
    userId: string;
    country: string;
    currency: string;
    accountNumber: string;
    bankId?: string;
    routingNumber?: string;
  }): Promise<Json> {
    const body: Json = {
      country: args.country,
      currency: args.currency,
      accountNumber: args.accountNumber,
    };
    if (args.bankId) {
      body.bankId = args.bankId;
    }
    if (args.routingNumber) {
      body.routingNumber = args.routingNumber;
    }
    return this.request(
      'POST',
      `/v1/users/${args.userId}/payouts/validate-account`,
      body,
    );
  }

  /**
   * Create a bank payout. `amount` is **USDB minor units** as a string, not a
   * decimal amount. Returns `{ signatureRequest, quote? }`.
   */
  createPayout(args: {
    userId: string;
    sourceSmartWalletId: string;
    amount: string;
    country: string;
    currency: string;
    bankId: string;
    accountNumber: string;
    accountHolderName: string;
    note?: string;
  }): Promise<Json> {
    const body: Json = {
      sourceSmartWalletId: args.sourceSmartWalletId,
      amount: args.amount,
      country: args.country,
      currency: args.currency,
      bankDetails: {
        bankId: args.bankId,
        accountNumber: args.accountNumber,
        accountHolderName: args.accountHolderName,
      },
    };
    if (args.note && args.note !== '') {
      body.note = args.note;
    }
    return this.request('POST', `/v1/users/${args.userId}/payouts`, body);
  }

  // --- Shared signature submission ----------------------------------------

  /** Completes any `signatureRequest` workflow by submitting the signature. */
  submitSignature(args: {
    userId: string;
    workflowId: string;
    signature: string;
  }): Promise<Json> {
    return this.request(
      'POST',
      `/v1/users/${args.userId}/wallets/submit-signature`,
      {workflowId: args.workflowId, signature: args.signature},
    );
  }

  // --- Transport -----------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
    };
  }

  private url(path: string): string {
    if (this.baseUrl.trim() === '') {
      throw new ProxyApiError('Enter the proxy API base URL.');
    }
    if (this.apiKey.trim() === '') {
      throw new ProxyApiError('Enter a partner API key.');
    }
    return `${normalizeBaseUrl(this.baseUrl, path)}${path}`;
  }

  private async request(
    method: Method,
    path: string,
    body?: Json,
  ): Promise<Json> {
    const decoded = await this.requestRaw(method, path, body);
    const record = asRecord(decoded);
    if (record) {
      return record;
    }
    if (decoded === null || decoded === undefined) {
      return {};
    }
    throw new ProxyApiError('API returned a non-object JSON response.');
  }

  /** For provider-shaped endpoints that may return an array rather than an object. */
  private async requestRaw(
    method: Method,
    path: string,
    body?: Json,
  ): Promise<unknown> {
    const response = await fetch(this.url(path), {
      method,
      headers: this.headers(),
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    return this.decode(response);
  }

  private async sendMultipart(
    path: string,
    files: UploadFile[],
    fields: Record<string, string>,
    fileField = 'files',
  ): Promise<Json> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      form.append(key, value);
    }
    for (const file of files) {
      // React Native's FormData takes a {uri, name, type} descriptor rather
      // than a Blob; the bridge streams the file itself.
      form.append(fileField, file as unknown as Blob);
    }
    const response = await fetch(this.url(path), {
      method: 'POST',
      // Content-Type is intentionally omitted: fetch adds the multipart
      // boundary, and setting it by hand breaks the upload.
      headers: {'Accept': 'application/json', 'x-api-key': this.apiKey},
      body: form,
    });
    const decoded = await this.decode(response);
    return asRecord(decoded) ?? {};
  }

  private async decode(response: Response): Promise<unknown> {
    const text = await response.text();
    let decoded: unknown = null;
    if (text !== '') {
      try {
        decoded = JSON.parse(text);
      } catch {
        if (!response.ok) {
          throw new ProxyApiError(`HTTP ${response.status}: ${text}`);
        }
        throw new ProxyApiError('API returned a non-JSON response.');
      }
    }
    if (!response.ok) {
      throw new ProxyApiError(errorMessage(decoded, response.status));
    }
    return decoded;
  }

  private unwrap(json: Json): Json {
    return asRecord(json.data) ?? json;
  }
}

export function errorMessage(decoded: unknown, status: number): string {
  const record = asRecord(decoded);
  if (!record) {
    return `HTTP ${status}`;
  }
  const message = record.message ?? record.error ?? record.detail;
  if (Array.isArray(message)) {
    return `HTTP ${status}: ${message.join(', ')}`;
  }
  if (typeof message === 'string' && message !== '') {
    return `HTTP ${status}: ${message}`;
  }
  return `HTTP ${status}: ${JSON.stringify(record)}`;
}

/**
 * Bodies match the embedded proxy DTOs. USD only needs the destination wallet
 * id; Mexico takes no body at all; the others bind the on-chain wallet address.
 */
export function onboardingStartBody(
  currency: WalletCurrencyOption,
  wallet: SmartWallet,
  nigeriaBvn?: string,
): Json {
  if (currency.key === 'usd') {
    return {smartWalletId: wallet.id};
  }
  if (currency.key === 'mxn') {
    return {};
  }
  const address = walletAddressOf(wallet);
  if (!address || address.trim() === '') {
    throw new ProxyApiError(
      'Smart wallet has no on-chain address; cannot start onboarding.',
    );
  }
  const walletIndex = 0;
  switch (currency.key) {
    case 'cad':
      return {cadWalletAddress: address, cadWalletIndex: walletIndex};
    case 'eur':
      return {eurWalletAddress: address, eurWalletIndex: walletIndex};
    case 'ngn': {
      const bvn = (nigeriaBvn ?? '').trim();
      if (bvn.length !== 11) {
        throw new ProxyApiError(
          'Nigeria onboarding requires an 11-digit BVN in the KYC step.',
        );
      }
      return {
        bvn,
        ngnWalletAddress: address,
        ngnWalletIndex: walletIndex,
      };
    }
  }
}

/** `onboarding/status` key that reports the rail for a currency, if any. */
export function onboardingStatusFor(
  status: Json,
  currency: WalletCurrencyOption,
): string | undefined {
  const read = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = status[key];
      if (typeof value === 'string') {
        return value;
      }
    }
    return undefined;
  };
  switch (currency.key) {
    // USD readiness comes from GET /vba/usd and MXN from
    // GET /latam/mx/kyc/status — neither is reported by onboarding/status.
    case 'usd':
    case 'mxn':
      return undefined;
    case 'cad':
      return read(['paytrieStatus']);
    case 'eur':
      return read(['moneriumStatus', 'moneriumStatusOrNotStarted']);
    case 'ngn':
      return read(['anchorStatus']);
  }
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
