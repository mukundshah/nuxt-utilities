import { getQuery } from 'ufo';
import { sql } from 'drizzle-orm';

import type { ParsedQuery } from 'ufo';

// import type { SQL } from 'drizzle-orm';

interface FilterParam {
  $eq?: string | number | boolean | Date | bigint
  $ne?: string | number | boolean | Date | bigint
  $gt?: number | Date | bigint
  $gte?: number | Date | bigint
  $lt?: number | Date | bigint
  $lte?: number | Date | bigint
  $in?: Array<string | number | boolean | Date | bigint>
  $nin?: Array<string | number | boolean | Date | bigint>
  $null?: boolean
  $like?: string
  $nlike?: string
  $ilike?: string
  $nilike?: string
  $between?: [number, number] | [Date, Date] | [bigint, bigint]
  $nbetween?: [number, number] | [Date, Date] | [bigint, bigint]
  $contained?: Array<string | number | boolean | Date | bigint>
}

interface FilterQuery {
  page?: number
  size?: number
  sort?: string
  q?: string
  filter?: {
    $not?: FilterParam
    $or?: Array<FilterParam>
    $and?: Array<FilterParam>
    [key: string]: string | number | boolean | Date | bigint | FilterParam
  }
}

/**
 *
 * @param value
 * @returns string | number | boolean | null | bigint | Date
 */
function castValue(
  value: string,
): string | number | boolean | null | bigint | Date {
  if (value === '')
    return '';

  const logwerCaseValue = value.toLowerCase();
  if (logwerCaseValue === 'true')
    return true;
  if (logwerCaseValue === 'false')
    return false;
  if (logwerCaseValue === 'null')
    return null;

  const numericValue = Number(value);
  if (!isNaN(numericValue)) {
    if (Number.isSafeInteger(numericValue))
      return numericValue;
    return BigInt(value);
  }

  const dateValue = new Date(value);
  if (!isNaN(dateValue.getTime()))
    return dateValue;

  return value;
}

function castNumberish(value: string): number | bigint | Date {
  const numericValue = Number(value);
  if (!isNaN(numericValue)) {
    if (Number.isSafeInteger(numericValue))
      return numericValue;
    return BigInt(value);
  }

  const dateValue = new Date(value);
  if (!isNaN(dateValue.getTime()))
    return dateValue;

  throw new Error('Not a numberish value');
}

function castArray(value: Array<string>): any[] {
  const arr = value.map(castValue);
  const firstElementType = typeof arr[0];
  if (arr.every(v => typeof v === firstElementType)) {
    // TODO: what does this do and do we need it?
    // if (firstElementType === "number") return arr.map(Number);
    return arr;
  }
  throw new Error('Not an array of the same type');
}

function decodeValue(value: string): Record<string, any> {
  const numericValue = Number(value);
  if (value === '')
    return { $null: true };
  if (value === '!')
    return { $null: false };
  if (!isNaN(numericValue))
    return { $eq: numericValue };

  const startsWith = (prefix: string) => value.startsWith(prefix);
  const removePrefix = (prefix: string) => value.substring(prefix.length);

  if (startsWith('>='))
    return { $gte: castNumberish(removePrefix('>=')) };
  if (startsWith('<='))
    return { $lte: castNumberish(removePrefix('<=')) };
  if (startsWith('>'))
    return { $gt: castNumberish(removePrefix('>')) };
  if (startsWith('<'))
    return { $lt: castNumberish(removePrefix('<')) };

  // range
  if (value.includes('..')) {
    const [start, end] = startsWith('!')
      ? removePrefix('!').split('..')
      : value.split('..');
    return startsWith('!')
      ? { $nbetween: castArray([start, end]) }
      : { $between: castArray([start, end]) };
  }

  // array
  if (value.includes(',')) {
    if (startsWith('@>'))
      return { $contained: removePrefix('@>').split(',').map(castValue) };
    if (startsWith('@'))
      return { $contains: removePrefix('@') };
    if (startsWith('!'))
      return { $nin: castArray(removePrefix('!').split(',')) };
    return { $in: castArray(value.split(',')) };
  }

  if (startsWith('~'))
    return { $like: removePrefix('~') };
  if (startsWith('!~'))
    return { $nlike: removePrefix('!~') };
  if (startsWith('~*'))
    return { $ilike: removePrefix('~*') };
  if (startsWith('!~*'))
    return { $nilike: removePrefix('!~*') };
  if (startsWith('!'))
    return { $ne: removePrefix('!') };

  return { $eq: value };
}

