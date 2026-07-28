/**
 * Everything the example does with `@bkey-inc/bmoni_embedded_sdk`, in one place:
 * provision-or-load the owner key, gate the PIN, and turn SDK error codes into
 * messages a user can act on.
 */

import {
  BmoniEmbeddedSdk,
  BmoniSignerError,
  BmoniSignerErrorCode,
} from '@bkey-inc/bmoni_embedded_sdk';

export class ExampleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExampleError';
  }
}

/**
 * The owner key whose address is registered as `userOwnerAddress`. The private
 * key never leaves the secure element — only the address and signatures do.
 *
 * Also sets the PIN on first run, and verifies it afterwards, so a wrong PIN
 * fails here rather than deep inside the owner-proof handshake.
 */
export async function loadOrCreateOwnerAddress(pin: string): Promise<string> {
  const address = (await BmoniEmbeddedSdk.hasWallet())
    ? await BmoniEmbeddedSdk.walletAddress()
    : await BmoniEmbeddedSdk.initWallet();
  if (!address) {
    throw new ExampleError('The embedded SDK returned no wallet address.');
  }

  if (BmoniEmbeddedSdk.requirePin) {
    if (await BmoniEmbeddedSdk.hasPin()) {
      if (!(await BmoniEmbeddedSdk.matchPin(pin))) {
        throw new ExampleError('The PIN did not match this device wallet.');
      }
    } else {
      await BmoniEmbeddedSdk.setPin(pin);
    }
  }
  return address;
}

/**
 * Pass the PIN only when the gate is on. With `requirePin: false` the argument
 * is ignored anyway, so the same call site works in both modes.
 */
export function pinArgument(pin: string): string | undefined {
  return BmoniEmbeddedSdk.requirePin ? pin : undefined;
}

/** Maps the documented error codes onto messages. */
export function describeSdkError(error: unknown): string {
  if (!(error instanceof BmoniSignerError)) {
    // Not an SDK failure — an unavailable native module, a keychain problem, or
    // one of our own errors. Surface it as-is.
    return error instanceof Error ? error.message : String(error);
  }
  switch (error.errorCode) {
    case BmoniSignerErrorCode.pinNotSet:
      return 'No PIN is set on this device. Create one before signing.';
    case BmoniSignerErrorCode.pinMismatch:
      return 'That PIN does not match this device wallet.';
    case BmoniSignerErrorCode.pinInvalid:
      return `Enter exactly ${BmoniEmbeddedSdk.pinLength} digits.`;
    case BmoniSignerErrorCode.pinAlreadySet:
      return 'A PIN already exists — change it instead of setting a new one.';
    case BmoniSignerErrorCode.walletAlreadyExists:
      return 'A wallet already exists on this device. Reset the app to replace it.';
    case BmoniSignerErrorCode.signInvalidHash:
      return 'The value to sign was not a 32-byte hex hash.';
    default:
      // Storage failures pass through unmapped and use a different range on
      // each platform (0x3000xxxx on iOS, 0x3002xxxx on Android), so report the
      // hex code rather than guessing at a friendly message.
      return `${error.message} (${error.errorCodeHex})`;
  }
}

export {BmoniEmbeddedSdk, BmoniSignerError, BmoniSignerErrorCode};
