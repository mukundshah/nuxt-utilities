// TODO: Search, Filter, Error Handling, Auth/Permissions

import { z } from 'zod'
import { eventHandler, getQuery, getRouterParam, readBody } from 'h3'
import { eq, getTableColumns, sql } from 'drizzle-orm'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'

import type { EventHandler, H3Event, Router, RouterMethod } from 'h3'
import type { ZodObject } from 'zod'
import type { Column, SQL } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { PgColumn, PgTableWithColumns } from 'drizzle-orm/pg-core'

type APIViewHandler = 'list' | 'create' | 'retrieve' | 'update' | 'destroy' | 'search'
type APIViewHandlers = APIViewHandler[] | 'all'

type Database = PostgresJsDatabase

type ColumnDescriptor<Table extends PgTableWithColumns<any>> = keyof Table['_']['columns']

interface BaseOptions {
  event?: H3Event
}

interface PaginatedListOptions<ZList extends ZodObject<any>> extends BaseOptions {
  schema?: ZList
  pageSize?: number
  canPaginate?: 'auto' | boolean
}

interface CreateOptions<ZCreate extends ZodObject<any>> extends BaseOptions {
  schema?: ZCreate
}

interface RetrieveOptions<ZRetrieve extends ZodObject<any>, Table extends PgTableWithColumns<any>> extends BaseOptions {
  schema?: ZRetrieve
  primaryKey?: ColumnDescriptor<Table>
}

interface UpdateOptions<ZUpdate extends ZodObject<any>, Table extends PgTableWithColumns<any>> extends BaseOptions {
  schema?: ZUpdate
  primaryKey?: ColumnDescriptor<Table>
}

interface DestroyOptions<Table extends PgTableWithColumns<any>> extends BaseOptions {
  primaryKey?: ColumnDescriptor<Table>
}

interface SearchOptions extends BaseOptions {}

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
  event?: H3Event
  primaryKey?:
  | ColumnDescriptor<Table>
  | {
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
  handlers?: {
    [key in APIViewHandler]?: EventHandler;
  }
  actions?: {
    path?: string
    method?: RouterMethod | RouterMethod[]
    name: string
    handler: EventHandler
    detail?: boolean
  }[]
  pagination?: {
    pageSize?: number
    canPaginate?: 'auto' | boolean
  }
  searchFields?: Array<ColumnDescriptor<Table>>
  filterFields?: Array<ColumnDescriptor<Table>>
  orderFields?: Array<ColumnDescriptor<Table>>
  defaultOrdering?: string
}

function getOrderBySQL<Table extends PgTableWithColumns<any>>(
  table: Table,
  ordering: Record<ColumnDescriptor<Table>, 'asc' | 'desc'>,
) {
  const sqlChunks: SQL[] = []
  Object.keys(ordering).forEach((columnName) => {
    const column = table[columnName as ColumnDescriptor<Table>]
    const direction = ordering[columnName as ColumnDescriptor<Table>]
    sqlChunks.push(sql`${column} ${sql.raw(direction)}`)
  })
  return sql.join(sqlChunks, sql`, `)
}

function fieldsToColumns<T extends PgTableWithColumns<any>, Z extends ZodObject<any>>(model: T, schema: Z) {
  const attrs = Object.keys(schema.shape as Record<string, any>)

  const fields = attrs.reduce((acc, attr) => {
    acc[attr] = model[attr] as ReturnType<(typeof model)['attr']>
    return acc
  }, {} as Record<string, PgColumn>)

  return fields
}

function getTablePrimaryKeys<T extends PgTableWithColumns<any>>(table: T) {
  const columns = getTableColumns(table) as Record<string, Column>
  return Object.keys(columns).filter(columnName => columns[columnName].primary)
}

function getEvent(event: H3Event | undefined) {
  if (event === undefined)
    throw new Error('event is undefined')
  return event
}

