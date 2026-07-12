import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { initTravauxTables, initCataloguesTables, initProduitsTables, initKataleyaConfigTable } from "../utils/tables";

type Bindings = {
    ASSETS: Fetcher;
    ADMIN_PASSWORD: string;
    ADMIN_SESSION_SECRET: string;
    kataleya_admin_db: D1Database;
    kataleya_admin_bucket: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

const SESSION_COOKIE = "lk_admin";

let dbReady: Promise<void> | null = null;
async function ensureDb(env: Bindings) {
    if (!dbReady) dbReady = Promise.all([
        initTravauxTables(env.kataleya_admin_db),
        initCataloguesTables(env.kataleya_admin_db),
        initProduitsTables(env.kataleya_admin_db),
        initKataleyaConfigTable(env.kataleya_admin_db),
    ]).then(() => undefined).catch((e) => {
        dbReady = null;
        throw e;
    });
    return dbReady;
}

app.use("*", async (c, next) => {
    await ensureDb(c.env);
    return next();
});

async function sign(value: string, secret: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function makeToken(secret: string): Promise<string> {
    const payload = String(Date.now());
    const sig = await sign(payload, secret);
    return `${payload}.${sig}`;
}

async function verifyToken(token: string, secret: string): Promise<boolean> {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return false;
    const expected = await sign(payload, secret);
    return expected === sig;
}

async function isAuthed(c: Context<{ Bindings: Bindings }>): Promise<boolean> {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return false;
    return verifyToken(token, c.env.ADMIN_SESSION_SECRET);
}

// ---------- Auth ----------

app.post("/api/admin/login", async (c) => {
    const body = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }));
    if (!body.password || body.password !== c.env.ADMIN_PASSWORD) {
        return c.json({ ok: false, error: "Mot de passe incorrect." }, 401);
    }
    const token = await makeToken(c.env.ADMIN_SESSION_SECRET);
    setCookie(c, SESSION_COOKIE, token, {
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        path: "/",
        maxAge: 60 * 60 * 8,
    });
    return c.json({ ok: true });
});

app.post("/api/admin/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
});

app.get("/api/admin/me", async (c) => {
    return c.json({ authed: await isAuthed(c) });
});

// ---------- Travaux: public read ----------

type TravailRow = {
    id: number;
    title: string;
    description: string;
    location: string | null;
    year: string | null;
    category: string | null;
    cover_image: string | null;
    created_at: number;
};

app.get("/api/travaux", async (c) => {
    const { results } = await c.env.kataleya_admin_db
        .prepare("SELECT * FROM travaux ORDER BY created_at DESC")
        .all<TravailRow>();
    return c.json({ travaux: results ?? [] });
});

app.get("/api/travaux/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "id invalide" }, 400);
    const travail = await c.env.kataleya_admin_db
        .prepare("SELECT * FROM travaux WHERE id = ?")
        .bind(id)
        .first<TravailRow>();
    if (!travail) return c.json({ error: "introuvable" }, 404);
    const { results: images } = await c.env.kataleya_admin_db
        .prepare("SELECT id, url, position FROM travaux_images WHERE travail_id = ? ORDER BY position ASC, id ASC")
        .bind(id)
        .all<{ id: number; url: string; position: number }>();
    return c.json({ travail, images: images ?? [] });
});

// ---------- Catalogues: public read ----------

type CatalogueRow = {
    id: number;
    title: string;
    description: string | null;
    cover_image: string;
    created_at: number;
};

app.get("/api/catalogues", async (c) => {
    const { results } = await c.env.kataleya_admin_db
        .prepare("SELECT * FROM catalogues ORDER BY created_at DESC")
        .all<CatalogueRow>();
    return c.json({ catalogues: results ?? [] });
});

