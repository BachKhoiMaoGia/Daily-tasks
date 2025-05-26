# Dockerfile.login - Chuyên cho việc đăng nhập Zalo
FROM node:18-alpine

# Install dependencies for zca-js
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy login script
COPY simple-zalo-login.cjs ./

# Create volume for cookies
VOLUME ["/app/cookies"]

# Command to run login
CMD ["node", "simple-zalo-login.cjs"]
