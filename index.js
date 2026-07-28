/**
 * @format
 */

import {AppRegistry} from 'react-native';
import {BmoniEmbeddedSdk} from '@bkey-inc/bmoni_embedded_sdk';

import App from './App';
import {name as appName} from './app.json';

// Idempotent, and the only place the PIN policy is configured. Doing it here
// means every later BmoniEmbeddedSdk call — from any screen — sees the same
// config, before React renders anything.
BmoniEmbeddedSdk.initialize({pinLength: 6, requirePin: true});

AppRegistry.registerComponent(appName, () => App);
