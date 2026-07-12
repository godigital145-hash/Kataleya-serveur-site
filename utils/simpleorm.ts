// Types pour Cloudflare D1
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<D1ExecResult>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  dump(): Promise<ArrayBuffer>;
}

interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

interface D1Result<T = Record<string, any>> {
  results?: T[];
  success: boolean;
  error?: string;
  meta: {
    changed_db: boolean;
    changes: number;
    duration: number;
    last_row_id: number;
    rows_read: number;
    rows_written: number;
  };
}

interface D1ExecResult {
  count: number;
  duration: number;
}

export interface QueryResult {
  lastInsertRowid?: number;
  changes: number;
}

export interface DatabaseRow {
  [key: string]: any;
}

export interface WhereConditions {
  [key: string]: any;
}

export interface OrderByOptions {
  column: string;
  direction?: "ASC" | "DESC";
}

export interface IncludeOptions<TRelated extends DatabaseRow = any> {
  model: string;
  foreignKey: string;
  localKey?: string;
  as?: string;
  type?: "hasMany" | "hasOne" | "belongsTo"; // Type de relation
  where?: Partial<TRelated>; // Conditions typées sur le modèle lié
  select?: (keyof TRelated)[]; // Colonnes typées du modèle lié
  count?: boolean; // Si true, retourne le nombre d'éléments au lieu des données complètes
}

export interface QueryOptions<T> {
  where?: TypeWhereCondtion<T>;
  orderBy?: OrderByOptions | OrderByOptions[];
  limit?: number;
  offset?: number;
  include?: IncludeOptions<any> | IncludeOptions<any>[];
  select?: (keyof T)[]; // Colonnes typées du modèle principal
  count?: boolean;
}

type TypeWhereCondtion<T> = {
  [K in keyof T]?: any;
};

export interface TableSchema {
  [colunmName: string]: string;
}

// Type utilitaire pour extraire les clés et types d'un modèle
export type ModelKeys<T> = {
  [K in keyof T]: K;
};

export type ModelTypes<T> = {
  [K in keyof T]: T[K] extends string
    ? "string"
    : T[K] extends number
    ? "number"
    : T[K] extends boolean
    ? "boolean"
    : T[K] extends Date
    ? "date"
    : "any";
};

// type pour autocomplétion
type text = "TEXT";
type primaryKey = "PRIMARY KEY";
type notNull = "NOT NULL";
type real = "REAL";
type integer = "INTEGER" | "INT";
type blob = "BLOB";
type Null = "NULL";
type foreignKey = "FOREIGN KEY";
type Default = "DEFAULT" | "DEFAULT";
type time = "TIME";
type timestamp = "TIMESTAMP";
type current = "CURRENT_TIMESTAMP";
type datetime = "DATETIME";

type TextWithSuffix =
  | text
  | primaryKey
  | notNull
  | real
  | integer
  | blob
  | Null
  | foreignKey
  | Default
  | "UNIQUE"
  | `${text | integer | real | blob} ${
      | primaryKey
      | foreignKey
      | notNull
      | Null
      | "UNIQUE"
      | "AUTOINCREMENT"}`
  | `${text | integer | real} ${primaryKey | foreignKey | notNull | Null} ${
      | notNull
      | Null
      | Default
      | "UNIQUE"
      | "AUTOINCREMENT"}`
  | `${datetime | time | timestamp}`
  | `${datetime | time | timestamp} ${notNull | null}`
  | `${datetime | time | timestamp} ${notNull | null | Default} ${current}`
  | `${datetime | time | timestamp} ${notNull | null} ${
      | current
      | Default} ${current}`;

// Interface pour les modèles avec métadonnées
export interface ModelWithMeta<T extends DatabaseRow> {
  keys: ModelKeys<T>;
  types: ModelTypes<T>;
  tableName: string;
}

// Query Builder pour enchaîner les méthodes
export interface QueryBuilder<T extends DatabaseRow> {
  where(conditions: WhereConditions): QueryBuilder<T>;
  orderBy(column: string, direction?: "ASC" | "DESC"): QueryBuilder<T>;
  limit(limit: number): QueryBuilder<T>;
  offset(offset: number): QueryBuilder<T>;
  include(options: IncludeOptions | IncludeOptions[]): QueryBuilder<T>;
  findAll(): Promise<T[]>;
  findOne(): Promise<T | null>;
  count(): Promise<number>;
}

// Interface pour les instances de modèle
export interface ModelInstance<T extends DatabaseRow> extends Partial<T> {
  save(): Promise<T>;
  delete(): Promise<boolean>;
}