function parseOrderQueryString<Table extends PgTableWithColumns<any>>(
  queryString: string | unknown,
  validFields: Array<ColumnDescriptor<Table>>,
) {
  const orderQueryStringSchema = z.string().regex(new RegExp(`^([-]?(${validFields.join('|')})(?:,[-]?(${validFields.join('|')}))*)?$`))
  const orderQueryString = orderQueryStringSchema.parse(queryString ?? '')
  const ordering = orderQueryString.split(',').map((part) => {
    const cleanedPart = part.replace(/^[-]/, '')
    const direction = part.startsWith('-') ? 'desc' : 'asc'
    return [cleanedPart, direction] as [ColumnDescriptor<Table>, 'asc' | 'desc']
  }).reduce((acc, [column, direction]) => {
    acc[column] = direction
    return acc
  }, {} as Record<ColumnDescriptor<Table>, 'asc' | 'desc'>)

  if (Object.keys(ordering).length > 0)
    return ordering
  else
    return undefined
}

export function useAPIView<
  Table extends PgTableWithColumns<any>,
  ZDefault extends ZodObject<any>,
  ZList extends ZodObject<any>,
  ZCreate extends ZodObject<any>,
  ZRetrieve extends ZodObject<any>,
  ZUpdate extends ZodObject<any>,
