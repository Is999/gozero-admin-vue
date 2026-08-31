import type { Plugin } from 'vite';

import type { DefineApplicationOptions } from '@vben/vite-config';

import { readFileSync } from 'node:fs';
import process from 'node:process';

import { defineConfig } from '@vben/vite-config';

import { loadEnv } from 'vite';

import { assertProductionSecurityEnv } from './security-env';

// 本地联调默认直连当前 admin API 端口。
const DEFAULT_PROXY_TARGET = 'http://127.0.0.1:8899';

// resolveAppEnv 读取当前 mode 的应用环境配置。
function resolveAppEnv(mode: string) {
  return loadEnv(mode || 'development', process.cwd(), 'VITE_');
}

// resolveProxyTarget 优先使用进程环境变量，其次读取当前 mode 的 .env*。
function resolveProxyTarget(env: Record<string, string>) {
  return (
    String(
      process.env.VITE_PROXY_TARGET ||
        env.VITE_PROXY_TARGET ||
        DEFAULT_PROXY_TARGET,
    ).trim() || DEFAULT_PROXY_TARGET
  );
}

// resolveAppTitle 复用应用环境中的标题，避免在构建核心重复维护品牌名。
function resolveAppTitle(env: Record<string, string>) {
  return String(
    process.env.VITE_APP_TITLE || env.VITE_APP_TITLE || 'Admin',
  ).trim();
}

// createManualChunks 定义当前应用的大依赖分包，不污染通用 Vite 配置。
function createManualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) {
    return undefined;
  }

  if (id.includes('ant-design-vue') || id.includes('@ant-design/icons-vue')) {
    return 'vendor-antd';
  }

  if (id.includes('vxe-table') || id.includes('xe-utils')) {
    return 'vendor-vxe';
  }

  return undefined;
}

// appPackage 提供构建产物声明所需的当前应用版本。
const appPackage = JSON.parse(
  readFileSync(new URL('package.json', import.meta.url), 'utf8'),
) as { version?: string };

// createAdminLicensePlugin 仅为当前应用入口注入品牌声明。
function createAdminLicensePlugin(): Plugin {
  const banner = [
    '/*!',
    ' * Admin',
    ` * Version: ${appPackage.version ?? ''}`,
    ' * Author: admin',
    ` * Copyright (C) ${new Date().getUTCFullYear()} Admin`,
    ' * License: MIT License',
    ' */',
  ].join('\n');

  return {
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      handler(_options, bundle) {
        for (const file of Object.values(bundle)) {
          if (file.type === 'chunk' && file.isEntry) {
            file.code = `${banner}\n${file.code}`;
          }
        }
      },
      order: 'post',
    },
    name: 'admin:license',
  };
}

const appConfig: DefineApplicationOptions = async (config) => {
  const mode = config?.mode || 'development';
  const env = resolveAppEnv(mode);
  assertProductionSecurityEnv(mode, env);
  const appTitle = resolveAppTitle(env);
  const displayTitle = `${appTitle}${mode === 'development' ? ' dev' : ''}`;
  const proxyTarget = resolveProxyTarget(env);

  return {
    application: {
      archiver: false,
      license: false,
      nitroMock: false,
      printInfoMap: {
        'Admin API Docs': '/api/docs#/',
      },
      pwaOptions: {
        manifest: {
          description:
            'Admin is a production operations console based on Vue 3.',
          icons: [
            {
              sizes: 'any',
              src: '/favicon.svg',
              type: 'image/svg+xml',
            },
          ],
          name: displayTitle,
          short_name: displayTitle,
        },
      },
    },
    vite: {
      build: {
        rolldownOptions: {
          output: {
            manualChunks: createManualChunks,
          },
        },
      },
      plugins: [createAdminLicensePlugin()],
      server: {
        // 本机管理后台可代理回环 API，禁止默认发布到局域网后形成未授权转发入口。
        host: '127.0.0.1',
        proxy: {
          '/api': {
            changeOrigin: true,
            target: proxyTarget,
            ws: true,
          },
          '/docs': {
            changeOrigin: true,
            target: proxyTarget,
          },
        },
      },
    },
  };
};

export default defineConfig(appConfig);
