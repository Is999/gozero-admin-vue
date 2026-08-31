import { updatePreferences } from '@vben/preferences';
import { useAccessStore, useUserStore } from '@vben/stores';

import { message } from 'ant-design-vue';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runSessionTransition } from '#/utils/session-state-gate';

import { getLoginCaptchaApi, loginApi, refreshTokenApi } from '../core/auth';
import {
  baseRequestClient,
  createBaseRequestClient,
  createRequestClient,
  createSessionBoundRequestConfig,
  requestClient,
} from '../request';

const mocks = vi.hoisted(() => ({
  createMfaOverlayDialog: vi.fn(),
  destroyAllMfaOverlayDialogs: vi.fn(),
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
}));

vi.mock('#/router', () => ({
  router: {
    currentRoute: { value: { fullPath: '/dashboard' } },
    getRoutes: () => [],
    hasRoute: () => false,
    push: mocks.routerPush,
    removeRoute: vi.fn(),
    replace: mocks.routerReplace,
  },
}));

vi.mock('#/utils/security/mfa-overlay', () => ({
  createMfaOverlayDialog: mocks.createMfaOverlayDialog,
  destroyAllMfaOverlayDialogs: mocks.destroyAllMfaOverlayDialogs,
}));

// createResponse 构造 Axios 测试适配器返回值，统一保留请求配置。
function createResponse(
  config: any,
  data: Record<string, any>,
  status = 200,
  statusText = 'OK',
) {
  return { config, data, headers: {}, status, statusText };
}

// rejectResponse 构造带原始响应上下文的 Axios 错误。
function rejectResponse(
  config: any,
  data: Record<string, any>,
  status: number,
  statusText: string,
): never {
  const response = createResponse(config, data, status, statusText);
  throw Object.assign(new Error(String(data.message || statusText)), {
    config,
    response,
  });
}

