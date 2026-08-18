/**
 * wallpaper-engine-dsh — client-half type surface.
 * Loaded by the DSH web module loader; consumes the slots service.
 */

export interface ClientContext {
  slots?: {
    inject(key: string, callback: () => unknown): unknown;
    register(
      options: { name: string; id: string; order?: number; label?: string },
      render: () => unknown,
    ): unknown;
  };
  effect?(fn: () => void | (() => void)): unknown;
}

export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
