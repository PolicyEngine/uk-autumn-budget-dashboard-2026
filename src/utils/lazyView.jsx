import { lazy, useState } from "react";

/**
 * A component whose code loads on first use (a dynamic import, its own
 * chunk), for a view the page may never open. Inside <Suspense> it shows the
 * fallback until the code is in. Once loaded (by an earlier use, or by
 * `preload` while the page is idle), a new use renders at once, without
 * suspending, so an opened tab never flashes its placeholder.
 *
 * `pick` chooses the component from the module (its default export unless
 * given). A failed preload is retried when the view is used.
 */
export function lazyView(load, pick = (module) => module.default) {
  let loaded = null;
  let pending = null;
  const preload = () => {
    if (loaded) return Promise.resolve(loaded);
    if (!pending) {
      pending = load().then(
        (module) => {
          loaded = pick(module);
          return loaded;
        },
        (error) => {
          pending = null;
          throw error;
        },
      );
    }
    return pending;
  };
  const Lazy = lazy(() => preload().then((component) => ({ default: component })));
  function LazyView(props) {
    // Fixed per mount: an instance that started suspended keeps the lazy
    // wrapper (which resolves to the same component), so it never remounts
    const [direct] = useState(() => loaded !== null);
    if (direct) {
      const Loaded = loaded;
      return <Loaded {...props} />;
    }
    return <Lazy {...props} />;
  }
  // A failed preload is forgotten, so the view's own load tries again
  LazyView.preload = preload;
  return LazyView;
}

/**
 * Load these views' code: resolves once every load has settled, never
 * rejects (a failure is left for the view's own use to retry).
 */
export function preloadViewCode(views) {
  return Promise.all(views.map((view) => view.preload().catch(() => {}))).then(() => {});
}
