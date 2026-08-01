import {
  launchBrowserUrl,
  normalizeBrowserUrl,
  type BrowserLauncherOptions,
  type BrowserLaunchResult,
} from "../../../../agent/browser-launcher";

export { normalizeBrowserUrl };

export type BrowserToolOptions = {
  browserLauncher?: (
    url: string,
    options?: BrowserLauncherOptions,
  ) => BrowserLaunchResult | Promise<BrowserLaunchResult>;
  launcherOptions?: BrowserLauncherOptions;
};

export function createBrowserTool(options: BrowserToolOptions = {}) {
  const browserLauncher = options.browserLauncher ?? launchBrowserUrl;

  return {
    async openUrl(input: string) {
      try {
        const result = await browserLauncher(input, options.launcherOptions);
        return {
          ok: result.ok,
          status: result.status,
          message: result.message,
        };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "No pude abrir Chromium.",
        };
      }
    },
  };
}
