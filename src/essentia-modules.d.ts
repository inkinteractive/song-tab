/**
 * essentia.js ships no type declarations for its dist entry points. The wrapper
 * in `analysis/essentia.ts` supplies the shape we actually rely on.
 */
declare module 'essentia.js/dist/essentia-wasm.es.js' {
  export const EssentiaWASM: unknown;
  const _default: unknown;
  export default _default;
}

declare module 'essentia.js/dist/essentia.js-core.es.js' {
  const Essentia: new (wasm: unknown, isDebug?: boolean) => unknown;
  export default Essentia;
}
