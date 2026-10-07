type Settings = {
  linkding_url: string;
  api_token: string;
  limit: number;
};

type Bookmark = {
  id: number;
  url: string;
  title: string;
  description?: string;
  notes?: string;
  tag_names?: string[];
  date_added?: string;
  unread?: boolean;
};

type LinkdingResponse = {
  count: number;
  next: string | null;
  previous: string | null;
  results: Bookmark[];
};

let settings: Settings = {
  linkding_url: "",
  api_token: "",
  limit: 5,
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export const plugin = {
  id: "degoog-linkding",
  name: "Linkding",
  description: "Show matching Linkding bookmarks alongside DeGoog search results.",

  settingsSchema: [
    {
      key: "linkding_url",
      label: "Linkding URL",
      type: "text",
      default: "",
      placeholder: "http://linkding:9090",
      description:
        "The Linkding URL reachable from the DeGoog container. Do not include /api/bookmarks/.",
    },
    {
      key: "api_token",
      label: "Linkding API token",
      type: "password",
      default: "",
      placeholder: "linkding API token",
      description:
        "Your Linkding API token. It is kept server-side and is never sent to the browser.",
    },
    {
      key: "limit",
      label: "Maximum bookmarks",
      type: "text",
      default: "5",
      placeholder: "5",
      description: "Maximum number of matching bookmarks to display.",
    },
  ],
};

export const slot = {
  id: "degoog-linkding",
  name: "Linkding",
  position: "above-sidebar",

  // Everything happens server-side through context.fetch.
  isClientExposed: false,

  async configure(newSettings: Record<string, unknown>) {
    const limit = Number(newSettings.limit ?? 5);

    settings = {
      linkding_url: String(
        newSettings.linkding_url ?? ""
      ),
      api_token: String(
        newSettings.api_token ?? ""
      ),
      limit:
        Number.isFinite(limit) && limit > 0
          ? Math.min(Math.floor(limit), 50)
          : 5,
    };
  },

  async trigger(query: string): Promise<boolean> {
    return (
      query.trim().length > 0 &&
      settings.linkding_url !== "" &&
      settings.api_token.length > 0
    );
  },

  async execute(
    query: string,
    context: {
      dir: string;
      readFile: (filename: string) => Promise<string>;
      signProxyUrl: (url: string) => string;
      fetch: typeof fetch;
      useCache: <T>(
        namespace: string,
        defaultTtlMs: number
      ) => {
        get: (key: string) => Promise<T | null>;
        set: (
          key: string,
          value: T,
          ttlMs?: number
        ) => Promise<void>;
        delete: (key: string) => Promise<void>;
        clear: () => Promise<void>;
      };
    }
  ) {
    const q = query.trim();

    if (!q) {
      return { html: "" };
    }

    if (
      !settings.linkding_url ||
      settings.linkding_url === "" ||
      !settings.api_token
    ) {
      return { html: "" };
    }

    const baseUrl = normalizeUrl(settings.linkding_url);

    const url = new URL(`${baseUrl}/api/bookmarks/`);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", String(settings.limit));

    try {
      const cache = context.useCache<LinkdingResponse>(
        "linkding-search",
        60_000
      );

      const cacheKey = `${baseUrl}|${settings.limit}|${q}`;

      let data = await cache.get(cacheKey);

      if (!data) {
        const response = await context.fetch(url.toString(), {
          method: "GET",
          headers: {
            Authorization: `Token ${settings.api_token}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          console.warn(
            `[degoog-linkding] Linkding returned HTTP ${response.status}`
          );

          return {
            html: `
              <div class="degoog-linkding degoog-linkding-error">
                <strong>Linkding</strong>
                <span>Unable to retrieve bookmarks.</span>
              </div>
              ${styles()}
            `,
          };
        }

        data = (await response.json()) as LinkdingResponse;

        await cache.set(cacheKey, data);
      }

      const bookmarks = data.results ?? [];

      if (bookmarks.length === 0) {
        return { html: "" };
      }

      return {
        html: `
          <section class="degoog-linkding">
            <div class="degoog-linkding-header">
              <span class="degoog-linkding-icon">🔖</span>
              <span class="degoog-linkding-heading">
                Your Linkding bookmarks
              </span>
              <span class="degoog-linkding-count">
                ${bookmarks.length}
              </span>
            </div>

            <div class="degoog-linkding-results">
              ${bookmarks.map(renderBookmark).join("")}
            </div>
          </section>

          ${styles()}
        `,
      };
    } catch (error) {
      console.warn(
        "[degoog-linkding] Request failed:",
        error
      );

      return {
        html: `
          <div class="degoog-linkding degoog-linkding-error">
            <strong>Linkding</strong>
            <span>Unable to connect to Linkding.</span>
          </div>
          ${styles()}
        `,
      };
    }
  },
};

function renderBookmark(bookmark: Bookmark): string {
  const title =
    bookmark.title?.trim() ||
    bookmark.url;

  const description =
    bookmark.description?.trim() || "";

  const tags =
    Array.isArray(bookmark.tag_names) &&
    bookmark.tag_names.length > 0
      ? `
        <div class="degoog-linkding-tags">
          ${bookmark.tag_names
            .map(
              (tag) => `
                <span class="degoog-linkding-tag">
                  ${escapeHtml(tag)}
                </span>
              `
            )
            .join("")}
        </div>
      `
      : "";

  return `
    <article class="degoog-linkding-bookmark">
      <a
        class="degoog-linkding-title"
        href="${escapeHtml(bookmark.url)}"
        target="_blank"
        rel="noopener noreferrer"
      >
        ${escapeHtml(title)}
      </a>

      <div class="degoog-linkding-url">
        ${escapeHtml(bookmark.url)}
      </div>

      ${
        description
          ? `
            <div class="degoog-linkding-description">
              ${escapeHtml(description)}
            </div>
          `
          : ""
      }

      ${tags}
    </article>
  `;
}

function styles(): string {
  return `
    <style>
      .degoog-linkding {
        margin: 0 0 1rem 0;
        padding: 0;
        border: 1px solid var(--border-color, rgba(128, 128, 128, 0.3));
        border-radius: 8px;
        overflow: hidden;
        background: var(--background-secondary, transparent);
      }

      .degoog-linkding-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.7rem 0.8rem;
        border-bottom: 1px solid
          var(--border-color, rgba(128, 128, 128, 0.3));
        font-weight: 600;
      }

      .degoog-linkding-icon {
        font-size: 1rem;
      }

      .degoog-linkding-heading {
        flex: 1;
      }

      .degoog-linkding-count {
        opacity: 0.6;
        font-size: 0.8em;
      }

      .degoog-linkding-results {
        display: flex;
        flex-direction: column;
      }

      .degoog-linkding-bookmark {
        padding: 0.75rem 0.8rem;
      }

      .degoog-linkding-bookmark + .degoog-linkding-bookmark {
        border-top: 1px solid
          var(--border-color, rgba(128, 128, 128, 0.2));
      }

      .degoog-linkding-title {
        display: block;
        color: var(--link-color, inherit);
        font-weight: 600;
        text-decoration: none;
        line-height: 1.3;
      }

      .degoog-linkding-title:hover {
        text-decoration: underline;
      }

      .degoog-linkding-url {
        margin-top: 0.25rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.75rem;
        opacity: 0.55;
      }

      .degoog-linkding-description {
        margin-top: 0.4rem;
        font-size: 0.82rem;
        line-height: 1.35;
        opacity: 0.75;
      }

      .degoog-linkding-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
        margin-top: 0.45rem;
      }

      .degoog-linkding-tag {
        padding: 0.1rem 0.35rem;
        border-radius: 4px;
        background: var(--background-tertiary, rgba(128, 128, 128, 0.15));
        font-size: 0.7rem;
        opacity: 0.8;
      }

      .degoog-linkding-error {
        display: flex;
        gap: 0.5rem;
        padding: 0.75rem 0.8rem;
        font-size: 0.85rem;
      }
    </style>
  `;
}
