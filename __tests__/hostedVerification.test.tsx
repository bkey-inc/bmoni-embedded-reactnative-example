/**
 * The launch → WebView → close → status flow behind Mexico hosted
 * verification. The native WebView is stubbed; what matters is what it is
 * handed and when the hook resolves.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

import {useHostedVerification} from '../src/HostedVerification';
import type {ProxyApiClient} from '../src/proxyClient';

jest.mock('react-native-webview', () => {
  const {View} = require('react-native');
  return { WebView: (props: object) => <View testID="webview" {...props} /> };
});
jest.mock('react-native-safe-area-context', () => {
  const {View} = require('react-native');
  return {SafeAreaView: View};
});

const html = '<form id="f"></form>';

function setup(client: Partial<ProxyApiClient>) {
  let launch!: (userId: string) => Promise<unknown>;
  function Screen() {
    const hosted = useHostedVerification(client as ProxyApiClient);
    launch = hosted.launch;
    return hosted.modal;
  }
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<Screen />);
  });
  return {renderer, launch: (userId: string) => launch(userId)};
}

describe('useHostedVerification', () => {
  it('loads the launch html, then reports the status once closed', async () => {
    const client = {
      getMxKycLaunch: jest.fn(async () => ({html, url: 'https://kyc.test'})),
      getMxKycStatus: jest.fn(async () => ({status: 'approved'})),
    };
    const {renderer, launch} = setup(client);

    let result: Promise<unknown>;
    await act(async () => {
      result = launch('u');
    });
    expect(client.getMxKycLaunch).toHaveBeenCalledWith('u');
    const webview = renderer.root.findByProps({testID: 'webview'});
    expect(webview.props.source).toEqual({html});
    expect(client.getMxKycStatus).not.toHaveBeenCalled();

    const close = renderer.root.findAll(
      node =>
        node.props.label === 'Close' &&
        typeof node.props.onPress === 'function',
    )[0];
    await act(async () => {
      close.props.onPress();
    });
    await expect(result!).resolves.toEqual({status: 'approved'});
    expect(client.getMxKycStatus).toHaveBeenCalledWith('u');
    expect(renderer.root.findAllByProps({testID: 'webview'})).toHaveLength(0);
  });

  it('rejects a launch payload without html', async () => {
    const client = {
      getMxKycLaunch: jest.fn(async () => ({url: 'https://kyc.test'})),
      getMxKycStatus: jest.fn(),
    };
    const {launch} = setup(client);
    await act(async () => {
      await expect(launch('u')).rejects.toThrow('no html');
    });
    expect(client.getMxKycStatus).not.toHaveBeenCalled();
  });
});
