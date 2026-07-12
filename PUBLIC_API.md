# API publique Kataleya — spécification pour le site internet

Document à destination d'une IA qui doit implémenter le client (ou un proxy
serveur) côté site internet d'administration. Décrit les endpoints publics
exposés par le serveur Cloudflare Workers Kataleya pour afficher le catalogue
(collections, sous-collections, articles en stock) et authentifier un
super_admin sur le site.

## Contexte

- **Base URL** : `https://<workers-domain>` (Cloudflare Workers). En local :
  `http://127.0.0.1:8787`.
- **Format** : JSON (request & response). UTF-8.
- **CORS** : `*` autorisé. Headers acceptés : `Authorization`, `Content-Type`,
  `X-Client-ID`, `X-Journal-ID`. Méthodes : `GET, POST, PUT, DELETE, OPTIONS`.
- **Auth** : JWT (HS256) émis par le serveur. Transport : header
  `Authorization: Bearer <token>`. TTL par défaut : **7 jours**.
- **Convention dates** : ISO-8601 string (`2026-06-17T10:00:00.000Z`).
- **Convention montants** : nombres décimaux (REAL SQLite). TVA exprimée en %
  (ex. `20` pour 20 %).

## Authentification

### `POST /public/login`

Authentifie un compte **super_admin** uniquement. Tout autre rôle (`admin`,
`gestionnaire`, `vendeur`) est refusé avec `403`.

**Request body**
```json
{
  "email": "admin@example.com",
  "password": "motdepasse"
}
```

**Réponses**

| Code | Cas |
|------|-----|
| 200  | Auth OK, renvoie `{ token, user }` |
| 400  | `email` ou `password` manquant |
| 401  | Identifiants invalides ou compte `statut != "actif"` |
| 403  | Le compte existe mais `role != "super_admin"` |

**Response 200**
```json
{
  "token": "<jwt>",
  "user": {
    "id": "uuid",
    "email": "admin@example.com",
    "nom": "Dupont",
    "prenom": "Jean",
    "role": "super_admin"
  }
}
```

**Notes**
- Le token contient les claims : `sub` (user id), `email`, `role`, `iss`
  (`"kataleya"`), `iat`, `exp`.
- Effet de bord : `derniereConnexion` et `updatedAt` de l'admin sont mis à jour.
- Stocker le token côté site (httpOnly cookie recommandé si proxy, sinon
  localStorage en dernier recours). Renvoyer dans le header `Authorization`
  pour les appels suivants.

### `GET /public/me`

Vérifie la session courante. Requiert `Authorization: Bearer <token>`.

**Réponses**

| Code | Cas |
|------|-----|
| 200  | Session valide, renvoie le profil |
| 401  | Token manquant ou invalide/expiré |
| 403  | Token valide mais rôle ≠ `super_admin` |
| 404  | L'admin référencé par le token n'existe plus |

**Response 200**
```json
{
  "id": "uuid",
  "email": "admin@example.com",
  "nom": "Dupont",
  "prenom": "Jean",
  "role": "super_admin"
}
```

## Catalogue (lecture anonyme)

Aucun token requis pour les endpoints ci-dessous. Filtre serveur :
`statut = 'actif'` partout, et `stockTotal > 0` pour les articles.

### `GET /public/collections`

Liste les collections actives. Tri : `ordre` croissant (NULL en dernier) puis
`nom`.

**Response 200**
```json
{
  "items": [
    {
      "id": "uuid",
      "nom": "Carrelage",
      "description": "…",
      "ordre": 1,
      "quantite": 42,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-06-10T00:00:00.000Z"
    }
  ]
}
```

### `GET /public/sous-collections`

Liste les sous-collections actives.

**Query params**

| Param | Type | Obligatoire | Description |
|-------|------|-------------|-------------|
| `collectionId` | string | non | Filtre par collection parente |

**Response 200**
```json
{
  "items": [
    {
      "id": "uuid",
      "collectionId": "uuid",
      "nom": "Grès cérame",
      "description": "…",
      "image": "filename.jpg",
      "ordre": 1,
      "createdAt": "…",
      "updatedAt": "…"
    }
  ]
}
```

**Note images** : `image` est un *basename* (ex. `"abc-123.jpg"`). L'image
elle-même n'est PAS publique : elle est servie par `/images/:name` qui
**requiert un token**. Le site doit donc proxy-er la lecture via son backend
authentifié, OU héberger ses propres assets visuels.

### `GET /public/articles`

Liste paginée d'articles actifs en stock (`stockTotal > 0`).

**Query params**

| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| `collectionId` | string | – | Filtre |
| `sousCollectionId` | string | – | Filtre |
| `q` | string | – | Recherche LIKE sur `nom` + `reference` (insensible casse) |
| `limit` | int | `50` | Max `200` |
| `offset` | int | `0` | Pagination |

