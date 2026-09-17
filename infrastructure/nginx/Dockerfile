# CatLium EduTech - internal reverse proxy (nginx:alpine).
# Small custom image: ships the app-specific nginx.conf only.
FROM nginx:alpine

COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --retries=10 --start-period=5s \
    CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1