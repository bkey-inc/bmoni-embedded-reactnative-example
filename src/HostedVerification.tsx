/**
 * The provider's hosted Mexico verification (agreements, email confirmation,
 * selfie / liveness, any remaining document), shown in a WebView.
 *
 * `GET …/latam/mx/kyc/launch/agreements` returns an auto-submitting form as
 * `html`; it is loaded as-is. Its JWT lasts ~5 minutes, so the payload is
 * fetched right before the WebView opens.
 *
 * Camera: iOS asks through `NSCameraUsageDescription` and then WebKit's own
 * per-site prompt; on Android react-native-webview requests the runtime
 * CAMERA / RECORD_AUDIO permission itself. File inputs are handled natively.
 */

import React, {useCallback, useRef, useState} from 'react';
import {Modal, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {WebView} from 'react-native-webview';

import {ProxyApiError, type Json, type ProxyApiClient} from './proxyClient';
import {Button, Note, Row, StatusBanner, styles} from './ui';

function HostedVerificationModal({
  html,
  onClose,
}: {
  html: string | null;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      visible={html !== null}
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => setError(null)}>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.webviewHeader}>
          <Row>
            <Button label="Close" kind="ghost" onPress={onClose} />
          </Row>
          <Note>Identity verification</Note>
          <StatusBanner
            error={error && `Could not load the verification page: ${error}`}
          />
        </View>
        {html !== null ? (
          <WebView
            style={styles.flex}
            source={{html}}
            javaScriptEnabled
            startInLoadingState
            // Liveness plays the camera feed inline.
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            onError={event => setError(event.nativeEvent.description)}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

/**
 * `launch(userId)` opens the hosted verification and resolves with the Mexico
 * KYC status once the user closes it. Render `modal` once in the screen.
 */
export function useHostedVerification(client: ProxyApiClient) {
  const [html, setHtml] = useState<string | null>(null);
  const closed = useRef<(() => void) | null>(null);

  const launch = useCallback(
    async (userId: string): Promise<Json> => {
      const payload = await client.getMxKycLaunch(userId);
      const page = payload.html;
      if (typeof page !== 'string' || page.trim() === '') {
        throw new ProxyApiError('The verification launch payload has no html.');
      }
      await new Promise<void>(resolve => {
        closed.current = resolve;
        setHtml(page);
      });
      return client.getMxKycStatus(userId);
    },
    [client],
  );

  const close = () => {
    setHtml(null);
    closed.current?.();
    closed.current = null;
  };

  return {
    launch,
    modal: <HostedVerificationModal html={html} onClose={close} />,
  };
}
