// @vitest-environment happy-dom

import type { SystemRoleApi } from '#/api/system';

import { describe, expect, it } from 'vitest';

import { findDefaultParentRoleID, useColumns } from './data';

describe('role row access', () => {
  it('shows the role ID before the role name', () => {
    const columns = useColumns(() => undefined) as any[];

    expect(columns.slice(0, 2).map((column) => column.field)).toEqual([
      'id',
      'title',
    ]);
  });

  it('uses backend row flags and protects the super role', () => {
    const columns = useColumns(
      () => undefined,
      async () => true,
    ) as any[];
    const statusColumn = columns.find((item) => item.field === 'status');
    const operationColumn = columns.find((item) => item.field === 'operation');
    const options = operationColumn.cellRender.options as Array<any>;
    const manageableRow = {
      canCreateChild: true,
      id: 2,
      manageable: true,
    } as SystemRoleApi.Item;
    const outOfScopeRow = {
      canCreateChild: false,
      id: 3,
      manageable: false,
    } as SystemRoleApi.Item;
    const superRole = {
      canCreateChild: true,
      id: 1,
      manageable: true,
    } as SystemRoleApi.Item;

    expect(statusColumn.cellRender.attrs.disabled(manageableRow)).toBe(false);
    expect(statusColumn.cellRender.attrs.disabled(outOfScopeRow)).toBe(true);
    expect(statusColumn.cellRender.attrs.disabled(superRole)).toBe(true);
    expect(
      options.find((item) => item.code === 'addChild').visible(manageableRow),
    ).toBe(true);
    expect(
      options.find((item) => item.code === 'edit').visible(outOfScopeRow),
    ).toBe(false);
    expect(
      options.find((item) => item.code === 'delete').visible(superRole),
    ).toBe(false);
  });

  it('finds the first selectable parent inside disabled ancestors', () => {
    expect(
      findDefaultParentRoleID([
        {
          children: [
            {
              children: [],
              disabled: false,
              id: 3,
              selectable: true,
            },
          ],
          disabled: true,
          id: 1,
          selectable: false,
        },
      ]),
    ).toBe(3);
  });
});
