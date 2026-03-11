FROM node:18-alpine

WORKDIR /app

# Copy package.json first for optimal caching
COPY package*.json ./
RUN npm install --production

# Copy source code
COPY . .

# Expose API port
EXPOSE 3002

# Start server
CMD ["node", "server.js"]
