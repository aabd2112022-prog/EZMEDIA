"use strict";

/*
=========================================================
 EZ MEDIA
 Global Smart Digital Media Platform
 Backend API + Smart Automation Engine
 Node.js 20+ / Express / PostgreSQL
 Railway Ready
 Version 8.1.0
=========================================================
*/

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

const PORT = Number(process.env.PORT || 3000);

const PLATFORM_NAME = "EZ MEDIA";
const PLATFORM_VERSION = "8.1.0";

const APP_URL =
  process.env.APP_URL ||
  "https://ez-media-ez-media.up.railway.app";

/*
=========================================================
 ENVIRONMENT / AUTOMATION
=========================================================
*/

const AUTOMATION_ENABLED =
  String(process.env.AUTOMATION_ENABLED || "true").toLowerCase() ===
  "true";

const AUTOMATION_INTERVAL_MS =
  Math.max(
    Number(process.env.AUTOMATION_INTERVAL_MS || 300000),
    60000
  );

const AUTO_PUBLISH =
  String(process.env.AUTO_PUBLISH || "false").toLowerCase() ===
  "true";

const AI_ENABLED =
  String(process.env.AI_ENABLED || "false").toLowerCase() ===
  "true";

const AI_API_KEY =
  process.env.AI_API_KEY || "";

const AI_API_URL =
  process.env.AI_API_URL || "";

const AI_MODEL =
  process.env.AI_MODEL || "";

const MAX_SOURCE_ITEMS =
  Math.min(
    Math.max(
      Number(process.env.MAX_SOURCE_ITEMS || 20),
      1
    ),
    100
  );

const FETCH_TIMEOUT_MS =
  Math.max(
    Number(process.env.FETCH_TIMEOUT_MS || 20000),
    5000
  );

/*
=========================================================
 SECURITY
=========================================================
*/

app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

app.use(
  cors({
    origin: true,
    credentials: false
  })
);

app.use(
  express.json({
    limit: "25mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "25mb"
  })
);

/*
=========================================================
 DATABASE
=========================================================
*/

const DATABASE_URL =
  process.env.DATABASE_URL || "";

let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  pool.on(
    "error",
    (error) => {
      console.error(
        "PostgreSQL pool error:",
        error
      );
    }
  );
}

/*
=========================================================
 HELPERS
=========================================================
*/

function createId() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function safeLimit(
  value,
  fallback = 20,
  max = 100
) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(
    Math.max(Math.floor(number), 1),
    max
  );
}

function dbRequired(res) {
  if (!pool) {
    res.status(503).json({
      success: false,
      error: "DATABASE_NOT_CONFIGURED",
      message:
        "قاعدة البيانات غير مربوطة."
    });

    return false;
  }

  return true;
}

function makeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(
      /[^\u0600-\u06FFa-z0-9\s-]/g,
      ""
    )
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeStatus(status) {
  const allowed = [
    "draft",
    "review",
    "ready",
    "published",
    "archived"
  ];

  return allowed.includes(status)
    ? status
    : "draft";
}

function cleanText(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[/gi, "")
    .replace(/\]\]>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCharCode(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(
        parseInt(n, 16)
      )
    );
}

