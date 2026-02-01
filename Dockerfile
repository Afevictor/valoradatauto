# Use official Playwright image
FROM mcr.microsoft.com/playwright:v1.41.0-jammy

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Install Playwright browsers (already in the image, but ensures logic)
RUN npx playwright install --with-deps chromium

# Copy the rest of the application
COPY . .

# Expose the port (Railway/Render use this)
EXPOSE 3000

# Start the webhook server
CMD ["npm", "run", "server"]