// Interface pour les classes de modèle avec métadonnées
export interface ModelClass<T extends DatabaseRow> extends ModelWithMeta<T> {
  new (data?: Partial<T>): ModelInstance<T>;
  createTable(): Promise<QueryResult>;
  create(data: Partial<T>): Promise<T>;
  findAll(options?: QueryOptions<T>): Promise<T[]>;
  findById(
    id: string | number,
    options?: { include?: IncludeOptions | IncludeOptions[] }
  ): Promise<T | null>;
  findOne(options: QueryOptions<T>): Promise<T | null>;
  update(id: string | number, data: Partial<T>): Promise<T | null>;
  delete(id: string | number): Promise<boolean>;
  deleteWhere(conditions: WhereConditions): Promise<number>;
  upsert(data: Partial<T>): Promise<T>;
  upsertWithCoalesce(data: Partial<T>): Promise<T>;
  // Nouvelles méthodes ajoutées
  exists(conditions: WhereConditions): Promise<boolean>;
  createMany(dataArray: Partial<T>[]): Promise<T[]>;
  updateWhere(conditions: WhereConditions, data: Partial<T>): Promise<number>;
  increment(
    id: string | number,
    column: string,
    value?: number
  ): Promise<T | null>;
  decrement(
    id: string | number,
    column: string,
    value?: number
  ): Promise<T | null>;
  findOrCreate(
    conditions: WhereConditions,
    defaults?: Partial<T>
  ): Promise<{ record: T; created: boolean }>;
  // Query Builder methods
  where(conditions: WhereConditions): QueryBuilder<T>;
  orderBy(column: string, direction?: "ASC" | "DESC"): QueryBuilder<T>;
  limit(limit: number): QueryBuilder<T>;
  offset(offset: number): QueryBuilder<T>;
  include(options: IncludeOptions | IncludeOptions[]): QueryBuilder<T>;
  orm: SimpleORM;
}

// SimpleORM adaptée pour Cloudflare D1
class SimpleORM {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  private sanitizeParams(params: any[]): any[] {
    return params.map((param) => {
      // Gérer les valeurs null/undefined
      if (param === null || param === undefined) {
        return null;
      }

      // Gérer les objets Date
      if (param instanceof Date) {
        return param.toISOString();
      }

      // Gérer les booléens (SQLite utilise 0/1)
      if (typeof param === "boolean") {
        return param ? 1 : 0;
      }

      // Gérer les objets (les convertir en JSON)
      if (typeof param === "object" && param !== null) {
        return JSON.stringify(param);
      }

      // Retourner les autres types tels quels
      return param;
    });
  }

  async query<T = DatabaseRow>(sql: string, params: any[] = []): Promise<T[]> {
    try {
      const sanitizedParams = this.sanitizeParams(params);
      const stmt = this.db.prepare(sql);

      if (sanitizedParams.length === 0) {
        const result = await stmt.run();

        return result.results || [];
      }
      // console.log(await stmt.bind(...sanitizedParams).run());
      const result = await stmt.bind(...sanitizedParams).all<T>();

      if (!result.success) {
        throw new Error(result.error || "Query failed");
      }

      return result.results || [];
    } catch (error) {
      console.error("Query error:", error, "SQL:", sql, "Params:", params);
      throw error;
    }
  }

  // Méthode pour exécuter une seule ligne
  async get<T = DatabaseRow>(
    sql: string,
    params: any[] = []
  ): Promise<T | null> {
    try {
      const sanitizedParams = this.sanitizeParams(params);
      const stmt = this.db.prepare(sql);

      if (sanitizedParams.length === 0) {
        return await stmt.first<T>();
      }

      const result = await stmt.bind(...sanitizedParams).first<T>();
      return result || null;
    } catch (error) {
      console.error("Get error:", error, "SQL:", sql, "Params:", params);
      throw error;
    }
  }

  // Méthode pour exécuter des requêtes qui ne retournent pas de données
  async run(sql: string, params: any[] = []): Promise<QueryResult> {
    try {
      const sanitizedParams = this.sanitizeParams(params);
      const stmt = this.db.prepare(sql);

      if (sanitizedParams.length === 0) {
        const result = await stmt.run();
        return {
          lastInsertRowid: result.meta.last_row_id,
          changes: result.meta.changes,
        };
      }

      const result = await stmt.bind(...sanitizedParams).run();

      if (!result.success) {
        throw new Error(result.error || "Run failed");
      }

      return {
        lastInsertRowid: result.meta.last_row_id,
        changes: result.meta.changes,
      };
    } catch (error) {
      console.error("Run error:", error, "SQL:", sql, "Params:", params);
      throw error;
    }
  }

  // Méthode pour les transactions (batch)
  async transaction<T>(
    statements: (() => D1PreparedStatement)[]
  ): Promise<T[]> {
    try {
      const preparedStatements = statements.map((fn) => fn());
      const results = await this.db.batch(preparedStatements);

      // Vérifier si toutes les requêtes ont réussi
      for (const result of results) {
        if (!result.success) {
          throw new Error(result.error || "Transaction failed");
        }
      }

      return results as T[];
    } catch (error) {
      console.error("Transaction error:", error);
      throw error;
    }
  }

  // Exécuter plusieurs statements SQL (DDL)
  async exec(sql: string): Promise<void> {
    try {
      const result = await this.db.exec(sql);
      console.log(
        `Executed ${result.count} statements in ${result.duration}ms`
      );
    } catch (error) {
      console.error("Exec error:", error);
      throw error;
    }
  }

  // Ajoute une colonne seulement si elle n'existe pas déjà
  async addColumnIfNotExists(table: string, column: string, type: string): Promise<void> {
    const info = await this.query<{ name: string }>(`PRAGMA table_info(${table})`)
    const exists = info.some((col) => col.name === column)
    if (!exists) {
      await this.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    }
  }

  // Dump de la base de données
  async dump(): Promise<ArrayBuffer> {
    try {
      return await this.db.dump();
    } catch (error) {
      console.error("Dump error:", error);
      throw error;
    }
  }

  get isOpen(): boolean {
    return this.db !== null;
  }

  get name(): string {
    return "cloudflare-d1-database";
  }
}

export abstract class Model {
  protected tableName: string;
  protected orm: SimpleORM;
  protected attributes: DatabaseRow;

  constructor(tableName: string, orm: SimpleORM) {
    this.tableName = tableName;
    this.orm = orm;
    this.attributes = {};
  }

