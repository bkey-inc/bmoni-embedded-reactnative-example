/**
 * The guided flow, end to end: configure → create user → provision a managed
 * smart wallet (owner proof + on-device signature) → KYC → wallet home with
 * top-up / withdraw / swap, plus the provider ramps under Integrations.
 *
 * State lives here so the screens stay presentational, mirroring the Flutter
 * reference app in `bmoni-embedded-flutter-example`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';

import {IntegrationsScreen} from './Integrations';
import {KycWizard} from './KycWizard';
import {NigeriaWithdrawalModal} from './NigeriaWithdrawal';
import {
  currencyByKey,
  currencyFromSmartWalletCurrency,
  describeError,
  extractNigerianDeposits,
  extractEuropeanDeposits,
  extractSignableHash,
  onboardingStatusFor,
  prettyJson,
  ProxyApiClient,
  ProxyApiError,
  readBankAccountId,
  readProposalId,
  walletAddressOf,
  walletReady,
  WALLET_CURRENCIES,
  type CurrencyKey,
  type DepositAsset,
  type Json,
  type ProxyUser,
  type SmartWallet,
  type WalletCurrencyOption,
} from './proxyClient';
import {
  BmoniEmbeddedSdk,
  describeSdkError,
  ExampleError,
  loadOrCreateOwnerAddress,
  pinArgument,
} from './sdk';
import {
  BusyOverlay,
  Button,
  Field,
  Header,
  KeyValueRow,
  LastResponsePanel,
  Note,
  PinPrompt,
  Row,
  SectionCard,
  StatusBanner,
  styles,
  theme,
} from './ui';

type Step =
  | 'loading'
  | 'createAccount'
  | 'unlock'
  | 'selectCurrency'
  | 'walletHome'
  | 'kycWizard';

const SESSION_KEY = 'bmoni.example.session';

interface Session {
  baseUrl?: string;
  apiKey?: string;
  user?: ProxyUser;
  smartWallet?: SmartWallet;
  currencyKey?: CurrencyKey;
  ownerAddress?: string;
  isLoggedIn?: boolean;
}

function stablecoinCodes(wallets: SmartWallet[]): Set<string> {
  return new Set(
    wallets
      .map(wallet => wallet.currency.trim().toUpperCase())
      .filter(code => code !== ''),
  );
}

function defaultBaseUrl(): string {
  // Android emulators reach the host machine on 10.0.2.2.
  return Platform.OS === 'android'
    ? 'http://10.0.2.2:4001'
    : 'http://localhost:4001';
}

export function ExampleApp() {
  const [step, setStep] = useState<Step>('loading');
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl());
  const [apiKey, setApiKey] = useState('');
  const [pin, setPin] = useState('');

  const [firstName, setFirstName] = useState('Chiamaka');
  const [lastName, setLastName] = useState('Okafor');
  const [email, setEmail] = useState(
    `embedded.demo+${Date.now()}@example.com`,
  );
  const [phone, setPhone] = useState('+2348012345678');

  const [amount, setAmount] = useState('10.00');
  const [toCurrency, setToCurrency] = useState('NGN');

  const [user, setUser] = useState<ProxyUser | null>(null);
  const [smartWallet, setSmartWallet] = useState<SmartWallet | null>(null);
  const [accountWallets, setAccountWallets] = useState<SmartWallet[]>([]);
  const [balances, setBalances] = useState<Json>({});
  const [currency, setCurrency] = useState<WalletCurrencyOption>(
    WALLET_CURRENCIES[0],
  );
  const [supportedCurrencies, setSupportedCurrencies] = useState<string[]>([]);
  const [ownerAddress, setOwnerAddress] = useState<string | null>(null);
  const [addingWallet, setAddingWallet] = useState(false);
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(
    null,
  );

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showIntegrations, setShowIntegrations] = useState(false);
  const [showNigeriaWithdrawal, setShowNigeriaWithdrawal] = useState(false);
  const [pinPrompt, setPinPrompt] = useState<((pin: string | null) => void) | null>(
    null,
  );

  const client = useMemo(
    () => new ProxyApiClient(baseUrl.trim(), apiKey.trim()),
    [baseUrl, apiKey],
  );
  const busyRef = useRef(false);

  const ownedCodes = useMemo(
    () => stablecoinCodes(accountWallets),
    [accountWallets],
  );

  const isUnsupported = useCallback(
    (option: WalletCurrencyOption) =>
      supportedCurrencies.length > 0 &&
      !supportedCurrencies
        .map(code => code.toUpperCase())
        .includes(option.smartWalletCurrency.toUpperCase()),
    [supportedCurrencies],
  );

  // --- session -------------------------------------------------------------

  const saveSession = useCallback(
    async (patch: Session) => {
      const next: Session = {
        baseUrl,
        apiKey,
        currencyKey: currency.key,
        ...(user ? {user} : {}),
        ...(smartWallet && walletReady(smartWallet) ? {smartWallet} : {}),
        ...(ownerAddress ? {ownerAddress} : {}),
        ...patch,
      };
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(next));
    },
    [apiKey, baseUrl, currency.key, ownerAddress, smartWallet, user],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let session: Session = {};
      try {
        const raw = await AsyncStorage.getItem(SESSION_KEY);
        if (raw) {
          session = JSON.parse(raw) as Session;
        }
      } catch (e) {
        // A corrupt blob must not wedge startup — fall back to a clean session.
        console.warn('Could not read the stored session:', describeError(e));
      }
      const address =
        session.ownerAddress ?? (await BmoniEmbeddedSdk.walletAddress());
      if (cancelled) {
        return;
      }
      if (session.baseUrl) {
        setBaseUrl(session.baseUrl);
      }
      if (session.apiKey) {
        setApiKey(session.apiKey);
      }
      if (session.user) {
        setUser(session.user);
      }
      const restoredWallet =
        session.smartWallet && walletReady(session.smartWallet)
          ? session.smartWallet
          : null;
      setSmartWallet(restoredWallet);
      if (session.currencyKey) {
        setCurrency(currencyByKey(session.currencyKey));
      }
      setOwnerAddress(address ?? null);
      setStep(
        !session.user
          ? 'createAccount'
          : session.isLoggedIn
            ? restoredWallet
              ? 'walletHome'
              : 'selectCurrency'
            : 'unlock',
      );
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on mount: restoring must not re-fire when the fields it sets change.
  }, []);

  // --- helpers -------------------------------------------------------------

  /** Serialises work, and routes both SDK and proxy failures to the banner. */
  const run = useCallback(async (action: () => Promise<void>) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setError(describeSdkError(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const requireUserId = useCallback((): string => {
    const id = user?.bmoniUserId;
    if (!id) {
      throw new ExampleError('Create an account first.');
    }
    return id;
  }, [user]);

  const requireWallet = useCallback((): SmartWallet => {
    if (!smartWallet || !walletReady(smartWallet)) {
      throw new ExampleError(
        'No deployed smart wallet id on this session. Use “Create smart wallet” ' +
          'so the API returns a wallet id.',
      );
    }
    return smartWallet;
  }, [smartWallet]);

  /** Resolves to the entered PIN, or null when the user dismisses the prompt. */
  const promptPin = useCallback(
    () =>
      new Promise<string | null>(resolve => {
        setPinPrompt(() => (value: string | null) => {
          setPinPrompt(null);
          resolve(value);
        });
      }),
    [],
  );

  /**
   * Returns the wallets as well as storing them: callers that need to act on the
   * fresh list cannot read it back from state in the same tick.
   */
  const refreshWalletData = useCallback(
    async (userId: string): Promise<SmartWallet[]> => {
      const [wallets, accountBalances] = await Promise.all([
        client.listAccountSmartWallets(userId),
        client.listAccountBalances(userId),
      ]);
      setAccountWallets(wallets);
      setBalances(accountBalances);
      return wallets;
    },
    [client],
  );

  /** Best-effort: a failure here must not block wallet creation. */
  const loadSupportedCurrencies = useCallback(async (): Promise<string[]> => {
    try {
      const codes = await client.getSupportedSmartWalletCurrencies();
      if (codes.length > 0) {
        setSupportedCurrencies(codes);
      }
      return codes;
    } catch (e) {
      console.warn('supported-currencies unavailable:', describeError(e));
      return [];
    }
  }, [client]);

  // --- account -------------------------------------------------------------

  const createAccount = () =>
    run(async () => {
      const created = await client.createUser({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phoneNumber: phone.trim(),
      });
      setUser(created);
      setSmartWallet(null);
      setOwnerAddress(null);
      setAccountWallets([]);
      setBalances({});
      setAddingWallet(false);
      setPendingProposalId(null);
      setStep('selectCurrency');
      setMessage('Account created. Choose a wallet currency next.');
      setLastResponse(prettyJson(created));
      await saveSession({user: created, isLoggedIn: true, smartWallet: undefined});
      await loadSupportedCurrencies();
    });

  const unlock = () =>
    run(async () => {
      if (pin.length !== BmoniEmbeddedSdk.pinLength) {
        throw new ExampleError(
          `Enter a ${BmoniEmbeddedSdk.pinLength}-digit PIN.`,
        );
      }
      if (!(await BmoniEmbeddedSdk.hasPin())) {
        throw new ExampleError(
          'No PIN is configured on this device. Create a new account first.',
        );
      }
      if (!(await BmoniEmbeddedSdk.matchPin(pin))) {
        throw new ExampleError('The PIN did not match this device wallet.');
      }
      setStep(smartWallet && walletReady(smartWallet) ? 'walletHome' : 'selectCurrency');
      setMessage('Welcome back.');
      await saveSession({isLoggedIn: true});
      try {
        await refreshWalletData(requireUserId());
      } catch (e) {
        setMessage(
          `Could not sync wallets from the API (${describeError(e)}). ` +
            'Tap Refresh wallets & balances.',
        );
      }
    });

  const logout = () =>
    run(async () => {
      setPin('');
      setStep('unlock');
      setSmartWallet(null);
      setOwnerAddress(null);
      setAccountWallets([]);
      setBalances({});
      setAddingWallet(false);
      setPendingProposalId(null);
      setMessage('Logged out. Unlock with the device PIN to continue.');
      await saveSession({isLoggedIn: false});
    });

  /**
   * Full reset: wipes the local session, the on-device wallet and the PIN. The
   * base URL and API key are kept so setup stays friction-free. Deleting the
   * wallet needs the matching PIN while `requirePin` is true; without it the app
   * session still clears but the device key stays put.
   */
  const resetEverything = () => {
    Alert.alert(
      'Reset app',
      'This deletes the local session, the on-device wallet and the PIN, then ' +
        'returns to account setup. Enter your PIN first so the device wallet ' +
        'can be wiped. This cannot be undone.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () =>
            run(async () => {
              let walletNote = '';
              try {
                if (await BmoniEmbeddedSdk.hasWallet()) {
                  await BmoniEmbeddedSdk.deleteWallet(pinArgument(pin));
                }
                if (await BmoniEmbeddedSdk.hasPin()) {
                  await BmoniEmbeddedSdk.removePin(pin);
                }
              } catch {
                walletNote =
                  ' The on-device wallet/PIN was not removed (PIN missing or ' +
                  'incorrect) — enter the correct PIN and reset again to wipe it.';
              }
              await AsyncStorage.setItem(
                SESSION_KEY,
                JSON.stringify({baseUrl, apiKey} satisfies Session),
              );
              setPin('');
              setUser(null);
              setSmartWallet(null);
              setOwnerAddress(null);
              setAccountWallets([]);
              setBalances({});
              setAddingWallet(false);
              setPendingProposalId(null);
              setCurrency(WALLET_CURRENCIES[0]);
              setLastResponse(null);
              setStep('createAccount');
              setMessage(
                `App reset.${walletNote} Create a new account to set up again.`,
              );
            }),
        },
      ],
    );
  };

  // --- wallet provisioning -------------------------------------------------

  const provisionSmartWallet = () =>
    run(async () => {
      const userId = requireUserId();
      if (pin.length !== BmoniEmbeddedSdk.pinLength) {
        throw new ExampleError(
          `Enter a ${BmoniEmbeddedSdk.pinLength}-digit PIN.`,
        );
      }

      // Pre-flight so the duplicate-currency guard has data. A first-time user
      // has no wallet group yet, so this 400s with "No embedded smart wallet
      // group found" — expected right before creating the first wallet. Any
      // real error (auth, network) resurfaces on the owner-proof call below.
      let owned = ownedCodes;
      try {
        owned = stablecoinCodes(await refreshWalletData(userId));
      } catch (e) {
        if (!(e instanceof ProxyApiError)) {
          throw e;
        }
      }
      const requested = currency.smartWalletCurrency.toUpperCase();
      if (owned.has(requested)) {
        throw new ExampleError(
          `You already have a ${currency.smartWalletCurrency} wallet. ` +
            'Choose another currency.',
        );
      }

      const address = await loadOrCreateOwnerAddress(pin);
      const challenge = await client.createOwnerProofChallenge({
        userId,
        currency: currency.smartWalletCurrency,
        userOwnerAddress: address,
      });
      // The same key that produced userOwnerAddress must sign the challenge, or
      // create-managed rejects the request.
      const signature = await BmoniEmbeddedSdk.signMessage(
        challenge.message,
        pinArgument(pin),
      );
      const wallet = await client.createManagedSmartWallet({
        userId,
        currency: currency.smartWalletCurrency,
        userOwnerAddress: address,
        ownerProofChallengeId: challenge.challengeId,
        ownerProofSignature: signature,
      });

      setOwnerAddress(address);
      setSmartWallet(wallet);
      setAddingWallet(false);
      setStep('walletHome');
      setMessage(`${currency.label} smart wallet is ready.`);
      setLastResponse(prettyJson({ownerProofChallenge: challenge, smartWallet: wallet}));
      await saveSession({
        smartWallet: wallet,
        ownerAddress: address,
        isLoggedIn: true,
      });
      await refreshWalletData(userId);
    });

  const startAddWallet = () =>
    run(async () => {
      const userId = requireUserId();
      const owned = stablecoinCodes(await refreshWalletData(userId));
      const codes = await loadSupportedCurrencies();
      // An empty list means the API did not answer — do not filter on it.
      const supported =
        codes.length > 0 ? codes.map(code => code.toUpperCase()) : null;
      const available = WALLET_CURRENCIES.filter(option => {
        const code = option.smartWalletCurrency.toUpperCase();
        return !owned.has(code) && (supported === null || supported.includes(code));
      });
      if (available.length === 0) {
        setMessage(
          'You already have wallets for every supported currency on this account.',
        );
        return;
      }
      setAddingWallet(true);
      setStep('selectCurrency');
      if (!available.includes(currency)) {
        setCurrency(available[0]);
      }
      setMessage(
        'Choose a currency you do not already have. Existing wallets are disabled.',
      );
    });

  const selectActiveWallet = (wallet: SmartWallet) =>
    run(async () => {
      setSmartWallet(wallet);
      setCurrency(currencyFromSmartWalletCurrency(wallet.currency));
      setMessage(`Active wallet: ${wallet.currency} · ${wallet.id}`);
      await saveSession({smartWallet: wallet, isLoggedIn: true});
    });

  const refreshWalletsUi = () =>
    run(async () => {
      await refreshWalletData(requireUserId());
      setMessage('Wallets and balances refreshed from the API.');
    });

  const reloadActiveWallet = () =>
    run(async () => {
      const userId = requireUserId();
      const wallet = await client.getSmartWallet({
        userId,
        smartWalletId: requireWallet().id,
      });
      setSmartWallet(wallet);
      setMessage('Current wallet reloaded from GET …/smart-wallets/{id}.');
      await saveSession({smartWallet: wallet, isLoggedIn: true});
      await refreshWalletData(userId);
    });

  // --- onboarding gate -----------------------------------------------------

  /**
   * True when the rail for the active currency is live. Otherwise it opens the
   * KYC wizard (or reports that a review is already in flight) and returns false.
   */
  const ensureRailActive = useCallback(async (): Promise<boolean> => {
    const userId = requireUserId();

    // USD readiness is the virtual-bank-account lifecycle, not onboarding/status.
    if (currency.key === 'usd') {
      let vba: Json;
      try {
        vba = await client.getUsdVba(userId);
      } catch (e) {
        if (!(e instanceof ProxyApiError)) {
          throw e;
        }
        setStep('kycWizard');
        return false;
      }
      const status = String(vba.status ?? '').toLowerCase();
      setLastResponse(prettyJson(vba));
      if (status === 'active') {
        return true;
      }
      if (status === 'provisioning' || status === 'pending') {
        setMessage(
          'USD account is still being issued. Poll GET /vba/usd until status is active.',
        );
        return false;
      }
      setStep('kycWizard');
      return false;
    }

    // Mexico reports its own Etherfuse review status.
    if (currency.key === 'mxn') {
      let mx: Json;
      try {
        mx = await client.getMxKycStatus(userId);
      } catch (e) {
        if (!(e instanceof ProxyApiError)) {
          throw e;
        }
        setStep('kycWizard');
        return false;
      }
      const status = String(mx.status ?? '').toLowerCase();
      setLastResponse(prettyJson(mx));
      if (status === 'approved') {
        return true;
      }
      if (status === 'pending' || status === 'processing') {
        setMessage(
          'Etherfuse review in flight. Poll GET /latam/mx/kyc/status until approved.',
        );
        return false;
      }
      setStep('kycWizard');
      return false;
    }

    const status = await client.getOnboardingStatus(userId);
    const rail = onboardingStatusFor(status, currency)?.toLowerCase();
    setLastResponse(prettyJson(status));
    if (rail === 'active' || rail === 'approved' || rail === 'completed') {
      return true;
    }
    if (rail === 'pending') {
      setMessage(
        'Your information is already submitted and under review. You do not ' +
          'need to complete KYC again.',
      );
      return false;
    }
    setStep('kycWizard');
    return false;
  }, [client, currency, requireUserId]);

  // --- top up --------------------------------------------------------------

  const [depositChoice, setDepositChoice] = useState<DepositAsset[] | null>(null);
  const depositResolve = useRef<((asset: DepositAsset | null) => void) | null>(
    null,
  );

  const pickDepositAsset = (assets: DepositAsset[]) =>
    new Promise<DepositAsset | null>(resolve => {
      depositResolve.current = resolve;
      setDepositChoice(assets);
    });

  const resolveDepositChoice = (asset: DepositAsset | null) => {
    setDepositChoice(null);
    depositResolve.current?.(asset);
    depositResolve.current = null;
  };

  const topUpCrypto = async (userId: string, smartWalletId: string) => {
    // The chain/token list comes from GET /v1/deposit/supported-assets; USDC on
    // Base is only the fallback when that catalogue cannot be read.
    let assets: DepositAsset[] = [];
    try {
      assets = await client.getSupportedDepositAssets();
    } catch (e) {
      console.warn('supported-assets unavailable:', describeError(e));
    }
    let asset: DepositAsset = assets[0] ?? {chain: 'Base', currency: 'USDC'};
    if (assets.length > 1) {
      const picked = await pickDepositAsset(assets);
      if (!picked) {
        return;
      }
      asset = picked;
    }
    const response = await client.depositToWallet({
      userId,
      smartWalletId,
      chain: asset.chain,
      currency: asset.currency,
    });
    const address = response.address;
    const pair = `${asset.currency} on ${asset.chain}`;
    setMessage(
      typeof address === 'string' && address !== ''
        ? `Top up: send ${pair} to ${address} — it is converted and credited automatically.`
        : `Top up: deposit address generated. Send ${pair} to the returned address.`,
    );
    setLastResponse(prettyJson(response));
  };

  const topUpBank = async (userId: string, smartWalletId: string) => {
    switch (currency.key) {
      case 'usd': {
        const readiness = await client.getUsdReadiness(userId);
        if (readiness.ready !== true) {
          const missing = Array.isArray(readiness.missing)
            ? readiness.missing.join(', ')
            : 'unknown';
          setMessage(`USD VBA not ready. Outstanding requirements: ${missing}.`);
          setLastResponse(prettyJson(readiness));
          return;
        }
        const provision = await client.startUsaOnboarding({userId, smartWalletId});
        const vba = await client.getUsdVba(userId);
        setMessage(
          `USD VBA provisioning started (status: ${vba.status ?? 'unknown'}). ` +
            'Poll GET /vba/usd for the account details once active.',
        );
        setLastResponse(prettyJson({provision, vba}));
        return;
      }
      case 'ngn': {
        const raw = await client.getBankAccounts(userId);
        const bankAccountId = readBankAccountId(extractNigerianDeposits(raw)[0] ?? {});
        if (!bankAccountId) {
          throw new ExampleError(
            'No NGN deposit account yet. It is created by Nigeria onboarding ' +
              '(POST /onboarding/start-nigeria).',
          );
        }
        const link = await client.linkDepositVba({
          userId,
          smartWalletId,
          region: 'nigeria',
          bankAccountId,
        });
        const details = await client
          .getDepositAccounts(userId, 'NGN')
          .catch(() => null);
        setMessage(
          'NGN deposit account routed to this wallet. Incoming NGN is swept to it as cNGN.',
        );
        setLastResponse(prettyJson({link, depositAccounts: details}));
        return;
      }
      case 'eur': {
        const raw = await client.getBankAccounts(userId);
        const bankAccountId = readBankAccountId(extractEuropeanDeposits(raw)[0] ?? {});
        if (!bankAccountId) {
          throw new ExampleError(
            'No EUR deposit account yet. It is created by EU onboarding ' +
              '(POST /onboarding/start-monerium).',
          );
        }
        const link = await client.linkDepositVba({
          userId,
          smartWalletId,
          region: 'eu',
          bankAccountId,
        });
        setMessage(
          'EUR IBAN reserved for this wallet. Outbound SEPA payouts live under Integrations.',
        );
        setLastResponse(prettyJson(link));
        return;
      }
      case 'mxn': {
        // Deposit-driven: the SPEI CLABE exists once Mexico KYC is approved,
        // and MXN sent to it onramps automatically — no quote or order.
        const accounts = await client.getDepositAccounts(userId, 'MXN');
        setMessage(
          'Send MXN by SPEI to the CLABE below. It onramps to this wallet automatically.',
        );
        setLastResponse(prettyJson(accounts ?? {}));
        return;
      }
      case 'cad':
        throw new ExampleError(
          'Bank transfer top-up for CAD is not wired in this example. Use crypto top-up.',
        );
    }
  };

  const handleTopUp = (method: 'crypto' | 'bank') =>
    run(async () => {
      const userId = requireUserId();
      const smartWalletId = requireWallet().id;
      if (!(await ensureRailActive())) {
        return;
      }
      if (method === 'crypto') {
        await topUpCrypto(userId, smartWalletId);
      } else {
        await topUpBank(userId, smartWalletId);
      }
    });

  const [topUpSheet, setTopUpSheet] = useState(false);

  // --- withdraw ------------------------------------------------------------

  const handleWithdraw = () =>
    run(async () => {
      requireWallet();
      if (!(await ensureRailActive())) {
        return;
      }
      if (currency.key !== 'ngn') {
        setMessage(
          `This example wires bank offramp for Nigeria only. For ${currency.label}, ` +
            'use the payout rails under Integrations (bank payouts, EU SEPA, LATAM).',
        );
        return;
      }
      setShowNigeriaWithdrawal(true);
    });

  const onWithdrawalProposal = (proposal: Json) => {
    setShowNigeriaWithdrawal(false);
    const proposalId = readProposalId(proposal);
    setPendingProposalId(proposalId ?? null);
    setMessage(
      proposalId
        ? `Proposal ${proposalId} created (status ${proposal.status ?? 'unknown'}). ` +
            'Once approvals move it to PENDING_SIGNATURES, sign it with the owner key.'
        : 'Offramp created, but the response carried no proposalId — check the raw body.',
    );
    setLastResponse(prettyJson(proposal));
  };

  const checkProposal = () =>
    run(async () => {
      if (!pendingProposalId) {
        return;
      }
      const proposal = await client.getProposal({
        userId: requireUserId(),
        proposalId: pendingProposalId,
      });
      const status = String(proposal.status ?? 'unknown');
      setMessage(`Proposal ${pendingProposalId} is ${status}.`);
      setLastResponse(prettyJson(proposal));
      if (status.toUpperCase() === 'COMPLETED') {
        setPendingProposalId(null);
      }
    });

  /**
   * sign-payload → sign the EIP-712 digest with the owner key → POST …/sign. The
   * signer must be the key registered as `userOwnerAddress`, or the recovered
   * address will not match the proposal's signer snapshot.
   */
  const signProposal = async () => {
    if (!pendingProposalId || busyRef.current) {
      return;
    }
    const entered = await promptPin();
    if (entered === null) {
      return;
    }
    await run(async () => {
      const userId = requireUserId();
      const payload = await client.getProposalSignPayload({
        userId,
        proposalId: pendingProposalId,
      });
      const hash = extractSignableHash(payload);
      if (!hash) {
        setMessage(
          'sign-payload returned no 32-byte digest — inspect the raw payload ' +
            'below before signing anything.',
        );
        setLastResponse(prettyJson(payload));
        return;
      }
      const signature = await BmoniEmbeddedSdk.signTransactionHash(
        hash,
        pinArgument(entered),
      );
      const signed = await client.signProposal({
        userId,
        proposalId: pendingProposalId,
        signature,
      });
      setMessage(
        `Signature submitted for proposal ${pendingProposalId} (status ${
          signed.status ?? 'unknown'
        }).`,
      );
      setLastResponse(prettyJson({signPayload: payload, sign: signed}));
    });
  };

  // --- swap ----------------------------------------------------------------

  const handleSwap = () =>
    run(async () => {
      const userId = requireUserId();
      requireWallet();
      if (!(await ensureRailActive())) {
        return;
      }
      const parsedAmount = Number(amount.trim());
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new ExampleError('Enter an amount greater than zero.');
      }
      const response = await client.convertCurrency({
        userId,
        amount: parsedAmount,
        from: currency.fiatCode,
        to: toCurrency.trim().toUpperCase(),
      });
      setMessage('Swap preview returned by the exchange endpoint.');
      setLastResponse(prettyJson(response));
    });

  // --- render --------------------------------------------------------------

  const walletCurrencyLabel = (option: WalletCurrencyOption) => {
    const owned = ownedCodes.has(option.smartWalletCurrency.toUpperCase());
    const unsupported = isUnsupported(option);
    return {owned, unsupported};
  };

  const balanceRows = Array.isArray(balances.balances) ? balances.balances : [];

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={localHeaderStyle}>
          <Text style={styles.cardTitle}>BMoni Embedded API Example</Text>
          <Row>
            {step === 'walletHome' || step === 'unlock' ? (
              <Button
                label="Log out"
                kind="ghost"
                onPress={logout}
                disabled={busy}
              />
            ) : null}
            {step !== 'loading' ? (
              <Button
                label="Reset"
                kind="ghost"
                onPress={resetEverything}
                disabled={busy}
              />
            ) : null}
          </Row>
        </View>

        {step === 'kycWizard' && user && smartWallet ? (
          <KycWizard
            client={client}
            userId={user.bmoniUserId}
            currency={currency}
            wallet={smartWallet}
            initial={{firstName, lastName, email, phone}}
            onCancel={() => {
              setStep('walletHome');
              setMessage('KYC wizard closed. Retry the action when you are ready.');
            }}
            onSubmitted={summary => {
              setStep('walletHome');
              setMessage(
                'KYC profile saved, documents uploaded, verification activated ' +
                  `and ${currency.kycProviderLabel} started. Retry your action.`,
              );
              setLastResponse(prettyJson(summary));
            }}
          />
        ) : (
          <ScrollView contentContainerStyle={styles.scroll}>
            <StatusBanner message={message} error={error} />

            {step === 'loading' ? <Note>Restoring session…</Note> : null}

            {step === 'createAccount' ? (
              <>
                <Header
                  title="Create your account"
                  body="Configure the partner API, create a BMoni user, then choose the wallet currency to provision."
                />
                <SectionCard title="API configuration">
                  <Field
                    label="Proxy API base URL"
                    value={baseUrl}
                    onChangeText={setBaseUrl}
                    placeholder="http://localhost:4001"
                    keyboardType="url"
                  />
                  <Note>
                    Origin only — no trailing /v1. Paths already start with /v1/.
                  </Note>
                  <Field
                    label="Partner API key"
                    value={apiKey}
                    onChangeText={setApiKey}
                    placeholder="x-api-key value"
                    secureTextEntry
                  />
                </SectionCard>
                <SectionCard title="User details">
                  <Field label="First name" value={firstName} onChangeText={setFirstName} />
                  <Field label="Last name" value={lastName} onChangeText={setLastName} />
                  <Field
                    label="Email"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                  />
                  <Field
                    label="Phone number"
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                  />
                  <Button
                    label="Create account"
                    onPress={createAccount}
                    disabled={busy}
                  />
                </SectionCard>
              </>
            ) : null}

            {step === 'unlock' ? (
              <>
                <Header
                  title="Welcome back"
                  body={`Enter the ${BmoniEmbeddedSdk.pinLength}-digit PIN configured for this device wallet.`}
                />
                <SectionCard title="PIN unlock">
                  <Field
                    label={`${BmoniEmbeddedSdk.pinLength}-digit PIN`}
                    value={pin}
                    onChangeText={text => setPin(text.replace(/\D/g, ''))}
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={BmoniEmbeddedSdk.pinLength}
                  />
                  <Button label="Unlock" onPress={unlock} disabled={busy} />
                </SectionCard>
              </>
            ) : null}

            {step === 'selectCurrency' ? (
              <>
                <Header
                  title={addingWallet ? 'Add another wallet' : 'Choose wallet currency'}
                  body={
                    addingWallet
                      ? 'Only currencies you do not already hold are selectable — the API rejects a duplicate stablecoin wallet.'
                      : 'The example provisions a local EVM owner key, signs an owner-proof challenge, then creates a managed smart wallet.'
                  }
                />
                {addingWallet && smartWallet ? (
                  <Button
                    label="Back to wallet home"
                    kind="ghost"
                    onPress={() => {
                      setAddingWallet(false);
                      setStep('walletHome');
                      setMessage(null);
                    }}
                  />
                ) : null}
                <SectionCard title="Currency">
                  {WALLET_CURRENCIES.map(option => {
                    const {owned, unsupported} = walletCurrencyLabel(option);
                    const disabled = owned || unsupported;
                    const selected = option.key === currency.key;
                    return (
                      <Pressable
                        key={option.key}
                        accessibilityRole="radio"
                        accessibilityState={{selected, disabled}}
                        disabled={disabled}
                        onPress={() => setCurrency(option)}
                        style={[
                          styles.currencyTile,
                          selected && !disabled && styles.currencyTileSelected,
                          disabled && styles.currencyTileDisabled,
                        ]}>
                        <Text style={styles.currencyLabel}>{option.label}</Text>
                        <Text style={styles.currencyMeta}>
                          {option.smartWalletCurrency} · {option.kycProviderLabel}
                        </Text>
                        {owned ? (
                          <Text style={styles.currencyFootnote}>
                            Already created for this account
                          </Text>
                        ) : unsupported ? (
                          <Text style={styles.currencyFootnote}>
                            Not in GET /v1/smart-wallets/supported-currencies
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </SectionCard>
                <SectionCard title="Device PIN">
                  <Field
                    label={`Set or verify ${BmoniEmbeddedSdk.pinLength}-digit PIN`}
                    value={pin}
                    onChangeText={text => setPin(text.replace(/\D/g, ''))}
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={BmoniEmbeddedSdk.pinLength}
                  />
                  {ownerAddress ? (
                    <KeyValueRow label="Owner address" value={ownerAddress} />
                  ) : null}
                  <Button
                    label="Create smart wallet"
                    onPress={provisionSmartWallet}
                    disabled={
                      busy ||
                      ownedCodes.has(currency.smartWalletCurrency.toUpperCase()) ||
                      isUnsupported(currency)
                    }
                  />
                </SectionCard>
              </>
            ) : null}

            {step === 'walletHome' && smartWallet ? (
              <>
                <Header
                  title="Wallet home"
                  body="Top up: crypto (chains from GET /v1/deposit/supported-assets) or a virtual bank account. Withdraw: Nigerian offramp — a proposal you then sign with the owner key. Other rails live under Integrations. Onboarding is checked first."
                />
                <SectionCard title={`${currency.label} wallet`}>
                  <KeyValueRow label="Wallet ID" value={smartWallet.id} />
                  <KeyValueRow label="Currency" value={smartWallet.currency} />
                  <KeyValueRow label="Status" value={smartWallet.status || 'n/a'} />
                  <KeyValueRow
                    label="Smart account"
                    value={
                      smartWallet.smartAccountAddress ??
                      smartWallet.walletAddress ??
                      'n/a'
                    }
                  />
                </SectionCard>

                <View style={styles.walletActions}>
                  <Button
                    label="Top up"
                    style={styles.flex}
                    onPress={() => setTopUpSheet(true)}
                    disabled={busy}
                  />
                  <Button
                    label="Withdraw"
                    kind="secondary"
                    style={styles.flex}
                    onPress={handleWithdraw}
                    disabled={busy}
                  />
                  <Button
                    label="Swap"
                    kind="secondary"
                    style={styles.flex}
                    onPress={handleSwap}
                    disabled={busy}
                  />
                </View>

                <SectionCard title="Swap preview">
                  <Note>POST …/exchange/convert</Note>
                  <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
                  <Field
                    label="To currency"
                    value={toCurrency}
                    onChangeText={setToCurrency}
                    autoCapitalize="characters"
                  />
                </SectionCard>

                {pendingProposalId ? (
                  <SectionCard title="Pending offramp proposal">
                    <KeyValueRow label="Proposal" value={pendingProposalId} />
                    <Note>
                      PENDING_APPROVALS → PENDING_SIGNATURES → COMPLETED. Signing
                      before approvals clear is rejected — poll the status first.
                    </Note>
                    <Button
                      label="Check status"
                      kind="secondary"
                      onPress={checkProposal}
                      disabled={busy}
                    />
                    <Button
                      label="Sign proposal with owner key"
                      onPress={signProposal}
                      disabled={busy}
                    />
                  </SectionCard>
                ) : null}

                <SectionCard title="Explore integrations">
                  <Note>
                    Swap quote, EU SEPA payout, LATAM cash, LATAM Mexico, USD VBA,
                    bank payouts and payment wallet-selection — each calls the proxy
                    and dumps the raw response.
                  </Note>
                  <Button
                    label="Open integrations"
                    kind="secondary"
                    onPress={() => setShowIntegrations(true)}
                    disabled={busy}
                  />
                </SectionCard>

                <SectionCard title="All wallets on this account">
                  <Note>
                    GET …/smart-wallets/account/wallets — {accountWallets.length}{' '}
                    wallet(s). Inactive or preparing wallets are omitted upstream.
                  </Note>
                  {accountWallets.length === 0 ? (
                    <Note>List not loaded yet. Tap refresh to sync.</Note>
                  ) : (
                    accountWallets.map(wallet => {
                      const active = wallet.id === smartWallet.id;
                      return (
                        <View
                          key={wallet.id}
                          style={[styles.listItem, active && styles.listItemActive]}>
                          <Text style={styles.currencyLabel}>{wallet.currency}</Text>
                          <Text style={styles.currencyMeta}>
                            {wallet.id}
                            {wallet.status ? ` · ${wallet.status}` : ''}
                          </Text>
                          {active ? (
                            <Text style={styles.currencyMeta}>Active</Text>
                          ) : (
                            <Button
                              label="Use"
                              kind="ghost"
                              onPress={() => selectActiveWallet(wallet)}
                              disabled={busy}
                            />
                          )}
                        </View>
                      );
                    })
                  )}
                  <Button
                    label="Refresh wallets & balances"
                    kind="secondary"
                    onPress={refreshWalletsUi}
                    disabled={busy}
                  />
                  <Button
                    label="Add another wallet"
                    kind="secondary"
                    onPress={startAddWallet}
                    disabled={busy}
                  />
                  <Button
                    label="Reload active wallet (GET by id)"
                    kind="secondary"
                    onPress={reloadActiveWallet}
                    disabled={busy}
                  />
                </SectionCard>

                <SectionCard title="Account balances">
                  <Note>GET …/smart-wallets/account/balances</Note>
                  {typeof balances.smartAccountAddress === 'string' ? (
                    <KeyValueRow
                      label="Smart account"
                      value={balances.smartAccountAddress}
                    />
                  ) : null}
                  {balanceRows.length === 0 ? (
                    <Note>No balance rows yet. Tap refresh.</Note>
                  ) : (
                    balanceRows.map((row, index) => {
                      const record =
                        typeof row === 'object' && row !== null
                          ? (row as Json)
                          : {};
                      const rowError = record.error;
                      return (
                        <KeyValueRow
                          key={`${String(record.currency ?? index)}`}
                          label={String(record.currency ?? '—')}
                          value={
                            typeof rowError === 'string' && rowError !== ''
                              ? rowError
                              : String(record.balance ?? '—')
                          }
                        />
                      );
                    })
                  )}
                </SectionCard>
              </>
            ) : null}

            {lastResponse ? <LastResponsePanel value={lastResponse} /> : null}
          </ScrollView>
        )}

        <BusyOverlay visible={busy} />

        <PinPrompt
          visible={pinPrompt !== null}
          pinLength={BmoniEmbeddedSdk.pinLength}
          onCancel={() => pinPrompt?.(null)}
          onSubmit={value => pinPrompt?.(value)}
        />

        {/* Top-up method sheet */}
        <Modal
          visible={topUpSheet}
          transparent
          animationType="fade"
          onRequestClose={() => setTopUpSheet(false)}>
          <View style={styles.modalScrim}>
            <View style={styles.modalSheet}>
              <Text style={styles.cardTitle}>Top up</Text>
              <Note>Crypto deposit — an on-chain address for this wallet.</Note>
              <Button
                label="Crypto deposit"
                onPress={() => {
                  setTopUpSheet(false);
                  handleTopUp('crypto');
                }}
              />
              <Note>
                Bank transfer — a virtual bank account for {currency.fiatCode}.
              </Note>
              <Button
                label="Bank transfer (VBA)"
                kind="secondary"
                onPress={() => {
                  setTopUpSheet(false);
                  handleTopUp('bank');
                }}
              />
              <Button
                label="Cancel"
                kind="ghost"
                onPress={() => setTopUpSheet(false)}
              />
            </View>
          </View>
        </Modal>

        {/* Deposit-asset picker, fed by GET /v1/deposit/supported-assets */}
        <Modal
          visible={depositChoice !== null}
          transparent
          animationType="fade"
          onRequestClose={() => resolveDepositChoice(null)}>
          <View style={styles.modalScrim}>
            <View style={styles.modalSheet}>
              <Text style={styles.cardTitle}>Deposit asset</Text>
              <ScrollView style={styles.modalList}>
                {(depositChoice ?? []).map(asset => (
                  <Pressable
                    key={`${asset.chain}-${asset.currency}`}
                    accessibilityRole="button"
                    style={styles.modalOption}
                    onPress={() => resolveDepositChoice(asset)}>
                    <Text style={styles.text}>
                      {asset.currency} · {asset.chain}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Button
                label="Cancel"
                kind="ghost"
                onPress={() => resolveDepositChoice(null)}
              />
            </View>
          </View>
        </Modal>

        {showNigeriaWithdrawal && user && smartWallet ? (
          <NigeriaWithdrawalModal
            client={client}
            userId={user.bmoniUserId}
            smartWalletId={smartWallet.id}
            onCancel={() => setShowNigeriaWithdrawal(false)}
            onProposal={onWithdrawalProposal}
          />
        ) : null}

        {showIntegrations && user && smartWallet ? (
          <IntegrationsScreen
            client={client}
            userId={user.bmoniUserId}
            smartWalletId={smartWallet.id}
            smartWalletAddress={walletAddressOf(smartWallet)}
            onClose={() => setShowIntegrations(false)}
          />
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const localHeaderStyle = {
  paddingHorizontal: 16,
  paddingTop: 8,
  paddingBottom: 4,
  borderBottomWidth: 1,
  borderBottomColor: theme.border,
} as const;

