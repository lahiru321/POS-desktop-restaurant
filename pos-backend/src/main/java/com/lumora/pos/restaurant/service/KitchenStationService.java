package com.lumora.pos.restaurant.service;

import com.lumora.pos.inventory.repository.CategoryRepository;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.inventory.service.KitchenStations;
import com.lumora.pos.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.TreeSet;
import java.util.UUID;

/**
 * The stations a ticket can be routed to, so each till can give each one a
 * printer. Stations are not a table of their own: a station exists because a
 * product or category names it, and stops existing when nothing does.
 */
@Service
@RequiredArgsConstructor
public class KitchenStationService {

    private final ProductRepository productRepository;
    private final CategoryRepository categoryRepository;

    /** {@code KITCHEN} first — every till has it — then the rest alphabetically. */
    @Transactional(readOnly = true)
    public List<String> listStations() {
        UUID tenantId = TenantContext.getTenantId();
        TreeSet<String> named = new TreeSet<>();
        productRepository.findDistinctKitchenStations(tenantId).stream()
                .map(KitchenStations::normalize).filter(Objects::nonNull).forEach(named::add);
        categoryRepository.findDistinctKitchenStations(tenantId).stream()
                .map(KitchenStations::normalize).filter(Objects::nonNull).forEach(named::add);
        named.remove(KitchenStations.DEFAULT);

        List<String> stations = new ArrayList<>();
        stations.add(KitchenStations.DEFAULT);
        stations.addAll(named);
        return stations;
    }
}
