import { getQuery } from 'ufo';
import type { ParsedQuery } from 'ufo';

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

function castValue(
  value: string,
): string | number | boolean | null | bigint | Date {
  if (value === '')
    return '';
  if (value.toLowerCase() === 'true')
    return true;
  if (value.toLowerCase() === 'false')
    return false;
  if (value.toLowerCase() === 'null')
    return null;
  if (Number.isNaN(Number(value)))
    return value;
  return Number(value);
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
    return { $gte: Number(removePrefix('>=')) };
  if (startsWith('<='))
    return { $lte: Number(removePrefix('<=')) };
  if (startsWith('>'))
    return { $gt: Number(removePrefix('>')) };
  if (startsWith('<'))
    return { $lt: Number(removePrefix('<')) };

  // range
  if (value.includes('..')) {
    const [start, end] = value.startsWith('!')
      ? removePrefix('!').split('..')
      : value.split('..');
    return value.startsWith('!')
      ? { $nbetween: [start, end] }
      : { $between: [start, end] };
  }

  // array
  if (value.includes(',')) {
    if (startsWith('@>'))
      return { $contained: removePrefix('@>').split(',') };
    if (startsWith('@'))
      return { $contains: removePrefix('@') };
    if (startsWith('!'))
      return { $nin: removePrefix('!').split(',') };
    return { $in: value.split(',') };
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
  const query = _getQuery(tokens);

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

function processQuery(q: Record<string, any>): Record<string, any> {
  const { and, or, not, page, size, sort, q: searchQuery, ...restQ } = q;

  const query: Record<string, any> = {};

  for (const [key, value] of Object.entries(restQ)) {
    console.log(key, value);
    if (typeof value === 'string')
      query[key] = decodeValue(value);

    else if (Array.isArray(value))
      query[key] = handleArray(value);
  }

  if (and)
    query.$and = parseAndOrNot(and);
  if (or)
    query.$or = parseAndOrNot(or);
  if (not)
    query.$not = parseAndOrNot(not);

  return query;
}

export const useRestFilter = <T extends ParsedQuery = ParsedQuery> (query: string | T) => {
  const q = typeof query === 'string' ? getQuery(query) : query;
  const filters = () => {
    return {
      sql: processQuery(q),
    };
  };
  const sort = () => {
    return {
      sql: processQuery(q),
    };
  };
  const page = () => {
    return {
      sql: processQuery(q),
    };
  };
  const size = () => {
    return {
      sql: processQuery(q),
    };
  };
  const q = () => {
    return {
      sql: processQuery(q),
    };
  };
};
