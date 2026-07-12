import { ModelFactory, SimpleORM } from './simpleorm'

// ─── Types ──────────────────────────────────────────────────────────────────

export type Travail = {
  id: number
  title: string
  description: string
  location: string | null
  year: string | null
  category: string | null
  cover_image: string | null
  created_at: number
}

export type TravailImage = {
  id: number
  travail_id: number
  url: string
  position: number
}

export type Catalogue = {
  id: number
  title: string
  description: string | null
  cover_image: string
  created_at: number
}

export type Produit = {
  id: number
  title: string
  description: string
  price: string | null
  category: string | null
  cover_image: string | null
  catalogue_id: number | null
  remote_article_id: string | null
  created_at: number
}

export type ProduitImage = {
  id: number
  produit_id: number
  url: string
  position: number
}

export type KataleyaConfig = {
  id: number
  base_url: string
  token: string
  email: string
  connected_at: number
}

// ─── Schémas SQL ─────────────────────────────────────────────────────────────

const travailSchema = {
  id:          'INTEGER PRIMARY KEY AUTOINCREMENT',
  title:       'TEXT NOT NULL',
  description: 'TEXT NOT NULL',
  location:    'TEXT',
  year:        'TEXT',
  category:    'TEXT',
  cover_image: 'TEXT',
  created_at:  'INTEGER NOT NULL',
}

const travailImageSchema = {
  id:          'INTEGER PRIMARY KEY AUTOINCREMENT',
  travail_id:  'INTEGER NOT NULL',
  url:         'TEXT NOT NULL',
  position:    'INTEGER NOT NULL',
}

const catalogueSchema = {
  id:          'INTEGER PRIMARY KEY AUTOINCREMENT',
  title:       'TEXT NOT NULL',
  description: 'TEXT',
  cover_image: 'TEXT NOT NULL',
  created_at:  'INTEGER NOT NULL',
}

const produitSchema = {
  id:           'INTEGER PRIMARY KEY AUTOINCREMENT',
  title:        'TEXT NOT NULL',
  description:  'TEXT NOT NULL',
  price:        'TEXT',
  category:     'TEXT',
  cover_image:  'TEXT',
  catalogue_id: 'INTEGER',
  created_at:   'INTEGER NOT NULL',
}

const produitImageSchema = {
  id:          'INTEGER PRIMARY KEY AUTOINCREMENT',
  produit_id:  'INTEGER NOT NULL',
  url:         'TEXT NOT NULL',
  position:    'INTEGER NOT NULL',
}

const kataleyaConfigSchema = {
  id:           'INTEGER PRIMARY KEY',
  base_url:     'TEXT NOT NULL',
  token:        'TEXT NOT NULL',
  email:        'TEXT NOT NULL',
  connected_at: 'INTEGER NOT NULL',
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createModels(db: D1Database) {
  const orm = new SimpleORM(db)
  const intFactory = new ModelFactory(orm)

  return {
    orm,
    Travaux:        intFactory.createModel<Travail>('travaux', travailSchema as any),
    TravauxImages:  intFactory.createModel<TravailImage>('travaux_images', travailImageSchema as any),
    Catalogues:     intFactory.createModel<Catalogue>('catalogues', catalogueSchema as any),
    Produits:       intFactory.createModel<Produit>('produits', produitSchema as any),
    ProduitsImages: intFactory.createModel<ProduitImage>('produits_images', produitImageSchema as any),
    KataleyaConfig: intFactory.createModel<KataleyaConfig>('kataleya_config', kataleyaConfigSchema as any),
  }
}

// ─── Initialisation des tables ────────────────────────────────────────────────

export async function initTravauxTables(db: D1Database): Promise<void> {
  const models = createModels(db)
  await models.Travaux.createTable()
  await models.TravauxImages.createTable()
  await models.orm.run(
    'CREATE INDEX IF NOT EXISTS idx_travaux_images_travail ON travaux_images(travail_id, position)'
  )
}

export async function initCataloguesTables(db: D1Database): Promise<void> {
  const models = createModels(db)
  await models.Catalogues.createTable()
}

export async function initProduitsTables(db: D1Database): Promise<void> {
  const models = createModels(db)
  await models.Produits.createTable()
  await models.ProduitsImages.createTable()
  await models.orm.addColumnIfNotExists('produits', 'catalogue_id', 'INTEGER')
  await models.orm.addColumnIfNotExists('produits', 'remote_article_id', 'TEXT')
  await models.orm.run(
    'CREATE INDEX IF NOT EXISTS idx_produits_images_produit ON produits_images(produit_id, position)'
  )
  await models.orm.run(
    'CREATE INDEX IF NOT EXISTS idx_produits_catalogue ON produits(catalogue_id)'
  )
  await models.orm.run(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_produits_remote_article ON produits(remote_article_id) WHERE remote_article_id IS NOT NULL'
  )
}

export async function initKataleyaConfigTable(db: D1Database): Promise<void> {
  const models = createModels(db)
  await models.KataleyaConfig.createTable()
}
