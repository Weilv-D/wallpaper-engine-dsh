/**
 * wallpaper-engine-dsh — host-half type surface.
 * The runtime contract is a Cordis plugin module: named `inject` + `apply`,
 * mirrored on the default export.
 */

/**
 * One inventory entry. Scene/application wallpapers are filtered out at the
 * source — the wire only ever carries the browser-renderable kinds.
 */
export interface WallpaperSummary {
  id: string;
  title: string;
  type: 'video' | 'web';
  playable: boolean;
  media: string | null;
  preview: string | null;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  order: 'sequence' | 'random';
  delay: number | null;
  wallpaperIds: string[];
  total: number;
  portableCount: number;
  unresolvedCount: number;
}

export interface Inventory {
  installDir: string | null;
  total: number;
  portableCount: number;
  wallpapers: WallpaperSummary[];
  playlists: PlaylistSummary[];
}

/** Cordis context shape this plugin consumes (structural, minimal). */
export interface HostContext {
  webServer?: {
    register(route: {
      kind: 'exact' | 'prefix';
      path: string;
      handler(req: unknown, res: unknown): void | Promise<void>;
    }): () => void;
  };
}

/** webServer-like registry consumed by createRouteRegistrar. */
export interface WebServerRegistry {
  register(route: {
    kind: 'exact' | 'prefix';
    path: string;
    handler(req: unknown, res: unknown): void | Promise<void>;
  }): () => void;
}

/**
 * Register all HTTP routes on a webServer-like registry; returns a disposer.
 * Exported so integration tests can drive the surface against a fixture
 * discovery without a live Steam install.
 */
export function createRouteRegistrar(
  webServer: WebServerRegistry,
  opts?: {
    discover?: () => Promise<{ installDir: string | null; libraryRoots: string[] }>;
    inventoryTtlMs?: number;
    discoveryTtlMs?: number;
  },
): () => void;

export declare const inject: string[];
export declare function apply(ctx: HostContext): () => void;

declare const plugin: { inject: string[]; apply: typeof apply };
export default plugin;
