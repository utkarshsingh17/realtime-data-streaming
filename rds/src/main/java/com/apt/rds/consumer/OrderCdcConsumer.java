package com.apt.rds.consumer;

import com.apt.rds.model.OrderEvent;
import com.apt.rds.model.OrderEvent.OrderPayload;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.avro.generic.GenericRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class OrderCdcConsumer {

    private final SimpMessagingTemplate messagingTemplate;

    private static final String WS_DESTINATION = "/topic/orders";

    private static final Map<String, String> OP_LABELS = Map.of(
            "c", "INSERT",
            "u", "UPDATE",
            "d", "DELETE",
            "r", "SNAPSHOT"
    );

    @KafkaListener(
            topics  = "${app.kafka.topic}",
            groupId = "${spring.kafka.consumer.group-id}"
    )
    public void consume(GenericRecord envelope) {
        if (envelope == null) {
            log.warn("Received null Kafka record — skipping");
            return;
        }
        try {
            String op           = getString(envelope, "op");
            OrderPayload before = extractOrderPayload(envelope, "before");
            OrderPayload after  = extractOrderPayload(envelope, "after");

            OrderEvent event = OrderEvent.builder()
                    .op(op)
                    .operationLabel(OP_LABELS.getOrDefault(op, op.toUpperCase()))
                    .before(before)
                    .after(after)
                    .processedAt(Instant.now().toEpochMilli())
                    .build();

            log.info("CDC event received → {}", event);

            log.info("Pushing CDC event → op={} orderId={}",
                    op,
                    after  != null ? after.getId()  :
                            before != null ? before.getId() : "unknown");

            messagingTemplate.convertAndSend(WS_DESTINATION, event);

        } catch (Exception e) {
            log.error("Error processing Kafka record: {}", envelope, e);
        }
    }

    private OrderPayload extractOrderPayload(GenericRecord envelope, String field) {
        Object raw = envelope.get(field);
        if (raw == null) return null;

        GenericRecord row = (GenericRecord) raw;
        return OrderPayload.builder()
                .id(getInt(row, "id"))
                .customerName(getString(row, "customer_name"))
                .productName(getString(row, "product_name"))
                .status(getString(row, "status"))
                .updatedAt(toIso(row, "updated_at"))
                .build();
    }

    private String getString(GenericRecord record, String field) {
        Object val = record.get(field);
        return val != null ? val.toString() : null;
    }

    private Integer getInt(GenericRecord record, String field) {
        Object val = record.get(field);
        return val != null ? ((Number) val).intValue() : null;
    }

    private String toIso(GenericRecord record, String field) {
        Object val = record.get(field);
        if (val == null) return null;

        if (val instanceof Number num) {
            return Instant.ofEpochMilli(num.longValue()).toString();
        }

        return val.toString();
    }
}