function handleArray(values: string[]): Record<string, any> {
  let queryObject: Record<string, any> = {};
  values.forEach((v) => {
    console.log(v);
    if (typeof v === 'string') {
      const decodedValue = decodeValue(v);
      const keys = Object.keys(decodedValue);
      if (keys.length === 1) {
        if (queryObject.hasOwnProperty(keys[0])) {
          queryObject = {
            ...queryObject,
            $and: [
              {
                [keys[0]]: queryObject[keys[0]],
              },
              decodedValue,
            ],
          };
          delete queryObject[keys[0]];
        }
        else {
          queryObject = { ...queryObject, ...decodedValue };
        }
      }
      else {
        throw new Error('Not implemented');
      }
    }
    else if (typeof v === 'object') {
      throw new TypeError('Not implemented');
    }
  });
  return queryObject;
}

function parseAndOrNot(value: string): Record<string, any> {
  const cleanValue = value.substring(1, value.length - 1);
  const tokens = cleanValue.replaceAll('|', '&');
  const query = getQuery(tokens);

  const queryObject: Record<string, any> = {};
  for (const [key, value] of Object.entries(query)) {
    console.log(key, value);
    if (typeof value === 'string')
      queryObject[key] = decodeValue(value);

    else if (Array.isArray(value))
      queryObject[key] = handleArray(value);
  }
  return queryObject;
}

interface DrizzleRestFilterOptions {
  pagination?: {
    pageSize?: number
  }
  alias?: Record<string, string>
  exclude?: string[]
  include?: string[]
  filter?: {
    alias?: Record<string, string>
    exclude?: string[]
    include?: string[]
    allowedOperators?: string[]
    blockedOperators?: string[]
  }
  sort?: {
    alias?: Record<string, string>
    exclude?: string[]
    include?: string[]
    default?: string
  }
  search?: {
    searchableFields: string[]
  }
}

function processQuery(q: Record<string, any>): Record<string, any> {
  const { and, or, not, page, size, sort, q: searchQuery, ...restQ } = q;

  const filter: Record<string, any> = {};

  for (const [key, value] of Object.entries(restQ)) {
    console.log(key, value);
    if (typeof value === 'string')
      filter[key] = decodeValue(value);

    else if (Array.isArray(value))
      filter[key] = handleArray(value);
  }

  if (and)
    filter.$and = parseAndOrNot(and);
  if (or)
    filter.$or = parseAndOrNot(or);
  if (not)
    filter.$not = parseAndOrNot(not);

  return {
    filter,
    page: page ? Number(page) : 1,
    size: size ? Number(size) : 10,
    sort: sort || 'id',
    searchQuery: searchQuery || '',
  };
}

function useDrizzleRestFilter(
  queryParam: string | ParsedQuery,
  options: DrizzleRestFilterOptions,
) {
  const { pagination, alias, exclude, include, filter, sort, search }
    = options;

  const filterAlias = filter?.alias ?? alias;
  const filterExclude = filter?.exclude ?? exclude;
  const filterInclude = filter?.include ?? include;
  const filterAllowedOperators = filter?.allowedOperators ?? 'all';

  const sortAlias = sort?.alias ?? alias;
  const sortExclude = sort?.exclude ?? exclude;
  const sortInclude = sort?.include ?? include;
  const sortDefault = sort?.default ?? 'id';

  const searchSearchableFields = search?.searchableFields ?? [];

  const query
    = typeof queryParam === 'string' ? getQuery(queryParam) : queryParam;

  const processedQuery = processQuery(query);

  const {
    filter: filterQuery,
    page,
    size,
    sort: sortQuery,
    searchQuery,
  } = processedQuery;

  const filterSQL = () => {
    return sql`where ${filterQuery}`;
  };

  const sortSQL = () => {
    return sql`order by ${sortQuery}`;
  };

  const searchSQL = () => {
    return sql`where ${searchQuery}`;
  };

  const paginationSQL = () => {
    return sql`limit ${size} offset ${(page - 1) * size}`;
  };

  return {
    filter: {
      sql: filterSQL,
      query: filterQuery,
    },
    sort: {
      sql: sortSQL,
      query: sortQuery,
    },
    search: {
      sql: searchSQL,
      query: searchQuery,
    },
    pagination: {
      sql: paginationSQL,
      query: { page, size },
    },
  };
}
