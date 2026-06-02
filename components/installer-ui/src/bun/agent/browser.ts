import {
  launchBrowserUrl,
  normalizeBrowserUrl,
  type BrowserLauncherOptions,
  type BrowserLaunchResult,
} from "../../../../agent/browser-launcher";

export { normalizeBrowserUrl };

export type BrowserToolOptions = {
  browserLauncher?: (url: string, options?: BrowserLauncherOptions) => BrowserLaunchResult;
  launcherOptions?: BrowserLauncherOptions;
};

export function createBrowserTool(options: BrowserToolOptions = {}) {
  const browserLauncher = options.browserLauncher ?? launchBrowserUrl;

  return {
    async openUrl(input: string) {
      const result = browserLauncher(input, options.launcherOptions);
      return {
        ok: true,
        message: `Abriendo ${result.url}.`,
      };
    },
  };
}
