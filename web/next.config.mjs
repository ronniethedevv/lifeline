/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Mezo Passport's orangekit packages ship raw TypeScript; let Next compile them.
  transpilePackages: [
    "@mezo-org/passport",
    "@mezo-org/orangekit",
    "@mezo-org/orangekit-contracts",
    "@mezo-org/orangekit-smart-account",
  ],
  webpack: (config, { webpack }) => {
    // Optional deps pulled in by WalletConnect / wagmi connectors; not used in the browser.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // The Coinbase Base-account connector (unused — Passport offers BTC wallets + WalletConnect)
    // transitively imports optional @x402/* payment modules that aren't installed. Ignore the whole
    // namespace so the production build succeeds; those code paths are never reached by our wallets.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }));
    // @metamask/sdk optionally requires React Native's async-storage; not used on the web.
    config.resolve.alias = { ...config.resolve.alias, "@react-native-async-storage/async-storage": false };
    return config;
  },
};

export default nextConfig;