  // Créer la table
  static async createTable(
    tableName: string,
    columns: TableSchema,
    orm: SimpleORM
  ): Promise<QueryResult> {
    const columnDefs = Object.entries(columns)
      .map(([name, type]) => `${name} ${type}`)
      .join(", ");

    const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (${columnDefs})`;
    return await orm.run(sql);
  }

  // Insérer un nouvel enregistrement
  static async create<T extends DatabaseRow>(
    tableName: string,
    data: Partial<T>,
    orm: SimpleORM
  ): Promise<T> {
    const columns = Object.keys(data).join(", ");
    const placeholders = Object.keys(data)
      .map(() => "?")
      .join(", ");
    const values = Object.values(data);

    const sql = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`;
    const result = await orm.run(sql, values);

    return { id: result.lastInsertRowid, ...data } as T;
  }

  // Insérer plusieurs enregistrements (batch insert)
  static async createMany<T extends DatabaseRow>(
    tableName: string,
    dataArray: Partial<T>[],
    orm: SimpleORM
  ): Promise<T[]> {
    if (dataArray.length === 0) return [];

    const results: T[] = [];

    // Préparer les statements pour le batch
    const statements = dataArray.map((data) => {
      const columns = Object.keys(data).join(", ");
      const placeholders = Object.keys(data)
        .map(() => "?")
        .join(", ");
      const values = Object.values(data);

      return () => {
        const stmt = orm["db"].prepare(
          `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`
        );
        return stmt.bind(...values);
      };
    });

    // Exécuter en batch
    const batchResults = await orm.transaction(statements);

    // Construire les résultats
    dataArray.forEach((data, index) => {
      const batchResult = batchResults[index] as any;
      results.push({
        id: batchResult.meta?.last_row_id,
        ...data,
      } as T);
    });

    return results;
  }

  // Trouver tous les enregistrements avec options avancées
  static async findAll<T extends DatabaseRow>(
    tableName: string,
    orm: SimpleORM,
    options: QueryOptions<T> = {}
  ): Promise<T[]> {
    const { where = {}, orderBy, limit, offset, include, select, count } = options;

    // SELECT clause - utiliser les colonnes spécifiées ou * par défaut
    const selectClause = select && select.length > 0 ? select.join(", ") : "*";
    let sql = `SELECT ${selectClause} FROM ${tableName}`;
    let params: any[] = [];

    // WHERE clause
    if (Object.keys(where).length > 0) {
      const whereClause = Object.keys(where)
        .map((key) => `${key} = ?`)
        .join(" AND ");
      sql += ` WHERE ${whereClause}`;
      params = Object.values(where);
    }

    // ORDER BY clause
    if (orderBy) {
      const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
      const orderClauses = orderByArray
        .map((order) => `${order.column} ${order.direction || "ASC"}`)
        .join(", ");
      sql += ` ORDER BY ${orderClauses}`;
    }

    // LIMIT clause
    if (limit) {
      sql += ` LIMIT ${limit}`;
    }

    // OFFSET clause
    if (offset) {
      sql += ` OFFSET ${offset}`;
    }

    let results = await orm.query<T>(sql, params);

    // Handle includes (relations)
    if (include && results.length > 0) {
      results = await this.handleIncludes<T>(tableName, results, include, orm);
    }

    if(count) {
      let countSql = `SELECT COUNT(*) as count FROM ${tableName}`;

      if (Object.keys(where).length > 0) {
        const whereClause = Object.keys(where)
          .map((key) => `${key} = ?`)
          .join(" AND ");
        countSql += ` WHERE ${whereClause}`;
      }
      const countResult = await orm.get<{count : number}>(countSql, params);
      return { results, count: countResult.count }
    }

    return results;
  }

  // Trouver un enregistrement par ID avec options
  static async findById<T extends DatabaseRow>(
    tableName: string,
    id: string | number,
    orm: SimpleORM,
    options: { include?: IncludeOptions | IncludeOptions[] } = {}
  ): Promise<T | null> {
    const { include } = options;

    const sql = `SELECT * FROM ${tableName} WHERE id = ?`;
    let result = await orm.get<T>(sql, [id]);

    // Handle includes
    if (result && include) {
      const results = await this.handleIncludes<T>(
        tableName,
        [result],
        include,
        orm
      );
      result = results[0];
    }

    return result;
  }

  // Trouver un seul enregistrement avec options
  static async findOne<T extends DatabaseRow>(
    tableName: string,
    options: QueryOptions,
    orm: SimpleORM
  ): Promise<T | null> {
    const { where = {}, orderBy, include } = options;

    const whereClause = Object.keys(where)
      .map((key) => `${key} = ?`)
      .join(" AND ");
    let sql = `SELECT * FROM ${tableName} WHERE ${whereClause}`;
    const params = Object.values(where);

    // ORDER BY clause
    if (orderBy) {
      const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
      const orderClauses = orderByArray
        .map((order) => `${order.column} ${order.direction || "ASC"}`)
        .join(", ");
      sql += ` ORDER BY ${orderClauses}`;
    }

    sql += " LIMIT 1";

    let result = await orm.get<T>(sql, params);

    // Handle includes
    if (result && include) {
      const results = await this.handleIncludes<T>(
        tableName,
        [result],
        include,
        orm
      );
      result = results[0];
    }

    return result;
  }

  // async count(
  //   tableName: string,
  //   conditions: WhereConditions = {},
  //   orm: SimpleORM
  // ): Promise<number> {
  //   let sql = `SELECT COUNT(*) as count FROM ${tableName}`;
  //   const params: any[] = [];

