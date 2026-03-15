FROM node:18-alpine

WORKDIR /app

# Copy package.json first for optimal caching
COPY package*.json ./
RUN npm install --production

# Copy source code (see .dockerignore for exclusions)
COPY . .

# Run as non-root user for security
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser

# Expose API port
EXPOSE 3002

# Start server
CMD ["node", "server.js"]
