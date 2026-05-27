/**
 * potrace npm 包没有官方 TypeScript 类型,本地最小化声明 —— 只声明我们用到的 API。
 */
declare module 'potrace' {
  export interface PotraceOptions {
    threshold?: number;
    blackOnWhite?: boolean;
    turdSize?: number;
    alphaMax?: number;
    optCurve?: boolean;
    optTolerance?: number;
    color?: string;
    background?: string;
  }
  export function trace(
    file: string | Buffer,
    options: PotraceOptions,
    cb: (err: Error | null, svg: string) => void
  ): void;
}