  //   if (Object.keys(conditions).length > 0) {
  //     const whereClause = Object.entries(conditions)
  //       .map(([key]) => `${key} = ?`)
  //       .join(" AND ");
  //     sql += ` WHERE ${whereClause}`;
  //     params.push(...Object.values(conditions));
  //   }

  //   const result = await orm.get<{ count: number }>(sql, params);
  //   return result?.count || 0;
  // }

  // Vérifier si un enregistrement existe
  static async exists(
    tableName: string,
    conditions: WhereConditions,
    orm: SimpleORM
  ): Promise<boolean> {
    const whereClause = Object.keys(conditions)
      .map((key) => `${key} = ?`)
      .join(" AND ");
    const sql = `SELECT 1 FROM ${tableName} WHERE ${whereClause} LIMIT 1`;
    const params = Object.values(conditions);

    const result = await orm.get(sql, params);
    return result !== null;
  }

  // Mettre à jour un enregistrement
  static async update<T extends DatabaseRow>(
    tableName: string,
    id: string | number,
    data: Partial<T>,
    orm: SimpleORM
  ): Promise<T | null> {
    const setClause = Object.keys(data)
      .map((key) => `${key} = ?`)
      .join(", ");
    const sql = `UPDATE ${tableName} SET ${setClause} WHERE id = ?`;
    const params = [...Object.values(data), id];

    await orm.run(sql, params);
    return await this.findById<T>(tableName, id, orm);
  }

  // Mettre à jour avec conditions
  static async updateWhere<T extends DatabaseRow>(
    tableName: string,
    conditions: WhereConditions,
    data: Partial<T>,
    orm: SimpleORM
  ): Promise<number> {
    const setClause = Object.keys(data)
      .map((key) => `${key} = ?`)
      .join(", ");
    const whereClause = Object.keys(conditions)
      .map((key) => `${key} = ?`)
      .join(" AND ");

    const sql = `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause}`;
    const params = [...Object.values(data), ...Object.values(conditions)];

    const result = await orm.run(sql, params);
    return result.changes;
  }

  // Incrémenter une colonne numérique
  static async increment<T extends DatabaseRow>(
    tableName: string,
    id: string | number,
    column: string,
    value: number = 1,
    orm: SimpleORM
  ): Promise<T | null> {
    const sql = `UPDATE ${tableName} SET ${column} = ${column} + ? WHERE id = ?`;
    await orm.run(sql, [value, id]);
    return await this.findById<T>(tableName, id, orm);
  }

  // Décrémenter une colonne numérique
  static async decrement<T extends DatabaseRow>(
    tableName: string,
    id: string | number,
    column: string,
    value: number = 1,
    orm: SimpleORM
  ): Promise<T | null> {
    const sql = `UPDATE ${tableName} SET ${column} = ${column} - ? WHERE id = ?`;
    await orm.run(sql, [value, id]);
    return await this.findById<T>(tableName, id, orm);
  }

  // Trouver ou créer un enregistrement
  static async findOrCreate<T extends DatabaseRow>(
    tableName: string,
    conditions: WhereConditions,
    defaults: Partial<T> = {},
    orm: SimpleORM
  ): Promise<{ record: T; created: boolean }> {
    const existing = await this.findOne<T>(
      tableName,
      { where: conditions },
      orm
    );

    if (existing) {
      return { record: existing, created: false };
    }

    const newRecord = await this.create<T>(
      tableName,
      { ...conditions, ...defaults },
      orm
    );
    return { record: newRecord, created: true };
  }

  // Supprimer un enregistrement
  static async delete(
    tableName: string,
    id: string | number,
    orm: SimpleORM
  ): Promise<boolean> {
    const sql = `DELETE FROM ${tableName} WHERE id = ?`;
    const result = await orm.run(sql, [id]);
    return result.changes > 0;
  }

  // Supprimer avec conditions
  static async deleteWhere(
    tableName: string,
    conditions: WhereConditions,
    orm: SimpleORM
  ): Promise<number> {
    const whereClause = Object.keys(conditions)
      .map((key) => `${key} = ?`)
      .join(" AND ");
    const sql = `DELETE FROM ${tableName} WHERE ${whereClause}`;
    const params = Object.values(conditions);

    const result = await orm.run(sql, params);
    return result.changes;
  }

  // INSERT OR REPLACE (Upsert)
  static async upsert<T extends DatabaseRow>(
    tableName: string,
    data: Partial<T>,
    orm: SimpleORM
  ): Promise<T> {
    const columns = Object.keys(data).join(", ");
    const placeholders = Object.keys(data)
      .map(() => "?")
      .join(", ");
    const values = Object.values(data);

    const sql = `INSERT OR REPLACE INTO ${tableName} (${columns}) VALUES (${placeholders})`;
    const result = await orm.run(sql, values);

    return { id: result.lastInsertRowid || (data as any).id, ...data } as T;
  }

