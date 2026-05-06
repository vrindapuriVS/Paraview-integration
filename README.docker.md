# Docker Setup Guide

This project includes Docker configurations for both development and production environments.

## Quick Start

### Development Mode (Hot Reload)

Run the development server with hot reload:

```bash
# Using Docker Compose (recommended)
docker-compose up frontend-dev

# Or using Docker directly
docker build -f Dockerfile.dev -t vortex-ai-frontend-dev .
docker run -p 5173:5173 -v $(pwd):/app -v /app/node_modules vortex-ai-frontend-dev
```

The app will be available at `http://localhost:5173` with hot reload enabled.

### Production Mode

Build and run the production-optimized version:

```bash
# Using Docker Compose
docker-compose up frontend

# Or using Docker directly
docker build -t vortex-ai-frontend .
docker run -p 3000:80 vortex-ai-frontend
```

The app will be available at `http://localhost:3000`.

## Docker Compose Services

- **frontend**: Production build served with nginx
- **frontend-dev**: Development server with Vite and hot reload

## Development Tips

1. **Hot Reload**: The development container uses volume mounts, so changes to your code will automatically trigger hot reload.

2. **Node Modules**: The `/app/node_modules` volume prevents overwriting node_modules from the host, ensuring consistency.

3. **Port Conflicts**: If ports 3000 or 5173 are already in use, modify the port mappings in `docker-compose.yml`.

## Building for Production

The production build:
- Compiles TypeScript
- Builds optimized production assets with Vite
- Serves static files with nginx
- Includes gzip compression and caching
- Supports React Router (SPA routing)

## Troubleshooting

- **Hot reload not working**: Ensure volumes are properly mounted and `CHOKIDAR_USEPOLLING=true` is set if needed
- **Port already in use**: Change the port mapping in docker-compose.yml (e.g., `"8080:5173"`)
- **Build fails**: Make sure all dependencies are listed in package.json and package-lock.json exists