>(options: APIViewOptions<Table, ZDefault, ZList, ZCreate, ZRetrieve, ZUpdate>) {
  const {
    model,
    db: _db,
    event: _event,
    schema,
    handlers,
    actions,
    primaryKey,
    pagination,
    searchFields,
    filterFields,
    orderFields,
    defaultOrdering,
  } = options

  const pk = getTablePrimaryKeys(model)[0] as ColumnDescriptor<Table>
  const columns = getTableColumns(model)
  const columnNames = Object.keys(columns)

  const _primaryKey: Record<string, ColumnDescriptor<Table>> = {
    retrieve: typeof primaryKey === 'object' ? primaryKey.retrieve ?? primaryKey.default : primaryKey ?? pk,
    update: typeof primaryKey === 'object' ? primaryKey.update ?? primaryKey.default : primaryKey ?? pk,
    delete: typeof primaryKey === 'object' ? primaryKey.delete ?? primaryKey.default : primaryKey ?? pk,
  }

  {
    const undefinedKeys = Object.keys(_primaryKey).filter(key => _primaryKey[key] === undefined)
    if (undefinedKeys.length > 0)
      throw new Error(`primaryKey[${undefinedKeys.join('|')}] is undefined`)
  }

  const _schema: Record<string, ZodObject<any>> = {
    list: schema?.list ?? createSelectSchema(model),
    retrieve: schema?.retrieve ?? createSelectSchema(model),
    create: schema?.create ?? createInsertSchema(model),
    update: schema?.update ?? createInsertSchema(model),
  }

  const _pageSize = pagination?.pageSize ?? 24

  async function list({
    schema = _schema.list as ZList,
    pageSize = _pageSize,
    canPaginate = pagination?.canPaginate ?? 'auto',
    event = _event as H3Event,
  }: PaginatedListOptions<ZList> = {}) {
    if (handlers?.list)
      return handlers.list(getEvent(event))

    const _event = getEvent(event)
    const query = getQuery(_event)
    const page = (query.page as number) || 1

    const paginate = !!((canPaginate === 'auto' && query.page !== undefined) || canPaginate === true)

    const selectableColumns: ReturnType<typeof fieldsToColumns> & { count?: SQL<number> } = fieldsToColumns(model, schema)

    if (paginate)
      selectableColumns.count = sql<number>`count(*) over()`.mapWith(Number)

    let dbQuery = _db.select(selectableColumns).from(model)

    const filtering = undefined

    const ordering = query.o && orderFields
      ? parseOrderQueryString(query.o, orderFields)
      : defaultOrdering
        ? parseOrderQueryString(defaultOrdering, columnNames)
        : undefined

    if (filtering)
      dbQuery = dbQuery.where(filtering)

    if (ordering)
      dbQuery = dbQuery.orderBy(getOrderBySQL(model, ordering))

    const results = paginate ? await dbQuery.limit(pageSize).offset((page - 1) * pageSize) : await dbQuery

    const count = results[0].count ?? results.length

    return paginate
      ? {
          page,
          pageSize,
          count,
          pageCount: Math.ceil(count / pageSize),
          results: z.array(schema).parse(results),
        }
      : z.array(schema).parse(results)
  }

  async function create({
    schema = _schema.create as ZCreate,
    event = _event,
  }: CreateOptions<ZCreate> = {}) {
    if (handlers?.create)
      return handlers.create(getEvent(event))
    const _event = getEvent(event)
    const body = await readBody<z.infer<ZCreate>>(_event)
    const values = schema.parse(body) as z.infer<ZCreate>
    const result = await _db.insert(model).values(values).returning()
    return schema.parse(result[0]) as z.infer<ZCreate>
  }

  async function retrieve({
    primaryKey = _primaryKey.retrieve,
    schema = _schema.retrieve as ZRetrieve,
    event = _event,
  }: RetrieveOptions<ZRetrieve, Table> = {}) {
    if (handlers?.retrieve)
      return handlers.retrieve(getEvent(event))
    const _event = getEvent(event)
    const pk = getRouterParam(_event, primaryKey.toString())
    const results = await _db.select(fieldsToColumns(model, schema)).from(model).where(eq(model[primaryKey], pk))
    return schema.parse(results[0]) as z.infer<ZRetrieve>
  }

  async function update({
    primaryKey = _primaryKey.update,
    schema = _schema.update as ZUpdate,
    event = _event,
  }: UpdateOptions<ZUpdate, Table> = {}) {
    if (handlers?.update)
      return handlers.update(getEvent(event))
    const _event = getEvent(event)
    const pk = getRouterParam(_event, primaryKey.toString())
    const body = await readBody<z.infer<ZCreate>>(_event)
    const values = schema.parse(body) as z.infer<ZCreate>
    const result = await _db.update(model).set(values).where(eq(model[primaryKey], pk)).returning()
    return _schema.retrieve.parse(result[0]) as z.infer<ZRetrieve>
  }

  async function destroy({
    primaryKey = _primaryKey.delete,
    event = _event,
  }: DestroyOptions<Table> = {}) {
    if (handlers?.destroy)
      return handlers.destroy(getEvent(event))
    const _event = getEvent(event)
    const pk = getRouterParam(_event, primaryKey.toString())
    const deletedIds = await _db
      .delete(model)
      .where(eq(model[primaryKey], pk))
      .returning({ deletedId: model[primaryKey] })
    return deletedIds[0]
  }

  async function search({ event = _event }: SearchOptions = {}) {
    if (handlers?.search)
      return handlers.search(getEvent(event))
    const _event = getEvent(event)
    const query = getQuery(_event)
    const serachQuery = query.q as string
    if (!serachQuery)
      return []

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve([])
      }, 1000)
    })
  }

  function register(router: Router, path: string, handlers: APIViewHandlers = 'all') {
    if (handlers === 'all' || handlers.includes('list'))
      router.get(path, eventHandler(async event => await list({ event })))

    if (handlers === 'all' || handlers.includes('create'))
      router.post(path, eventHandler(async event => create({ event })))

    if (handlers === 'all' || handlers.includes('retrieve')) {
      router.get(
        `${path}/:${_primaryKey.retrieve.toString()}`,
        eventHandler(async event => await retrieve({ event })),
      )
    }

    if (handlers === 'all' || handlers.includes('update')) {
      router.put(
        `${path}/:${_primaryKey.update.toString()}`,
        eventHandler(async event => await update({ event })),
      )
    }

    if (handlers === 'all' || handlers.includes('destroy')) {
      router.delete(
        `${path}/:${_primaryKey.delete.toString()}`,
        eventHandler(async event => await destroy({ event })),
      )
    }

    if (handlers === 'all' || handlers.includes('search')) {
      router.get(
        `${path}/search`,
        eventHandler(async event => await search({ event })),
      )
    }

    if (actions) {
      actions.forEach(({ path: actionPath, method: actionMethod, handler, name, detail }) => {
        const _method = actionMethod ?? 'get'
        const _detail = detail ?? false
        const _actionPath = actionPath ?? name
        const _path = (_actionPath.startsWith('/') ? _actionPath : `${path}/${_actionPath}`) + (_detail ? '/:pk' : '')
        router.add(_path, handler, _method)
      })
    }
  }

  return {
    list,
    create,
    retrieve,
    update,
    destroy,
    search,
    register,
    actions,
  }
}
