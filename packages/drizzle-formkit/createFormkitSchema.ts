import { getTableColumns } from 'drizzle-orm';

import type { Column, Table } from 'drizzle-orm';
import type { FormKitSchemaDefinition, FormKitSchemaNode } from '@formkit/core';

interface CreateFormKitSchemaOptions {
  useForm?: boolean
  primaryKey?: boolean | 'readonly'
  exclude?: string[]
  include?: Array<FormKitSchemaNode>
  overrides?: Array<{
    column: string
    schema: FormKitSchemaNode
  }>
}

const COLUMN_TYPE_TO_FORMKIT_EL: Record<string, string> = {
  // numeric
  int: 'number',
  integer: 'number',
  bigint: 'number',
  tinyint: 'number',
  smallint: 'number',
  mediumint: 'number',
  float: 'number',
  decimal: 'number',
  double: 'number',
  doublePrecision: 'number',
  real: 'number',
  numeric: 'number',
  serial: 'number',
  bigserial: 'number',
  smallserial: 'number',

  // string
  char: 'text',
  text: 'textarea',
  varchar: 'text',

  // boolean
  boolean: 'checkbox',

  // date & time
  date: 'date',
  time: 'time',
  year: 'number',
  datetime: 'datetime-local',
  timestamp: 'datetime-local',

  // other
  blob: 'file',
  binary: 'text',
  enum: 'text',
  json: 'textarea',
  jsonb: 'textarea',
  interval: 'text',
  varbinary: 'text',
};

function mapColumnToSchema(column: Column): FormKitSchemaNode {
  let formkitEl = COLUMN_TYPE_TO_FORMKIT_EL[column.dataType];

  if (formkitEl === undefined) {
    console.warn(`No formkit element found for column type: ${column.dataType}`);
    formkitEl = 'text';
  }

  return {
    $formkit: formkitEl,
    label: column.name,
    name: column.name,
    validation: column.notNull ? 'required' : undefined,
  };
}

// TODO: handle primary key and foreign key
// TODO: handle column constraints and default values
// TODO: handle custom styles

export function createFormKitSchema<T extends Table>(
  table: T,
  options?: CreateFormKitSchemaOptions,
) {
  const useForm = options?.useForm ?? false;
  const _primaryKey = options?.primaryKey ?? false;

  const columns = getTableColumns(table);
  const columnEntries = Object.entries(columns);

  // if (!primaryKey) {
  //   const primaryKeys = []
  //   columnEntries.forEach(([columnName, column]) => {
  //     if (column.primaryKey)

  if (columnEntries.length === 0)
    throw new Error(`Table ${table._.name} has no columns`);

  if (options?.exclude)
    columnEntries.filter(([columnName]) => !options.exclude?.includes(columnName));

  const schema = columnEntries.map(([_columnName, column]) => mapColumnToSchema(column));

  if (options?.include)
    schema.push(...options.include);

  // if (options?.overrides) {
  //   for (const { column, schema: override } of options.overrides) {
  //     const index = schema.findIndex(({ name }) => name === column);

  //     if (index === -1)
  //       throw new Error(`Column ${column} not found in table ${table}`);

  //     schema[index] = override;
  //   }
  // }

  if (useForm) {
    return {
      $formkit: 'form',
      children: schema,
    } as FormKitSchemaDefinition;
  }

  return schema as FormKitSchemaDefinition;
}
