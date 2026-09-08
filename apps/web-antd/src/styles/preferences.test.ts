import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Happy DOM 不加载相对路径的样式导入，测试中展开主题文件以保留完整样式。
const preferencesCss = readFileSync(
  resolve(process.cwd(), 'apps/web-antd/src/styles/preferences.css'),
  'utf8',
).replace(
  "@import './theme.css';",
  readFileSync(
    resolve(process.cwd(), 'apps/web-antd/src/styles/theme.css'),
    'utf8',
  ),
);

function createTabs(preferencesDrawer = true) {
  const dialog = document.createElement('section');
  dialog.setAttribute('role', 'dialog');
  dialog.classList.add('sm:max-w-sm');
  if (preferencesDrawer) {
    dialog.classList.add('border-0!');
  }

  const tabs = document.createElement('div');
  tabs.setAttribute('role', 'tablist');

  const indicator = document.createElement('div');
  indicator.style.setProperty('--reka-tabs-indicator-size', '112px');
  indicator.style.width = '20%';
  tabs.append(indicator);

  for (const label of [
    'Appearance',
    'Layout',
    'Shortcut Keys',
    'General',
    'Antd Extension',
  ]) {
    const tab = document.createElement('button');
    tab.setAttribute('role', 'tab');
    tab.textContent = label;
    tabs.append(tab);
  }

  dialog.append(tabs);
  document.body.append(dialog);

  return { indicator, tabs };
}

function createHeader() {
  const dialog = document.createElement('section');
  dialog.setAttribute('role', 'dialog');
  dialog.classList.add('border-0!', 'sm:max-w-sm');

  const header = document.createElement('header');
  header.style.display = 'flex';
  const titleGroup = document.createElement('div');
  titleGroup.style.display = 'flex';
  titleGroup.style.alignItems = 'center';
  const title = document.createElement('h2');
  title.textContent = 'Preferences';
  const description = document.createElement('p');
  description.textContent = 'Customize Preferences & Preview in Real Time';
  titleGroup.append(title, description);
  const actions = document.createElement('div');
  actions.textContent = 'Actions';
  header.append(titleGroup, actions);
  dialog.append(header);
  document.body.append(dialog);

  return { description, titleGroup };
}

describe('preferences drawer tabs layout', () => {
  beforeEach(() => {
    const style = document.createElement('style');
    style.dataset.testId = 'preferences-layout';
    style.textContent = `[role='tablist'] { display: grid; }\n${preferencesCss}`;
    document.head.append(style);
  });

  afterEach(() => {
    document.body.replaceChildren();
    document
      .querySelector('style[data-test-id="preferences-layout"]')
      ?.remove();
  });

  it('keeps long labels from shrinking and preserves the active indicator width', () => {
    const { indicator, tabs } = createTabs();
    const firstTab = tabs.querySelector<HTMLElement>('[role="tab"]');

    expect(getComputedStyle(tabs).display).toBe('flex');
    expect(preferencesCss).toContain('overflow: auto hidden;');
    expect(getComputedStyle(firstTab!).flexGrow).toBe('1');
    expect(getComputedStyle(firstTab!).flexShrink).toBe('0');
    expect(getComputedStyle(indicator).width).toBe('112px');
  });

  it('stacks the english title and description without squeezing header actions', () => {
    const { description, titleGroup } = createHeader();

    expect(getComputedStyle(titleGroup).flexDirection).toBe('column');
    expect(getComputedStyle(titleGroup).flexGrow).toBe('1');
    expect(Number.parseFloat(getComputedStyle(titleGroup).minWidth)).toBe(0);
    expect(getComputedStyle(description).maxWidth).toBe('100%');
    expect(getComputedStyle(description).overflowWrap).toBe('anywhere');
  });

  it('does not change another drawer with the same width', () => {
    const { tabs } = createTabs(false);

    expect(getComputedStyle(tabs).display).toBe('grid');
  });
});
