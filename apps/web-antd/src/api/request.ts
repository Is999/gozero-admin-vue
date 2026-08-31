/**
 * 该文件可自行根据业务逻辑进行调整
 */
import type {
  RequestClientConfig,
  RequestClientOptions,
  ResponseInterceptorConfig,
} from '@vben/request';

import type { AuthApi } from './core';
import type { SystemProfileApi } from './system';

import { LOGIN_PATH } from '@vben/constants';
import { useAppConfig } from '@vben/hooks';
import { preferences } from '@vben/preferences';
import {
  defaultResponseInterceptor,
  errorMessageResponseInterceptor,
  RequestClient,
} from '@vben/request';
import { resetAllStores, useAccessStore, useUserStore } from '@vben/stores';

import { message } from 'ant-design-vue';

import { ACCESS_SYNC_FORBIDDEN_EVENT } from '#/constants/access-sync';
import { $t } from '#/locales';
import { router } from '#/router';
import { publishAccessTokenRotation } from '#/utils/access-token-sync';
import {
  createTraceId,
  createTraceparent,
  extractResponseTraceId,
  formatTraceErrorMessage,
  TRACE_ID_HEADER,
  TRACEPARENT_HEADER,
} from '#/utils/request/trace';
import { extractMfaSecret } from '#/utils/security/mfa-core';
import { getMfaMicrosoftScanTip } from '#/utils/security/mfa-guide';
import {
  createMfaOverlayDialog,
  destroyAllMfaOverlayDialogs,
} from '#/utils/security/mfa-overlay';
import {
  attachAdminSecurityHeaders,
  handleAdminSecurityResponse,
} from '#/utils/security/signature';
import { resetSessionAccessState } from '#/utils/session-access-state';
import {
  currentSessionStateVersion,
  runSessionStateMutation,
  runSessionTransitionIf,
  SESSION_STATE_CHANGED,
} from '#/utils/session-state-gate';

import {
  shouldReAuthenticateAfterError,
  shouldSyncAccessAfterError,
} from './request-policy';
import {
  AUTH_REFRESH_PATH,
  isAccessTokenUsable,
  shouldRenewAccessToken,
} from './token-refresh';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);
// reauthRedirectingVersion 标记正在处理 401 的账号版本，避免同账号并发重复重认证。
let reauthRedirectingVersion: null | number = null;
// loginMfaVerifying 按发起时令牌合并登录 MFA 流程，不同会话不得共用弹窗或结果。
let loginMfaVerifying: null | {
  promise: Promise<void>;
  sourceToken: string;
} = null;
// passwordResetRedirectingVersion 标记正在执行“强制改密”跳转的账号版本，避免同账号并发重复跳转。
let passwordResetRedirectingVersion: null | number = null;
// lastPasswordResetPromptAt 记录上次提示时间，避免短时间内重复提示刷屏。
let lastPasswordResetPromptAt = 0;
// ACCESS_TOKEN_REFRESH_RETRY_COOLDOWN_MS 表示临期续签暂时失败后的短冷却时间，避免请求风暴。
const ACCESS_TOKEN_REFRESH_RETRY_COOLDOWN_MS = 30_000;
// ACCESS_TOKEN_SESSION_CHANGED 表示等待续签期间登录会话已切换，原请求必须终止。
const ACCESS_TOKEN_SESSION_CHANGED = 'ACCESS_TOKEN_SESSION_CHANGED';

// AccessTokenRefreshTask 合并同一来源 token 的临期续签请求。
type AccessTokenRefreshTask = {
  promise: Promise<string>;
  sourceToken: string;
};

// AccessTokenRefreshCooldown 保存最近一次暂时失败的来源 token 与下次允许重试时间。
type AccessTokenRefreshCooldown = {
  retryAt: number;
  sourceToken: string;
};

// accessTokenRefreshTask 保存当前进行中的续签任务；新会话不会复用旧会话任务。
let accessTokenRefreshTask: AccessTokenRefreshTask | null = null;
// accessTokenRefreshCooldown 按来源 token 保存短冷却，token 轮换后自动失效。
let accessTokenRefreshCooldown: AccessTokenRefreshCooldown | null = null;

// LOGIN_MFA_BIND_REQUIRED_CODE 表示后端要求当前账号先完成 MFA 绑定与启用。
const LOGIN_MFA_BIND_REQUIRED_CODE = 5;
// LOGIN_MFA_REQUIRED_CODE 表示后端要求当前登录会话先完成 MFA 校验。
const LOGIN_MFA_REQUIRED_CODE = 6;
// PASSWORD_RESET_REQUIRED_CODE 表示后端要求当前账号先修改登录密码。
const PASSWORD_RESET_REQUIRED_CODE = 7;
// MFA_CHECK_AGAIN_CODE 表示后端要求当前请求重新执行一次 MFA 二次确认。
const MFA_CHECK_AGAIN_CODE = 8;
// LOGIN_MFA_CANCELLED 表示用户主动取消登录 MFA 弹窗时抛出的统一错误码。
const LOGIN_MFA_CANCELLED = 'LOGIN_MFA_CANCELLED';
// LOGIN_MFA_USER_UPDATED_EVENT 表示登录 MFA 成功后向页面广播最新用户上下文的事件名。
const LOGIN_MFA_USER_UPDATED_EVENT = 'login-mfa-user-updated';
// LOGIN_MFA_SKIP_URLS 表示不应再触发登录 MFA 拦截的接口白名单，避免递归请求自身。
const LOGIN_MFA_SKIP_URLS = new Set([
  '/auth/profile',
  '/profile/check-mfa',
  '/profile/mfa-status',
]);
// PASSWORD_RESET_PROFILE_URLS 表示会返回 needResetPassword 标记的用户资料接口。
const PASSWORD_RESET_PROFILE_URLS = new Set(['/auth/profile', '/profile']);
// ACCESS_SYNC_SKIP_URLS 表示权限同步自身依赖的接口，避免 403 兜底刷新形成递归触发。
const ACCESS_SYNC_SKIP_URLS = new Set(['/auth/codes', '/auth/profile']);

