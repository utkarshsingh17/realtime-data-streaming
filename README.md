# Order Real-Time Updates
> **Real-time database change propagation** using MySQL → Debezium → Kafka → Spring Boot → WebSocket → React

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Tech Stack](#tech-stack)
3. [Prerequisites](#prerequisites)
4. [Step 1 — MySQL Setup (Docker)](#step-1--mysql-setup-docker)
5. [Step 2 — Enable Binary Logging](#step-2--enable-binary-logging)
6. [Step 3 — Start Confluent Platform](#step-3--start-confluent-platform)
7. [Step 4 — Install Debezium MySQL Connector Plugin](#step-4--install-debezium-mysql-connector-plugin)
8. [Step 5 — Start Kafka Connect](#step-5--start-kafka-connect)
9. [Step 6 — Register the Debezium Connector](#step-6--register-the-debezium-connector)
10. [Step 7 — Run Spring Boot Backend](#step-7--run-spring-boot-backend)
11. [Step 8 — Run React Frontend](#step-8--run-react-frontend)
12. [Testing End-to-End](#testing-end-to-end)
13. [Project Structure](#project-structure)
14. [Why This Approach](#why-this-approach)
15. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        REAL-TIME PIPELINE                        │
│                                                                  │
│  MySQL 8.0 (Docker)                                              │
│    └─ Binary Log (binlog)                                        │
│         └─ Debezium MySQL Connector 1.9.2 (Kafka Connect)        │
│              └─ Kafka Topic: mysql1.ecom_db.orders  (Avro)       │
│                   └─ Spring Boot — @KafkaListener                │
│                        └─ SimpMessagingTemplate                  │
│                             └─ WebSocket /topic/orders (STOMP)   │
│                                  └─ React Browser Client         │
└──────────────────────────────────────────────────────────────────┘
```

**No polling. No manual triggers. Any INSERT / UPDATE / DELETE on the `orders` table
is automatically pushed to all connected browser clients within ~500ms.**

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Database | MySQL | 8.0 (Docker) |
| CDC Connector | Debezium MySQL Connector | 1.9.2.Final |
| Message Broker | Apache Kafka (KRaft) + Schema Registry | Confluent 8.2.1 |
| Message Format | Apache Avro | via Confluent |
| Backend | Spring Boot | 3.2.5 |
| Language | Java | 21 |
| Real-time Protocol | WebSocket + STOMP (SockJS) | — |
| Frontend | React | 18 |

---

## Prerequisites

- **Docker Desktop** — for MySQL
- **Java 21** — for Spring Boot
- **Maven 3.9+** — build tool
- **Node.js 18+** — for React frontend
- **Confluent Platform 8.2.1** — Kafka, Schema Registry, Kafka Connect

Verify your installs:
```bash
java -version      # openjdk 21
mvn -version       # Apache Maven 3.9.x
node -version      # v18.x or higher
docker -version    # Docker version 24.x
```

Make sure `CONFLUENT_HOME` is set and `$CONFLUENT_HOME/bin` is on your `PATH`:
```bash
export CONFLUENT_HOME=/path/to/confluent-8.2.1
export PATH=$CONFLUENT_HOME/bin:$PATH
```

---

## Step 1 — MySQL Setup (Docker)

Pull and start MySQL 8.0:
```bash
docker pull mysql:8.0
docker run --name=mysql_orders \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=root123 \
  -d mysql:8.0
```

Connect and create the database + table:
```bash
docker exec -it mysql_orders mysql -uroot -proot123
```

```sql
CREATE DATABASE ecom_db;
USE ecom_db;

CREATE TABLE orders (
    id            INT NOT NULL AUTO_INCREMENT,
    customer_name VARCHAR(255) NOT NULL,
    product_name  VARCHAR(255) NOT NULL,
    status        ENUM('pending', 'shipped', 'delivered') NOT NULL DEFAULT 'pending',
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);
```

Grant replication privileges to root (required by Debezium):
```sql
GRANT SELECT, RELOAD, SHOW DATABASES,
      REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'root'@'%';
FLUSH PRIVILEGES;
EXIT;
```

---

## Step 2 — Enable Binary Logging

Binary logging is what Debezium reads to detect changes (CDC). Check if it's already on:
```bash
docker exec -it mysql_orders mysql -uroot -proot123 \
  -e "SELECT variable_value FROM performance_schema.global_variables WHERE variable_name='log_bin';"
```

If the result is `OFF`, enable it:
```bash
docker exec -it mysql_orders /bin/bash
```
```bash
# Inside the container
apt-get update && apt-get install -y vim
vim /etc/my.cnf
```

Add under `[mysqld]`:
```ini
[mysqld]
server-id         = 223344
log_bin           = mysql-bin
binlog_format     = ROW
binlog_row_image  = FULL
expire_logs_days  = 10
```

Restart:
```bash
docker restart mysql_orders
```

Verify binary logging is active:
```bash
docker exec -it mysql_orders mysql -uroot -proot123 -e "SHOW BINARY LOGS;"
```
You should see at least one `mysql-bin.000001` file listed.

---

## Step 3 — Start Confluent Platform

Confluent 8.2.1 uses **KRaft mode** — ZooKeeper is completely removed.
Kafka manages its own cluster metadata internally via the Raft consensus protocol.

### Option A — Confluent CLI (recommended, starts everything at once)

```bash
confluent local services start
```

Check all services are running:
```bash
confluent local services status
```

### Option B — Manual startup

**1. Format the KRaft storage directory (first time only):**
```bash
# Generate a unique cluster ID
KAFKA_CLUSTER_ID=$($CONFLUENT_HOME/bin/kafka-storage random-uuid)

# Format the storage directory
$CONFLUENT_HOME/bin/kafka-storage format \
  -t $KAFKA_CLUSTER_ID \
  -c $CONFLUENT_HOME/etc/kafka/kraft/server.properties
```

**2. Start Kafka (KRaft mode — no ZooKeeper):**
```bash
$CONFLUENT_HOME/bin/kafka-server-start \
  $CONFLUENT_HOME/etc/kafka/kraft/server.properties &
```

**3. Start Schema Registry:**
```bash
$CONFLUENT_HOME/bin/schema-registry-start \
  $CONFLUENT_HOME/etc/schema-registry/schema-registry.properties &
```

Verify Kafka is up:
```bash
kafka-topics --list --bootstrap-server localhost:9092
```

Verify Schema Registry is up:
```bash
curl http://localhost:8081/subjects
# Should return: []
```

---

## Step 4 — Install Debezium MySQL Connector Plugin

```bash
# Create connectors directory inside CONFLUENT_HOME
mkdir -p $CONFLUENT_HOME/connectors
cd $CONFLUENT_HOME/connectors

# Copy the plugin (use the 1.9.2 version included in this repo)
cp /path/to/debezium-connector-mysql-1.9.2.Final-plugin.tar.gz .
tar -xvzf debezium-connector-mysql-1.9.2.Final-plugin.tar.gz
rm debezium-connector-mysql-1.9.2.Final-plugin.tar.gz
```

Register the plugin path in Kafka Connect config:
```bash
vim $CONFLUENT_HOME/etc/kafka/connect-distributed.properties
```

Find the `plugin.path` line and add your connectors directory:
```properties
plugin.path=/usr/share/java,/path/to/confluent-8.2.1/connectors
```

---

## Step 5 — Start Kafka Connect

```bash
$CONFLUENT_HOME/bin/connect-distributed \
  $CONFLUENT_HOME/etc/kafka/connect-distributed.properties &
```

Wait ~10 seconds, then verify it's running:
```bash
curl http://localhost:8083
# Returns: {"version":"...","commit":"...","kafka_cluster_id":"..."}
```

Check that the Debezium MySQL plugin is loaded:
```bash
curl http://localhost:8083/connector-plugins | grep -i mysql
# Should show: io.debezium.connector.mysql.MySqlConnector
```

---

## Step 6 — Register the Debezium Connector

```bash
curl -i -X POST \
  -H "Accept:application/json" \
  -H "Content-Type:application/json" \
  http://localhost:8083/connectors/ -d '
{
  "name": "debezium-demo-connector",
  "config": {
    "connector.class": "io.debezium.connector.mysql.MySqlConnector",
    "tasks.max": "1",
    "database.hostname": "localhost",
    "database.port": "3306",
    "database.user": "root",
    "database.password": "root123",
    "database.server.id": "10101",
    "database.server.name": "mysql1",
    "database.include.list": "ecom_db",
    "database.history.kafka.bootstrap.servers": "localhost:9092",
    "database.history.kafka.topic": "schema-changes.ecom_db",
    "key.converter": "io.confluent.connect.avro.AvroConverter",
    "value.converter": "io.confluent.connect.avro.AvroConverter",
    "key.converter.schema.registry.url": "http://localhost:8081",
    "value.converter.schema.registry.url": "http://localhost:8081"
  }
}'
```

Verify the connector is `RUNNING`:
```bash
curl http://localhost:8083/connectors/debezium-demo-connector/status
```

Expected output:
```json
{
  "name": "debezium-demo-connector",
  "connector": { "state": "RUNNING", "worker_id": "..." },
  "tasks": [{ "id": 0, "state": "RUNNING", "worker_id": "..." }]
}
```

Verify Kafka is receiving CDC events:
```bash
kafka-avro-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic mysql1.ecom_db.orders \
  --from-beginning \
  --property schema.registry.url=http://localhost:8081
```

---

## Step 7 — Run Spring Boot Backend

```bash
cd backend
mvn spring-boot:run
```

The server starts on **http://localhost:8080**.

Verify it's up:
```bash
curl http://localhost:8080/api/health
# Returns: {"status":"UP","service":"order-realtime"}
```

### How the backend works

The backend has **one job**: listen to Kafka and push to WebSocket clients.

```
@KafkaListener (topic: mysql1.ecom_db.orders)
    └─ Receives Avro GenericRecord (Debezium CDC envelope)
    └─ Parses: op (c/u/d/r) + before/after order fields
    └─ Builds OrderEvent DTO
    └─ SimpMessagingTemplate.convertAndSend("/topic/orders", event)
    └─ All subscribed React clients receive the update instantly
```

The `OrderController` contains only a `/api/health` endpoint.
**Nothing is hardcoded. No manual triggers. All updates come directly from the database.**

### Backend configuration (`application.yml`)

```yaml
spring:
  kafka:
    bootstrap-servers: localhost:9092
    consumer:
      group-id: order-realtime-group
      auto-offset-reset: earliest
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: io.confluent.kafka.serializers.KafkaAvroDeserializer
      properties:
        schema.registry.url: http://localhost:8081
        specific.avro.reader: false

app:
  kafka:
    topic: mysql1.ecom_db.orders
```

---

## Step 8 — Run React Frontend

```bash
cd frontend
npm install
npm start
```

Opens **http://localhost:3000**.

The frontend:
- Connects to Spring Boot via SockJS at `ws://localhost:8080/ws`
- Subscribes to the STOMP topic `/topic/orders`
- Displays each incoming CDC event as a live card with colour-coded operation badges

---

## Testing End-to-End

With all services running, open http://localhost:3000 in your browser, then run any of these SQL commands:

```sql
docker exec -it mysql_orders mysql -uroot -proot123 ecom_db
```

```sql
-- INSERT — watch a new card appear
INSERT INTO orders (customer_name, product_name, status)
VALUES ('Utkarsh', 'TV', 'pending');

-- UPDATE — watch the status change with before/after diff
UPDATE orders SET status = 'shipped' WHERE id = 1;

-- UPDATE again
UPDATE orders SET status = 'delivered' WHERE id = 1;

-- DELETE — watch the card appear with DELETE badge
DELETE FROM orders WHERE id = 1;
```

Each change appears in the browser within **~500ms** with no page refresh.

---

## Project Structure

```
order-realtime/
│
├── debezium-connector.json              ← Connector registration payload
│
├── backend/                             ← Spring Boot (Java 21)
│   ├── pom.xml
│   └── src/main/
│       ├── resources/
│       │   └── application.yml          ← Kafka + WebSocket config
│       └── java/com/apt/orderrealtime/
│           ├── OrderRealtimeApplication.java   ← Entry point
│           ├── config/
│           │   └── WebSocketConfig.java        ← STOMP broker setup
│           ├── consumer/
│           │   └── OrderCdcConsumer.java       ← Kafka listener → WS broadcast
│           ├── controller/
│           │   └── OrderController.java        ← Health check only
│           └── model/
│               └── OrderEvent.java             ← DTO pushed to clients
│
└── frontend/                            ← React 18
    ├── package.json
    └── src/
        ├── index.js
        ├── App.js                       ← Root component + connection indicator
        ├── hooks/
        │   └── useOrderWebSocket.js     ← STOMP connection + event state
        └── components/
            └── OrderFeed.js             ← Live event cards with badges
```

---

## Why This Approach

### Why Debezium + Kafka instead of DB triggers or polling?

| Approach | Problem |
|---|---|
| **Polling** | Wastes resources; introduces latency equal to poll interval; doesn't scale |
| **DB Triggers** | Tightly couples business logic to the database; hard to maintain |
| **Debezium CDC** | Reads the MySQL binary log — zero additional load on the DB; captures every change reliably |

### Why Kafka in the middle?

- **Decoupling** — the database doesn't know about the backend; the backend doesn't depend on the DB being available at the exact moment of change
- **Durability** — events are stored in Kafka; if the Spring Boot service restarts, it replays missed events from the last committed offset
- **Scalability** — multiple Spring Boot instances can consume from the same topic with a consumer group, enabling horizontal scaling

### Why WebSocket + STOMP instead of SSE or Long Polling?

- **WebSocket** gives full-duplex persistent connection — server can push at any time
- **STOMP** adds a lightweight pub/sub layer over WebSocket so clients subscribe to named topics (`/topic/orders`) cleanly
- **SockJS** provides automatic fallback for browsers/proxies that block raw WebSockets

### Why Avro + Schema Registry?

- Avro is compact (binary) and schema-enforced — far smaller than JSON on the wire
- The Schema Registry ensures producer and consumer always agree on the message structure, preventing deserialization errors as the schema evolves

---

## Troubleshooting

**Connector status is `FAILED`**
```bash
curl http://localhost:8083/connectors/debezium-demo-connector/status
```
Most common causes:
- MySQL user lacks `REPLICATION SLAVE` / `REPLICATION CLIENT` privilege → re-run `GRANT` commands
- `binlog_format` is not `ROW` → check `/etc/my.cnf` and restart the container
- Wrong `database.password` in the connector config → delete and re-register

Delete and re-register connector:
```bash
curl -X DELETE http://localhost:8083/connectors/debezium-demo-connector
# Then re-POST the connector JSON
```

**`ClassCastException: Utf8 cannot be cast to Number` on `updated_at`**
Debezium emits MySQL `TIMESTAMP` columns as either epoch milliseconds (Number) or ISO-8601 strings (Utf8) depending on the connector version. The `toIso()` method in `OrderCdcConsumer` handles both:
```java
private String toIso(GenericRecord record, String field) {
    Object val = record.get(field);
    if (val == null) return null;
    if (val instanceof Number num) {
        return Instant.ofEpochMilli(num.longValue()).toString();
    }
    return val.toString(); // already ISO-8601 string
}
```

**`Could not find artifact io.confluent:kafka-avro-serializer`**
The Confluent repo is not in Maven Central. Ensure `pom.xml` has:
```xml
<repositories>
    <repository>
        <id>central</id>
        <url>https://repo1.maven.org/maven2</url>
    </repository>
    <repository>
        <id>confluent</id>
        <url>https://packages.confluent.io/maven/</url>
        <releases><enabled>true</enabled></releases>
        <snapshots><enabled>false</enabled></snapshots>
    </repository>
</repositories>
```
Verify network access: `curl -I https://packages.confluent.io/maven/`

**Frontend shows "Disconnected"**
- Check Spring Boot is running: `curl http://localhost:8080/api/health`
- Check no browser extension is blocking WebSocket connections
- Check CORS config in `application.yml` matches your React dev server URL (`http://localhost:3000`)

**Kafka topic not receiving messages**
```bash
# Check connector is RUNNING
curl http://localhost:8083/connectors/debezium-demo-connector/status

# List all topics — mysql1.ecom_db.orders should exist
kafka-topics --list --bootstrap-server localhost:9092

# Consume raw Avro messages
kafka-avro-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic mysql1.ecom_db.orders \
  --from-beginning \
  --property schema.registry.url=http://localhost:8081
```

**Port conflicts**

| Service | Port |
|---|---|
| MySQL | 3306 |
| Kafka (KRaft) | 9092 |
| Schema Registry | 8081 |
| Kafka Connect | 8083 |
| Spring Boot | 8080 |
| React Dev Server | 3000 |