**Response 200**
```json
{
  "items": [
    {
      "id": "uuid",
      "collectionId": "uuid",
      "sousCollectionId": "uuid",
      "nom": "Carrelage 60x60 beige",
      "description": "…",
      "reference": "REF-001",
      "unite": "m²",
      "prixHT": 25.0,
      "tauxTVA": 20,
      "prixTTC": 30.0,
      "dimensions": "60x60",
      "images": "[\"a.jpg\",\"b.jpg\"]",
      "stockTotal": 120,
      "createdAt": "…",
      "updatedAt": "…"
    }
  ],
  "total": 137,
  "limit": 50,
  "offset": 0
}
```

**À noter**
- `images` est une **string JSON** (tableau de basenames). Le site doit
  `JSON.parse(images)` puis résoudre l'URL via son propre proxy
  (cf. note images plus haut).
- `tauxTVA` est en pourcentage entier ou décimal (ex. `20`).
- `stockTotal` est l'agrégat global toutes boutiques confondues. La
  répartition par boutique n'est PAS exposée publiquement.

### `GET /public/articles/:id`

Détail d'un article. Renvoie `404` si introuvable ou `statut != "actif"`.

**Response 200** : même schéma qu'un item de `/public/articles` plus
`statut`, `createdBy`. (Schéma complet de la table `articles`.)

## Schéma type côté client

```ts
export interface Collection {
  id: string;
  nom: string;
  description?: string;
  ordre?: number;
  quantite: number;
  createdAt: string;
  updatedAt: string;
}

export interface SousCollection {
  id: string;
  collectionId: string;
  nom: string;
  description?: string;
  image?: string;
  ordre?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Article {
  id: string;
  collectionId: string;
  sousCollectionId?: string;
  nom: string;
  description?: string;
  reference: string;
  unite: string;
  prixHT: number;
  tauxTVA: number;
  prixTTC: number;
  dimensions?: string;
  images: string;       // JSON string → string[]
  stockTotal: number;
  createdAt: string;
  updatedAt: string;
}

export interface SuperAdminUser {
  id: string;
  email: string;
  nom: string;
  prenom: string;
  role: "super_admin";
}

export interface LoginResponse {
  token: string;
  user: SuperAdminUser;
}
```

## Exemple — client minimal (fetch)

```ts
const BASE_URL = "https://<workers-domain>";

export async function login(email: string, password: string): Promise<LoginResponse> {
  const r = await fetch(`${BASE_URL}/public/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
  return r.json();
}

export async function me(token: string): Promise<SuperAdminUser> {
  const r = await fetch(`${BASE_URL}/public/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
  return r.json();
}

export async function listCollections(): Promise<Collection[]> {
  const r = await fetch(`${BASE_URL}/public/collections`);
  const data = await r.json();
  return data.items;
}

export async function listSousCollections(collectionId?: string): Promise<SousCollection[]> {
  const qs = collectionId ? `?collectionId=${encodeURIComponent(collectionId)}` : "";
  const r = await fetch(`${BASE_URL}/public/sous-collections${qs}`);
  return (await r.json()).items;
}

export async function listArticles(params: {
  collectionId?: string;
  sousCollectionId?: string;
  q?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ items: Article[]; total: number; limit: number; offset: number }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v));
  const r = await fetch(`${BASE_URL}/public/articles?${qs}`);
  return r.json();
}
```

## Recommandations d'implémentation côté site admin

1. **Stocker le JWT côté serveur** (session cookie httpOnly, secure, SameSite=Lax)
   plutôt que dans `localStorage`. Le site agit alors comme proxy : il appelle
   l'API Kataleya en injectant le `Authorization` lui-même.
2. **Proxy des images** : créer un endpoint `/proxy/images/:name` côté site qui
   ajoute le Bearer token et stream le binaire depuis `/images/:name` du serveur
   Kataleya. Cache HTTP côté CDN (les basenames sont content-addressed donc
   immuables tant que le fichier ne change pas).
3. **Rafraîchissement** : aucune route refresh-token. Le JWT dure 7 jours. Au
   `401` côté serveur, rediriger vers le formulaire de login.
4. **Erreurs** : toutes les erreurs renvoient `{ "error": "<message>" }` avec
   le code HTTP approprié. Afficher `error` à l'utilisateur final.
5. **Recherche** : le paramètre `q` est un LIKE simple. Pour la frappe au
   clavier, debouncer ≥ 250 ms.
6. **Pagination** : `total` permet de calculer le nombre de pages. Préférer
   `offset/limit` à un curseur (pas exposé).

## Hors scope (non exposé publiquement)

Les éléments suivants ne sont **pas** disponibles via `/public/*` — ne pas
tenter de les requêter, retour `401/404` :

- Clients, devis, factures, lignes de documents, paiements.
- Boutiques, stocks par boutique, transferts de stock.
- Techniciens, projets, tâches.
- Journal de synchronisation.
- Création / modification de quelque entité que ce soit (lecture seule).