// buildAccessToken 构造带 iat/exp 的测试 JWT，签名不参与前端临期判断。
function buildAccessToken(iat: number, exp: number, session = '') {
  const payload = btoa(JSON.stringify({ exp, iat, session }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return `header.${payload}.signature`;
}

describe('request clients', () => {
  beforeEach(() => {
    vi.useRealTimers();
    setActivePinia(createPinia());
    updatePreferences({ app: { enableRefreshToken: false } });
    vi.clearAllMocks();
    mocks.createMfaOverlayDialog.mockReturnValue({
      destroy: vi.fn(),
      promise: Promise.resolve({ result: {}, secure: '123456' }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('unwraps the backend response without authentication recovery', async () => {
    const client = createBaseRequestClient('', { responseReturn: 'data' });
    let requestCount = 0;
    await expect(
      client.post('/auth/logout', undefined, {
        adapter: async (config) => {
          requestCount += 1;
          return createResponse(config, {
            code: 1,
            data: { loggedOut: true },
            status: true,
          });
        },
      }),
    ).resolves.toEqual({
      loggedOut: true,
    });
    expect(requestCount).toBe(1);
  });

  it('does not retry its own 401 response', async () => {
    const client = createBaseRequestClient('', { responseReturn: 'data' });
    let requestCount = 0;

    await expect(
      client.post('/auth/logout', undefined, {
        adapter: async (config) => {
          requestCount += 1;
          return rejectResponse(
            config,
            {
              code: 401,
              message: 'expired',
              status: false,
            },
            401,
            'Unauthorized',
          );
        },
      }),
    ).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(requestCount).toBe(1);
  });

  it('pins a base request to its explicit access token override', async () => {
    const client = createBaseRequestClient('', { responseReturn: 'data' });
    const accessStore = useAccessStore();
    accessStore.setAccessToken('new-session-token');

    await expect(
      (client as any).post('/auth/refresh', undefined, {
        __accessTokenOverride: 'captured-source-token',
        adapter: async (config: any) => {
          expect(config.headers.Authorization).toBe(
            'Bearer captured-source-token',
          );
          expect(config.__accessTokenOverride).toBeUndefined();
          return createResponse(config, {
            code: 1,
            data: { isRefresh: true, token: 'renewed-token' },
            status: true,
          });
        },
      }),
    ).resolves.toEqual({ isRefresh: true, token: 'renewed-token' });
    expect(accessStore.accessToken).toBe('new-session-token');
  });

  it('keeps the active-session refresh API contract', async () => {
    const refresh = vi
      .spyOn(baseRequestClient, 'post')
      .mockResolvedValue({ isRefresh: true, token: 'renewed-token' } as any);

    await expect(refreshTokenApi()).resolves.toEqual({
      isRefresh: true,
      token: 'renewed-token',
    });
    expect(refresh).toHaveBeenCalledWith('/auth/refresh');
  });

  it('marks login and captcha as public authentication requests', async () => {
    const login = vi
      .spyOn(requestClient, 'post')
      .mockResolvedValue({ token: 'token' } as any);
    const captcha = vi.spyOn(requestClient, 'get').mockResolvedValue({
      expireSeconds: 60,
      image: 'image',
      key: 'key',
    } as any);
    const publicConfig = {
      skipAccessTokenRefresh: true,
      skipLoginMfaHandler: true,
      skipReAuthenticate: true,
    };

    await loginApi({ password: 'password', username: 'admin' });
    await getLoginCaptchaApi();

    expect(login).toHaveBeenCalledWith(
      '/auth/login',
      { password: 'password', username: 'admin' },
      publicConfig,
    );
    expect(captcha).toHaveBeenCalledWith('/auth/captcha', publicConfig);
  });

  it('sends PATCH requests through the app client', async () => {
    const client = createBaseRequestClient('', { responseReturn: 'data' });

    await expect(
      client.patch(
        '/profile',
        { realName: 'Admin' },
        {
          adapter: async (config) => {
            expect(config.method).toBe('patch');
            return createResponse(config, {
              code: 1,
              data: { updated: true },
              status: true,
            });
          },
        },
      ),
    ).resolves.toEqual({ updated: true });
  });

  it('preserves HTTP 200 business error context', async () => {
    const client = createBaseRequestClient('', { responseReturn: 'data' });

    await expect(
      client.get('/business-error', {
        adapter: async (config) =>
          createResponse(config, {
            code: 42,
            message: 'Business failed',
            status: false,
            traceId: 'trace-business-error',
          }),
      }),
    ).rejects.toMatchObject({
      code: 42,
      config: { url: '/business-error' },
      httpStatus: 200,
      message: 'Business failed',
      response: { config: { url: '/business-error' }, status: 200 },
      status: false,
      traceId: 'trace-business-error',
    });
  });

  it('removes credentials and request bodies from returned error context', async () => {
    const client = createBaseRequestClient('', { responseReturn: 'data' });
    const password = 'local-password-must-not-leak';

    const error = await client
      .post(
        '/auth/login',
        { password, username: 'admin' },
        {
          adapter: async (config) =>
            rejectResponse(
              config,
              { code: 401, message: 'invalid password', status: false },
              401,
              'Unauthorized',
            ),
          headers: { Authorization: 'Bearer local-token-must-not-leak' },
        },
      )
      .catch((requestError) => requestError);

    expect(error).toMatchObject({
      config: { method: 'post', url: '/auth/login' },
      response: {
        config: { method: 'post', url: '/auth/login' },
        status: 401,
      },
    });
    expect(error.config).not.toHaveProperty('data');
    expect(error.config).not.toHaveProperty('headers');
    expect(error.response.config).not.toHaveProperty('data');
    expect(error.response.config).not.toHaveProperty('headers');
    expect(JSON.stringify(error)).not.toContain(password);
    expect(JSON.stringify(error)).not.toContain('local-token-must-not-leak');
  });

  it('surfaces local interceptor errors through the app message handler', async () => {
    const client = createRequestClient('', { responseReturn: 'data' });
    const localError = new Error('Local config failed');
    const messageError = vi
      .spyOn(message, 'error')
      .mockImplementation(() => undefined as any);
    client.addRequestInterceptor({
      fulfilled: () => {
        throw localError;
      },
    });

    await expect(client.get('/local-error')).rejects.toBe(localError);
    expect(messageError).toHaveBeenCalledWith('Local config failed');
  });

  it('keeps the session when a request skips reauthentication', async () => {
    const client = createRequestClient('', { responseReturn: 'data' });
    const accessStore = useAccessStore();
    accessStore.setAccessToken('token-1');
    let requestCount = 0;

    await expect(
      client.get('/profile/check-secure', {
        adapter: async (config) => {
          requestCount += 1;
          return rejectResponse(
            config,
            { code: 401, message: 'invalid password', status: false },
            401,
            'Unauthorized',
          );
        },
        skipGlobalErrorMessage: true,
        skipReAuthenticate: true,
      }),
    ).rejects.toMatchObject({
      code: 401,
      httpStatus: 401,
      response: { status: 401 },
    });
    expect(accessStore.accessToken).toBe('token-1');
    expect(requestCount).toBe(1);
  });

  it('keeps the session for a skipped HTTP 200 business 401', async () => {
    const client = createRequestClient('', { responseReturn: 'data' });
    const accessStore = useAccessStore();
    accessStore.setAccessToken('token-1');

    await expect(
      client.get('/auth/captcha', {
        adapter: async (config) =>
          createResponse(config, {
            code: 401,
            message: 'public unauthorized',
            status: false,
          }),
        skipAccessTokenRefresh: true,
        skipGlobalErrorMessage: true,
        skipLoginMfaHandler: true,
        skipReAuthenticate: true,
      }),
    ).rejects.toMatchObject({ code: 401 });

    expect(accessStore.accessToken).toBe('token-1');
    expect(mocks.routerReplace).not.toHaveBeenCalled();
  });

  it('renews a near-expiry token before sending the business request', async () => {
    updatePreferences({ app: { enableRefreshToken: true } });
    const now = Math.floor(Date.now() / 1000);
    const accessStore = useAccessStore();
    const sourceToken = buildAccessToken(now - 100, now + 10);
    accessStore.setAccessToken(sourceToken);
    const refresh = vi
      .spyOn(baseRequestClient, 'post')
      .mockResolvedValue({ isRefresh: true, token: 'renewed-token' } as any);
    const client = createRequestClient('', { responseReturn: 'data' });

    await expect(
      client.get('/profile', {
        adapter: async (config) => {
          expect(config.headers.Authorization).toBe('Bearer renewed-token');
          return createResponse(config, {
            code: 1,
            data: { id: 1 },
            status: true,
          });
        },
      }),
    ).resolves.toEqual({ id: 1 });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('/auth/refresh', undefined, {
      __accessTokenOverride: sourceToken,
    });
    expect(accessStore.accessToken).toBe('renewed-token');
  });

  it('merges concurrent near-expiry token renewals', async () => {
    updatePreferences({ app: { enableRefreshToken: true } });
    const now = Math.floor(Date.now() / 1000);
    const accessStore = useAccessStore();
    accessStore.setAccessToken(buildAccessToken(now - 100, now + 10));
    let resolveRefresh: (value: any) => void = () => undefined;
    const refreshResult = new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    const refresh = vi
      .spyOn(baseRequestClient, 'post')
      .mockReturnValue(refreshResult as any);
    const client = createRequestClient('', { responseReturn: 'data' });
    const request = (url: string) =>
      client.get(url, {
        adapter: async (config) =>
          createResponse(config, {
            code: 1,
            data: { url },
            status: true,
          }),
      });

    const pending = Promise.all([request('/one'), request('/two')]);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    resolveRefresh({ isRefresh: true, token: 'renewed-token' });

    await expect(pending).resolves.toEqual([{ url: '/one' }, { url: '/two' }]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'network failure',
      Object.assign(new Error('network unavailable'), { code: 'ERR_NETWORK' }),
      'network',
    ],
    [
      'server failure',
      Object.assign(new Error('server unavailable'), {
        response: { data: { code: 500 }, status: 500 },
      }),
      'server',
    ],
  ])(
    'continues with a still-valid source token after %s',
    async (_name, refreshError, session) => {
      updatePreferences({ app: { enableRefreshToken: true } });
      const now = Math.floor(Date.now() / 1000);
      const accessStore = useAccessStore();
      const sourceToken = buildAccessToken(now - 100, now + 10, session);
      accessStore.setAccessToken(sourceToken);
      const refresh = vi
        .spyOn(baseRequestClient, 'post')
        .mockRejectedValue(refreshError);
      const client = createRequestClient('', { responseReturn: 'data' });
      const adapter = vi.fn(async (config) => {
        expect(config.headers.Authorization).toBe(`Bearer ${sourceToken}`);
        return createResponse(config, {
          code: 1,
          data: { id: 1 },
          status: true,
        });
      });

      await expect(client.get('/profile', { adapter })).resolves.toEqual({
        id: 1,
      });

      expect(refresh).toHaveBeenCalledTimes(1);
      expect(adapter).toHaveBeenCalledTimes(1);
      expect(accessStore.accessToken).toBe(sourceToken);
    },
  );

  it('continues with a still-valid source token after an invalid refresh response', async () => {
    updatePreferences({ app: { enableRefreshToken: true } });
    const now = Math.floor(Date.now() / 1000);
    const accessStore = useAccessStore();
    const sourceToken = buildAccessToken(now - 100, now + 10, 'invalid');
    accessStore.setAccessToken(sourceToken);
    const refresh = vi
      .spyOn(baseRequestClient, 'post')
      .mockResolvedValue({ isRefresh: false, token: '' } as any);
    const client = createRequestClient('', { responseReturn: 'data' });
    const adapter = vi.fn(async (config) => {
      expect(config.headers.Authorization).toBe(`Bearer ${sourceToken}`);
      return createResponse(config, {
        code: 1,
        data: { id: 1 },
        status: true,
      });
    });

    await expect(client.get('/profile', { adapter })).resolves.toEqual({
      id: 1,
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('cools down transient refresh retries for the same source token', async () => {
    vi.useFakeTimers();
    const now = 1_700_000_000;
    vi.setSystemTime(new Date(now * 1000));
    updatePreferences({ app: { enableRefreshToken: true } });
    const accessStore = useAccessStore();
    const sourceToken = buildAccessToken(now - 900, now + 100, 'cooldown');
    accessStore.setAccessToken(sourceToken);
    const refresh = vi
      .spyOn(baseRequestClient, 'post')
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({
        isRefresh: true,
        token: 'renewed-token',
      } as any);
    const client = createRequestClient('', { responseReturn: 'data' });
    const request = () =>
      client.get('/profile', {
        adapter: async (config) =>
          createResponse(config, {
            code: 1,
            data: { ok: true },
            status: true,
          }),
      });

    await expect(request()).resolves.toEqual({ ok: true });
    await expect(request()).resolves.toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_001);
    await expect(request()).resolves.toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(accessStore.accessToken).toBe('renewed-token');
  });

  it('cancels an old request when the session changes during a successful refresh', async () => {
    updatePreferences({ app: { enableRefreshToken: true } });
    const now = Math.floor(Date.now() / 1000);
    const accessStore = useAccessStore();
    accessStore.setAccessToken(
      buildAccessToken(now - 100, now + 10, 'old-session'),
    );
    let resolveRefresh: (value: any) => void = () => undefined;
    const refreshResult = new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    const refresh = vi
      .spyOn(baseRequestClient, 'post')
      .mockReturnValue(refreshResult as any);
    const client = createRequestClient('', { responseReturn: 'data' });
    const adapter = vi.fn();

    const pending = client.get('/profile', { adapter });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    accessStore.setAccessToken('new-session-token');
    resolveRefresh({ isRefresh: true, token: 'old-session-renewed-token' });

    await expect(pending).rejects.toMatchObject({
      __skipGlobalErrorMessage: true,
      message: 'ACCESS_TOKEN_SESSION_CHANGED',
    });
    expect(adapter).not.toHaveBeenCalled();
    expect(accessStore.accessToken).toBe('new-session-token');
    expect(mocks.routerReplace).not.toHaveBeenCalled();
  });

  it('does not clear a new session when an old refresh becomes unauthorized', async () => {
    updatePreferences({ app: { enableRefreshToken: true } });
    const now = Math.floor(Date.now() / 1000);
    const accessStore = useAccessStore();
    accessStore.setAccessToken(
      buildAccessToken(now - 100, now + 10, 'old-unauthorized'),
    );
    let rejectRefresh: (reason: any) => void = () => undefined;
    const refreshResult = new Promise((_resolve, reject) => {
      rejectRefresh = reject;
    });
    const refresh = vi
      .spyOn(baseRequestClient, 'post')
      .mockReturnValue(refreshResult as any);
    const client = createRequestClient('', { responseReturn: 'data' });
    const adapter = vi.fn();

    const pending = client.get('/profile', { adapter });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    accessStore.setAccessToken('new-session-token');
    rejectRefresh({ response: { data: { code: 401 }, status: 401 } });

    await expect(pending).rejects.toMatchObject({
      __skipGlobalErrorMessage: true,
      message: 'ACCESS_TOKEN_SESSION_CHANGED',
    });
    expect(adapter).not.toHaveBeenCalled();
    expect(accessStore.accessToken).toBe('new-session-token');
    expect(mocks.routerReplace).not.toHaveBeenCalled();
  });

  it.each([
    {
      method: 'post' as const,
      path: '/admins/password/reset/2',
      payload: {
        password: 'StrongPassword123!',
        twoStepKey: 'old-ticket-key',
        twoStepValue: 'old-ticket-value',
      },
    },
    {
      method: 'patch' as const,
      path: '/admins/status/2',
      payload: {
        status: 0,
        twoStepKey: 'old-ticket-key',
        twoStepValue: 'old-ticket-value',
      },
    },
  ])(
    'rebuilds $method MFA retries from plaintext with fresh security headers',
    async ({ method, path, payload }) => {
      const aesKey = '1234567890abcdef';
      const aesIV = 'abcdef1234567890';
      vi.stubEnv('VITE_ADMIN_SECURITY_APP_ID', '1');
      vi.stubEnv('VITE_ADMIN_SIGNATURE_ENABLED', 'true');
      vi.stubEnv('VITE_ADMIN_SIGNATURE_TYPE', 'A');
      vi.stubEnv('VITE_ADMIN_CRYPTO_ENABLED', 'true');
      vi.stubEnv('VITE_ADMIN_CRYPTO_TYPE', 'A');
      vi.stubEnv('VITE_ADMIN_SECURITY_AES_KEY', aesKey);
      vi.stubEnv('VITE_ADMIN_SECURITY_AES_IV', aesIV);

      const accessStore = useAccessStore();
      accessStore.setAccessToken('active-token');
      useUserStore().setUserInfo({
        existMFA: true,
        mfaStatus: 1,
        realName: 'Admin',
        roles: ['admin'],
        userId: '1',
        username: 'admin',
      } as any);

      const client = createRequestClient('', { responseReturn: 'data' });
      const sentRequests: Array<{
        data: Record<string, any>;
        headers: Record<string, any>;
      }> = [];
      client.instance.defaults.adapter = async (config) => {
        if (config.url === '/auth/profile') {
          return createResponse(config, {
            code: 500,
            message: 'profile refresh unavailable',
            status: false,
          });
        }
        expect(config.url).toBe(path);
        sentRequests.push({
          data: JSON.parse(String(config.data || '{}')),
          headers: { ...(config.headers as any) },
        });
        if (sentRequests.length === 1) {
          return createResponse(config, {
            code: 6,
            message: 'login MFA required',
            status: false,
          });
        }
        return createResponse(config, {
          code: 1,
          data: { updated: true },
          status: true,
        });
      };

      const result =
        method === 'post'
          ? client.post(path, payload)
          : client.patch(path, payload);
      await expect(result).resolves.toEqual({ updated: true });

      expect(sentRequests).toHaveLength(2);
      const [firstRequest, retryRequest] = sentRequests;
      expect(firstRequest?.headers['X-Trace-Id']).toBeTruthy();
      expect(retryRequest?.headers['X-Trace-Id']).toBeTruthy();
      expect(retryRequest?.headers['X-Trace-Id']).not.toBe(
        firstRequest?.headers['X-Trace-Id'],
      );
      expect(retryRequest?.data.sign).toBeTruthy();
      expect(retryRequest?.data.sign).not.toBe(firstRequest?.data.sign);
      if (method === 'post') {
        expect(retryRequest?.headers['X-Crypto']).toBe('A');
        expect(retryRequest?.data.password).toBe(firstRequest?.data.password);
        expect(retryRequest?.data.password).not.toBe(payload.password);
      } else {
        expect(retryRequest?.data.status).toBe(payload.status);
      }
      expect(mocks.createMfaOverlayDialog).toHaveBeenCalledTimes(1);
    },
  );

  it('reauthenticates without sending the business request when renewal is unauthorized', async () => {
    updatePreferences({ app: { enableRefreshToken: true } });
    const now = Math.floor(Date.now() / 1000);
    const accessStore = useAccessStore();
    accessStore.setAccessToken(buildAccessToken(now - 100, now + 10));
    vi.spyOn(baseRequestClient, 'post').mockRejectedValue({
      response: { data: { code: 401 }, status: 401 },
    });
    const client = createRequestClient('', { responseReturn: 'data' });
    const adapter = vi.fn();

    await expect(client.get('/profile', { adapter })).rejects.toMatchObject({
      __skipGlobalErrorMessage: true,
    });
    expect(adapter).not.toHaveBeenCalled();
    expect(accessStore.accessToken).toBeNull();
    expect(mocks.routerReplace).toHaveBeenCalledTimes(1);
  });

  it('clears the session and redirects after an ordinary 401 response', async () => {
    const client = createRequestClient('', { responseReturn: 'data' });
    const accessStore = useAccessStore();
    accessStore.setAccessToken('token-1');
    let requestCount = 0;

    await expect(
      client.get('/profile', {
        adapter: async (config) => {
          requestCount += 1;
          return rejectResponse(
            config,
            { code: 401, message: 'expired', status: false },
            401,
            'Unauthorized',
          );
        },
        skipGlobalErrorMessage: true,
      }),
    ).rejects.toMatchObject({
      code: 401,
      httpStatus: 401,
      response: { status: 401 },
    });

    expect(requestCount).toBe(1);
    expect(accessStore.accessToken).toBeNull();
    expect(mocks.routerReplace).toHaveBeenCalledTimes(1);
  });

  it('keeps the session after a signed request authentication failure', async () => {
    const client = createRequestClient('', { responseReturn: 'data' });
    const accessStore = useAccessStore();
    accessStore.setAccessToken('token-1');

    await expect(
      client.patch(
        '/admins/roles/2',
        { roleIDs: [2] },
        {
          adapter: async (config) =>
            rejectResponse(
              config,
              {
                code: 1002,
                message: '签名验证失败',
                status: false,
              },
              401,
              'Unauthorized',
            ),
          skipGlobalErrorMessage: true,
        },
      ),
    ).rejects.toMatchObject({
      code: 1002,
      httpStatus: 401,
      response: { status: 401 },
    });

    expect(accessStore.accessToken).toBe('token-1');
    expect(mocks.routerReplace).not.toHaveBeenCalled();
  });

  it('keeps the session after a Redis dependency failure', async () => {
    const client = createRequestClient('', { responseReturn: 'data' });
    const accessStore = useAccessStore();
    accessStore.setAccessToken('token-1');

    await expect(
      client.get('/profile', {
        adapter: async (config) =>
          rejectResponse(
            config,
            {
              code: 50_003,
              message: 'Redis不可用',
              status: false,
            },
            503,
            'Service Unavailable',
          ),
        skipGlobalErrorMessage: true,
      }),
    ).rejects.toMatchObject({
      code: 50_003,
      httpStatus: 503,
      response: { status: 503 },
    });

    expect(accessStore.accessToken).toBe('token-1');
    expect(mocks.routerReplace).not.toHaveBeenCalled();
  });

  it.each([
    ['HTTP 401', 401, 401],
    ['business 401', 200, 401],
    ['login MFA required', 200, 6],
    ['password reset required', 200, 7],
  ])(
    'ignores stale-session side effects from an ordinary %s response',
    async (_name, httpStatus, businessCode) => {
      const client = createRequestClient('', { responseReturn: 'data' });
      const accessStore = useAccessStore();
      accessStore.setAccessToken('old-session-token');
      const messageError = vi
        .spyOn(message, 'error')
        .mockImplementation(() => undefined as any);
      let completeResponse: () => void = () => undefined;
      const adapter = vi.fn(
        (config: any) =>
          new Promise<any>((resolve, reject) => {
            completeResponse = () => {
              const data = {
                code: businessCode,
                message: 'old session response',
                status: false,
              };
              if (httpStatus === 401) {
                try {
                  rejectResponse(config, data, 401, 'Unauthorized');
                } catch (error) {
                  reject(error);
                }
                return;
              }
              resolve(createResponse(config, data));
            };
          }),
      );

      const pending = client.get('/ordinary-request', { adapter });
      const rejection = pending.catch((error) => error);
      await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
      expect(adapter.mock.calls[0]?.[0]?.headers?.Authorization).toBe(
        'Bearer old-session-token',
      );
      accessStore.setAccessToken('new-session-token');
      completeResponse();
      expect(await rejection).toBeTruthy();

      expect(accessStore.accessToken).toBe('new-session-token');
      expect(mocks.routerReplace).not.toHaveBeenCalled();
      expect(mocks.createMfaOverlayDialog).not.toHaveBeenCalled();
      expect(messageError).not.toHaveBeenCalled();
    },
  );

  it('does not redirect from a stale successful profile response', async () => {
    const client = createRequestClient('', { responseReturn: 'data' });
    const accessStore = useAccessStore();
    accessStore.setAccessToken('old-session-token');
    let completeResponse: () => void = () => undefined;
    const adapter = vi.fn(
      (config: any) =>
        new Promise<any>((resolve) => {
          completeResponse = () =>
            resolve(
              createResponse(config, {
                code: 1,
                data: { id: 1, needResetPassword: 1 },
                status: true,
              }),
            );
        }),
    );

    const pending = client.get('/auth/profile', { adapter });
    await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
    accessStore.setAccessToken('new-session-token');
    completeResponse();

    await expect(pending).resolves.toMatchObject({ needResetPassword: 1 });
    expect(accessStore.accessToken).toBe('new-session-token');
    expect(mocks.routerPush).not.toHaveBeenCalled();
  });

  it('rejects successful data returned after the account identity changes', async () => {
    const client = createRequestClient('', { responseReturn: 'data' });
    const accessStore = useAccessStore();
    await runSessionTransition(() => {
      accessStore.setAccessToken('account-a-token');
    });
    let completeResponse: () => void = () => undefined;
    const adapter = vi.fn(
      (config: any) =>
        new Promise<any>((resolve) => {
          completeResponse = () =>
            resolve(
              createResponse(config, {
                code: 1,
                data: { owner: 'account-a' },
                status: true,
              }),
            );
        }),
    );
    const pending = client.get('/notifications', { adapter });
    await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));

    await runSessionTransition(() => {
      accessStore.setAccessToken('account-b-token');
    });
    completeResponse();

    await expect(pending).rejects.toThrow('SESSION_STATE_CHANGED');
    expect(accessStore.accessToken).toBe('account-b-token');
  });

  it('does not send an app request pinned to an old access token', async () => {
    const client = createRequestClient('', { responseReturn: 'data' });
    useAccessStore().setAccessToken('current-token');
    const adapter = vi.fn();

    await expect(
      client.get('/auth/profile', {
        ...createSessionBoundRequestConfig('old-token'),
        adapter,
      }),
    ).rejects.toThrow('ACCESS_TOKEN_SESSION_CHANGED');
    expect(adapter).not.toHaveBeenCalled();
  });
});
