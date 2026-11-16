# syntax=docker/dockerfile:1.7
# Étape 1 : build Vite (Node + devDependencies, jeté ensuite)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Étape 2 : fichiers statiques servis par Nginx non-root (~20 Mo au lieu de ~400 Mo)
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
# Correctifs de sécurité Alpine appliqués au build (Trivy bloque les CVE CRITICAL corrigeables)
USER root
RUN apk upgrade --no-cache
ENV BACKEND_URL=http://backend:3000
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
