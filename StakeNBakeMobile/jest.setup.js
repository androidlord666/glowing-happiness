/* eslint-env jest */

jest.mock('@react-native-clipboard/clipboard', () => ({
  setString: jest.fn(),
  getString: jest.fn().mockResolvedValue(''),
}));

jest.mock('react-native-qrcode-svg', () => 'QRCode');
