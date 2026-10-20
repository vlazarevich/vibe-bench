import { expect, test } from 'vitest';
import { runtimeOsLabel } from '../apps/runner/src/onboarding.ts';

test.each([
  ['PRETTY_NAME="Omarchy"\nVERSION_ID="4.0.6"\nBUILD_ID="4.0.5"', 'Omarchy 4.0.6'],
  ['PRETTY_NAME="Ubuntu 24.04.1 LTS"\nVERSION_ID="24.04"', 'Ubuntu 24.04.1 LTS'],
  ["NAME='Debian GNU/Linux'\r\nVERSION_ID='13'\r\n", 'Debian GNU/Linux 13'],
  ['PRETTY_NAME=Omarchy\nBUILD_ID=4.0.6', 'Omarchy 4.0.6'],
  ['PRETTY_NAME="Arch Linux"\nVERSION_ID=""', 'Arch Linux'],
  ['PRETTY_NAME="Distribution 14"\nVERSION_ID=4', 'Distribution 14 4'],
  ['PRETTY_NAME=""\nNAME=Linux\nVERSION_ID=1', 'Linux 1'],
  ['', 'Linux 6.18.1'],
  ['ID=unknown\n# PRETTY_NAME=ignored', 'Linux 6.18.1'],
])('OS details include the available distribution version: %s', (input, expected) => {
  expect(runtimeOsLabel(input, '6.18.1')).toBe(expected);
});