app.get("/api/catalogues/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "id invalide" }, 400);
    const catalogue = await c.env.kataleya_admin_db
        .prepare("SELECT * FROM catalogues WHERE id = ?")
        .bind(id)
        .first<CatalogueRow>();
    if (!catalogue) return c.json({ error: "introuvable" }, 404);
    const { results: produits } = await c.env.kataleya_admin_db
        .prepare("SELECT * FROM produits WHERE catalogue_id = ? ORDER BY created_at DESC")
        .bind(id)
        .all<ProduitRow>();
    return c.json({ catalogue, produits: produits ?? [] });
});

// ---------- Produits: public read ----------

type ProduitRow = {
    id: number;
    title: string;
    description: string;
    price: string | null;
    category: string | null;
    cover_image: string | null;
    catalogue_id: number | null;
    remote_article_id: string | null;
    created_at: number;
    catalogue_title?: string | null;
};

app.get("/api/produits", async (c) => {
    const { results } = await c.env.kataleya_admin_db
        .prepare(
            "SELECT produits.*, catalogues.title as catalogue_title FROM produits LEFT JOIN catalogues ON catalogues.id = produits.catalogue_id ORDER BY produits.created_at DESC"
        )
        .all<ProduitRow>();
    return c.json({ produits: results ?? [] });
});

app.get("/api/produits/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "id invalide" }, 400);
    const produit = await c.env.kataleya_admin_db
        .prepare(
            "SELECT produits.*, catalogues.title as catalogue_title FROM produits LEFT JOIN catalogues ON catalogues.id = produits.catalogue_id WHERE produits.id = ?"
        )
        .bind(id)
        .first<ProduitRow>();
    if (!produit) return c.json({ error: "introuvable" }, 404);
    const { results: images } = await c.env.kataleya_admin_db
        .prepare("SELECT id, url, position FROM produits_images WHERE produit_id = ? ORDER BY position ASC, id ASC")
        .bind(id)
        .all<{ id: number; url: string; position: number }>();
    return c.json({ produit, images: images ?? [] });
});

// ---------- Admin middleware ----------

app.use("/api/admin/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path === "/api/admin/login" || path === "/api/admin/logout" || path === "/api/admin/me") {
        return next();
    }
    if (!(await isAuthed(c))) return c.json({ error: "non autorisé" }, 401);
    return next();
});

// ---------- Travaux: admin write ----------

type TravailInput = {
    title?: string;
    description?: string;
    location?: string | null;
    year?: string | null;
    category?: string | null;
    cover_image?: string | null;
    images?: string[];
};

app.post("/api/admin/travaux", async (c) => {
    const body = await c.req.json<TravailInput>().catch(() => ({} as TravailInput));
    if (!body.title) return c.json({ error: "titre requis" }, 400);
    const res = await c.env.kataleya_admin_db
        .prepare(
            "INSERT INTO travaux (title, description, location, year, category, cover_image, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
            body.title,
            body.description ?? "",
            body.location ?? null,
            body.year ?? null,
            body.category ?? null,
            body.cover_image ?? null,
            Date.now()
        )
        .run();
    const id = Number(res.meta.last_row_id);
    if (body.images && body.images.length > 0) {
        const stmt = c.env.kataleya_admin_db.prepare(
            "INSERT INTO travaux_images (travail_id, url, position) VALUES (?, ?, ?)"
        );
        await c.env.kataleya_admin_db.batch(
            body.images.map((url, i) => stmt.bind(id, url, i))
        );
    }
    return c.json({ ok: true, id });
});

