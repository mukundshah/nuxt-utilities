import { z } from 'zod';
import { getQuery, getRouterParam, readBody } from 'h3';
import { eq, getTableColumns, sql } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';

import type { H3Event } from 'h3';
import type { ZodObject } from 'zod';
import type { Column, SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgColumn, PgTableWithColumns } from 'drizzle-orm/pg-core';

type Database = PostgresJsDatabase;

type ColumnDescriptor<Table extends PgTableWithColumns<any>> = keyof Table['_']['columns'];

interface APIViewOptions<
  Table extends PgTableWithColumns<any>,
  ZDefault extends ZodObject<any>,
  ZList extends ZodObject<any> = ZDefault,
  ZCreate extends ZodObject<any> = ZDefault,
  ZRetrieve extends ZodObject<any> = ZDefault,
  ZUpdate extends ZodObject<any> = ZDefault,
> {
  model: Table
  db: Database
  request: H3Event
  primaryKey?: ColumnDescriptor<Table> | {
    retrieve?: ColumnDescriptor<Table>
    update?: ColumnDescriptor<Table>
    delete?: ColumnDescriptor<Table>
    default: ColumnDescriptor<Table>
  }
  schema?: {
    list?: ZList
    create?: ZCreate
    update?: ZUpdate
    retrieve?: ZRetrieve
  }
  pageSize?: number
  searchFields?: Array<ColumnDescriptor<Table>>
  filterFields?: Array<ColumnDescriptor<Table>>
  orderFields?: Array<ColumnDescriptor<Table>>
}

function getOrderBySQL<Table extends PgTableWithColumns<any>>(table: Table, ordering: Record<ColumnDescriptor<Table>, 'asc' | 'desc'>) {
  const sqlChunks: SQL[] = [];
  Object.keys(ordering).forEach((columnName) => {
    const column = table[columnName as ColumnDescriptor<Table>];
    const direction = ordering[columnName as ColumnDescriptor<Table>];
    sqlChunks.push(sql`${column} ${direction}`);
  });

  return sql.join(sqlChunks, sql`, `);
}

export function fieldsToColumns<
T extends PgTableWithColumns<any>,
Z extends ZodObject<any>,
>(model: T, schema: Z) {
  const attrs = Object.keys(schema.shape as Record<string, any>);

  const fields = attrs.reduce((acc, attr) => {
    acc[attr] = model[attr] as ReturnType<typeof model['attr']>;
    return acc;
  }, {} as Record<string, PgColumn>);

  return fields;
}

function getTablePrimaryKeys<T extends PgTableWithColumns<any>>(table: T) {
  const columns = getTableColumns(table) as Record<string, Column>;
  return Object.keys(columns).filter(columnName => columns[columnName].primary);
}