// LoginMfaUserContext 表示登录 MFA 弹窗依赖的最小用户上下文字段集合。
type LoginMfaUserContext = {
  buildMFAURL?: string;
  existMFA?: boolean;
  forceMFAEnabled?: boolean;
  id?: number | string;
  mfaBindRequired?: boolean;
  mfaStatus?: number;
  username?: string;
};

// UserStoreInfo 表示当前 vben 用户仓库接受的用户资料结构。
type UserStoreInfo = NonNullable<ReturnType<typeof useUserStore>['userInfo']>;

// UserInfoPatch 表示后端用户资料增量字段。
type UserInfoPatch = Partial<UserStoreInfo> &
  Record<string, unknown> & {
    id?: number | string;
    needResetPassword?: number;
  };

// AppRequestClientConfig 保存后台应用专属请求控制字段，不扩散到 Vben 核心类型。
type AppRequestClientConfig<T = any> = RequestClientConfig<T> & {
  __accessTokenOverride?: string;
  __loginMfaRetried?: boolean;
  __sessionStateVersion?: number;
  skipAccessTokenRefresh?: boolean;
  skipGlobalErrorMessage?: boolean;
  skipLoginMfaHandler?: boolean;
  skipPasswordResetHandler?: boolean;
  skipReAuthenticate?: boolean;
};

// PlainRequestPayload 保存安全拦截器处理前的请求参数，供 MFA 成功后重新生成签名与密文。
type PlainRequestPayload = {
  data: any;
  params: any;
};

// AppRequestClient 在应用层承载专属请求字段和 PATCH 方法，保持 Vben 核心可直接升级。
class AppRequestClient extends RequestClient {
  public override delete<T = any>(
    url: string,
    config?: AppRequestClientConfig,
  ): Promise<T> {
    return this.request<T>(url, { ...config, method: 'DELETE' });
  }

  public override get<T = any>(
    url: string,
    config?: AppRequestClientConfig,
  ): Promise<T> {
    return this.request<T>(url, { ...config, method: 'GET' });
  }

  public patch<T = any>(
    url: string,
    data?: any,
    config?: AppRequestClientConfig,
  ): Promise<T> {
    return this.request<T>(url, { ...config, data, method: 'PATCH' });
  }

  public override post<T = any>(
    url: string,
    data?: any,
    config?: AppRequestClientConfig,
  ): Promise<T> {
    return this.request<T>(url, { ...config, data, method: 'POST' });
  }

  public override put<T = any>(
    url: string,
    data?: any,
    config?: AppRequestClientConfig,
  ): Promise<T> {
    return this.request<T>(url, { ...config, data, method: 'PUT' });
  }

  public override request<T>(
    url: string,
    config: AppRequestClientConfig,
  ): Promise<T> {
    const currentToken = String(useAccessStore().accessToken || '');
    const requestToken =
      config.__accessTokenOverride === undefined
        ? currentToken
        : String(config.__accessTokenOverride || '');
    const requestConfig: AppRequestClientConfig = {
      ...config,
      __sessionStateVersion:
        config.__sessionStateVersion ??
        (requestToken ? currentSessionStateVersion() : undefined),
    };
    return super.request<T>(url, requestConfig);
  }
}

// createSessionBoundRequestConfig 把后续请求固定到指定会话，旧会话响应不得触发当前会话的续签、MFA 或强制改密流程。
export function createSessionBoundRequestConfig(accessToken: string) {
  return {
    __accessTokenOverride: accessToken,
    skipAccessTokenRefresh: true,
    skipLoginMfaHandler: true,
    skipPasswordResetHandler: true,
    skipReAuthenticate: true,
  } satisfies AppRequestClientConfig;
}

// requestAccessToken 从已实际发送的 Authorization 中提取请求所属会话令牌。
function requestAccessToken(config?: AppRequestClientConfig) {
  const headers = config?.headers as any;
  const authorization = String(
    headers?.get?.('Authorization') ||
      headers?.Authorization ||
      headers?.authorization ||
      '',
  ).trim();
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
}

// isStaleSessionIdentityRequest 判断响应是否来自已经切换的账号；同账号 token 续签不视为身份变化。
function isStaleSessionIdentityRequest(config?: AppRequestClientConfig) {
  return Boolean(
    config?.__sessionStateVersion !== undefined &&
    config.__sessionStateVersion !== currentSessionStateVersion(),
  );
}

// isStaleSessionRequest 判断请求 token 是否已被账号切换或同账号续签替代，用于抑制旧响应副作用。
function isStaleSessionRequest(config?: AppRequestClientConfig) {
  if (isStaleSessionIdentityRequest(config)) {
    return true;
  }
  const sourceToken = requestAccessToken(config);
  return Boolean(
    sourceToken && sourceToken !== String(useAccessStore().accessToken || ''),
  );
}

// appAuthenticateResponseInterceptor 在应用层处理 401 和跳过重认证策略。
function appAuthenticateResponseInterceptor({
  doReAuthenticate,
}: {
  doReAuthenticate: (config?: AppRequestClientConfig) => Promise<void>;
}): ResponseInterceptorConfig {
  return {
    rejected: async (error) => {
      const { config, response } = error;
      const businessCode = Number(response?.data?.code ?? 0);
      if (
        !shouldReAuthenticateAfterError(response?.status, businessCode) ||
        config?.skipReAuthenticate ||
        !requestAccessToken(config as AppRequestClientConfig) ||
        isStaleSessionRequest(config as AppRequestClientConfig)
      ) {
        throw error;
      }
      await doReAuthenticate(config as AppRequestClientConfig);
      throw error;
    },
  };
}

