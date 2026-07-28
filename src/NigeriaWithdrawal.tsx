/**
 * Nigerian bank withdrawal: nigerian-banks → verify → register → offramp.
 *
 * The bank name and CBN code must be sent verbatim from the lookup, and
 * registration requires the exact account holder name that verify returns — so
 * Verify gates the submit button.
 */

import React, {useEffect, useState} from 'react';
import {Modal, Text, View} from 'react-native';

import {
  describeError,
  readBankAccountId,
  type Json,
  type NigerianBank,
  type ProxyApiClient,
} from './proxyClient';
import {ExampleError} from './sdk';
import {Button, Field, Note, Row, Select, StatusBanner, styles} from './ui';

export function NigeriaWithdrawalModal({
  client,
  userId,
  smartWalletId,
  onCancel,
  onProposal,
}: {
  client: ProxyApiClient;
  userId: string;
  smartWalletId: string;
  onCancel: () => void;
  onProposal: (proposal: Json) => void;
}) {
  const [banks, setBanks] = useState<NigerianBank[]>([]);
  const [bank, setBank] = useState<NigerianBank | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [amount, setAmount] = useState('100.00');
  const [verifiedName, setVerifiedName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const loaded = await client.getNigerianBanks(userId);
        if (!cancelled) {
          setBanks(loaded);
        }
      } catch (e) {
        if (!cancelled) {
          setError(`Could not load nigerian-banks: ${describeError(e)}`);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, userId]);

  const guard = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = () =>
    guard(async () => {
      if (!bank || accountNumber.trim().length !== 10) {
        throw new ExampleError(
          'Select a bank and enter a 10-digit account number.',
        );
      }
      setVerifiedName(null);
      const response = await client.verifyNigerianAccount({
        userId,
        bankCode: bank.code,
        accountNumber: accountNumber.trim(),
      });
      const name = response.accountName ?? response.accountHolderName;
      if (typeof name !== 'string' || name.trim() === '') {
        throw new ExampleError(
          'verify-nigerian-account returned no account holder name; ' +
            'registration needs it verbatim.',
        );
      }
      setVerifiedName(name.trim());
    });

  const submit = () =>
    guard(async () => {
      if (!bank || !verifiedName) {
        throw new ExampleError(
          'Verify the account first — registration needs the exact holder name ' +
            'from verify-nigerian-account.',
        );
      }
      const account = await client.getOrCreateNigerianWithdrawalAccount({
        userId,
        body: {
          accountNumber: accountNumber.trim(),
          bankCode: bank.code,
          bankName: bank.name,
          accountHolderName: verifiedName,
        },
      });
      const bankAccountId = readBankAccountId(account);
      if (!bankAccountId) {
        throw new ExampleError('Missing payout account id from the API.');
      }
      const proposal = await client.offrampNigeriaBank({
        userId,
        smartWalletId,
        bankAccountId,
        fromAmount: amount.trim(),
      });
      onProposal(proposal);
    });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalScrim}>
        <View style={styles.modalSheet}>
          <Text style={styles.cardTitle}>Withdraw to a Nigerian bank</Text>
          <StatusBanner error={error} />
          <Select
            label={banks.length === 0 ? 'Bank (loading…)' : 'Bank (name + CBN code)'}
            value={bank}
            options={banks}
            optionLabel={option => `${option.name} · ${option.code}`}
            onChange={option => {
              setBank(option);
              // The verified name belongs to the previous bank + number pair.
              setVerifiedName(null);
            }}
            disabled={busy}
          />
          <Field
            label="Account number (10 digits)"
            value={accountNumber}
            onChangeText={text => {
              setAccountNumber(text.replace(/\D/g, ''));
              setVerifiedName(null);
            }}
            keyboardType="number-pad"
            maxLength={10}
          />
          <Field
            label="Amount to offramp (decimal, e.g. 100.00)"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
          <Note>
            {verifiedName
              ? `Verified holder: ${verifiedName}`
              : 'Verify to fetch the exact account holder name — registration requires it verbatim.'}
          </Note>
          <Row>
            <Button
              label="Cancel"
              kind="ghost"
              style={styles.flex}
              onPress={onCancel}
              disabled={busy}
            />
            <Button
              label="Verify"
              kind="secondary"
              style={styles.flex}
              onPress={verify}
              disabled={busy}
            />
          </Row>
          <Button
            label="Save payout & offramp"
            onPress={submit}
            disabled={busy || verifiedName === null}
          />
        </View>
      </View>
    </Modal>
  );
}
