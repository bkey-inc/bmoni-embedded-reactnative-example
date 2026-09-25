/**
 * The regional / provider integrations that sit outside the core onboarding +
 * top-up + withdraw + swap flow: swap quote, EU SEPA, LATAM cash, LATAM Mexico,
 * USD VBA, bank payouts and payment wallet-selection.
 *
 * Each action calls the proxy and dumps the raw JSON response. Flows that return
 * a `signatureRequest` (or a `messageToSign`) expose "Sign & submit", which signs
 * the hash with `signTransactionHash` and completes via the matching endpoint —
 * `eu/orders/complete` for EU orders, `wallets/submit-signature` otherwise.
 */

import React, {useRef, useState} from 'react';
import {Modal, ScrollView, Text, View} from 'react-native';

import {
  extractSignableHash,
  prettyJson,
  readWorkflowId,
  type Json,
  type ProxyApiClient,
} from './proxyClient';
import {BmoniEmbeddedSdk, describeSdkError, pinArgument} from './sdk';
import {
  BusyOverlay,
  Button,
  Field,
  LastResponsePanel,
  Note,
  PinPrompt,
  Row,
  SectionCard,
  StatusBanner,
  styles,
} from './ui';

type Complete = (signature: string) => Promise<Json>;

export function IntegrationsScreen({
  client,
  userId,
  smartWalletId,
  onClose,
}: {
  client: ProxyApiClient;
  userId: string;
  smartWalletId: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pending signable workflow — the last signable flow wins, which is enough
  // for a demo.
  const [pending, setPending] = useState<{
    label: string;
    workflowId?: string;
    hash: string;
  } | null>(null);
  const completeRef = useRef<Complete | null>(null);
  const [pinVisible, setPinVisible] = useState(false);

  const [swapFrom, setSwapFrom] = useState('USDB');
  const [swapTo, setSwapTo] = useState('cNGN');
  const [swapAmount, setSwapAmount] = useState('100');

  const [euAmount, setEuAmount] = useState('20.00');
  const [euIban, setEuIban] = useState('');
  const [euFirstName, setEuFirstName] = useState('');
  const [euLastName, setEuLastName] = useState('');
  const [euCountry, setEuCountry] = useState('DE');
  const [euMemo, setEuMemo] = useState('');
  const [euKycCode, setEuKycCode] = useState('');
  const [euKycSignature, setEuKycSignature] = useState('');

  const [cashCountry, setCashCountry] = useState('MX');
  const [cashPrice, setCashPrice] = useState('1000');
  const [cashCurrency, setCashCurrency] = useState('MXN');
  const [cashDescription, setCashDescription] = useState('Example cash order');
  const [cashOrderId, setCashOrderId] = useState('');

  const [mxAmount, setMxAmount] = useState('500');
  const [mxOrderId, setMxOrderId] = useState('');

  const [poCountry, setPoCountry] = useState('NGA');
  const [poCurrency, setPoCurrency] = useState('NGN');
  const [poBankId, setPoBankId] = useState('');
  const [poAccountNumber, setPoAccountNumber] = useState('');
  const [poAccountHolder, setPoAccountHolder] = useState('');
  const [poAmount, setPoAmount] = useState('100000000');

  const run = async (task: () => Promise<unknown>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await task();
      setOutput(result === null || result === undefined ? '(no response body)' : prettyJson(result));
    } catch (e) {
      setError(describeSdkError(e));
    } finally {
      setBusy(false);
    }
  };

  /** Records a signable workflow from `json` so the user can sign and finish it. */
  const capturePending = (json: Json, label: string, complete: Complete) => {
    const hash = extractSignableHash(json);
    if (!hash) {
      setPending(null);
      completeRef.current = null;
      return;
    }
    setPending({label, workflowId: readWorkflowId(json), hash});
    completeRef.current = complete;
  };

  const signAndSubmit = (pin: string) => {
    const current = pending;
    const complete = completeRef.current;
    setPinVisible(false);
    if (!current || !complete) {
      return;
    }
    run(async () => {
      const signature = await BmoniEmbeddedSdk.signTransactionHash(
        current.hash,
        pinArgument(pin),
      );
      const result = await complete(signature);
      setPending(null);
      completeRef.current = null;
      return result;
    });
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Row>
            <Button label="Close" kind="ghost" onPress={onClose} />
          </Row>
          <Note>Active wallet: {smartWalletId}</Note>
          <StatusBanner error={error} />

          {pending ? (
            <SectionCard title={`Pending signature: ${pending.label}`}>
              <Note>
                workflowId: {pending.workflowId ?? '—'}
                {'\n'}hashToSign: {pending.hash}
              </Note>
              <Button
                label="Sign hashToSign & submit"
                onPress={() => setPinVisible(true)}
                disabled={busy}
              />
            </SectionCard>
          ) : null}

          <SectionCard title="Swap quote">
            <Note>GET exchange/rate/:from/:to · POST exchange/quote</Note>
            <Field label="From currency" value={swapFrom} onChangeText={setSwapFrom} autoCapitalize="characters" />
            <Field label="To currency" value={swapTo} onChangeText={setSwapTo} />
            <Field
              label="Amount in (exactIn)"
              value={swapAmount}
              onChangeText={setSwapAmount}
              keyboardType="decimal-pad"
            />
            <Row>
              <Button
                label="GET rate"
                kind="secondary"
                style={styles.flex}
                disabled={busy}
                onPress={() =>
                  run(() =>
                    client.getExchangeRate({
                      userId,
                      from: swapFrom.trim(),
                      to: swapTo.trim(),
                    }),
                  )
                }
              />
              <Button
                label="POST quote"
                style={styles.flex}
                disabled={busy}
                onPress={() =>
                  run(() =>
                    client.getSwapQuote({
                      userId,
                      fromCurrency: swapFrom.trim(),
                      toCurrency: swapTo.trim(),
                      amountType: 'exactIn',
                      amount: swapAmount.trim(),
                    }),
                  )
                }
              />
            </Row>
          </SectionCard>

          <SectionCard title="USD virtual bank account">
            <Note>
              Readiness (GET /kyc/usd-readiness) → provision (POST
              /onboarding/start-usa) → status (GET /vba/usd).
            </Note>
            <Row>
              <Button
                label="Readiness"
                kind="secondary"
                style={styles.flex}
                disabled={busy}
                onPress={() => run(() => client.getUsdReadiness(userId))}
              />
              <Button
                label="Provision"
                style={styles.flex}
                disabled={busy}
                onPress={() =>
                  run(() => client.startUsaOnboarding({userId, smartWalletId}))
                }
              />
            </Row>
            <Button
              label="GET vba/usd"
              kind="secondary"
              disabled={busy}
              onPress={() => run(() => client.getUsdVba(userId))}
            />
          </SectionCard>

          <SectionCard title="EU SEPA / Monerium">
            <Note>
              Complete EU KYC with the Monerium authorization code + signature,
              then prepare a SEPA payout and sign it.
            </Note>
            <Field label="Monerium auth code" value={euKycCode} onChangeText={setEuKycCode} />
            <Field label="KYC signature" value={euKycSignature} onChangeText={setEuKycSignature} />
            <Button
              label="POST eu/kyc"
              kind="secondary"
              disabled={busy}
              onPress={() =>
                run(() =>
                  client.completeEuKyc({
                    userId,
                    code: euKycCode.trim(),
                    signature: euKycSignature.trim(),
                  }),
                )
              }
            />
            <Field label="Amount (EUR)" value={euAmount} onChangeText={setEuAmount} keyboardType="decimal-pad" />
            <Field label="Beneficiary IBAN" value={euIban} onChangeText={setEuIban} autoCapitalize="characters" />
            <Field label="Beneficiary first name" value={euFirstName} onChangeText={setEuFirstName} />
            <Field label="Beneficiary last name" value={euLastName} onChangeText={setEuLastName} />
            <Field
              label="Country (ISO alpha-2)"
              value={euCountry}
              onChangeText={setEuCountry}
              autoCapitalize="characters"
              maxLength={2}
            />
            <Field label="Memo (5–140, optional)" value={euMemo} onChangeText={setEuMemo} />
            <Button
              label="POST eu/orders/prepare"
              disabled={busy}
              onPress={() =>
                run(async () => {
                  const response = await client.prepareEuOrder({
                    userId,
                    smartWalletId,
                    amount: euAmount.trim(),
                    iban: euIban.trim(),
                    firstName: euFirstName.trim(),
                    lastName: euLastName.trim(),
                    country: euCountry.trim(),
                    memo: euMemo.trim() || undefined,
                  });
                  const workflowId = readWorkflowId(response) ?? '';
                  capturePending(response, 'EU SEPA payout', signature =>
                    client.completeEuOrder({userId, workflowId, signature}),
                  );
                  return response;
                })
              }
            />
          </SectionCard>

          <SectionCard title="LATAM cash — Pago46">
            <Field
              label="Country (ISO alpha-2)"
              value={cashCountry}
              onChangeText={setCashCountry}
              autoCapitalize="characters"
              maxLength={2}
            />
            <Field label="Local currency" value={cashCurrency} onChangeText={setCashCurrency} autoCapitalize="characters" />
            <Field label="Price (local)" value={cashPrice} onChangeText={setCashPrice} keyboardType="decimal-pad" />
            <Field label="Description" value={cashDescription} onChangeText={setCashDescription} />
            <Row>
              <Button
                label="Fund order"
                kind="secondary"
                style={styles.flex}
                disabled={busy}
                onPress={() =>
                  run(() =>
                    client.createCashOrder({
                      userId,
                      kind: 'fund',
                      smartWalletId,
                      country: cashCountry.trim(),
                      price: cashPrice.trim(),
                      priceCurrency: cashCurrency.trim(),
                      description: cashDescription.trim(),
                    }),
                  )
                }
              />
              <Button
                label="Send order"
                style={styles.flex}
                disabled={busy}
                onPress={() =>
                  run(async () => {
                    const response = await client.createCashOrder({
                      userId,
                      kind: 'send',
                      smartWalletId,
                      country: cashCountry.trim(),
                      price: cashPrice.trim(),
                      priceCurrency: cashCurrency.trim(),
                      description: cashDescription.trim(),
                    });
                    const workflowId = readWorkflowId(response) ?? '';
                    capturePending(response, 'LATAM cash send', signature =>
                      client.submitSignature({userId, workflowId, signature}),
                    );
                    return response;
                  })
                }
              />
            </Row>
            <Button
              label="List orders"
              kind="secondary"
              disabled={busy}
              onPress={() => run(() => client.listCashOrders(userId))}
            />
            <Field label="Order id (GET one)" value={cashOrderId} onChangeText={setCashOrderId} />
            <Button
              label="GET order"
              kind="secondary"
              disabled={busy}
              onPress={() =>
                run(() => client.getCashOrder({userId, orderId: cashOrderId.trim()}))
              }
            />
          </SectionCard>

          <SectionCard title="LATAM Mexico — Etherfuse">
            <Note>
              activate → poll status. Onramp is deposit-driven: MXN sent by SPEI
              to the CLABE (GET …/deposit-accounts/MXN) credits the wallet with no
              quote. Offramp: quote → sign → submit-signature.
            </Note>
            <Row>
              <Button
                label="Activate KYC"
                kind="secondary"
                style={styles.flex}
                disabled={busy}
                onPress={() => run(() => client.activateMxKyc(userId))}
              />
              <Button
                label="KYC status"
                kind="secondary"
                style={styles.flex}
                disabled={busy}
                onPress={() => run(() => client.getMxKycStatus(userId))}
              />
            </Row>
            <Field label="Offramp source amount" value={mxAmount} onChangeText={setMxAmount} keyboardType="decimal-pad" />
            <Button
              label="POST offramp quote"
              disabled={busy}
              onPress={() =>
                run(async () => {
                  const response = await client.createMxOfframpQuote({
                    userId,
                    sourceAmount: mxAmount.trim(),
                  });
                  // The quote carries a signatureRequest funding the swap.
                  const workflowId = readWorkflowId(response) ?? '';
                  capturePending(response, 'MX offramp funding', signature =>
                    client.submitSignature({userId, workflowId, signature}),
                  );
                  return response;
                })
              }
            />
            <Field label="Order id (GET one)" value={mxOrderId} onChangeText={setMxOrderId} />
            <Button
              label="GET order"
              kind="secondary"
              disabled={busy}
              onPress={() =>
                run(() => client.getMxOrder({userId, orderId: mxOrderId.trim()}))
              }
            />
          </SectionCard>

          <SectionCard title="Bank payouts — Fin">
            <Note>
              amount is in USDB **minor units** here — "100000000", not "100.00".
              The Nigerian offramp uses a decimal fromAmount instead.
            </Note>
            <Field
              label="Country (ISO alpha-3)"
              value={poCountry}
              onChangeText={setPoCountry}
              autoCapitalize="characters"
              maxLength={3}
            />
            <Field label="Currency" value={poCurrency} onChangeText={setPoCurrency} autoCapitalize="characters" />
            <Row>
              <Button
                label="Countries"
                kind="secondary"
                style={styles.flex}
                disabled={busy}
                onPress={() => run(() => client.listPayoutCountries(userId))}
              />
              <Button
                label="Banks"
                kind="secondary"
                style={styles.flex}
                disabled={busy}
                onPress={() =>
                  run(() =>
                    client.listPayoutBanks({userId, country: poCountry.trim()}),
                  )
                }
              />
            </Row>
            <Field label="Bank id" value={poBankId} onChangeText={setPoBankId} />
            <Button
              label="Bank branches"
              kind="secondary"
              disabled={busy}
              onPress={() =>
                run(() =>
                  client.listPayoutBankBranches({userId, bankId: poBankId.trim()}),
                )
              }
            />
            <Field label="Account number" value={poAccountNumber} onChangeText={setPoAccountNumber} />
            <Field label="Account holder name" value={poAccountHolder} onChangeText={setPoAccountHolder} />
            <Field
              label="Amount (USDB minor units)"
              value={poAmount}
              onChangeText={setPoAmount}
              keyboardType="number-pad"
            />
            <Row>
              <Button
                label="Validate account"
                kind="secondary"
                style={styles.flex}
                disabled={busy}
                onPress={() =>
                  run(() =>
                    client.validatePayoutAccount({
                      userId,
                      country: poCountry.trim(),
                      currency: poCurrency.trim(),
                      accountNumber: poAccountNumber.trim(),
                      bankId: poBankId.trim() || undefined,
                    }),
                  )
                }
              />
              <Button
                label="Create payout"
                style={styles.flex}
                disabled={busy}
                onPress={() =>
                  run(async () => {
                    const response = await client.createPayout({
                      userId,
                      sourceSmartWalletId: smartWalletId,
                      amount: poAmount.trim(),
                      country: poCountry.trim(),
                      currency: poCurrency.trim(),
                      bankId: poBankId.trim(),
                      accountNumber: poAccountNumber.trim(),
                      accountHolderName: poAccountHolder.trim(),
                    });
                    const workflowId = readWorkflowId(response) ?? '';
                    capturePending(response, 'Bank payout', signature =>
                      client.submitSignature({userId, workflowId, signature}),
                    );
                    return response;
                  })
                }
              />
            </Row>
          </SectionCard>

          {output ? <LastResponsePanel value={output} /> : null}
          <Text style={styles.bodyMuted}>
            Signatures complete via POST wallets/submit-signature, or
            eu/orders/complete for EU orders.
          </Text>
        </ScrollView>

        <BusyOverlay visible={busy} />
        <PinPrompt
          visible={pinVisible}
          pinLength={BmoniEmbeddedSdk.pinLength}
          onCancel={() => setPinVisible(false)}
          onSubmit={signAndSubmit}
        />
      </View>
    </Modal>
  );
}