export function useAPIView<
Table extends PgTableWithColumns<any>,
ZDefault extends ZodObject<any>,
ZList extends ZodObject<any>,
ZCreate extends ZodObject<any>,
ZRetrieve extends ZodObject<any>,
ZUpdate extends ZodObject<any> ,
>(options: APIViewOptions<Table, ZDefault, ZList, ZCreate, ZRetrieve, ZUpdate>) {
  const {
    model,
    db,
    request,
    schema,
    primaryKey,
    pageSize,
    searchFields,
    filterFields,
    orderFields,
  } = options;

  const pk = getTablePrimaryKeys(model)[0] as ColumnDescriptor<Table>;

  const _primaryKey: Record<string, ColumnDescriptor<Table>> = {
    retrieve: typeof primaryKey === 'object' ? primaryKey.retrieve ?? primaryKey.default : primaryKey ?? pk,
    update: typeof primaryKey === 'object' ? primaryKey.update ?? primaryKey.default : primaryKey ?? pk,
    delete: typeof primaryKey === 'object' ? primaryKey.delete ?? primaryKey.default : primaryKey ?? pk,
  };

  {
    const undefinedKeys = Object.keys(_primaryKey).filter(key => _primaryKey[key] === undefined);
    if (undefinedKeys.length > 0)
      throw new Error(`primaryKey[${undefinedKeys.join('|')}] is undefined`);
  }

  const _schema = {
    list: schema?.list ?? createSelectSchema(model),
    retrieve: schema?.retrieve ?? createSelectSchema(model),
    create: schema?.create ?? createInsertSchema(model),
    update: schema?.update ?? createInsertSchema(model),
  };

  const _pageSize = pageSize ?? 25;

  // TODO: parse filters and ordering from request.query with zod

  async function list(
    schema: ZList = _schema.list as ZList,

  ) {
    const results = await db.select(fieldsToColumns(model, schema)).from(model);
    return z.array(schema).parse(results);
  }

  async function paginatedList(
    schema: ZList = _schema.list as ZList,
    pageSize: number = _pageSize,
  ) {
    const query = getQuery(request);
    const page = query.page as number ?? 1;

    let dbQuery = db.select({
      ...fieldsToColumns(model, schema),
      count: sql<number>`count(*) over()`.mapWith(Number),
    }).from(model);

    if (query.filters && filterFields) {
      // TODO: parse filters with zod
    }

    if (query.order && orderFields) {
      // TODO: parse order with zod
      const orderingSchema = z.record(
        z.string().refine(value => orderFields?.includes(value)),
        z.enum(['asc', 'desc']),
      );
      const ordering = orderingSchema.parse(query.ordering ?? {}) as Record<ColumnDescriptor<Table>, 'asc' | 'desc'>;
      const orderBySQL = getOrderBySQL(model, ordering);
      if (orderBySQL)
        dbQuery = dbQuery.orderBy(getOrderBySQL(model, ordering));
    }

    const results = await dbQuery.limit(pageSize).offset((page - 1) * pageSize);

    const count = results[0].count;

    return {
      page,
      pageSize,
      count,
      pageCount: Math.ceil(count / pageSize),
      results: z.array(schema).parse(results),
    };
  }

  async function create(schema: ZCreate = _schema.create as ZCreate) {
    const body = await readBody<z.infer<ZCreate>>(request);
    const values = schema.parse(body) as z.infer<ZCreate>;
    const result = await db.insert(model).values(values).returning();
    return schema.parse(result[0]) as z.infer<ZCreate>;
  }

  async function retrieve(
    primaryKey: ColumnDescriptor<Table> = _primaryKey.retrieve,
    schema: ZRetrieve = _schema.retrieve as ZRetrieve,
  ) {
    const pk = getRouterParam(request, primaryKey.toString());
    const results = await db.select(fieldsToColumns(model, schema)).from(model).where(eq(model[primaryKey], pk));
    return schema.parse(results[0]) as z.infer<ZRetrieve>;
  }

  async function update(
    primaryKey: ColumnDescriptor<Table> = _primaryKey.update,
    schema: ZUpdate = _schema.update as ZUpdate,
  ) {
    const pk = getRouterParam(request, primaryKey.toString());
    const body = await readBody<z.infer<ZCreate>>(request);
    const values = schema.parse(body) as z.infer<ZCreate>;
    const result = await db.update(model).set(values).where(eq(model[primaryKey], pk)).returning();
    return _schema.retrieve.parse(result[0]) as z.infer<ZRetrieve>;
  }

  async function destroy(primaryKey: ColumnDescriptor<Table> = _primaryKey.delete) {
    const pk = getRouterParam(request, primaryKey.toString());
    const deletedIds = await db.delete(model).where(eq(model[primaryKey], pk)).returning({ deletedId: model[primaryKey] });
    return deletedIds[0];
  }

  async function search() {
    // TODO: implement search
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve([]);
      }, 1000);
    },
    );
  }

  async function all() {
    // how to handle detail and list in one view?
    if (request.method === 'GET')
      return await list();
    if (request.method === 'POST')
      return create();
    if (request.method === 'PUT')
      return update();
    if (request.method === 'DELETE')
      return destroy();
  }

  return {
    list,
    paginatedList,
    create,
    retrieve,
    update,
    destroy,
    search,
    all,
  };
}
