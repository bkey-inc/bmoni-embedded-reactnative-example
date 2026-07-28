/**
 * @format
 */

import React from 'react';
import {StatusBar} from 'react-native';

import {ExampleApp} from './src/ExampleApp';

export default function App() {
  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#0C0A10" />
      <ExampleApp />
    </>
  );
}