  static async upsertWithCoalesce<T extends DatabaseRow>(
    tableName: string,
    data: Partial<T>,
    orm: SimpleORM
  ): Promise<T> {
    const columns = Object.keys(data);
    const values = Object.values(data);

    if ((data as any).id !== undefined) {
      const targetId = (data as any).id;
      const nonIdColumns = columns.filter((col) => col !== "id");
      const nonIdValues = nonIdColumns.map((col) => (data as any)[col]);

      // Utiliser COALESCE pour préserver l'ID existant ou utiliser le nouveau
      const coalescePlaceholders = nonIdColumns.map(() => "?").join(", ");
      const allColumns = `id, ${nonIdColumns.join(", ")}`;
      const allPlaceholders = `COALESCE((SELECT id FROM ${tableName} WHERE id = ?), ?), ${coalescePlaceholders}`;

      const sql = `INSERT OR REPLACE INTO ${tableName} (${allColumns}) VALUES (${allPlaceholders})`;
      const params = [targetId, targetId, ...nonIdValues];

      await orm.run(sql, params);
      return { id: targetId, ...data } as T;
    }

    // Insertion normale
    const placeholders = columns.map(() => "?").join(", ");
    const sql = `INSERT OR REPLACE INTO ${tableName} (${columns.join(
      ", "
    )}) VALUES (${placeholders})`;
    const result = await orm.run(sql, values);
    return { id: result.lastInsertRowid, ...data } as T;
  }

