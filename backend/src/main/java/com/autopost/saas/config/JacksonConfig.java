package com.autopost.saas.config;

import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

@Configuration
public class JacksonConfig {

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer jacksonCustomizer() {
        return builder -> {
            StreamReadConstraints streamReadConstraints = StreamReadConstraints.builder()
                    .maxStringLength(500_000_000) // Cho phép chuỗi JSON dài tối đa 500MB (phục vụ video Base64)
                    .build();
            builder.postConfigurer(objectMapper -> 
                objectMapper.getFactory().setStreamReadConstraints(streamReadConstraints)
            );
        };
    }

    @Bean
    public ObjectMapper objectMapper(Jackson2ObjectMapperBuilder builder) {
        ObjectMapper objectMapper = builder.createXmlMapper(false).build();
        StreamReadConstraints streamReadConstraints = StreamReadConstraints.builder()
                .maxStringLength(500_000_000) // Cho phép chuỗi JSON dài tối đa 500MB (phục vụ video Base64)
                .build();
        objectMapper.getFactory().setStreamReadConstraints(streamReadConstraints);
        return objectMapper;
    }
}