// safeErrorRequestConfig 仅保留排障所需的请求定位信息，禁止认证头和表单正文进入异常日志。
function safeErrorRequestConfig(config?: Record<string, any>) {
  if (!config) {
    return undefined;
  }
  return {
    method: config.method,
    url: config.url,
  };
}

// attachRequestErrorContext 在核心客户端拆出业务错误前保留状态码和 trace 上下文。
// 原始 Axios config 同时包含 Authorization、密码或 MFA 数据，异常离开请求层前必须裁剪。
function attachRequestErrorContext(error: any) {
  const response = error?.response;
  const requestConfig = error?.config || response?.config;
  const safeConfig = safeErrorRequestConfig(requestConfig);
  if (error && typeof error === 'object') {
    error.config = safeConfig;
  }
  if (!response) {
    throw error;
  }
  const responseData = response.data;
  const responseSnapshot = {
    ...response,
    config: safeConfig,
    data: responseData,
  };
  const context = {
    config: safeConfig,
    httpStatus: response.status,
    httpStatusText: response.statusText,
    response: responseSnapshot,
    responseHeaders: response.headers,
    traceId:
      responseData?.traceId ||
      responseData?.trace_id ||
      extractResponseTraceId(error),
  };
  const contextualData =
    responseData && typeof responseData === 'object'
      ? Object.assign({}, responseData, context)
      : Object.assign(
          new Error(
            String(responseData || response.statusText || error.message),
          ),
          { ...context, data: responseData },
        );
  response.data = contextualData;
  error.response = { ...responseSnapshot, data: contextualData };
  throw error;
}

function formatToken(token: null | string) {
  return token ? `Bearer ${token}` : null;
}

// attachRequestHeaders 统一补齐认证、语言、追踪与安全头，供业务客户端和基础客户端复用。
async function attachRequestHeaders(
  config: RequestClientConfig,
  requestToken = String(useAccessStore().accessToken || ''),
) {
  const appConfig = config as AppRequestClientConfig;
  const resolvedToken =
    appConfig.__accessTokenOverride === undefined
      ? requestToken
      : String(appConfig.__accessTokenOverride || '');
  delete appConfig.__accessTokenOverride;
  const headers = (config.headers ||= {});
  headers.Authorization = formatToken(resolvedToken);
  headers['Accept-Language'] = preferences.app.locale;
  if (!headers[TRACE_ID_HEADER] && !headers[TRACE_ID_HEADER.toLowerCase()]) {
    headers[TRACE_ID_HEADER] = createTraceId();
  }
  if (
    !headers[TRACEPARENT_HEADER] &&
    !headers[TRACEPARENT_HEADER.toLowerCase()]
  ) {
    const traceId = String(
      headers[TRACE_ID_HEADER] || headers[TRACE_ID_HEADER.toLowerCase()] || '',
    );
    const traceparent = createTraceparent(traceId);
    if (traceparent) {
      headers[TRACEPARENT_HEADER] = traceparent;
    }
  }
  return attachAdminSecurityHeaders(config);
}

// renewAccessTokenIfNeeded 在 JWT 生命周期达到 80% 后主动续签，过期令牌仍交给 401 重认证流程处理。
async function renewAccessTokenIfNeeded(sourceToken: string) {
  const accessStore = useAccessStore();
  if (
    !preferences.app.enableRefreshToken ||
    !shouldRenewAccessToken(sourceToken)
  ) {
    return sourceToken;
  }

  if (
    accessTokenRefreshCooldown?.sourceToken === sourceToken &&
    Date.now() < accessTokenRefreshCooldown.retryAt
  ) {
    return sourceToken;
  }
  if (accessTokenRefreshCooldown?.sourceToken === sourceToken) {
    accessTokenRefreshCooldown = null;
  }

  if (accessTokenRefreshTask?.sourceToken !== sourceToken) {
    const task: AccessTokenRefreshTask = {
      sourceToken,
      promise: (async () => {
        const result = await baseRequestClient.post<AuthApi.RefreshTokenResult>(
          AUTH_REFRESH_PATH,
          undefined,
          { __accessTokenOverride: sourceToken },
        );
        const newToken = String(result?.token || '').trim();
        if (!result?.isRefresh || !newToken) {
          throw new Error($t('business.message.accessTokenRefreshInvalid'));
        }
        return newToken;
      })(),
    };
    accessTokenRefreshTask = task;
  }

  const task = accessTokenRefreshTask;
  try {
    const newToken = await task.promise;
    let tokenRotated = false;
    await runSessionStateMutation(() => {
      const currentToken = String(accessStore.accessToken || '');
      if (currentToken !== sourceToken && currentToken !== newToken) {
        throw new Error(ACCESS_TOKEN_SESSION_CHANGED);
      }
      if (currentToken === sourceToken) {
        destroyAllMfaOverlayDialogs();
        accessStore.setAccessToken(newToken);
        tokenRotated = true;
      }
    });
    if (tokenRotated) {
      publishAccessTokenRotation(sourceToken, newToken);
    }
    accessTokenRefreshCooldown = null;
    return newToken;
  } catch (error) {
    if (String(accessStore.accessToken || '') !== sourceToken) {
      throw new Error(ACCESS_TOKEN_SESSION_CHANGED, { cause: error });
    }
    const httpStatus = Number(
      (error as any)?.httpStatus || (error as any)?.response?.status || 0,
    );
    const businessCode = Number(
      (error as any)?.code || (error as any)?.response?.data?.code || 0,
    );
    if (shouldReAuthenticateAfterError(httpStatus, businessCode)) {
      accessTokenRefreshCooldown = null;
      throw error;
    }
    if (!isAccessTokenUsable(sourceToken)) {
      throw error;
    }
    accessTokenRefreshCooldown = {
      retryAt: Date.now() + ACCESS_TOKEN_REFRESH_RETRY_COOLDOWN_MS,
      sourceToken,
    };
    return sourceToken;
  } finally {
    if (accessTokenRefreshTask === task) {
      accessTokenRefreshTask = null;
    }
  }
}