  // Compter les enregistrements
  static async count<T extends DatabaseRow>(
    tableName: string,
    conditions: TypeWhereCondtion<T> = {},
    orm: SimpleORM
  ): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM ${tableName}`;
    let params: any[] = [];

    if (Object.keys(conditions).length > 0) {
      const whereClause = Object.keys(conditions)
        .map((key) => `${key} = ?`)
        .join(" AND ");
      sql += ` WHERE ${whereClause}`;
      params = Object.values(conditions);
    }

    const result = await orm.get<{ count: number }>(sql, params);
    return result?.count || 0;
  }

  /**
   * Méthode améliorée pour gérer les relations (includes)
   * Support pour hasMany, hasOne, et belongsTo
   * Si count est activé, retourne à la fois les données ET le count
   */
  static async handleIncludes<T extends DatabaseRow>(
    tableName: string,
    results: T[],
    include: IncludeOptions | IncludeOptions[],
    orm: SimpleORM
  ): Promise<T[]> {
    if (results.length === 0) return results;

    const includeArray = Array.isArray(include) ? include : [include];

    for (const includeOption of includeArray) {
      const {
        model: includeTable,
        foreignKey,
        localKey = "id",
        as,
        type = "hasMany",
        where: extraWhere = {},
        select,
        count = false, // Si true, ajoute aussi le count en plus des données
      } = includeOption;

      const relationName = as || includeTable;
      const countName = `${relationName}Count`; // Nom de la propriété pour le count

      // Déterminer quelle colonne utiliser pour récupérer les IDs
      let idsToQuery: any[];
      let queryColumn: string;
      let mapColumn: string;

      if (
        type === "belongsTo" ||
        (type === "hasOne" &&
          results.some((r) => (r as any)[foreignKey] !== undefined))
      ) {
        // BelongsTo: foreignKey est dans la table principale (results)
        // On récupère les valeurs de foreignKey depuis results
        idsToQuery = [
          ...new Set(
            results.map((row) => (row as any)[foreignKey]).filter(Boolean)
          ),
        ];
        queryColumn = localKey; // On cherche par localKey dans la table liée
        mapColumn = localKey; // On mappe par localKey
      } else {
        // HasMany/HasOne: foreignKey est dans la table liée
        // On récupère les IDs depuis localKey de results
        idsToQuery = [
          ...new Set(
            results.map((row) => (row as any)[localKey]).filter(Boolean)
          ),
        ];
        queryColumn = foreignKey; // On cherche par foreignKey dans la table liée
        mapColumn = foreignKey; // On mappe par foreignKey
      }

      if (idsToQuery.length === 0) {
        // Pas de données à lier, définir valeur par défaut
        results.forEach((row) => {
          (row as any)[relationName] = type === "hasMany" ? [] : null;
          if (count) {
            (row as any)[countName] = 0;
          }
        });
        continue;
      }

      // Construire les conditions WHERE
      const placeholders = idsToQuery.map(() => "?").join(", ");
      let whereClauses = [`${queryColumn} IN (${placeholders})`];
      let params: any[] = [...idsToQuery];

      // Ajouter les conditions supplémentaires
      if (Object.keys(extraWhere).length > 0) {
        const extraConditions = Object.keys(extraWhere)
          .map((key) => `${key} = ?`)
          .join(" AND ");
        whereClauses.push(extraConditions);
        params.push(...Object.values(extraWhere));
      }

      // Récupérer les données (toujours, même si count est activé)
      // Construire la clause SELECT
      const selectClause =
        select && select.length > 0 ? select.join(", ") : "*";

      // Requête SQL finale pour les données
      const relatedSql = `SELECT ${selectClause} FROM ${includeTable} WHERE ${whereClauses.join(
        " AND "
      )}`;
      const relatedData = await orm.query(relatedSql, params);

      // Traiter selon le type de relation
      if (type === "hasMany") {
        // Grouper les données liées par clé (plusieurs résultats)
        const relatedMap = new Map<any, any[]>();
        relatedData.forEach((item) => {
          const key = (item as any)[mapColumn];
          if (!relatedMap.has(key)) {
            relatedMap.set(key, []);
          }
          relatedMap.get(key)!.push(item);
        });

        // Attacher les tableaux de données liées
        results.forEach((row) => {
          const keyValue = (row as any)[localKey];
          const relatedItems = relatedMap.get(keyValue) || [];
          (row as any)[relationName] = relatedItems;
          
          // Si count est activé, ajouter aussi le nombre d'éléments
          if (count) {
            (row as any)[countName] = relatedItems.length;
          }
        });
      } else if (type === "hasOne" || type === "belongsTo") {
        // Mapper un seul résultat par clé
        const relatedMap = new Map<any, any>();
        relatedData.forEach((item) => {
          const key = (item as any)[mapColumn];
          if (!relatedMap.has(key)) {
            relatedMap.set(key, item);
          }
        });

        // Attacher un seul objet (ou null)
        results.forEach((row) => {
          const keyValue =
            type === "belongsTo"
              ? (row as any)[foreignKey] // Pour belongsTo, utiliser foreignKey de row
              : (row as any)[localKey]; // Pour hasOne, utiliser localKey de row
          const relatedItem = relatedMap.get(keyValue) || null;
          (row as any)[relationName] = relatedItem;
          
          // Si count est activé, ajouter 1 si l'élément existe, 0 sinon
          if (count) {
            (row as any)[countName] = relatedItem ? 1 : 0;
          }
        });
      }
    }

    return results;
  }

  /**
   * Nouvelle méthode pour les relations belongsTo inversées
   * (quand la clé étrangère est dans la table principale)
   */
  static async handleBelongsToIncludes<T extends DatabaseRow>(
    tableName: string,
    results: T[],
    include: IncludeOptions | IncludeOptions[],
    orm: SimpleORM
  ): Promise<T[]> {
    if (results.length === 0) return results;

    const includeArray = Array.isArray(include) ? include : [include];

    for (const includeOption of includeArray) {
      const {
        model: includeTable,
        foreignKey, // Dans ce cas, c'est la colonne dans la table actuelle
        localKey = "id", // Dans ce cas, c'est la PK de la table liée
        as,
        where: extraWhere = {},
        select,
      } = includeOption;

      const relationName = as || includeTable;

      // Récupérer les IDs étrangers uniques depuis la table actuelle
      const foreignIds = [
        ...new Set(
          results.map((row) => (row as any)[foreignKey]).filter(Boolean)
        ),
      ];

      if (foreignIds.length === 0) {
        // Pas de clés étrangères, définir null pour tous
        results.forEach((row) => {
          (row as any)[relationName] = null;
        });
        continue;
      }

      // Construire la clause SELECT
      const selectClause =
        select && select.length > 0 ? select.join(", ") : "*";

      // Requête pour récupérer les enregistrements liés
      const placeholders = foreignIds.map(() => "?").join(", ");
      let whereClauses = [`${localKey} IN (${placeholders})`];
      let params: any[] = [...foreignIds];

      // Ajouter les conditions supplémentaires
      if (Object.keys(extraWhere).length > 0) {
        const extraConditions = Object.keys(extraWhere)
          .map((key) => `${key} = ?`)
          .join(" AND ");
        whereClauses.push(extraConditions);
        params.push(...Object.values(extraWhere));
      }

      const relatedSql = `SELECT ${selectClause} FROM ${includeTable} WHERE ${whereClauses.join(
        " AND "
      )}`;
      const relatedData = await orm.query(relatedSql, params);

      // Mapper les résultats par leur PK
      const relatedMap = new Map<any, any>();
      relatedData.forEach((item) => {
        const key = (item as any)[localKey];
        relatedMap.set(key, item);
      });

      // Attacher les données liées
      results.forEach((row) => {
        const foreignId = (row as any)[foreignKey];
        (row as any)[relationName] = relatedMap.get(foreignId) || null;
      });
    }

    return results;
  }
}

type Schema<T extends TableSchema> = {
  [K in keyof T]: TextWithSuffix;
};

// Classe pour créer des modèles spécifiques avec métadonnées et Query Builder
class ModelFactory {
  private orm: SimpleORM;

  constructor(orm: SimpleORM) {
    this.orm = orm;
  }

  createModel<T extends DatabaseRow>(
    tableName: string,
    schema: Schema<T>,
    sampleData?: T
  ): ModelClass<T> {
    const orm = this.orm;

    // Générer les métadonnées à partir du schéma ou des données d'exemple
    const generateMetadata = (): {
      keys: ModelKeys<T>;
      types: ModelTypes<T>;
    } => {
      const keys = {} as ModelKeys<T>;
      const types = {} as ModelTypes<T>;

      // Utiliser les clés du schéma si disponible
      if (Object.keys(schema).length > 0) {
        Object.keys(schema).forEach((key) => {
          (keys as any)[key] = key;

          // Inférer le type à partir du schéma SQL
          const sqlType = schema[key].toUpperCase();
          if (sqlType.includes("INTEGER") || sqlType.includes("INT")) {
            (types as any)[key] = "number";
          } else if (sqlType.includes("TEXT") || sqlType.includes("VARCHAR")) {
            (types as any)[key] = "string";
          } else if (sqlType.includes("BOOLEAN") || sqlType.includes("BOOL")) {
            (types as any)[key] = "boolean";
          } else if (sqlType.includes("DATE") || sqlType.includes("TIME")) {
            (types as any)[key] = "date";
          } else {
            (types as any)[key] = "any";
          }
        });
      }

      // Utiliser les données d'exemple si fournies
      if (sampleData) {
        Object.keys(sampleData).forEach((key) => {
          (keys as any)[key] = key;

          const value = (sampleData as any)[key];
          if (typeof value === "string") {
            (types as any)[key] = "string";
          } else if (typeof value === "number") {
            (types as any)[key] = "number";
          } else if (typeof value === "boolean") {
            (types as any)[key] = "boolean";
          } else if (value instanceof Date) {
            (types as any)[key] = "date";
          } else {
            (types as any)[key] = "any";
          }
        });
      }

      return { keys, types };
    };

    const metadata = generateMetadata();

    // Query Builder Implementation - Maintenant asynchrone
    class QueryBuilderImpl implements QueryBuilder<T> {
      private options: QueryOptions<T> = {};

      constructor(private tableName: string, private orm: SimpleORM) {}

      where(conditions: TypeWhereCondtion<T>): QueryBuilder<T> {
        this.options.where = { ...this.options.where, ...conditions };
        return this;
      }

      orderBy(
        column: string,
        direction: "ASC" | "DESC" = "ASC"
      ): QueryBuilder<T> {
        const orderBy = { column, direction };
        if (this.options.orderBy) {
          this.options.orderBy = Array.isArray(this.options.orderBy)
            ? [...this.options.orderBy, orderBy]
            : [this.options.orderBy, orderBy];
        } else {
          this.options.orderBy = orderBy;
        }
        return this;
      }

      limit(limit: number): QueryBuilder<T> {
        this.options.limit = limit;
        return this;
      }

      offset(offset: number): QueryBuilder<T> {
        this.options.offset = offset;
        return this;
      }

      include(options: IncludeOptions | IncludeOptions[]): QueryBuilder<T> {
        if (this.options.include) {
          const currentIncludes = Array.isArray(this.options.include)
            ? this.options.include
            : [this.options.include];
          const newIncludes = Array.isArray(options) ? options : [options];
          this.options.include = [...currentIncludes, ...newIncludes];
        } else {
          this.options.include = options;
        }
        return this;
      }

      async findAll(): Promise<T[]> {
        return await Model.findAll<T>(this.tableName, this.orm, this.options);
      }

      async findOne(): Promise<T | null> {
        return await Model.findOne<T>(this.tableName, this.options, this.orm);
      }

      async count(): Promise<number> {
        const { where = {} } = this.options;
        return await Model.count(this.tableName, where, this.orm);
      }
    }

    // Classe de modèle générée
    class GeneratedModel implements ModelInstance<T> {
      [key: string]: any;
      private conditions: WhereConditions = {};
      constructor(data: Partial<T> = {}) {
        Object.assign(this, data);
      }

      // Méthodes d'instance - Asynchrones
      async save(): Promise<T> {
        if (this.id) {
          const result = await Model.update<T>(
            tableName,
            this.id,
            this as Partial<T>,
            orm
          );
          if (result) Object.assign(this, result);
          return result!;
        } else {
          const result = await Model.create<T>(
            tableName,
            this as Partial<T>,
            orm
          );
          this.id = result.id;
          Object.assign(this, result);
          return result;
        }
      }

      async delete(): Promise<boolean> {
        if (this.id) {
          return await Model.delete(tableName, this.id, orm);
        }
        return false;
      }

      // Méthodes statiques - CRUD de base (maintenant asynchrones)
      static async createTable(): Promise<QueryResult> {
        return await Model.createTable(tableName, schema, orm);
      }

      static async create(data: Partial<T>): Promise<T> {
        return await Model.create<T>(tableName, data, orm);
      }

      static async createMany(dataArray: Partial<T>[]): Promise<T[]> {
        return await Model.createMany<T>(tableName, dataArray, orm);
      }

      static async findAll(options: QueryOptions<T> = {}): Promise<T[]> {
        return await Model.findAll<T>(tableName, orm, options);
      }

      static async findById(
        id: string | number,
        options: { include?: IncludeOptions | IncludeOptions[] } = {}
      ): Promise<T | null> {
        return await Model.findById<T>(tableName, id, orm, options);
      }

      static async findOne(options: QueryOptions<T>): Promise<T | null> {
        return await Model.findOne<T>(tableName, options, orm);
      }

      async count(): Promise<number> {
        return Model.count(tableName, this.condition, orm);
      }

      static async exists(conditions: WhereConditions): Promise<boolean> {
        return await Model.exists(tableName, conditions, orm);
      }

      static async findOrCreate(
        conditions: WhereConditions,
        defaults: Partial<T> = {}
      ): Promise<{ record: T; created: boolean }> {
        return await Model.findOrCreate<T>(
          tableName,
          conditions,
          defaults,
          orm
        );
      }

      static async update(
        id: string | number,
        data: Partial<T>
      ): Promise<T | null> {
        return await Model.update<T>(tableName, id, data, orm);
      }

      static async updateWhere(
        conditions: WhereConditions,
        data: Partial<T>
      ): Promise<number> {
        return await Model.updateWhere<T>(tableName, conditions, data, orm);
      }

      static async increment(
        id: string | number,
        column: string,
        value: number = 1
      ): Promise<T | null> {
        return await Model.increment<T>(tableName, id, column, value, orm);
      }

      static async decrement(
        id: string | number,
        column: string,
        value: number = 1
      ): Promise<T | null> {
        return await Model.decrement<T>(tableName, id, column, value, orm);
      }

      static async delete(id: string | number): Promise<boolean> {
        return await Model.delete(tableName, id, orm);
      }

      static async deleteWhere(
        conditions: TypeWhereCondtion<T>
      ): Promise<number> {
        return await Model.deleteWhere(tableName, conditions, orm);
      }

      static async upsert(data: Partial<T>): Promise<T> {
        return await Model.upsert<T>(tableName, data, orm);
      }

      static async upsertWithCoalesce(data: Partial<T>): Promise<T> {
        return await Model.upsertWithCoalesce<T>(tableName, data, orm);
      }

      static async count(conditions: WhereConditions = {}): Promise<number> {
        return await Model.count(tableName, conditions, orm);
      }

      // Query Builder methods - Méthodes fluides
      static where(conditions: TypeWhereCondtion<T>): QueryBuilder<T> {
        return new QueryBuilderImpl(tableName, orm).where(conditions);
      }

      static orderBy(
        column: string,
        direction: "ASC" | "DESC" = "ASC"
      ): QueryBuilder<T> {
        return new QueryBuilderImpl(tableName, orm).orderBy(column, direction);
      }

      static limit(limit: number): QueryBuilder<T> {
        return new QueryBuilderImpl(tableName, orm).limit(limit);
      }

      static offset(offset: number): QueryBuilder<T> {
        return new QueryBuilderImpl(tableName, orm).offset(offset);
      }

      static include(
        options: IncludeOptions | IncludeOptions[]
      ): QueryBuilder<T> {
        return new QueryBuilderImpl(tableName, orm).include(options);
      }

      // Métadonnées exportées
      static keys = metadata.keys;
      static types = metadata.types;
      static tableName = tableName;
      static orm = orm;
    }

    return GeneratedModel as any;
  }
}

export class UUIDUtils {
  /**
   * Génère un UUID v4 en utilisant l'API Web Crypto native
   */
  static generate(): string {
    return crypto.randomUUID();
  }

  /**
   * Valide si une chaîne est un UUID valide
   */
  static isValid(uuid: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Génère un UUID court (sans tirets)
   */
  static generateShort(): string {
    return crypto.randomUUID().replace(/-/g, "");
  }
}

// Extension du Model pour supporter les UUID
export abstract class UUIDModel extends Model {
  // Créer un enregistrement avec UUID auto-généré
  static async createWithUUID<T extends DatabaseRow>(
    tableName: string,
    data: Partial<T>,
    orm: SimpleORM,
    idField: string = "id"
  ): Promise<T> {
    // Générer un UUID si l'ID n'est pas fourni
    if (!(data as any)[idField]) {
      (data as any)[idField] = UUIDUtils.generate();
    }

    const columns = Object.keys(data).join(", ");
    const placeholders = Object.keys(data)
      .map(() => "?")
      .join(", ");
    const values = Object.values(data);

    const sql = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`;
    await orm.run(sql, values);

