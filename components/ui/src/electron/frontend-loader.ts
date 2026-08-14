export type FrontendLoadResult = "broker" | "local";

export type FrontendLoaderOptions = {
  brokerBaseUrl: string;
  localIndexPath: string;
  loadUrl: (url: string) => Promise<unknown>;
  loadFile: (path: string) => Promise<unknown>;
  fetchImpl?: typeof fetch;
  attempts?: number;
  retryDelayMs?: number;
  requestTimeoutMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

const defaultSleep = (delayMs: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, delayMs);
});

async function brokerIsReady(
  healthUrl: string,
  fetchImpl: typeof fetch,
  requestTimeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetchImpl(healthUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadPreferredFrontend({
  brokerBaseUrl,
  localIndexPath,
  loadUrl,
  loadFile,
  fetchImpl = fetch,
  attempts = 30,
  retryDelayMs = 200,
  requestTimeoutMs = 250,
  sleep = defaultSleep,
}: FrontendLoaderOptions): Promise<FrontendLoadResult> {
  const rootUrl = new URL("/", `${brokerBaseUrl}/`).toString();
  const healthUrl = new URL("/health", `${brokerBaseUrl}/`).toString();

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await brokerIsReady(healthUrl, fetchImpl, requestTimeoutMs)) {
      try {
        await loadUrl(rootUrl);
        return "broker";
      } catch {
        break;
      }
    }

    if (attempt + 1 < attempts) {
      await sleep(retryDelayMs);
    }
  }

  await loadFile(localIndexPath);
  return "local";
}