function stripHtml(value) {
  return decodeXml(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(
  value,
  max = 500
) {
  const text = String(value || "").trim();

  if (text.length <= max) {
    return text;
  }

  return (
    text.slice(0, max).trim() +
    "..."
  );
}

function hashText(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}

function extractXmlTag(
  xml,
  tag
) {
  const regex = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "i"
  );

  const match =
    String(xml || "").match(regex);

  return match
    ? decodeXml(
        match[1]
      ).trim()
    : "";
}

function extractXmlLink(item) {
  const direct =
    extractXmlTag(
      item,
      "link"
    );

  if (direct) {
    return direct;
  }

  const atom =
    String(item || "").match(
      /<link[^>]+href=["']([^"']+)["']/i
    );

  return atom
    ? decodeXml(atom[1])
    : "";
}

function extractImageUrl(item) {
  const media =
    String(item || "").match(
      /<(?:media:content|media:thumbnail|enclosure)[^>]+url=["']([^"']+)["']/i
    );

  if (media) {
    return decodeXml(
      media[1]
    );
  }

  return "";
}

/*
=========================================================
 DEFAULT SECTIONS
=========================================================
*/

const DEFAULT_SECTIONS = [
  ["news", "الأخبار", "أحدث الأخبار والتحديثات", "📰"],
  ["articles", "المقالات", "مقالات وتحليلات رقمية", "📝"],
  ["coverage", "التغطيات", "تغطيات وفعاليات ميدانية", "🎥"],
  ["video", "الفيديو", "الإنتاج المرئي", "▶️"],
  ["podcast", "البودكاست", "البرامج والحلقات الصوتية", "🎙️"],
  ["live", "البث المباشر", "البث المباشر والفعاليات", "🔴"],
  ["satellite", "الفضائية", "محتوى القنوات والبث الفضائي", "📡"],
  ["ai", "الذكاء الاصطناعي", "الذكاء الاصطناعي للإعلام", "🤖"],
  ["automation", "الأتمتة", "الأتمتة وسير العمل", "⚙️"],
  ["advertising", "الإعلانات", "الخدمات والحملات الإعلانية", "📢"],
  ["sponsorship", "الرعاية", "الرعاية والشراكات", "🤝"],
  ["production", "الإنتاج", "التصوير والمونتاج والإخراج", "🎬"],
  ["studio", "الاستوديو", "التصوير والصوت والإضاءة", "🎞️"],
  ["events", "الفعاليات", "الفعاليات والمناسبات", "🎪"],
  ["community", "المجتمع", "قصص المجتمع والمبادرات", "👥"],
  ["business", "الأعمال", "الأعمال والاقتصاد", "💼"],
  ["technology", "التقنية", "التقنية والابتكار", "💻"],
  ["travel", "السفر", "الوجهات والتجارب", "✈️"],
  ["sports", "الرياضة", "الأخبار والتغطيات الرياضية", "🏆"],
  ["culture", "الثقافة", "الثقافة والفنون والمعرفة", "📚"],
  ["entertainment", "الترفيه", "الترفيه والفعاليات", "🎭"],
  ["photo", "الصورة", "الصور والتصوير الميداني", "📷"],
  ["audio", "الصوت", "الصوتيات والمقابلات", "🎧"],
  ["archive", "الأرشيف", "أرشيف المحتوى الإعلامي", "🗄️"],
  ["media-kit", "الملف الإعلامي", "نبذة وإنجازات وظهور إعلامي", "👤"],
  ["services", "الخدمات", "الخدمات الإعلامية والتسويقية", "💼"],
  ["commerce", "التجارة", "المتجر والمنتجات والخدمات التجارية", "🛒"],
  ["partners", "الشركاء", "الشركاء الإعلاميون والتجاريون", "🌐"],
  ["analytics", "التحليلات", "تحليلات الأداء والوصول", "📊"],
  ["media-center", "مركز الإعلام", "المواد الإعلامية والتواصل", "📺"]
];

/*
=========================================================
 DATABASE INITIALIZATION
=========================================================
*/

async function initializeDatabase() {
  if (!pool) {
    console.log(
      "DATABASE_URL غير موجودة — التشغيل بدون PostgreSQL."
    );
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      banner_url TEXT DEFAULT '',
      icon TEXT DEFAULT '▣',
      active BOOLEAN DEFAULT TRUE,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS content (
      id TEXT PRIMARY KEY,
      section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      slug TEXT UNIQUE,
      excerpt TEXT DEFAULT '',
      body TEXT DEFAULT '',
      type TEXT DEFAULT 'article',
      branch TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      video_url TEXT DEFAULT '',
      audio_url TEXT DEFAULT '',
      author TEXT DEFAULT 'EZ MEDIA',
      organization TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      featured BOOLEAN DEFAULT FALSE,
      scheduled_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      views BIGINT DEFAULT 0,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      title TEXT DEFAULT '',
      type TEXT DEFAULT 'image',
      url TEXT NOT NULL,
      mime_type TEXT DEFAULT '',
      size BIGINT DEFAULT 0,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT DEFAULT 'rss',
      active BOOLEAN DEFAULT TRUE,
      section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
      branch TEXT DEFAULT '',
      auto_publish BOOLEAN DEFAULT FALSE,
      fetch_interval_minutes INTEGER DEFAULT 30,
      last_fetch_at TIMESTAMPTZ,
      last_success_at TIMESTAMPTZ,
      last_error TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS source_items (
      id TEXT PRIMARY KEY,
      source_id TEXT REFERENCES sources(id) ON DELETE CASCADE,
      external_id TEXT DEFAULT '',
      title TEXT NOT NULL,
      link TEXT DEFAULT '',
      description TEXT DEFAULT '',
      published_at TIMESTAMPTZ,
      content_hash TEXT UNIQUE,
      raw_data JSONB DEFAULT '{}'::jsonb,
      processed BOOLEAN DEFAULT FALSE,
      content_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS banners (
      id TEXT PRIMARY KEY,
      section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      subtitle TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      link_url TEXT DEFAULT '',
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS automation_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'manual',
      status TEXT DEFAULT 'active',
      configuration JSONB DEFAULT '{}'::jsonb,
      last_run_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      status TEXT DEFAULT 'queued',
      message TEXT DEFAULT '',
      started_at TIMESTAMPTZ DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS automation_queue (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      source_item_id TEXT,
      content_id TEXT,
      action TEXT DEFAULT 'process',
      status TEXT DEFAULT 'queued',
      attempts INTEGER DEFAULT 0,
      error TEXT DEFAULT '',
      scheduled_at TIMESTAMPTZ DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS distribution_queue (
      id TEXT PRIMARY KEY,
      content_id TEXT,
      platform TEXT NOT NULL,
      status TEXT DEFAULT 'queued',
      payload JSONB DEFAULT '{}'::jsonb,
      attempts INTEGER DEFAULT 0,
      error TEXT DEFAULT '',
      scheduled_at TIMESTAMPTZ DEFAULT NOW(),
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      event_name TEXT NOT NULL,
      page TEXT DEFAULT '',
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT DEFAULT '',
      banner_url TEXT DEFAULT '',
      active BOOLEAN DEFAULT TRUE,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(section_id, slug)
    );

    CREATE TABLE IF NOT EXISTS partners (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'partner',
      logo_url TEXT DEFAULT '',
      website_url TEXT DEFAULT '',
      description TEXT DEFAULT '',
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS advertisements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      organization TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      link_url TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_content_status
      ON content(status);

    CREATE INDEX IF NOT EXISTS idx_content_type
      ON content(type);

    CREATE INDEX IF NOT EXISTS idx_content_section
      ON content(section_id);

    CREATE INDEX IF NOT EXISTS idx_content_branch
      ON content(branch);

    CREATE INDEX IF NOT EXISTS idx_content_published
      ON content(published_at);

    CREATE INDEX IF NOT EXISTS idx_events_created
      ON analytics_events(created_at);

    CREATE INDEX IF NOT EXISTS idx_branches_section
      ON branches(section_id);

    CREATE INDEX IF NOT EXISTS idx_source_items_source
      ON source_items(source_id);

    CREATE INDEX IF NOT EXISTS idx_source_items_processed
      ON source_items(processed);

    CREATE INDEX IF NOT EXISTS idx_automation_queue_status
      ON automation_queue(status);

    CREATE INDEX IF NOT EXISTS idx_distribution_queue_status
      ON distribution_queue(status);
  `);

  for (
    let i = 0;
    i < DEFAULT_SECTIONS.length;
    i++
  ) {
    const [
      slug,
      name,
      description,
      icon
    ] = DEFAULT_SECTIONS[i];

    await pool.query(
      `
      INSERT INTO sections
      (
        id,
        slug,
        name,
        description,
        icon,
        sort_order
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (slug)
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        icon = EXCLUDED.icon,
        updated_at = NOW()
      `,
      [
        createId(),
        slug,
        name,
        description,
        icon,
        i + 1
      ]
    );
  }

  await pool.query(
    `
    INSERT INTO settings
    (key,value)
    VALUES
      ('platform_name','EZ MEDIA'),
      (
        'platform_description',
        'منصة الإعلام الرقمي وصناعة المحتوى'
      ),
      ('platform_url',$1),
      ('default_language','ar'),
      ('platform_version',$2),
      ('automation_enabled',$3),
      ('auto_publish',$4),
      ('ai_enabled',$5)
    ON CONFLICT (key)
    DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = NOW()
    `,
    [
      APP_URL,
      PLATFORM_VERSION,
      String(AUTOMATION_ENABLED),
      String(AUTO_PUBLISH),
      String(AI_ENABLED)
    ]
  );

  console.log(
    "EZ MEDIA database initialized."
  );
}

/*
=========================================================
 HEALTH
=========================================================
*/

app.get(
  "/api/health",
  async (req, res) => {
    let database =
      "not_configured";

    if (pool) {
      try {
        await pool.query(
          "SELECT 1"
        );

        database = "connected";
      } catch {
        database = "error";
      }
    }

    res.json({
      success: true,
      platform: PLATFORM_NAME,
      version: PLATFORM_VERSION,
      status: "online",
      database,
      automation: {
        enabled:
          AUTOMATION_ENABLED,
        interval_ms:
          AUTOMATION_INTERVAL_MS,
        auto_publish:
          AUTO_PUBLISH,
        ai_enabled:
          AI_ENABLED
      },
      time: now()
    });
  }
);

/*
=========================================================
 PLATFORM
=========================================================
*/

app.get(
  "/api/platform",
  (req, res) => {
    res.json({
      success: true,
      platform: PLATFORM_NAME,
      version: PLATFORM_VERSION,
      description:
        "منصة الإعلام الرقمي وصناعة المحتوى",
      url: APP_URL,
      status: "online",
      features: [
        "content",
        "sections",
        "branches",
        "media",
        "banners",
        "advertising",
        "partners",
        "analytics",
        "automation",
        "smart-content",
        "rss-collector",
        "ai-processing",
        "distribution-queue",
        "settings"
      ]
    });
  }
);

/*
=========================================================
 SECTIONS
=========================================================
*/

app.get(
  "/api/sections",
  async (req, res) => {
    if (!pool) {
      return res.json({
        success: true,
        source: "default",
        sections:
          DEFAULT_SECTIONS.map(
            (
              [
                slug,
                name,
                description,
                icon
              ],
              index
            ) => ({
              id:
                `default-${index + 1}`,
              slug,
              name,
              description,
              banner_url: "",
              icon,
              active: true,
              sort_order:
                index + 1
            })
          )
      });
    }

    try {
      const result =
        await pool.query(`
          SELECT *
          FROM sections
          WHERE active = TRUE
          ORDER BY
            sort_order ASC,
            created_at ASC
        `);

      res.json({
        success: true,
        sections:
          result.rows
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        error:
          "SECTIONS_ERROR"
      });
    }
  }
);

app.get(
  "/api/sections/all",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    try {
      const result =
        await pool.query(`
          SELECT *
          FROM sections
          ORDER BY
            sort_order ASC,
            created_at ASC
        `);

      res.json({
        success: true,
        sections:
          result.rows
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error:
          "SECTIONS_ERROR"
      });
    }
  }
);

app.post(
  "/api/sections",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const {
      name,
      slug,
      description = "",
      banner_url = "",
      icon = "▣",
      active = true,
      sort_order = 0
    } = req.body;

    if (!name || !slug) {
      return res.status(400).json({
        success: false,
        error:
          "name_and_slug_required"
      });
    }

    try {
      const result =
        await pool.query(
          `
          INSERT INTO sections
          (
            id,
            slug,
            name,
            description,
            banner_url,
            icon,
            active,
            sort_order
          )
          VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8)
          RETURNING *
          `,
          [
            createId(),
            name,
            slug,
            description,
            banner_url,
            icon,
            active,
            sort_order
          ]
        );

      res.status(201).json({
        success: true,
        section:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.put(
  "/api/sections/:id",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const {
      name,
      slug,
      description,
      banner_url,
      icon,
      active,
      sort_order
    } = req.body;

    try {
      const result =
        await pool.query(
          `
          UPDATE sections
          SET
            name =
              COALESCE($2,name),
            slug =
              COALESCE($3,slug),
            description =
              COALESCE(
                $4,
                description
              ),
            banner_url =
              COALESCE(
                $5,
                banner_url
              ),
            icon =
              COALESCE($6,icon),
            active =
              COALESCE(
                $7,
                active
              ),
            sort_order =
              COALESCE(
                $8,
                sort_order
              ),
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
          `,
          [
            req.params.id,
            name,
            slug,
            description,
            banner_url,
            icon,
            active,
            sort_order
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error:
            "section_not_found"
        });
      }

      res.json({
        success: true,
        section:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.delete(
  "/api/sections/:id",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    try {
      const result =
        await pool.query(
          `
          DELETE FROM sections
          WHERE id = $1
          RETURNING id
          `,
          [req.params.id]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error:
            "section_not_found"
        });
      }

      res.json({
        success: true,
        deleted: true
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
=========================================================
 BRANCHES
=========================================================
*/

app.get(
  "/api/branches",
  async (req, res) => {
    if (!pool) {
      return res.json({
        success: true,
        branches: []
      });
    }

    try {
      const values = [];
      let where = "";

      if (req.query.section_id) {
        values.push(
          req.query.section_id
        );

        where =
          `WHERE section_id = $1`;
      }

      const result =
        await pool.query(
          `
          SELECT *
          FROM branches
          ${where}
          ORDER BY
            sort_order ASC,
            created_at ASC
          `,
          values
        );

      res.json({
        success: true,
        branches:
          result.rows
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.post(
  "/api/branches",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const {
      section_id,
      name,
      slug,
      description = "",
      banner_url = "",
      active = true,
      sort_order = 0
    } = req.body;

    if (!section_id || !name) {
      return res.status(400).json({
        success: false,
        error:
          "section_id_and_name_required"
      });
    }

    const finalSlug =
      slug || makeSlug(name);

    try {
      const result =
        await pool.query(
          `
          INSERT INTO branches
          (
            id,
            section_id,
            name,
            slug,
            description,
            banner_url,
            active,
            sort_order
          )
          VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8)
          RETURNING *
          `,
          [
            createId(),
            section_id,
            name,
            finalSlug,
            description,
            banner_url,
            active,
            sort_order
          ]
        );

      res.status(201).json({
        success: true,
        branch:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.put(
  "/api/branches/:id",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const fields = [
      "section_id",
      "name",
      "slug",
      "description",
      "banner_url",
      "active",
      "sort_order"
    ];

    const updates = [];
    const values = [
      req.params.id
    ];

    for (const field of fields) {
      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          field
        )
      ) {
        values.push(
          req.body[field]
        );

        updates.push(
          `${field} = $${values.length}`
        );
      }
    }

    if (!updates.length) {
      return res.status(400).json({
        success: false,
        error:
          "nothing_to_update"
      });
    }

    updates.push(
      "updated_at = NOW()"
    );

    try {
      const result =
        await pool.query(
          `
          UPDATE branches
          SET ${updates.join(",")}
          WHERE id = $1
          RETURNING *
          `,
          values
        );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error:
            "branch_not_found"
        });
      }

      res.json({
        success: true,
        branch:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.delete(
  "/api/branches/:id",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    try {
      await pool.query(
        `
        DELETE FROM branches
        WHERE id = $1
        `,
        [req.params.id]
      );

      res.json({
        success: true,
        deleted: true
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
=========================================================
 CONTENT
=========================================================
*/

app.get(
  "/api/content",
  async (req, res) => {
    const limit =
      safeLimit(
        req.query.limit,
        20,
        100
      );

    const type =
      req.query.type || null;

    const section =
      req.query.section || null;

    const branch =
      req.query.branch || null;

    if (!pool) {
      return res.json({
        success: true,
        content: [],
        total: 0,
        database: false
      });
    }

    try {
      const values = [];

      const conditions = [
        `status = 'published'`,
        `(published_at IS NULL OR published_at <= NOW())`
      ];

      if (type) {
        values.push(type);

        conditions.push(
          `type = $${values.length}`
        );
      }

      if (section) {
        values.push(section);

        conditions.push(
          `(section_id = $${values.length}
          OR EXISTS (
            SELECT 1
            FROM sections s2
            WHERE s2.id = c.section_id
            AND s2.slug = $${values.length}
          ))`
        );
      }

      if (branch) {
        values.push(branch);

        conditions.push(
          `branch = $${values.length}`
        );
      }

      values.push(limit);

      const result =
        await pool.query(
          `
          SELECT
            c.*,
            s.slug AS section_slug,
            s.name AS section_name
          FROM content c
          LEFT JOIN sections s
            ON s.id = c.section_id
          WHERE
            ${conditions.join(
              " AND "
            )}
          ORDER BY
            COALESCE(
              c.published_at,
              c.created_at
            ) DESC
          LIMIT $${values.length}
          `,
          values
        );

      res.json({
        success: true,
        content:
          result.rows,
        total:
          result.rows.length
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        error:
          "CONTENT_ERROR"
      });
    }
  }
);

app.get(
  "/api/content/all",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const limit =
      safeLimit(
        req.query.limit,
        100,
        500
      );

    try {
      const result =
        await pool.query(
          `
          SELECT
            c.*,
            s.slug AS section_slug,
            s.name AS section_name
          FROM content c
          LEFT JOIN sections s
            ON s.id = c.section_id
          ORDER BY
            c.created_at DESC
          LIMIT $1
          `,
          [limit]
        );

      res.json({
        success: true,
        content:
          result.rows
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.get(
  "/api/content/:id",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    try {
      const result =
        await pool.query(
          `
          SELECT
            c.*,
            s.slug AS section_slug,
            s.name AS section_name
          FROM content c
          LEFT JOIN sections s
            ON s.id = c.section_id
          WHERE c.id = $1
          `,
          [req.params.id]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error:
            "content_not_found"
        });
      }

      res.json({
        success: true,
        content:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.post(
  "/api/content",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const {
      section_id = null,
      title,
      slug = null,
      excerpt = "",
      body = "",
      type = "article",
      branch = "",
      image_url = "",
      video_url = "",
      audio_url = "",
      author = "EZ MEDIA",
      organization = "",
      phone = "",
      status = "draft",
      featured = false,
      scheduled_at = null,
      published_at = null,
      metadata = {}
    } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error:
          "title_required"
      });
    }

    const finalSlug =
      slug || makeSlug(title);

    const finalStatus =
      normalizeStatus(status);

    let finalPublishedAt =
      published_at;

    if (
      finalStatus === "published" &&
      !finalPublishedAt
    ) {
      finalPublishedAt =
        now();
    }

    try {
      const result =
        await pool.query(
          `
          INSERT INTO content
          (
            id,
            section_id,
            title,
            slug,
            excerpt,
            body,
            type,
            branch,
            image_url,
            video_url,
            audio_url,
            author,
            organization,
            phone,
            status,
            featured,
            scheduled_at,
            published_at,
            metadata
          )
          VALUES
          (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
            $11,$12,$13,$14,$15,$16,$17,$18,$19
          )
          RETURNING *
          `,
          [
            createId(),
            section_id,
            title,
            finalSlug,
            excerpt,
            body,
            type,
            branch,
            image_url,
            video_url,
            audio_url,
            author,
            organization,
            phone,
            finalStatus,
            featured,
            scheduled_at,
            finalPublishedAt,
            JSON.stringify(metadata)
          ]
        );

      res.status(201).json({
        success: true,
        content:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.put(
  "/api/content/:id",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const fields = [
      "section_id",
      "title",
      "slug",
      "excerpt",
      "body",
      "type",
      "branch",
      "image_url",
      "video_url",
      "audio_url",
      "author",
      "organization",
      "phone",
      "status",
      "featured",
      "scheduled_at",
      "published_at",
      "metadata"
    ];

    const updates = [];
    const values = [
      req.params.id
    ];

    for (const field of fields) {
      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          field
        )
      ) {
        let value =
          req.body[field];

        if (field === "status") {
          value =
            normalizeStatus(value);
        }

        if (
          field === "metadata" &&
          typeof value !== "string"
        ) {
          value =
            JSON.stringify(value);
        }

        values.push(value);

        updates.push(
          `${field} = $${values.length}`
        );
      }
    }

    if (!updates.length) {
      return res.status(400).json({
        success: false,
        error:
          "nothing_to_update"
      });
    }

    updates.push(
      "updated_at = NOW()"
    );

    try {
      const result =
        await pool.query(
          `
          UPDATE content
          SET ${updates.join(",")}
          WHERE id = $1
          RETURNING *
          `,
          values
        );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error:
            "content_not_found"
        });
      }

      res.json({
        success: true,
        content:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.delete(
  "/api/content/:id",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    try {
      const result =
        await pool.query(
          `
          DELETE FROM content
          WHERE id = $1
          RETURNING id
          `,
          [req.params.id]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error:
            "content_not_found"
        });
      }

      res.json({
        success: true,
        deleted: true,
        id:
          req.params.id
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
=========================================================
 BANNERS
=========================================================
*/

app.get(
  "/api/banners",
  async (req, res) => {
    if (!pool) {
      return res.json({
        success: true,
        banners: []
      });
    }

    try {
      const result =
        await pool.query(`
          SELECT
            b.*,
            s.slug AS section_slug,
            s.name AS section_name
          FROM banners b
          LEFT JOIN sections s
            ON s.id = b.section_id
          WHERE b.active = TRUE
          ORDER BY
            b.created_at DESC
        `);

      res.json({
        success: true,
        banners:
          result.rows
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.post(
  "/api/banners",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const {
      section_id = null,
      title,
      subtitle = "",
      image_url = "",
      link_url = "",
      active = true
    } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error:
          "title_required"
      });
    }

    try {
      const result =
        await pool.query(
          `
          INSERT INTO banners
          (
            id,
            section_id,
            title,
            subtitle,
            image_url,
            link_url,
            active
          )
          VALUES
          ($1,$2,$3,$4,$5,$6,$7)
          RETURNING *
          `,
          [
            createId(),
            section_id,
            title,
            subtitle,
            image_url,
            link_url,
            active
          ]
        );

      res.status(201).json({
        success: true,
        banner:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.delete(
  "/api/banners/:id",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    try {
      await pool.query(
        `
        DELETE FROM banners
        WHERE id = $1
        `,
        [req.params.id]
      );

      res.json({
        success: true,
        deleted: true
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
=========================================================
 MEDIA
=========================================================
*/

app.get(
  "/api/media",
  async (req, res) => {
    if (!pool) {
      return res.json({
        success: true,
        media: []
      });
    }

    try {
      const result =
        await pool.query(`
          SELECT *
          FROM media
          ORDER BY
            created_at DESC
          LIMIT 100
        `);

      res.json({
        success: true,
        media:
          result.rows
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.post(
  "/api/media",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const {
      title = "",
      type = "image",
      url,
      mime_type = "",
      size = 0,
      metadata = {}
    } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error:
          "url_required"
      });
    }

    try {
      const result =
        await pool.query(
          `
          INSERT INTO media
          (
            id,
            title,
            type,
            url,
            mime_type,
            size,
            metadata
          )
          VALUES
          ($1,$2,$3,$4,$5,$6,$7)
          RETURNING *
          `,
          [
            createId(),
            title,
            type,
            url,
            mime_type,
            size,
            JSON.stringify(
              metadata
            )
          ]
        );

      res.status(201).json({
        success: true,
        media:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.delete(
  "/api/media/:id",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    try {
      await pool.query(
        `
        DELETE FROM media
        WHERE id = $1
        `,
        [req.params.id]
      );

      res.json({
        success: true,
        deleted: true
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
=========================================================
 PARTNERS
=========================================================
*/

app.get(
  "/api/partners",
  async (req, res) => {
    if (!pool) {
      return res.json({
        success: true,
        partners: []
      });
    }

    try {
      const result =
        await pool.query(`
          SELECT *
          FROM partners
          WHERE active = TRUE
          ORDER BY
            created_at DESC
        `);

      res.json({
        success: true,
        partners:
          result.rows
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.post(
  "/api/partners",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const {
      name,
      type = "partner",
      logo_url = "",
      website_url = "",
      description = "",
      active = true
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error:
          "name_required"
      });
    }

    try {
      const result =
        await pool.query(
          `
          INSERT INTO partners
          (
            id,
            name,
            type,
            logo_url,
            website_url,
            description,
            active
          )
          VALUES
          ($1,$2,$3,$4,$5,$6,$7)
          RETURNING *
          `,
          [
            createId(),
            name,
            type,
            logo_url,
            website_url,
            description,
            active
          ]
        );

      res.status(201).json({
        success: true,
        partner:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.delete(
  "/api/partners/:id",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    try {
      await pool.query(
        `
        DELETE FROM partners
        WHERE id = $1
        `,
        [req.params.id]
      );

      res.json({
        success: true,
        deleted: true
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
=========================================================
 ADVERTISEMENTS
=========================================================
*/

app.get(
  "/api/advertisements",
  async (req, res) => {
    if (!pool) {
      return res.json({
        success: true,
        advertisements: []
      });
    }

    try {
      const result =
        await pool.query(`
          SELECT *
          FROM advertisements
          ORDER BY
            created_at DESC
        `);

      res.json({
        success: true,
        advertisements:
          result.rows
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.post(
  "/api/advertisements",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const {
      title,
      organization = "",
      image_url = "",
      link_url = "",
      status = "draft",
      starts_at = null,
      ends_at = null
    } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error:
          "title_required"
      });
    }

    try {
      const result =
        await pool.query(
          `
          INSERT INTO advertisements
          (
            id,
            title,
            organization,
            image_url,
            link_url,
            status,
            starts_at,
            ends_at
          )
          VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8)
          RETURNING *
          `,
          [
            createId(),
            title,
            organization,
            image_url,
            link_url,
            normalizeStatus(
              status
            ),
            starts_at,
            ends_at
          ]
        );

      res.status(201).json({
        success: true,
        advertisement:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.put(
  "/api/advertisements/:id",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const fields = [
      "title",
      "organization",
      "image_url",
      "link_url",
      "status",
      "starts_at",
      "ends_at"
    ];

    const updates = [];
    const values = [
      req.params.id
    ];

    for (const field of fields) {
      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          field
        )
      ) {
        let value =
          req.body[field];

        if (field === "status") {
          value =
            normalizeStatus(value);
        }

        values.push(value);

        updates.push(
          `${field} = $${values.length}`
        );
      }
    }

    if (!updates.length) {
      return res.status(400).json({
        success: false,
        error:
          "nothing_to_update"
      });
    }

    updates.push(
      "updated_at = NOW()"
    );

    try {
      const result =
        await pool.query(
          `
          UPDATE advertisements
          SET ${updates.join(",")}
          WHERE id = $1
          RETURNING *
          `,
          values
        );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error:
            "advertisement_not_found"
        });
      }

      res.json({
        success: true,
        advertisement:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.delete(
  "/api/advertisements/:id",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    try {
      await pool.query(
        `
        DELETE FROM advertisements
        WHERE id = $1
        `,
        [req.params.id]
      );

      res.json({
        success: true,
        deleted: true
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
=========================================================
 SOURCES
=========================================================
*/

app.get(
  "/api/sources",
  async (req, res) => {
    if (!pool) {
      return res.json({
        success: true,
        sources: []
      });
    }

    try {
      const result =
        await pool.query(`
          SELECT
            s.*,
            sec.slug AS section_slug,
            sec.name AS section_name
          FROM sources s
          LEFT JOIN sections sec
            ON sec.id = s.section_id
          ORDER BY
            s.created_at DESC
        `);

      res.json({
        success: true,
        sources:
          result.rows
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.post(
  "/api/sources",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const {
      name,
      url,
      type = "rss",
      active = true,
      section_id = null,
      branch = "",
      auto_publish = false,
      fetch_interval_minutes = 30
    } = req.body;

    if (!name || !url) {
      return res.status(400).json({
        success: false,
        error:
          "name_and_url_required"
      });
    }

    if (!isValidHttpUrl(url)) {
      return res.status(400).json({
        success: false,
        error:
          "invalid_source_url"
      });
    }

    try {
      const result =
        await pool.query(
          `
          INSERT INTO sources
          (
            id,
            name,
            url,
            type,
            active,
            section_id,
            branch,
            auto_publish,
            fetch_interval_minutes
          )
          VALUES
          (
            $1,$2,$3,$4,$5,$6,$7,$8,$9
          )
          RETURNING *
          `,
          [
            createId(),
            name,
            url,
            type,
            active,
            section_id,
            branch,
            auto_publish,
            Math.max(
              Number(
                fetch_interval_minutes
              ) || 30,
              5
            )
          ]
        );

      res.status(201).json({
        success: true,
        source:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.put(
  "/api/sources/:id",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const fields = [
      "name",
      "url",
      "type",
      "active",
      "section_id",
      "branch",
      "auto_publish",
      "fetch_interval_minutes"
    ];

    const updates = [];
    const values = [
      req.params.id
    ];

    for (const field of fields) {
      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          field
        )
      ) {
        values.push(
          req.body[field]
        );

        updates.push(
          `${field} = $${values.length}`
        );
      }
    }

    if (!updates.length) {
      return res.status(400).json({
        success: false,
        error:
          "nothing_to_update"
      });
    }

    updates.push(
      "updated_at = NOW()"
    );

    try {
      const result =
        await pool.query(
          `
          UPDATE sources
          SET ${updates.join(",")}
          WHERE id = $1
          RETURNING *
          `,
          values
        );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error:
            "source_not_found"
        });
      }

      res.json({
        success: true,
        source:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.delete(
  "/api/sources/:id",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    try {
      await pool.query(
        `
        DELETE FROM sources
        WHERE id = $1
        `,
        [req.params.id]
      );

      res.json({
        success: true,
        deleted: true
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
=========================================================
 RSS / INTERNET COLLECTOR
=========================================================
*/

async function fetchWithTimeout(
  url,
  options = {}
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      FETCH_TIMEOUT_MS
    );

  try {
    return await fetch(
      url,
      {
        ...options,
        signal:
          controller.signal,
        headers: {
          "User-Agent":
            "EZ-MEDIA/8.1 (+smart-media-collector)",
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*",
          ...(options.headers || {})
        }
      }
    );
  } finally {
    clearTimeout(timer);
  }
}

function parseFeed(xml) {
  const items = [];

  const rssItems =
    String(xml || "").match(
      /<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi
    ) || [];

  const atomItems =
    String(xml || "").match(
      /<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi
    ) || [];

  const blocks =
    rssItems.length
      ? rssItems
      : atomItems;

  for (
    const block of blocks.slice(
      0,
      MAX_SOURCE_ITEMS
    )
  ) {
    const title =
      cleanText(
        extractXmlTag(
          block,
          "title"
        )
      );

    const description =
      cleanText(
        extractXmlTag(
          block,
          "description"
        ) ||
        extractXmlTag(
          block,
          "summary"
        ) ||
        extractXmlTag(
          block,
          "content"
        )
      );

    const link =
      extractXmlLink(block);

    const guid =
      cleanText(
        extractXmlTag(
          block,
          "guid"
        ) ||
        extractXmlTag(
          block,
          "id"
        )
      );

    const date =
      cleanText(
        extractXmlTag(
          block,
          "pubDate"
        ) ||
        extractXmlTag(
          block,
          "published"
        ) ||
        extractXmlTag(
          block,
          "updated"
        )
      );

    const image =
      extractImageUrl(block);

    if (!title) {
      continue;
    }

    items.push({
      external_id:
        guid ||
        link ||
        hashText(
          title +
          description
        ),
      title,
      description:
        truncateText(
          description,
          3000
        ),
      link,
      image_url:
        image || "",
      published_at:
        date &&
        !Number.isNaN(
          Date.parse(date)
        )
          ? new Date(date)
          : null
    });
  }

  return items;
}

async function collectSource(
  source
) {
  if (!isValidHttpUrl(source.url)) {
    throw new Error(
      "SOURCE_URL_INVALID"
    );
  }

  const response =
    await fetchWithTimeout(
      source.url
    );

  if (!response.ok) {
    throw new Error(
      `SOURCE_HTTP_${response.status}`
    );
  }

  const xml =
    await response.text();

  const items =
    parseFeed(xml);

  if (!items.length) {
    throw new Error(
      "NO_FEED_ITEMS_FOUND"
    );
  }

  return items;
}

/*
=========================================================
 SMART CLASSIFICATION
=========================================================
*/

const CLASSIFICATION_RULES = [
  {
    slug: "sports",
    words: [
      "رياضة",
      "رياضي",
      "كرة",
      "مباراة",
      "دوري",
      "بطولة",
      "لاعب",
      "نادي"
    ]
  },
  {
    slug: "technology",
    words: [
      "تقنية",
      "تطبيق",
      "منصة",
      "هاتف",
      "برمجيات",
      "رقمنة",
      "تقني"
    ]
  },
  {
    slug: "ai",
    words: [
      "ذكاء اصطناعي",
      "ذكاء",
      "AI",
      "GPT",
      "روبوت",
      "تعلم آلي"
    ]
  },
  {
    slug: "travel",
    words: [
      "سفر",
      "سياحة",
      "فندق",
      "وجهة",
      "رحلة",
      "طيران"
    ]
  },
  {
    slug: "business",
    words: [
      "اقتصاد",
      "شركة",
      "أسواق",
      "استثمار",
      "أعمال",
      "ريادة"
    ]
  },
  {
    slug: "culture",
    words: [
      "ثقافة",
      "كتاب",
      "فنون",
      "فن",
      "معرض",
      "تراث"
    ]
  },
  {
    slug: "entertainment",
    words: [
      "ترفيه",
      "فيلم",
      "مسلسل",
      "موسيقى",
      "نجوم",
      "حفلة"
    ]
  },
  {
    slug: "events",
    words: [
      "فعالية",
      "مؤتمر",
      "معرض",
      "مناسبة",
      "ملتقى"
    ]
  },
  {
    slug: "advertising",
    words: [
      "إعلان",
      "إعلانات",
      "حملة",
      "تسويق"
    ]
  }
];

function classifyContent(
  title,
  description
) {
  const text =
    `${title} ${description}`
      .toLowerCase();

  let best =
    "news";

  let bestScore = 0;

  for (
    const rule of CLASSIFICATION_RULES
  ) {
    let score = 0;

    for (
      const word of rule.words
    ) {
      if (
        text.includes(
          word.toLowerCase()
        )
      ) {
        score++;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = rule.slug;
    }
  }

  return {
    section_slug: best,
    score: bestScore
  };
}

/*
=========================================================
 AI PROCESSOR
=========================================================
*/

async function processWithAI(
  item,
  context = {}
) {
  const fallback =
    buildOriginalContent(
      item,
      context
    );

  if (
    !AI_ENABLED ||
    !AI_API_KEY ||
    !AI_API_URL ||
    !AI_MODEL
  ) {
    return fallback;
  }

  const prompt = `
أنت محرر في منصة EZ MEDIA.

المصدر:
${item.title}

الوصف المتاح:
${item.description}

الرابط:
${item.link}

القسم المقترح:
${context.section_name || "الأخبار"}

المطلوب:
أنشئ محتوى عربيًا أصليًا مبنيًا على المعلومات المتاحة فقط.
لا تنسخ النص الأصلي.
لا تضف معلومات غير موجودة.
اذكر المصدر في metadata.
أعد JSON فقط بهذا الشكل:

{
  "title": "...",
  "excerpt": "...",
  "body": "...",
  "tags": ["...","..."]
}
`;

  try {
    const response =
      await fetchWithTimeout(
        AI_API_URL,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization:
              `Bearer ${AI_API_KEY}`
          },
          body: JSON.stringify({
            model: AI_MODEL,
            messages: [
              {
                role: "system",
                content:
                  "أنت محرر إعلامي دقيق."
              },
              {
                role: "user",
                content: prompt
              }
            ],
            temperature: 0.2
          })
        }
      );

    if (!response.ok) {
      throw new Error(
        `AI_HTTP_${response.status}`
      );
    }

    const data =
      await response.json();

    const raw =
      data?.choices?.[0]?.message?.content ||
      "";

    const jsonText =
      raw
        .replace(
          /^```json/i,
          ""
        )
        .replace(
          /^```/i,
          ""
        )
        .replace(
          /```$/i,
          ""
        )
        .trim();

    const parsed =
      JSON.parse(jsonText);

    return {
      title:
        parsed.title ||
        fallback.title,
      excerpt:
        parsed.excerpt ||
        fallback.excerpt,
      body:
        parsed.body ||
        fallback.body,
      tags:
        Array.isArray(
          parsed.tags
        )
          ? parsed.tags
          : fallback.tags
    };
  } catch (error) {
    console.error(
      "AI processing error:",
      error.message
    );

    return fallback;
  }
}

function buildOriginalContent(
  item,
  context
) {
  const sourceName =
    context.source_name ||
    "المصدر الأصلي";

  const title =
    item.title.trim();

  const description =
    truncateText(
      stripHtml(
        item.description
      ),
      700
    );

  const bodyParts = [];

  bodyParts.push(
    `تستعرض EZ MEDIA أبرز ما ورد في المصدر بشأن: ${title}.`
  );

  if (description) {
    bodyParts.push(
      description
    );
  }

  bodyParts.push(
    `المصدر: ${sourceName}.`
  );

  return {
    title,
    excerpt:
      description ||
      `متابعة جديدة من EZ MEDIA حول ${title}`,
    body:
      bodyParts.join(
        "\n\n"
      ),
    tags: [
      "EZ MEDIA",
      context.section_name ||
        "الأخبار"
    ]
  };
}

/*
=========================================================
 SOURCE INGESTION
=========================================================
*/

async function ingestSource(
  source
) {
  const runId =
    createId();

  if (!pool) {
    return {
      success: false,
      error:
        "DATABASE_NOT_CONFIGURED"
    };
  }

  let items = [];

  try {
    items =
      await collectSource(
        source
      );

    let added = 0;
    let skipped = 0;

    for (
      const item of items
    ) {
      const contentHash =
        hashText(
          [
            source.id,
            item.external_id,
            item.title,
            item.link
          ].join("|")
        );

      const exists =
        await pool.query(
          `
          SELECT id
          FROM source_items
          WHERE content_hash = $1
          LIMIT 1
          `,
          [contentHash]
        );

      if (exists.rows.length) {
        skipped++;
        continue;
      }

      const sourceItemId =
        createId();

      await pool.query(
        `
        INSERT INTO source_items
        (
          id,
          source_id,
          external_id,
          title,
          link,
          description,
          published_at,
          content_hash,
          raw_data
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,$7,$8,$9
        )
        `,
        [
          sourceItemId,
          source.id,
          item.external_id,
          item.title,
          item.link,
          item.description,
          item.published_at,
          contentHash,
          JSON.stringify(item)
        ]
      );

      await pool.query(
        `
        INSERT INTO automation_queue
        (
          id,
          source_id,
          source_item_id,
          action,
          status
        )
        VALUES
        ($1,$2,$3,$4,$5)
        `,
        [
          createId(),
          source.id,
          sourceItemId,
          "process",
          "queued"
        ]
      );

      added++;
    }

    await pool.query(
      `
      UPDATE sources
      SET
        last_fetch_at = NOW(),
        last_success_at = NOW(),
        last_error = '',
        updated_at = NOW()
      WHERE id = $1
      `,
      [source.id]
    );

    return {
      success: true,
      source_id: source.id,
      source_name: source.name,
      fetched: items.length,
      added,
      skipped,
      run_id: runId
    };
  } catch (error) {
    await pool.query(
      `
      UPDATE sources
      SET
        last_fetch_at = NOW(),
        last_error = $2,
        updated_at = NOW()
      WHERE id = $1
      `,
      [
        source.id,
        error.message
      ]
    );

    return {
      success: false,
      source_id: source.id,
      source_name: source.name,
      error:
        error.message,
      run_id: runId
    };
  }
}

/*
=========================================================
 PROCESS AUTOMATION QUEUE
=========================================================
*/

async function processAutomationQueue() {
  if (!pool) {
    return {
      success: false,
      processed: 0,
      reason:
        "DATABASE_NOT_CONFIGURED"
    };
  }

  const queue =
    await pool.query(`
      SELECT
        q.*,
        s.name AS source_name,
        s.section_id AS source_section_id,
        s.branch AS source_branch,
        s.auto_publish,
        si.title AS item_title,
        si.link AS item_link,
        si.description AS item_description,
        si.published_at AS item_published_at,
        si.raw_data
      FROM automation_queue q
      LEFT JOIN sources s
        ON s.id = q.source_id
      LEFT JOIN source_items si
        ON si.id = q.source_item_id
      WHERE
        q.status = 'queued'
        AND q.action = 'process'
        AND q.scheduled_at <= NOW()
      ORDER BY
        q.created_at ASC
      LIMIT 20
    `);

  let processed = 0;

  for (
    const row of queue.rows
  ) {
    try {
      await pool.query(
        `
        UPDATE automation_queue
        SET
          status = 'processing',
          attempts = attempts + 1
        WHERE id = $1
        `,
        [row.id]
      );

      const classification =
        classifyContent(
          row.item_title,
          row.item_description
        );

      let sectionId =
        row.source_section_id ||
        null;

      let sectionName =
        "";

      if (sectionId) {
        const sectionResult =
          await pool.query(
            `
            SELECT
              id,
              slug,
              name
            FROM sections
            WHERE id = $1
            `,
            [sectionId]
          );

        if (
          sectionResult.rows.length
        ) {
          sectionName =
            sectionResult.rows[0].name;
        }
      }

      if (!sectionId) {
        const sectionResult =
          await pool.query(
            `
            SELECT
              id,
              name
            FROM sections
            WHERE slug = $1
            LIMIT 1
            `,
            [
              classification.section_slug
            ]
          );

        if (
          sectionResult.rows.length
        ) {
          sectionId =
            sectionResult.rows[0].id;

          sectionName =
            sectionResult.rows[0].name;
        }
      }

      const processedContent =
        await processWithAI(
          {
            title:
              row.item_title,
            description:
              row.item_description,
            link:
              row.item_link
          },
          {
            source_name:
              row.source_name,
            section_name:
              sectionName
          }
        );

      const finalStatus =
        (
          AUTO_PUBLISH ||
          row.auto_publish
        )
          ? "published"
          : "review";

      const publishedAt =
        finalStatus === "published"
          ? now()
          : null;

      const metadata = {
        automation: true,
        source_id:
          row.source_id,
        source_item_id:
          row.source_item_id,
        source_name:
          row.source_name,
        source_url:
          row.item_link,
        collected_at:
          now(),
        classification,
        tags:
          processedContent.tags ||
          []
      };

      const existing =
        await pool.query(
          `
          SELECT id
          FROM content
          WHERE slug = $1
          LIMIT 1
          `,
          [
            makeSlug(
              processedContent.title
            )
          ]
        );

      let contentId;

      if (existing.rows.length) {
        contentId =
          existing.rows[0].id;

        await pool.query(
          `
          UPDATE content
          SET
            excerpt = $2,
            body = $3,
            section_id = $4,
            branch = $5,
            image_url = $6,
            status = $7,
            published_at = $8,
            metadata = $9,
            updated_at = NOW()
          WHERE id = $1
          `,
          [
            contentId,
            processedContent.excerpt,
            processedContent.body,
            sectionId,
            row.source_branch || "",
            row.raw_data?.image_url ||
              "",
            finalStatus,
            publishedAt,
            JSON.stringify(
              metadata
            )
          ]
        );
      } else {
        contentId =
          createId();

        await pool.query(
          `
          INSERT INTO content
          (
            id,
            section_id,
            title,
            slug,
            excerpt,
            body,
            type,
            branch,
            image_url,
            author,
            status,
            featured,
            published_at,
            metadata
          )
          VALUES
          (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,
            $10,$11,$12,$13,$14
          )
          `,
          [
            contentId,
            sectionId,
            processedContent.title,
            makeSlug(
              processedContent.title
            ),
            processedContent.excerpt,
            processedContent.body,
            "article",
            row.source_branch || "",
            row.raw_data?.image_url ||
              "",
            "EZ MEDIA",
            finalStatus,
            false,
            publishedAt,
            JSON.stringify(
              metadata
            )
          ]
        );
      }

      await pool.query(
        `
        UPDATE source_items
        SET
          processed = TRUE,
          content_id = $2
        WHERE id = $1
        `,
        [
          row.source_item_id,
          contentId
        ]
      );

      await pool.query(
        `
        UPDATE automation_queue
        SET
          status = 'completed',
          processed_at = NOW(),
          error = ''
        WHERE id = $1
        `,
        [row.id]
      );

      /*
      -----------------------------------------------
      DISTRIBUTION QUEUE
      -----------------------------------------------
      */

      const platforms = [
        "website",
        "snapchat",
        "tiktok",
        "instagram",
        "youtube",
        "x",
        "linkedin",
        "facebook"
      ];

      for (
        const platform of platforms
      ) {
        await pool.query(
          `
          INSERT INTO distribution_queue
          (
            id,
            content_id,
            platform,
            status,
            payload
          )
          VALUES
          ($1,$2,$3,$4,$5)
          `,
          [
            createId(),
            contentId,
            platform,
            platform === "website"
              ? "ready"
              : "queued",
            JSON.stringify({
              content_id:
                contentId,
              title:
                processedContent.title,
              excerpt:
                processedContent.excerpt,
              source:
                row.item_link
            })
          ]
        );
      }

      processed++;
    } catch (error) {
      console.error(
        "Queue item error:",
        error
      );

      await pool.query(
        `
        UPDATE automation_queue
        SET
          status = 'failed',
          error = $2
        WHERE id = $1
        `,
        [
          row.id,
          error.message
        ]
      );
    }
  }

  return {
    success: true,
    processed
  };
}

/*
=========================================================
 FULL AUTOMATION CYCLE
=========================================================
*/

let automationRunning =
  false;

async function runAutomationCycle(
  reason = "scheduled"
) {
  if (
    automationRunning
  ) {
    return {
      success: false,
      skipped: true,
      reason:
        "AUTOMATION_ALREADY_RUNNING"
    };
  }

  if (!pool) {
    return {
      success: false,
      reason:
        "DATABASE_NOT_CONFIGURED"
    };
  }

  automationRunning = true;

  const runId =
    createId();

  try {
    await pool.query(
      `
      INSERT INTO automation_runs
      (
        id,
        status,
        message
      )
      VALUES
      ($1,$2,$3)
      `,
      [
        runId,
        "running",
        `بدأت دورة الأتمتة: ${reason}`
      ]
    );

    const sourcesResult =
      await pool.query(`
        SELECT *
        FROM sources
        WHERE active = TRUE
        ORDER BY created_at ASC
      `);

    const sourceResults = [];

    for (
      const source of
        sourcesResult.rows
    ) {
      const lastFetch =
        source.last_fetch_at
          ? new Date(
              source.last_fetch_at
            ).getTime()
          : 0;

      const interval =
        Math.max(
          Number(
            source.fetch_interval_minutes ||
              30
          ),
          5
        ) *
        60 *
        1000;

      if (
        Date.now() - lastFetch <
        interval
      ) {
        continue;
      }

      sourceResults.push(
        await ingestSource(
          source
        )
      );

      await sleep(250);
    }

    const queueResult =
      await processAutomationQueue();

    await pool.query(
      `
      INSERT INTO analytics_events
      (
        id,
        event_name,
        page,
        metadata
      )
      VALUES
      ($1,$2,$3,$4)
      `,
      [
        createId(),
        "automation_cycle",
        "/automation",
        JSON.stringify({
          reason,
          sources:
            sourceResults.length,
          queue:
            queueResult
        })
      ]
    );

    await pool.query(
      `
      UPDATE automation_runs
      SET
        status = 'completed',
        message = $2,
        finished_at = NOW()
      WHERE id = $1
      `,
      [
        runId,
        JSON.stringify({
          sources:
            sourceResults,
          queue:
            queueResult
        })
      ]
    );

    return {
      success: true,
      run_id: runId,
      sources:
        sourceResults,
      queue:
        queueResult
    };
  } catch (error) {
    await pool.query(
      `
      UPDATE automation_runs
      SET
        status = 'failed',
        message = $2,
        finished_at = NOW()
      WHERE id = $1
      `,
      [
        runId,
        error.message
      ]
    );

    return {
      success: false,
      run_id: runId,
      error:
        error.message
    };
  } finally {
    automationRunning = false;
  }
}

/*
=========================================================
 AUTOMATION API
=========================================================
*/

app.get(
  "/api/automation/status",
  async (req, res) => {
    let database =
      false;

    if (pool) {
      try {
        await pool.query(
          "SELECT 1"
        );

        database = true;
      } catch {}
    }

    res.json({
      success: true,
      automation: {
        enabled:
          AUTOMATION_ENABLED,
        running:
          automationRunning,
        interval_ms:
          AUTOMATION_INTERVAL_MS,
        auto_publish:
          AUTO_PUBLISH,
        ai_enabled:
          AI_ENABLED,
        database
      }
    });
  }
);

app.get(
  "/api/automation/jobs",
  async (req, res) => {
    if (!pool) {
      return res.json({
        success: true,
        jobs: []
      });
    }

    try {
      const result =
        await pool.query(`
          SELECT *
          FROM automation_jobs
          ORDER BY
            created_at DESC
        `);

      res.json({
        success: true,
        jobs:
          result.rows
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.post(
  "/api/automation/jobs",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const {
      name,
      type = "manual",
      status = "active",
      configuration = {}
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error:
          "name_required"
      });
    }

    try {
      const result =
        await pool.query(
          `
          INSERT INTO automation_jobs
          (
            id,
            name,
            type,
            status,
            configuration
          )
          VALUES
          ($1,$2,$3,$4,$5)
          RETURNING *
          `,
          [
            createId(),
            name,
            type,
            status,
            JSON.stringify(
              configuration
            )
          ]
        );

      res.status(201).json({
        success: true,
        job:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.post(
  "/api/automation/run",
  async (req, res) => {
    if (!pool) {
      return res.status(503).json({
        success: false,
        error:
          "DATABASE_NOT_CONFIGURED"
      });
    }

    const result =
      await runAutomationCycle(
        "manual"
      );

    res.json(result);
  }
);

app.get(
  "/api/automation/logs",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    try {
      const result =
        await pool.query(`
          SELECT *
          FROM automation_runs
          ORDER BY
            started_at DESC
          LIMIT 100
        `);

      res.json({
        success: true,
        logs:
          result.rows
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
=========================================================
 AUTOMATION QUEUE API
=========================================================
*/

app.get(
  "/api/automation/queue",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    try {
      const result =
        await pool.query(`
          SELECT
            q.*,
            s.name AS source_name,
            si.title AS source_title
          FROM automation_queue q
          LEFT JOIN sources s
            ON s.id = q.source_id
          LEFT JOIN source_items si
            ON si.id = q.source_item_id
          ORDER BY
            q.created_at DESC
          LIMIT 200
        `);

      res.json({
        success: true,
        queue:
          result.rows
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
=========================================================
 DISTRIBUTION QUEUE
=========================================================
*/

app.get(
  "/api/distribution",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    try {
      const result =
        await pool.query(`
          SELECT
            d.*,
            c.title
          FROM distribution_queue d
          LEFT JOIN content c
            ON c.id = d.content_id
          ORDER BY
            d.created_at DESC
          LIMIT 200
        `);

      res.json({
        success: true,
        distribution:
          result.rows
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.post(
  "/api/distribution/:id/retry",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    try {
      const result =
        await pool.query(
          `
          UPDATE distribution_queue
          SET
            status = 'queued',
            error = '',
            scheduled_at = NOW()
          WHERE id = $1
          RETURNING *
          `,
          [req.params.id]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error:
            "distribution_not_found"
        });
      }

      res.json({
        success: true,
        item:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
=========================================================
 ANALYTICS
=========================================================
*/

app.post(
  "/api/analytics/event",
  async (req, res) => {
    if (!pool) {
      return res.json({
        success: true,
        stored: false
      });
    }

    const {
      event_name,
      page = "",
      metadata = {}
    } = req.body;

    if (!event_name) {
      return res.status(400).json({
        success: false,
        error:
          "event_name_required"
      });
    }

    try {
      await pool.query(
        `
        INSERT INTO analytics_events
        (
          id,
          event_name,
          page,
          metadata
        )
        VALUES
        ($1,$2,$3,$4)
        `,
        [
          createId(),
          event_name,
          page,
          JSON.stringify(
            metadata
          )
        ]
      );

      res.json({
        success: true,
        stored: true
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
=========================================================
 STATS
=========================================================
*/

app.get(
  "/api/stats",
  async (req, res) => {
    if (!pool) {
      return res.json({
        success: true,
        database: false,
        stats: {
          sections:
            DEFAULT_SECTIONS.length,
          branches: 0,
          content: 0,
          media: 0,
          sources: 0,
          banners: 0,
          partners: 0,
          advertisements: 0,
          automation_jobs: 0,
          automation_queue: 0,
          distribution_queue: 0,
          events: 0
        }
      });
    }

    try {
      const [
        sections,
        branches,
        content,
        media,
        sources,
        banners,
        partners,
        advertisements,
        jobs,
        queue,
        distribution,
        events
      ] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) FROM sections`
        ),
        pool.query(
          `SELECT COUNT(*) FROM branches`
        ),
        pool.query(
          `SELECT COUNT(*) FROM content`
        ),
        pool.query(
          `SELECT COUNT(*) FROM media`
        ),
        pool.query(
          `SELECT COUNT(*) FROM sources`
        ),
        pool.query(
          `SELECT COUNT(*) FROM banners`
        ),
        pool.query(
          `SELECT COUNT(*) FROM partners`
        ),
        pool.query(
          `SELECT COUNT(*) FROM advertisements`
        ),
        pool.query(
          `SELECT COUNT(*) FROM automation_jobs`
        ),
        pool.query(
          `SELECT COUNT(*) FROM automation_queue`
        ),
        pool.query(
          `SELECT COUNT(*) FROM distribution_queue`
        ),
        pool.query(
          `SELECT COUNT(*) FROM analytics_events`
        )
      ]);

      res.json({
        success: true,
        database: true,
        stats: {
          sections:
            Number(
              sections.rows[0].count
            ),
          branches:
            Number(
              branches.rows[0].count
            ),
          content:
            Number(
              content.rows[0].count
            ),
          media:
            Number(
              media.rows[0].count
            ),
          sources:
            Number(
              sources.rows[0].count
            ),
          banners:
            Number(
              banners.rows[0].count
            ),
          partners:
            Number(
              partners.rows[0].count
            ),
          advertisements:
            Number(
              advertisements.rows[0].count
            ),
          automation_jobs:
            Number(
              jobs.rows[0].count
            ),
          automation_queue:
            Number(
              queue.rows[0].count
            ),
          distribution_queue:
            Number(
              distribution.rows[0].count
            ),
          events:
            Number(
              events.rows[0].count
            )
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
=========================================================
 SETTINGS
=========================================================
*/

app.get(
  "/api/settings",
  async (req, res) => {
    if (!pool) {
      return res.json({
        success: true,
        settings: {
          platform_name:
            PLATFORM_NAME,
          platform_description:
            "منصة الإعلام الرقمي وصناعة المحتوى",
          platform_url:
            APP_URL,
          default_language:
            "ar",
          platform_version:
            PLATFORM_VERSION,
          automation_enabled:
            String(
              AUTOMATION_ENABLED
            ),
          auto_publish:
            String(
              AUTO_PUBLISH
            ),
          ai_enabled:
            String(
              AI_ENABLED
            )
        }
      });
    }

    try {
      const result =
        await pool.query(`
          SELECT
            key,
            value
          FROM settings
          ORDER BY key
        `);

      const settings = {};

      for (
        const row of result.rows
      ) {
        settings[row.key] =
          row.value;
      }

      res.json({
        success: true,
        settings
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

app.put(
  "/api/settings/:key",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const value =
      typeof req.body.value ===
      "string"
        ? req.body.value
        : JSON.stringify(
            req.body.value
          );

    try {
      await pool.query(
        `
        INSERT INTO settings
        (key,value)
        VALUES ($1,$2)
        ON CONFLICT (key)
        DO UPDATE SET
          value =
            EXCLUDED.value,
          updated_at =
            NOW()
        `,
        [
          req.params.key,
          value
        ]
      );

      res.json({
        success: true,
        key:
          req.params.key,
        value
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
=========================================================
 SEARCH
=========================================================
*/

app.get(
  "/api/search",
  async (req, res) => {
    if (!dbRequired(res))
      return;

    const q =
      String(
        req.query.q || ""
      ).trim();

    if (!q) {
      return res.json({
        success: true,
        results: []
      });
    }

    try {
      const result =
        await pool.query(
          `
          SELECT
            c.id,
            c.title,
            c.excerpt,
            c.type,
            c.branch,
            c.image_url,
            c.status,
            c.published_at,
            s.slug AS section_slug,
            s.name AS section_name
          FROM content c
          LEFT JOIN sections s
            ON s.id = c.section_id
          WHERE
            (
              c.title ILIKE $1
              OR c.excerpt ILIKE $1
              OR c.body ILIKE $1
              OR c.branch ILIKE $1
            )
          ORDER BY
            c.published_at DESC NULLS LAST,
            c.created_at DESC
          LIMIT 50
          `,
          [
            `%${q}%`
          ]
        );

      res.json({
        success: true,
        results:
          result.rows
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
=========================================================
 FRONTEND
=========================================================
*/

const PUBLIC_DIR =
  path.join(
    __dirname,
    "public"
  );

app.use(
  express.static(
    PUBLIC_DIR
  )
);

app.get(
  "/",
  (req, res) => {
    res.sendFile(
      path.join(
        PUBLIC_DIR,
        "index.html"
      )
    );
  }
);

/*
=========================================================
 API 404
=========================================================
*/

app.use(
  "/api",
  (req, res) => {
    res.status(404).json({
      success: false,
      error:
        "API_ROUTE_NOT_FOUND",
      path:
        req.originalUrl
    });
  }
);

/*
=========================================================
 GENERAL 404
=========================================================
*/

app.use(
  (req, res) => {
    res.status(404).send(`
      <!doctype html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8">
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1"
        >
        <title>EZ MEDIA</title>
        <style>
          body{
            margin:0;
            min-height:100vh;
            display:grid;
            place-items:center;
            font-family:Arial,sans-serif;
            background:
              linear-gradient(
                135deg,
                #ffffff,
                #f7fcff,
                #e9f7ff
              );
            color:#17384c;
          }
          main{
            width:min(650px,90%);
            padding:40px;
            text-align:center;
            border:1px solid #d9edf7;
            border-radius:24px;
            background:#ffffff;
            box-shadow:
              0 20px 60px
              rgba(37,145,195,.10);
          }
          h1{
            color:#168fd0;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>EZ MEDIA</h1>
          <p>
            المسار المطلوب غير موجود.
          </p>
        </main>
      </body>
      </html>
    `);
  }
);

/*
=========================================================
 ERROR HANDLER
=========================================================
*/

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      error
    );

    if (
      res.headersSent
    ) {
      return next(
        error
      );
    }

    res.status(500).json({
      success: false,
      error:
        "INTERNAL_SERVER_ERROR"
    });
  }
);

/*
=========================================================
 AUTOMATION TIMER
=========================================================
*/

let automationTimer =
  null;

function startAutomation() {
  if (
    !AUTOMATION_ENABLED
  ) {
    console.log(
      "Automation disabled."
    );

    return;
  }

  console.log(
    `Automation enabled. Interval: ${AUTOMATION_INTERVAL_MS}ms`
  );

  automationTimer =
    setInterval(
      async () => {
        try {
          const result =
            await runAutomationCycle(
              "scheduled"
            );

          console.log(
            "Automation cycle:",
            JSON.stringify(
              result
            )
          );
        } catch (error) {
          console.error(
            "Automation timer error:",
            error
          );
        }
      },
      AUTOMATION_INTERVAL_MS
    );
}

/*
=========================================================
 START
=========================================================
*/

async function start() {
  try {
    await initializeDatabase();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log("");
        console.log(
          "=========================================="
        );
        console.log(
          " EZ MEDIA"
        );
        console.log(
          " Version:",
          PLATFORM_VERSION
        );
        console.log(
          " Port:",
          PORT
        );
        console.log(
          " URL:",
          APP_URL
        );
        console.log(
          " Database:",
          pool
            ? "configured"
            : "not configured"
        );
        console.log(
          " Automation:",
          AUTOMATION_ENABLED
            ? "enabled"
            : "disabled"
        );
        console.log(
          " Auto Publish:",
          AUTO_PUBLISH
            ? "enabled"
            : "disabled"
        );
        console.log(
          " AI:",
          AI_ENABLED
            ? "enabled"
            : "disabled"
        );
        console.log(
          "=========================================="
        );
        console.log("");

        startAutomation();
      }
    );
  } catch (error) {
    console.error(
      "Startup error:",
      error
    );

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `EZ MEDIA started without database on port ${PORT}`
        );

        startAutomation();
      }
    );
  }
}

start();

/*
=========================================================
 GRACEFUL SHUTDOWN
=========================================================
*/

async function shutdown(
  signal
) {
  console.log(
    `${signal} received.`
  );

  if (automationTimer) {
    clearInterval(
      automationTimer
    );
  }

  if (pool) {
    await pool.end();
  }

  process.exit(0);
}

process.on(
  "SIGTERM",
  () =>
    shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () =>
    shutdown("SIGINT")
);