// createBaseRequestClient 创建仅保留基础请求头、安全处理和响应拆包的客户端。
// 退出登录等基础会话请求使用该客户端，不能挂载认证恢复拦截器，避免 401 递归处理自身。
export function createBaseRequestClient(
  baseURL: string,
  options?: RequestClientOptions,
) {
  const client = new AppRequestClient({
    ...options,
    baseURL,
  });
  client.addRequestInterceptor({ fulfilled: attachRequestHeaders });
  client.addResponseInterceptor({
    fulfilled: async (response) => handleAdminSecurityResponse(response),
  });
  client.addResponseInterceptor(
    defaultResponseInterceptor({
      codeField: 'status',
      dataField: 'data',
      successCode: (value: any) => value === true,
    }),
  );
  client.addResponseInterceptor({ rejected: attachRequestErrorContext });
  return client;
}

// createRequestClient 创建后台请求客户端，并统一挂载登录态、安全头与登录 MFA 处理逻辑。
export function createRequestClient(
  baseURL: string,
  options?: RequestClientOptions,
) {
  const client = new AppRequestClient({
    ...options,
    baseURL,
  });
  // plainRequestPayloads 仅在内存中关联 Axios 请求对象，避免密码/MFA 明文进入错误上下文。
  const plainRequestPayloads = new WeakMap<object, PlainRequestPayload>();

  /**
   * 重新认证逻辑
   */
  async function doReAuthenticate(
    requestConfig?: AppRequestClientConfig,
    tokenOverride = '',
  ) {
    const sessionVersion =
      requestConfig?.__sessionStateVersion ?? currentSessionStateVersion();
    const sourceToken =
      tokenOverride ||
      requestAccessToken(requestConfig) ||
      String(useAccessStore().accessToken || '');
    if (reauthRedirectingVersion === sessionVersion) {
      return;
    }
    reauthRedirectingVersion = sessionVersion;
    try {
      await runSessionTransitionIf(
        () =>
          sessionVersion === currentSessionStateVersion() &&
          sourceToken === String(useAccessStore().accessToken || ''),
        async () => {
          const accessStore = useAccessStore();
          const useModal =
            preferences.app.loginExpiredMode === 'modal' &&
            accessStore.isAccessChecked;
          const currentPath = router.currentRoute.value.fullPath;
          destroyAllMfaOverlayDialogs();
          resetAllStores();
          resetSessionAccessState(router);
          accessStore.setAccessToken(null);
          accessStore.setLoginExpired(useModal);
          if (!useModal) {
            await router.replace({
              path: LOGIN_PATH,
              query:
                currentPath && currentPath !== LOGIN_PATH
                  ? { redirect: encodeURIComponent(currentPath) }
                  : {},
            });
          }
        },
      );
    } finally {
      if (reauthRedirectingVersion === sessionVersion) {
        reauthRedirectingVersion = null;
      }
    }
  }

  // normalizeApiPath 把绝对地址和带查询参数的 URL 统一归一成小写 API 路径。
  function normalizeApiPath(url?: string) {
    const rawUrl = String(url ?? '');
    return (rawUrl.split('?')[0] ?? '')
      .replace(/^https?:\/\/[^/]+/i, '')
      .replace(/^\/api(?=\/)/, '')
      .toLowerCase();
  }

  // notifyAccessForbiddenSync 通知布局层低频刷新权限态；请求层只发事件，避免和 API 客户端形成循环依赖。
  function notifyAccessForbiddenSync(config?: Record<string, any>) {
    if (typeof window === 'undefined') {
      return;
    }
    const accessStore = useAccessStore();
    if (!accessStore.accessToken) {
      return;
    }
    const apiPath = normalizeApiPath(String(config?.url || ''));
    if (ACCESS_SYNC_SKIP_URLS.has(apiPath)) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent(ACCESS_SYNC_FORBIDDEN_EVENT, {
        detail: { path: apiPath },
      }),
    );
  }

  // promptPasswordResetRequired 统一提示“必须先修改登录密码”，并做短时间去重。
  function promptPasswordResetRequired() {
    const now = Date.now();
    if (now - lastPasswordResetPromptAt < 1500) {
      return;
    }
    lastPasswordResetPromptAt = now;
    message.warning($t('business.message.passwordChangeRequiredGoProfile'));
  }

  // syncPasswordResetFlag 把必须改密状态同步回 userStore，便于路由守卫和个人中心页面复用同一份状态。
  function syncPasswordResetFlag(user?: UserInfoPatch) {
    const userStore = useUserStore();
    if (!userStore.userInfo && !user) {
      return;
    }
    userStore.setUserInfo(
      toUserStoreInfo(
        {
          ...user,
          needResetPassword: 1,
        },
        userStore.userInfo,
      ),
    );
  }

  // toUserStoreInfo 合并后端用户资料并补齐 vben 用户仓库需要的基础字段。
  function toUserStoreInfo(
    user: UserInfoPatch,
    currentUserInfo: null | UserStoreInfo,
  ): UserStoreInfo {
    const merged = {
      ...currentUserInfo,
      ...user,
    };
    return {
      ...merged,
      avatar: String(merged.avatar || preferences.app.defaultAvatar || ''),
      realName: String(merged.realName || ''),
      roles: Array.isArray(merged.roles) ? merged.roles.map(String) : [],
      userId: String(merged.userId || merged.id || ''),
      username: String(merged.username || ''),
    };
  }

  // redirectToPasswordResetPage 统一处理“必须先修改登录密码”的前端提示与跳转。
  async function redirectToPasswordResetPage(
    user: undefined | UserInfoPatch,
    requestConfig: AppRequestClientConfig,
  ) {
    const sessionVersion =
      requestConfig.__sessionStateVersion ?? currentSessionStateVersion();
    let ownsRedirect = false;
    try {
      await runSessionStateMutation(async () => {
        if (isStaleSessionRequest(requestConfig)) {
          return;
        }
        const accessStore = useAccessStore();
        syncPasswordResetFlag(user);
        promptPasswordResetRequired();
        if (
          !accessStore.isAccessChecked ||
          passwordResetRedirectingVersion === sessionVersion ||
          router.currentRoute.value.name === 'SystemProfile'
        ) {
          return;
        }
        passwordResetRedirectingVersion = sessionVersion;
        ownsRedirect = true;
        accessStore.setLoginExpired(false);
        try {
          await router.push({
            name: 'SystemProfile',
            query: { forceChangePassword: '1' },
          });
        } catch {
          if (isStaleSessionRequest(requestConfig)) {
            return;
          }
          await router.push({
            path: '/profile-manage/index',
            query: { forceChangePassword: '1' },
          });
        }
      });
    } finally {
      if (ownsRedirect && passwordResetRedirectingVersion === sessionVersion) {
        passwordResetRedirectingVersion = null;
      }
    }
  }

  // shouldSkipLoginMfaHandler 判断当前请求是否应跳过登录 MFA 全局拦截。
  function shouldSkipLoginMfaHandler(config?: AppRequestClientConfig) {
    if (!config) {
      return true;
    }
    if (config.skipLoginMfaHandler) {
      return true;
    }
    return LOGIN_MFA_SKIP_URLS.has(normalizeApiPath(String(config.url || '')));
  }

  // markSkipGlobalMessage 给错误对象打标，避免再被全局错误提示重复弹出。
  function markSkipGlobalMessage(error: any) {
    if (error && typeof error === 'object') {
      error.__skipGlobalErrorMessage = true;
      return error;
    }
    return {
      __skipGlobalErrorMessage: true,
      message: String(error || ''),
    };
  }

  // snapshotPlainRequestPayload 只在首次发送前保存明文参数，避免 Axios 序列化或安全拦截器覆盖重试来源。
  function snapshotPlainRequestPayload(config: AppRequestClientConfig) {
    if (plainRequestPayloads.has(config)) {
      return;
    }
    plainRequestPayloads.set(config, {
      data: snapshotRequestValue(config.data),
      params: snapshotRequestValue(config.params),
    });
  }

  // snapshotRequestValue 浅复制普通容器；Blob、FormData 等浏览器原生请求体保持原引用以支持重放。
  function snapshotRequestValue(value: any) {
    if (Array.isArray(value)) {
      return [...value];
    }
    if (Object.prototype.toString.call(value) === '[object Object]') {
      return { ...value };
    }
    return value;
  }

  // restorePlainRequestConfig 恢复首次明文参数，并清掉旧请求安全头，让重试生成新的 trace、签名和密文。
  function restorePlainRequestConfig(config: AppRequestClientConfig) {
    const plainPayload = plainRequestPayloads.get(config);
    if (!plainPayload) {
      return { ...config };
    }
    const headers = { ...config.headers } as Record<string, any>;
    for (const headerName of [
      TRACE_ID_HEADER,
      TRACEPARENT_HEADER,
      'X-App-Id',
      'X-Cipher',
      'X-Crypto',
      'X-Signature',
      'X-Timestamp',
    ]) {
      deleteRequestHeader(headers, headerName);
    }
    return {
      ...config,
      data: snapshotRequestValue(plainPayload.data),
      headers,
      params: snapshotRequestValue(plainPayload.params),
    };
  }

  // deleteRequestHeader 对展开后的请求头执行大小写无关删除。
  function deleteRequestHeader(
    headers: Record<string, any>,
    headerName: string,
  ) {
    const normalizedName = headerName.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === normalizedName) {
        Reflect.deleteProperty(headers, key);
      }
    }
  }

  // isLoginMfaSessionCurrent 判断 MFA 异步分支是否仍属于发起时会话。
  function isLoginMfaSessionCurrent(sourceToken: string) {
    return String(useAccessStore().accessToken || '') === sourceToken;
  }

  // assertLoginMfaSessionCurrent 阻止旧会话 MFA 结果继续回写或重放请求。
  function assertLoginMfaSessionCurrent(sourceToken: string) {
    if (!isLoginMfaSessionCurrent(sourceToken)) {
      throw new Error(ACCESS_TOKEN_SESSION_CHANGED);
    }
  }

  // currentLoginMfaUser 读取当前用户资料中的登录 MFA 上下文。
  function currentLoginMfaUser(sourceToken: string) {
    assertLoginMfaSessionCurrent(sourceToken);
    return (useUserStore().userInfo || {}) as LoginMfaUserContext;
  }

  // setLoginMfaUser 合并并回写登录 MFA 过程中拿到的最新用户资料。
  function setLoginMfaUser(user: UserInfoPatch, sourceToken: string) {
    assertLoginMfaSessionCurrent(sourceToken);
    const userStore = useUserStore();
    const currentUserInfo = userStore.userInfo;
    let nextRoles: string[] = [];
    if (Array.isArray(user.roles)) {
      nextRoles = user.roles;
    } else if (Array.isArray(currentUserInfo?.roles)) {
      nextRoles = currentUserInfo.roles;
    }
    const nextUserInfo = toUserStoreInfo(
      {
        ...user,
        id: Number(user.id || currentUserInfo?.id || 0) || undefined,
        roles: nextRoles,
      },
      currentUserInfo,
    );
    userStore.setUserInfo(nextUserInfo);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(LOGIN_MFA_USER_UPDATED_EVENT, {
          detail: nextUserInfo,
        }),
      );
    }
  }

  // refreshUserInfoAfterLoginMfa 在登录 MFA 完成后刷新一次登录后资料，保证前端缓存同步最新状态。
  async function refreshUserInfoAfterLoginMfa(sourceToken: string) {
    try {
      const userInfo = await client.get('/auth/profile', {
        ...createSessionBoundRequestConfig(sourceToken),
        skipGlobalErrorMessage: true,
        skipLoginMfaHandler: true,
      });
      if (
        isLoginMfaSessionCurrent(sourceToken) &&
        userInfo &&
        typeof userInfo === 'object'
      ) {
        setLoginMfaUser(userInfo as UserInfoPatch, sourceToken);
      }
    } catch {
      // 登录 MFA 完成后刷新资料失败时，不阻断原请求重试。
    }
  }

  // openLoginMfaDialog 打开登录 MFA 弹窗，并在需要时完成“校验 + 绑定启用”两段式流程。
  async function openLoginMfaDialog(
    user: LoginMfaUserContext,
    sourceToken: string,
  ) {
    assertLoginMfaSessionCurrent(sourceToken);
    const sessionRequestConfig = () => ({
      ...createSessionBoundRequestConfig(sourceToken),
      skipGlobalErrorMessage: true,
      skipLoginMfaHandler: true,
    });
    // mfaStatus 表示当前用户是否已正式启用 MFA。
    const mfaStatus = Number(user?.mfaStatus || 0);
    // buildMfaUrl 表示当前登录上下文下发的 MFA 绑定二维码地址。
    let buildMfaUrl = String(user?.buildMFAURL || '').trim();
    // mfaBindRequired 表示后端是否要求本次登录先完成绑定。
    const mfaBindRequired = Boolean(user?.mfaBindRequired);
    // forceMfaEnabled 表示系统是否开启“必须启用 MFA”策略。
    const forceMfaEnabled = Boolean(user?.forceMFAEnabled);
    // existMfa 表示当前账号是否仍然存在可用的已绑定设备。
    const existMfa = Boolean(user?.existMFA);
    // needBind 表示当前登录是否处于“必须先绑定后继续”的流程。
    const needBind = mfaBindRequired || (forceMfaEnabled && mfaStatus !== 1);
    // hasUserContext 表示当前登录态是否具备完成登录 MFA 的最小上下文。
    const hasUserContext =
      mfaStatus === 1 || needBind || Boolean(user?.username);

    if (!hasUserContext) {
      message.error($t('business.message.mfaVerifyContextMissing'));
      throw new Error(LOGIN_MFA_CANCELLED);
    }

    if (mfaStatus === 1 && !existMfa && !needBind) {
      message.error($t('business.message.mfaDeviceUnavailable'));
      throw new Error(LOGIN_MFA_CANCELLED);
    }
    if (needBind && !buildMfaUrl) {
      try {
        const resp = await client.post<SystemProfileApi.RefreshMfaSecretResp>(
          '/profile/mfa-secret/refresh',
          {},
          sessionRequestConfig(),
        );
        assertLoginMfaSessionCurrent(sourceToken);
        const refreshed = String(resp?.buildMFAURL || '').trim();
        if (refreshed) {
          buildMfaUrl = refreshed;
          setLoginMfaUser(
            {
              buildMFAURL: refreshed,
              existMFA: false,
              mfaBindRequired: true,
              mfaStatus: 0,
            },
            sourceToken,
          );
        }
      } catch {
        // ignore
      }
      assertLoginMfaSessionCurrent(sourceToken);
    }
    if (needBind && !buildMfaUrl) {
      message.error($t('business.message.mfaBindingContextMissing'));
      throw new Error(LOGIN_MFA_CANCELLED);
    }
    let headerDescription = $t('business.message.mfaLoginVerifyDescription');
    let headerMessage = $t('business.message.mfaLoginVerifyTitle');
    if (needBind) {
      headerDescription = forceMfaEnabled
        ? $t('business.message.mfaLoginBindForcedDescription', [
            getMfaMicrosoftScanTip(),
          ])
        : $t('business.message.mfaLoginBindDescription', [
            getMfaMicrosoftScanTip(),
          ]);
      headerMessage = forceMfaEnabled
        ? $t('business.message.mfaLoginBindForcedTitle')
        : $t('business.message.mfaLoginBindTitle');
    }
    const dialog = createMfaOverlayDialog({
      accountName: user.username,
      buildMfaUrl: needBind ? buildMfaUrl : '',
      cancelErrorMessage: LOGIN_MFA_CANCELLED,
      headerDescription,
      headerMessage,
      okText: $t('business.message.mfaVerifyButton'),
      onSubmit: async ({ buildMfaUrl: currentBuildMfaUrl, secure }) => {
        assertLoginMfaSessionCurrent(sourceToken);
        const loginCheckResp = await client.post<AuthApi.CheckMfaResult>(
          '/profile/check-mfa',
          {
            mfaSecureKey: needBind
              ? extractMfaSecret(currentBuildMfaUrl) || undefined
              : undefined,
            scenarios: 0,
            secure,
          },
          sessionRequestConfig(),
        );
        assertLoginMfaSessionCurrent(sourceToken);

        if (!loginCheckResp?.isOk) {
          throw new Error($t('business.message.mfaCodeInvalid'));
        }

        if (needBind) {
          const mfaSecureKey =
            extractMfaSecret(currentBuildMfaUrl) || undefined;
          const enableCheckResp = await client.post<AuthApi.CheckMfaResult>(
            '/profile/check-mfa',
            {
              mfaSecureKey,
              scenarios: 2,
              secure,
            },
            sessionRequestConfig(),
          );
          assertLoginMfaSessionCurrent(sourceToken);

          if (!enableCheckResp?.isOk || !enableCheckResp?.twoStep) {
            throw new Error($t('business.message.mfaEnableCheckFailed'));
          }

          await client.patch(
            '/profile/mfa-status',
            {
              mfaSecureKey,
              mfaStatus: 1,
              twoStepKey: enableCheckResp.twoStep?.key,
              twoStepValue: enableCheckResp.twoStep?.value,
            },
            sessionRequestConfig(),
          );
          assertLoginMfaSessionCurrent(sourceToken);

          setLoginMfaUser(
            {
              buildMFAURL: '',
              existMFA: true,
              mfaStatus: 1,
              mfaBindRequired: false,
            },
            sourceToken,
          );
        }
      },
      submitErrorMessage: needBind
        ? $t('business.message.mfaBindCheckFailed')
        : $t('business.message.mfaCodeInvalid'),
      title: $t('business.message.mfaAuthTitle'),
    });
    await dialog.promise;
    assertLoginMfaSessionCurrent(sourceToken);
  }

  // ensureLoginMfaVerified 保证同一时刻只存在一个登录 MFA 校验流程。
  async function ensureLoginMfaVerified(
    sourceToken: string,
    bindRequired = false,
  ) {
    if (loginMfaVerifying?.sourceToken === sourceToken) {
      return loginMfaVerifying.promise;
    }

    const task: NonNullable<typeof loginMfaVerifying> = {
      promise: (async () => {
        const currentUser = currentLoginMfaUser(sourceToken);
        const user = bindRequired
          ? {
              ...currentUser,
              existMFA: false,
              mfaBindRequired: true,
              mfaStatus: 0,
            }
          : currentUser;
        await openLoginMfaDialog(user, sourceToken);
        assertLoginMfaSessionCurrent(sourceToken);
        await refreshUserInfoAfterLoginMfa(sourceToken);
        assertLoginMfaSessionCurrent(sourceToken);
      })().finally(() => {
        if (loginMfaVerifying === task) {
          loginMfaVerifying = null;
        }
      }),
      sourceToken,
    };
    loginMfaVerifying = task;

    return task.promise;
  }

  // 请求头处理
  client.addRequestInterceptor({
    fulfilled: async (config: AppRequestClientConfig) => {
      snapshotPlainRequestPayload(config);
      if (
        config.__sessionStateVersion !== undefined &&
        config.__sessionStateVersion !== currentSessionStateVersion()
      ) {
        throw markSkipGlobalMessage(new Error(ACCESS_TOKEN_SESSION_CHANGED));
      }
      const sourceToken = String(useAccessStore().accessToken || '');
      let requestToken =
        config.__accessTokenOverride === undefined
          ? sourceToken
          : String(config.__accessTokenOverride || '');
      if (requestToken !== sourceToken) {
        throw markSkipGlobalMessage(new Error(ACCESS_TOKEN_SESSION_CHANGED));
      }
      if (!config.skipAccessTokenRefresh) {
        try {
          requestToken = await renewAccessTokenIfNeeded(sourceToken);
        } catch (error: any) {
          if (
            error?.message === ACCESS_TOKEN_SESSION_CHANGED ||
            String(useAccessStore().accessToken || '') !== sourceToken
          ) {
            throw markSkipGlobalMessage(
              new Error(ACCESS_TOKEN_SESSION_CHANGED),
            );
          }
          const httpStatus = Number(
            error?.httpStatus || error?.response?.status || 0,
          );
          const businessCode = Number(
            error?.code || error?.response?.data?.code || 0,
          );
          if (shouldReAuthenticateAfterError(httpStatus, businessCode)) {
            await doReAuthenticate(config, sourceToken);
            throw markSkipGlobalMessage(
              new Error('ACCESS_TOKEN_REFRESH_UNAUTHORIZED'),
            );
          }
          throw error;
        }
      }
      if (String(useAccessStore().accessToken || '') !== requestToken) {
        throw markSkipGlobalMessage(new Error(ACCESS_TOKEN_SESSION_CHANGED));
      }
      return attachRequestHeaders(config, requestToken);
    },
  });

  // 响应返回后，先做敏感字段解密和响应验签，再交给通用响应拆包逻辑处理。
  client.addResponseInterceptor({
    fulfilled: async (response) => handleAdminSecurityResponse(response),
  });

  // 已切换账号的成功响应不得再交给页面回写组件、通知或全局仓库。
  client.addResponseInterceptor({
    fulfilled: (response) => {
      if (
        isStaleSessionIdentityRequest(
          response?.config as AppRequestClientConfig | undefined,
        )
      ) {
        throw markSkipGlobalMessage(new Error(SESSION_STATE_CHANGED));
      }
      return response;
    },
  });

  // 用户资料接口若明确返回 needResetPassword=1，则前端立即提示并跳转个人中心改密。
  client.addResponseInterceptor({
    fulfilled: async (response) => {
      const apiPath = normalizeApiPath(String(response?.config?.url || ''));
      const payload = response?.data?.data;
      const requestConfig = response?.config as AppRequestClientConfig;
      if (
        PASSWORD_RESET_PROFILE_URLS.has(apiPath) &&
        requestAccessToken(requestConfig) &&
        !requestConfig.skipPasswordResetHandler &&
        !isStaleSessionRequest(requestConfig) &&
        Number(payload?.needResetPassword || 0) === 1
      ) {
        await redirectToPasswordResetPage(payload, requestConfig);
      }
      return response;
    },
  });

  // 处理返回的响应数据格式
  client.addResponseInterceptor(
    defaultResponseInterceptor({
      // 后端返回格式: { status: true, code: 1, message: '成功', data: {...} }
      // 使用 `status` 字段作为成功标识，successCode 为 true
      codeField: 'status',
      dataField: 'data',
      successCode: (v: any) => v === true,
    }),
  );

  // 后端部分接口虽然 HTTP 仍返回 200，但业务体会返回 code=401，这里统一视为未授权处理。
  client.addResponseInterceptor({
    rejected: async (error) => {
      const response = error?.response;
      const httpStatus = response?.status;
      const businessCode = Number(response?.data?.code ?? 0);
      const requestConfig = (error?.config ||
        response?.config ||
        {}) as AppRequestClientConfig;
      if (
        shouldSyncAccessAfterError(httpStatus, businessCode) &&
        !isStaleSessionRequest(requestConfig)
      ) {
        notifyAccessForbiddenSync(requestConfig);
      }
      if (
        httpStatus !== 401 &&
        shouldReAuthenticateAfterError(httpStatus, businessCode) &&
        requestAccessToken(requestConfig) &&
        !requestConfig.skipReAuthenticate &&
        !isStaleSessionRequest(requestConfig)
      ) {
        await doReAuthenticate(requestConfig);
      }
      throw error;
    },
  });

  // 登录后若后端返回 code=5/6，自动拉起 MFA 绑定或认证流程，成功后重放原请求。
  client.addResponseInterceptor({
    rejected: async (error) => {
      const response = error?.response;
      const businessCode = Number(response?.data?.code ?? 0);
      const requestConfig = (error?.config ||
        response?.config ||
        {}) as AppRequestClientConfig;

      if (
        businessCode !== LOGIN_MFA_REQUIRED_CODE &&
        businessCode !== LOGIN_MFA_BIND_REQUIRED_CODE
      ) {
        throw error;
      }
      if (
        shouldSkipLoginMfaHandler(requestConfig) ||
        requestConfig.__loginMfaRetried ||
        isStaleSessionRequest(requestConfig)
      ) {
        throw error;
      }
      const sourceToken = requestAccessToken(requestConfig);
      if (!sourceToken) {
        throw error;
      }

      try {
        await ensureLoginMfaVerified(
          sourceToken,
          businessCode === LOGIN_MFA_BIND_REQUIRED_CODE,
        );
      } catch (mfaError) {
        throw markSkipGlobalMessage(mfaError);
      }

      const retryUrl = requestConfig.url;
      if (!retryUrl) {
        throw error;
      }
      assertLoginMfaSessionCurrent(sourceToken);
      return client.request(retryUrl, {
        ...restorePlainRequestConfig(requestConfig),
        ...createSessionBoundRequestConfig(sourceToken),
        __loginMfaRetried: true,
      });
    },
  });

  // 业务码 7 表示当前账号必须先修改登录密码；统一提示并跳转个人中心，避免各页面各自处理。
  client.addResponseInterceptor({
    rejected: async (error) => {
      const response = error?.response;
      const businessCode = Number(response?.data?.code ?? 0);
      const requestConfig = (error?.config ||
        response?.config ||
        {}) as AppRequestClientConfig;
      if (
        businessCode !== PASSWORD_RESET_REQUIRED_CODE ||
        !requestAccessToken(requestConfig) ||
        requestConfig.skipPasswordResetHandler ||
        isStaleSessionRequest(requestConfig)
      ) {
        throw error;
      }
      await redirectToPasswordResetPage(response?.data?.data, requestConfig);
      throw markSkipGlobalMessage(error);
    },
  });

  // 敏感操作在窗口内若票据缺失或刚好过期，会返回业务码 8；
  // 这类错误由页面侧的 submitWithMfaRetry/requestMfaTwoStep 负责接管并直接拉起 MFA 弹窗，
  // 这里不要再走通用错误提示，避免用户先看到一条红色报错再弹窗。
  client.addResponseInterceptor({
    rejected: async (error) => {
      const response = error?.response;
      const businessCode = Number(response?.data?.code ?? 0);
      if (businessCode === MFA_CHECK_AGAIN_CODE) {
        throw markSkipGlobalMessage(error);
      }
      throw error;
    },
  });

  // token过期的处理
  client.addResponseInterceptor(
    appAuthenticateResponseInterceptor({
      doReAuthenticate,
    }),
  );

  // 通用的错误处理,如果没有进入上面的错误处理逻辑，就会进入这里
  client.addResponseInterceptor(
    errorMessageResponseInterceptor((msg: string, error) => {
      if (
        error?.__skipGlobalErrorMessage ||
        error?.config?.skipGlobalErrorMessage ||
        error?.response?.config?.skipGlobalErrorMessage ||
        isStaleSessionRequest(
          (error?.config || error?.response?.config) as AppRequestClientConfig,
        )
      ) {
        return;
      }
      if (!error?.response && error?.message) {
        message.error(error.message);
        return;
      }
      const responseData = error?.response?.data ?? {};
      const respCode = responseData?.code ?? '';
      const respMessage = responseData?.message ?? responseData?.error ?? '';
      const traceId = extractResponseTraceId(error);

      // 拼接 code 与 message
      let errorMessage = '';
      if (respCode && respMessage) {
        errorMessage = `code: ${respCode} ${respMessage}`;
      } else if (respMessage) {
        errorMessage = respMessage;
      } else if (respCode) {
        errorMessage = `code: ${respCode}`;
      }

      // 如果没有任何后端错误信息，则使用通用 msg
      message.error(formatTraceErrorMessage(errorMessage || msg, traceId));
    }),
  );

  // 最后补齐错误上下文；核心 RequestClient 随后只负责按官方行为拆出 response.data。
  client.addResponseInterceptor({ rejected: attachRequestErrorContext });

  return client;
}

export const requestClient = createRequestClient(apiURL, {
  responseReturn: 'data',
});

export const baseRequestClient = createBaseRequestClient(apiURL, {
  responseReturn: 'data',
});
