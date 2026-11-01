import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { devices } from 'playwright';
import { sanitizeForFilePath } from './utils/fileUtils.js';

const defaultMobileDeviceName = 'iPhone 14 Pro Max';
const defaultMobileViewportSize = '430,932';
const defaultPcViewportSize = '1440,900';
const defaultChromiumChannel = detectDefaultChromiumChannel();
const bundledInitPage = resolveBundledInitPage();

const defaultConfig: any = {
  browser: {
    browserName: 'chromium',
    launchOptions: {
      ...(defaultChromiumChannel ? { channel: defaultChromiumChannel } : {}),
      headless: os.platform() === 'linux' && !process.env.DISPLAY,
      chromiumSandbox: true,
      args: [
        '--disable-translate',
        '--disable-features=Translate,TranslateUI',
        '--disable-save-password-bubble',
        '--disable-extensions',
      ],
    },
    initPage: bundledInitPage ? [bundledInitPage] : undefined,
    devicePolicy: {
      requireDeviceMode: false,
      defaultDeviceMode: undefined,
      defaultMobileViewportSize,
      defaultPcViewportSize,
    },
    baseContextOptions: {
      viewport: null,
    },
    contextOptions: {
      viewport: null,
    },
  },
  network: {
    allowedOrigins: undefined,
    blockedOrigins: undefined,
  },
  server: {},
  saveTrace: false,
};

function resolveBundledInitPage() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(currentDir, 'enhanced', 'init-page-enhanced.js'),
    path.join(currentDir, 'enhanced', 'init-page-enhanced.ts'),
    path.join(currentDir, '..', 'lib', 'enhanced', 'init-page-enhanced.js'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate));
}