app.put("/api/admin/travaux/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "id invalide" }, 400);
    const body = await c.req.json<TravailInput>().catch(() => ({} as TravailInput));
    if (!body.title) return c.json({ error: "titre requis" }, 400);
    await c.env.kataleya_admin_db
        .prepare(
            "UPDATE travaux SET title = ?, description = ?, location = ?, year = ?, category = ?, cover_image = ? WHERE id = ?"
        )
        .bind(
            body.title,
            body.description ?? "",
            body.location ?? null,
            body.year ?? null,
            body.category ?? null,
            body.cover_image ?? null,
            id
        )
        .run();
    if (body.images) {
        await c.env.kataleya_admin_db
            .prepare("DELETE FROM travaux_images WHERE travail_id = ?")
            .bind(id)
            .run();
        if (body.images.length > 0) {
            const stmt = c.env.kataleya_admin_db.prepare(
                "INSERT INTO travaux_images (travail_id, url, position) VALUES (?, ?, ?)"
            );
            await c.env.kataleya_admin_db.batch(
                body.images.map((url, i) => stmt.bind(id, url, i))
            );
        }
    }
    return c.json({ ok: true });
});

app.delete("/api/admin/travaux/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "id invalide" }, 400);
    await c.env.kataleya_admin_db
        .prepare("DELETE FROM travaux_images WHERE travail_id = ?")
        .bind(id)
        .run();
    await c.env.kataleya_admin_db
        .prepare("DELETE FROM travaux WHERE id = ?")
        .bind(id)
        .run();
    return c.json({ ok: true });
});

// ---------- Produits: admin write ----------

type ProduitInput = {
    title?: string;
    description?: string;
    price?: string | null;
    category?: string | null;
    cover_image?: string | null;
    catalogue_id?: number | null;
    remote_article_id?: string | null;
    images?: string[];
};

app.post("/api/admin/produits", async (c) => {
    const body = await c.req.json<ProduitInput>().catch(() => ({} as ProduitInput));
    if (!body.title) return c.json({ error: "titre requis" }, 400);
    if (!body.catalogue_id) return c.json({ error: "catalogue requis" }, 400);
    const res = await c.env.kataleya_admin_db
        .prepare(
            "INSERT INTO produits (title, description, price, category, cover_image, catalogue_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
            body.title,
            body.description ?? "",
            body.price ?? null,
            body.category ?? null,
            body.cover_image ?? null,
            body.catalogue_id,
            Date.now()
        )
        .run();
    const id = Number(res.meta.last_row_id);
    if (body.images && body.images.length > 0) {
        const stmt = c.env.kataleya_admin_db.prepare(
            "INSERT INTO produits_images (produit_id, url, position) VALUES (?, ?, ?)"
        );
        await c.env.kataleya_admin_db.batch(
            body.images.map((url, i) => stmt.bind(id, url, i))
        );
    }
    return c.json({ ok: true, id });
});

app.put("/api/admin/produits/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "id invalide" }, 400);
    const body = await c.req.json<ProduitInput>().catch(() => ({} as ProduitInput));
    if (!body.title) return c.json({ error: "titre requis" }, 400);
    if (!body.catalogue_id) return c.json({ error: "catalogue requis" }, 400);
    await c.env.kataleya_admin_db
        .prepare(
            "UPDATE produits SET title = ?, description = ?, price = ?, category = ?, cover_image = ?, catalogue_id = ? WHERE id = ?"
        )
        .bind(
            body.title,
            body.description ?? "",
            body.price ?? null,
            body.category ?? null,
            body.cover_image ?? null,
            body.catalogue_id,
            id
        )
        .run();
    if (body.images) {
        await c.env.kataleya_admin_db
            .prepare("DELETE FROM produits_images WHERE produit_id = ?")
            .bind(id)
            .run();
        if (body.images.length > 0) {
            const stmt = c.env.kataleya_admin_db.prepare(
                "INSERT INTO produits_images (produit_id, url, position) VALUES (?, ?, ?)"
            );
            await c.env.kataleya_admin_db.batch(
                body.images.map((url, i) => stmt.bind(id, url, i))
            );
        }
    }
    return c.json({ ok: true });
});

app.delete("/api/admin/produits/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "id invalide" }, 400);
    await c.env.kataleya_admin_db
        .prepare("DELETE FROM produits_images WHERE produit_id = ?")
        .bind(id)
        .run();
    await c.env.kataleya_admin_db
        .prepare("DELETE FROM produits WHERE id = ?")
        .bind(id)
        .run();
    return c.json({ ok: true });
});

