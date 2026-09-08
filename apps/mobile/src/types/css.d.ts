// Side-effect CSS imports (web only). Expo generates expo-env.d.ts with this
// on first start, but that file is gitignored; this one keeps typecheck honest
// on a fresh checkout.
declare module '*.css';
