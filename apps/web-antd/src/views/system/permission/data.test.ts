// @vitest-environment happy-dom

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useColumns, useFormSchema } from './data';
import { useDocPermissionColumns } from './modules/doc-permission-data';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('permission form schema', () => {
  it('disables status in edit mode because status uses a dedicated endpoint', () => {
    const schema = useFormSchema([], true);
    expect(
      schema.find((item) => item.fieldName === 'status')?.componentProps,
    ).toMatchObject({ disabled: true });
  });
});

describe('permission list columns', () => {
  it('shows the record ID before the functional permission name', () => {
    const columns = useColumns(() => undefined) as any[];

    expect(columns.slice(0, 2).map((column) => column.field)).toEqual([
      'id',
      'title',
    ]);
  });

  it('shows the record ID before the document permission title', () => {
    const columns = useDocPermissionColumns(async () => true) as any[];

    expect(columns.slice(0, 2).map((column) => column.field)).toEqual([
      'id',
      'title',
    ]);
  });
});