// ---------- Catalogues: admin write ----------

type CatalogueInput = {
    title?: string;
    description?: string | null;
    cover_image?: string | null;
};

app.post("/api/admin/catalogues", async (c) => {
    const body = await c.req.json<CatalogueInput>().catch(() => ({} as CatalogueInput));
    if (!body.title) return c.json({ error: "titre requis" }, 400);
    if (!body.cover_image) return c.json({ error: "image principale requise" }, 400);
    const res = await c.env.kataleya_admin_db
        .prepare("INSERT INTO catalogues (title, description, cover_image, created_at) VALUES (?, ?, ?, ?)")
        .bind(body.title, body.description ?? null, body.cover_image, Date.now())
        .run();
    return c.json({ ok: true, id: Number(res.meta.last_row_id) });
});

app.put("/api/admin/catalogues/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "id invalide" }, 400);
    const body = await c.req.json<CatalogueInput>().catch(() => ({} as CatalogueInput));
    if (!body.title) return c.json({ error: "titre requis" }, 400);
    if (!body.cover_image) return c.json({ error: "image principale requise" }, 400);
    await c.env.kataleya_admin_db
        .prepare("UPDATE catalogues SET title = ?, description = ?, cover_image = ? WHERE id = ?")
        .bind(body.title, body.description ?? null, body.cover_image, id)
        .run();
    return c.json({ ok: true });
});

app.delete("/api/admin/catalogues/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "id invalide" }, 400);
    await c.env.kataleya_admin_db
        .prepare("UPDATE produits SET catalogue_id = NULL WHERE catalogue_id = ?")
        .bind(id)
        .run();
    await c.env.kataleya_admin_db
        .prepare("DELETE FROM catalogues WHERE id = ?")
        .bind(id)
        .run();
    return c.json({ ok: true });
});

// ---------- Kataleya remote: admin config + proxy ----------

type KataleyaConfigRow = {
    id: number;
    base_url: string;
    token: string;
    email: string;
    connected_at: number;
};

async function getKataleyaConfig(c: Context<{ Bindings: Bindings }>): Promise<KataleyaConfigRow | null> {
    return c.env.kataleya_admin_db
        .prepare("SELECT * FROM kataleya_config WHERE id = 1")
        .first<KataleyaConfigRow>();
}

app.get("/api/admin/kataleya/status", async (c) => {
    const config = await getKataleyaConfig(c);
    if (!config) return c.json({ connected: false });
    return c.json({ connected: true, baseUrl: config.base_url, email: config.email });
});

