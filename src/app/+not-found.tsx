import { Redirect } from 'expo-router';
import React from 'react';

/** Unknown routes go Home. */
export default function NotFound() {
  return <Redirect href="/" />;
}
