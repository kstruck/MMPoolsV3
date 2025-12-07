# Step 1: Build the app
FROM node:20-alpine as build
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the code
COPY . .

# Accept the API Key as a build argument
ARG VITE_API_KEY
ENV VITE_API_KEY=$VITE_API_KEY

# Build the project
RUN npm run build

# Step 2: Serve with Nginx
FROM nginx:alpine
# Copy the built files from the previous step
COPY --from=build /app/dist /usr/share/nginx/html
# Copy our custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]