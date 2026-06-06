package com.apt.rds.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Builder;
import lombok.Data;


@Data
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
public class OrderEvent {

    private String op;
    private String operationLabel;
    private OrderPayload before;
    private OrderPayload after;
    private long processedAt;

    @Data
    @Builder
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class OrderPayload {
        private Integer id;
        private String  customerName;
        private String  productName;
        private String  status;
        private String  updatedAt;
    }
}