function detectDefaultChromiumChannel() {
  const override = envToStringFromCompat('BROWSER_CHANNEL');
  if (override)
    return override;

  if (os.platform() === 'darwin') {
    if (fs.existsSync('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'))
      return 'msedge';
    if (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'))
      return 'chrome';
  }

  return undefined;
}

export async function resolveConfig(config: any) {
  return mergeConfig(defaultConfig, config);
}

export async function resolveCLIConfig(cliOptions: any) {
  const configInFile = await loadConfig(cliOptions.config);
  const envOverrides = configFromEnv();
  const cliOverrides = configFromCLIOptions(cliOptions);
  let result: any = defaultConfig;
  result = mergeConfig(result, configInFile);
  result = mergeConfig(result, envOverrides);
  result = mergeConfig(result, cliOverrides);
  return result;
}

export function configFromCLIOptions(cliOptions: any) {
  let browserName;
  let channel;
  switch (cliOptions.browser) {
    case 'chrome':
    case 'chrome-beta':
    case 'chrome-canary':
    case 'chrome-dev':
    case 'chromium':
    case 'msedge':
    case 'msedge-beta':
    case 'msedge-canary':
    case 'msedge-dev':
      browserName = 'chromium';
      channel = cliOptions.browser;
      break;
    case 'firefox':
      browserName = 'firefox';
      break;
    case 'webkit':
      browserName = 'webkit';
      break;
  }
  const launchOptions: any = {
    channel,
    executablePath: cliOptions.executablePath,
    headless: cliOptions.headless,
  };
  if (cliOptions.sandbox === false)
    launchOptions.chromiumSandbox = false;
  if (cliOptions.proxyServer) {
    launchOptions.proxy = {
      server: cliOptions.proxyServer,
    };
    if (cliOptions.proxyBypass)
      launchOptions.proxy.bypass = cliOptions.proxyBypass;
  }
  if (cliOptions.device && cliOptions.cdpEndpoint)
    throw new Error('Device emulation is not supported with cdpEndpoint.');

  const devicePolicy = {
    requireDeviceMode: cliOptions.requireDeviceMode === undefined ? undefined : Boolean(cliOptions.requireDeviceMode),
    defaultDeviceMode: cliOptions.defaultDeviceMode,
    defaultMobileViewportSize: cliOptions.defaultMobileViewportSize ?? defaultMobileViewportSize,
    defaultPcViewportSize: cliOptions.defaultPcViewportSize ?? defaultPcViewportSize,
  };

  // Apply defaults only when user did not explicitly set device/viewport.
  // NOTE: when requireDeviceMode=true, defaults are intentionally NOT applied.
  if (!devicePolicy.requireDeviceMode && !cliOptions.device && !cliOptions.viewportSize && devicePolicy.defaultDeviceMode) {
    if (devicePolicy.defaultDeviceMode === 'H5') {
      // Prefer full device emulation when possible.
      cliOptions.device = defaultMobileDeviceName;
    } else if (devicePolicy.defaultDeviceMode === 'PC') {
      cliOptions.viewportSize = devicePolicy.defaultPcViewportSize;
    }
  }

  const contextOptions: any = cliOptions.device ? devices[cliOptions.device] : {};
  if (cliOptions.storageState)
    contextOptions.storageState = cliOptions.storageState;
  if (cliOptions.userAgent)
    contextOptions.userAgent = cliOptions.userAgent;
  if (cliOptions.viewportSize) {
    try {
      const [width, height] = cliOptions.viewportSize.split(',').map((n: string) => +n);
      if (isNaN(width) || isNaN(height))
        throw new Error('bad values');
      contextOptions.viewport = { width, height };
    } catch {
      throw new Error('Invalid viewport size format: use "width,height", for example --viewport-size="800,600"');
    }
  }
  if (cliOptions.ignoreHttpsErrors)
    contextOptions.ignoreHTTPSErrors = true;
  if (cliOptions.blockServiceWorkers)
    contextOptions.serviceWorkers = 'block';
  const result = {
    browser: {
      browserName,
      isolated: cliOptions.isolated,
      userDataDir: cliOptions.userDataDir,
      launchOptions,
      initPage: cliOptions.initPage,
      devicePolicy,
      contextOptions,
      cdpEndpoint: cliOptions.cdpEndpoint,
      remoteEndpoint: cliOptions.remoteEndpoint,
    },
    server: {
      port: cliOptions.port,
      host: cliOptions.host,
    },
    capabilities: cliOptions.caps,
    network: {
      allowedOrigins: cliOptions.allowedOrigins,
      blockedOrigins: cliOptions.blockedOrigins,
    },
    saveSession: cliOptions.saveSession,
    saveTrace: cliOptions.saveTrace,
    outputDir: cliOptions.outputDir,
    imageResponses: cliOptions.imageResponses,
  };
  return result;
}

function configFromEnv() {
  const options: any = {};
  options.allowedOrigins = semicolonSeparatedList(envCompat('ALLOWED_ORIGINS'));
  options.blockedOrigins = semicolonSeparatedList(envCompat('BLOCKED_ORIGINS'));
  options.blockServiceWorkers = envToBoolean(envCompat('BLOCK_SERVICE_WORKERS'));
  options.browser = envToStringFromCompat('BROWSER');
  options.caps = commaSeparatedList(envCompat('CAPS'));
  options.cdpEndpoint = envToStringFromCompat('CDP_ENDPOINT');
  options.config = envToStringFromCompat('CONFIG');
  options.device = envToStringFromCompat('DEVICE');
  options.defaultDeviceMode = envToStringFromCompat('DEFAULT_DEVICE_MODE');
  options.defaultMobileViewportSize = envToStringFromCompat('DEFAULT_MOBILE_VIEWPORT_SIZE');
  options.defaultPcViewportSize = envToStringFromCompat('DEFAULT_PC_VIEWPORT_SIZE');
  options.requireDeviceMode = envToBoolean(envCompat('REQUIRE_DEVICE_MODE'));
  options.executablePath = envToStringFromCompat('EXECUTABLE_PATH');
  options.headless = envToBoolean(envCompat('HEADLESS'));
  options.host = envToStringFromCompat('HOST');
  options.ignoreHttpsErrors = envToBoolean(envCompat('IGNORE_HTTPS_ERRORS'));
  options.initPage = commaSeparatedList(envCompat('INIT_PAGE'));
  options.isolated = envToBoolean(envCompat('ISOLATED'));
  if (envCompat('IMAGE_RESPONSES') === 'omit')
    options.imageResponses = 'omit';
  options.sandbox = envToBoolean(envCompat('SANDBOX'));
  options.outputDir = envToStringFromCompat('OUTPUT_DIR');
  options.port = envToNumber(envCompat('PORT'));
  options.proxyBypass = envToStringFromCompat('PROXY_BYPASS');
  options.proxyServer = envToStringFromCompat('PROXY_SERVER');
  options.remoteEndpoint = envToStringFromCompat('REMOTE_ENDPOINT');
  options.saveTrace = envToBoolean(envCompat('SAVE_TRACE'));
  options.storageState = envToStringFromCompat('STORAGE_STATE');
  options.userAgent = envToStringFromCompat('USER_AGENT');
  options.userDataDir = envToStringFromCompat('USER_DATA_DIR');
  options.viewportSize = envToStringFromCompat('VIEWPORT_SIZE');
  if (options.defaultDeviceMode)
    options.defaultDeviceMode = String(options.defaultDeviceMode).toUpperCase();
  return configFromCLIOptions(options);
}

async function loadConfig(configFile?: string) {
  if (!configFile)
    return {};
  try {
    return JSON.parse(await fs.promises.readFile(configFile, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to load config file: ${configFile}, ${error}`);
  }
}

export async function outputFile(config: any, rootPath: string | undefined, name: string) {
  if (path.isAbsolute(name)) {
    await fs.promises.mkdir(path.dirname(name), { recursive: true });
    return name;
  }

  const outputDir = config.outputDir
    ?? (rootPath ? path.join(rootPath, '.better-playwright') : undefined)
    ?? path.join(os.tmpdir(), 'better-playwright-output', sanitizeForFilePath(new Date().toISOString()));
  await fs.promises.mkdir(outputDir, { recursive: true });
  const pathParts = name.split(/[\\/]+/).filter(Boolean).map(part => sanitizeForFilePath(part));
  const resolvedPath = path.join(outputDir, ...pathParts);
  await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
  return resolvedPath;
}

export function parseViewportSize(value?: string) {
  if (!value)
    return undefined;
  const [width, height] = String(value).split(',').map((n: string) => +n.trim());
  if (!Number.isFinite(width) || !Number.isFinite(height))
    return undefined;
  return { width, height };
}

export function contextOptionsForDeviceMode(mode: 'H5' | 'PC', browserConfig: any) {
  const policy = browserConfig?.devicePolicy ?? {};
  const mobilePreset = pickDefined(devices[defaultMobileDeviceName] ?? {});
  const baseContextOptions: any = {
    ...pickDefined(browserConfig?.baseContextOptions ?? browserConfig?.contextOptions),
  };

  if (mode === 'H5') {
    const mobileViewport = parseViewportSize(policy.defaultMobileViewportSize) ?? mobilePreset.viewport;
    return {
      ...mobilePreset,
      ...baseContextOptions,
      viewport: mobileViewport ?? baseContextOptions.viewport,
    };
  }

  const desktopContextOptions = {
    ...baseContextOptions,
  };
  delete desktopContextOptions.isMobile;
  delete desktopContextOptions.hasTouch;
  delete desktopContextOptions.screen;
  delete desktopContextOptions.deviceScaleFactor;
  if (desktopContextOptions.userAgent === mobilePreset.userAgent)
    delete desktopContextOptions.userAgent;

  const pcViewport = parseViewportSize(policy.defaultPcViewportSize) ?? desktopContextOptions.viewport;
  return {
    ...desktopContextOptions,
    viewport: pcViewport ?? null,
    isMobile: false,
    hasTouch: false,
  };
}

function pickDefined(obj: any) {
  return Object.fromEntries(Object.entries(obj ?? {}).filter(([_, v]) => v !== undefined));
}

function mergeConfig(base: any, overrides: any) {
  const baseContextOptions = {
    ...pickDefined(base.browser?.baseContextOptions),
    ...pickDefined(overrides.browser?.baseContextOptions),
    ...pickDefined(base.browser?.contextOptions),
    ...pickDefined(overrides.browser?.contextOptions),
  };
  const browser: any = {
    ...pickDefined(base.browser),
    ...pickDefined(overrides.browser),
    browserName: overrides.browser?.browserName ?? base.browser?.browserName ?? 'chromium',
    isolated: overrides.browser?.isolated ?? base.browser?.isolated ?? false,
    launchOptions: {
      ...pickDefined(base.browser?.launchOptions),
      ...pickDefined(overrides.browser?.launchOptions),
      ...{ assistantMode: true },
    },
    baseContextOptions,
    contextOptions: {
      ...baseContextOptions,
    },
    devicePolicy: {
      ...pickDefined(base.browser?.devicePolicy),
      ...pickDefined(overrides.browser?.devicePolicy),
    },
  };
  if (browser.browserName !== 'chromium' && browser.launchOptions)
    delete browser.launchOptions.channel;
  return {
    ...pickDefined(base),
    ...pickDefined(overrides),
    browser,
    network: {
      ...pickDefined(base.network),
      ...pickDefined(overrides.network),
    },
    server: {
      ...pickDefined(base.server),
      ...pickDefined(overrides.server),
    },
  };
}

export function semicolonSeparatedList(value?: string) {
  if (!value)
    return undefined;
  return value.split(';').map(v => v.trim());
}

export function commaSeparatedList(value?: string) {
  if (!value)
    return undefined;
  return value.split(',').map(v => v.trim());
}

function envToNumber(value?: string) {
  if (!value)
    return undefined;
  return +value;
}

function envToBoolean(value?: string) {
  if (value === 'true' || value === '1')
    return true;
  if (value === 'false' || value === '0')
    return false;
  return undefined;
}

function envToString(value?: string) {
  return value ? value.trim() : undefined;
}

function envCompat(suffix: string) {
  return process.env[`BETTER_PLAYWRIGHT_${suffix}`];
}

function envToStringFromCompat(suffix: string) {
  return envToString(envCompat(suffix));
}
