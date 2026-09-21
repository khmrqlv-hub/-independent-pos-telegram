FROM node:24-bookworm-slim AS source
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

FROM source AS api
RUN npm run build --workspace=@pos/api
ENV NODE_ENV=production
ENV API_PORT=4000
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]

FROM source AS web
ARG API_INTERNAL_URL
RUN test -n "$API_INTERNAL_URL"
ENV API_INTERNAL_URL=$API_INTERNAL_URL
RUN npm run build --workspace=@pos/web
RUN chown -R node:node apps/web/.next
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace=@pos/web"]

FROM source AS migrations
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "db:migrate"]