    return data as T;
  }

  // Trouver par UUID
  static async findByUUID<T extends DatabaseRow>(
    tableName: string,
    uuid: string,
    orm: SimpleORM,
    options: { include?: IncludeOptions | IncludeOptions[] } = {},
    idField: string = "id"
  ): Promise<T | null> {
    if (!UUIDUtils.isValid(uuid)) {
      throw new Error("Invalid UUID format");
    }

    const { include } = options;
    const sql = `SELECT * FROM ${tableName} WHERE ${idField} = ?`;
    let result = await orm.get<T>(sql, [uuid]);

    // Handle includes
    if (result && include) {
      const results = await this.handleIncludes<T>(
        tableName,
        [result],
        include,
        orm
      );
      result = results[0];
    }

    return result;
  }
}

// Extension de ModelFactory pour supporter les UUID
export class UUIDModelFactory extends ModelFactory {
  createUUIDModel<T extends DatabaseRow>(
    tableName: string,
    schema: TableSchema = {},
    sampleData?: T,
    options: {
      idField?: string;
      autoGenerateUUID?: boolean;
    } = {}
  ): ModelClass<T> {
    const { idField = "id", autoGenerateUUID = true } = options;
    const baseModel = super.createModel<T>(tableName, schema, sampleData);

    // Classe étendue avec support UUID
    class UUIDGeneratedModel extends (baseModel as any) {
      // Override create pour auto-générer UUID
      static async create(data: Partial<T>): Promise<T> {
        if (autoGenerateUUID && !(data as any)[idField]) {
          (data as any)[idField] = UUIDUtils.generate();
        }
        return await UUIDModel.createWithUUID<T>(
          tableName,
          data,
          this.orm,
          idField
        );
      }

      // Override createMany pour auto-générer UUID
      static async createMany(dataArray: Partial<T>[]): Promise<T[]> {
        if (autoGenerateUUID) {
          dataArray.forEach((data) => {
            if (!(data as any)[idField]) {
              (data as any)[idField] = UUIDUtils.generate();
            }
          });
        }
        return await super.createMany(dataArray);
      }

      // Méthode pour trouver par UUID
      static async findByUUID(
        uuid: string,
        options: { include?: IncludeOptions | IncludeOptions[] } = {}
      ): Promise<T | null> {
        return await UUIDModel.findByUUID<T>(
          tableName,
          uuid,
          this.orm,
          options,
          idField
        );
      }

      // Override findById pour supporter UUID
      static async findById(
        id: string | number,
        options: { include?: IncludeOptions | IncludeOptions[] } = {}
      ): Promise<T | null> {
        // Si c'est un UUID, utiliser la méthode UUID
        if (typeof id === "string" && UUIDUtils.isValid(id)) {
          return await this.findByUUID(id, options);
        }
        // Sinon utiliser la méthode normale
        return await super.findById(id, options);
      }

      // Méthode utilitaire pour valider UUID
      static isValidUUID(uuid: string): boolean {
        return UUIDUtils.isValid(uuid);
      }

      // Générer un nouvel UUID
      static generateUUID(): string {
        return UUIDUtils.generate();
      }
    }

    return UUIDGeneratedModel as any;
  }
}

// Exports
export { SimpleORM, ModelFactory };
