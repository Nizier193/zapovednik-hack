FROM python:3.12-slim

# Disable .pyc files and force stdout/stderr to be unbuffered so logs reach Docker immediately
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Ставим зависимости
COPY ./requirements.txt ./
RUN pip install -r requirements.txt

# Копируем код
COPY . .

# Делаем entrypoint исполняемым (на случай монтирования с Windows-хоста уберём CR)
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Открываем порт и запускаем
EXPOSE 8080
ENTRYPOINT ["/app/entrypoint.sh"]
