FROM python:3.12-slim

WORKDIR /srv/app

# 先装依赖，利用 Docker 层缓存（requirements 不变就不重装）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8001

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
