/**
 * Where this copy of the site is served from.
 *
 * Vite fills BASE_URL with "/" by default, and with whatever `--base` says
 * when the site is built for a subdirectory — which is exactly what GitHub
 * Pages hands a fork: `yourname.github.io/opengeo-sim/`. Every runtime fetch
 * of data, scenery or the flight model goes through here, so somebody else's
 * deployment works without editing a single path.
 *
 *     npm run build -- --base=/opengeo-sim/
 */
export const asset = (path) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
