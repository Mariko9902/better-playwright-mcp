declare module 'playwright-core/lib/coreBundle' {
  export const registry: {
    registryDirectory: string;
  };

  export const server: {
    startTraceViewerServer(): Promise<{
      urlPrefix(kind: string): string;
    }>;
  };

  export const iso: {
    asLocator(language: string, selector: string): string;
  };
}
