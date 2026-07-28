/**
 * The KYC wizard. The submit order is fixed by the API and must not be
 * reordered:
 *
 *   PATCH /kyc → identification upload → proof-of-address upload →
 *   [biometric upload, Global KYC only] → GET /kyc/readiness →
 *   POST /kyc/activate → the rail's start-* onboarding
 */

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {launchImageLibrary} from 'react-native-image-picker';

import {
  asRecord,
  describeError,
  KYC_IDENTIFICATION_TYPES,
  KYC_PROOF_OF_ADDRESS_TYPES,
  mimeTypeForFilename,
  usesGlobalKyc,
  type Json,
  type ProxyApiClient,
  type SmartWallet,
  type UploadFile,
  type WalletCurrencyOption,
} from './proxyClient';
import {describeSdkError, ExampleError} from './sdk';
import {
  Button,
  Field,
  Note,
  SectionCard,
  Select,
  StatusBanner,
  styles,
  Toggle,
} from './ui';

interface VolumeRange {
  label: string;
  value: number;
}

const PAGES = [
  'Personal',
  'Address',
  'Employment',
  'Compliance',
  'Documents',
  'Review',
] as const;

const FALLBACK = {
  genders: ['male', 'female', 'other'],
  employmentStatuses: [
    'employed',
    'self_employed',
    'unemployed',
    'retired',
    'student',
    'homemaker',
  ],
  fundsSources: [
    'salary',
    'business',
    'investments',
    'pension',
    'government',
    'inheritance',
    'savings',
  ],
  accountPurposes: ['personal', 'business', 'investment'],
  volumeRanges: [
    {label: '$0–$4,999', value: 4999},
    {label: '$5,000–$9,999', value: 9999},
    {label: '$10,000+', value: 15000},
  ] satisfies VolumeRange[],
};

function stringList(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) {
    return fallback;
  }
  const out = raw.filter((item): item is string => typeof item === 'string');
  return out.length > 0 ? out : fallback;
}

function volumeRanges(raw: unknown): VolumeRange[] {
  if (!Array.isArray(raw)) {
    return FALLBACK.volumeRanges;
  }
  const out: VolumeRange[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    const value = record?.value;
    if (typeof value === 'number') {
      const rounded = Math.round(value);
      const label = typeof record?.label === 'string' ? record.label : '';
      out.push({label: label !== '' ? label : String(rounded), value: rounded});
    }
  }
  return out.length > 0 ? out : FALLBACK.volumeRanges;
}

/** Opens the gallery. Returns null when the user cancels. */
async function pickImage(): Promise<UploadFile | null> {
  const result = await launchImageLibrary({
    mediaType: 'photo',
    selectionLimit: 1,
  });
  if (result.didCancel) {
    return null;
  }
  if (result.errorCode) {
    throw new ExampleError(
      `Could not open the gallery: ${result.errorMessage ?? result.errorCode}`,
    );
  }
  const asset = result.assets?.[0];
  if (!asset?.uri) {
    return null;
  }
  const name = asset.fileName ?? 'upload.jpg';
  return {uri: asset.uri, name, type: asset.type ?? mimeTypeForFilename(name)};
}