app.post("/api/admin/kataleya/connect", async (c) => {
    const body = await c.req
        .json<{ baseUrl?: string; email?: string; password?: string }>()
        .catch(() => ({} as { baseUrl?: string; email?: string; password?: string }));
    if (!body.baseUrl || !body.email || !body.password) {
        return c.json({ error: "url, email et mot de passe requis" }, 400);
    }
    const baseUrl = body.baseUrl.trim().replace(/\/+$/, "");
    let remoteRes: Response;
    try {
        remoteRes = await fetch(`${baseUrl}/public/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: body.email, password: body.password }),
        });
    } catch {
        return c.json({ error: "impossible de joindre le serveur" }, 502);
    }
    const data = await remoteRes.json<{ token?: string; user?: unknown; error?: string }>().catch(() => ({} as { token?: string; user?: unknown; error?: string }));
    if (!remoteRes.ok || !data.token) {
        return c.json({ error: data.error || "connexion refusée" }, 401);
    }
    await c.env.kataleya_admin_db
        .prepare(
            "INSERT INTO kataleya_config (id, base_url, token, email, connected_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, token = excluded.token, email = excluded.email, connected_at = excluded.connected_at"
        )
        .bind(baseUrl, data.token, body.email, Date.now())
        .run();
    return c.json({ ok: true, user: data.user });
});

app.post("/api/admin/kataleya/disconnect", async (c) => {
    await c.env.kataleya_admin_db.prepare("DELETE FROM kataleya_config WHERE id = 1").run();
    return c.json({ ok: true });
});

async function kataleyaProxy(c: Context<{ Bindings: Bindings }>, path: string): Promise<Response> {
    const config = await getKataleyaConfig(c);
    if (!config) return c.json({ error: "non connecté au serveur Kataleya" }, 400);
    const url = new URL(`${config.base_url}${path}`);
    new URL(c.req.url).searchParams.forEach((v, k) => url.searchParams.set(k, v));
    let remoteRes: Response;
    try {
        remoteRes = await fetch(url.toString(), { headers: { Authorization: `Bearer ${config.token}` } });
    } catch {
        return c.json({ error: "impossible de joindre le serveur" }, 502);
    }
    const body = await remoteRes.text();
    return new Response(body, {
        status: remoteRes.status,
        headers: { "content-type": "application/json" },
    });
}

app.get("/api/admin/kataleya/collections", (c) => kataleyaProxy(c, "/public/collections"));
app.get("/api/admin/kataleya/sous-collections", (c) => kataleyaProxy(c, "/public/sous-collections"));
app.get("/api/admin/kataleya/articles", (c) => kataleyaProxy(c, "/public/articles"));
app.get("/api/admin/kataleya/articles/:id", (c) => kataleyaProxy(c, `/public/articles/${c.req.param("id")}`));

type KataleyaArticle = {
    id: string;
    collectionId: string;
    sousCollectionId?: string;
    nom: string;
    description?: string;
    prixTTC?: number;
    images?: string;
};

async function fetchKataleyaArticles(
    config: KataleyaConfigRow,
    filter: { collectionId?: string; sousCollectionId?: string }
): Promise<KataleyaArticle[]> {
    const items: KataleyaArticle[] = [];
    const limit = 200;
    let offset = 0;
    for (let page = 0; page < 10; page++) {
        const url = new URL(`${config.base_url}/public/articles`);
        if (filter.collectionId) url.searchParams.set("collectionId", filter.collectionId);
        if (filter.sousCollectionId) url.searchParams.set("sousCollectionId", filter.sousCollectionId);
        url.searchParams.set("limit", String(limit));
        url.searchParams.set("offset", String(offset));
        const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${config.token}` } });
        if (!res.ok) break;
        const data = await res
            .json<{ items?: KataleyaArticle[]; total?: number }>()
            .catch(() => ({} as { items?: KataleyaArticle[]; total?: number }));
        const page_items = data.items ?? [];
        items.push(...page_items);
        offset += limit;
        if (page_items.length < limit || items.length >= (data.total ?? 0)) break;
    }
    return items;
}

async function fetchKataleyaArticlesByIds(config: KataleyaConfigRow, ids: string[]): Promise<KataleyaArticle[]> {
    const results = await Promise.all(
        ids.map(async (id) => {
            const res = await fetch(`${config.base_url}/public/articles/${encodeURIComponent(id)}`, {
                headers: { Authorization: `Bearer ${config.token}` },
            });
            if (!res.ok) return null;
            return res.json<KataleyaArticle>().catch(() => null);
        })
    );
    return results.filter((a): a is KataleyaArticle => a !== null);
}

