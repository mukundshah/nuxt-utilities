import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { getTableConfig } from "drizzle-orm/pg-core";

import type { H3Event } from "h3";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import type { ZodBigInt, ZodNumber, ZodObject, ZodString } from "zod";

type Database = PostgresJsDatabase;

type ZodPrimaryKey = ZodBigInt | ZodNumber | ZodString;

interface Model extends PgTableWithColumns<any> {}

interface APIViewOptions<T extends PgTableWithColumns<any>> {
  model: T;
  db: Database;
  request: H3Event;
  schema?: {
    identifier?: keyof T["_"]["columns"];
    default?: ZodObject<any>;
    list?: ZodObject<any>;
    create?: ZodObject<any>;
    update?: {
      pk: ZodPrimaryKey;
      values: ZodObject<any>;
    };
    retrieve?: ZodPrimaryKey;
    destroy?: ZodPrimaryKey;
  };
  permissions?: Record<string, any>;
  filters: Record<string, any>;
  ordering?: Record<string, "asc" | "desc">;
}

type LogicalOperator = "$and" | "$or" | "$not";
type ComparisonOperator =
  | "$eq"
  | "$neq"
  | "$gt"
  | "$gte"
  | "$lt"
  | "$lte"
  | "$is"
  | "$isNull"
  | "$in";

type Filter = {
  // Omit<[key in LogicalOperaor], '$not'>?: Filter[]
  [key in LogicalOperator]?: Filter[];
} & {
  [key in ComparisonOperator]?: any;
};

function useFilter(filters: Record<string, any>) {}

function useOrdering(orderBy: Record<string, "asc" | "desc">) {}

function useFileUpload(provider: "aws" | "gcp" | "azure") {
  function upload() {}

  return {
    upload,
  };
}

const useAPIView = <T extends PgTableWithColumns<any>>(
  options: APIViewOptions<T>
) => {
  const {
    model,
    db,
    request,
    schema,
    filters: _filters,
    ordering,
    permissions,
  } = options;

  // pk of model
  const { primaryKeys: pk } = getTableConfig(model);

  // TODO: If pk is not defined, check if alternate field is provided else throw error that a pk or field is required

  const defaultSchema = schema?.default ?? createSelectSchema(model);
  const listSchema = schema?.list ?? defaultSchema ?? createSelectSchema(model);
  const createSchema = schema?.create ?? createInsertSchema(model);
  const retrieveSchema = schema?.retrieve ?? createSelectSchema(model);
  const updateSchema =
    schema?.update ??
    ({
      pk: pk[0],
      values: defaultSchema ?? createInsertSchema(model),
    } as const);
  const destroySchema = schema?.destroy ?? pk[0];

  // TODO: parse filters and ordering from request.query with zod

  async function list(
    schema: ZodObject<any> = listSchema,
    filters: Record<string, any> = _filters
  ) {
    await db.select(schema.parse({})).from(model).where(filters);
    return [];
  }

  async function create(schema: ZodObject<any> = createSchema) {
    await db.insert(model).values(createSchema.parse({})).returning("*");
    return [];
  }

  async function retrieve(identifier: ZodPrimaryKey = retrieveSchema) {
    await db.select(retrieveSchema.parse({})).from(model).where(filters);
    return [];
  }

  async function update(
    identifier: ZodPrimaryKey = updateSchema.pk,
    schema: ZodObject<any> = updateSchema.values
  ) {
    await db.update(model).set(updateSchema.parse({})).where(filters);
    return [];
  }

  async function destroy(identifier: ZodPrimaryKey = destroySchema) {
    return [];
  }

  async function search() {
    return [];
  }

  return {
    list,
    create,
    retrieve,
    update,
    destroy,
  };
};
