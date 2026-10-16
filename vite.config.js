import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';

// Two entries, one scene stack. Each page loads Cesium on its own so neither
// pays for the other.
export default defineConfig({
  // Stamped into the bundle so a page can say which build it is. Without it,
  // "still broken" and "still the old build" look the same from here.
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  plugins: [cesium()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        fly: 'fly.html',
        ride: 'ride.html',
      },
    },
  },
  server: {
    host: '0.0.0.0',
  },
});
