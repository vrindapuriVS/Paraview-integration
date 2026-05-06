import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@kitware/vtk.js/IO/XML/XMLUnstructuredGridReader': fileURLToPath(new URL('./src/vtk/XMLUnstructuredGridReader.js', import.meta.url)),
            '@kitware/vtk.js/Filters/Geometry/DataSetSurfaceFilter': fileURLToPath(new URL('./src/vtk/DataSetSurfaceFilter.js', import.meta.url)),
        },
    },
    root: '.',
    publicDir: 'public',
    server: {
        host: '0.0.0.0', // Listen on all addresses for Docker
        port: 5173,
        watch: {
            usePolling: true, // Enable polling for Docker volume mounts
        },
    },
});