export function KycWizard({
  client,
  userId,
  currency,
  wallet,
  initial,
  onCancel,
  onSubmitted,
}: {
  client: ProxyApiClient;
  userId: string;
  currency: WalletCurrencyOption;
  wallet: SmartWallet;
  initial: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  onCancel: () => void;
  onSubmitted: (summary: Json) => void;
}) {
  const globalKyc = usesGlobalKyc(currency);

  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<Json | null>(null);

  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [middleName, setMiddleName] = useState('');
  const [phone, setPhone] = useState(initial.phone);
  const [dob, setDob] = useState('1990-01-01');
  const [gender, setGender] = useState<string | null>(null);

  const [street1, setStreet1] = useState('15 Admiralty Way');
  const [street2, setStreet2] = useState('');
  const [city, setCity] = useState('Lagos');
  const [state, setState] = useState('Lagos');
  const [postal, setPostal] = useState('101241');
  const [countryCode, setCountryCode] = useState('NGA');

  const [occupationSearch, setOccupationSearch] = useState('engineer');
  const [occupationHits, setOccupationHits] = useState<Json[]>([]);
  const [occupationCode, setOccupationCode] = useState<string | null>(null);
  const [occupationLabel, setOccupationLabel] = useState<string | null>(null);
  const [employer, setEmployer] = useState('ACME Corp');
  const [employmentStatus, setEmploymentStatus] = useState<string | null>(null);

  const [sourceOfFunds, setSourceOfFunds] = useState<string | null>(null);
  const [accountPurpose, setAccountPurpose] = useState<string | null>(null);
  const [monthlyVolume, setMonthlyVolume] = useState<VolumeRange | null>(null);
  const [intermediary, setIntermediary] = useState(false);
  // Sandbox test BVN from the docs: always verifies, returns fixed holder
  // details. Real BVNs are only accepted in production.
  const [bvn, setBvn] = useState('22222222222');

  const [idType, setIdType] = useState<string | null>('passport');
  const [idNumber, setIdNumber] = useState('A12345678');
  const [idCountry, setIdCountry] = useState('NGA');
  const [idExpiration, setIdExpiration] = useState('2030-01-01');
  const [idIssue, setIdIssue] = useState('2020-01-01');
  const [poaType, setPoaType] = useState<string>('utility_bill');

  const [idFront, setIdFront] = useState<UploadFile | null>(null);
  const [idBack, setIdBack] = useState<UploadFile | null>(null);
  const [poaFront, setPoaFront] = useState<UploadFile | null>(null);
  const [poaBack, setPoaBack] = useState<UploadFile | null>(null);
  const [selfie, setSelfie] = useState<UploadFile | null>(null);

  const lists = useMemo(() => {
    const genders = stringList(options?.genders, FALLBACK.genders);
    const employmentStatuses = stringList(
      options?.employmentStatuses,
      FALLBACK.employmentStatuses,
    );
    const fundsSources = stringList(options?.fundsSources, FALLBACK.fundsSources);
    const accountPurposes = stringList(
      options?.accountPurposes,
      FALLBACK.accountPurposes,
    );
    const fromApi = stringList(options?.identificationTypes, []);
    const idTypes = fromApi.filter(type =>
      (KYC_IDENTIFICATION_TYPES as readonly string[]).includes(type),
    );
    return {
      genders,
      employmentStatuses,
      fundsSources,
      accountPurposes,
      volumes: volumeRanges(options?.estimatedMonthlyVolumeRanges),
      idTypes: idTypes.length > 0 ? idTypes : [...KYC_IDENTIFICATION_TYPES],
    };
  }, [options]);

  // GET /kyc/options drives every dropdown; the fallbacks above only apply when
  // a list is missing from the response.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const loaded = await client.getKycOptions(userId);
        if (!cancelled) {
          setOptions(loaded);
        }
      } catch (e) {
        if (!cancelled) {
          setError(`Could not load KYC options: ${describeError(e)}`);
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

  useEffect(() => {
    setGender(current => current ?? lists.genders[0]);
    setEmploymentStatus(current => current ?? lists.employmentStatuses[0]);
    setSourceOfFunds(current => current ?? lists.fundsSources[0]);
    setAccountPurpose(current => current ?? lists.accountPurposes[0]);
    setMonthlyVolume(current => current ?? lists.volumes[0]);
  }, [lists]);

  const guard = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(describeSdkError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const searchOccupations = () =>
    guard(async () => {
      setOccupationHits(await client.getKycOccupations(userId, occupationSearch));
    });

  const pickInto = (setter: (file: UploadFile) => void) => () =>
    guard(async () => {
      const file = await pickImage();
      if (file) {
        setter(file);
      }
    });

  const validate = (index: number): boolean => {
    const fail = (reason: string) => {
      setError(reason);
      return false;
    };
    switch (index) {
      case 0:
        if (!firstName.trim() || !lastName.trim() || !phone.trim() || !dob.trim() || !gender) {
          return fail(
            'Personal: fill first and last name, phone, DOB (YYYY-MM-DD) and gender.',
          );
        }
        break;
      case 1:
        if (
          !street1.trim() ||
          !city.trim() ||
          !state.trim() ||
          !postal.trim() ||
          countryCode.trim().length !== 3
        ) {
          return fail(
            'Address: street, city, state, postal code and ISO alpha-3 country (e.g. NGA).',
          );
        }
        break;
      case 2:
        if (!occupationCode || !employer.trim() || !employmentStatus) {
          return fail(
            'Employment: search and select an occupation, employer and status.',
          );
        }
        break;
      case 3:
        if (!sourceOfFunds || !accountPurpose || !monthlyVolume) {
          return fail(
            'Compliance: pick source of funds, account purpose and expected monthly volume.',
          );
        }
        if (currency.key === 'ngn' && !/^\d{11}$/.test(bvn.trim())) {
          return fail('Enter an 11-digit BVN.');
        }
        break;
      case 4:
        if (!idFront || !poaFront) {
          return fail(
            'Documents: pick an ID front and a proof-of-address image. ID back is optional.',
          );
        }
        if (
          !idType ||
          !idNumber.trim() ||
          idCountry.trim().length !== 3 ||
          !idExpiration.trim()
        ) {
          return fail(
            'Documents: choose ID type, document number, ISO alpha-3 issuing country and expiration date.',
          );
        }
        if (globalKyc && !selfie) {
          return fail(
            `Documents: ${currency.fiatCode} runs the Global KYC path, which requires a biometric selfie.`,
          );
        }
        break;
      default:
        break;
    }
    setError(null);
    return true;
  };

  const submit = () =>
    guard(async () => {
      if (currency.key === 'ngn' && !/^\d{11}$/.test(bvn.trim())) {
        throw new ExampleError(
          'Enter a valid 11-digit BVN for Nigeria onboarding.',
        );
      }
      if (!idFront || !poaFront) {
        throw new ExampleError(
          'ID front and proof-of-address images are required before submit.',
        );
      }

      const patchBody: Json = {
        personalInfo: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          ...(middleName.trim() ? {middleName: middleName.trim()} : {}),
          phoneNumber: phone.trim(),
          dateOfBirth: dob.trim(),
          gender,
        },
        address: {
          streetLine1: street1.trim(),
          ...(street2.trim() ? {streetLine2: street2.trim()} : {}),
          city: city.trim(),
          state: state.trim(),
          postalCode: postal.trim(),
          countryCode: countryCode.trim().toUpperCase(),
        },
        employment: {
          occupationCode,
          employerName: employer.trim(),
          employmentStatus,
        },
        sourceOfFunds,
        estimatedMonthlyVolume: monthlyVolume?.value,
        accountPurpose,
        actingAsIntermediary: intermediary,
        ...(currency.key === 'ngn'
          ? {
              identificationNumbers: [
                {type: 'bvn', number: bvn.trim(), issuingCountryCode: 'NGA'},
              ],
            }
          : {}),
      };

      const patchKyc = await client.patchKyc(userId, patchBody);

      const uploadIdentification = await client.uploadKycIdentification({
        userId,
        files: idBack ? [idFront, idBack] : [idFront],
        type: idType ?? 'passport',
        documentNumber: idNumber.trim(),
        issuingCountry: idCountry.trim().toUpperCase(),
        expirationDate: idExpiration.trim(),
        issueDate: idIssue.trim(),
      });

      const uploadProofOfAddress = await client.uploadKycProofOfAddress({
        userId,
        files: poaBack ? [poaFront, poaBack] : [poaFront],
        type: poaType,
      });

      // Global KYC path (USD / EUR / MXN) only.
      const uploadBiometric =
        globalKyc && selfie
          ? await client.uploadKycBiometric({userId, file: selfie})
          : undefined;

      const readiness = await client.getKycReadiness(userId);
      const activateKyc = await client.activateKyc(
        userId,
        globalKyc ? 'id-and-liveness' : undefined,
      );
      const startOnboarding = await client.startOnboarding({
        userId,
        currency,
        wallet,
        nigeriaBvn: currency.key === 'ngn' ? bvn.trim() : undefined,
      });

      onSubmitted({
        patchKyc,
        uploadIdentification,
        uploadProofOfAddress,
        ...(uploadBiometric ? {uploadBiometric} : {}),
        readiness,
        activateKyc,
        startOnboarding,
      });
    });

  const fileLabel = (name: string, file: UploadFile | null, optional = false) =>
    file ? `${name} ✓` : optional ? `${name} (opt.)` : name;

  return (
    <View style={styles.flex}>
      <View style={styles.wizardHeader}>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {width: `${((page + 1) / PAGES.length) * 100}%`},
            ]}
          />
        </View>
        <Note>
          Step {page + 1} of {PAGES.length} · {PAGES[page]} ·{' '}
          {currency.kycProviderLabel}
        </Note>
        <StatusBanner error={error} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {page === 0 ? (
          <SectionCard title="Personal">
            <Field label="First name" value={firstName} onChangeText={setFirstName} />
            <Field label="Last name" value={lastName} onChangeText={setLastName} />
            <Field
              label="Middle name (optional)"
              value={middleName}
              onChangeText={setMiddleName}
            />
            <Field
              label="Phone (KYC)"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <Note>
              Email stays on the user record from sign-up; the name and phone here
              are sent with PATCH /kyc.
            </Note>
            <Field
              label="Date of birth (YYYY-MM-DD)"
              value={dob}
              onChangeText={setDob}
            />
            <Select
              label="Gender"
              value={gender}
              options={lists.genders}
              optionLabel={value => value}
              onChange={setGender}
            />
          </SectionCard>
        ) : null}

        {page === 1 ? (
          <SectionCard title="Address">
            <Field label="Street line 1" value={street1} onChangeText={setStreet1} />
            <Field
              label="Street line 2 (optional)"
              value={street2}
              onChangeText={setStreet2}
            />
            <Field label="City" value={city} onChangeText={setCity} />
            <Field label="State / province" value={state} onChangeText={setState} />
            <Field label="Postal code" value={postal} onChangeText={setPostal} />
            <Field
              label="Country (ISO alpha-3)"
              value={countryCode}
              onChangeText={setCountryCode}
              autoCapitalize="characters"
              maxLength={3}
            />
          </SectionCard>
        ) : null}

        {page === 2 ? (
          <SectionCard title="Employment">
            <Field
              label="Search occupation"
              value={occupationSearch}
              onChangeText={setOccupationSearch}
            />
            <Button
              label="Search occupations"
              kind="secondary"
              onPress={searchOccupations}
              disabled={busy}
            />
            {occupationLabel ? (
              <Note>
                Selected: {occupationLabel} ({occupationCode})
              </Note>
            ) : null}
            {occupationHits.map((hit, index) => {
              const id = typeof hit.id === 'string' ? hit.id : undefined;
              const soc = typeof hit.socCode === 'string' ? hit.socCode : undefined;
              const code = id ?? soc ?? '';
              const name =
                (typeof hit.displayName === 'string' ? hit.displayName : soc) ??
                'Occupation';
              return (
                <Button
                  key={`${code}-${index}`}
                  label={`${name} · ${code || '—'}`}
                  kind="ghost"
                  onPress={() => {
                    setOccupationCode(code !== '' ? code : null);
                    setOccupationLabel(name);
                  }}
                />
              );
            })}
            <Field label="Employer name" value={employer} onChangeText={setEmployer} />
            <Select
              label="Employment status"
              value={employmentStatus}
              options={lists.employmentStatuses}
              optionLabel={value => value}
              onChange={setEmploymentStatus}
            />
          </SectionCard>
        ) : null}

        {page === 3 ? (
          <SectionCard title="Compliance">
            <Select
              label="Source of funds"
              value={sourceOfFunds}
              options={lists.fundsSources}
              optionLabel={value => value}
              onChange={setSourceOfFunds}
            />
            <Select
              label="Account purpose"
              value={accountPurpose}
              options={lists.accountPurposes}
              optionLabel={value => value}
              onChange={setAccountPurpose}
            />
            <Select
              label="Est. monthly volume (USD)"
              value={monthlyVolume}
              options={lists.volumes}
              optionLabel={range => range.label}
              onChange={setMonthlyVolume}
            />
            <Toggle
              label="Acting as intermediary"
              value={intermediary}
              onChange={setIntermediary}
            />
            {currency.key === 'ngn' ? (
              <Field
                label="BVN (11 digits · sandbox test 22222222222)"
                value={bvn}
                onChangeText={text => setBvn(text.replace(/\D/g, ''))}
                keyboardType="number-pad"
                maxLength={11}
              />
            ) : null}
          </SectionCard>
        ) : null}

        {page === 4 ? (
          <SectionCard title="Documents">
            <Note>
              Uses POST …/kyc/documents/identification,
              …/documents/proof-of-address and, on the Global KYC path (USD / EUR /
              MXN), …/documents/biometric — all multipart.
            </Note>
            <Button
              label={fileLabel('ID front', idFront)}
              kind="secondary"
              onPress={pickInto(setIdFront)}
              disabled={busy}
            />
            <Button
              label={fileLabel('ID back', idBack, true)}
              kind="secondary"
              onPress={pickInto(setIdBack)}
              disabled={busy}
            />
            <Button
              label={fileLabel('PoA front', poaFront)}
              kind="secondary"
              onPress={pickInto(setPoaFront)}
              disabled={busy}
            />
            <Button
              label={fileLabel('PoA back', poaBack, true)}
              kind="secondary"
              onPress={pickInto(setPoaBack)}
              disabled={busy}
            />
            {globalKyc ? (
              <Button
                label={selfie ? 'Selfie ✓' : 'Selfie (required)'}
                kind="secondary"
                onPress={pickInto(setSelfie)}
                disabled={busy}
              />
            ) : null}
            <Select
              label="ID document type"
              value={idType}
              options={lists.idTypes}
              optionLabel={value => value}
              onChange={setIdType}
            />
            <Field label="Document number" value={idNumber} onChangeText={setIdNumber} />
            <Field
              label="Issuing country (ISO alpha-3)"
              value={idCountry}
              onChangeText={setIdCountry}
              autoCapitalize="characters"
              maxLength={3}
            />
            <Field
              label="Expiration (YYYY-MM-DD)"
              value={idExpiration}
              onChangeText={setIdExpiration}
            />
            <Field
              label="Issue date (YYYY-MM-DD)"
              value={idIssue}
              onChangeText={setIdIssue}
            />
            <Select
              label="Proof-of-address type"
              value={poaType}
              options={[...KYC_PROOF_OF_ADDRESS_TYPES]}
              optionLabel={value => value}
              onChange={setPoaType}
            />
          </SectionCard>
        ) : null}

        {page === 5 ? (
          <SectionCard title="Review">
            <Text style={styles.text}>
              {firstName.trim()} {lastName.trim()} · {initial.email}
            </Text>
            <Text style={styles.bodyMuted}>
              Address: {street1.trim()}, {city.trim()}, {countryCode.trim()}
            </Text>
            <Text style={styles.bodyMuted}>
              Employment: {occupationLabel ?? '—'} ({occupationCode ?? '—'}) ·{' '}
              {employer.trim()}
            </Text>
            <Text style={styles.bodyMuted}>
              Funds: {sourceOfFunds ?? '—'} · Purpose: {accountPurpose ?? '—'} ·
              Volume: {monthlyVolume?.value ?? '—'}
            </Text>
            {currency.key === 'ngn' ? (
              <Text style={styles.bodyMuted}>BVN: {bvn}</Text>
            ) : null}
            <Text style={styles.bodyMuted}>
              Documents: ID {idType ?? '—'} · PoA {poaType} ·{' '}
              {idFront ? 'ID file ready' : 'no ID file'} ·{' '}
              {poaFront ? 'PoA ready' : 'no PoA'}
              {globalKyc ? (selfie ? ' · selfie ready' : ' · no selfie') : ''}
            </Text>
            <Note>
              Submit runs: PATCH /kyc → upload ID &amp; PoA
              {globalKyc ? ' & biometric' : ''} → GET /kyc/readiness → POST
              /kyc/activate{globalKyc ? ' (sumsubLevelName: id-and-liveness)' : ' (no body)'} →{' '}
              {currency.kycProviderLabel}{' '}
              {currency.key === 'mxn' ? 'activation' : 'start-* onboarding'}.
            </Note>
            {options ? (
              <Note>Loaded /kyc/options keys: {Object.keys(options).join(', ')}</Note>
            ) : null}
          </SectionCard>
        ) : null}
      </ScrollView>

      <View style={styles.wizardFooter}>
        <Button
          label={page === 0 ? 'Cancel' : 'Back'}
          kind="ghost"
          style={styles.flex}
          disabled={busy}
          onPress={() => (page === 0 ? onCancel() : setPage(page - 1))}
        />
        <Button
          label={page === PAGES.length - 1 ? 'Submit & start onboarding' : 'Next'}
          style={styles.flex}
          disabled={busy}
          onPress={() => {
            if (page === PAGES.length - 1) {
              submit();
              return;
            }
            if (validate(page)) {
              setPage(page + 1);
            }
          }}
        />
      </View>
    </View>
  );
}

