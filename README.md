<div align="center">

# 🪙 BMoni Embedded — React Native Example

**A reference React Native client for the BMoni Embedded Proxy API.**

Create a user, provision a managed smart wallet, complete KYC, move money across
fiat & crypto rails, and exercise every regional ramp — with the on-device
[`@bkey-inc/bmoni_embedded_sdk`](https://www.npmjs.com/package/@bkey-inc/bmoni_embedded_sdk)
handling keys and signing.

<br/>

![React Native](https://img.shields.io/badge/React%20Native-0.85-20232A?logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android%20(arm64)-lightgrey)
![Status](https://img.shields.io/badge/status-reference%20example-c026d3)
![License](https://img.shields.io/badge/license-private-555)

</div>

This is the React Native twin of
[`bmoni-embedded-flutter-example`](../bmoni-embedded-flutter-example) — same
flow, same endpoints, same request bodies.

---

## ✨ What it shows

A single guided flow, end to end:

| Step | API |
| :--- | :--- |
| 👤 Create a user | `POST /v1/users` |
| 💳 Provision a managed smart wallet | `owner-proof-challenges` → sign EIP-191 → `create-managed` |
| 🪪 Complete KYC | options · occupations · ID + PoA + biometric uploads · `readiness` · `activate` |
| 🚦 Activate the rail | `start-usa` / `start-canada` / `start-monerium` / `start-nigeria` / `latam/mx/kyc/activate` |
| 💰 Top up | crypto (`deposit/supported-assets` → `deposit/wallet`) or bank rail (USD VBA via `start-usa`; NGN / EUR VBA routed via `smart-wallets/:id/onramp/vba/{nigeria,eu}`; MXN CLABE via `deposit-accounts/MXN`) |
| 🏦 Withdraw | Nigeria bank offramp → proposal → sign with the owner key |
| 🔁 Swap | `exchange/convert` rate preview |
| 🧩 Integrations | the regional/provider ramps (below) |

Currencies: **USD** (`USDB`), **CAD** (`CADC`), **EUR** (`EURe`), **NGN**
(`CNGN`), **MXN** (`MEXe`). The picker is filtered by
`GET /v1/smart-wallets/supported-currencies`, so it follows the API rather than a
hardcoded list.

> [!NOTE]
> **This is a demo, not production.** It favours clarity over polish — raw JSON
> response panels, minimal state, no navigation library. Use it as a contract
> reference for your own integration.

---

## 📂 What's inside

```text
index.js                    # BmoniEmbeddedSdk.initialize() before the app registers
src/proxyClient.ts          # typed client over every proxy endpoint + models + parsers
src/sdk.ts                  # everything that touches @bkey-inc/bmoni_embedded_sdk
src/ExampleApp.tsx          # the guided flow and all app state
src/KycWizard.tsx           # the six-step KYC wizard
src/NigeriaWithdrawal.tsx   # verify → register → offramp modal
src/Integrations.tsx        # the provider ramps
src/ui.tsx                  # shared primitives + theme
__tests__/proxyClient.test.ts
```

`src/proxyClient.ts` imports nothing from React Native, so the request/response
shapes are directly unit-testable — `npm test` covers the tolerant parsers, the
per-currency onboarding bodies, and the base-URL normalisation.

---

## 🚀 Run

Requires an **arm64** device or emulator (see the ABI note below).

```bash
npm install
npm run ios       # or: cd ios && pod install && npm run ios
npm run android
```

Then, **in the app**, set the proxy base URL and your partner `x-api-key`, and
create an account.

> Use the server **origin only** (e.g. `http://localhost:4001`) — **without** a
> trailing `/v1`. Paths already start with `/v1/`. The default is
> `http://10.0.2.2:4001` on Android emulators and `http://localhost:4001`
> elsewhere.

Checks:

```bash
npm run typecheck
npm run lint
npm test
```

---

## 🧩 Integrations screen

Open **Explore integrations** from the wallet home. One section per provider —
each calls the proxy and dumps the raw response. Flows that return a
`signatureRequest` expose a **Sign & submit** button that signs `hashToSign` with
`BmoniEmbeddedSdk.signTransactionHash(...)` and completes via the matching
endpoint.

| Integration | Endpoints |
| :--- | :--- |
| 🔁 **Swap quote** | `GET exchange/rate/:from/:to` · `POST exchange/quote` |
| 🇪🇺 **EU SEPA / Monerium** | `POST eu/kyc` · `eu/orders/prepare` · `eu/orders/complete` |
| 💵 **LATAM cash** (Pago46) | `POST latam/cash/orders/{fund,send}` · `GET latam/cash/orders[/:id]` · `POST latam/cash/payouts/foreign` (USD → MXN / CLP / COP bank payout) |
| 🇲🇽 **LATAM Mexico** (Etherfuse) | `latam/mx/kyc/{activate,status,launch/agreements}` · `POST onboarding/start-mexico` · `POST latam/mx/quote` (offramp) · `GET latam/mx/orders/:id` · `latam/mx/mxne-migration/{status,prepare}` |
| 🇺🇸 **USD virtual bank account** | `GET kyc/usd-readiness` · `POST onboarding/start-usa` or `POST smart-wallets/:id/onramp/vba/usd/provision` · `GET vba/usd` |
| 🏧 **Bank payouts** (Fin) | `GET payouts/{countries,banks,bank-branches}` · `POST payouts/validate-account` · `POST payouts` |

Signatures complete via `POST wallets/submit-signature` (or `eu/orders/complete`
for EU orders), then settle via `GET wallets/workflows/:workflowId`: poll until
`isTerminal`. It is the only settlement signal for the MXN offramp, the MXNe
migration and LATAM payouts.

---

## 🔑 Authentication

Every request sends the partner key as an **`x-api-key`** header. The
`bmoniUserId` returned by `POST /v1/users` scopes every user endpoint, and is
persisted with `AsyncStorage` so PIN unlock returns to the existing wallet
instead of creating a new user.

---

## 📝 Notes

- **arm64 only** — the BMONISigner AAR ships an `arm64-v8a` slice, so
  `android/gradle.properties` pins `reactNativeArchitectures=arm64-v8a`. Other
  ABIs build fine and then fail at runtime with `UnsatisfiedLinkError`.
- **Maven repository** — `android/build.gradle` declares Bkey's Maven repo for
  `me.bkey.ip:bmonisigner`. It must live in the **app** project: the dependency
  is resolved transitively on the app's runtime classpath.
- **New Architecture** — the SDK ships a TurboModule, so the New Architecture
  must stay enabled (`newArchEnabled=true`, the RN 0.76+ default). After
  installing the package, rebuild the app; a Metro reload never picks up new
  native code.
- **Global KYC path** — USD, EUR and MXN require a biometric selfie
  (`POST …/kyc/documents/biometric`, file field `selfie`) and liveness
  (`sumsubLevelName: id-and-liveness`) at activation. NGN activates with
  `id-only`; CAD routes to PayTrie and sends no `sumsubLevelName`.
- **MXN** activates through Etherfuse (`POST …/latam/mx/kyc/activate`, no body)
  and reports status from `GET …/latam/mx/kyc/status`, not `onboarding/status`.
  Onramp is deposit-driven: MXN sent by SPEI to the CLABE from
  `GET …/deposit-accounts/MXN` credits the wallet. Offramp runs
  `latam/mx/quote` → sign → `wallets/submit-signature`.
- **Nigerian withdrawal** — the bank list comes from
  `GET …/bank-accounts/nigerian-banks`, and registration requires the exact
  holder name returned by `verify-nigerian-account`, so **Verify** gates **Save
  payout & offramp**. The offramp returns a *proposal*: once approvals move it to
  `PENDING_SIGNATURES`, the wallet-home card signs
  `…/proposals/:id/sign-payload` with `signTransactionHash` and submits it to
  `…/proposals/:id/sign`.
- **Sandbox BVN** — the NGN step is prefilled with the docs' test BVN
  `22222222222`.
- **Amounts differ per rail** — `POST /payouts` takes `amount` in **USDB minor
  units** (`"100000000"`), while the Nigerian offramp takes a decimal
  `fromAmount` (`"100.00"`).
- **Photos** — `NSPhotoLibraryUsageDescription` is declared for iOS. Android 13+
  uses the system photo picker, so no runtime permission is needed.
- **`npm install` and `min-release-age`** — npm's supply-chain gate rejects
  recently published packages. If the install fails with
  `No versions available for @bkey-inc/bmoni_embedded_sdk`, run
  `npm install --min-release-age=0` (or wait out your configured window).

---

## 📦 Related

| Package | Purpose |
| :--- | :--- |
| [`@bkey-inc/bmoni_embedded_sdk`](https://www.npmjs.com/package/@bkey-inc/bmoni_embedded_sdk) | On-device EVM wallet + signing primitives (React Native) |
| [`bmoni_embedded_sdk`](https://pub.dev/packages/bmoni_embedded_sdk) | The same SDK for Flutter |
| [BMoni Embedded docs](https://github.com/bkey-inc) | Integration flow, rails, and KYC requirements |