async function importKataleyaArticles(
    db: D1Database,
    catalogueId: number,
    articles: KataleyaArticle[]
): Promise<number> {
    let count = 0;
    for (const article of articles) {
        let imageNames: string[] = [];
        try {
            imageNames = article.images ? JSON.parse(article.images) : [];
        } catch {
            imageNames = [];
        }
        const imageUrls = imageNames.map((n) => `/img/kataleya/${n}`);
        const coverImage = imageUrls[0] ?? null;
        const price = article.prixTTC != null ? String(article.prixTTC) : null;

        const existing = await db
            .prepare("SELECT id FROM produits WHERE remote_article_id = ?")
            .bind(article.id)
            .first<{ id: number }>();

        let produitId: number;
        if (existing) {
            produitId = existing.id;
            await db
                .prepare(
                    "UPDATE produits SET title = ?, description = ?, price = ?, cover_image = ?, catalogue_id = ? WHERE id = ?"
                )
                .bind(article.nom, article.description ?? "", price, coverImage, catalogueId, produitId)
                .run();
        } else {
            const res = await db
                .prepare(
                    "INSERT INTO produits (title, description, price, category, cover_image, catalogue_id, remote_article_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
                )
                .bind(article.nom, article.description ?? "", price, null, coverImage, catalogueId, article.id, Date.now())
                .run();
            produitId = Number(res.meta.last_row_id);
        }

        await db.prepare("DELETE FROM produits_images WHERE produit_id = ?").bind(produitId).run();
        if (imageUrls.length > 0) {
            const stmt = db.prepare("INSERT INTO produits_images (produit_id, url, position) VALUES (?, ?, ?)");
            await db.batch(imageUrls.map((url, i) => stmt.bind(produitId, url, i)));
        }
        count++;
    }
    return count;
}

app.post("/api/admin/catalogues/:id/kataleya-import", async (c) => {
    const catalogueId = Number(c.req.param("id"));
    if (!Number.isFinite(catalogueId)) return c.json({ error: "id invalide" }, 400);
    const catalogue = await c.env.kataleya_admin_db
        .prepare("SELECT id FROM catalogues WHERE id = ?")
        .bind(catalogueId)
        .first<{ id: number }>();
    if (!catalogue) return c.json({ error: "catalogue introuvable" }, 404);

    const config = await getKataleyaConfig(c);
    if (!config) return c.json({ error: "non connecté au serveur Kataleya" }, 400);

    const body = await c.req
        .json<{ collectionId?: string; sousCollectionId?: string; articleIds?: string[] }>()
        .catch(() => ({} as { collectionId?: string; sousCollectionId?: string; articleIds?: string[] }));

    let articles: KataleyaArticle[] = [];
    if (body.articleIds && body.articleIds.length > 0) {
        articles = await fetchKataleyaArticlesByIds(config, body.articleIds);
    } else if (body.sousCollectionId) {
        articles = await fetchKataleyaArticles(config, { sousCollectionId: body.sousCollectionId });
    } else if (body.collectionId) {
        articles = await fetchKataleyaArticles(config, { collectionId: body.collectionId });
    } else {
        return c.json({ error: "collectionId, sousCollectionId ou articleIds requis" }, 400);
    }

    if (articles.length === 0) return c.json({ ok: true, imported: 0 });
    const imported = await importKataleyaArticles(c.env.kataleya_admin_db, catalogueId, articles);
    return c.json({ ok: true, imported });
});

app.get("/api/admin/kataleya/images/:name", async (c) => {
    const config = await getKataleyaConfig(c);
    if (!config) return c.json({ error: "non connecté au serveur Kataleya" }, 400);
    const name = c.req.param("name");
    let remoteRes: Response;
    try {
        remoteRes = await fetch(`${config.base_url}/images/${encodeURIComponent(name)}`, {
            headers: { Authorization: `Bearer ${config.token}` },
        });
    } catch {
        return c.json({ error: "impossible de joindre le serveur" }, 502);
    }
    if (!remoteRes.ok) return c.json({ error: "image introuvable" }, 404);
    const headers = new Headers();
    const ct = remoteRes.headers.get("content-type");
    if (ct) headers.set("content-type", ct);
    headers.set("cache-control", "public, max-age=31536000, immutable");
    return new Response(remoteRes.body, { headers });
});

// ---------- R2 image upload + serve ----------

