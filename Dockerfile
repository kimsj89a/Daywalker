FROM node:20-alpine
WORKDIR /app
COPY Workflow.html Widget.html server.js ./
EXPOSE 3000
CMD ["node", "server.js"]
