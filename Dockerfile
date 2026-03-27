FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js Workflow.html Widget.html ./
RUN mkdir -p data seed
COPY data/projects.json seed/projects.json
COPY start.sh ./
RUN chmod +x start.sh
EXPOSE 3000
CMD ["sh", "start.sh"]
