# Use official Playwright image
FROM mcr.microsoft.com/playwright:v1.58.1-jammy

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (only production to keep it light)
RUN npm install --omit=dev

# Copy the rest of the application
COPY . .

# Expose the port
EXPOSE 3000

# Start the webhook server directly with node
CMD ["node", "webhook_server.js"]
