FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm ci && npm run build --workspace=@redi-control/storage
CMD ["node", "apps/storage/dist/server.js"]