app.post("/api/admin/upload", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file") as unknown as File | null;
    if (!file || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function") {
        return c.json({ error: "fichier manquant" }, 400);
    }
    const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const key = `travaux/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    await c.env.kataleya_admin_bucket.put(key, file.stream(), {
        httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
    return c.json({ ok: true, url: `/img/${key}`, key });
});

app.get("/img/kataleya/:name", async (c) => {
    const config = await getKataleyaConfig(c);
    if (!config) return c.notFound();
    const name = c.req.param("name");
    let remoteRes: Response;
    try {
        remoteRes = await fetch(`${config.base_url}/images/${encodeURIComponent(name)}`, {
            headers: { Authorization: `Bearer ${config.token}` },
        });
    } catch {
        return c.notFound();
    }
    if (!remoteRes.ok) return c.notFound();
    const headers = new Headers();
    const ct = remoteRes.headers.get("content-type");
    if (ct) headers.set("content-type", ct);
    headers.set("cache-control", "public, max-age=31536000, immutable");
    return new Response(remoteRes.body, { headers });
});

app.get("/img/*", async (c) => {
    const key = new URL(c.req.url).pathname.replace(/^\/img\//, "");
    const obj = await c.env.kataleya_admin_bucket.get(key);
    if (!obj) return c.notFound();
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);
    headers.set("cache-control", "public, max-age=31536000, immutable");
    return new Response(obj.body, { headers });
});

// ---------- Admin gating ----------

app.get("/admin/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/admin/login");
});

app.use("/admin/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path === "/admin/login" || path.startsWith("/admin/login/")) {
        return next();
    }
    if (!(await isAuthed(c))) {
        return c.redirect("/admin/login");
    }
    return next();
});

// ---------- Dynamic shell rewrites ----------
// Public /travaux/:id is served by a single static shell (id="_") that hydrates
// from the API based on window.location. We rewrite the asset request here.

async function serveShell(c: Context<{ Bindings: Bindings }>, shellPath: string) {
    const shellUrl = new URL(c.req.url);
    shellUrl.pathname = shellPath;
    const req = new Request(shellUrl.toString(), { method: "GET", headers: c.req.raw.headers });
    const res = await c.env.ASSETS.fetch(req);
    return new Response(res.body, {
        status: res.status,
        headers: { ...Object.fromEntries(res.headers), "cache-control": "no-store" },
    });
}

app.get("/travaux/:id", async (c) => {
    const id = c.req.param("id");
    if (id === "index.html" || id === "") return c.env.ASSETS.fetch(c.req.raw);
    return serveShell(c, "/travaux/_/index.html");
});

app.get("/admin/travaux/:id", async (c) => {
    const id = c.req.param("id");
    if (id === "nouveau" || id === "index.html" || id === "") {
        return c.env.ASSETS.fetch(c.req.raw);
    }
    return serveShell(c, "/admin/travaux/_/index.html");
});

app.get("/produits/:id", async (c) => {
    const id = c.req.param("id");
    if (id === "index.html" || id === "") return c.env.ASSETS.fetch(c.req.raw);
    return serveShell(c, "/produits/_/index.html");
});

app.get("/admin/produits/:id", async (c) => {
    const id = c.req.param("id");
    if (id === "nouveau" || id === "index.html" || id === "") {
        return c.env.ASSETS.fetch(c.req.raw);
    }
    return serveShell(c, "/admin/produits/_/index.html");
});

app.get("/catalogue/:id", async (c) => {
    const id = c.req.param("id");
    if (id === "index.html" || id === "") return c.env.ASSETS.fetch(c.req.raw);
    return serveShell(c, "/catalogue/_/index.html");
});

app.get("/admin/catalogue/:id", async (c) => {
    const id = c.req.param("id");
    if (id === "nouveau" || id === "index.html" || id === "") {
        return c.env.ASSETS.fetch(c.req.raw);
    }
    return serveShell(c, "/admin/catalogue/_/index.html");
});

// ---------- Static fallback ----------

app.all("*", async (c) => {
    return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
